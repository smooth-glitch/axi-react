%%% Admin-configurable content from the Sandesh spec:
%%%
%%%  * Lite TStructs -- small forms shown inside the chat window: one list of
%%%    fields (text, date, time, whole number, number, email, URL, mobile,
%%%    location, list, selection, fill), optional sections, and conditions
%%%    that show/require a field or section only when other fields have
%%%    certain values.
%%%  * Options -- what appears in the "Options section" above the chat
%%%    window (data input, get data & display, download, upload, pay, and
%%%    the Axpert options tstruct / smart view / iview / custom page), each
%%%    with an "Applicable to" rule that decides which users see it.
%%%  * Application connections -- name, URL and login credentials of the
%%%    external applications options talk to. Credentials are sealed
%%%    (AES-256-GCM, see sd_util:seal/1) and never returned to clients.
%%%
%%% This module defines, stores, validates and filters. It does NOT execute
%%% an option against an external system (calling an Axpert API, streaming a
%%% download, taking a payment): the call contracts for those aren't fixed
%%% yet (see docs/SANDESH_BACKEND.md, "Not built"). What it does do at
%%% runtime is exactly what the chat needs: tell a user which options they
%%% get, hand them a form definition, and validate + store what they submit.
-module(sd_config).
-export([list_tstructs/0, get_tstruct/1, save_tstruct/1, delete_tstruct/1,
         list_options/0, save_option/1, delete_option/1, options_for/1, option_types/0,
         list_appconns/0, save_appconn/1, delete_appconn/1,
         tstruct_for_user/2, submit/3, list_submissions/1, applies/2]).

-define(TSTRUCTS, "sd:tstructs").
-define(OPTIONS, "sd:options").
-define(APPCONNS, "sd:appconns").
-define(FIELD_TYPES, [<<"text">>, <<"date">>, <<"time">>, <<"wholenumber">>, <<"number">>,
                      <<"email">>, <<"url">>, <<"mobile">>, <<"location">>, <<"list">>,
                      <<"selection">>, <<"fill">>]).
-define(OPTION_TYPES, [<<"data_input">>, <<"get_data">>, <<"download">>, <<"upload">>, <<"pay">>,
                       <<"axpert_tstruct">>, <<"axpert_smartview">>, <<"axpert_iview">>,
                       <<"axpert_page">>]).
-define(OPS, [<<"eq">>, <<"ne">>, <<"gt">>, <<"lt">>, <<"gte">>, <<"lte">>, <<"in">>, <<"notempty">>]).
-define(MAX_FIELDS, 100).

option_types() -> ?OPTION_TYPES.

%% =============================================================================
%% Lite TStructs
%% =============================================================================

list_tstructs() ->
    lists:sort(fun(A, B) -> maps:get(<<"name">>, A) =< maps:get(<<"name">>, B) end,
               [T || {_, T} <- sd_db:hgetall_json(?TSTRUCTS), is_map(T)]).

get_tstruct(Name) -> sd_db:hget_json(?TSTRUCTS, key(Name)).

save_tstruct(Raw) when is_map(Raw) ->
    Name = sd_util:get(<<"name">>, Raw),
    case valid_ident(Name) of
        false -> {error, invalid, <<"name must be letters/digits/underscore, starting with a letter.">>};
        true ->
            case validate_fields(sd_util:get(<<"fields">>, Raw, [])) of
                {ok, Fields} ->
                    FieldNames = [maps:get(<<"name">>, F) || F <- Fields],
                    case validate_sections(sd_util:get(<<"sections">>, Raw, []), FieldNames) of
                        {ok, Sections} ->
                            case check_field_refs(Fields, Sections, FieldNames) of
                                ok ->
                                    Def = #{<<"name">> => Name,
                                            <<"caption">> => text(sd_util:get(<<"caption">>, Raw), Name),
                                            <<"description">> => text(sd_util:get(<<"description">>, Raw), <<>>),
                                            <<"fields">> => Fields, <<"sections">> => Sections},
                                    sd_db:hset_json(?TSTRUCTS, key(Name), Def),
                                    {ok, Def};
                                Err -> Err
                            end;
                        Err -> Err
                    end;
                Err -> Err
            end
    end;
save_tstruct(_) -> {error, bad_request, <<"Expected a JSON object.">>}.

delete_tstruct(Name) ->
    case get_tstruct(Name) of
        undefined -> {error, not_found, <<"No such lite structure.">>};
        Def ->
            RealName = maps:get(<<"name">>, Def),
            case [maps:get(<<"id">>, O) || O <- list_options(),
                                            maps:get(<<"type">>, O) =:= <<"data_input">>,
                                            maps:get(<<"target">>, O, null) =:= RealName] of
                [] -> sd_db:hdel(?TSTRUCTS, key(RealName)), ok;
                Used -> {error, in_use, iolist_to_binary(
                            io_lib:format("Used by option(s): ~s", [lists:join(", ", Used)]))}
            end
    end.

validate_fields(L) when is_list(L), L =/= [], length(L) =< ?MAX_FIELDS -> validate_fields(L, [], []);
validate_fields(_) -> {error, invalid, <<"fields must be a non-empty list (max 100).">>}.

validate_fields([], _Seen, Acc) -> {ok, lists:reverse(Acc)};
validate_fields([F | Rest], Seen, Acc) when is_map(F) ->
    Name = sd_util:get(<<"name">>, F),
    Type = sd_util:get(<<"type">>, F),
    case {valid_ident(Name), lists:member(Type, ?FIELD_TYPES), lists:member(Name, Seen)} of
        {false, _, _} -> {error, invalid, <<"Each field needs a valid name.">>};
        {_, _, true} -> {error, invalid, <<"Duplicate field name: ", Name/binary>>};
        {_, false, _} -> {error, invalid, <<"Field ", Name/binary, ": type must be one of ",
                                            (join(?FIELD_TYPES))/binary>>};
        _ ->
            case field_extras(Type, F, Name) of
                {ok, Extras} ->
                    Field0 = #{<<"name">> => Name, <<"type">> => Type,
                               <<"caption">> => text(sd_util:get(<<"caption">>, F), Name),
                               <<"required">> => sd_util:is_true(sd_util:get(<<"required">>, F, false)),
                               <<"section">> => sd_util:get(<<"section">>, F, null),
                               <<"condition">> => sd_util:get(<<"condition">>, F, null)},
                    validate_fields(Rest, [Name | Seen], [maps:merge(Field0, Extras) | Acc]);
                Err -> Err
            end
    end;
validate_fields(_, _, _) -> {error, invalid, <<"Each field must be an object.">>}.

%% Type-specific attributes: ranges for date/time/number, options for list.
field_extras(Type, F, _Name) when Type =:= <<"date">>; Type =:= <<"time">> ->
    {ok, maps:filter(fun(_, V) -> V =/= undefined end,
                     #{<<"min">> => opt_bin(F, <<"min">>), <<"max">> => opt_bin(F, <<"max">>)})};
field_extras(Type, F, FieldName) when Type =:= <<"wholenumber">>; Type =:= <<"number">> ->
    Min = sd_util:get(<<"min">>, F), Max = sd_util:get(<<"max">>, F),
    case (Min =:= undefined orelse is_number(Min)) andalso (Max =:= undefined orelse is_number(Max)) of
        true -> {ok, maps:filter(fun(_, V) -> V =/= undefined end, #{<<"min">> => Min, <<"max">> => Max})};
        false -> {error, invalid, <<"Field ", FieldName/binary, ": min/max must be numbers.">>}
    end;
field_extras(<<"text">>, F, _) ->
    {ok, #{<<"multiline">> => sd_util:is_true(sd_util:get(<<"multiline">>, F, false)),
           <<"rich">> => sd_util:is_true(sd_util:get(<<"rich">>, F, false))}};
field_extras(<<"mobile">>, F, _) ->
    {ok, #{<<"withCountryCode">> => sd_util:is_true(sd_util:get(<<"withCountryCode">>, F, false))}};
field_extras(<<"list">>, F, Name) ->
    case sd_util:get(<<"options">>, F) of
        L when is_list(L), L =/= [] ->
            case lists:all(fun is_binary/1, L) of
                true -> {ok, #{<<"options">> => L,
                               <<"multi">> => sd_util:is_true(sd_util:get(<<"multi">>, F, false))}};
                false -> {error, invalid, <<"Field ", Name/binary, ": options must be text values.">>}
            end;
        _ -> {error, invalid, <<"Field ", Name/binary, ": a list field needs options.">>}
    end;
field_extras(<<"selection">>, F, _) ->
    {ok, #{<<"api">> => sd_util:get(<<"api">>, F, null)}};
field_extras(<<"fill">>, F, _) ->
    {ok, #{<<"fillFrom">> => sd_util:get(<<"fillFrom">>, F, null)}};
field_extras(_, _, _) -> {ok, #{}}.

validate_sections(L, _FieldNames) when not is_list(L) ->
    {error, invalid, <<"sections must be a list.">>};
validate_sections(L, _FieldNames) ->
    Res = [case S of
               #{<<"name">> := N} when is_binary(N), N =/= <<>> ->
                   {ok, #{<<"name">> => N, <<"caption">> => text(sd_util:get(<<"caption">>, S), N),
                          <<"condition">> => sd_util:get(<<"condition">>, S, null)}};
               _ -> {error, invalid, <<"Each section needs a name.">>}
           end || S <- L],
    case [E || {error, _, _} = E <- Res] of
        [] -> {ok, [S || {ok, S} <- Res]};
        [E | _] -> E
    end.

%% Every condition may only look at fields that exist; fields may only name
%% sections that exist.
check_field_refs(Fields, Sections, FieldNames) ->
    SectionNames = [maps:get(<<"name">>, S) || S <- Sections],
    Conds = [maps:get(<<"condition">>, F) || F <- Fields] ++ [maps:get(<<"condition">>, S) || S <- Sections],
    BadSection = [maps:get(<<"name">>, F) || F <- Fields,
                  case maps:get(<<"section">>, F) of
                      null -> false;
                      S -> not lists:member(S, SectionNames)
                  end],
    case BadSection of
        [B | _] -> {error, invalid, <<"Field ", B/binary, " names a section that doesn't exist.">>};
        [] ->
            case lists:dropwhile(fun(C) -> valid_cond(C, FieldNames) end, Conds) of
                [] -> ok;
                [_ | _] -> {error, invalid, <<"A condition is malformed or refers to an unknown field.">>}
            end
    end.

valid_cond(null, _) -> true;
valid_cond(undefined, _) -> true;
valid_cond(#{<<"all">> := L}, Names) when is_list(L) -> lists:all(fun(C) -> valid_cond(C, Names) end, L);
valid_cond(#{<<"any">> := L}, Names) when is_list(L) -> lists:all(fun(C) -> valid_cond(C, Names) end, L);
valid_cond(#{<<"field">> := F, <<"op">> := Op} = C, Names) ->
    lists:member(F, Names) andalso lists:member(Op, ?OPS) andalso
        (Op =:= <<"notempty">> orelse maps:is_key(<<"value">>, C)) andalso
        (Op =/= <<"in">> orelse is_list(maps:get(<<"value">>, C)));
valid_cond(_, _) -> false.

%% =============================================================================
%% Options
%% =============================================================================

list_options() ->
    lists:sort(fun(A, B) ->
                   {maps:get(<<"order">>, A, 0), maps:get(<<"caption">>, A)} =<
                       {maps:get(<<"order">>, B, 0), maps:get(<<"caption">>, B)}
               end,
               [O || {_, O} <- sd_db:hgetall_json(?OPTIONS), is_map(O)]).

save_option(Raw) when is_map(Raw) ->
    Id = sd_util:get(<<"id">>, Raw),
    Type = sd_util:get(<<"type">>, Raw),
    Caption = text(sd_util:get(<<"caption">>, Raw), <<>>),
    case {is_binary(Id) andalso re:run(Id, "^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$", [{capture, none}]) =:= match,
          lists:member(Type, ?OPTION_TYPES), Caption} of
        {false, _, _} -> {error, invalid, <<"id must be 1-40 chars: letters digits _ -">>};
        {_, false, _} -> {error, invalid, <<"type must be one of ", (join(?OPTION_TYPES))/binary>>};
        {_, _, <<>>} -> {error, invalid, <<"caption is required.">>};
        _ ->
            Target = text(sd_util:get(<<"target">>, Raw), <<>>),
            case check_target(Type, Target) of
                ok ->
                    case validate_applicable(sd_util:get(<<"applicable">>, Raw, #{})) of
                        {ok, Ap} ->
                            Opt = #{<<"id">> => Id, <<"caption">> => Caption, <<"type">> => Type,
                                    <<"target">> => Target,
                                    <<"display">> => display(Type, sd_util:get(<<"display">>, Raw)),
                                    <<"applicable">> => Ap,
                                    <<"active">> => sd_util:get(<<"active">>, Raw, true) =/= false,
                                    <<"order">> => case sd_util:get(<<"order">>, Raw, 0) of
                                                       O when is_integer(O) -> O;
                                                       _ -> 0
                                                   end},
                            sd_db:hset_json(?OPTIONS, sd_util:s(string:lowercase(Id)), Opt),
                            {ok, Opt};
                        Err -> Err
                    end;
                Err -> Err
            end
    end;
save_option(_) -> {error, bad_request, <<"Expected a JSON object.">>}.

check_target(<<"data_input">>, Target) ->
    case get_tstruct(Target) of
        undefined -> {error, invalid, <<"target must be an existing lite structure name.">>};
        _ -> ok
    end;
check_target(Type, <<>>) when Type =/= <<"upload">>, Type =/= <<"pay">>, Type =/= <<"download">> ->
    {error, invalid, <<"target is required for this option type.">>};
check_target(_, _) -> ok.

display(<<"get_data">>, D) when D =:= <<"table">>; D =:= <<"name_value">>; D =:= <<"text">> -> D;
display(<<"get_data">>, _) -> <<"table">>;
display(_, _) -> null.

delete_option(Id) ->
    K = sd_util:s(string:lowercase(sd_util:b(Id))),
    case sd_db:hget(?OPTIONS, K) of
        undefined -> {error, not_found, <<"No such option.">>};
        _ -> sd_db:hdel(?OPTIONS, K), ok
    end.

%% "Applicable to": all or selected user categories; if Affiliate is among
%% them, all or selected affiliates; if Employee is among them, all or
%% selected departments / branches / designations. A missing key means "all".
validate_applicable(Ap) when is_map(Ap) ->
    Cats = [<<"Employee">>, <<"Affiliate">>],
    Checks = [{<<"categories">>, fun(V) -> sd_org:exists(categories, V) orelse lists:member(V, Cats) end},
              {<<"affiliates">>, fun(V) -> sd_org:exists(affiliates, V) end},
              {<<"departments">>, fun(V) -> sd_org:exists(departments, V) end},
              {<<"branches">>, fun(V) -> sd_org:exists(branches, V) end},
              {<<"designations">>, fun(V) -> sd_org:exists(designations, V) end}],
    Res = [check_applicable(K, sd_util:get(K, Ap, <<"all">>), Ok) || {K, Ok} <- Checks],
    case [E || {error, _, _} = E <- Res] of
        [] -> {ok, maps:from_list([R || {K, _} = R <- Res, is_binary(K)])};
        [E | _] -> E
    end;
validate_applicable(_) -> {error, invalid, <<"applicable must be an object.">>}.

check_applicable(K, <<"all">>, _) -> {K, <<"all">>};
check_applicable(K, L, Ok) when is_list(L) ->
    case [V || V <- L, not (is_binary(V) andalso Ok(V))] of
        [] -> {K, L};
        [Bad | _] -> {error, invalid, iolist_to_binary(io_lib:format("applicable.~s: unknown value ~s", [K, bin(Bad)]))}
    end;
check_applicable(K, _, _) -> {error, invalid, <<"applicable.", K/binary, " must be \"all\" or a list.">>}.

%% Options this user should see, in configured order.
options_for(User) ->
    [strip(O) || O <- list_options(), maps:get(<<"active">>, O, true) =/= false, applies(O, User)].

strip(O) -> maps:with([<<"id">>, <<"caption">>, <<"type">>, <<"target">>, <<"display">>, <<"order">>], O).

applies(Option, User) ->
    Ap = maps:get(<<"applicable">>, Option, #{}),
    Cat = sd_users:effective_category(User),
    In = fun(Key, Value) ->
             case maps:get(Key, Ap, <<"all">>) of
                 <<"all">> -> true;
                 L when is_list(L) ->
                     is_binary(Value) andalso
                         lists:member(string:lowercase(Value), [string:lowercase(X) || X <- L]);
                 _ -> false
             end
         end,
    In(<<"categories">>, Cat) andalso
    case Cat of
        <<"Employee">> ->
            In(<<"departments">>, sd_util:get(<<"department">>, User)) andalso
            In(<<"branches">>, sd_util:get(<<"branch">>, User)) andalso
            In(<<"designations">>, sd_util:get(<<"designation">>, User));
        <<"Affiliate">> ->
            In(<<"affiliates">>, sd_util:get(<<"affiliate">>, User));
        _ -> true
    end.

%% =============================================================================
%% Application connections
%% =============================================================================

list_appconns() ->
    [strip_conn(C) || {_, C} <- sd_db:hgetall_json(?APPCONNS), is_map(C)].

strip_conn(C) ->
    (maps:without([<<"credentials">>], C))#{<<"hasCredentials">> => maps:is_key(<<"credentials">>, C)}.

%% Raw: name, url, authType (none|basic|bearer), credentials {...}.
%% Omitting credentials on an update keeps the ones already stored.
save_appconn(Raw) when is_map(Raw) ->
    Name = sd_util:get(<<"name">>, Raw),
    Url = sd_util:get(<<"url">>, Raw),
    Auth = sd_util:get(<<"authType">>, Raw, <<"none">>),
    case {valid_ident(Name), is_binary(Url) andalso re:run(Url, "^https?://[^\\s]+$", [{capture, none}]) =:= match,
          lists:member(Auth, [<<"none">>, <<"basic">>, <<"bearer">>])} of
        {false, _, _} -> {error, invalid, <<"name must be letters/digits/underscore, starting with a letter.">>};
        {_, false, _} -> {error, invalid, <<"url must start with http:// or https://">>};
        {_, _, false} -> {error, invalid, <<"authType must be none, basic or bearer.">>};
        _ ->
            Old = sd_db:hget_json(?APPCONNS, key(Name)),
            Cred = case sd_util:get(<<"credentials">>, Raw) of
                       C when is_map(C), map_size(C) > 0 ->
                           #{<<"credentials">> => sd_util:seal(sd_util:jenc(C))};
                       _ when is_map(Old), Auth =/= <<"none">> ->
                           maps:with([<<"credentials">>], Old);
                       _ -> #{}
                   end,
            Conn = maps:merge(#{<<"name">> => Name, <<"url">> => Url, <<"authType">> => Auth}, Cred),
            sd_db:hset_json(?APPCONNS, key(Name), Conn),
            {ok, strip_conn(Conn)}
    end;
save_appconn(_) -> {error, bad_request, <<"Expected a JSON object.">>}.

delete_appconn(Name) ->
    case sd_db:hget(?APPCONNS, key(Name)) of
        undefined -> {error, not_found, <<"No such connection.">>};
        _ -> sd_db:hdel(?APPCONNS, key(Name)), ok
    end.

%% =============================================================================
%% Runtime: what a user is allowed to fill in, and submitting it
%% =============================================================================

%% A user may fetch a lite structure only if one of *their* options points
%% at it (admins may fetch any, for previewing).
tstruct_for_user(User, Name) ->
    case get_tstruct(Name) of
        undefined -> {error, not_found, <<"No such form.">>};
        Def ->
            RealName = maps:get(<<"name">>, Def),
            Allowed = sd_users:is_admin(User) orelse
                lists:any(fun(O) -> maps:get(<<"type">>, O) =:= <<"data_input">> andalso
                                    maps:get(<<"target">>, O) =:= RealName
                          end, options_for(User)),
            case Allowed of
                true -> {ok, Def};
                false -> {error, forbidden, <<"That form isn't available to you.">>}
            end
    end.

%% Values: #{fieldName => value}. Returns {ok, Submission} or
%% {error, invalid_values, Msg, #{<<"fields">> => #{Field => Message}}}.
submit(User, Name, Values) when is_map(Values) ->
    case tstruct_for_user(User, Name) of
        {error, _, _} = Err -> Err;
        {ok, Def} ->
            case check_values(Def, Values) of
                {ok, Clean} ->
                    Id = sd_db:incr("sd:seq:sub"),
                    Username = maps:get(<<"username">>, User),
                    Host = sd_util:get(<<"host">>, User),
                    Sub = #{<<"id">> => Id, <<"tstruct">> => maps:get(<<"name">>, Def),
                            <<"by">> => Username, <<"host">> => Host,
                            <<"values">> => Clean, <<"ts">> => sd_util:now_ms()},
                    sd_db:hset_json("sd:subs", integer_to_list(Id), Sub),
                    Members = [Username | case Host of H when is_binary(H) -> [H]; _ -> [] end],
                    lists:foreach(fun(M) ->
                                      sd_db:zadd("sd:subs:u:" ++ sd_util:s(M), maps:get(<<"ts">>, Sub),
                                                 integer_to_binary(Id))
                                  end, Members),
                    case Host of
                        H2 when is_binary(H2) ->
                            sd_cards:add(H2, #{<<"kind">> => <<"system">>, <<"from">> => Username,
                                               <<"text">> => <<(maps:get(<<"name">>, User))/binary,
                                                               " submitted ",
                                                               (maps:get(<<"caption">>, Def))/binary>>,
                                               <<"ref">> => #{<<"submissionId">> => Id}});
                        _ -> ok
                    end,
                    {ok, Sub};
                {error, Fields} ->
                    {error, invalid_values, <<"Some fields need attention.">>, #{<<"fields">> => Fields}}
            end
    end;
submit(_, _, _) -> {error, bad_request, <<"values must be an object.">>}.

%% The user's own submissions plus those from users they host, newest first.
list_submissions(User) ->
    Ids = sd_db:zrevrange("sd:subs:u:" ++ sd_util:s(maps:get(<<"username">>, User)), 0, 99),
    [S || B <- Ids, S <- [sd_db:hget_json("sd:subs", binary_to_list(B))], is_map(S)].

%% ---- value checking -------------------------------------------------------------------------------

check_values(Def, Values) ->
    Fields = maps:get(<<"fields">>, Def),
    Sections = maps:get(<<"sections">>, Def, []),
    SecVisible = maps:from_list([{maps:get(<<"name">>, S), eval(maps:get(<<"condition">>, S, null), Values)}
                                 || S <- Sections]),
    {Clean, Errors} = lists:foldl(
        fun(F, {CAcc, EAcc}) ->
            Name = maps:get(<<"name">>, F),
            Visible = field_visible(F, Values, SecVisible),
            case Visible of
                false -> {CAcc, EAcc};
                true ->
                    V = maps:get(Name, Values, null),
                    case empty(V) of
                        true ->
                            case maps:get(<<"required">>, F, false) of
                                true -> {CAcc, EAcc#{Name => <<"This field is required.">>}};
                                false -> {CAcc, EAcc}
                            end;
                        false ->
                            case check_type(maps:get(<<"type">>, F), V, F) of
                                {ok, Norm} -> {CAcc#{Name => Norm}, EAcc};
                                {error, Msg} -> {CAcc, EAcc#{Name => Msg}}
                            end
                    end
            end
        end, {#{}, #{}}, Fields),
    case map_size(Errors) of
        0 -> {ok, Clean};
        _ -> {error, Errors}
    end.

field_visible(F, Values, SecVisible) ->
    SecOk = case maps:get(<<"section">>, F, null) of
                null -> true;
                S -> maps:get(S, SecVisible, true)
            end,
    SecOk andalso eval(maps:get(<<"condition">>, F, null), Values).

empty(null) -> true;
empty(undefined) -> true;
empty(<<>>) -> true;
empty([]) -> true;
empty(V) when is_binary(V) -> string:trim(V) =:= <<>>;
empty(_) -> false.

%% Conditions: {field, op, value} or {all:[...]} / {any:[...]}.
eval(null, _) -> true;
eval(undefined, _) -> true;
eval(#{<<"all">> := L}, V) -> lists:all(fun(C) -> eval(C, V) end, L);
eval(#{<<"any">> := L}, V) -> lists:any(fun(C) -> eval(C, V) end, L);
eval(#{<<"field">> := F, <<"op">> := Op} = C, Values) ->
    Actual = maps:get(F, Values, null),
    Want = maps:get(<<"value">>, C, null),
    case Op of
        <<"notempty">> -> not empty(Actual);
        <<"eq">> -> cmp(Actual, Want) =:= eq;
        <<"ne">> -> cmp(Actual, Want) =/= eq;
        <<"gt">> -> cmp(Actual, Want) =:= gt;
        <<"lt">> -> cmp(Actual, Want) =:= lt;
        <<"gte">> -> lists:member(cmp(Actual, Want), [gt, eq]);
        <<"lte">> -> lists:member(cmp(Actual, Want), [lt, eq]);
        <<"in">> -> lists:any(fun(W) -> cmp(Actual, W) =:= eq end, Want)
    end;
eval(_, _) -> true.

%% Numbers compare numerically, everything else as text.
cmp(A, B) ->
    case {num(A), num(B)} of
        {{ok, X}, {ok, Y}} -> ord(X, Y);
        _ -> ord(bin(A), bin(B))
    end.

ord(X, Y) when X < Y -> lt;
ord(X, Y) when X > Y -> gt;
ord(_, _) -> eq.

num(N) when is_number(N) -> {ok, N};
num(B) when is_binary(B) ->
    case string:to_float(binary_to_list(string:trim(B))) of
        {F, []} -> {ok, F};
        _ ->
            case string:to_integer(binary_to_list(string:trim(B))) of
                {I, []} -> {ok, I};
                _ -> error
            end
    end;
num(_) -> error.

check_type(<<"text">>, V, _) when is_binary(V) ->
    case byte_size(V) =< 5000 of true -> {ok, V}; false -> {error, <<"Too long (max 5000 characters).">>} end;
check_type(<<"email">>, V, _) when is_binary(V) ->
    E = sd_util:norm_email(V),
    case sd_util:valid_email(E) of true -> {ok, E}; false -> {error, <<"Enter a valid email address.">>} end;
check_type(<<"url">>, V, _) when is_binary(V) ->
    case re:run(V, "^https?://[^\\s]+$", [{capture, none}]) of
        match -> {ok, V};
        nomatch -> {error, <<"Enter a valid http(s) URL.">>}
    end;
check_type(<<"mobile">>, V, F) when is_binary(V) ->
    M = sd_util:norm_mobile(V),
    NeedsCode = maps:get(<<"withCountryCode">>, F, false),
    case {sd_util:valid_mobile(M), NeedsCode, M} of
        {false, _, _} -> {error, <<"Enter a valid mobile number.">>};
        {true, true, <<"+", _/binary>>} -> {ok, M};
        {true, true, _} -> {error, <<"Include the country code, e.g. +91...">>};
        {true, false, _} -> {ok, M}
    end;
check_type(<<"date">>, V, F) when is_binary(V) ->
    case re:run(V, "^(\\d{4})-(\\d{2})-(\\d{2})$", [{capture, all_but_first, list}]) of
        {match, [Y, M, D]} ->
            case calendar:valid_date(list_to_integer(Y), list_to_integer(M), list_to_integer(D)) of
                true -> in_range(V, F);
                false -> {error, <<"That date doesn't exist.">>}
            end;
        nomatch -> {error, <<"Use the format YYYY-MM-DD.">>}
    end;
check_type(<<"time">>, V, F) when is_binary(V) ->
    case re:run(V, "^([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?$", [{capture, none}]) of
        match -> in_range(V, F);
        nomatch -> {error, <<"Use the format HH:MM.">>}
    end;
check_type(<<"wholenumber">>, V, F) ->
    case num(V) of
        {ok, N} when is_integer(N) -> num_range(N, F);
        {ok, N} when is_float(N), N == trunc(N) -> num_range(trunc(N), F);
        _ -> {error, <<"Enter a whole number.">>}
    end;
check_type(<<"number">>, V, F) ->
    case num(V) of
        {ok, N} -> num_range(N, F);
        error -> {error, <<"Enter a number.">>}
    end;
check_type(<<"location">>, #{<<"lat">> := La, <<"lng">> := Ln} = V, _)
        when is_number(La), is_number(Ln), La >= -90, La =< 90, Ln >= -180, Ln =< 180 ->
    {ok, maps:with([<<"lat">>, <<"lng">>], V)};
check_type(<<"location">>, V, _) when is_binary(V) ->
    case string:split(binary_to_list(V), ",") of
        [A, B] ->
            case {num(list_to_binary(A)), num(list_to_binary(B))} of
                {{ok, La}, {ok, Ln}} when La >= -90, La =< 90, Ln >= -180, Ln =< 180 ->
                    {ok, #{<<"lat">> => La, <<"lng">> => Ln}};
                _ -> {error, <<"Enter coordinates as lat,lng.">>}
            end;
        _ -> {error, <<"Enter coordinates as lat,lng.">>}
    end;
check_type(<<"location">>, _, _) -> {error, <<"Enter coordinates as {lat,lng}.">>};
check_type(<<"list">>, V, F) ->
    Options = maps:get(<<"options">>, F, []),
    case {maps:get(<<"multi">>, F, false), V} of
        {true, L} when is_list(L) ->
            case lists:all(fun(X) -> lists:member(X, Options) end, L) of
                true -> {ok, L};
                false -> {error, <<"Choose only from the listed options.">>}
            end;
        {false, B} when is_binary(B) ->
            case lists:member(B, Options) of
                true -> {ok, B};
                false -> {error, <<"Choose one of the listed options.">>}
            end;
        _ -> {error, <<"Choose from the listed options.">>}
    end;
check_type(T, V, _) when T =:= <<"selection">>; T =:= <<"fill">> ->
    case bin(V) of
        B when byte_size(B) =< 500 -> {ok, V};
        _ -> {error, <<"Too long.">>}
    end;
check_type(_, _, _) -> {error, <<"Wrong type of value.">>}.

in_range(V, F) ->
    Min = maps:get(<<"min">>, F, undefined), Max = maps:get(<<"max">>, F, undefined),
    case {Min =:= undefined orelse V >= Min, Max =:= undefined orelse V =< Max} of
        {true, true} -> {ok, V};
        {false, _} -> {error, <<"Must be on or after ", Min/binary>>};
        {_, false} -> {error, <<"Must be on or before ", Max/binary>>}
    end.

num_range(N, F) ->
    Min = maps:get(<<"min">>, F, undefined), Max = maps:get(<<"max">>, F, undefined),
    case {Min =:= undefined orelse N >= Min, Max =:= undefined orelse N =< Max} of
        {true, true} -> {ok, N};
        {false, _} -> {error, iolist_to_binary(io_lib:format("Must be at least ~p.", [Min]))};
        {_, false} -> {error, iolist_to_binary(io_lib:format("Must be at most ~p.", [Max]))}
    end.

%% ---- small helpers ------------------------------------------------------------------------------------

key(Name) -> sd_util:s(string:lowercase(sd_util:b(Name))).

valid_ident(N) ->
    is_binary(N) andalso re:run(N, "^[A-Za-z][A-Za-z0-9_]{0,39}$", [{capture, none}]) =:= match.

text(V, Default) when is_binary(V) ->
    case string:trim(V) of <<>> -> Default; T -> T end;
text(_, Default) -> Default.

opt_bin(Map, Key) ->
    case sd_util:get(Key, Map) of
        V when is_binary(V) -> V;
        _ -> undefined
    end.

bin(V) when is_binary(V) -> V;
bin(V) when is_integer(V) -> integer_to_binary(V);
bin(V) when is_float(V) -> float_to_binary(V, [{decimals, 6}, compact]);
bin(V) when is_atom(V) -> atom_to_binary(V, utf8);
bin(V) -> iolist_to_binary(io_lib:format("~p", [V])).

join(List) -> iolist_to_binary(lists:join(", ", List)).
