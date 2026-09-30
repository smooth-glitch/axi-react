%%% Runs Redis-backed jobs one after another on behalf of the routing servers (chat_room, chat_groups), so
%%% that those servers -- which hold the live "who is online" state -- never wait on Redis themselves.
%%%
%%% Why: chat_room used to call Redis inside its own handlers. When Redis stalled for more than the
%%% driver's 5 s call timeout, the handler crashed the whole server; its in-memory user registry was
%%% lost and nobody's messages were delivered until everyone reconnected. Now a stalled Redis only
%%% delays the jobs queued here; routing, presence, typing and /list keep answering, and a failing job
%%% is logged and dropped instead of taking anything down.
%%%
%%% Jobs run in the order they were submitted, so global messages keep their order, and
%%% read-modify-write jobs (reactions) never overlap.
-module(chat_writer).
-behaviour(gen_server).

-export([start_link/0, run/1, run_async/1]).
-export([init/1, handle_call/3, handle_cast/2, handle_info/2, terminate/2, code_change/3]).
-include_lib("kernel/include/logger.hrl").

start_link() -> gen_server:start_link({local, ?MODULE}, ?MODULE, [], []).

%% Fire and forget: Fun() runs later, in order. Never blocks the caller.
run_async(Fun) when is_function(Fun, 0) -> gen_server:cast(?MODULE, {run, Fun}).
run(Fun) -> run_async(Fun).

init([]) -> {ok, no_state}.

handle_call(_Req, _From, State) -> {reply, {error, unsupported}, State}.

handle_cast({run, Fun}, State) ->
    try Fun()
    catch Class:Reason:Stack ->
        ?LOG_ERROR("chat_writer job failed (dropped): ~p:~p at ~p", [Class, Reason, hd(Stack ++ [none])])
    end,
    {noreply, State};
handle_cast(_Msg, State) -> {noreply, State}.

handle_info(_Msg, State) -> {noreply, State}.
terminate(_Reason, _State) -> ok.
code_change(_Old, State, _Extra) -> {ok, State}.
