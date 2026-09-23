%%% Entry point. Run with:
%%%   erl -noshell -pa ebin -s chat_app start
%%% or, from a shell, chat_app:start().
%%% Optional args: [TcpPort] or [TcpPort, WebPort].
-module(chat_app).
-export([start/0, start/1, start_web_only/1]).

-define(DEFAULT_TCP_PORT, 5555).
-define(DEFAULT_WEB_PORT, 8080).

start() ->
    start([integer_to_list(?DEFAULT_TCP_PORT), integer_to_list(?DEFAULT_WEB_PORT)]).

start([TcpPortArg]) ->
    start([TcpPortArg, integer_to_list(?DEFAULT_WEB_PORT)]);
start([TcpPortArg, WebPortArg]) ->
    configure_logging(),
    {ok, _} = application:ensure_all_started(crypto),
    ok = chat_store:init(),
    TcpPort = to_port(TcpPortArg),
    WebPort = to_port(WebPortArg),
    {ok, _Pid} = chat_app_sup:start_link(TcpPort, WebPort),
    io:format("Chat server: raw TCP on port ~p, web UI on http://localhost:~p~n",
              [TcpPort, WebPort]),
    receive
        stop -> ok
    end.

%% For hosted deploys (Docker/Render/etc.) where only the web/WebSocket
%% port should ever be reachable -- omits the raw TCP listener entirely,
%% so there's no second open port for a host's port auto-detection to
%% mistakenly route external traffic to. That matters here specifically:
%% the raw TCP protocol reads the first line of ANY connection as a
%% username, so a stray non-chat connection (e.g. a platform's HTTP
%% health check) landing there gets registered as a "user" and spams the
%% chat room with fake join/leave/messages -- exactly what an HTTP HEAD
%% probe hitting that port looks like.
start_web_only([WebPortArg]) ->
    configure_logging(),
    {ok, _} = application:ensure_all_started(crypto),
    ok = chat_store:init(),
    WebPort = to_port(WebPortArg),
    {ok, _Pid} = chat_app_sup:start_link(undefined, WebPort),
    io:format("Chat server: web UI on http://localhost:~p (no raw TCP listener)~n", [WebPort]),
    receive
        stop -> ok
    end.

to_port(Port) when is_integer(Port) -> Port;
to_port(Port) when is_atom(Port) -> to_port(atom_to_list(Port));
to_port(Port) when is_list(Port) -> list_to_integer(Port).

%% OTP's kernel default logger level is `notice` -- that would silently
%% swallow the info-level connect/disconnect logs this app relies on for
%% "what's happening on this node right now" (see docs/DEBUGGING.md).
%% `info` is the default here: quiet enough for normal operation, loud
%% enough to see every connection lifecycle event without extra config.
%% Override with LOG_LEVEL=debug (also shows rejected handshakes, rate
%% limit hits) or LOG_LEVEL=warning (connections/disconnections silent,
%% only warnings/errors) as needed.
configure_logging() ->
    Level = case os:getenv("LOG_LEVEL") of
        false -> info;
        "" -> info;
        LevelStr -> list_to_atom(string:lowercase(LevelStr))
    end,
    logger:set_primary_config(level, Level).
