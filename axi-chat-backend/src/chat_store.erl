%%% Durable storage for messages, groups, and profiles -- backed by Redis
%%% (via chat_redis.erl), per the boss's plan: Redis is the live server-
%%% side store during the day; a separate once-daily job (not this module)
%%% pushes each user's data on to the real DB via the ARM API's AXput once
%%% that's available, and the browser's IndexedDB is the first place a
%%% client restores history from, falling back to Redis and then that DB
%%% only when IndexedDB has nothing (a fresh browser, cleared cache). This
%%% module only ever talks to Redis -- it doesn't know about IndexedDB or
%%% the daily DB sync at all.
%%%
%%% Every function here keeps the exact same name/arity/return shape this
%%% module had when it was Mnesia-backed, so chat_room.erl, chat_groups.erl,
%%% chat_web.erl, and chat_link_preview.erl needed zero changes -- only the
%%% storage underneath moved. That contract still holds after adding at-rest
%%% encryption and Redis-error logging below: every caller still gets
%%% exactly the same return shapes on success, and still crashes (now with a
%%% clear log line first) on a Redis failure, same as it always implicitly
%%% did via the old bare `{ok, _} = ...` matches.
%%%
%%% Compound values (reactions, previews, group member lists) are JSON-
%%% encoded into single Redis hash fields via the `json` module (built into
%%% OTP 27+, already used elsewhere in this app) rather than modeled as
%%% separate Redis structures -- simpler, and these are never queried by
%%% anything other than "the whole value for this one message/group," so
%%% there's nothing to gain from decomposing them further.
-module(chat_store).
-export([init/0, save_message/5, save_message/6, load_history/1, dm_key/2,
         save_group/3, delete_group/1, load_groups/0, toggle_reaction/3,
         delete_message/2,
         save_link_preview/2,
         set_pubkey/2, get_pubkey/1, set_avatar/2, set_status/2, get_profile/1]).
-include_lib("kernel/include/logger.hrl").

-define(HISTORY_LIMIT, 50).

%% Loads (and validates) the at-rest message-encryption key once at boot and
%% caches it in persistent_term -- cheap to read on every single
%% save_message/read_message call thereafter, unlike re-reading + re-
%% decoding the env var each time. See encryption_key/0 and
%% docs/DEBUGGING.md for what CHAT_ENCRYPTION_KEY does.
init() ->
    persistent_term:put({?MODULE, enc_key}, load_encryption_key()),
    ok.

%% ---- Redis key helpers -------------------------------------------------

msg_key(Id) -> "msg:" ++ integer_to_list(Id).
conv_zset_key(ConvKey) -> "conv:" ++ ConvKey ++ ":msgs".
group_key(Name) -> "group:" ++ Name.
profile_key(Username) -> "profile:" ++ Username.

%% ---- Canonical DM key ----------------------------------------------------

%% Sorted so it's the same regardless of which side is asking, e.g.
%% dm_key("bob","alice") == dm_key("alice","bob").
dm_key(A, B) ->
    [First, Second] = lists:sort([A, B]),
    "dm:" ++ First ++ "|" ++ Second.

%% ---- Messages -------------------------------------------------------------

%% Kind is 'chat' | 'group_message' (system/presence notices are transient
%% and deliberately not persisted). Returns the new message's id, so callers
%% can thread it through to live pushes for reactions to target.
save_message(ConvKey, From, Text, Kind, Private) ->
    save_message(ConvKey, From, Text, Kind, Private, []).

%% ReplyTo is [] (not a reply) or the id of the message being replied to.
%% Returns {Id, Ts} -- Ts (epoch milliseconds) is what lets a client render
%% "Date & time" on a message card and group threads by month, both
%% explicitly called for in the boss's spec; callers thread it through to
%% both the live push event and (via load_history/1) history.
save_message(ConvKey, From, Text, Kind, Private, ReplyTo) ->
    %% Id comes from Redis's own INCR, not erlang:unique_integer/1 -- the
    %% latter resets to 1 on every VM restart, but Redis data survives
    %% restarts, so a reused id would silently overwrite an old message's
    %% hash and leave a stale ZADD reference pointing a *different*
    %% conversation's history at it. INCR on a key that lives in Redis
    %% itself is unique and monotonic across restarts, matching how
    %% persistent this data actually is.
    IdBin = q_ok(["INCR", "next_msg_id"]),
    Id = list_to_integer(binary_to_list(IdBin)),
    Ts = erlang:system_time(millisecond),
    q_ok([
        "HSET", msg_key(Id),
        "conv_key", ConvKey,
        "from", From,
        "text", encrypt_text(Text),
        "kind", atom_to_list(Kind),
        "private", bool_to_flag(Private),
        "ts", integer_to_list(Ts),
        "reactions", encode_reactions([]),
        "preview", encode_preview([]),
        "reply_to", encode_reply_to(ReplyTo),
        "deleted", bool_to_flag(false)
    ]),
    q_ok(["ZADD", conv_zset_key(ConvKey), integer_to_list(Id), integer_to_list(Id)]),
    {Id, Ts}.

%% Last ?HISTORY_LIMIT messages for a conversation, oldest first, as plain
%% {Id, Ts, From, Text, Private, Reactions, Preview, ReplyTo, Deleted}
%% tuples -- callers never need to know these came from Redis hashes.
%% Ts is epoch milliseconds. Reactions is a [{User, Emoji}] list; Preview
%% is [] (none yet, or never will be) or {Url, Title, Description, Image};
%% ReplyTo is [] (not a reply) or the id of the original message.
load_history(ConvKey) ->
    IdBins = q_ok(["ZRANGE", conv_zset_key(ConvKey), integer_to_list(-?HISTORY_LIMIT), "-1"]),
    [read_message(list_to_integer(binary_to_list(B))) || B <- IdBins].

read_message(Id) ->
    Fields = q_ok(["HGETALL", msg_key(Id)]),
    Map = fields_to_map(Fields),
    {Id,
     list_to_integer(b2l(maps:get(<<"ts">>, Map))),
     b2l(maps:get(<<"from">>, Map)),
     decrypt_text(maps:get(<<"text">>, Map)),
     flag_to_bool(maps:get(<<"private">>, Map)),
     decode_reactions(maps:get(<<"reactions">>, Map)),
     decode_preview(maps:get(<<"preview">>, Map)),
     decode_reply_to(maps:get(<<"reply_to">>, Map)),
     flag_to_bool(maps:get(<<"deleted">>, Map))}.

%% Deletes a message for everyone -- only the original sender may delete
%% their own message (enforced here, not just client-side). The row stays
%% (so ids/history ordering and any reply-quotes pointing at it don't
%% dangle), text is cleared, and `deleted` is set so clients render "This
%% message was deleted" instead of the original content.
delete_message(MessageId, User) ->
    Key = msg_key(MessageId),
    case q_ok(["HGET", Key, "from"]) of
        undefined ->
            {error, not_found};
        FromBin ->
            case b2l(FromBin) of
                User ->
                    q_ok(["HSET", Key, "text", "", "deleted", bool_to_flag(true)]),
                    {ok, deleted};
                _ ->
                    {error, forbidden}
            end
    end.

%% Attaches a fetched link preview to an already-persisted message, so it
%% shows up in history without being re-fetched. Silently a no-op if the
%% message is somehow gone by the time the preview finishes fetching.
save_link_preview(MessageId, Preview) ->
    Key = msg_key(MessageId),
    case q_ok(["EXISTS", Key]) of
        <<"1">> ->
            q_ok(["HSET", Key, "preview", encode_preview(Preview)]),
            ok;
        <<"0">> ->
            ok
    end.

%% Toggle User's Emoji reaction on MessageId: adds it if absent, removes it
%% if User already reacted with that exact emoji. A user can hold several
%% *different* emoji reactions on the same message at once, Slack/Discord-
%% style rather than one-reaction-replaces-the-last like WhatsApp.
toggle_reaction(MessageId, User, Emoji) ->
    Key = msg_key(MessageId),
    case q_ok(["HGET", Key, "reactions"]) of
        undefined ->
            {error, not_found};
        Bin ->
            Reactions = decode_reactions(Bin),
            Pair = {User, Emoji},
            NewReactions = case lists:member(Pair, Reactions) of
                true -> lists:delete(Pair, Reactions);
                false -> [Pair | Reactions]
            end,
            q_ok(["HSET", Key, "reactions", encode_reactions(NewReactions)]),
            {ok, NewReactions}
    end.

%% ---- Groups ----------------------------------------------------------------

save_group(Name, Owner, Members) ->
    q_ok(["HSET", group_key(Name), "owner", Owner, "members", encode_members(Members)]),
    q_ok(["SADD", "groups", Name]),
    ok.

delete_group(Name) ->
    q_ok(["DEL", group_key(Name)]),
    q_ok(["SREM", "groups", Name]),
    ok.

%% All persisted groups as {Name, Owner, Members} tuples, for chat_groups
%% to repopulate its in-memory state from on startup.
load_groups() ->
    Names = q_ok(["SMEMBERS", "groups"]),
    [read_group(b2l(N)) || N <- Names].

read_group(Name) ->
    Fields = q_ok(["HGETALL", group_key(Name)]),
    Map = fields_to_map(Fields),
    Owner = b2l(maps:get(<<"owner">>, Map)),
    Members = decode_members(maps:get(<<"members">>, Map)),
    {Name, Owner, Members}.

%% ---- Profiles: E2EE public key, avatar, status ----------------------------
%% Each is its own HSET on the same key rather than a read-modify-write
%% cycle -- unlike the old Mnesia record, a Redis hash field set doesn't
%% disturb the others, so there's no risk of one call clobbering a field
%% another call set moments earlier.

set_pubkey(Username, Base64Key) ->
    q_ok(["HSET", profile_key(Username), "pubkey", Base64Key]),
    ok.

get_pubkey(Username) ->
    case q_ok(["HGET", profile_key(Username), "pubkey"]) of
        undefined -> undefined;
        Bin -> b2l(Bin)
    end.

set_avatar(Username, Url) ->
    q_ok(["HSET", profile_key(Username), "avatar_url", Url]),
    ok.

set_status(Username, Status) ->
    q_ok(["HSET", profile_key(Username), "status", Status]),
    ok.

%% {AvatarUrlOrUndefined, StatusOrUndefined} -- pubkey isn't included here,
%% it's fetched separately (get_pubkey/1) only when actually starting a DM.
get_profile(Username) ->
    Fields = q_ok(["HGETALL", profile_key(Username)]),
    Map = fields_to_map(Fields),
    {map_get_str(<<"avatar_url">>, Map), map_get_str(<<"status">>, Map)}.

map_get_str(Key, Map) ->
    case maps:find(Key, Map) of
        {ok, Bin} -> b2l(Bin);
        error -> undefined
    end.

%% ---- Redis call helper ------------------------------------------------

%% Every Redis call in this module goes through here instead of a bare
%% `{ok, _} = chat_redis:q(...)` match. On success this just unwraps to the
%% reply, same value every caller above already expected -- but on a Redis
%% failure (connection drop, OOM, wrong type, auth failure) it logs exactly
%% which command failed and why *before* crashing the calling process,
%% instead of that process dying with a bare, undiagnosable
%% `{badmatch, {error, Reason}}` and no indication of which of several
%% Redis calls in the same function caused it. The crash itself is
%% unchanged -- chat_room/chat_groups still die and get restarted by
%% chat_app_sup on a genuine Redis outage, same "let it crash" behavior as
%% before, just debuggable now (see docs/DEBUGGING.md).
q_ok(Command) ->
    case chat_redis:q(Command) of
        {ok, Reply} ->
            Reply;
        {error, Reason} ->
            ?LOG_ERROR("Redis command failed: ~p -- command: ~p", [Reason, Command]),
            error({redis_command_failed, Reason})
    end.

%% ---- At-rest message encryption ----------------------------------------
%% Message text is AES-256-GCM encrypted before it's written to Redis and
%% decrypted on the way back out, so anyone with raw Redis access -- a
%% leaked REDIS_PASSWORD, an RDB/AOF backup file, or just `redis-cli HGETALL
%% msg:42` (a normal debugging step per docs/DEBUGGING.md) -- can't read
%% chat history in the clear. This is at-rest encryption only, not end-to-
%% end: plaintext still passes through this Erlang process on every
%% send/read, exactly as before, and every WS event this app sends a client
%% carries plain, unencrypted text, exactly as documented in
%% docs/CHAT_PROTOCOL.md -- nothing about the wire protocol changes.
%%
%% Key comes from CHAT_ENCRYPTION_KEY: 32 raw bytes, base64-encoded (e.g.
%% `openssl rand -base64 32`). Unset (or invalid) means encryption is
%% disabled and text is stored exactly as it always was -- plaintext, with a
%% loud one-time startup warning, same "safe on a laptop, must be set on
%% anything else" pattern chat_redis's REDIS_PASSWORD check already uses.
%% Every stored value is tagged with a "v1:" prefix so a message written
%% while encryption was on (or off) is still readable correctly if the
%% setting later flips the other way -- decrypt_text/1 only attempts to
%% decrypt values carrying that prefix, and passes anything else through
%% unchanged.
-define(ENC_PREFIX, <<"v1:">>).

encrypt_text(Text) ->
    case encryption_key() of
        undefined ->
            Text;
        Key ->
            PlainBin = unicode:characters_to_binary(Text),
            Iv = crypto:strong_rand_bytes(12),
            {CipherBin, Tag} = crypto:crypto_one_time_aead(aes_256_gcm, Key, Iv, PlainBin, <<>>, true),
            Encoded = base64:encode(<<Iv/binary, Tag/binary, CipherBin/binary>>),
            <<?ENC_PREFIX/binary, Encoded/binary>>
    end.

decrypt_text(Bin) when is_binary(Bin) ->
    case Bin of
        <<"v1:", Encoded/binary>> ->
            decrypt_payload(Encoded);
        _ ->
            b2l(Bin)
    end.

decrypt_payload(Encoded) ->
    case encryption_key() of
        undefined ->
            %% Data was encrypted by a previous run that had a key set, but
            %% this run doesn't have one (removed, or a fresh env without
            %% it) -- can't decrypt, surface that plainly instead of
            %% crashing the whole history load over one row.
            ?LOG_WARNING("Encrypted message found but CHAT_ENCRYPTION_KEY is not set -- cannot decrypt."),
            "[unable to decrypt message]";
        Key ->
            try
                <<Iv:12/binary, Tag:16/binary, Cipher/binary>> = base64:decode(Encoded),
                case crypto:crypto_one_time_aead(aes_256_gcm, Key, Iv, Cipher, <<>>, Tag, false) of
                    error ->
                        ?LOG_WARNING("Failed to decrypt a stored message (bad tag/key mismatch)."),
                        "[unable to decrypt message]";
                    PlainBin ->
                        unicode:characters_to_list(PlainBin)
                end
            catch
                Class:Reason ->
                    ?LOG_WARNING("Failed to decrypt a stored message: ~p:~p", [Class, Reason]),
                    "[unable to decrypt message]"
            end
    end.

encryption_key() ->
    persistent_term:get({?MODULE, enc_key}, undefined).

load_encryption_key() ->
    case os:getenv("CHAT_ENCRYPTION_KEY") of
        false -> warn_no_encryption(), undefined;
        "" -> warn_no_encryption(), undefined;
        B64 ->
            case catch base64:decode(B64) of
                Bin when is_binary(Bin), byte_size(Bin) =:= 32 ->
                    ?LOG_INFO("chat_store: at-rest message encryption is ENABLED."),
                    Bin;
                _ ->
                    ?LOG_WARNING(
                        "CHAT_ENCRYPTION_KEY is set but is not valid base64-encoded 32 bytes "
                        "(try `openssl rand -base64 32`) -- message encryption is DISABLED, "
                        "storing plaintext."),
                    undefined
            end
    end.

warn_no_encryption() ->
    ?LOG_WARNING(
        "CHAT_ENCRYPTION_KEY is not set -- message text will be stored in Redis in "
        "PLAINTEXT. Set it (32 random bytes, base64-encoded, e.g. `openssl rand -base64 32`) "
        "before this points at anything other than a local dev Redis.").

%% ---- Encoding helpers ------------------------------------------------------

%% HGETALL replies as a flat [K1,V1,K2,V2,...] binary list -- pair it up
%% into a map once so every reader above can maps:get/maps:find by field
%% name instead of re-walking the list.
fields_to_map(Flat) -> maps:from_list(pair_up(Flat)).

pair_up([]) -> [];
pair_up([K, V | Rest]) -> [{K, V} | pair_up(Rest)].

b2l(Bin) -> binary_to_list(Bin).

bool_to_flag(true) -> "1";
bool_to_flag(false) -> "0".

flag_to_bool(<<"1">>) -> true;
flag_to_bool(_) -> false.

%% json:encode/1 treats a plain Erlang string as a list of integers, not a
%% JSON string -- everything textual has to become a binary before encoding,
%% or "alice" would come out as [97,108,105,99,101] instead of "alice".
encode_reactions(Reactions) ->
    json:encode([[list_to_binary(U), list_to_binary(E)] || {U, E} <- Reactions]).

decode_reactions(Bin) ->
    [{b2l(U), b2l(E)} || [U, E] <- json:decode(Bin)].

encode_preview([]) ->
    <<"null">>;
encode_preview({Url, Title, Description, Image}) ->
    json:encode([list_to_binary(Url), list_to_binary(Title),
                 list_to_binary(Description), list_to_binary(Image)]).

decode_preview(<<"null">>) ->
    [];
decode_preview(Bin) ->
    [Url, Title, Description, Image] = json:decode(Bin),
    {b2l(Url), b2l(Title), b2l(Description), b2l(Image)}.

%% ReplyTo of [] is stored as an empty string rather than a sentinel
%% integer -- ids from erlang:unique_integer([monotonic, positive]) are
%% always positive, but never assuming that leaves no int accidentally
%% double-booked as "not a reply."
encode_reply_to([]) ->
    "";
encode_reply_to(Id) when is_integer(Id) ->
    integer_to_list(Id).

decode_reply_to(<<>>) ->
    [];
decode_reply_to(Bin) ->
    list_to_integer(b2l(Bin)).

encode_members(Members) ->
    json:encode([list_to_binary(M) || M <- Members]).

decode_members(Bin) ->
    [b2l(M) || M <- json:decode(Bin)].
