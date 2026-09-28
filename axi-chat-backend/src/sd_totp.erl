%%% Time-based One-Time Password two-factor authentication (RFC 6238 / RFC
%%% 4226), the free/scalable alternative to the SMS/email OTP in sd_auth:
%%% the code is computed locally by the user's authenticator app (Google
%%% Authenticator, Authy, 1Password, ...) from a shared secret, so there is
%%% no delivery channel, no per-message cost, and no dependency the backend
%%% has to scale (verification is a couple of HMAC-SHA1 computations and one
%%% Redis round trip).
%%%
%%% TOTP is mandatory for every account (sd_auth's login/2 requires it) --
%%% there is no email/SMS OTP fallback any more. Enrollment happens inline,
%%% the first time an account with no confirmed secret yet passes its
%%% password check at login:
%%%   login_setup/2    issues a fresh secret (unconfirmed) -- or hands back
%%%                     the one already pending, so re-trying login before
%%%                     finishing enrollment doesn't invalidate a QR code
%%%                     the user already scanned.
%%%   login_verify_setup/2   requires one correct code before turning 2FA on,
%%%                     so a user can never lock themselves out with a
%%%                     secret their app never actually scanned right, then
%%%                     issues one-time recovery codes for a lost device.
%%% Both are called from sd_auth, keyed by username -- there's no session
%%% yet at that point (that's the whole point: finishing enrollment IS what
%%% produces the first session).
%%%
%%% Once enrolled, login stays password-only for ?FRESH_MS (see sd_auth's
%%% totp_fresh/1) and demands a fresh code again after that -- status/1,
%%% disable/3 and regenerate_recovery/3 (Bearer, for an already-signed-in
%%% user managing their own 2FA) are unaffected by that window.
%%%
%%% Secrets are stored encrypted at rest (AES-256-GCM) under sd:totp, a
%%% separate hash from both sd:cred and sd:users, mirroring how sd_auth
%%% keeps passwords out of the profile record.
-module(sd_totp).
-export([login_setup/2, login_verify_setup/2, disable/3, status/1, enabled/1,
         verify_login/2, consume_recovery/2, regenerate_recovery/3]).
-include_lib("kernel/include/logger.hrl").

-define(TOTP, "sd:totp").
-define(SECRET_BYTES, 20).      %% 160-bit shared secret (RFC 4226 recommends >= 128 bit)
-define(PERIOD, 30).            %% seconds per step, the standard authenticator-app default
-define(WINDOW, 1).             %% accept 1 step of clock drift either side
-define(RECOVERY_COUNT, 10).
-define(SETUP_RATE_MAX, 5).
-define(SETUP_RATE_WINDOW, 3600).
-define(VERIFY_RATE_MAX, 10).
-define(VERIFY_RATE_WINDOW, 300).

%% =============================================================================
%% Enrollment
%% =============================================================================

%% Called from sd_auth:login/2 once the password has already checked out
%% for an account with no confirmed TOTP secret yet. Reuses a still-pending
%% (unconfirmed) secret if one already exists, rather than minting a new one
%% on every retry -- otherwise a user who scanned the QR but hasn't typed
%% the code yet would see it change out from under them on a second attempt.
login_setup(Username, User) ->
    case sd_db:rate(["totp:setup:", sd_util:s(Username)], ?SETUP_RATE_MAX, ?SETUP_RATE_WINDOW) of
        limited -> {error, rate_limited, <<"Too many setup attempts; try again later.">>};
        ok ->
            {Secret, Doc} = case sd_db:hget_json(?TOTP, key(Username)) of
                #{<<"enabled">> := false, <<"encSecret">> := EncB64} = Existing ->
                    case decrypt_secret(EncB64) of
                        error -> fresh_pending_doc();
                        S -> {S, Existing}
                    end;
                _ -> fresh_pending_doc()
            end,
            sd_db:hset_json(?TOTP, key(Username), Doc),
            B32 = b32_encode(Secret),
            {ok, #{<<"secret">> => B32,
                   <<"otpauthUri">> => otpauth_uri(account_name(User, Username), B32),
                   <<"issuer">> => issuer(),
                   <<"digits">> => 6,
                   <<"periodSec">> => ?PERIOD,
                   <<"recommendedApps">> => recommended_apps()}}
    end.

%% Any RFC 6238 app works (the otpauthUri above is the actual integration
%% point -- this is purely "which app to point a user at" for onboarding).
%% Google/Microsoft Authenticator are the two this org endorses: both free,
%% both support plain TOTP accounts (Microsoft's is separate from its
%% Entra ID/Azure AD "work account" push flow, which this does NOT use),
%% and Google Authenticator in particular only reliably supports SHA1/6
%% digits/30s -- exactly the parameters used above -- so this pairing is
%% also why those parameters were chosen rather than a stronger hash.
recommended_apps() ->
    [#{<<"name">> => <<"Google Authenticator">>,
       <<"ios">> => <<"https://apps.apple.com/app/google-authenticator/id388497605">>,
       <<"android">> => <<"https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2">>},
     #{<<"name">> => <<"Microsoft Authenticator">>,
       <<"ios">> => <<"https://apps.apple.com/app/microsoft-authenticator/id983156458">>,
       <<"android">> => <<"https://play.google.com/store/apps/details?id=com.azure.authenticator">>}].

fresh_pending_doc() ->
    Secret = crypto:strong_rand_bytes(?SECRET_BYTES),
    {Secret, #{<<"encSecret">> => encrypt_secret(Secret),
               <<"enabled">> => false,
               <<"createdTs">> => sd_util:now_ms(),
               <<"lastCounter">> => 0,
               <<"recovery">> => []}}.

%% Confirms the app actually produces valid codes before turning 2FA on, and
%% hands back the one-time recovery codes (shown to the user exactly once).
%% Called from sd_auth:login/2 as the second half of first-time enrollment.
login_verify_setup(Username, Code) ->
    case sd_db:rate(["totp:setupv:", sd_util:s(Username)], ?VERIFY_RATE_MAX, ?VERIFY_RATE_WINDOW) of
        limited -> {error, rate_limited, <<"Too many attempts; try again later.">>};
        ok ->
            case sd_db:hget_json(?TOTP, key(Username)) of
                undefined -> {error, not_found, <<"No enrollment in progress -- call login without totp first.">>};
                #{<<"enabled">> := true} -> {error, already_enabled, <<"Two-factor is already on for this account.">>};
                Doc ->
                    case verify_code_against(Doc, Code) of
                        {ok, Counter} ->
                            {Plain, Hashed} = gen_recovery_codes(),
                            NewDoc = Doc#{<<"enabled">> => true,
                                          <<"confirmedTs">> => sd_util:now_ms(),
                                          <<"lastCounter">> => Counter,
                                          <<"recovery">> => Hashed},
                            sd_db:hset_json(?TOTP, key(Username), NewDoc),
                            {ok, Plain};
                        no_match ->
                            {error, otp_invalid, <<"That code is not correct.">>}
                    end
            end
    end.

%% Requires the current password plus a valid TOTP or recovery code -- the
%% same "prove you still are this person" bar as changing a password.
%% Rate-limited like every other code check here: a stolen session token
%% must not turn into unlimited guesses at the 6-digit code or the recovery
%% codes.
disable(Token, Password, Code) ->
    with_session(Token, fun(_User, Username) ->
        case sd_db:rate(["totp:manage:", sd_util:s(Username)], ?VERIFY_RATE_MAX, ?VERIFY_RATE_WINDOW) of
            limited -> {error, rate_limited, <<"Too many attempts; try again later.">>};
            ok ->
                case sd_auth:password_ok(Username, Password) of
                    false -> {error, invalid_credentials, <<"Wrong password.">>};
                    true ->
                        case sd_db:hget_json(?TOTP, key(Username)) of
                            #{<<"enabled">> := true} = Doc ->
                                case code_or_recovery_ok(Doc, Username, Code) of
                                    true -> sd_db:hdel(?TOTP, key(Username)), {ok, #{<<"disabled">> => true}};
                                    false -> {error, otp_invalid, <<"That code is not correct.">>}
                                end;
                            _ -> {error, not_found, <<"Two-factor is not enabled for this account.">>}
                        end
                end
        end
    end).

%% Invalidates all existing recovery codes and issues a fresh set. Same bar
%% (and same rate limit) as disable/3: password + a currently-valid code.
regenerate_recovery(Token, Password, Code) ->
    with_session(Token, fun(_User, Username) ->
        case sd_db:rate(["totp:manage:", sd_util:s(Username)], ?VERIFY_RATE_MAX, ?VERIFY_RATE_WINDOW) of
            limited -> {error, rate_limited, <<"Too many attempts; try again later.">>};
            ok ->
                case sd_auth:password_ok(Username, Password) of
                    false -> {error, invalid_credentials, <<"Wrong password.">>};
                    true ->
                        case sd_db:hget_json(?TOTP, key(Username)) of
                            #{<<"enabled">> := true} = Doc ->
                                case code_or_recovery_ok(Doc, Username, Code) of
                                    true ->
                                        {Plain, Hashed} = gen_recovery_codes(),
                                        Fresh = sd_db:hget_json(?TOTP, key(Username)),
                                        sd_db:hset_json(?TOTP, key(Username), Fresh#{<<"recovery">> => Hashed}),
                                        {ok, #{<<"recoveryCodes">> => Plain}};
                                    false -> {error, otp_invalid, <<"That code is not correct.">>}
                                end;
                            _ -> {error, not_found, <<"Two-factor is not enabled for this account.">>}
                        end
                end
        end
    end).

status(Token) ->
    with_session(Token, fun(_User, Username) -> {ok, #{<<"enabled">> => enabled(Username)}} end).

enabled(Username) ->
    case sd_db:hget_json(?TOTP, key(Username)) of
        #{<<"enabled">> := true} -> true;
        _ -> false
    end.

%% =============================================================================
%% Login-time verification (no session yet -- called from sd_auth:login/2)
%% =============================================================================

verify_login(Username, Code) when is_binary(Code) ->
    case sd_db:rate(["totp:v:", sd_util:s(Username)], ?VERIFY_RATE_MAX, ?VERIFY_RATE_WINDOW) of
        limited -> {error, rate_limited, <<"Too many code attempts; try again later.">>};
        ok ->
            case sd_db:hget_json(?TOTP, key(Username)) of
                #{<<"enabled">> := true} = Doc ->
                    case verify_code_against(Doc, Code) of
                        {ok, Counter} ->
                            sd_db:hset_json(?TOTP, key(Username), Doc#{<<"lastCounter">> => Counter}),
                            ok;
                        no_match -> {error, otp_invalid, <<"That code is not correct.">>}
                    end;
                _ -> {error, otp_invalid, <<"Two-factor is not enabled for this account.">>}
            end
    end;
verify_login(_, _) -> {error, otp_invalid, <<"totp is required.">>}.

consume_recovery(Username, RawCode) when is_binary(RawCode) ->
    case sd_db:rate(["totp:rec:", sd_util:s(Username)], ?VERIFY_RATE_MAX, ?VERIFY_RATE_WINDOW) of
        limited -> {error, rate_limited, <<"Too many attempts; try again later.">>};
        ok ->
            case sd_db:hget_json(?TOTP, key(Username)) of
                #{<<"enabled">> := true, <<"recovery">> := Codes} = Doc ->
                    H = hash_recovery(RawCode),
                    case find_unused(H, Codes) of
                        {ok, Idx} ->
                            sd_db:hset_json(?TOTP, key(Username), Doc#{<<"recovery">> => mark_used(Idx, Codes)}),
                            ok;
                        not_found -> {error, otp_invalid, <<"That recovery code is not valid.">>}
                    end;
                _ -> {error, otp_invalid, <<"Two-factor is not enabled for this account.">>}
            end
    end;
consume_recovery(_, _) -> {error, otp_invalid, <<"recoveryCode is required.">>}.

%% Used only by disable/3 and regenerate_recovery/3, which already hold a
%% session -- no separate rate bucket needed on top of the password check.
code_or_recovery_ok(Doc, Username, Code) when is_binary(Code), Code =/= <<>> ->
    case verify_code_against(Doc, Code) of
        {ok, _} -> true;
        no_match ->
            H = hash_recovery(Code),
            case find_unused(H, maps:get(<<"recovery">>, Doc, [])) of
                {ok, _} -> consume_recovery(Username, Code) =:= ok;
                not_found -> false
            end
    end;
code_or_recovery_ok(_, _, _) -> false.

%% =============================================================================
%% RFC 6238 / RFC 4226
%% =============================================================================

hotp(SecretRaw, Counter) ->
    Msg = <<Counter:64/big-unsigned-integer>>,
    Hmac = crypto:mac(hmac, sha, SecretRaw, Msg),
    Offset = binary:last(Hmac) band 16#0F,
    <<_:Offset/binary, P:4/binary, _/binary>> = Hmac,
    <<Code0:32/big-unsigned-integer>> = P,
    (Code0 band 16#7fffffff) rem 1000000.

fmt6(Code) -> iolist_to_binary(io_lib:format("~6..0B", [Code])).

%% Tries the current step and +/-?WINDOW steps (clock drift), accepting only
%% a counter strictly newer than the account's last accepted one -- so the
%% same code can never be replayed within its own validity window.
verify_code_against(#{<<"encSecret">> := EncB64} = Doc, Code) when is_binary(Code) ->
    Trimmed = string:trim(Code),
    case byte_size(Trimmed) =:= 6 andalso is_digits(Trimmed) of
        false -> no_match;
        true ->
            case decrypt_secret(EncB64) of
                error -> no_match;
                Secret ->
                    LastCounter = maps:get(<<"lastCounter">>, Doc, 0),
                    Now = sd_util:now_s(),
                    Base = Now div ?PERIOD,
                    Candidates = [Base + D || D <- lists:seq(-?WINDOW, ?WINDOW), Base + D > LastCounter],
                    case [C || C <- Candidates, fmt6(hotp(Secret, C)) =:= Trimmed] of
                        [] -> no_match;
                        Matches -> {ok, lists:max(Matches)}
                    end
            end
    end;
verify_code_against(_, _) -> no_match.

is_digits(Bin) -> lists:all(fun(C) -> C >= $0 andalso C =< $9 end, binary_to_list(Bin)).

%% =============================================================================
%% Recovery codes
%% =============================================================================

%% Unambiguous alphabet (no 0/O/1/I) -- these get typed by hand.
recovery_alphabet() -> <<"ABCDEFGHJKMNPQRSTUVWXYZ23456789">>.

gen_recovery_codes() ->
    Plain = [gen_recovery_code() || _ <- lists:seq(1, ?RECOVERY_COUNT)],
    Hashed = [#{<<"hash">> => hash_recovery(C), <<"used">> => false} || C <- Plain],
    {Plain, Hashed}.

gen_recovery_code() ->
    Alphabet = recovery_alphabet(),
    Len = byte_size(Alphabet),
    Pick = fun() -> binary:at(Alphabet, rand:uniform(Len) - 1) end,
    Half = fun() -> << <<(Pick())>> || _ <- lists:seq(1, 5) >> end,
    <<(Half())/binary, "-", (Half())/binary>>.

hash_recovery(Code) ->
    base64:encode(crypto:hash(sha256, normalize_recovery(Code))).

normalize_recovery(Code) -> sd_util:b(string:uppercase(string:trim(sd_util:s(Code)))).

find_unused(H, Codes) -> find_unused(H, Codes, 0).
find_unused(_, [], _) -> not_found;
find_unused(H, [#{<<"hash">> := H, <<"used">> := false} | _], Idx) -> {ok, Idx};
find_unused(H, [_ | Rest], Idx) -> find_unused(H, Rest, Idx + 1).

mark_used(Idx, Codes) ->
    {Before, [C | After]} = lists:split(Idx, Codes),
    Before ++ [C#{<<"used">> => true}] ++ After.

%% =============================================================================
%% otpauth:// URI (what a QR-code library on the frontend renders)
%% =============================================================================

issuer() ->
    case os:getenv("SANDESH_TOTP_ISSUER") of
        false -> <<"Sandesh">>;
        "" -> <<"Sandesh">>;
        S -> sd_util:b(S)
    end.

account_name(User, Username) ->
    case sd_util:get(<<"email">>, User) of
        E when is_binary(E), E =/= <<>> -> E;
        _ -> Username
    end.

otpauth_uri(AccountName, SecretB32) ->
    Issuer = issuer(),
    Label = quote(<<Issuer/binary, ":", AccountName/binary>>),
    Qs = ["secret=", sd_util:s(SecretB32),
          "&issuer=", sd_util:s(quote(Issuer)),
          "&algorithm=SHA1&digits=6&period=", integer_to_list(?PERIOD)],
    sd_util:b(["otpauth://totp/", sd_util:s(Label), "?", Qs]).

quote(Bin) -> uri_string:quote(Bin).

%% =============================================================================
%% Base32 (RFC 4648), no lowercase, padded -- what authenticator apps expect
%% for manual entry.
%% =============================================================================

b32_encode(Bin) ->
    Bits = bit_size(Bin),
    Pad = (5 - Bits rem 5) rem 5,
    Padded = <<Bin/bitstring, 0:Pad>>,
    Chars = b32_chunks(Padded),
    Str = list_to_binary(Chars),
    PadChars = (8 - byte_size(Str) rem 8) rem 8,
    <<Str/binary, (binary:copy(<<"=">>, PadChars))/binary>>.

b32_chunks(<<>>) -> [];
b32_chunks(<<C:5, Rest/bitstring>>) -> [b32_char(C) | b32_chunks(Rest)].

b32_char(N) -> binary:at(<<"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567">>, N).

%% =============================================================================
%% Secrets at rest: AES-256-GCM. Key from SANDESH_TOTP_ENC_KEY (base64, 32
%% raw bytes) in real deployments; a fixed, publicly-known dev key otherwise
%% (loudly warned about in strict mode, same pattern as sd_notify's dev
%% delivery channels).
%% =============================================================================

encrypt_secret(Raw) ->
    Key = enc_key(),
    Iv = crypto:strong_rand_bytes(12),
    {Cipher, Tag} = crypto:crypto_one_time_aead(aes_256_gcm, Key, Iv, Raw, <<>>, true),
    base64:encode(<<Iv/binary, Tag/binary, Cipher/binary>>).

decrypt_secret(B64) ->
    case catch base64:decode(B64) of
        <<Iv:12/binary, Tag:16/binary, Cipher/binary>> ->
            Key = enc_key(),
            case crypto:crypto_one_time_aead(aes_256_gcm, Key, Iv, Cipher, <<>>, Tag, false) of
                error -> error;
                Raw -> Raw
            end;
        _ -> error
    end.

enc_key() ->
    case os:getenv("SANDESH_TOTP_ENC_KEY") of
        false -> dev_key();
        "" -> dev_key();
        B64 ->
            case catch base64:decode(B64) of
                K when is_binary(K), byte_size(K) =:= 32 -> K;
                _ -> dev_key()
            end
    end.

dev_key() ->
    warn_dev_key(),
    crypto:hash(sha256, <<"sandesh-totp-dev-key-DO-NOT-USE-IN-PRODUCTION">>).

warn_dev_key() ->
    case sd_util:strict() andalso persistent_term:get({?MODULE, warned}, false) =:= false of
        true ->
            persistent_term:put({?MODULE, warned}, true),
            ?LOG_WARNING(
                "SANDESH_MODE=strict but SANDESH_TOTP_ENC_KEY is not set: two-factor secrets are "
                "encrypted with a fixed, publicly-known dev key. Set SANDESH_TOTP_ENC_KEY (32 random "
                "bytes, base64) before real use, e.g. `openssl rand -base64 32`.");
        false -> ok
    end.

%% =============================================================================

key(Username) -> sd_util:norm_user(Username).

with_session(Token, Fun) ->
    case sd_auth:session(Token) of
        {ok, User, _} -> Fun(User, maps:get(<<"username">>, User));
        error -> {error, unauthenticated, <<"Sign in first.">>}
    end.
