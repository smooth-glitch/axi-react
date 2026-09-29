%%% Sandesh authentication: first-run setup, OTP, passwords, sessions.
%%%
%%% Everything here is reached over plain HTTP (see sd_http) because it
%%% happens *before* the WebSocket exists. The result of a login is a session
%%% token; the frontend passes that token as the `token` field of the
%%% WebSocket handshake (and any `armSessionId` -- it is not interpreted).
%%%
%%% Rules taken from the spec:
%%%  - First run: org name, user name, email, mobile are accepted, an OTP is
%%%    sent to validate them, and that first user becomes the administrator.
%%%    (Optional guard: set SANDESH_SETUP_TOKEN so only someone who knows it
%%%    can claim the first-run slot on a reachable server.)
%%%  - Login by email, mobile number or username.
%%%  - A PASSWORD is required only for admin accounts -- everyone else signs
%%%    in with just their identifier plus (when due) a second-factor code.
%%%  - Two-factor is mandatory for every account (admin included), but is
%%%    only demanded again from a DEVICE this account hasn't verified from
%%%    in the last 14 days (see "Device trust" below) -- not on every login,
%%%    and not just once globally either: a brand-new device always asks,
%%%    even if this account verified minutes ago somewhere else.
%%%  - Second factor is either an authenticator-app TOTP code or an emailed
%%%    OTP code, chosen once at enrollment (see sd_totp).
%%%  - Admin default password is "Sandesh" + username, must be changed on
%%%    first login, and must be changed again every 30 days.
%%%  - The admin console needs password AND a delivered OTP (admin_unlock/3).
%%%
%%% Device trust: every login (successful password check, if one applies,
%%% plus a fresh-enough second factor) trusts the calling DEVICE for
%%% ?DEVICE_TRUST_TTL, sliding forward on each subsequent login from that
%%% same device. A device is identified by the login body's `deviceId` (a
%%% client-generated, per-install opaque string -- the intended long-term
%%% mechanism) when present, else by a coarse fallback fingerprint derived
%%% from the User-Agent header, so a client that hasn't been updated to send
%%% `deviceId` yet still gets *a* notion of "device" rather than none. A
%%% request with neither is never treated as a returning device (it always
%%% demands a fresh code) -- that fails closed, not open.
%%%
%%% Abuse controls: OTP resend cooldown, max wrong OTP attempts, per-account
%%% lockout after repeated failed logins, per-IP request limits.
-module(sd_auth).
-export([setup_start/2, setup_verify/2,
         login/3,
         session/1, session_user/1, session_alive/1, session_expires/1, session_ttl/0,
         totp_due_for_token/1, logout/1,
         change_password/3, set_initial_password/2, password_state/1, check_password_policy/2,
         admin_unlock_start/1, admin_unlock/3, admin_unlocked/1,
         totp_fresh/1, password_ok/2, issue_default_password/1,
         send_otp/3, check_otp/3]).
-include_lib("kernel/include/logger.hrl").

-define(OTP_TTL, 300).
-define(OTP_COOLDOWN, 30).
-define(OTP_MAX_ATTEMPTS, 5).
%% Default session lifetime: two weeks, HARD (not sliding) -- the spec's
%% "ask the user to login again every two weeks". Overridable for tests/ops.
-define(SESSION_TTL_DEFAULT, 14 * 24 * 3600).
%% Once a login proves a fresh TOTP code, password-only logins are accepted
%% again for this long before a code is demanded once more. Kept as an
%% account-wide informational signal (see totp_fresh/1); the actual login
%% gate is the per-DEVICE trust store below.
-define(TOTP_FRESH_MS, 14 * 24 * 3600 * 1000).
%% How long a single device stays trusted (no code demanded) after it last
%% proved a fresh second factor. Overridable for tests via
%% SANDESH_DEVICE_TRUST_SEC, same pattern as SANDESH_TOTP_FRESH_SEC.
-define(DEVICE_TRUST_TTL, 14 * 24 * 3600).
-define(ADMIN_PW_MAX_AGE_MS, 30 * 24 * 3600 * 1000).
-define(UNLOCK_TTL, 1800).
-define(LOGIN_FAIL_MAX, 5).
-define(LOGIN_FAIL_WINDOW, 900).
-define(PW_ITER, 100000).

%% =============================================================================
%% First-run setup
%% =============================================================================

setup_start(Body, Ip) ->
    case sd_org:setup_done() of
        true -> {error, already_setup, <<"This organisation has already been set up.">>};
        false ->
            case setup_token_ok(Body) of
                false -> {error, forbidden, <<"A valid setupToken is required.">>};
                true ->
                    case sd_db:rate(["setup:", Ip], 10, 3600) of
                        limited -> {error, rate_limited, <<"Too many attempts; try later.">>};
                        ok -> do_setup_start(Body)
                    end
            end
    end.

do_setup_start(Body) ->
    Org = trim(sd_util:get(<<"org">>, Body)),
    Attrs = #{<<"name">> => sd_util:get(<<"name">>, Body, sd_util:get(<<"username">>, Body, <<>>)),
              <<"email">> => sd_util:get(<<"email">>, Body, <<>>),
              <<"mobile">> => sd_util:get(<<"mobile">>, Body, <<>>),
              <<"username">> => sd_util:get(<<"username">>, Body)},
    case {Org, sd_users:create_dry(Attrs)} of
        {<<>>, _} -> {error, invalid, <<"org (organisation name) is required.">>};
        {_, {error, _, _} = Err} -> Err;
        {_, {ok, Profile}} ->
            Pending = Profile#{<<"org">> => Org},
            sd_db:setex_json("sd:setup:pending", 900, Pending),
            Result = send_otp(setup, <<"first">>, Profile),
            {ok, Result#{<<"username">> => maps:get(<<"username">>, Profile)}}
    end.

setup_verify(Body, _Ip) ->
    case sd_db:get_json("sd:setup:pending") of
        undefined ->
            {error, no_pending_setup, <<"Start setup first (POST /api/sd/setup/start).">>};
        Pending ->
            case check_otp(setup, <<"first">>, sd_util:get(<<"otp">>, Body, <<>>)) of
                ok -> finish_setup(Pending);
                {error, _, _} = Err -> Err
            end
    end.

finish_setup(Pending) ->
    Org = maps:get(<<"org">>, Pending),
    Username = maps:get(<<"username">>, Pending),
    case sd_org:finish_setup(Org, Username) of
        {error, already_setup} ->
            {error, already_setup, <<"This organisation has already been set up.">>};
        ok ->
            Attrs = maps:with([<<"name">>, <<"email">>, <<"mobile">>, <<"username">>], Pending),
            case sd_users:create(Attrs, #{mode => setup, role => <<"admin">>,
                                          status => <<"active">>, actor => Username}) of
                {ok, User} ->
                    sd_db:del("sd:setup:pending"),
                    store_password(Username, default_password(Username), true),
                    %% No session yet -- TOTP enrollment (mandatory for every
                    %% account, including this one) is what finishing login
                    %% produces. POST /api/sd/login with this default
                    %% password (+ a code, once scanned) completes it.
                    {ok, Setup} = sd_totp:login_setup(Username, User, <<"totp">>),
                    {ok, Setup#{<<"org">> => Org, <<"user">> => User,
                                <<"totpSetupRequired">> => true,
                                <<"defaultPassword">> => default_password(Username)}};
                {error, _, _} = Err ->
                    %% Roll the claim back so setup can be retried.
                    sd_db:hdel("sd:org", "setup_done"),
                    Err
            end
    end.

setup_token_ok(Body) ->
    case os:getenv("SANDESH_SETUP_TOKEN") of
        false -> true;
        "" -> true;
        Expected ->
            Given = sd_util:get(<<"setupToken">>, Body, <<>>),
            is_binary(Given) andalso byte_size(Given) =:= length(Expected) andalso
                crypto:hash_equals(Given, list_to_binary(Expected))
    end.

%% "By default the password will be 'Sandesh'+UserName."
default_password(Username) -> <<"Sandesh", Username/binary>>.

%% =============================================================================
%% OTP -- delivered (email/SMS) codes. Used directly by bootstrap setup and
%% the admin-console unlock gate; also reused (exported) by sd_totp and by
%% this module's own email-2FA steps, keyed by Purpose so all these callers
%% share one cooldown/attempt-limit implementation without stepping on each
%% other's codes: `setup`, `unlock`, `mfa_setup` (email 2FA enrollment),
%% `mfa_login` (email 2FA at login from an untrusted device), `mfa_manage`
%% (email 2FA disable/regenerate-recovery, Bearer).
%% =============================================================================

status_gate(#{<<"status">> := <<"active">>}) -> ok;
status_gate(#{<<"status">> := <<"pending">>}) ->
    {error, pending_approval, <<"Your registration is waiting for your host's approval.">>};
status_gate(#{<<"status">> := <<"rejected">>}) ->
    {error, rejected, <<"Your registration was not approved.">>};
status_gate(_) ->
    {error, account_inactive, <<"This account is deactivated. Contact your administrator.">>}.

%% Issues an OTP for Purpose+Key and delivers it to whatever contact points
%% Target (a user map) has. Returns the map for the API response.
send_otp(Purpose, Key, Target) ->
    case claim_cooldown(Purpose, Key) of
        {wait, Secs} ->
            #{<<"sent">> => false, <<"retryAfter">> => Secs};
        go ->
            Code = sd_notify:otp_code(),
            Salt = crypto:strong_rand_bytes(16),
            sd_db:setex_json(otp_key(Purpose, Key), ?OTP_TTL,
                             #{<<"salt">> => base64:encode(Salt), <<"hash">> => otp_hash(Salt, Code)}),
            sd_db:del(otp_attempts_key(Purpose, Key)),
            sd_notify:deliver(otp, sd_util:take([<<"name">>, <<"email">>, <<"mobile">>], Target),
                              #{<<"code">> => Code,
                                <<"text">> => <<"Your Sandesh verification code (valid 5 minutes):">>}),
            Base = #{<<"sent">> => true, <<"expiresInSec">> => ?OTP_TTL},
            case sd_notify:dev_echo() of
                true -> Base#{<<"devOtp">> => Code};
                false -> Base
            end
    end.

%% One OTP per ?OTP_COOLDOWN seconds per purpose+account, so the endpoint
%% can't be used to spam someone's phone. SANDESH_OTP_COOLDOWN_SEC=0
%% disables it (automated tests); the default is 30.
claim_cooldown(Purpose, Key) ->
    Secs = case os:getenv("SANDESH_OTP_COOLDOWN_SEC") of
               false -> ?OTP_COOLDOWN;
               S -> case string:to_integer(S) of {N, []} when N >= 0 -> N; _ -> ?OTP_COOLDOWN end
           end,
    CdKey = ["sd:otpcd:", atom_to_list(Purpose), ":", sd_util:s(Key)],
    case Secs of
        0 -> go;
        _ ->
            case sd_db:q(["SET", CdKey, "1", "NX", "EX", integer_to_list(Secs)]) of
                undefined -> {wait, sd_db:ttl(CdKey)};
                _ -> go
            end
    end.

check_otp(Purpose, Key, Given) when is_binary(Given) ->
    case sd_db:get_json(otp_key(Purpose, Key)) of
        undefined -> {error, otp_invalid, <<"That code has expired. Request a new one.">>};
        #{<<"salt">> := Salt64, <<"hash">> := Hash} ->
            case sd_db:incr(otp_attempts_key(Purpose, Key)) of
                N when N > ?OTP_MAX_ATTEMPTS ->
                    sd_db:del(otp_key(Purpose, Key)),
                    {error, otp_locked, <<"Too many wrong codes. Request a new one.">>};
                N ->
                    N =:= 1 andalso sd_db:expire(otp_attempts_key(Purpose, Key), ?OTP_TTL),
                    Salt = base64:decode(Salt64),
                    Candidate = otp_hash(Salt, trim(Given)),
                    case byte_size(Candidate) =:= byte_size(Hash) andalso
                         crypto:hash_equals(Candidate, Hash) of
                        true ->
                            sd_db:del(otp_key(Purpose, Key)),
                            sd_db:del(otp_attempts_key(Purpose, Key)),
                            ok;
                        false ->
                            {error, otp_invalid, <<"That code is not correct.">>}
                    end
            end;
        _ -> {error, otp_invalid, <<"That code has expired. Request a new one.">>}
    end;
check_otp(_, _, _) ->
    {error, otp_invalid, <<"otp is required.">>}.

otp_key(Purpose, Key) -> ["sd:otp:", atom_to_list(Purpose), ":", sd_util:s(Key)].
otp_attempts_key(Purpose, Key) -> ["sd:otpa:", atom_to_list(Purpose), ":", sd_util:s(Key)].

otp_hash(Salt, Code) ->
    base64:encode(crypto:hash(sha256, <<Salt/binary, Code/binary>>)).

%% =============================================================================
%% Login
%% =============================================================================

%% Body: identifier, plus password (admin accounts only -- see authenticate/8),
%% plus (when due) one of: totp (authenticator app code), emailOtp (a
%% delivered code) or recoveryCode (a backup code for whichever method this
%% account enrolled in); optionally deviceId and, only at first-time
%% enrollment, mfaMethod ("totp", the default, or "email"). Headers is the
%% raw request headers map (for the device-trust fallback fingerprint; see
%% device_key/2) -- sd_http passes it straight through.
%%
%% A code is only demanded when the account either hasn't finished 2FA
%% enrollment yet, or the calling DEVICE isn't currently trusted (new device,
%% or this device's trust has expired); a call from an already-trusted
%% device succeeds outright once any password requirement is met.
login(Body, Ip, Headers) ->
    Id = trim(sd_util:get(<<"identifier">>, Body)),
    Password = sd_util:get(<<"password">>, Body),
    Totp = sd_util:get(<<"totp">>, Body),
    RecoveryCode = sd_util:get(<<"recoveryCode">>, Body),
    EmailOtp = sd_util:get(<<"emailOtp">>, Body),
    Method = mfa_method_choice(sd_util:get(<<"mfaMethod">>, Body)),
    DeviceKey = device_key(Body, Headers),
    case {Id, sd_db:rate(["login:ip:", Ip], 60, 900)} of
        {<<>>, _} -> {error, invalid, <<"identifier is required.">>};
        {_, limited} -> {error, rate_limited, <<"Too many attempts; try again later.">>};
        _ ->
            case sd_users:find(Id) of
                undefined ->
                    burn_time(),
                    {error, invalid_credentials, <<"Wrong details.">>};
                User -> login_user(User, Password, Totp, RecoveryCode, EmailOtp, Method, DeviceKey)
            end
    end.

mfa_method_choice(<<"email">>) -> <<"email">>;
mfa_method_choice(_) -> <<"totp">>.

login_user(User, Password, Totp, RecoveryCode, EmailOtp, Method, DeviceKey) ->
    Username = maps:get(<<"username">>, User),
    case locked(Username) of
        true -> {error, locked, <<"Too many failed attempts; try again in a few minutes.">>};
        false ->
            case status_gate(User) of
                {error, _, _} = Err -> Err;
                ok -> authenticate(User, Username, Password, Totp, RecoveryCode, EmailOtp, Method, DeviceKey)
            end
    end.

%% "Password is needed only for admin users" -- every other account skips
%% straight to the second-factor gate, whether or not it happens to have a
%% password on file (invites/self-registration still set one; it's just
%% never checked here any more).
authenticate(User, Username, Password, Totp, RecoveryCode, EmailOtp, Method, DeviceKey) ->
    case sd_users:is_admin(User) of
        true ->
            HasPw = has(Password),
            case HasPw andalso password_ok(Username, Password) of
                false -> failed(Username);
                true -> after_password(User, Username, Totp, RecoveryCode, EmailOtp, Method, DeviceKey)
            end;
        false ->
            after_password(User, Username, Totp, RecoveryCode, EmailOtp, Method, DeviceKey)
    end.

after_password(User, Username, Totp, RecoveryCode, EmailOtp, Method, DeviceKey) ->
    case sd_totp:enabled(Username) of
        false -> enroll_step(User, Username, Totp, EmailOtp, Method, DeviceKey);
        true ->
            case device_trusted(Username, DeviceKey) of
                true -> success(User, false, DeviceKey);
                false -> mfa_step(User, Username, Totp, RecoveryCode, EmailOtp, DeviceKey)
            end
    end.

has(V) -> is_binary(V) andalso V =/= <<>>.

%% First-ever login for this account (or a previous enrollment attempt that
%% never finished): no code yet -> kick off enrollment (a QR/secret for
%% totp, or send the first email code for email). A code present -> treat it
%% as the answer to that enrollment step, and on a match, turn 2FA on AND
%% log them in (trusting this device), in the same call. A wrong code here
%% still counts against the account's failed-attempt lockout, same as a
%% wrong code post-enrollment, so this can't be brute-forced either.
enroll_step(User, Username, Totp, EmailOtp, Method, DeviceKey) ->
    case pick_code(Totp, EmailOtp) of
        none ->
            case sd_totp:login_setup(Username, User, Method) of
                {ok, Setup} -> {ok, Setup#{<<"totpSetupRequired">> => true}};
                {error, _, _} = Err -> Err
            end;
        Code ->
            case sd_totp:login_verify_setup(Username, Code) of
                {ok, RecoveryCodes} ->
                    {ok, Session} = success(User, true, DeviceKey),
                    {ok, Session#{<<"recoveryCodes">> => RecoveryCodes, <<"totpJustEnabled">> => true}};
                {error, _, _} = Err -> count_failure(Username), Err
            end
    end.

pick_code(Totp, _) when is_binary(Totp), Totp =/= <<>> -> Totp;
pick_code(_, EmailOtp) when is_binary(EmailOtp), EmailOtp =/= <<>> -> EmailOtp;
pick_code(_, _) -> none.

%% Reached only for an already-enrolled account logging in from a device
%% that isn't currently trusted. recoveryCode works regardless of which
%% second-factor method this account uses; otherwise dispatch on it.
mfa_step(User, Username, Totp, RecoveryCode, EmailOtp, DeviceKey) ->
    case has(RecoveryCode) of
        true ->
            case sd_totp:consume_recovery(Username, RecoveryCode) of
                ok -> success(User, true, DeviceKey);
                {error, _, _} = Err -> count_failure(Username), Err
            end;
        false ->
            case sd_totp:method(Username) of
                <<"email">> -> email_mfa_step(User, Username, EmailOtp, DeviceKey);
                _ -> totp_mfa_step(User, Username, Totp, DeviceKey)
            end
    end.

totp_mfa_step(User, Username, Totp, DeviceKey) ->
    case has(Totp) of
        false -> {error, totp_required, <<"Enter your authenticator app code.">>};
        true ->
            case sd_totp:verify_login(Username, Totp) of
                ok -> success(User, true, DeviceKey);
                {error, _, _} = Err -> count_failure(Username), Err
            end
    end.

%% Unlike an app code, an email code doesn't already exist client-side, so a
%% call with none yet triggers sending one (not an error -- 200/ok, same
%% cooldown-aware shape send_otp/3 always returns) rather than just telling
%% the caller to go produce one.
email_mfa_step(User, Username, EmailOtp, DeviceKey) ->
    case has(EmailOtp) of
        false ->
            Sent = send_otp(mfa_login, Username, User),
            {ok, Sent#{<<"emailOtpRequired">> => true, <<"mfaMethod">> => <<"email">>}};
        true ->
            case check_otp(mfa_login, Username, EmailOtp) of
                ok -> success(User, true, DeviceKey);
                {error, _, _} = Err -> count_failure(Username), Err
            end
    end.

success(User, CodeUsed, DeviceKey) ->
    Username = maps:get(<<"username">>, User),
    sd_db:del(["sd:lf:", sd_util:s(Username)]),
    CodeUsed andalso sd_users:mark_totp(Username),
    trust_device(Username, DeviceKey),
    sd_users:mark_login(Username),
    Fresh = sd_users:get(Username),
    {ok, start_session(Fresh, DeviceKey)}.

failed(Username) ->
    count_failure(Username),
    {error, invalid_credentials, <<"Wrong details.">>}.

count_failure(Username) ->
    Key = ["sd:lf:", sd_util:s(Username)],
    N = sd_db:incr(Key),
    N =:= 1 andalso sd_db:expire(Key, ?LOGIN_FAIL_WINDOW),
    %% Tell the account holder the moment it locks (once, on the attempt that trips it).
    N =:= ?LOGIN_FAIL_MAX andalso (catch sd_feed:security(Username, account_locked, #{})),
    ok.

locked(Username) ->
    case sd_db:get(["sd:lf:", sd_util:s(Username)]) of
        undefined -> false;
        Bin -> binary_to_integer(Bin) >= ?LOGIN_FAIL_MAX
    end.

%% Keeps "no such user" from being measurably faster than "wrong password".
burn_time() ->
    _ = crypto:pbkdf2_hmac(sha256, <<"x">>, <<"y">>, ?PW_ITER, 32),
    ok.

%% SANDESH_TOTP_FRESH_SEC overrides the 14-day default (used by tests, or
%% to tighten it), same pattern as session_ttl/0.
totp_fresh_ms() ->
    case os:getenv("SANDESH_TOTP_FRESH_SEC") of
        false -> ?TOTP_FRESH_MS;
        S -> case string:to_integer(S) of {N, []} when N > 0 -> N * 1000; _ -> ?TOTP_FRESH_MS end
    end.

totp_fresh(User) ->
    case sd_util:get(<<"lastTotpTs">>, User) of
        T when is_integer(T) -> sd_util:now_ms() - T < totp_fresh_ms();
        _ -> false
    end.

%% =============================================================================
%% Device trust -- see the module doc for the overall rule. A device is a
%% Redis key with a sliding TTL; there is no list of a user's devices to
%% manage/revoke individually (out of scope here), just "was THIS one seen
%% recently".
%% =============================================================================

device_trust_ttl_sec() ->
    case os:getenv("SANDESH_DEVICE_TRUST_SEC") of
        false -> ?DEVICE_TRUST_TTL;
        S -> case string:to_integer(S) of {N, []} when N > 0 -> N; _ -> ?DEVICE_TRUST_TTL end
    end.

device_trusted(Username, DeviceKey) ->
    sd_db:get(device_trust_redis_key(Username, DeviceKey)) =/= undefined.

trust_device(Username, DeviceKey) ->
    sd_db:setex(device_trust_redis_key(Username, DeviceKey), device_trust_ttl_sec(), <<"1">>).

device_trust_redis_key(Username, DeviceKey) ->
    ["sd:devtrust:", sd_util:s(sd_util:norm_user(Username)), ":", sd_util:s(DeviceKey)].

%% Body's `deviceId` (opaque, client-generated, stable across this device's
%% logins) wins when present. Otherwise fall back to a fingerprint derived
%% from the User-Agent header -- coarse (shared by every install of the same
%% browser/OS combination) but still means a genuinely different browser or
%% platform is treated as a different device, without requiring any client
%% change. Neither present -> a fresh, never-repeating key, so trust can
%% never be granted by accident (fails closed).
device_key(Body, Headers) ->
    Raw = case norm_bin(sd_util:get(<<"deviceId">>, Body)) of
        <<>> -> device_fallback_raw(Headers);
        D -> <<"id:", D/binary>>
    end,
    base64:encode(crypto:hash(sha256, Raw)).

device_fallback_raw(Headers) ->
    case header_bin(Headers, "user-agent") of
        <<>> -> <<"anon:", (sd_util:rand_token())/binary>>;
        Ua -> <<"ua:", Ua/binary>>
    end.

header_bin(Headers, Key) when is_map(Headers) ->
    case maps:find(Key, Headers) of
        {ok, V} -> sd_util:b(string:trim(V));
        error -> <<>>
    end;
header_bin(_, _) -> <<>>.

norm_bin(V) when is_binary(V) -> string:trim(V);
norm_bin(_) -> <<>>.

%% =============================================================================
%% Sessions
%% =============================================================================

%% Seconds a session lives. SANDESH_SESSION_TTL_SEC overrides the 14-day
%% default (used by the expiry test, or to tighten it).
session_ttl() ->
    case os:getenv("SANDESH_SESSION_TTL_SEC") of
        false -> ?SESSION_TTL_DEFAULT;
        S -> case string:to_integer(S) of {N, []} when N > 0 -> N; _ -> ?SESSION_TTL_DEFAULT end
    end.

start_session(User, DeviceKey) ->
    Username = maps:get(<<"username">> , User),
    Token = sd_util:rand_token(),
    Now = sd_util:now_ms(),
    Ttl = session_ttl(),
    Expires = Now + Ttl * 1000,
    sd_db:setex_json(["sd:sess:", Token], Ttl,
                     #{<<"username">> => Username, <<"createdTs">> => Now, <<"expiresTs">> => Expires,
                       <<"deviceKey">> => DeviceKey}),
    revoke_previous_session(Username, Token, Ttl),
    State = password_state(Username),
    #{<<"token">> => Token,
      <<"expiresTs">> => Expires,
      <<"user">> => sd_users:full(User),
      <<"mustChangePassword">> => maps:get(<<"mustChange">>, State),
      <<"totpDue">> => not device_trusted(Username, DeviceKey)}.

%% One active session per account: signing in ends the previous session, so any
%% other tab/browser/device holding it is signed out (its live connection is
%% told `session_replaced`; an offline client finds out on its next request).
revoke_previous_session(Username, NewToken, Ttl) ->
    Key = ["sd:usersess:", Username],
    case sd_db:get(Key) of
        Old when is_binary(Old), Old =/= NewToken ->
            sd_db:del(["sd:sess:", Old]),
            catch sd_notify:replaced(Username),
            catch sd_feed:security(Username, session_replaced, #{});
        _ -> ok
    end,
    sd_db:setex(Key, Ttl, NewToken).

%% Session info without side effects: {ok, User, #{mustChange}} | error.
session(Token) when is_binary(Token), Token =/= <<>> ->
    case sd_db:get_json(["sd:sess:", Token]) of
        #{<<"username">> := Username} ->
            case sd_users:get(Username) of
                #{<<"status">> := <<"active">>} = User ->
                    {ok, User, password_state(Username)};
                _ -> error
            end;
        _ -> error
    end;
session(_) -> error.

%% "Is a code due again yet?" for an already-live session, keyed off the
%% DEVICE that session was created on -- not the account-wide totp_fresh/1
%% (a session predating this field falls back to that, since it has no
%% deviceKey to check).
totp_due_for_token(Token) when is_binary(Token), Token =/= <<>> ->
    case sd_db:get_json(["sd:sess:", Token]) of
        #{<<"username">> := Username, <<"deviceKey">> := DeviceKey} ->
            not device_trusted(Username, DeviceKey);
        #{<<"username">> := Username} ->
            not totp_fresh(sd_users:get(Username));
        _ -> true
    end;
totp_due_for_token(_) -> true.

session_user(Token) ->
    case session(Token) of
        {ok, User, _} -> {ok, User};
        error -> error
    end.

%% Cheap "has this session expired / been logged out?" -- one Redis lookup,
%% no user fetch. What a live WebSocket connection re-checks periodically.
session_alive(Token) when is_binary(Token), Token =/= <<>> ->
    sd_db:get(["sd:sess:", Token]) =/= undefined;
session_alive(_) -> false.

%% Epoch-ms at which this session ends, or undefined if it's gone.
session_expires(Token) when is_binary(Token), Token =/= <<>> ->
    case sd_db:get_json(["sd:sess:", Token]) of
        #{<<"expiresTs">> := E} when is_integer(E) -> E;
        #{<<"createdTs">> := C} -> C + ?SESSION_TTL_DEFAULT * 1000;   %% older sessions
        _ -> undefined
    end;
session_expires(_) -> undefined.

logout(Token) when is_binary(Token) ->
    sd_db:del(["sd:sess:", Token]),
    sd_db:del(["sd:unlock:", Token]),
    ok;
logout(_) -> ok.

%% =============================================================================
%% Passwords
%% =============================================================================

password_ok(Username, Password) ->
    case sd_db:hget_json("sd:cred", sd_util:norm_user(Username)) of
        #{<<"salt">> := S, <<"hash">> := H, <<"iter">> := Iter} ->
            Calc = crypto:pbkdf2_hmac(sha256, Password, base64:decode(S), Iter, 32),
            Stored = base64:decode(H),
            byte_size(Calc) =:= byte_size(Stored) andalso crypto:hash_equals(Calc, Stored);
        _ ->
            burn_time(),
            false
    end.

store_password(Username, Password, MustChange) ->
    Salt = crypto:strong_rand_bytes(16),
    Hash = crypto:pbkdf2_hmac(sha256, Password, Salt, ?PW_ITER, 32),
    sd_db:hset_json("sd:cred", sd_util:norm_user(Username),
                    #{<<"salt">> => base64:encode(Salt), <<"hash">> => base64:encode(Hash),
                      <<"iter">> => ?PW_ITER, <<"setTs">> => sd_util:now_ms(),
                      <<"mustChange">> => MustChange}).

%% #{mustChange := bool, hasPassword := bool, expired := bool}
password_state(Username) ->
    U = sd_users:get(Username),
    case sd_db:hget_json("sd:cred", sd_util:norm_user(Username)) of
        #{<<"setTs">> := SetTs} = Cred ->
            Expired = U =/= undefined andalso sd_users:is_admin(U) andalso
                      sd_util:now_ms() - SetTs > ?ADMIN_PW_MAX_AGE_MS,
            #{<<"hasPassword">> => true,
              <<"expired">> => Expired,
              <<"mustChange">> => maps:get(<<"mustChange">>, Cred, false) =:= true orelse Expired};
        _ ->
            #{<<"hasPassword">> => false, <<"expired">> => false, <<"mustChange">> => false}
    end.

%% Change (or, for a user with no password yet, first-set) the password.
%% Requires a valid session; `oldPassword` is required only if one exists.
change_password(Token, Old, New) ->
    case session(Token) of
        error -> {error, unauthenticated, <<"Sign in first.">>};
        {ok, User, State} ->
            Username = maps:get(<<"username">>, User),
            HasPw = maps:get(<<"hasPassword">>, State),
            case (not HasPw) orelse (is_binary(Old) andalso password_ok(Username, Old)) of
                false -> {error, invalid_credentials, <<"The current password is wrong.">>};
                true ->
                    case check_password_policy(Username, New) of
                        ok ->
                            store_password(Username, New, false),
                            catch sd_feed:security(Username, password_changed, #{}),
                            {ok, #{<<"changed">> => true}};
                        {error, _, _} = Err -> Err
                    end
            end
    end.

%% Used at account creation paths that already proved identity (a
%% self-registering user choosing their own password); kept small and
%% explicit.
set_initial_password(Username, Password) ->
    store_password(Username, Password, false).

%% Every account needs a password now (mandatory TOTP enrollment happens at
%% first login, right after the password check). Used for accounts someone
%% ELSE creates -- invites -- where the new user hasn't chosen a password
%% yet: same default-password-then-forced-change convention as the admin
%% bootstrap in finish_setup/1.
issue_default_password(Username) ->
    store_password(Username, default_password(Username), true).

check_password_policy(Username, Pw) when is_binary(Pw) ->
    Chars = unicode:characters_to_list(Pw),
    Letters = lists:any(fun(C) -> (C >= $a andalso C =< $z) orelse (C >= $A andalso C =< $Z) end, Chars),
    Digits = lists:any(fun(C) -> C >= $0 andalso C =< $9 end, Chars),
    if
        length(Chars) < 8 -> {error, weak_password, <<"Use at least 8 characters.">>};
        length(Chars) > 128 -> {error, weak_password, <<"Password is too long.">>};
        not (Letters andalso Digits) -> {error, weak_password, <<"Use letters and at least one digit.">>};
        Pw =:= <<"Sandesh", Username/binary>> -> {error, weak_password, <<"Choose something other than the default password.">>};
        true -> ok
    end;
check_password_policy(_, _) ->
    {error, weak_password, <<"newPassword is required.">>}.

%% =============================================================================
%% Admin console gate: password AND a fresh OTP
%% =============================================================================

admin_unlock_start(Token) ->
    case session(Token) of
        {ok, User, _} ->
            case sd_users:is_admin(User) of
                true -> {ok, send_otp(unlock, maps:get(<<"username">>, User), User)};
                false -> {error, forbidden, <<"Administrators only.">>}
            end;
        error -> {error, unauthenticated, <<"Sign in first.">>}
    end.

admin_unlock(Token, Password, Otp) ->
    case session(Token) of
        error -> {error, unauthenticated, <<"Sign in first.">>};
        {ok, User, State} ->
            Username = maps:get(<<"username">>, User),
            case sd_users:is_admin(User) of
                false -> {error, forbidden, <<"Administrators only.">>};
                true ->
                    case maps:get(<<"mustChange">>, State) of
                        true -> {error, password_change_required,
                                 <<"Change your password before opening the admin console.">>};
                        false ->
                            case locked(Username) of
                                true -> {error, locked, <<"Too many failed attempts; try again in a few minutes.">>};
                                false ->
                                    case is_binary(Password) andalso password_ok(Username, Password) of
                                        false -> count_failure(Username),
                                                 {error, invalid_credentials, <<"Wrong password.">>};
                                        true ->
                                            case check_otp(unlock, Username, Otp) of
                                                ok ->
                                                    sd_db:setex(["sd:unlock:", Token], ?UNLOCK_TTL, <<"1">>),
                                                    {ok, #{<<"unlockedForSec">> => ?UNLOCK_TTL}};
                                                {error, _, _} = Err -> count_failure(Username), Err
                                            end
                                    end
                            end
                    end
            end
    end.

admin_unlocked(Token) when is_binary(Token) ->
    sd_db:get(["sd:unlock:", Token]) =/= undefined;
admin_unlocked(_) -> false.

%% =============================================================================

trim(V) when is_binary(V) -> string:trim(V);
trim(_) -> <<>>.
