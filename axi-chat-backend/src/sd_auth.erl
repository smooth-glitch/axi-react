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
%%%  - Login by email, mobile number or username; OTP verification on first
%%%    login and again once every 14 days.
%%%  - Admin default password is "Sandesh" + username, must be changed on
%%%    first login, and must be changed again every 30 days.
%%%  - The admin console needs password AND an OTP (admin_unlock/3).
%%%
%%% Abuse controls: OTP resend cooldown, max wrong OTP attempts, per-account
%%% lockout after repeated failed logins, per-IP request limits.
-module(sd_auth).
-export([setup_start/2, setup_verify/2,
         otp_send/2, login/2,
         session/1, session_user/1, session_alive/1, session_expires/1, session_ttl/0, logout/1,
         change_password/3, set_initial_password/2, password_state/1,
         admin_unlock_start/1, admin_unlock/3, admin_unlocked/1,
         otp_fresh/1]).
-include_lib("kernel/include/logger.hrl").

-define(OTP_TTL, 300).
-define(OTP_COOLDOWN, 30).
-define(OTP_MAX_ATTEMPTS, 5).
%% Default session lifetime: two weeks, HARD (not sliding) -- the spec's
%% "ask the user to login again every two weeks". Overridable for tests/ops.
-define(SESSION_TTL_DEFAULT, 14 * 24 * 3600).
-define(OTP_FRESH_MS, 14 * 24 * 3600 * 1000).
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
                    sd_users:mark_otp(Username),
                    Session = start_session(sd_users:get(Username)),
                    {ok, Session#{<<"org">> => Org, <<"user">> => User}};
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
%% OTP
%% =============================================================================

%% Public endpoint. Never reveals whether an identifier exists: unknown
%% identifiers get the same "ok" as real ones.
otp_send(Body, Ip) ->
    Id = trim(sd_util:get(<<"identifier">>, Body)),
    case {Id, sd_db:rate(["otp:ip:", Ip], 20, 900)} of
        {<<>>, _} -> {error, invalid, <<"identifier is required.">>};
        {_, limited} -> {error, rate_limited, <<"Too many requests; try again later.">>};
        _ ->
            case sd_users:find(Id) of
                undefined -> {ok, #{<<"sent">> => true}};
                User ->
                    case status_gate(User) of
                        ok ->
                            R = send_otp(login, maps:get(<<"username">>, User), User),
                            {ok, R};
                        {error, _, _} = Err -> Err
                    end
            end
    end.

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

%% Body: identifier + (password and/or otp).
login(Body, Ip) ->
    Id = trim(sd_util:get(<<"identifier">>, Body)),
    Password = sd_util:get(<<"password">>, Body),
    Otp = sd_util:get(<<"otp">>, Body),
    case {Id, sd_db:rate(["login:ip:", Ip], 60, 900)} of
        {<<>>, _} -> {error, invalid, <<"identifier is required.">>};
        {_, limited} -> {error, rate_limited, <<"Too many attempts; try again later.">>};
        _ ->
            case sd_users:find(Id) of
                undefined ->
                    burn_time(),
                    {error, invalid_credentials, <<"Wrong details.">>};
                User -> login_user(User, Password, Otp)
            end
    end.

login_user(User, Password, Otp) ->
    Username = maps:get(<<"username">>, User),
    case locked(Username) of
        true -> {error, locked, <<"Too many failed attempts; try again in a few minutes.">>};
        false ->
            case status_gate(User) of
                {error, _, _} = Err -> Err;
                ok -> authenticate(User, Username, Password, Otp)
            end
    end.

authenticate(User, Username, Password, Otp) ->
    HasPw = is_binary(Password) andalso Password =/= <<>>,
    HasOtp = is_binary(Otp) andalso Otp =/= <<>>,
    case {HasPw, HasOtp} of
        {false, false} ->
            {error, invalid, <<"Send a password and/or an otp.">>};
        {true, false} ->
            case password_ok(Username, Password) of
                false -> failed(Username);
                true ->
                    case otp_fresh(User) of
                        true -> success(User, false);
                        false ->
                            %% Password fine but the 14-day OTP check is due.
                            _ = send_otp(login, Username, User),
                            {error, otp_required, <<"Enter the one-time code we just sent you.">>}
                    end
            end;
        {false, true} ->
            case check_otp(login, Username, Otp) of
                ok -> success(User, true);
                {error, _, _} = Err -> count_failure(Username), Err
            end;
        {true, true} ->
            case password_ok(Username, Password) of
                false -> failed(Username);
                true ->
                    case check_otp(login, Username, Otp) of
                        ok -> success(User, true);
                        {error, _, _} = Err -> count_failure(Username), Err
                    end
            end
    end.

success(User, OtpUsed) ->
    Username = maps:get(<<"username">>, User),
    sd_db:del(["sd:lf:", sd_util:s(Username)]),
    OtpUsed andalso sd_users:mark_otp(Username),
    sd_users:mark_login(Username),
    Fresh = sd_users:get(Username),
    {ok, start_session(Fresh)}.

failed(Username) ->
    count_failure(Username),
    {error, invalid_credentials, <<"Wrong details.">>}.

count_failure(Username) ->
    Key = ["sd:lf:", sd_util:s(Username)],
    N = sd_db:incr(Key),
    N =:= 1 andalso sd_db:expire(Key, ?LOGIN_FAIL_WINDOW),
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

otp_fresh(User) ->
    case sd_util:get(<<"lastOtpTs">>, User) of
        T when is_integer(T) -> sd_util:now_ms() - T < ?OTP_FRESH_MS;
        _ -> false
    end.

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

start_session(User) ->
    Username = maps:get(<<"username">> , User),
    Token = sd_util:rand_token(),
    Now = sd_util:now_ms(),
    Ttl = session_ttl(),
    Expires = Now + Ttl * 1000,
    sd_db:setex_json(["sd:sess:", Token], Ttl,
                     #{<<"username">> => Username, <<"createdTs">> => Now, <<"expiresTs">> => Expires}),
    State = password_state(Username),
    #{<<"token">> => Token,
      <<"expiresTs">> => Expires,
      <<"user">> => sd_users:full(User),
      <<"mustChangePassword">> => maps:get(<<"mustChange">>, State),
      <<"otpDue">> => not otp_fresh(User)}.

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
                            {ok, #{<<"changed">> => true}};
                        {error, _, _} = Err -> Err
                    end
            end
    end.

%% Used at account creation paths that already proved identity (none today
%% besides setup); kept small and explicit.
set_initial_password(Username, Password) ->
    store_password(Username, Password, false).

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
