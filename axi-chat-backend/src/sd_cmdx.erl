%%% Custom # commands: a name an administrator (for everyone it applies to) or a person (for themselves) points at
%%% something that already exists, so "#lab" can start a wizard, "#stock" can run a data source, and so on.
%%%
%%%   kind         what `target` names                       what running it does
%%%   option       an option id                              option.run
%%%   wizard       a wizard name                             wizard.start
%%%   tstruct      a T-Struct name                           tstruct.user.open
%%%   list         a T-Struct name                           records.list (typed text = search)
%%%   datasource   a data source name                        datasource.run (typed text = value "input")
%%%   catalog      product | service | all                   catalog.list (typed text = search)
%%%
%%% A custom command is never code of its own: running one calls the existing action for its kind with that action's
%%% own permission checks. The typed line is rewritten to `/sd cmd.custom`, so it runs off the connection (sd_lane).
%%% The names are also kept in memory (persistent_term) so the connection can tell "a custom command" from "a typo"
%%% without asking Redis.
-module(sd_cmdx).
-export([save/2, delete/2, list_for/1, refresh_cache/0, is_cached/1, catalog_for/1, execute/4, kinds/0]).

-define(HASH, "sd:cmds").
-define(KINDS, [<<"option">>, <<"wizard">>, <<"tstruct">>, <<"list">>, <<"datasource">>, <<"catalog">>]).
-define(MAX_PER_USER, 20).

kinds() -> ?KINDS.

key(N) -> string:lowercase(string:trim(sd_util:s(N))).

all() -> [C || {_, C} <- sd_db:hgetall_json(?HASH), is_map(C)].

visible(C, User) ->
    Me = maps:get(<<"username">>, User),
    maps:get(<<"active">>, C, true) andalso
    case maps:get(<<"owner">>, C, null) of
        null -> sd_config:applies(C, User);
        Me -> true;
        _ -> false
    end.

list_for(User) ->
    Me = maps:get(<<"username">>, User),
    Admin = sd_users:is_admin(User),
    lists:sort(fun(A, B) -> maps:get(<<"name">>, A) =< maps:get(<<"name">>, B) end,
               [C || C <- all(), Admin orelse visible(C, User) orelse maps:get(<<"owner">>, C, null) =:= Me]).

%% ---- saving ---------------------------------------------------------------------------------------------------------

save(User, Raw) when is_map(Raw) ->
    Name = string:lowercase(sd_util:get(<<"name">>, Raw, <<>>)),
    Kind = sd_util:get(<<"kind">>, Raw),
    Target = sd_util:get(<<"target">>, Raw, <<>>),
    Me = maps:get(<<"username">>, User),
    Admin = sd_users:is_admin(User),
    Existing = sd_db:hget_json(?HASH, key(Name)),
    Summary = case sd_util:get(<<"summary">>, Raw) of S when is_binary(S) -> binary:part(string:trim(S), 0, min(100, byte_size(string:trim(S)))); _ -> <<>> end,
    case {valid_name(Name), lists:member(Kind, ?KINDS), is_binary(Target)} of
        {false, _, _} -> {error, invalid, <<"name must be 2-32 letters, digits, - or _, starting with a letter.">>};
        {_, false, _} -> {error, invalid, iolist_to_binary([<<"kind must be one of ">>, lists:join(<<", ">>, ?KINDS)])};
        {_, _, false} -> {error, invalid, <<"target is required.">>};
        _ ->
            case chat_cmds:find(binary_to_list(Name)) =/= undefined orelse Name =:= <<"custom">> of
                true -> {error, invalid, <<"That name is already a built-in command.">>};
                false ->
                    case may_change(Existing, Me, Admin) of
                        {error, _, _} = E -> E;
                        ok ->
                            case check_target(Kind, Target, User) of
                                {error, _, _} = E -> E;
                                {ok, T} -> store(Name, Kind, T, Summary, Raw, Existing, Me, Admin)
                            end
                    end
            end
    end;
save(_, _) -> {error, bad_request, <<"Expected a JSON object.">>}.

store(Name, Kind, Target, Summary, Raw, Existing, Me, Admin) ->
    Owner = case Existing of #{<<"owner">> := O} -> O; _ -> case Admin of true -> null; false -> Me end end,
    Mine = length([C || C <- all(), maps:get(<<"owner">>, C, null) =:= Me]),
    case Existing =:= undefined andalso Owner =/= null andalso Mine >= ?MAX_PER_USER of
        true -> {error, too_many, <<"You have too many custom commands.">>};
        false ->
            Ap = case Owner of
                     null -> sd_config:validate_applicable(sd_util:get(<<"applicable">>, Raw, #{}));
                     _ -> {ok, #{}}
                 end,
            case Ap of
                {error, _, _} = E -> E;
                {ok, Applicable} ->
                    C = #{<<"name">> => Name, <<"kind">> => Kind, <<"target">> => Target,
                          <<"summary">> => case Summary of <<>> -> default_summary(Kind, Target); _ -> Summary end,
                          <<"owner">> => Owner, <<"applicable">> => Applicable,
                          <<"active">> => sd_util:get(<<"active">>, Raw, true) =/= false},
                    sd_db:hset_json(?HASH, key(Name), C),
                    refresh_cache(),
                    {ok, C}
            end
    end.

default_summary(Kind, Target) -> iolist_to_binary([<<"Custom: ">>, Kind, <<" ">>, Target]).

valid_name(N) -> re:run(N, "^[a-z][a-z0-9_-]{1,31}$", [{capture, none}]) =:= match.

may_change(undefined, _, _) -> ok;
may_change(_, _, true) -> ok;
may_change(#{<<"owner">> := Me}, Me, _) -> ok;
may_change(_, _, _) -> {error, forbidden, <<"That command belongs to someone else.">>}.

check_target(<<"option">>, T, _) ->
    case sd_config:get_option(T) of undefined -> {error, invalid, <<"Unknown option.">>}; O -> {ok, maps:get(<<"id">>, O)} end;
check_target(<<"wizard">>, T, _) ->
    case sd_wizard:get_def(T) of undefined -> {error, invalid, <<"Unknown wizard.">>}; W -> {ok, maps:get(<<"name">>, W)} end;
check_target(K, T, _) when K =:= <<"tstruct">>; K =:= <<"list">> ->
    case {sd_config:get_tstruct(T), sd_config:get_user_tstruct(T)} of
        {A, _} when is_map(A) -> {ok, maps:get(<<"name">>, A)};
        {_, U} when is_map(U) -> {ok, maps:get(<<"name">>, U)};
        _ -> {error, invalid, <<"Unknown T-Struct.">>}
    end;
check_target(<<"datasource">>, T, _) ->
    case sd_datasource:get(T) of undefined -> {error, invalid, <<"Unknown data source.">>}; D -> {ok, maps:get(<<"name">>, D)} end;
check_target(<<"catalog">>, T, _) when T =:= <<"product">>; T =:= <<"service">>; T =:= <<"all">> -> {ok, T};
check_target(<<"catalog">>, _, _) -> {error, invalid, <<"target must be product, service or all.">>}.

delete(User, Name) ->
    case sd_db:hget_json(?HASH, key(Name)) of
        undefined -> {error, not_found, <<"No such command.">>};
        C ->
            case may_change(C, maps:get(<<"username">>, User), sd_users:is_admin(User)) of
                ok -> sd_db:hdel(?HASH, key(Name)), refresh_cache(), ok;
                E -> E
            end
    end.

%% ---- the in-memory list of names -------------------------------------------------------------------------------

refresh_cache() ->
    persistent_term:put({?MODULE, names}, [maps:get(<<"name">>, C) || C <- all(), maps:get(<<"active">>, C, true)]),
    ok.

is_cached(Token) when is_list(Token) -> is_cached(list_to_binary(Token));
is_cached(Token) when is_binary(Token) -> lists:member(Token, persistent_term:get({?MODULE, names}, [])).

%% ---- for the command menu (runs in a worker, may read Redis) ------------------------------------------------------

%% The caller's custom commands in chat_cmds' own command shape.
catalog_for(#{user := User}) when is_map(User) ->
    [begin
         N = maps:get(<<"name">>, C),
         #{name => binary_to_list(N), aliases => [], category => custom,
           summary => binary_to_list(maps:get(<<"summary">>, C)),
           args => [{input, {text, 200}, opt}],
           target => {sd, <<"cmd.custom">>, fun(_) -> #{} end}, reply => ["sd"]}
     end || C <- all(), visible(C, User)];
catalog_for(_) -> [].

%% ---- running ------------------------------------------------------------------------------------------------------------

execute(User, Name, Input, Ctx) ->
    case sd_db:hget_json(?HASH, key(Name)) of
        C when is_map(C) ->
            case visible(C, User) of
                true ->
                    {Action, Args} = target_call(maps:get(<<"kind">>, C), maps:get(<<"target">>, C), Input),
                    case sd_cmds:run(Action, Args, Ctx) of
                        {ok, Data} -> {ok, #{<<"command">> => maps:get(<<"name">>, C), <<"action">> => Action, <<"result">> => Data}};
                        Err -> Err
                    end;
                false -> {error, not_found, <<"No such command.">>}
            end;
        _ -> {error, not_found, <<"No such command.">>}
    end.

target_call(<<"option">>, T, In) -> {<<"option.run">>, with_input(#{<<"id">> => T}, In)};
target_call(<<"wizard">>, T, _) -> {<<"wizard.start">>, #{<<"name">> => T}};
target_call(<<"tstruct">>, T, _) -> {<<"tstruct.user.open">>, #{<<"name">> => T}};
target_call(<<"list">>, T, In) -> {<<"records.list">>, opt_q(#{<<"tstruct">> => T}, In)};
target_call(<<"datasource">>, T, In) -> {<<"datasource.run">>, with_input(#{<<"name">> => T}, In)};
target_call(<<"catalog">>, <<"all">>, In) -> {<<"catalog.list">>, opt_q(#{}, In)};
target_call(<<"catalog">>, K, In) -> {<<"catalog.list">>, opt_q(#{<<"kind">> => K}, In)}.

with_input(M, In) when is_binary(In), In =/= <<>> -> M#{<<"values">> => #{<<"input">> => In}};
with_input(M, _) -> M.
opt_q(M, In) when is_binary(In), In =/= <<>> -> M#{<<"q">> => In};
opt_q(M, _) -> M.
