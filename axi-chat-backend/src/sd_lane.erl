%%% Keeps `/sd` work off the user's connection process, so a slow or stuck action can never freeze that user's chat.
%%%
%%% Before: `/sd <action>` ran inside the connection process. While it waited on Redis or an outside system,
%%% that user's messages, typing and pings sat in the mailbox unread.
%%%
%%% Now the connection only hands the request over and carries on:
%%%
%%%   ordinary actions    run one after another in the connection's own LANE (a helper process), so the replies
%%%                       come back in the order the requests were sent -- exactly as before.
%%%   slow actions        (calling a connected application, running a data source, starting a payment ...) run in
%%%                       their own parallel worker with a hard time limit, so they cannot hold the lane up.
%%%   auxiliary requests  (# command menu / suggestions) run in throw-away workers; replies are matched by reqId.
%%%
%%% Every reply travels back as {sd_push, Json}, the message the connection already writes to the socket.
%%% Nothing here waits on anything shared; when a connection ends its lane ends with it.
%%%
%%% Limits (so one client cannot pile up unbounded work): 200 queued ordinary actions, 4 slow actions in flight,
%%% 8 auxiliary requests in flight. Beyond that the request is answered at once with a `busy` error.
-module(sd_lane).
-export([submit/2, aux/1, slow_actions/0, is_slow/1]).

-define(MAX_QUEUE, 200).
-define(MAX_SLOW, 4).
-define(MAX_AUX, 8).
-define(SLOW_LIMIT_MS, 30000).

%% The hard stop for a slow action (env SANDESH_SLOW_LIMIT_MS overrides; used by the tests).
slow_limit() ->
    case os:getenv("SANDESH_SLOW_LIMIT_MS") of
        false -> ?SLOW_LIMIT_MS;
        V -> try max(100, list_to_integer(V)) catch _:_ -> ?SLOW_LIMIT_MS end
    end.

%% Actions that talk to the outside world (or may run long). Everything else is a short read/write in our own store.
slow_actions() ->
    [<<"datasource.run">>, <<"datasource.test">>, <<"option.run">>, <<"appconn.test">>, <<"pay.create">>,
     <<"pay.status">>, <<"wizard.step">>, <<"wizard.start">>, <<"admin.appconn.test">>, <<"admin.datasource.test">>,
     <<"test.slow_sleep">>].

is_slow(Action) -> lists:member(Action, slow_actions()).

%% Line is what follows "/sd " -- "action" or "action {json}". Returns at once.
submit(Name, Line) ->
    Action = action_of(Line),
    case is_slow(Action) of
        true -> submit_slow(Name, Line, Action);
        false -> submit_ordered(Name, Line, Action)
    end.

%% A throw-away worker for something that must not block the connection (menu suggestions and the like).
%% Fun() returns a JSON binary (the reply) or `none`. Over the in-flight cap the request is dropped: these are
%% debounced and stale replies are ignored by the client anyway.
aux(Fun) when is_function(Fun, 0) ->
    Conn = self(),
    Session = get(sd_session),
    Ctr = counter(aux),
    case take(Ctr, ?MAX_AUX) of
        false -> ok;
        true ->
            _ = spawn(fun() ->
                try
                    case Session of undefined -> ok; _ -> put(sd_session, Session) end,
                    case Fun() of
                        Bin when is_binary(Bin); is_list(Bin) -> Conn ! {sd_push, iolist_to_binary(Bin)};
                        _ -> ok
                    end
                catch _:_ -> ok
                after release(Ctr)
                end
            end),
            ok
    end.

%% ---- ordinary actions: one lane per connection -----------------------------------------------------------

submit_ordered(Name, Line, Action) ->
    Lane = lane(Name),
    case erlang:process_info(Lane, message_queue_len) of
        {message_queue_len, N} when N >= ?MAX_QUEUE -> busy(Line, Action);
        undefined -> erase(sd_lane), submit_ordered(Name, Line, Action);   %% lane died: start a new one
        _ -> Lane ! {job, Line}, ok
    end.

lane(Name) ->
    case get(sd_lane) of
        Pid when is_pid(Pid) ->
            case is_process_alive(Pid) of
                true -> Pid;
                false -> erase(sd_lane), lane(Name)
            end;
        _ ->
            Conn = self(),
            Session = get(sd_session),
            Pid = spawn(fun() -> lane_loop(Conn, Name, Session) end),
            put(sd_lane, Pid),
            Pid
    end.

lane_loop(Conn, Name, Session) ->
    Ref = erlang:monitor(process, Conn),
    case Session of undefined -> ok; _ -> put(sd_session, Session) end,
    lane_loop(Conn, Name, Ref, ok).

lane_loop(Conn, Name, Ref, _) ->
    receive
        {job, Line} ->
            Conn ! {sd_push, run(Name, Line)},
            lane_loop(Conn, Name, Ref, ok);
        {'DOWN', Ref, process, _, _} -> ok
    end.

run(Name, Line) ->
    try sd_cmds:handle(Name, Line)
    catch Class:Reason:Stack ->
        logger:error("sd lane: ~s crashed: ~p:~p at ~p", [action_of(Line), Class, Reason, hd(Stack ++ [none])]),
        failure(Line, <<"Something went wrong on the server.">>)
    end.

%% ---- slow actions: parallel, time-limited -----------------------------------------------------------------

submit_slow(Name, Line, Action) ->
    Conn = self(),
    Session = get(sd_session),
    Ctr = counter(slow),
    case take(Ctr, ?MAX_SLOW) of
        false -> busy(Line, Action);
        true ->
            _ = spawn(fun() ->
                Me = self(),
                Runner = spawn(fun() ->
                    case Session of undefined -> ok; _ -> put(sd_session, Session) end,
                    Me ! {done, self(), run(Name, Line)}
                end),
                Reply = receive
                            {done, Runner, Bin} -> Bin
                        after slow_limit() ->
                            exit(Runner, kill),
                            failure(Line, <<"That took too long and was stopped. Try again.">>, timeout)
                        end,
                release(Ctr),
                Conn ! {sd_push, Reply}
            end),
            ok
    end.

%% ---- replies that are ours (not from sd_cmds) -------------------------------------------------------------

busy(Line, _Action) ->
    self() ! {sd_push, failure(Line, <<"Too many requests at once -- wait a moment and retry.">>, busy)},
    ok.

failure(Line, Msg) -> failure(Line, Msg, internal).
failure(Line, Msg, Code) ->
    ReqId = case body_of(Line) of
                <<>> -> null;
                Body -> case sd_util:jdec(Body) of {ok, M} when is_map(M) -> maps:get(<<"reqId">>, M, null); _ -> null end
            end,
    sd_util:jenc(#{<<"type">> => <<"sd">>, <<"action">> => action_of(Line), <<"reqId">> => ReqId, <<"ok">> => false,
                   <<"error">> => #{<<"code">> => atom_to_binary(Code, utf8), <<"message">> => Msg}}).

%% ---- small helpers -----------------------------------------------------------------------------------------

action_of(Line) ->
    Bin = string:trim(sd_util:b(Line)),
    hd(binary:split(Bin, <<" ">>)).

body_of(Line) ->
    Bin = string:trim(sd_util:b(Line)),
    case binary:split(Bin, <<" ">>) of
        [_, B] -> string:trim(B);
        _ -> <<>>
    end.

%% In-flight counters, one per kind per connection (atomics: a worker releases from its own process).
counter(Kind) ->
    Key = {sd_lane_counter, Kind},
    case get(Key) of
        undefined -> C = atomics:new(1, []), put(Key, C), C;
        C -> C
    end.

take(Ctr, Max) ->
    case atomics:add_get(Ctr, 1, 1) of
        N when N > Max -> atomics:sub(Ctr, 1, 1), false;
        _ -> true
    end.

release(Ctr) -> atomics:sub(Ctr, 1, 1).
