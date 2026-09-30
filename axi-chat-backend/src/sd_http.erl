%%% HTTP JSON API for everything that happens BEFORE a WebSocket exists:
%%% first-run organisation setup, self-registration, OTP, login, sessions.
%%% Routed here from chat_web's dispatch for any path under /api/sd/.
%%%
%%%   GET  /api/sd/public              names for the registration form + whether setup is done
%%%   POST /api/sd/setup/start         {org, name, username?, email, mobile, setupToken?}  -> sends a bootstrap OTP
%%%   POST /api/sd/setup/verify        {otp}  -> creates the org + first admin; NOT a session yet, see below
%%%   POST /api/sd/register            {..., password}  -> pending, sent to a host for approval
%%%   POST /api/sd/login               {identifier, password?, totp?, emailOtp?, recoveryCode?, deviceId?, mfaMethod?}
%%%                                    -> see "Login / mandatory two-factor" below
%%%   POST /api/sd/logout              (Bearer)
%%%   GET  /api/sd/session             (Bearer) -> current user, or 401
%%%   GET  /api/sd/feed                (Bearer) the My Workspace notification feed (+ /feed/summary, POST /feed/read|resolve|dismiss|clear) -- see sd_feed
%%%   POST /api/sd/password/change     (Bearer) {oldPassword?, newPassword}
%%%   POST /api/sd/admin/unlock/start  (Bearer) sends the admin-console OTP (unaffected by mandatory 2FA below)
%%%   POST /api/sd/admin/unlock        (Bearer) {password, otp}
%%%   GET  /api/sd/2fa/totp             (Bearer) -> {enabled, method} -- enabled is always true for a live session
%%%   POST /api/sd/2fa/totp/disable      (Bearer) {password, code} (code: totp/emailOtp or a recovery code)
%%%   POST /api/sd/2fa/totp/recovery/regenerate (Bearer) {password, code} -> {recoveryCodes}
%%%   POST /api/sd/2fa/email/request    (Bearer) sends a code to use as `code` above, for an email-method account only
%%%
%%% Login / mandatory two-factor: a PASSWORD is required only for admin
%%% accounts (checked first, before anything below); every account, admin or
%%% not, also needs a second-factor code -- either an authenticator-app TOTP
%%% code or an emailed OTP code, whichever it enrolled in -- but only from a
%%% DEVICE this account hasn't verified from in the last 14 days (`deviceId`
%%% in the body identifies the device; omit it and a coarser User-Agent-based
%%% fallback is used). A trusted device's login succeeds outright once any
%%% password requirement is met, no code needed. An account with no
%%% confirmed second factor yet enrolls inline, on whichever call first gets
%%% it past the password gate (mfaMethod: "totp", the default, or "email"):
%%%   1. POST /login {identifier, password?}            -> no `token`; instead
%%%      for mfaMethod "totp" (default):
%%%        {totpSetupRequired:true, mfaMethod:"totp", secret, otpauthUri, issuer, digits, periodSec, recommendedApps}
%%%        -- render the QR, the user scans it.
%%%      for mfaMethod "email":
%%%        {totpSetupRequired:true, mfaMethod:"email", sent:true, expiresInSec} -- a code was just emailed.
%%%   2. POST /login {identifier, password?, totp:"123456"} or {..., emailOtp:"123456"}
%%%      -> {token, ..., recoveryCodes:[...10], totpJustEnabled:true}. Show
%%%      the recovery codes exactly once -- the API never returns them again.
%%% setup/verify (the very first admin) works the same way: its response is
%%% step 1 above (mfaMethod "totp", with `defaultPassword` included), not a
%%% session.
%%%
%%% For an already-enrolled account on an untrusted device: a TOTP-method
%%% account gets {"error":{"code":"totp_required",...}} (401) until it sends
%%% one; an email-method account instead gets an ok response with
%%% {emailOtpRequired:true, mfaMethod:"email", sent:true/false, expiresInSec,
%%% retryAfter?} -- login itself triggers sending the code, since there's
%%% nothing for the user to generate locally.
%%%
%%% Success:  200 {"ok":true,"data":{...}}
%%% Failure:  4xx {"ok":false,"error":{"code":"...","message":"...","details":{...}}}
%%% Same envelope as the WebSocket /sd commands (see sd_cmds), so one client
%%% helper handles both. CORS is enabled (SANDESH_CORS_ORIGIN, default "*")
%%% because a dev frontend on :5173 calls a backend on :8080.
-module(sd_http).
-export([handle/6]).
-include_lib("kernel/include/logger.hrl").

-define(MAX_BODY, 65536).

%% Called by chat_web:dispatch/6. Always answers and closes the socket.
handle(Socket, Method, Path, Query, Headers, BodyStart) ->
    put(sd_query, Query),
    try
        route(Socket, Method, Path, Headers, BodyStart)
    catch
        Class:Reason:Stack ->
            ?LOG_ERROR("sd_http ~s ~s crashed: ~p:~p~n~p", [Method, Path, Class, Reason, Stack]),
            send(Socket, 500, error_body(internal, <<"Something went wrong on the server.">>, null))
    end,
    gen_tcp:close(Socket).

route(Socket, "OPTIONS", _Path, _Headers, _BodyStart) ->
    send(Socket, 204, <<>>);
route(Socket, "GET", "/api/sd/public", _H, _B) ->
    ok_(Socket, sd_org:public());
%% A scanned / typed enterprise code -> the enterprise card. No sign-in; rate limited per address, and a personal
%% code answers exactly like an unknown one.
route(Socket, "GET", "/api/sd/connect/" ++ Code, H, _B) ->
    case sd_db:rate(["connect:", client_ip(Socket, H)], 60, 60) of
        limited -> send(Socket, 429, error_body(rate_limited, <<"Too many lookups; try again in a minute.">>, null));
        ok -> respond(Socket, sd_connect:public_lookup(sd_util:b(http_uri_decode(Code))))
    end;
route(Socket, "GET", "/api/sd/2fa/totp", H, _B) ->
    respond(Socket, sd_totp:status(bearer(H)));
route(Socket, "GET", "/api/sd/session", H, _B) ->
    case bearer(H) of
        undefined -> fail(Socket, {error, unauthenticated, <<"Missing Authorization: Bearer <token>.">>});
        Token ->
            case sd_auth:session(Token) of
                {ok, User, State} ->
                    ok_(Socket, #{<<"user">> => User, <<"password">> => State,
                                  <<"sessionExpiresTs">> => sd_auth:session_expires(Token),
                                  <<"totpDue">> => sd_auth:totp_due_for_token(Token),
                                  <<"mode">> => atom_to_binary(sd_util:mode(), utf8)});
                error -> fail(Socket, {error, unauthenticated, <<"Session expired. Sign in again.">>})
            end
    end;
route(Socket, "GET", "/api/sd/feed", H, _B) ->
    feed(Socket, H, <<"list">>, feed_query());
route(Socket, "GET", "/api/sd/feed/summary", H, _B) ->
    feed(Socket, H, <<"summary">>, #{});
route(Socket, "POST", "/api/sd/files", H, B) ->
    upload_file(Socket, H, B);
route(Socket, "GET", "/api/sd/files", H, _B) ->
    with_user(Socket, H, fun(User) -> ok_(Socket, #{<<"files">> => sd_files:list_for(User)}) end);
route(Socket, "GET", "/api/sd/files/" ++ Id, H, _B) ->
    with_user(Socket, H, fun(User) -> download_file(Socket, User, list_to_binary(Id)) end);
route(Socket, "POST", Path, Headers, BodyStart) ->
    case read_json(Socket, Headers, BodyStart) of
        {ok, Body} -> post(Socket, Path, Body, Headers);
        {error, Msg} -> fail(Socket, {error, bad_request, Msg})
    end;
route(Socket, _Method, _Path, _H, _B) ->
    fail(Socket, {error, not_found, <<"No such endpoint.">>}).

post(Socket, "/api/sd/feed/" ++ Sub, Body, H)
        when Sub =:= "read"; Sub =:= "resolve"; Sub =:= "dismiss"; Sub =:= "clear" ->
    feed(Socket, H, list_to_binary(Sub), Body);
post(Socket, "/api/sd/setup/start", Body, H) ->
    respond(Socket, sd_auth:setup_start(Body, client_ip(Socket, H)));
post(Socket, "/api/sd/setup/verify", Body, H) ->
    respond(Socket, sd_auth:setup_verify(Body, client_ip(Socket, H)));
post(Socket, "/api/sd/register", Body, H) ->
    respond(Socket, self_register(Body, client_ip(Socket, H)));
post(Socket, "/api/sd/login", Body, H) ->
    respond(Socket, sd_auth:login(Body, client_ip(Socket, H), H));
post(Socket, "/api/sd/logout", _Body, H) ->
    sd_auth:logout(bearer(H)),
    ok_(Socket, #{<<"loggedOut">> => true});
post(Socket, "/api/sd/password/change", Body, H) ->
    respond(Socket, sd_auth:change_password(bearer(H), sd_util:get(<<"oldPassword">>, Body),
                                            sd_util:get(<<"newPassword">>, Body)));
post(Socket, "/api/sd/admin/unlock/start", _Body, H) ->
    respond(Socket, sd_auth:admin_unlock_start(bearer(H)));
post(Socket, "/api/sd/admin/unlock", Body, H) ->
    respond(Socket, sd_auth:admin_unlock(bearer(H), sd_util:get(<<"password">>, Body),
                                         sd_util:get(<<"otp">>, Body)));
post(Socket, "/api/sd/2fa/totp/disable", Body, H) ->
    respond(Socket, sd_totp:disable(bearer(H), sd_util:get(<<"password">>, Body),
                                    sd_util:get(<<"code">>, Body)));
post(Socket, "/api/sd/2fa/totp/recovery/regenerate", Body, H) ->
    respond(Socket, sd_totp:regenerate_recovery(bearer(H), sd_util:get(<<"password">>, Body),
                                                sd_util:get(<<"code">>, Body)));
post(Socket, "/api/sd/2fa/email/request", _Body, H) ->
    respond(Socket, sd_totp:request_manage_code(bearer(H)));
post(Socket, _Path, _Body, _H) ->
    fail(Socket, {error, not_found, <<"No such endpoint.">>}).

%% ---- self-registration ----------------------------------------------------------------------
%% "Users can register into the system themselves ... The onboarding
%% approval will be sent to the host who can approve their onboarding."
%% A self-registering user picks their own password up front (unlike an
%% invited user, who didn't choose their account and gets a default one) --
%% checked with the same policy as a password change. TOTP enrollment still
%% happens at their first login after approval, same as everyone else.
self_register(Body, Ip) ->
    case {sd_org:setup_done(), sd_db:rate(["register:", Ip], 10, 3600), sd_connect:check_registration_code(Body)} of
        {false, _, _} -> {error, not_ready, <<"This organisation hasn't been set up yet.">>};
        {_, limited, _} -> {error, rate_limited, <<"Too many registrations from here; try later.">>};
        {_, _, {error, _, _} = CodeErr} -> CodeErr;
        {_, _, ok} ->
            case sd_onboarding:check_registration(Body) of
                {error, _, _} = E -> E;
                ok -> register_checked(Body)
            end
    end.

register_checked(Body) ->
    Password = sd_util:get(<<"password">>, Body),
    Username0 = sd_util:get(<<"username">>, Body, <<>>),
    case sd_auth:check_password_policy(Username0, Password) of
        {error, _, _} = Err -> Err;
        ok ->
            case sd_users:create(Body, #{mode => register, actor => <<"self">>, status => <<"pending">>}) of
                {ok, User} ->
                    sd_auth:set_initial_password(maps:get(<<"username">>, User), Password),
                    Name = maps:get(<<"username">>, User),
                    Welcome = maps:get(<<"welcome">>, sd_onboarding:get(sd_util:b(sd_util:get(<<"category">>, User)))),
                    case sd_onboarding:approvers(User) of
                        none ->
                            {ok, _} = sd_users:set_status(Name, <<"active">>),
                            {ok, #{<<"registered">> => true, <<"status">> => <<"active">>, <<"username">> => Name,
                                   <<"requestId">> => null, <<"awaitingApprovalFrom">> => 0,
                                   <<"welcome">> => Welcome}};
                        {approvers, As} ->
                            {ok, Req} = sd_reqs:create_onboarding(User, As),
                            {ok, #{<<"registered">> => true, <<"status">> => <<"pending">>, <<"username">> => Name,
                                   <<"requestId">> => maps:get(<<"id">>, Req),
                                   <<"awaitingApprovalFrom">> => length(maps:get(<<"approvers">>, Req)),
                                   <<"welcome">> => Welcome}}
                    end;
                Err -> Err
            end
    end.

http_uri_decode(S) ->
    try uri_string:percent_decode(S) catch _:_ -> S end.

%% ---- files (upload / download options) ------------------------------------------------------------------

with_user(Socket, Headers, Fun) ->
    case bearer(Headers) of
        undefined -> fail(Socket, {error, unauthenticated, <<"Missing Authorization: Bearer <token>.">>});
        Token ->
            case sd_auth:session(Token) of
                {ok, User, _State} -> Fun(User);
                error -> fail(Socket, {error, unauthenticated, <<"Session expired. Sign in again.">>})
            end
    end.

%% ---- My Workspace notification feed (sd_feed) ------------------------------------------------------------
%%   GET  /api/sd/feed?priority=&category=&unreadOnly=&limit=&before=   GET /api/sd/feed/summary
%%   POST /api/sd/feed/read {ids|all, read?}   /resolve {id}   /dismiss {id}   /clear
feed(Socket, Headers, Action, Args) ->
    with_user(Socket, Headers, fun(User) ->
        respond(Socket, sd_feed:call(Action, maps:get(<<"username">>, User), Args))
    end).

feed_query() ->
    lists:foldl(
        fun({K, V}, Acc) ->
            case K of
                "priority" -> Acc#{<<"priority">> => list_to_binary(V)};
                "category" -> Acc#{<<"category">> => list_to_binary(V)};
                "unreadOnly" -> Acc#{<<"unreadOnly">> => V =:= "true"};
                "limit" -> int_arg(<<"limit">>, V, Acc);
                "before" -> int_arg(<<"before">>, V, Acc);
                _ -> Acc
            end
        end, #{}, get(sd_query)).

int_arg(Key, V, Acc) ->
    case string:to_integer(V) of
        {N, []} -> Acc#{Key => N};
        _ -> Acc
    end.

%% POST /api/sd/files?name=<file name>   raw file bytes as the body (Content-Type = the file's type)
upload_file(Socket, Headers, BodyStart) ->
    with_user(Socket, Headers, fun(User) ->
        Max = sd_files:max_bytes(),
        Username = maps:get(<<"username">>, User),
        case sd_db:rate(["files:", Username], 60, 3600) of
            limited -> fail(Socket, {error, rate_limited, <<"Too many uploads -- try again later.">>});
            ok ->
                case read_raw(Socket, Headers, BodyStart, Max) of
                    {ok, Bin} when byte_size(Bin) > 0 ->
                        Name = case lists:keyfind("name", 1, get(sd_query)) of
                                   {_, N} -> unicode:characters_to_binary(N);
                                   false -> <<"file">>
                               end,
                        Mime = list_to_binary(maps:get("content-type", Headers, "application/octet-stream")),
                        case sd_files:store(User, Name, Mime, Bin) of
                            {ok, Meta} -> ok_(Socket, #{<<"file">> => Meta});
                            {error, _, _} = E -> fail(Socket, E)
                        end;
                    {ok, _} -> fail(Socket, {error, bad_request, <<"The file is empty.">>});
                    {error, too_large} ->
                        fail(Socket, {error, too_large,
                                      iolist_to_binary(io_lib:format("File too large (max ~p MB).",
                                                                     [Max div (1024 * 1024)]))});
                    {error, _} -> fail(Socket, {error, bad_request, <<"Couldn't read the upload.">>})
                end
        end
    end).

download_file(Socket, User, Id) ->
    case sd_files:read(User, Id) of
        {ok, Meta, Bin} ->
            Name = maps:get(<<"name">>, Meta),
            %% Name is UTF-8 bytes: decode to code points first, or quote/1 re-encodes each byte
            %% as if it were Latin-1 ("ü" -> "%C3%83%C2%BC") and the download name comes out garbled.
            Encoded = uri_string:quote(unicode:characters_to_list(Name)),
            Head = ["HTTP/1.1 200 OK\r\n",
                    %% Always octet-stream + attachment + nosniff: an uploaded .html can never run as a page.
                    "Content-Type: application/octet-stream\r\n",
                    "Content-Disposition: attachment; filename*=UTF-8''", Encoded, "\r\n",
                    "X-File-Name: ", Encoded, "\r\n",
                    "Content-Length: ", integer_to_list(byte_size(Bin)), "\r\n",
                    "Access-Control-Allow-Origin: ", cors_origin(), "\r\n",
                    "Access-Control-Expose-Headers: X-File-Name, Content-Disposition, Content-Length\r\n",
                    "X-Content-Type-Options: nosniff\r\n",
                    "Cache-Control: private, no-store\r\n",
                    "Connection: close\r\n\r\n"],
            gen_tcp:send(Socket, [Head, Bin]);
        {error, _, _} = E -> fail(Socket, E)
    end.

%% Raw body up to Max bytes. An oversize request is drained (bounded) before answering so
%% the client sees our message instead of a connection reset.
read_raw(Socket, Headers, BodyStart, Max) ->
    case maps:find("content-length", Headers) of
        {ok, LenStr} ->
            case string:to_integer(LenStr) of
                {Len, []} when Len >= 0, Len =< Max -> read_bytes_or_error(Socket, BodyStart, Len);
                {Len, []} when Len > Max ->
                    drain_raw(Socket, byte_size(BodyStart), min(Len, Max * 2)),
                    {error, too_large};
                _ -> {error, bad_length}
            end;
        error -> {error, no_length}
    end.

read_bytes_or_error(Socket, Acc, Len) ->
    case read_bytes(Socket, Acc, Len) of
        {ok, Bin} -> {ok, Bin};
        error -> {error, closed}
    end.

drain_raw(_Socket, Read, Target) when Read >= Target -> ok;
drain_raw(Socket, Read, Target) ->
    case gen_tcp:recv(Socket, 0, 3000) of
        {ok, D} -> drain_raw(Socket, Read + byte_size(D), Target);
        {error, _} -> ok
    end.

%% ---- plumbing -----------------------------------------------------------------------------------------

respond(Socket, {ok, Data}) -> ok_(Socket, Data);
respond(Socket, {error, _, _} = E) -> fail(Socket, E);
respond(Socket, {error, _, _, _} = E) -> fail(Socket, E).

ok_(Socket, Data) ->
    send(Socket, 200, sd_util:jenc(#{<<"ok">> => true, <<"data">> => Data})).

fail(Socket, {error, Code, Msg}) ->
    send(Socket, status(Code), error_body(Code, Msg, null));
fail(Socket, {error, Code, Msg, Details}) ->
    send(Socket, status(Code), error_body(Code, Msg, Details)).

error_body(Code, Msg, Details) ->
    E0 = #{<<"code">> => atom_to_binary(Code, utf8), <<"message">> => Msg},
    E = case Details of null -> E0; _ -> E0#{<<"details">> => Details} end,
    sd_util:jenc(#{<<"ok">> => false, <<"error">> => E}).

status(unauthenticated) -> 401;
status(session_expired) -> 401;
status(invalid_credentials) -> 401;
status(otp_required) -> 401;
status(totp_required) -> 401;
status(otp_invalid) -> 401;
status(otp_locked) -> 429;
status(forbidden) -> 403;
status(admin_locked) -> 403;
status(account_inactive) -> 403;
status(pending_approval) -> 403;
status(rejected) -> 403;
status(password_change_required) -> 403;
status(not_found) -> 404;
status(no_pending_setup) -> 404;
status(rate_limited) -> 429;
status(locked) -> 429;
status(internal) -> 500;
status(too_large) -> 413;
status(C) when C =:= already_setup; C =:= email_taken; C =:= mobile_taken; C =:= username_taken;
               C =:= in_use; C =:= duplicate; C =:= already_associated; C =:= already_resolved;
               C =:= not_ready; C =:= already_enabled -> 409;
status(_) -> 400.

bearer(Headers) ->
    case maps:get("authorization", Headers, "") of
        "Bearer " ++ T -> list_to_binary(string:trim(T));
        "bearer " ++ T -> list_to_binary(string:trim(T));
        _ -> undefined
    end.

client_ip(Socket, Headers) ->
    case maps:find("x-real-ip", Headers) of
        {ok, Ip} -> Ip;
        error ->
            case inet:peername(Socket) of
                {ok, {Addr, _}} -> inet:ntoa(Addr);
                _ -> "unknown"
            end
    end.

read_json(Socket, Headers, BodyStart) ->
    case maps:find("content-length", Headers) of
        error -> {ok, #{}};
        {ok, LenStr} ->
            case string:to_integer(LenStr) of
                {0, []} -> {ok, #{}};
                {Len, []} when Len > 0, Len =< ?MAX_BODY ->
                    case read_bytes(Socket, BodyStart, Len) of
                        {ok, Bin} ->
                            case sd_util:jdec(Bin) of
                                {ok, M} when is_map(M) -> {ok, M};
                                _ -> {error, <<"Body must be a JSON object.">>}
                            end;
                        error -> {error, <<"Couldn't read the request body.">>}
                    end;
                {Len, []} when Len > ?MAX_BODY -> {error, <<"Body too large.">>};
                _ -> {error, <<"Bad Content-Length.">>}
            end
    end.

read_bytes(_Socket, Acc, Len) when byte_size(Acc) >= Len -> {ok, binary:part(Acc, 0, Len)};
read_bytes(Socket, Acc, Len) ->
    case gen_tcp:recv(Socket, 0, 8000) of
        {ok, Data} -> read_bytes(Socket, <<Acc/binary, Data/binary>>, Len);
        {error, _} -> error
    end.

send(Socket, Code, Body) ->
    Head = ["HTTP/1.1 ", integer_to_list(Code), " ", reason(Code), "\r\n",
            "Content-Type: application/json\r\n",
            "Content-Length: ", integer_to_list(byte_size(Body)), "\r\n",
            "Access-Control-Allow-Origin: ", cors_origin(), "\r\n",
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n",
            "Access-Control-Allow-Headers: Content-Type, Authorization\r\n",
            "Access-Control-Max-Age: 600\r\n",
            "X-Content-Type-Options: nosniff\r\n",
            "Cache-Control: no-store\r\n",
            "Connection: close\r\n\r\n"],
    gen_tcp:send(Socket, [Head, Body]).

cors_origin() ->
    case os:getenv("SANDESH_CORS_ORIGIN") of
        false -> "*";
        "" -> "*";
        O -> O
    end.

reason(200) -> "OK";
reason(204) -> "No Content";
reason(400) -> "Bad Request";
reason(401) -> "Unauthorized";
reason(403) -> "Forbidden";
reason(404) -> "Not Found";
reason(409) -> "Conflict";
reason(413) -> "Payload Too Large";
reason(429) -> "Too Many Requests";
reason(500) -> "Internal Server Error";
reason(_) -> "Error".
