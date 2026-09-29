%%% Serialises every write to the notification feed (sd_feed) on ONE process.
%%%
%%% Two reasons it exists:
%%%  1. Nothing that happens to a user (sending them a message, answering their approval, a login)
%%%     may wait on feed bookkeeping. Events are handed over with async/1 -- a cast, so the caller
%%%     returns immediately and a Redis hiccup or a slow write can never delay or fail the message,
%%%     approval or sign-in that caused it.
%%%  2. Items are read-modify-write JSON documents (a message bumps `count`, a user resolves the
%%%     same row). With one writer, two events can never interleave and lose an update; user
%%%     actions (read/resolve/dismiss/clear) use sync/1 so they queue behind the events already
%%%     in flight and the caller still gets its reply.
%%%
%%% A crash in one job is caught and logged; the worker carries on with the next.
-module(sd_feed_srv).
-behaviour(gen_server).

-export([start_link/0, async/1, sync/1]).
-export([init/1, handle_call/3, handle_cast/2, handle_info/2]).
-include_lib("kernel/include/logger.hrl").

start_link() -> gen_server:start_link({local, ?MODULE}, ?MODULE, [], []).

%% Fire and forget. Falls back to a plain spawned process if the worker isn't running (e.g. unit tests).
async(Fun) when is_function(Fun, 0) ->
    case whereis(?MODULE) of
        undefined -> spawn(fun() -> run(Fun) end), ok;
        _ -> gen_server:cast(?MODULE, {run, Fun})
    end.

%% Runs Fun in the worker's queue and returns its result.
sync(Fun) when is_function(Fun, 0) ->
    case whereis(?MODULE) of
        undefined -> Fun();
        _ ->
            try gen_server:call(?MODULE, {run, Fun}, 15000)
            catch exit:{timeout, _} -> {error, internal, <<"The notification service is busy; try again.">>}
            end
    end.

init([]) -> {ok, #{}}.

handle_call({run, Fun}, _From, State) -> {reply, run(Fun), State};
handle_call(_Msg, _From, State) -> {reply, ok, State}.

handle_cast({run, Fun}, State) -> run(Fun), {noreply, State};
handle_cast(_Msg, State) -> {noreply, State}.

handle_info(_Other, State) -> {noreply, State}.

run(Fun) ->
    try Fun()
    catch Class:Reason:Stack ->
        ?LOG_WARNING("sd_feed job failed: ~p:~p~n~p", [Class, Reason, Stack]),
        {error, internal, <<"Something went wrong on the server.">>}
    end.
