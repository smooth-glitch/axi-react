%%% Small shared helpers for the sd_* (Sandesh) modules: type coercion,
%%% normalisation/validation of identifiers, random tokens, JSON in/out and
%%% sealing of stored secrets.
%%%
%%% Convention across every sd_* module: data is held as maps with binary
%%% keys and binary values (exactly what json:decode/1 returns), so a record
%%% read from Redis can go straight back out to a client with no reshaping.
%%% Strings ("lists") only appear at the boundary with the older chat_*
%%% modules, which use lists for usernames -- convert with s/1 and b/1.
-module(sd_util).
-export([b/1, s/1, now_ms/0, now_s/0,
         norm_user/1, norm_email/1, norm_mobile/1, mobile_digits/1,
         valid_username/1, valid_email/1, valid_mobile/1,
         rand_token/0, rand_digits/1, jenc/1, jdec/1,
         seal/1, unseal/1,
         get/2, get/3, put_if/3, is_true/1, take/2, uniq/1,
         mode/0, strict/0]).
-include_lib("kernel/include/logger.hrl").

%% ---- coercion --------------------------------------------------------------

b(B) when is_binary(B) -> B;
b(L) when is_list(L) -> unicode:characters_to_binary(L);
b(A) when is_atom(A) -> atom_to_binary(A, utf8);
b(I) when is_integer(I) -> integer_to_binary(I).

s(B) when is_binary(B) -> unicode:characters_to_list(B);
s(L) when is_list(L) -> L;
s(A) when is_atom(A) -> atom_to_list(A).

now_ms() -> erlang:system_time(millisecond).
now_s() -> erlang:system_time(second).

%% ---- identifiers -----------------------------------------------------------

norm_user(V) -> string:lowercase(string:trim(b(V))).

norm_email(V) -> string:lowercase(string:trim(b(V))).

%% Keeps a leading + and digits; drops spaces, dashes, dots and brackets.
norm_mobile(V) ->
    Raw = string:trim(b(V)),
    Cleaned = << <<C>> || <<C>> <= Raw, (C >= $0 andalso C =< $9) orelse C =:= $+ >>,
    Cleaned.

%% Digits only -- what the mobile index is keyed on, so "+91 98860 12345"
%% and "919886012345" find the same user.
mobile_digits(V) ->
    Raw = b(V),
    << <<C>> || <<C>> <= Raw, C >= $0, C =< $9 >>.

valid_username(U) ->
    is_binary(U) andalso re:run(U, "^[a-z0-9][a-z0-9._-]{1,23}$", [{capture, none}]) =:= match.

valid_email(E) ->
    is_binary(E) andalso byte_size(E) =< 254 andalso
        re:run(E, "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", [{capture, none}, unicode]) =:= match.

valid_mobile(M) ->
    is_binary(M) andalso re:run(M, "^\\+?[0-9]{7,15}$", [{capture, none}]) =:= match.

%% ---- randomness ------------------------------------------------------------

rand_token() ->
    base64:encode(crypto:strong_rand_bytes(32), #{mode => urlsafe, padding => false}).

rand_digits(N) ->
    << <<($0 + (B rem 10))>> || <<B>> <= crypto:strong_rand_bytes(N) >>.

%% ---- JSON ------------------------------------------------------------------

jenc(Term) -> iolist_to_binary(json:encode(Term)).

%% {ok, Term} | error -- never raises on bad client input.
jdec(Bin) ->
    try {ok, json:decode(iolist_to_binary(Bin))}
    catch _:_ -> error
    end.

%% ---- sealing secrets at rest -----------------------------------------------
%% Uses the same CHAT_ENCRYPTION_KEY the message store uses (AES-256-GCM).
%% Without a key the value is stored with a "plain:" marker and a warning is
%% logged once -- fine for local dev, not for anything real.

seal(Bin) when is_binary(Bin) ->
    case key() of
        undefined ->
            warn_once(),
            <<"plain:", Bin/binary>>;
        Key ->
            Iv = crypto:strong_rand_bytes(12),
            {Cipher, Tag} = crypto:crypto_one_time_aead(aes_256_gcm, Key, Iv, Bin, <<>>, true),
            <<"v1:", (base64:encode(<<Iv/binary, Tag/binary, Cipher/binary>>))/binary>>
    end.

unseal(<<"plain:", Rest/binary>>) -> {ok, Rest};
unseal(<<"v1:", B64/binary>>) ->
    case key() of
        undefined -> error;
        Key ->
            try
                <<Iv:12/binary, Tag:16/binary, Cipher/binary>> = base64:decode(B64),
                case crypto:crypto_one_time_aead(aes_256_gcm, Key, Iv, Cipher, <<>>, Tag, false) of
                    error -> error;
                    Plain -> {ok, Plain}
                end
            catch _:_ -> error
            end
    end;
unseal(_) -> error.

key() ->
    case os:getenv("CHAT_ENCRYPTION_KEY") of
        false -> undefined;
        "" -> undefined;
        B64 ->
            try base64:decode(B64) of
                K when byte_size(K) =:= 32 -> K;
                _ -> undefined
            catch _:_ -> undefined
            end
    end.

warn_once() ->
    case persistent_term:get({?MODULE, warned}, false) of
        true -> ok;
        false ->
            persistent_term:put({?MODULE, warned}, true),
            ?LOG_WARNING("sd_util: CHAT_ENCRYPTION_KEY is not set -- stored connection "
                         "credentials are NOT encrypted (dev only).")
    end.

%% ---- map helpers -----------------------------------------------------------

get(Key, Map) -> maps:get(Key, Map, undefined).
get(Key, Map, Default) ->
    case maps:get(Key, Map, undefined) of
        undefined -> Default;
        null -> Default;
        V -> V
    end.

%% Adds Key => Value to Map only when Value is not undefined.
put_if(_Key, undefined, Map) -> Map;
put_if(Key, Value, Map) -> Map#{Key => Value}.

is_true(true) -> true;
is_true(<<"true">>) -> true;
is_true(<<"1">>) -> true;
is_true(1) -> true;
is_true(_) -> false.

%% take(Keys, Map): sub-map with only Keys that exist.
take(Keys, Map) -> maps:with(Keys, Map).

uniq(List) -> lists:usort(List).

%% ---- mode ------------------------------------------------------------------
%% SANDESH_MODE=strict turns the spec's rules from "available" into
%% "enforced": sessions required at connect, host-only messaging, group
%% approval rules, admin console unlock. Anything else (the default) is
%% "open": every new capability exists, but nothing that worked before is
%% restricted -- so the current minimal app keeps working unchanged.

mode() ->
    case os:getenv("SANDESH_MODE") of
        "strict" -> strict;
        _ -> open
    end.

strict() -> mode() =:= strict.
