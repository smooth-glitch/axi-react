%%% Fires due reminders. One tiny process that wakes every few seconds and
%%% asks sd_cards to notify anyone whose reminder time has come.
%%%
%%% Deliberately fragile-proof: a Redis hiccup during a tick is logged and
%%% skipped, never crashed on -- a crash here would count against the
%%% supervisor's restart budget (see chat_app_sup) and, with enough of them,
%%% take the whole node down over something that only delays a reminder by
%%% a few seconds. Reminders aren't lost: they stay in Redis until claimed.
%%%
%%% SANDESH_SCHEDULER_TICK_MS (default 15000) sets the wake-up interval; a
%%% reminder is therefore delivered at most one tick late.
-module(sd_scheduler).
-behaviour(gen_server).

-export([start_link/0]).
-export([init/1, handle_call/3, handle_cast/2, handle_info/2]).
-include_lib("kernel/include/logger.hrl").

start_link() ->
    gen_server:start_link({local, ?MODULE}, ?MODULE, [], []).

init([]) ->
    schedule(),
    {ok, #{}}.

handle_call(_Msg, _From, State) -> {reply, ok, State}.
handle_cast(_Msg, State) -> {noreply, State}.

handle_info(tick, State) ->
    try sd_cards:fire_due()
    catch Class:Reason ->
        ?LOG_WARNING("sd_scheduler tick skipped: ~p:~p", [Class, Reason])
    end,
    schedule(),
    {noreply, State};
handle_info(_Other, State) ->
    {noreply, State}.

schedule() ->
    erlang:send_after(tick_ms(), self(), tick).

tick_ms() ->
    case os:getenv("SANDESH_SCHEDULER_TICK_MS") of
        false -> 15000;
        S -> case string:to_integer(S) of {N, []} when N >= 100 -> N; _ -> 15000 end
    end.
