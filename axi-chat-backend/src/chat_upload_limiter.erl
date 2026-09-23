%%% Per-IP rate limit for POST /upload -- see chat.hrl's
%%% UPLOAD_RATE_LIMIT_MAX/UPLOAD_RATE_LIMIT_WINDOW_MS for the actual limits
%%% and why they're set where they are.
%%%
%%% Unlike the WS command rate limiter (chat_web.erl's check_rate_limit/0,
%%% which just uses the connection process's own dictionary -- each WS
%%% client is one long-lived process), an upload is a brand-new short-lived
%%% process on every single request (chat_web:start/1 spawns one, it
%%% handles exactly one HTTP request, then closes -- no keep-alive). There
%%% is no per-connection state to hold a counter in, so this needs to be
%%% shared, out-of-process state instead -- a small gen_server owning an
%%% ETS table, one row per IP, checked+incremented atomically by routing
%%% the check through this process (a gen_server:call serializes it, so two
%%% uploads arriving from the same IP at the exact same instant can't both
%%% read the same pre-increment count and both get let through).
%%%
%%% Table is owned by (and dies with) this process, not the caller, so a
%%% crash here just means every IP's rate-limit window resets on restart
%%% (chat_app_sup restarts this permanently) -- fail-open on a crash, not a
%%% way to lock a legitimate client out.
-module(chat_upload_limiter).
-behaviour(gen_server).
-include("chat.hrl").

-export([start_link/0, check/1]).
-export([init/1, handle_call/3, handle_cast/2, handle_info/2, terminate/2, code_change/3]).

-define(TABLE, ?MODULE).
%% Sweeps IPs whose window has long since expired, so a table that's seen
%% many distinct client IPs over the server's lifetime doesn't just grow
%% forever -- run far less often than the window itself, this is cleanup,
%% not part of the rate-limit logic (an expired-but-not-yet-swept row is
%% already handled correctly, and harmlessly, by check/1 itself).
-define(SWEEP_INTERVAL_MS, 300000).

start_link() ->
    gen_server:start_link({local, ?MODULE}, ?MODULE, [], []).

%% Ip is whatever chat_web.erl resolved the client to (a string -- either
%% the X-Real-IP header nginx sets, or the raw socket peer address when
%% there's no reverse proxy in front, e.g. local dev). Returns `ok` (and
%% counts this call against the window) or `limited`.
check(Ip) ->
    gen_server:call(?MODULE, {check, Ip}).

init([]) ->
    ets:new(?TABLE, [set, private, named_table]),
    erlang:send_after(?SWEEP_INTERVAL_MS, self(), sweep),
    {ok, #{}}.

handle_call({check, Ip}, _From, State) ->
    Now = erlang:monotonic_time(millisecond),
    Result = case ets:lookup(?TABLE, Ip) of
        [] ->
            ets:insert(?TABLE, {Ip, 1, Now}),
            ok;
        [{Ip, _Count, WindowStart}] when Now - WindowStart > ?UPLOAD_RATE_LIMIT_WINDOW_MS ->
            ets:insert(?TABLE, {Ip, 1, Now}),
            ok;
        [{Ip, Count, WindowStart}] when Count < ?UPLOAD_RATE_LIMIT_MAX ->
            ets:insert(?TABLE, {Ip, Count + 1, WindowStart}),
            ok;
        [{Ip, _Count, _WindowStart}] ->
            limited
    end,
    {reply, Result, State}.

handle_cast(_Msg, State) -> {noreply, State}.

handle_info(sweep, State) ->
    Now = erlang:monotonic_time(millisecond),
    %% A row is safe to drop once its window has expired -- check/1 would
    %% treat it as a fresh window anyway, this just reclaims the memory.
    ets:select_delete(?TABLE, [{{'_', '_', '$1'}, [{'>', {'-', Now, '$1'}, ?UPLOAD_RATE_LIMIT_WINDOW_MS}], [true]}]),
    erlang:send_after(?SWEEP_INTERVAL_MS, self(), sweep),
    {noreply, State};
handle_info(_Msg, State) -> {noreply, State}.

terminate(_Reason, _State) -> ok.
code_change(_Old, State, _Extra) -> {ok, State}.
