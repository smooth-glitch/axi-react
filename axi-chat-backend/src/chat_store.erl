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
%%% storage underneath moved.
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

-define(HISTORY_LIMIT, 50).

%% Connecting is chat_redis's job (started/supervised under chat_app_sup,
%% see chat_app_sup.erl) -- nothing to do here anymore. Kept as a no-op so
%% chat_app.erl's existing `ok = chat_store:init()` call doesn't need to
%% change.
init() ->
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
save_message(ConvKey, From, Text, Kind, Private, ReplyTo) ->
    Id = erlang:unique_integer([monotonic, positive]),
    Ts = erlang:system_time(millisecond),
    {ok, _} = chat_redis:q([
        "HSET", msg_key(Id),
        "conv_key", ConvKey,
        "from", From,
        "text", Text,
        "kind", atom_to_list(Kind),
        "private", bool_to_flag(Private),
        "ts", integer_to_list(Ts),
        "reactions", encode_reactions([]),
        "preview", encode_preview([]),
        "reply_to", encode_reply_to(ReplyTo),
        "deleted", bool_to_flag(false)
    ]),
    {ok, _} = chat_redis:q(["ZADD", conv_zset_key(ConvKey), integer_to_list(Id), integer_to_list(Id)]),
    Id.

%% Last ?HISTORY_LIMIT messages for a conversation, oldest first, as plain
%% {Id, From, Text, Private, Reactions, Preview, ReplyTo, Deleted} tuples --
%% callers never need to know these came from Redis hashes. Reactions is a
%% [{User, Emoji}] list; Preview is [] (none yet, or never will be) or
%% {Url, Title, Description, Image}; ReplyTo is [] (not a reply) or the id
%% of the original message.
load_history(ConvKey) ->
    {ok, IdBins} = chat_redis:q(["ZRANGE", conv_zset_key(ConvKey), integer_to_list(-?HISTORY_LIMIT), "-1"]),
    [read_message(list_to_integer(binary_to_list(B))) || B <- IdBins].

read_message(Id) ->
    {ok, Fields} = chat_redis:q(["HGETALL", msg_key(Id)]),
    Map = fields_to_map(Fields),
    {Id,
     b2l(maps:get(<<"from">>, Map)),
     b2l(maps:get(<<"text">>, Map)),
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
    case chat_redis:q(["HGET", Key, "from"]) of
        {ok, undefined} ->
            {error, not_found};
        {ok, FromBin} ->
            case b2l(FromBin) of
                User ->
                    {ok, _} = chat_redis:q(["HSET", Key, "text", "", "deleted", bool_to_flag(true)]),
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
    case chat_redis:q(["EXISTS", Key]) of
        {ok, <<"1">>} ->
            {ok, _} = chat_redis:q(["HSET", Key, "preview", encode_preview(Preview)]),
            ok;
        {ok, <<"0">>} ->
            ok
    end.

%% Toggle User's Emoji reaction on MessageId: adds it if absent, removes it
%% if User already reacted with that exact emoji. A user can hold several
%% *different* emoji reactions on the same message at once, Slack/Discord-
%% style rather than one-reaction-replaces-the-last like WhatsApp.
toggle_reaction(MessageId, User, Emoji) ->
    Key = msg_key(MessageId),
    case chat_redis:q(["HGET", Key, "reactions"]) of
        {ok, undefined} ->
            {error, not_found};
        {ok, Bin} ->
            Reactions = decode_reactions(Bin),
            Pair = {User, Emoji},
            NewReactions = case lists:member(Pair, Reactions) of
                true -> lists:delete(Pair, Reactions);
                false -> [Pair | Reactions]
            end,
            {ok, _} = chat_redis:q(["HSET", Key, "reactions", encode_reactions(NewReactions)]),
            {ok, NewReactions}
    end.

%% ---- Groups ----------------------------------------------------------------

save_group(Name, Owner, Members) ->
    {ok, _} = chat_redis:q(["HSET", group_key(Name), "owner", Owner, "members", encode_members(Members)]),
    {ok, _} = chat_redis:q(["SADD", "groups", Name]),
    ok.

delete_group(Name) ->
    {ok, _} = chat_redis:q(["DEL", group_key(Name)]),
    {ok, _} = chat_redis:q(["SREM", "groups", Name]),
    ok.

%% All persisted groups as {Name, Owner, Members} tuples, for chat_groups
%% to repopulate its in-memory state from on startup.
load_groups() ->
    {ok, Names} = chat_redis:q(["SMEMBERS", "groups"]),
    [read_group(b2l(N)) || N <- Names].

read_group(Name) ->
    {ok, Fields} = chat_redis:q(["HGETALL", group_key(Name)]),
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
    {ok, _} = chat_redis:q(["HSET", profile_key(Username), "pubkey", Base64Key]),
    ok.

get_pubkey(Username) ->
    case chat_redis:q(["HGET", profile_key(Username), "pubkey"]) of
        {ok, undefined} -> undefined;
        {ok, Bin} -> b2l(Bin)
    end.

set_avatar(Username, Url) ->
    {ok, _} = chat_redis:q(["HSET", profile_key(Username), "avatar_url", Url]),
    ok.

set_status(Username, Status) ->
    {ok, _} = chat_redis:q(["HSET", profile_key(Username), "status", Status]),
    ok.

%% {AvatarUrlOrUndefined, StatusOrUndefined} -- pubkey isn't included here,
%% it's fetched separately (get_pubkey/1) only when actually starting a DM.
get_profile(Username) ->
    {ok, Fields} = chat_redis:q(["HGETALL", profile_key(Username)]),
    Map = fields_to_map(Fields),
    {map_get_str(<<"avatar_url">>, Map), map_get_str(<<"status">>, Map)}.

map_get_str(Key, Map) ->
    case maps:find(Key, Map) of
        {ok, Bin} -> b2l(Bin);
        error -> undefined
    end.

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
