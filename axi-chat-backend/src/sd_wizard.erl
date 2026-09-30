%%% Wizards (#wizard): a guided, multi-step process an administrator designs and people run.
%%%
%%% A wizard is a list of steps. Each step may have a `condition` (over the person's global variables and the
%%% answers so far) -- a step whose condition is false is skipped, which is how a wizard branches.
%%% Step types:
%%%   input      fill a form (inline `fields`, or the fields of a T-Struct named in `target`)
%%%   upload     attach a file the person has uploaded (POST /api/sd/files) -- optional `accept` extensions
%%%   download   show a file (`file` = an uploaded file id) and/or text to read; the person acknowledges it
%%%   approval   waits for someone with the given `approverRoles` and/or `approverDesignations`
%%%              (both given = must have both); no one matching -> administrators. Uses the normal approvals inbox.
%%%   pay        the person records a payment `reference` for `amount`; optional `verifyDatasource` confirms it
%%%   decision   pick one of `choices`
%%%   list       pick one (or `multi`) from static `options`, a data source (`datasource`,`valueColumn`,
%%%              `labelColumn`) or the catalog (`catalog`: product|service)
%%%   summary    shows every answer; confirming it finishes the run
%%% A run keeps its answers, can be left and resumed, cancelled, and is visible to its owner, administrators
%%% and its approvers.
%%%
%%% Actions that may wait on outside systems (a data source, a payment check) are the slow ones in sd_lane.
-module(sd_wizard).
-export([list_defs/0, get_def/1, save_def/1, delete_def/1, list_for/1, get_for/2,
         start/2, current/2, step/3, cancel/2, runs/1, run_view/2, approval_done/3, file_visible/2, step_types/0]).

-compile({no_auto_import, [get/1]}).

-define(DEFS, "sd:wizards").
-define(RUNS, "sd:wizruns").
-define(TYPES, [<<"input">>, <<"upload">>, <<"download">>, <<"approval">>, <<"pay">>, <<"decision">>,
                <<"list">>, <<"summary">>]).
-define(MAX_STEPS, 40).
-define(MAX_OPEN, 20).

step_types() -> ?TYPES.

key(N) -> string:lowercase(string:trim(sd_util:s(N))).
ident(N) -> is_binary(N) andalso re:run(N, "^[A-Za-z][A-Za-z0-9_]{0,39}$", [{capture, none}]) =:= match.
txt(V, Max) when is_binary(V) -> T = string:trim(V), binary:part(T, 0, min(Max, byte_size(T)));
txt(_, _) -> <<>>.

%% =============================================================================
%% Definitions
%% =============================================================================

list_defs() ->
    lists:sort(fun(A, B) -> maps:get(<<"name">>, A) =< maps:get(<<"name">>, B) end,
               [W || {_, W} <- sd_db:hgetall_json(?DEFS), is_map(W)]).

get_def(Name) -> sd_db:hget_json(?DEFS, key(Name)).

delete_def(Name) ->
    case get_def(Name) of
        undefined -> {error, not_found, <<"No such wizard.">>};
        W -> sd_db:hdel(?DEFS, key(maps:get(<<"name">>, W))), ok
    end.

save_def(Raw) when is_map(Raw) ->
    Name = sd_util:get(<<"name">>, Raw),
    Steps0 = sd_util:get(<<"steps">>, Raw, []),
    case {ident(Name), is_list(Steps0) andalso Steps0 =/= [] andalso length(Steps0) =< ?MAX_STEPS} of
        {false, _} -> {error, invalid, <<"name must be letters/digits/underscore, starting with a letter.">>};
        {_, false} -> {error, invalid, <<"steps must be a list of 1 to 40 steps.">>};
        _ ->
            case {sd_config:validate_applicable(sd_util:get(<<"applicable">>, Raw, #{})),
                  wizard_condition(sd_util:get(<<"condition">>, Raw, null))} of
                {{error, _, _} = E, _} -> E;
                {_, {error, _, _} = E} -> E;
                {{ok, Ap}, {ok, Cond}} ->
                    case check_steps(Steps0, [], []) of
                        {ok, Steps} ->
                            Def = #{<<"name">> => Name, <<"caption">> => nz(txt(sd_util:get(<<"caption">>, Raw), 120), Name),
                                    <<"description">> => txt(sd_util:get(<<"description">>, Raw), 500),
                                    <<"applicable">> => Ap, <<"condition">> => Cond,
                                    <<"active">> => sd_util:get(<<"active">>, Raw, true) =/= false,
                                    <<"steps">> => Steps, <<"modifiedTs">> => sd_util:now_ms()},
                            sd_db:hset_json(?DEFS, key(Name), Def),
                            {ok, Def};
                        E -> E
                    end
            end
    end;
save_def(_) -> {error, bad_request, <<"Expected a JSON object.">>}.

nz(<<>>, D) -> D;
nz(V, _) -> V.

wizard_condition(null) -> {ok, null};
wizard_condition(C) when is_map(C) ->
    case sd_config:valid_cond(C, any) andalso lists:all(fun(F) -> lists:member(F, sd_globals:known()) end, sd_globals:referenced(C)) of
        true -> {ok, C};
        false -> {error, invalid, <<"condition is malformed or refers to an unknown variable.">>}
    end;
wizard_condition(_) -> {error, invalid, <<"condition must be an object or null.">>}.

check_steps([], _Seen, Acc) -> {ok, lists:reverse(Acc)};
check_steps([S | Rest], Seen, Acc) when is_map(S) ->
    Id = sd_util:get(<<"id">>, S),
    Type = sd_util:get(<<"type">>, S),
    Idx = length(Acc) + 1,
    Where = fun(Msg) -> {error, invalid, iolist_to_binary([<<"Step ">>, integer_to_binary(Idx), <<": ">>, Msg])} end,
    case {ident(Id), lists:member(Type, ?TYPES), lists:member(Id, Seen)} of
        {false, _, _} -> Where(<<"id must be letters/digits/underscore, starting with a letter.">>);
        {_, false, _} -> Where(iolist_to_binary([<<"type must be one of ">>, lists:join(<<", ">>, ?TYPES)]));
        {_, _, true} -> Where(<<"duplicate step id.">>);
        _ ->
            case step_condition(sd_util:get(<<"condition">>, S, null), Seen) of
                {error, _, M} -> Where(M);
                {ok, Cond} ->
                    case check_step(Type, S) of
                        {ok, Cfg} ->
                            Step = Cfg#{<<"id">> => Id, <<"type">> => Type,
                                        <<"caption">> => nz(txt(sd_util:get(<<"caption">>, S), 120), Id),
                                        <<"condition">> => Cond},
                            check_steps(Rest, [Id | Seen], [Step | Acc]);
                        {error, _, M} -> Where(M)
                    end
            end
    end;
check_steps(_, _, _) -> {error, invalid, <<"Each step must be an object.">>}.

%% A step's condition may name global variables, earlier step ids, or "<stepId>.<field>" of an earlier input step.
step_condition(null, _) -> {ok, null};
step_condition(C, Seen) when is_map(C) ->
    Refs = sd_globals:referenced(C),
    Base = fun(F) -> hd(binary:split(F, <<".">>)) end,
    Known = sd_globals:known() ++ Seen,
    case sd_config:valid_cond(C, any) andalso length(Refs) =< 50 andalso lists:all(fun(F) -> lists:member(Base(F), Known) end, Refs) of
        true -> {ok, C};
        false -> {error, invalid, <<"condition is malformed or refers to something that isn't a variable or an earlier step.">>}
    end;
step_condition(_, _) -> {error, invalid, <<"condition must be an object or null.">>}.

check_step(<<"input">>, S) ->
    case {sd_util:get(<<"target">>, S), sd_util:get(<<"fields">>, S)} of
        {T, _} when is_binary(T), T =/= <<>> ->
            case sd_config:get_tstruct(T) of
                undefined -> {error, invalid, <<"Unknown T-Struct in target.">>};
                D -> {ok, #{<<"target">> => maps:get(<<"name">>, D)}}
            end;
        {_, F} when is_list(F) ->
            case sd_config:validate_fields(F) of
                {ok, Fields} -> {ok, #{<<"fields">> => Fields}};
                {error, _, _} = E -> E
            end;
        _ -> {error, invalid, <<"an input step needs fields or a target T-Struct.">>}
    end;
check_step(<<"upload">>, S) ->
    Acc = case sd_util:get(<<"accept">>, S, []) of
              L when is_list(L) -> [string:lowercase(string:trim(X, leading, ".")) || X <- L, is_binary(X), X =/= <<>>];
              _ -> []
          end,
    {ok, #{<<"accept">> => lists:sublist(Acc, 20)}};
check_step(<<"download">>, S) ->
    File = sd_util:get(<<"file">>, S, null),
    Text = txt(sd_util:get(<<"text">>, S), 2000),
    case {File, Text} of
        {null, <<>>} -> {error, invalid, <<"a download step needs a file or some text.">>};
        {null, _} -> {ok, #{<<"file">> => null, <<"text">> => Text}};
        {F, _} when is_binary(F) ->
            case sd_files:get(F) of
                undefined -> {error, invalid, <<"Unknown file (upload it first).">>};
                _ -> {ok, #{<<"file">> => F, <<"text">> => Text}}
            end;
        _ -> {error, invalid, <<"file must be an uploaded file id.">>}
    end;
check_step(<<"approval">>, S) ->
    Roles = names(sd_util:get(<<"approverRoles">>, S, [])),
    Desigs = names(sd_util:get(<<"approverDesignations">>, S, [])),
    RoleN = [canon(R, [maps:get(<<"name">>, X) || X <- sd_org:list(roles)]) || R <- Roles],
    DesN = [canon(D, [maps:get(<<"name">>, X) || X <- sd_org:list(designations)]) || D <- Desigs],
    case {Roles ++ Desigs, lists:member(undefined, RoleN), lists:member(undefined, DesN)} of
        {[], _, _} -> {error, invalid, <<"an approval step needs approverRoles and/or approverDesignations.">>};
        {_, true, _} -> {error, invalid, <<"Unknown role in approverRoles.">>};
        {_, _, true} -> {error, invalid, <<"Unknown designation in approverDesignations.">>};
        _ -> {ok, #{<<"approverRoles">> => RoleN, <<"approverDesignations">> => DesN,
                    <<"message">> => txt(sd_util:get(<<"message">>, S), 300)}}
    end;
check_step(<<"pay">>, S) ->
    Amount = sd_util:get(<<"amount">>, S),
    Ver = sd_util:get(<<"verifyDatasource">>, S, null),
    case {is_number(Amount) andalso Amount > 0, Ver =:= null orelse (is_binary(Ver) andalso sd_datasource:get(Ver) =/= undefined)} of
        {false, _} -> {error, invalid, <<"amount must be a number above 0.">>};
        {_, false} -> {error, invalid, <<"Unknown data source in verifyDatasource.">>};
        _ -> {ok, #{<<"amount">> => Amount, <<"currency">> => nz(txt(sd_util:get(<<"currency">>, S), 8), <<"INR">>),
                    <<"description">> => txt(sd_util:get(<<"description">>, S), 200), <<"verifyDatasource">> => Ver}}
    end;
check_step(<<"decision">>, S) ->
    case sd_util:get(<<"choices">>, S) of
        L when is_list(L), length(L) >= 2, length(L) =< 20 ->
            Cs = [txt(C, 60) || C <- L, is_binary(C)],
            case length(Cs) =:= length(L) andalso not lists:member(<<>>, Cs) andalso length(lists:usort(Cs)) =:= length(Cs) of
                true -> {ok, #{<<"choices">> => Cs}};
                false -> {error, invalid, <<"choices must be 2 to 20 different, non-empty texts.">>}
            end;
        _ -> {error, invalid, <<"choices must be 2 to 20 different, non-empty texts.">>}
    end;
check_step(<<"list">>, S) ->
    Multi = sd_util:get(<<"multi">>, S, false) =:= true,
    case {sd_util:get(<<"options">>, S), sd_util:get(<<"datasource">>, S), sd_util:get(<<"catalog">>, S)} of
        {L, _, _} when is_list(L), L =/= [], length(L) =< 200 ->
            Opts = [opt(O) || O <- L],
            case lists:member(bad, Opts) of
                true -> {error, invalid, <<"options must be texts or {value,label} objects.">>};
                false -> {ok, #{<<"options">> => Opts, <<"multi">> => Multi}}
            end;
        {_, D, _} when is_binary(D) ->
            V = sd_util:get(<<"valueColumn">>, S), Lb = sd_util:get(<<"labelColumn">>, S, V),
            case {sd_datasource:get(D), is_binary(V), is_binary(Lb)} of
                {undefined, _, _} -> {error, invalid, <<"Unknown data source.">>};
                {_, true, true} -> {ok, #{<<"datasource">> => D, <<"valueColumn">> => V, <<"labelColumn">> => Lb, <<"multi">> => Multi}};
                _ -> {error, invalid, <<"valueColumn is required with a data source.">>}
            end;
        {_, _, K} when K =:= <<"product">>; K =:= <<"service">> ->
            {ok, #{<<"catalog">> => K, <<"multi">> => Multi}};
        _ -> {error, invalid, <<"a list step needs options, a datasource or a catalog.">>}
    end;
check_step(<<"summary">>, _S) -> {ok, #{}}.

opt(V) when is_binary(V), V =/= <<>> -> #{<<"value">> => txt(V, 100), <<"label">> => txt(V, 100)};
opt(#{<<"value">> := V} = M) when is_binary(V), V =/= <<>> ->
    #{<<"value">> => txt(V, 100), <<"label">> => nz(txt(maps:get(<<"label">>, M, V), 100), V)};
opt(_) -> bad.

names(L) when is_list(L) -> [T || X <- L, is_binary(X), T <- [string:trim(X)], T =/= <<>>];
names(_) -> [].
canon(N, Known) ->
    case [K || K <- Known, string:lowercase(K) =:= string:lowercase(N)] of [K | _] -> K; [] -> undefined end.

%% =============================================================================
%% What a person sees
%% =============================================================================

list_for(User) ->
    Vars = sd_globals:values(User),
    [brief(W) || W <- list_defs(), maps:get(<<"active">>, W, true), sd_config:applies(W, User, Vars)].

brief(W) -> (maps:with([<<"name">>, <<"caption">>, <<"description">>], W))#{<<"steps">> => length(maps:get(<<"steps">>, W))}.

get_for(User, Name) ->
    case get_def(Name) of
        #{<<"active">> := true} = W ->
            case sd_config:applies(W, User) of
                true -> {ok, W};
                false -> {error, not_found, <<"No such wizard.">>}
            end;
        _ -> {error, not_found, <<"No such wizard.">>}
    end.

%% =============================================================================
%% Runs
%% =============================================================================

runs_index(User) -> "sd:wizruns:u:" ++ sd_util:s(User).

get_run(Id) when is_integer(Id) -> sd_db:hget_json(?RUNS, integer_to_list(Id));
get_run(_) -> undefined.
put_run(Run) ->
    R = Run#{<<"updatedTs">> => sd_util:now_ms()},
    sd_db:hset_json(?RUNS, integer_to_list(maps:get(<<"id">>, R)), R),
    R.

runs(User) ->
    Me = maps:get(<<"username">>, User),
    Ids = sd_db:zrevrange(runs_index(Me), 0, 49),
    [brief_run(R) || B <- Ids, R <- [sd_db:hget_json(?RUNS, binary_to_list(B))], is_map(R)].

brief_run(R) -> maps:with([<<"id">>, <<"wizard">>, <<"caption">>, <<"status">>, <<"stepId">>, <<"createdTs">>, <<"updatedTs">>, <<"finishedTs">>], R).

is_open(#{<<"status">> := S}) -> S =:= <<"running">> orelse S =:= <<"waiting">>.

start(User, Name) ->
    case get_for(User, Name) of
        {error, _, _} = E -> E;
        {ok, W} ->
            Me = maps:get(<<"username">>, User),
            Open = [R || R <- runs(User), is_open(R)],
            case length(Open) >= ?MAX_OPEN of
                true -> {error, too_many, <<"You have too many wizards open; finish or cancel some.">>};
                false ->
                    Id = sd_db:incr("sd:seq:wizrun"),
                    Now = sd_util:now_ms(),
                    Run0 = #{<<"id">> => Id, <<"wizard">> => maps:get(<<"name">>, W), <<"caption">> => maps:get(<<"caption">>, W),
                             <<"by">> => Me, <<"status">> => <<"running">>, <<"stepId">> => null, <<"stepIdx">> => 0,
                             <<"answers">> => #{}, <<"approvers">> => [], <<"waitingReq">> => null,
                             <<"createdTs">> => Now, <<"finishedTs">> => null},
                    Run = put_run(advance(W, Run0, User, 1)),
                    sd_db:zadd(runs_index(Me), Now, integer_to_binary(Id)),
                    view(W, Run, User)
            end
    end.

%% Where the run is now (and what to show). Resuming after leaving.
current(User, RunId) ->
    case own_run(User, RunId) of
        {ok, Run, W} -> view(W, Run, User);
        E -> E
    end.

own_run(User, RunId) ->
    case get_run(RunId) of
        #{<<"by">> := By} = Run ->
            case By =:= maps:get(<<"username">>, User) of
                true ->
                    case get_def(maps:get(<<"wizard">>, Run)) of
                        undefined -> {error, not_found, <<"That wizard no longer exists.">>};
                        W -> {ok, Run, W}
                    end;
                false -> {error, not_found, <<"No such run.">>}
            end;
        _ -> {error, not_found, <<"No such run.">>}
    end.

cancel(User, RunId) ->
    Me = maps:get(<<"username">>, User),
    case get_run(RunId) of
        #{<<"by">> := Me} = Run ->
            case is_open(Run) of
                false -> {error, already_finished, <<"That run is already finished.">>};
                true ->
                    R = put_run(Run#{<<"status">> => <<"cancelled">>, <<"waitingReq">> => null, <<"finishedTs">> => sd_util:now_ms()}),
                    {ok, brief_run(R)}
            end;
        _ -> {error, not_found, <<"No such run.">>}
    end.

%% Answer the current step. Body: {runId, step, value}
step(User, RunId, Body) ->
    case own_run(User, RunId) of
        {error, _, _} = E -> E;
        {ok, Run, W} ->
            StepId = sd_util:get(<<"step">>, Body),
            Current = maps:get(<<"stepId">>, Run),
            case maps:get(<<"status">>, Run) of
                <<"waiting">> -> {error, waiting, <<"This step is waiting for an approval.">>};
                S when S =/= <<"running">> -> {error, already_finished, <<"That run is already finished.">>};
                _ when StepId =/= Current -> {error, stale, <<"That isn't the current step.">>};
                _ ->
                    Step = current_step(W, Run),
                    case answer(Step, sd_util:get(<<"value">>, Body), User, Run) of
                        {error, _, _} = E -> E;
                        {error, _, _, _} = E -> E;
                        {ok, Ans} ->
                            Answers = (maps:get(<<"answers">>, Run))#{StepId => Ans},
                            Run1 = Run#{<<"answers">> => Answers, <<"lastAnswered">> => StepId},
                            note_files(Step, Ans, Run1),
                            Idx = maps:get(<<"stepIdx">>, Run1),
                            Run2 = case maps:get(<<"type">>, Step) of
                                       <<"summary">> -> finish(Run1, <<"done">>);
                                       _ -> advance(W, Run1, User, Idx + 1)
                                   end,
                            R = put_run(Run2),
                            view(W, R, User)
                    end
            end
    end.

current_step(W, Run) ->
    lists:nth(maps:get(<<"stepIdx">>, Run), maps:get(<<"steps">>, W)).

finish(Run, Status) ->
    Run#{<<"status">> => Status, <<"stepId">> => null, <<"waitingReq">> => null, <<"finishedTs">> => sd_util:now_ms()}.

%% Moves to the first step at or after From whose condition holds; an approval step raises its request and waits.
advance(W, Run, User, From) ->
    Steps = maps:get(<<"steps">>, W),
    Vars = vars(User, maps:get(<<"answers">>, Run)),
    case find_step(Steps, From, Vars) of
        none -> finish(Run, <<"done">>);
        {Idx, #{<<"type">> := <<"approval">>} = Step} ->
            Run1 = Run#{<<"stepIdx">> => Idx, <<"stepId">> => maps:get(<<"id">>, Step)},
            Approvers = approvers(Step, maps:get(<<"by">>, Run)),
            Msg = nz(maps:get(<<"message">>, Step, <<>>), maps:get(<<"caption">>, Step)),
            {ok, Req} = sd_reqs:create_wizard(maps:get(<<"by">>, Run), Approvers,
                                              #{<<"runId">> => maps:get(<<"id">>, Run), <<"stepId">> => maps:get(<<"id">>, Step),
                                                <<"wizard">> => maps:get(<<"caption">>, W), <<"message">> => Msg}),
            Run1#{<<"status">> => <<"waiting">>, <<"waitingReq">> => maps:get(<<"id">>, Req),
                  <<"approvers">> => lists:usort(maps:get(<<"approvers">>, Run, []) ++ Approvers)};
        {Idx, Step} ->
            Run#{<<"stepIdx">> => Idx, <<"stepId">> => maps:get(<<"id">>, Step), <<"status">> => <<"running">>}
    end.

find_step(Steps, From, Vars) ->
    Indexed = lists:zip(lists:seq(1, length(Steps)), Steps),
    case [{I, S} || {I, S} <- Indexed, I >= From, sd_config:eval(maps:get(<<"condition">>, S, null), Vars)] of
        [First | _] -> First;
        [] -> none
    end.

%% Global variables + the answers so far (a step's answer under its id; an input step's fields also as "<id>.<field>").
vars(User, Answers) ->
    maps:fold(fun(Id, Ans, Acc) when is_map(Ans) ->
                      maps:fold(fun(F, V, A) -> A#{<<Id/binary, ".", F/binary>> => V} end, Acc, Ans);
                 (Id, Ans, Acc) -> Acc#{Id => Ans}
              end, sd_globals:values(User), Answers).

approvers(Step, Requester) ->
    Roles = [string:lowercase(R) || R <- maps:get(<<"approverRoles">>, Step, [])],
    Desigs = [string:lowercase(D) || D <- maps:get(<<"approverDesignations">>, Step, [])],
    Match = fun(U) ->
                maps:get(<<"username">>, U) =/= Requester andalso sd_users:is_active(U) andalso
                (Roles =:= [] orelse lists:any(fun(R) -> lists:member(string:lowercase(R), Roles) end, sd_users:roles_of(U))) andalso
                (Desigs =:= [] orelse (case sd_util:get(<<"designation">>, U) of
                                           D when is_binary(D) -> lists:member(string:lowercase(D), Desigs);
                                           _ -> false
                                       end))
            end,
    case [maps:get(<<"username">>, U) || U <- sd_users:list(), Match(U)] of
        [] -> [maps:get(<<"username">>, A) || A <- sd_users:admins()];
        L -> L
    end.

%% ---- answering each kind of step --------------------------------------------------------------------------------

answer(#{<<"type">> := <<"input">>} = Step, V, _User, _Run) when is_map(V) ->
    Def = case maps:get(<<"target">>, Step, undefined) of
              undefined -> #{<<"fields">> => maps:get(<<"fields">>, Step), <<"sections">> => []};
              T -> sd_config:get_tstruct(T)
          end,
    case sd_config:check_values(Def, V) of
        {ok, Clean} -> {ok, Clean};
        {error, Errs} -> {error, invalid, <<"Some answers need fixing.">>, #{<<"fields">> => Errs}}
    end;
answer(#{<<"type">> := <<"input">>}, _, _, _) -> {error, invalid, <<"value must be an object of field values.">>};
answer(#{<<"type">> := <<"upload">>} = Step, Id, User, _Run) when is_binary(Id) ->
    case sd_files:get(Id) of
        #{<<"by">> := By, <<"name">> := Name} = M ->
            Acc = maps:get(<<"accept">>, Step, []),
            Ext = string:lowercase(string:trim(filename:extension(Name), leading, ".")),
            case {By =:= maps:get(<<"username">>, User), Acc =:= [] orelse lists:member(Ext, Acc)} of
                {false, _} -> {error, forbidden, <<"That file isn't yours.">>};
                {_, false} -> {error, invalid, iolist_to_binary([<<"Allowed file types: ">>, lists:join(<<", ">>, Acc)])};
                _ -> {ok, maps:with([<<"id">>, <<"name">>, <<"size">>, <<"mime">>], M)}
            end;
        _ -> {error, invalid, <<"Unknown file (upload it first).">>}
    end;
answer(#{<<"type">> := <<"upload">>}, _, _, _) -> {error, invalid, <<"value must be an uploaded file id.">>};
answer(#{<<"type">> := <<"download">>}, _, _, _) -> {ok, #{<<"acknowledged">> => true}};
answer(#{<<"type">> := <<"decision">>} = Step, V, _, _) ->
    case is_binary(V) andalso lists:member(V, maps:get(<<"choices">>, Step)) of
        true -> {ok, V};
        false -> {error, invalid, <<"Pick one of the choices.">>}
    end;
answer(#{<<"type">> := <<"list">>} = Step, V, User, _Run) ->
    case options(Step, User) of
        {error, _, _} = E -> E;
        {ok, Opts} ->
            Allowed = [maps:get(<<"value">>, O) || O <- Opts],
            Picked = case maps:get(<<"multi">>, Step, false) of
                         true -> case V of L when is_list(L) -> L; _ -> invalid end;
                         false -> case is_binary(V) of true -> [V]; false -> invalid end
                     end,
            case Picked of
                invalid -> {error, invalid, <<"value has the wrong shape for this list.">>};
                [] -> {error, invalid, <<"Pick at least one.">>};
                _ ->
                    case lists:all(fun(X) -> is_binary(X) andalso lists:member(X, Allowed) end, Picked) andalso
                         length(lists:usort(Picked)) =:= length(Picked) of
                        true -> {ok, case maps:get(<<"multi">>, Step, false) of true -> Picked; false -> hd(Picked) end};
                        false -> {error, invalid, <<"That isn't one of the options.">>}
                    end
            end
    end;
answer(#{<<"type">> := <<"pay">>} = Step, V, User, _Run) when is_map(V) ->
    Ref = txt(sd_util:get(<<"reference">>, V), 100),
    case Ref of
        <<>> -> {error, invalid, <<"Enter the payment reference.">>};
        _ ->
            Base = #{<<"reference">> => Ref, <<"amount">> => maps:get(<<"amount">>, Step),
                     <<"currency">> => maps:get(<<"currency">>, Step)},
            case maps:get(<<"verifyDatasource">>, Step, null) of
                null -> {ok, Base#{<<"verified">> => false}};
                DS ->
                    Vals = maps:merge(sd_globals:values(User), #{<<"reference">> => Ref, <<"amount">> => maps:get(<<"amount">>, Step)}),
                    case sd_datasource:run(DS, Vals, #{<<"limit">> => 1}) of
                        {ok, #{<<"rows">> := [_ | _]}} -> {ok, Base#{<<"verified">> => true}};
                        {ok, _} -> {error, payment_not_found, <<"That payment couldn't be confirmed.">>};
                        {error, _, _} = E -> E
                    end
            end
    end;
answer(#{<<"type">> := <<"pay">>}, _, _, _) -> {error, invalid, <<"value must be {reference}.">>};
answer(#{<<"type">> := <<"summary">>}, _, _, _) -> {ok, #{<<"confirmed">> => true}};
answer(_, _, _, _) -> {error, invalid, <<"This step can't be answered.">>}.

options(#{<<"options">> := O}, _) -> {ok, O};
options(#{<<"catalog">> := K}, _) ->
    #{<<"items">> := Items} = sd_catalog:list(false, #{<<"kind">> => K, <<"limit">> => 100}),
    {ok, [#{<<"value">> => maps:get(<<"id">>, I), <<"label">> => maps:get(<<"name">>, I)} || I <- Items]};
options(#{<<"datasource">> := DS, <<"valueColumn">> := VC, <<"labelColumn">> := LC}, User) ->
    case sd_datasource:run(DS, sd_globals:values(User), #{<<"limit">> => 200}) of
        {ok, #{<<"rows">> := Rows}} ->
            {ok, [#{<<"value">> => text(maps:get(VC, R, <<>>)), <<"label">> => text(maps:get(LC, R, maps:get(VC, R, <<>>)))}
                  || R <- Rows, is_map(R), maps:is_key(VC, R)]};
        {ok, _} -> {ok, []};
        {error, _, _} = E -> E
    end.

text(V) when is_binary(V) -> V;
text(V) when is_integer(V) -> integer_to_binary(V);
text(V) when is_float(V) -> float_to_binary(V, [{decimals, 6}, compact]);
text(_) -> <<>>.

%% ---- the view a client renders --------------------------------------------------------------------------------------

view(W, Run, User) ->
    Base = #{<<"run">> => (brief_run(Run))#{<<"answers">> => maps:get(<<"answers">>, Run)}, <<"step">> => null},
    case maps:get(<<"status">>, Run) of
        S when S =:= <<"running">>; S =:= <<"waiting">> ->
            Step = current_step(W, Run),
            case prompt(Step, Run, W, User) of
                {ok, P} -> {ok, Base#{<<"step">> => P}};
                {error, _, _} = E -> E
            end;
        _ -> {ok, Base}
    end.

prompt(Step, Run, W, User) ->
    Total = length(maps:get(<<"steps">>, W)),
    Common = #{<<"id">> => maps:get(<<"id">>, Step), <<"type">> => maps:get(<<"type">>, Step),
               <<"caption">> => maps:get(<<"caption">>, Step), <<"number">> => maps:get(<<"stepIdx">>, Run),
               <<"of">> => Total, <<"waiting">> => maps:get(<<"status">>, Run) =:= <<"waiting">>},
    case maps:get(<<"type">>, Step) of
        <<"input">> ->
            Fields = case maps:get(<<"target">>, Step, undefined) of
                         undefined -> #{<<"fields">> => maps:get(<<"fields">>, Step), <<"sections">> => []};
                         T -> maps:with([<<"fields">>, <<"sections">>], sd_config:get_tstruct(T))
                     end,
            {ok, maps:merge(Common, Fields)};
        <<"upload">> -> {ok, Common#{<<"accept">> => maps:get(<<"accept">>, Step, [])}};
        <<"download">> ->
            File = case maps:get(<<"file">>, Step, null) of
                       null -> null;
                       Id -> case sd_files:get(Id) of M when is_map(M) -> maps:with([<<"id">>, <<"name">>, <<"size">>, <<"mime">>], M); _ -> null end
                   end,
            {ok, Common#{<<"file">> => File, <<"text">> => maps:get(<<"text">>, Step, <<>>)}};
        <<"approval">> -> {ok, Common#{<<"message">> => maps:get(<<"message">>, Step, <<>>)}};
        <<"pay">> -> {ok, Common#{<<"amount">> => maps:get(<<"amount">>, Step), <<"currency">> => maps:get(<<"currency">>, Step),
                                  <<"description">> => maps:get(<<"description">>, Step, <<>>)}};
        <<"decision">> -> {ok, Common#{<<"choices">> => maps:get(<<"choices">>, Step)}};
        <<"list">> ->
            case options(Step, User) of
                {ok, O} -> {ok, Common#{<<"options">> => O, <<"multi">> => maps:get(<<"multi">>, Step, false)}};
                E -> E
            end;
        <<"summary">> -> {ok, Common#{<<"answers">> => maps:get(<<"answers">>, Run)}}
    end.

%% ---- approvals coming back ---------------------------------------------------------------------------------------------

%% Called by sd_reqs when an approver answers the request an approval step raised.
approval_done(Req, Responder, Decision) ->
    #{<<"runId">> := RunId, <<"stepId">> := StepId} = maps:get(<<"data">>, Req),
    ReqId = maps:get(<<"id">>, Req),
    case get_run(RunId) of
        #{<<"waitingReq">> := ReqId, <<"stepId">> := StepId, <<"by">> := Owner} = Run ->
            Ans = #{<<"decision">> => atom_to_binary(Decision, utf8), <<"by">> => Responder, <<"ts">> => sd_util:now_ms()},
            Run1 = Run#{<<"answers">> => (maps:get(<<"answers">>, Run))#{StepId => Ans}, <<"waitingReq">> => null},
            Run2 = case Decision of
                       accepted ->
                           W = get_def(maps:get(<<"wizard">>, Run)),
                           case {W, sd_users:get(Owner)} of
                               {W1, U} when is_map(W1), is_map(U) -> advance(W1, Run1#{<<"status">> => <<"running">>}, U, maps:get(<<"stepIdx">>, Run1) + 1);
                               _ -> finish(Run1, <<"done">>)
                           end;
                       rejected -> finish(Run1, <<"rejected">>)
                   end,
            R = put_run(Run2),
            sd_notify:push_event(Owner, <<"wizard_updated">>, #{<<"runId">> => RunId, <<"status">> => maps:get(<<"status">>, R)}),
            ok;
        _ -> ok       %% the run was cancelled or moved on: nothing to do
    end.

%% Approvers (and administrators) may look at a run, so they can decide with the answers in front of them.
run_view(User, RunId) ->
    case get_run(RunId) of
        #{<<"by">> := By, <<"approvers">> := Aps} = Run ->
            Me = maps:get(<<"username">>, User),
            case By =:= Me orelse lists:member(Me, Aps) orelse sd_users:is_admin(User) of
                true -> {ok, #{<<"run">> => (brief_run(Run))#{<<"answers">> => maps:get(<<"answers">>, Run), <<"by">> => By}}};
                false -> {error, not_found, <<"No such run.">>}
            end;
        _ -> {error, not_found, <<"No such run.">>}
    end.

%% ---- files ---------------------------------------------------------------------------------------------------------------

note_files(#{<<"type">> := <<"upload">>}, #{<<"id">> := FileId}, Run) ->
    sd_db:sadd("sd:wizfile:" ++ binary_to_list(FileId), integer_to_binary(maps:get(<<"id">>, Run)));
note_files(_, _, _) -> ok.

%% May this person read this file because of a wizard? (a download step's file; a file uploaded into a run they approve)
file_visible(FileId, User) when is_binary(FileId) ->
    Me = maps:get(<<"username">>, User),
    ViaRun = lists:any(fun(B) ->
                           case get_run(binary_to_integer(B)) of
                               #{<<"approvers">> := Aps} -> lists:member(Me, Aps);
                               _ -> false
                           end
                       end, sd_db:smembers("sd:wizfile:" ++ binary_to_list(FileId))),
    ViaRun orelse lists:any(fun(W) ->
                                maps:get(<<"active">>, W, true) andalso
                                lists:any(fun(S) -> maps:get(<<"type">>, S) =:= <<"download">> andalso maps:get(<<"file">>, S, null) =:= FileId end,
                                          maps:get(<<"steps">>, W)) andalso sd_config:applies(W, User)
                            end, list_defs());
file_visible(_, _) -> false.
