%%% HTTP JSON API for everything that happens BEFORE a WebSocket exists:
%%% first-run organisation setup, self-registration, OTP, login, sessions.
%%% Routed here from chat_web's dispatch for any path under /api/sd/.
%%%
%%%   GET  /api/sd/public              names for the registration form + whether setup is done
%%%   POST /api/sd/setup/start         {org, name, username?, email, mobile, setupToken?}  -> sends OTP
%%%   POST /api/sd/setup/verify        {otp}  -> creates the org + first administrator, returns a session
%%%   POST /api/sd/register            self-registration -> pending, sent to a host for approval
%%%   POST /api/sd/otp/send            {identifier}
%%%   POST /api/sd/login               {identifier, password?, otp?}  -> {token, user, ...}
%%%   POST /api/sd/logout              (Bearer)
%%%   GET  /api/sd/session             (Bearer) -> current user, or 401
%%%   POST /api/sd/password/change     (Bearer) {oldPassword?, newPassword}
%%%   POST /api/sd/admin/unlock/start  (Bearer) sends the admin-console OTP
%%%   POST /api/sd/admin/unlock        (Bearer) {password, otp}
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
handle(Socket, Method, Path, _Query, Headers, BodyStart) ->
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
route(Socket, "GET", "/api/sd/session", H, _B) ->
    case bearer(H) of
        undefined -> fail(Socket, {error, unauthenticated, <<"Missing Authorization: Bearer <token>.">>});
        Token ->
            case sd_auth:session(Token) of
                {ok, User, State} ->
                    ok_(Socket, #{<<"user">> => User, <<"password">> => State,
                                  <<"sessionExpiresTs">> => sd_auth:session_expires(Token),
                                  <<"otpDue">> => not sd_auth:otp_fresh(User),
                                  <<"mode">> => atom_to_binary(sd_util:mode(), utf8)});
                error -> fail(Socket, {error, unauthenticated, <<"Session expired. Sign in again.">>})
            end
    end;
route(Socket, "POST", Path, Headers, BodyStart) ->
    case read_json(Socket, Headers, BodyStart) of
        {ok, Body} -> post(Socket, Path, Body, Headers);
        {error, Msg} -> fail(Socket, {error, bad_request, Msg})
    end;
route(Socket, _Method, _Path, _H, _B) ->
    fail(Socket, {error, not_found, <<"No such endpoint.">>}).

post(Socket, "/api/sd/setup/start", Body, H) ->
    respond(Socket, sd_auth:setup_start(Body, client_ip(Socket, H)));
post(Socket, "/api/sd/setup/verify", Body, H) ->
    respond(Socket, sd_auth:setup_verify(Body, client_ip(Socket, H)));
post(Socket, "/api/sd/register", Body, H) ->
    respond(Socket, self_register(Body, client_ip(Socket, H)));
post(Socket, "/api/sd/otp/send", Body, H) ->
    respond(Socket, sd_auth:otp_send(Body, client_ip(Socket, H)));
post(Socket, "/api/sd/login", Body, H) ->
    respond(Socket, sd_auth:login(Body, client_ip(Socket, H)));
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
post(Socket, _Path, _Body, _H) ->
    fail(Socket, {error, not_found, <<"No such endpoint.">>}).

%% ---- self-registration ----------------------------------------------------------------------
%% "Users can register into the system themselves ... The onboarding
%% approval will be sent to the host who can approve their onboarding."
self_register(Body, Ip) ->
    case {sd_org:setup_done(), sd_db:rate(["register:", Ip], 10, 3600)} of
        {false, _} -> {error, not_ready, <<"This organisation hasn't been set up yet.">>};
        {_, limited} -> {error, rate_limited, <<"Too many registrations from here; try later.">>};
        _ ->
            case sd_users:create(Body, #{mode => register, actor => <<"self">>,
                                         status => <<"pending">>}) of
                {ok, User} ->
                    {ok, Req} = sd_reqs:create_onboarding(User),
                    {ok, #{<<"registered">> => true, <<"status">> => <<"pending">>,
                           <<"username">> => maps:get(<<"username">>, User),
                           <<"requestId">> => maps:get(<<"id">>, Req),
                           <<"awaitingApprovalFrom">> => length(maps:get(<<"approvers">>, Req))}};
                Err -> Err
            end
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
status(C) when C =:= already_setup; C =:= email_taken; C =:= mobile_taken; C =:= username_taken;
               C =:= in_use; C =:= duplicate; C =:= already_associated; C =:= already_resolved;
               C =:= not_ready -> 409;
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
reason(429) -> "Too Many Requests";
reason(500) -> "Internal Server Error";
reason(_) -> "Error".
