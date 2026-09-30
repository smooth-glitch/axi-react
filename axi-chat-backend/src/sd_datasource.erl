%%% Data sources: named queries against a connected application (an "application connection", see sd_config).
%%% They feed Selection / Fill fields, the `get_data` option, global variables and wizard listing steps.
%%%
%%% Two kinds:
%%%   sql   the definition holds SQL text with :placeholders. The text is sent to the application as JSON
%%%           POST <connection url><queryPath>   {"sql": "...", "params": {"city": "Pune"}, "limit": 200}
%%%         Values are NEVER pasted into the SQL: they travel separately as `params`, for the application to bind.
%%%   api   a path on the connection:  GET <url><path>?city=Pune   (or POST with the params as a JSON body)
%%%
%%% What the application answers is normalised to {columns, rows}: a JSON array of objects, or an object with
%%% `rows` / `data` (array of objects, or arrays plus `columns`).
%%%
%%% Who may do what
%%%   administrator  any data source on any connection; may limit it with "applicable to" rules (like options)
%%%   a person       their own data sources, and only on connections whose administrator switched on
%%%                  `allowUserDatasources`. Visible only to their owner.
%%% SQL is checked before it is stored: one SELECT (or WITH ... SELECT) statement, no comments, no data-changing or
%%% administrative keywords. That is a safety net, not a substitute for giving the connection a read-only account.
%%%
%%% Everything here that talks to the outside world can be slow, so callers run it off the connection
%%% (sd_lane's slow workers); run/3 blocks until the application answers or the time limit passes.
-module(sd_datasource).
-export([get/1, list_for/1, all_described/0, save/2, delete/2, run_for/3, run/3, commands/1, ping/1, describe/1, timeout_ms/0]).

-compile({no_auto_import, [get/1]}).

-define(HASH, "sd:datasources").
-define(MAX_ROWS, 1000).
-define(MAX_BODY, 1048576).

get(Name) -> sd_db:hget_json(?HASH, key(Name)).
key(Name) -> string:lowercase(string:trim(sd_util:s(Name))).

timeout_ms() ->
    case os:getenv("SANDESH_DS_TIMEOUT_MS") of
        false -> 15000;
        V -> try max(200, list_to_integer(V)) catch _:_ -> 15000 end
    end.

all() ->
    lists:sort(fun(A, B) -> maps:get(<<"name">>, A) =< maps:get(<<"name">>, B) end,
               [D || {_, D} <- sd_db:hgetall_json(?HASH), is_map(D)]).

%% What this user may use: administrator-made ones whose rules fit them, plus their own.
list_for(User) ->
    Me = maps:get(<<"username">>, User),
    Vars = sd_globals:values(User),
    [describe(D) || D <- all(), visible(D, User, Me, Vars)].

visible(D, User, Me, Vars) ->
    case maps:get(<<"owner">>, D, null) of
        Me -> true;
        Owner when is_binary(Owner) -> false;
        _ -> sd_config:applies(#{<<"applicable">> => maps:get(<<"applicable">>, D, #{}),
                                 <<"condition">> => null}, User, Vars)
    end.

all_described() -> [describe(D) || D <- all()].

%% Is the application reachable with the stored credentials? (GET the connection's base URL.)
ping(ConnName) ->
    case sd_config:appconn_raw(ConnName) of
        undefined -> {error, not_found, <<"No such application.">>};
        Conn ->
            case call(Conn, get, <<"/">>, undefined) of
                {ok, _} -> {ok, #{<<"reachable">> => true}};
                {error, bad_response, _} -> {ok, #{<<"reachable">> => true, <<"note">> => <<"It answered, but not with JSON.">>}};
                {error, upstream_error, _} -> {ok, #{<<"reachable">> => true, <<"note">> => <<"It answered with an error status.">>}};
                Err -> Err
            end
    end.

describe(D) -> maps:without([<<"sql">>], D#{<<"hasSql">> => maps:is_key(<<"sql">>, D)}).

%% ---- defining ------------------------------------------------------------------------------------------------

%% Actor: the user making it. Raw: name, type (sql|api), connection, sql | path (+method), params [{name, default}],
%% description, applicable (administrators only).
save(User, Raw) when is_map(Raw) ->
    IsAdmin = sd_users:is_admin(User),
    Me = maps:get(<<"username">>, User),
    Name = sd_util:get(<<"name">>, Raw),
    Type = sd_util:get(<<"type">>, Raw),
    Conn = sd_util:get(<<"connection">>, Raw),
    Existing = case valid_name(Name) of true -> get(Name); false -> undefined end,
    case {valid_name(Name), lists:member(Type, [<<"sql">>, <<"api">>]), is_binary(Conn) andalso sd_config:appconn_raw(Conn)} of
        {false, _, _} -> {error, invalid, <<"name must be letters, digits or _, starting with a letter (max 40).">>};
        {_, false, _} -> {error, invalid, <<"type must be sql or api.">>};
        {_, _, C} when C =:= false; C =:= undefined -> {error, invalid, <<"connection must name an existing application connection.">>};
        {_, _, ConnRec} ->
            case may_change(Existing, IsAdmin, Me) of
                {error, _, _} = E -> E;
                ok ->
                    case IsAdmin orelse maps:get(<<"allowUserDatasources">>, ConnRec, false) =:= true of
                        false -> {error, forbidden, <<"An administrator hasn't allowed personal data sources on that connection.">>};
                        true -> build(Raw, Name, Type, ConnRec, IsAdmin, Me, Existing)
                    end
            end
    end;
save(_, _) -> {error, bad_request, <<"Expected a JSON object.">>}.

may_change(undefined, _, _) -> ok;
may_change(_, true, _) -> ok;
may_change(#{<<"owner">> := Me}, false, Me) -> ok;
may_change(_, false, _) -> {error, forbidden, <<"That data source belongs to someone else.">>}.

build(Raw, Name, Type, ConnRec, IsAdmin, Me, Existing) ->
    Params = params(sd_util:get(<<"params">>, Raw, [])),
    Desc = case sd_util:get(<<"description">>, Raw) of B when is_binary(B) -> binary:part(B, 0, min(byte_size(B), 200)); _ -> <<>> end,
    case Params of
        {error, _, _} = PE -> PE;
        {ok, Ps} ->
            ParamNames = [maps:get(<<"name">>, P) || P <- Ps],
            case Type of
                <<"sql">> -> build_sql(Raw, Name, ConnRec, Ps, ParamNames, Desc, IsAdmin, Me, Existing);
                <<"api">> -> build_api(Raw, Name, ConnRec, Ps, Desc, IsAdmin, Me, Existing)
            end
    end.

build_sql(Raw, Name, ConnRec, Ps, ParamNames, Desc, IsAdmin, Me, Existing) ->
    Sql = case sd_util:get(<<"sql">>, Raw) of B when is_binary(B) -> string:trim(B); _ -> <<>> end,
    case check_sql(Sql) of
        {error, _, _} = E -> E;
        ok ->
            Known = ParamNames ++ sd_globals:known(),
            case [P || P <- placeholders(Sql), not lists:member(P, Known)] of
                [Bad | _] -> {error, invalid, <<"The SQL uses :", Bad/binary, " but no parameter or global variable has that name.">>};
                [] -> store(Raw, Name, <<"sql">>, ConnRec, #{<<"sql">> => Sql}, Ps, Desc, IsAdmin, Me, Existing)
            end
    end.

build_api(Raw, Name, ConnRec, Ps, Desc, IsAdmin, Me, Existing) ->
    Path = sd_util:get(<<"path">>, Raw),
    Method = case sd_util:get(<<"method">>, Raw, <<"GET">>) of M when M =:= <<"GET">>; M =:= <<"POST">> -> M; _ -> bad end,
    case {sd_config:safe_path(Path), Method} of
        {false, _} -> {error, invalid, <<"path must be a plain path like /customers (letters, digits . _ ~ % / -).">>};
        {_, bad} -> {error, invalid, <<"method must be GET or POST.">>};
        _ -> store(Raw, Name, <<"api">>, ConnRec, #{<<"path">> => Path, <<"method">> => Method}, Ps, Desc, IsAdmin, Me, Existing)
    end.

store(Raw, Name, Type, ConnRec, Extra, Ps, Desc, IsAdmin, Me, Existing) ->
    Applicable = case IsAdmin of
                     true ->
                         case sd_config:validate_applicable(sd_util:get(<<"applicable">>, Raw, #{})) of
                             {ok, A} -> A;
                             {error, _, _} = E -> E
                         end;
                     false -> #{}
                 end,
    case Applicable of
        {error, _, _} = Err -> Err;
        _ ->
            Owner = case Existing of
                        #{<<"owner">> := O} -> O;
                        _ -> case IsAdmin of true -> null; false -> Me end
                    end,
            D = maps:merge(#{<<"name">> => Name, <<"type">> => Type, <<"connection">> => maps:get(<<"name">>, ConnRec),
                             <<"params">> => Ps, <<"description">> => Desc, <<"owner">> => Owner,
                             <<"applicable">> => Applicable,
                             <<"createdTs">> => case Existing of #{<<"createdTs">> := T} -> T; _ -> sd_util:now_ms() end,
                             <<"modifiedTs">> => sd_util:now_ms()}, Extra),
            sd_db:hset_json(?HASH, key(Name), D),
            {ok, describe(D)}
    end.

delete(User, Name) ->
    case get(Name) of
        undefined -> {error, not_found, <<"No such data source.">>};
        D ->
            case may_change(D, sd_users:is_admin(User), maps:get(<<"username">>, User)) of
                ok ->
                    case sd_globals_using(maps:get(<<"name">>, D)) of
                        [G | _] -> {error, in_use, <<"The global variable ", G/binary, " reads from it; change that first.">>};
                        [] -> sd_db:hdel(?HASH, key(maps:get(<<"name">>, D))), ok
                    end;
                E -> E
            end
    end.

sd_globals_using(DsName) ->
    [maps:get(<<"name">>, G) || G <- sd_globals:list(), maps:get(<<"datasource">>, G, null) =:= DsName].

valid_name(N) when is_binary(N) -> re:run(N, "^[A-Za-z][A-Za-z0-9_]{0,39}$", [{capture, none}]) =:= match;
valid_name(_) -> false.

params(L) when is_list(L), length(L) =< 20 -> params(L, [], []);
params(_) -> {error, invalid, <<"params must be a list of at most 20 {name, default}.">>}.

params([], _Seen, Acc) -> {ok, lists:reverse(Acc)};
params([#{<<"name">> := N} = P | Rest], Seen, Acc) when is_binary(N) ->
    Default = maps:get(<<"default">>, P, null),
    case {valid_name(N), lists:member(string:lowercase(N), Seen), scalar(Default)} of
        {false, _, _} -> {error, invalid, <<"Each parameter needs a name: letters, digits or _, starting with a letter.">>};
        {_, true, _} -> {error, invalid, <<"Parameter ", N/binary, " is listed twice.">>};
        {_, _, false} -> {error, invalid, <<"The default of ", N/binary, " must be text, a number, true/false or null.">>};
        _ -> params(Rest, [string:lowercase(N) | Seen], [#{<<"name">> => N, <<"default">> => Default} | Acc])
    end;
params(_, _, _) -> {error, invalid, <<"Each parameter must be an object with a name.">>}.

scalar(null) -> true;
scalar(V) when is_binary(V) -> byte_size(V) =< 500;
scalar(V) when is_number(V); is_boolean(V) -> true;
scalar(_) -> false.

%% ---- SQL safety net -----------------------------------------------------------------------------------------

check_sql(<<>>) -> {error, invalid, <<"sql is required.">>};
check_sql(Sql) when byte_size(Sql) > 4000 -> {error, invalid, <<"The SQL is too long (max 4000 characters).">>};
check_sql(Sql) ->
    Bare = strip_literals(Sql),
    Lower = string:lowercase(Bare),
    Trimmed = string:trim(Lower, both, " \t\r\n;"),
    Words = [W || W <- re:split(Trimmed, "[^a-z_]+", [{return, binary}]), W =/= <<>>],
    Forbidden = [<<"insert">>, <<"update">>, <<"delete">>, <<"drop">>, <<"alter">>, <<"create">>, <<"truncate">>,
                 <<"grant">>, <<"revoke">>, <<"exec">>, <<"execute">>, <<"merge">>, <<"call">>, <<"replace">>,
                 <<"pragma">>, <<"attach">>, <<"vacuum">>, <<"copy">>, <<"into">>, <<"lock">>, <<"begin">>, <<"commit">>, <<"rollback">>],
    StartsOk = case Words of [F | _] -> F =:= <<"select">> orelse F =:= <<"with">>; [] -> false end,
    case {StartsOk,
          binary:match(Lower, [<<"--">>, <<"/*">>, <<"*/">>]) =/= nomatch,
          binary:match(string:trim(Lower, trailing, " \t\r\n;"), <<";">>) =/= nomatch,
          [W || W <- Words, lists:member(W, Forbidden)]} of
        {false, _, _, _} -> {error, invalid, <<"Only a SELECT (or WITH ... SELECT) statement is allowed.">>};
        {_, true, _, _} -> {error, invalid, <<"Comments are not allowed in the SQL.">>};
        {_, _, true, _} -> {error, invalid, <<"Only one statement is allowed.">>};
        {_, _, _, [W | _]} -> {error, invalid, <<"The SQL may not use ", W/binary, ".">>};
        _ -> ok
    end.

%% 'text' -> '' so keywords inside string literals don't trigger the checks and :x inside them isn't a placeholder.
strip_literals(Sql) ->
    re:replace(Sql, "'([^']|'')*'", "''", [global, {return, binary}]).

placeholders(Sql) ->
    Bare = strip_literals(Sql),
    case re:run(Bare, "(?<![:\\w]):([A-Za-z_][A-Za-z0-9_]*)", [global, {capture, all_but_first, binary}]) of
        {match, L} -> lists:usort([N || [N] <- L]);
        nomatch -> []
    end.

%% ---- running ------------------------------------------------------------------------------------------------

%% As a user: they must be allowed to use it; values they pass fill the parameters. Args: values (object), limit.
run_for(User, Name, Args) ->
    Me = maps:get(<<"username">>, User),
    case get(Name) of
        undefined -> {error, not_found, <<"No such data source.">>};
        D ->
            case visible(D, User, Me, sd_globals:values(User)) of
                false -> {error, not_found, <<"No such data source.">>};
                true ->
                    case sd_db:rate(["ds:", Me], 60, 60) of
                        limited -> {error, rate_limited, <<"Too many data source calls; wait a minute.">>};
                        ok ->
                            Values = case sd_util:get(<<"values">>, Args) of V when is_map(V) -> V; _ -> #{} end,
                            run(maps:get(<<"name">>, D), maps:merge(sd_globals:values(User), Values),
                                #{<<"limit">> => sd_util:get(<<"limit">>, Args)})
                    end
            end
    end.

%% Values: the bound variables (global variables + whatever the caller supplies).
run(Name, Values, Opts) ->
    case get(Name) of
        undefined -> {error, not_found, <<"No such data source.">>};
        D ->
            case sd_config:appconn_raw(maps:get(<<"connection">>, D)) of
                undefined -> {error, unavailable, <<"The application connection for this data source was removed.">>};
                Conn -> do_run(D, Conn, Values, Opts)
            end
    end.

do_run(D, Conn, Values, Opts) ->
    Limit = case maps:get(<<"limit">>, Opts, undefined) of
                N when is_integer(N), N >= 1 -> min(N, ?MAX_ROWS);
                _ -> 200
            end,
    Bound = bind(maps:get(<<"params">>, D, []), D, Values),
    Result = case maps:get(<<"type">>, D) of
                 <<"sql">> ->
                     Body = sd_util:jenc(#{<<"sql">> => maps:get(<<"sql">>, D), <<"params">> => Bound, <<"limit">> => Limit}),
                     call(Conn, post, maps:get(<<"queryPath">>, Conn, <<"/query">>), Body);
                 <<"api">> ->
                     case maps:get(<<"method">>, D, <<"GET">>) of
                         <<"POST">> -> call(Conn, post, maps:get(<<"path">>, D), sd_util:jenc(Bound));
                         _ -> call(Conn, get, <<(maps:get(<<"path">>, D))/binary, (query_string(Bound))/binary>>, undefined)
                     end
             end,
    case Result of
        {ok, Json} -> normalise(Json, Limit);
        Err -> Err
    end.

%% Each declared parameter: the caller's value, else the same-named variable, else its default, else null.
%% SQL may also name a global variable directly (:city).
bind(Params, D, Values) ->
    Declared = [{maps:get(<<"name">>, P), maps:get(<<"default">>, P, null)} || P <- Params],
    FromDecl = [{N, pick(N, Values, Def)} || {N, Def} <- Declared],
    Extra = case maps:get(<<"sql">>, D, undefined) of
                undefined -> [];
                Sql -> [{N, pick(N, Values, null)} || N <- placeholders(Sql), not lists:keymember(N, 1, Declared)]
            end,
    maps:from_list([{N, scalar_or_null(V)} || {N, V} <- FromDecl ++ Extra]).

pick(N, Values, Default) ->
    case maps:find(N, Values) of
        {ok, V} when V =/= null, V =/= <<>> -> V;
        _ -> Default
    end.

scalar_or_null(V) -> case scalar(V) of true -> V; false -> null end.

query_string(Bound) ->
    Pairs = [<<(uri_string:quote(N))/binary, "=", (uri_string:quote(to_text(V)))/binary>>
             || {N, V} <- lists:sort(maps:to_list(Bound)), V =/= null],
    case Pairs of [] -> <<>>; _ -> <<"?", (iolist_to_binary(lists:join(<<"&">>, Pairs)))/binary>> end.

to_text(V) when is_binary(V) -> V;
to_text(V) when is_integer(V) -> integer_to_binary(V);
to_text(V) when is_float(V) -> float_to_binary(V, [{decimals, 6}, compact]);
to_text(true) -> <<"true">>;
to_text(false) -> <<"false">>;
to_text(_) -> <<>>.

%% ---- talking to the application ------------------------------------------------------------------------------

call(Conn, Method, Path, Body) ->
    Base = string:trim(sd_util:b(maps:get(<<"url">>, Conn)), trailing, "/"),
    Url = binary_to_list(<<Base/binary, Path/binary>>),
    Headers = auth_headers(Conn) ++ [{"accept", "application/json"}],
    Timeout = timeout_ms(),
    HttpOpts = [{timeout, Timeout}, {connect_timeout, min(Timeout, 5000)}] ++ ssl_opts(Url),
    Req = case Method of
              get -> {Url, Headers};
              post -> {Url, Headers, "application/json", Body}
          end,
    try
        _ = application:ensure_all_started(inets),
        _ = application:ensure_all_started(ssl),
        case httpc:request(Method, Req, HttpOpts, [{body_format, binary}]) of
            {ok, {{_, Code, _}, _, RespBody}} when Code >= 200, Code < 300 ->
                case byte_size(RespBody) > ?MAX_BODY of
                    true -> {error, too_large, <<"The application's answer was too large (over 1 MB).">>};
                    false ->
                        case sd_util:jdec(RespBody) of
                            {ok, Json} -> {ok, Json};
                            _ -> {error, bad_response, <<"The application didn't answer with JSON.">>}
                        end
                end;
            {ok, {{_, Code, _}, _, _}} when Code =:= 401; Code =:= 403 ->
                {error, upstream_denied, <<"The application refused the connection's credentials.">>};
            {ok, {{_, Code, _}, _, _}} ->
                {error, upstream_error, iolist_to_binary(io_lib:format("The application answered HTTP ~p.", [Code]))};
            {error, {failed_connect, _}} -> {error, upstream_unavailable, <<"Couldn't reach the application.">>};
            {error, timeout} -> {error, upstream_timeout, <<"The application took too long to answer.">>};
            {error, _} -> {error, upstream_unavailable, <<"Couldn't reach the application.">>}
        end
    catch _:_ -> {error, upstream_unavailable, <<"Couldn't reach the application.">>}
    end.

ssl_opts("https://" ++ _) ->
    [{ssl, [{verify, verify_peer}, {cacerts, public_key:cacerts_get()}, {customize_hostname_check, [{match_fun, public_key:pkix_verify_hostname_match_fun(https)}]}]}];
ssl_opts(_) -> [].

auth_headers(Conn) ->
    Creds = case maps:get(<<"credentials">>, Conn, undefined) of
                undefined -> #{};
                Sealed -> case sd_util:unseal(Sealed) of
                              {ok, Json} -> case sd_util:jdec(Json) of {ok, M} when is_map(M) -> M; _ -> #{} end;
                              _ -> #{}
                          end
            end,
    case maps:get(<<"authType">>, Conn, <<"none">>) of
        <<"basic">> ->
            Pair = <<(sd_util:get(<<"username">>, Creds, <<>>))/binary, ":", (sd_util:get(<<"password">>, Creds, <<>>))/binary>>,
            [{"authorization", "Basic " ++ binary_to_list(base64:encode(Pair))}];
        <<"bearer">> ->
            [{"authorization", "Bearer " ++ binary_to_list(sd_util:get(<<"token">>, Creds, <<>>))}];
        _ -> []
    end.

%% ---- normalising the answer ---------------------------------------------------------------------------------

normalise(Json, Limit) ->
    case rows_of(Json) of
        {ok, Cols, Rows} ->
            Total = length(Rows),
            Cut = lists:sublist(Rows, Limit),
            Columns = case Cols of
                          undefined -> case Cut of [R | _] -> lists:sort(maps:keys(R)); [] -> [] end;
                          _ -> Cols
                      end,
            {ok, #{<<"columns">> => Columns, <<"rows">> => Cut, <<"total">> => Total, <<"truncated">> => Total > Limit}};
        error -> {error, bad_response, <<"The application's answer isn't a list of rows.">>}
    end.

rows_of(L) when is_list(L) -> objects(L, undefined);
rows_of(#{<<"rows">> := R} = M) when is_list(R) -> arrays_or_objects(R, maps:get(<<"columns">>, M, undefined));
rows_of(#{<<"data">> := R} = M) when is_list(R) -> arrays_or_objects(R, maps:get(<<"columns">>, M, undefined));
rows_of(_) -> error.

arrays_or_objects([], Cols) -> {ok, Cols, []};
arrays_or_objects([F | _] = R, Cols) when is_list(F), is_list(Cols) ->
    {ok, Cols, [maps:from_list(lists:zip(Cols, pad(Row, length(Cols)))) || Row <- R, is_list(Row)]};
arrays_or_objects(R, Cols) -> objects(R, Cols).

pad(Row, N) when length(Row) >= N -> lists:sublist(Row, N);
pad(Row, N) -> Row ++ lists:duplicate(N - length(Row), null).

objects(L, Cols) ->
    case lists:all(fun is_map/1, L) of
        true -> {ok, Cols, L};
        false -> error
    end.

%% ---- an application's own # commands (Axpert "command line") ---------------------------------------------------

%% GET <url><commandsPath> -> [{name, caption, description}]. Whatever the application lists is offered as commands.
commands(ConnName) ->
    case sd_config:appconn_raw(ConnName) of
        undefined -> {error, not_found, <<"No such application.">>};
        Conn ->
            case call(Conn, get, maps:get(<<"commandsPath">>, Conn, <<"/commands">>), undefined) of
                {ok, Json} ->
                    case rows_of(Json) of
                        {ok, _, Rows} ->
                            {ok, [#{<<"name">> => text_of(maps:get(<<"name">>, R, <<>>)),
                                    <<"caption">> => text_of(maps:get(<<"caption">>, R, maps:get(<<"name">>, R, <<>>))),
                                    <<"description">> => text_of(maps:get(<<"description">>, R, <<>>))}
                                  || R <- lists:sublist(Rows, 500), is_binary(maps:get(<<"name">>, R, undefined))]};
                        error -> {error, bad_response, <<"The application's command list isn't a list.">>}
                    end;
                Err -> Err
            end
    end.

text_of(B) when is_binary(B) -> binary:part(B, 0, min(byte_size(B), 200));
text_of(_) -> <<>>.
