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
-export([visible_tstructs/1, find_tstruct_name/2, list_tstructs/0, get_tstruct/1, save_tstruct/1, delete_tstruct/1,
         list_options/0, save_option/1, delete_option/1, options_for/1, option_categories/0, option_categories_for/2, options_page/2, option_types/0,
         list_appconns/0, save_appconn/1, delete_appconn/1, appconn_raw/1, safe_path/1,
         tstruct_for_user/2, submit/4, list_submissions/2, search_records/2,
         update_submission/3, delete_submission/2,
         list_user_tstructs/0, get_user_tstruct/1, save_user_tstruct/2, update_user_tstruct/2,
         delete_user_tstruct/2, submit_user_tstruct/4, applies/2, applies/3, eval/2, valid_cond/2, validate_applicable/1,
         list_user_options/1, save_user_option/2, delete_user_option/2, option_targets_file/2]).

-define(TSTRUCTS, "sd:tstructs").
-define(USER_TSTRUCTS, "sd:tstructs:user").
-define(OPTIONS, "sd:options").
-define(APPCONNS, "sd:appconns").
-define(FIELD_TYPES, [<<"text">>, <<"date">>, <<"time">>, <<"wholenumber">>, <<"number">>,
                      <<"email">>, <<"url">>, <<"mobile">>, <<"location">>, <<"list">>,
                      <<"selection">>, <<"fill">>, <<"barcode">>]).
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
    %% countryPicker / defaultCountry are display hints kept for the studio's editor; only
    %% withCountryCode changes validation.
    {ok, maps:filter(fun(_, V) -> V =/= undefined end,
                     #{<<"withCountryCode">> => sd_util:is_true(sd_util:get(<<"withCountryCode">>, F, false)),
                       <<"countryPicker">> => sd_util:is_true(sd_util:get(<<"countryPicker">>, F, false)),
                       <<"defaultCountry">> => opt_bin(F, <<"defaultCountry">>)})};
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
    {ok, #{<<"fillFrom">> => sd_util:get(<<"fillFrom">>, F, null),
           <<"sourceProp">> => sd_util:get(<<"sourceProp">>, F, null)}};
%% barcode/QR: scanned value is a plain string; no required extras for v1.
%% (A future `formats` list could restrict accepted symbologies, e.g.
%%  ["qr","ean13","code128"], but there's no concrete need to restrict yet.)
field_extras(<<"barcode">>, _F, _) -> {ok, #{}};
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
    (Names =:= any orelse lists:member(F, Names)) andalso lists:member(Op, ?OPS) andalso
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

%% Admin console path: an administrator saves any option; a new one has no owner.
save_option(Raw) -> do_save_option(Raw, undefined, null).

%% Any signed-in user may make options of their own (owner = them). They can only
%% edit/delete their own; an administrator can manage all of them.
save_user_option(User, Raw) when is_map(Raw) ->
    Id = case sd_util:get(<<"id">>, Raw) of
             V when is_binary(V), V =/= <<>> -> V;
             _ -> <<"o", (integer_to_binary(sd_db:incr("sd:seq:option")))/binary>>
         end,
    do_save_option(Raw#{<<"id">> => Id}, User, maps:get(<<"username">>, User));
save_user_option(_, _) -> {error, bad_request, <<"Expected a JSON object.">>}.

do_save_option(Raw, User, OwnerForNew) when is_map(Raw) ->
    Id = sd_util:get(<<"id">>, Raw),
    Type = sd_util:get(<<"type">>, Raw),
    Caption = text(sd_util:get(<<"caption">>, Raw), <<>>),
    case {is_binary(Id) andalso re:run(Id, "^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$", [{capture, none}]) =:= match,
          lists:member(Type, ?OPTION_TYPES), Caption} of
        {false, _, _} -> {error, invalid, <<"id must be 1-40 chars: letters digits _ -">>};
        {_, false, _} -> {error, invalid, <<"type must be one of ", (join(?OPTION_TYPES))/binary>>};
        {_, _, <<>>} -> {error, invalid, <<"caption is required.">>};
        _ ->
            Existing = sd_db:hget_json(?OPTIONS, sd_util:s(string:lowercase(Id))),
            Actor = case User of
                        undefined -> admin;
                        _ -> case sd_users:is_admin(User) of true -> admin; false -> {user, User} end
                    end,
            case may_change_option(Existing, Actor) of
                {error, _, _} = Err -> Err;
                ok ->
                    Owner = case Existing of
                                #{<<"owner">> := O} -> O;
                                _ -> OwnerForNew
                            end,
                    Target = text(sd_util:get(<<"target">>, Raw), <<>>),
                    case check_target(Type, Target, Actor) of
                        {ok, Scope} ->
                            case {validate_applicable(sd_util:get(<<"applicable">>, Raw, #{})), option_condition(sd_util:get(<<"condition">>, Raw, null))} of
                                {_, {error, _, _} = CErr} -> CErr;
                                {{ok, Ap}, {ok, Cond}} ->
                                    Opt = #{<<"id">> => Id, <<"caption">> => Caption, <<"type">> => Type,
                                            <<"target">> => Target, <<"targetScope">> => Scope,
                                            <<"owner">> => Owner,
                                            <<"createdTs">> => case Existing of
                                                                   #{<<"createdTs">> := C} when is_integer(C) -> C;
                                                                   _ -> sd_util:now_ms()
                                                               end,
                                            <<"modifiedTs">> => case Existing of undefined -> null; _ -> sd_util:now_ms() end,
                                            <<"display">> => display(Type, sd_util:get(<<"display">>, Raw)),
                                            <<"applicable">> => Ap,
                                            <<"condition">> => Cond,
                                            <<"active">> => sd_util:get(<<"active">>, Raw, true) =/= false,
                                            <<"order">> => case sd_util:get(<<"order">>, Raw, 0) of
                                                               Ord when is_integer(Ord) -> Ord;
                                                               _ -> 0
                                                           end},
                                    sd_db:hset_json(?OPTIONS, sd_util:s(string:lowercase(Id)), Opt),
                                    {ok, Opt};
                                {{error, _, _} = AErr, _} -> AErr
                            end;
                        Err -> Err
                    end
            end
    end;
do_save_option(_, _, _) -> {error, bad_request, <<"Expected a JSON object.">>}.

%% An option's own rule: null (always shown) or a condition over the global variables, e.g.
%% {"all":[{"field":"city","op":"eq","value":"Pune"},{"field":"isHost","op":"eq","value":true}]}.
option_condition(null) -> {ok, null};
option_condition(C) when is_map(C) ->
    Refs = sd_globals:referenced(C),
    case valid_cond(C, any) andalso length(Refs) =< 50 of
        false -> {error, invalid, <<"condition is malformed (or too large).">>};
        true ->
            Known = sd_globals:known(),
            case [F || F <- Refs, not lists:member(F, Known)] of
                [] -> {ok, C};
                [Bad | _] -> {error, invalid, <<"condition refers to an unknown variable: ", Bad/binary>>}
            end
    end;
option_condition(_) -> {error, invalid, <<"condition must be an object or null.">>}.

%% New id, an administrator, or the option's own creator may save it.
may_change_option(undefined, _) -> ok;
may_change_option(_, admin) -> ok;
may_change_option(#{<<"owner">> := Owner}, {user, User}) when is_binary(Owner) ->
    case Owner =:= maps:get(<<"username">>, User) of
        true -> ok;
        false -> {error, forbidden, <<"That option belongs to someone else.">>}
    end;
may_change_option(_, {user, _}) ->
    {error, forbidden, <<"Only an administrator can change this option.">>}.

%% -> {ok, TargetScope} | Error. TargetScope says which kind of form a data_input option opens.
check_target(<<"data_input">>, Target, Actor) ->
    case {get_tstruct(Target), get_user_tstruct(Target), Actor} of
        {Adm, _, admin} when is_map(Adm) -> {ok, <<"admin">>};
        {_, Usr, _} when is_map(Usr) -> {ok, <<"user">>};
        {Adm, _, {user, _}} when is_map(Adm) ->
            %% A user-made option would otherwise hand everyone access to a restricted form.
            {error, forbidden, <<"Only an administrator can point an option at an admin-managed form.">>};
        _ -> {error, invalid, <<"target must be the name of an existing form.">>}
    end;
check_target(<<"download">>, Target, Actor) ->
    case Target of
        <<>> -> {ok, null};
        _ ->
            case sd_files:get(Target) of
                undefined -> {error, invalid, <<"target must be the id of an uploaded file.">>};
                #{<<"by">> := By} ->
                    case Actor of
                        admin -> {ok, null};
                        {user, U} ->
                            %% You can only share a file you uploaded yourself.
                            case By =:= maps:get(<<"username">>, U) of
                                true -> {ok, null};
                                false -> {error, forbidden, <<"You can only share a file you uploaded.">>}
                            end
                    end
            end
    end;
check_target(Type, <<>>, _) when Type =/= <<"upload">>, Type =/= <<"pay">> ->
    {error, invalid, <<"target is required for this option type.">>};
check_target(_, _, _) -> {ok, null}.

display(<<"get_data">>, D) when D =:= <<"table">>; D =:= <<"name_value">>; D =:= <<"text">> -> D;
display(<<"get_data">>, _) -> <<"table">>;
display(_, _) -> null.

delete_option(Id) ->
    K = sd_util:s(string:lowercase(sd_util:b(Id))),
    case sd_db:hget(?OPTIONS, K) of
        undefined -> {error, not_found, <<"No such option.">>};
        _ -> sd_db:hdel(?OPTIONS, K), ok
    end.

%% Options the caller manages: their own; an administrator manages all.
list_user_options(User) ->
    Name = maps:get(<<"username">>, User),
    case sd_users:is_admin(User) of
        true -> list_options();
        false -> [O || O <- list_options(), maps:get(<<"owner">>, O, null) =:= Name]
    end.

delete_user_option(User, Id) ->
    K = sd_util:s(string:lowercase(sd_util:b(Id))),
    Actor = case sd_users:is_admin(User) of true -> admin; false -> {user, User} end,
    case sd_db:hget_json(?OPTIONS, K) of
        undefined -> {error, not_found, <<"No such option.">>};
        Existing ->
            case may_change_option(Existing, Actor) of
                ok -> sd_db:hdel(?OPTIONS, K), ok;
                Err -> Err
            end
    end.

%% Does an active download option pointing at this file apply to the user? (= may they fetch it)
option_targets_file(FileId, User) ->
    lists:any(fun(O) ->
                  maps:get(<<"type">>, O) =:= <<"download">> andalso
                  maps:get(<<"target">>, O, <<>>) =:= FileId andalso
                  maps:get(<<"active">>, O, true) =/= false andalso
                  applies(O, User)
              end, list_options()).

%% "Applicable to": all or selected user categories; if Affiliate is among
%% them, all or selected affiliates; if Employee is among them, all or
%% selected departments / branches / designations. A missing key means "all".
validate_applicable(Ap) when is_map(Ap) ->
    Cats = [<<"Employee">>, <<"Affiliate">>],
    Checks = [{<<"categories">>, fun(V) -> sd_org:exists(categories, V) orelse lists:member(V, Cats) end},
              {<<"affiliates">>, fun(V) -> sd_org:exists(affiliates, V) end},
              {<<"departments">>, fun(V) -> sd_org:exists(departments, V) end},
              {<<"branches">>, fun(V) -> sd_org:exists(branches, V) end},
              {<<"designations">>, fun(V) -> sd_org:exists(designations, V) end},
              {<<"roles">>, fun(V) -> sd_org:exists(roles, V) end}],
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
    Vars = sd_globals:values(User),
    [strip(O) || O <- list_options(), maps:get(<<"active">>, O, true) =/= false, applies(O, User, Vars)].

strip(O) ->
    S = maps:with([<<"id">>, <<"caption">>, <<"type">>, <<"target">>, <<"targetScope">>, <<"owner">>, <<"display">>, <<"order">>], O),
    S#{<<"category">> => category_of(maps:get(<<"type">>, O, <<>>))}.

%% ---- option categories (the Smart Prompts pills) ---------------------------------------------------------
%% One pill per category, in this order. The four Axpert types share one "Axpert option" pill, as in the
%% Option Builder. `executable` = the chat can run it today; the others are stored but "config only".
option_categories() ->
    [#{<<"id">> => <<"data_input">>, <<"label">> => <<"Data input">>, <<"icon">> => <<"edit_note">>,
       <<"types">> => [<<"data_input">>], <<"executable">> => true},
     #{<<"id">> => <<"download">>, <<"label">> => <<"Download">>, <<"icon">> => <<"download">>,
       <<"types">> => [<<"download">>], <<"executable">> => true},
     #{<<"id">> => <<"upload">>, <<"label">> => <<"Upload">>, <<"icon">> => <<"upload">>,
       <<"types">> => [<<"upload">>], <<"executable">> => true},
     #{<<"id">> => <<"get_data">>, <<"label">> => <<"API display">>, <<"icon">> => <<"table_chart">>,
       <<"types">> => [<<"get_data">>], <<"executable">> => false},
     #{<<"id">> => <<"pay">>, <<"label">> => <<"Pay">>, <<"icon">> => <<"payments">>,
       <<"types">> => [<<"pay">>], <<"executable">> => false},
     #{<<"id">> => <<"axpert">>, <<"label">> => <<"Axpert option">>, <<"icon">> => <<"widgets">>,
       <<"types">> => [<<"axpert_tstruct">>, <<"axpert_smartview">>, <<"axpert_iview">>, <<"axpert_page">>],
       <<"executable">> => false}].

category_of(Type) ->
    case [maps:get(<<"id">>, C) || C <- option_categories(), lists:member(Type, maps:get(<<"types">>, C))] of
        [Id | _] -> Id;
        [] -> <<"other">>
    end.

%% The pills for this user: each category with how many options apply to them. Empty categories are left out
%% unless IncludeEmpty. Counts follow exactly the same rules as options_for/1 (active + "applicable to").
option_categories_for(User, IncludeEmpty) ->
    Opts = options_for(User),
    [C#{<<"count">> => N}
     || C <- option_categories(),
        N <- [length([O || O <- Opts, maps:get(<<"category">>, O) =:= maps:get(<<"id">>, C)])],
        IncludeEmpty orelse N > 0].

%% One searchable, paged list. Args (all optional): category (a category id, or a raw type), q (matches
%% caption, id or target, any case), page (1-based), pageSize (default 20, max 100).
options_page(User, Args) ->
    CatArg = case sd_util:get(<<"category">>, Args) of B when is_binary(B), B =/= <<>> -> B; _ -> undefined end,
    case CatArg =:= undefined orelse category_known(CatArg) of
        false -> {error, invalid, <<"Unknown category. Use one of: ", (join(category_ids()))/binary, ".">>};
        true ->
            Cat = category_id(CatArg),
            Q = query_text(sd_util:get(<<"q">>, Args)),
            All = [O || O <- options_for(User),
                        Cat =:= undefined orelse maps:get(<<"category">>, O) =:= Cat,
                        matches_query(O, Q)],
            Sorted = lists:sort(fun(A, B) -> sort_key(A) =< sort_key(B) end, All),
            Size = clamp_int(sd_util:get(<<"pageSize">>, Args), 20, 1, 100),
            Total = length(Sorted),
            Pages = max(1, (Total + Size - 1) div Size),
            Page = clamp_int(sd_util:get(<<"page">>, Args), 1, 1, Pages),
            Slice = lists:sublist(Sorted, (Page - 1) * Size + 1, Size),
            {ok, #{<<"options">> => Slice, <<"category">> => case Cat of undefined -> null; _ -> Cat end,
                   <<"q">> => Q, <<"page">> => Page, <<"pageSize">> => Size, <<"total">> => Total,
                   <<"totalPages">> => Pages, <<"hasMore">> => Page < Pages}}
    end.

category_ids() -> [maps:get(<<"id">>, C) || C <- option_categories()].
category_known(B) -> lists:member(B, category_ids()) orelse lists:member(B, ?OPTION_TYPES).
category_id(undefined) -> undefined;
category_id(B) -> case lists:member(B, category_ids()) of true -> B; false -> category_of(B) end.

%% A raw type ("axpert_iview") narrows to that type's category; the caller wanted one whole category anyway.
query_text(B) when is_binary(B) ->
    Clean = << <<C>> || <<C>> <= B, C >= 32, C =/= 127 >>,
    string:lowercase(string:trim(binary:part(Clean, 0, min(byte_size(Clean), 100))));
query_text(_) -> <<>>.

matches_query(_O, <<>>) -> true;
matches_query(O, Q) ->
    lists:any(fun(K) ->
                  case maps:get(K, O, <<>>) of
                      V when is_binary(V) -> binary:match(string:lowercase(V), Q) =/= nomatch;
                      _ -> false
                  end
              end, [<<"caption">>, <<"id">>, <<"target">>]).

sort_key(O) ->
    Ord = case maps:get(<<"order">>, O, 0) of N when is_integer(N) -> N; _ -> 0 end,
    {Ord, string:lowercase(maps:get(<<"caption">>, O, <<>>)), maps:get(<<"id">>, O, <<>>)}.

clamp_int(V, _Default, Min, Max) when is_integer(V) -> max(Min, min(Max, V));
clamp_int(_, Default, Min, Max) -> max(Min, min(Max, Default)).

applies(Option, User) -> applies(Option, User, sd_globals:values(User)).

%% "Applicable to" (category / affiliate / department / branch / designation / roles) and then the option's own
%% condition, evaluated over the user's global variables (e.g. {"field":"city","op":"eq","value":"Pune"}).
applies(Option, User, Vars) ->
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
    RoleOk = case maps:get(<<"roles">>, Ap, <<"all">>) of
                 <<"all">> -> true;
                 Wanted when is_list(Wanted) ->
                     Have = [string:lowercase(R) || R <- sd_users:roles_of(User)],
                     lists:any(fun(W) -> is_binary(W) andalso lists:member(string:lowercase(W), Have) end, Wanted);
                 _ -> false
             end,
    In(<<"categories">>, Cat) andalso
    (case Cat of
        <<"Employee">> ->
            In(<<"departments">>, sd_util:get(<<"department">>, User)) andalso
            In(<<"branches">>, sd_util:get(<<"branch">>, User)) andalso
            In(<<"designations">>, sd_util:get(<<"designation">>, User)) andalso RoleOk;
        <<"Affiliate">> ->
            In(<<"affiliates">>, sd_util:get(<<"affiliate">>, User)) andalso RoleOk;
        _ -> RoleOk
    end) andalso
    eval(maps:get(<<"condition">>, Option, null), Vars).

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
            Path = fun(K, Default) ->
                       case sd_util:get(K, Raw) of
                           undefined -> maps:get(K, case Old of undefined -> #{}; _ -> Old end, Default);
                           null -> Default;
                           P -> P
                       end
                   end,
            QueryPath = Path(<<"queryPath">>, <<"/query">>),
            CommandsPath = Path(<<"commandsPath">>, <<"/commands">>),
            Flag = fun(K) -> case sd_util:get(K, Raw) of
                                 undefined -> maps:get(K, case Old of undefined -> #{}; _ -> Old end, false) =:= true;
                                 V -> V =:= true
                             end end,
            case {safe_path(QueryPath), safe_path(CommandsPath)} of
                {false, _} -> {error, invalid, <<"queryPath must be a plain path like /query.">>};
                {_, false} -> {error, invalid, <<"commandsPath must be a plain path like /commands.">>};
                _ ->
                    %% commandLine: the spec's "Is command line required" (Axpert applications only);
                    %% allowUserDatasources: whether people may define their own (SQL) data sources on this connection.
                    Conn = maps:merge(#{<<"name">> => Name, <<"url">> => Url, <<"authType">> => Auth,
                                        <<"commandLine">> => Flag(<<"commandLine">>),
                                        <<"allowUserDatasources">> => Flag(<<"allowUserDatasources">>),
                                        <<"queryPath">> => QueryPath, <<"commandsPath">> => CommandsPath}, Cred),
                    sd_db:hset_json(?APPCONNS, key(Name), Conn),
                    {ok, strip_conn(Conn)}
            end
    end;
save_appconn(_) -> {error, bad_request, <<"Expected a JSON object.">>}.

%% The stored connection including its sealed credentials, for server-side calls only (never sent to a client).
appconn_raw(Name) -> sd_db:hget_json(?APPCONNS, key(Name)).

%% A path we are willing to append to a connection's base URL: starts with one /, no "..", no "//", no query, short.
safe_path(P) when is_binary(P), byte_size(P) =< 200 ->
    re:run(P, "^/[A-Za-z0-9._~%/-]*$", [{capture, none}]) =:= match andalso
        binary:match(P, <<"..">>) =:= nomatch andalso binary:match(P, <<"//">>) =:= nomatch;
safe_path(_) -> false.

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
            %% Only options an administrator made can open an admin-managed form: a
            %% user-made option (owner set) must never widen who can reach one.
            Allowed = sd_users:is_admin(User) orelse
                lists:any(fun(O) -> maps:get(<<"type">>, O) =:= <<"data_input">> andalso
                                    maps:get(<<"target">>, O) =:= RealName andalso
                                    maps:get(<<"targetScope">>, O, <<"admin">>) =/= <<"user">>
                          end, options_for(User)),
            case Allowed of
                true -> {ok, Def};
                false -> {error, forbidden, <<"That form isn't available to you.">>}
            end
    end.

%% Values: #{fieldName => value}. Opts is #{ref => binary()|undefined,
%% meta => map()|undefined} -- both optional, record-level metadata that
%% sits alongside the form's own fields (not validated as a field, just
%% stored + indexed for lookup). Returns {ok, Submission} or
%% {error, invalid_values, Msg, #{<<"fields">> => #{Field => Message}}}.
submit(User, Name, Values, Opts) when is_map(Values) ->
    case tstruct_for_user(User, Name) of
        {error, _, _} = Err -> Err;
        {ok, Def} -> do_submit(User, Def, Values, Opts, <<"global">>)
    end;
submit(_, _, _, _) -> {error, bad_request, <<"values must be an object.">>}.

%% Same as submit/4, but against a user-created structure (see "User-created
%% structures" below) instead of an admin-managed one gated by an Option.
%% Any signed-in user may submit -- a user-created structure is org-visible
%% the moment it exists, no Option needed.
submit_user_tstruct(User, Name, Values, Opts) when is_map(Values) ->
    case get_user_tstruct(Name) of
        undefined -> {error, not_found, <<"No such structure.">>};
        Def -> do_submit(User, Def, Values, Opts, <<"user">>)
    end;
submit_user_tstruct(_, _, _, _) -> {error, bad_request, <<"values must be an object.">>}.

do_submit(User, Def, Values, Opts, Scope) ->
    case {norm_ref(sd_util:get(ref, Opts, undefined)), norm_meta(sd_util:get(meta, Opts, undefined))} of
        {invalid_ref, _} -> {error, invalid, <<"ref must be text, at most 200 characters.">>};
        {_, invalid_meta} -> {error, invalid, <<"meta must be a JSON object.">>};
        {Ref, Meta} ->
            case check_values(Def, Values) of
                {ok, Clean} -> store_submission(User, Def, Clean, Ref, Meta, Scope);
                {error, Fields} ->
                    {error, invalid_values, <<"Some fields need attention.">>, #{<<"fields">> => Fields}}
            end
    end.

store_submission(User, Def, Clean, Ref, Meta, Scope) ->
    Id = sd_db:incr("sd:seq:sub"),
    Username = maps:get(<<"username">>, User),
    Host = sd_util:get(<<"host">>, User),
    TName = maps:get(<<"name">>, Def),
    Sub0 = #{<<"id">> => Id, <<"tstruct">> => TName, <<"scope">> => Scope,
             <<"by">> => Username, <<"host">> => Host,
             <<"values">> => Clean, <<"ts">> => sd_util:now_ms()},
    Sub1 = case Ref of undefined -> Sub0; _ -> Sub0#{<<"ref">> => Ref} end,
    Sub  = case Meta of undefined -> Sub1; _ -> Sub1#{<<"meta">> => Meta} end,
    sd_db:hset_json("sd:subs", integer_to_list(Id), Sub),
    Ts = maps:get(<<"ts">>, Sub),
    IdBin = integer_to_binary(Id),
    Members = [Username | case Host of H when is_binary(H) -> [H]; _ -> [] end],
    lists:foreach(fun(M) -> sd_db:zadd("sd:subs:u:" ++ sd_util:s(M), Ts, IdBin) end, Members),
    TKey = key(TName),
    sd_db:zadd("sd:subs:t:" ++ TKey, Ts, IdBin),
    case Ref of
        undefined -> ok;
        _ -> sd_db:zadd("sd:subs:tr:" ++ TKey ++ ":" ++ sd_util:s(Ref), Ts, IdBin)
    end,
    case Host of
        H2 when is_binary(H2) ->
            sd_cards:add(H2, #{<<"kind">> => <<"system">>, <<"from">> => Username,
                               <<"text">> => <<(maps:get(<<"name">>, User))/binary,
                                               " submitted ",
                                               (maps:get(<<"caption">>, Def))/binary>>,
                               <<"ref">> => #{<<"submissionId">> => Id}});
        _ -> ok
    end,
    {ok, Sub}.

norm_ref(undefined) -> undefined;
norm_ref(null) -> undefined;
norm_ref(R) when is_binary(R), R =/= <<>>, byte_size(R) =< 200 -> R;
norm_ref(_) -> invalid_ref.

norm_meta(undefined) -> undefined;
norm_meta(null) -> undefined;
norm_meta(M) when is_map(M) -> M;
norm_meta(_) -> invalid_meta.

%% Args (all optional): #{<<"tstruct">> => Name, <<"ref">> => Ref}.
%%  - neither given: the user's own submissions plus those from users they
%%    host, newest first (unchanged default behaviour).
%%  - tstruct given (with or without ref): every submission of that
%%    structure the *caller* is allowed to see (their own, or ones made by
%%    someone they host, or any if admin) -- still scoped, just indexed
%%    differently since it's no longer keyed off one user's own set.
list_submissions(User, Args) ->
    Username = maps:get(<<"username">>, User),
    TName = case sd_util:get(<<"tstruct">>, Args, undefined) of
                RawT when is_binary(RawT), RawT =/= <<>> -> key(RawT);
                _ -> undefined
            end,
    Ref = case sd_util:get(<<"ref">>, Args, undefined) of
              RawR when is_binary(RawR), RawR =/= <<>> -> RawR;
              _ -> undefined
          end,
    Ids = case {TName, Ref} of
              {undefined, _} -> sd_db:zrevrange("sd:subs:u:" ++ sd_util:s(Username), 0, 99);
              {TK, undefined} -> sd_db:zrevrange("sd:subs:t:" ++ TK, 0, 199);
              {TK, RV} -> sd_db:zrevrange("sd:subs:tr:" ++ TK ++ ":" ++ sd_util:s(RV), 0, 199)
          end,
    Subs = [S || B <- Ids, S <- [sd_db:hget_json("sd:subs", binary_to_list(B))], is_map(S)],
    case TName of
        undefined -> Subs; %% sd:subs:u:<user> is already correctly scoped
        _ -> [S || S <- Subs, can_see_submission(User, S)]
    end.

%% #list: records of one structure, newest first, with text search, date range, scope and paging.
%%   tstruct (required), q (matches any value, case-insensitive), from/to (ms since epoch), scope "mine" | "all"
%%   ("all" = everything the caller may see), limit (1..100, default 20), offset.
%% Looks at the newest 1000 records of the structure at most, so one call stays cheap.
search_records(User, Args) ->
    case sd_util:get(<<"tstruct">>, Args, undefined) of
        T when is_binary(T), T =/= <<>> ->
            Me = maps:get(<<"username">>, User),
            Ids = sd_db:zrevrange("sd:subs:t:" ++ key(T), 0, 999),
            All = [S || B <- Ids, S <- [sd_db:hget_json("sd:subs", binary_to_list(B))], is_map(S), can_see_submission(User, S)],
            Scoped = case sd_util:get(<<"scope">>, Args, <<"all">>) of
                         <<"mine">> -> [S || S <- All, maps:get(<<"by">>, S) =:= Me];
                         _ -> All
                     end,
            Q = case sd_util:get(<<"q">>, Args, <<>>) of Qb when is_binary(Qb) -> string:lowercase(string:trim(Qb)); _ -> <<>> end,
            From = num_arg(sd_util:get(<<"from">>, Args, undefined)),
            To = num_arg(sd_util:get(<<"to">>, Args, undefined)),
            Hits = [S || S <- Scoped, in_range(maps:get(<<"ts">>, S, 0), From, To), matches_text(S, Q)],
            Limit = clamp(num_arg(sd_util:get(<<"limit">>, Args, undefined)), 1, 100, 20),
            Offset = clamp(num_arg(sd_util:get(<<"offset">>, Args, undefined)), 0, 100000, 0),
            Page = lists:sublist(safe_nthtail(Offset, Hits), Limit),
            {ok, #{<<"records">> => Page, <<"total">> => length(Hits), <<"offset">> => Offset,
                   <<"limit">> => Limit, <<"hasMore">> => Offset + length(Page) < length(Hits)}};
        _ -> {error, invalid, <<"tstruct is required.">>}
    end.

num_arg(N) when is_integer(N) -> N;
num_arg(N) when is_float(N) -> trunc(N);
num_arg(_) -> undefined.
clamp(undefined, _, _, D) -> D;
clamp(N, Lo, Hi, _) -> max(Lo, min(Hi, N)).
safe_nthtail(N, L) when N >= length(L) -> [];
safe_nthtail(N, L) -> lists:nthtail(N, L).
in_range(Ts, From, To) -> (From =:= undefined orelse Ts >= From) andalso (To =:= undefined orelse Ts =< To).
matches_text(_, <<>>) -> true;
matches_text(#{<<"values">> := V} = S, Q) when is_map(V) ->
    Texts = [value_text(X) || X <- maps:values(V)] ++ [maps:get(<<"ref">>, S, <<>>)],
    lists:any(fun(T) -> is_binary(T) andalso binary:match(string:lowercase(T), Q) =/= nomatch end, Texts);
matches_text(_, _) -> false.
value_text(V) when is_binary(V) -> V;
value_text(V) when is_integer(V) -> integer_to_binary(V);
value_text(V) when is_float(V) -> float_to_binary(V, [{decimals, 6}, compact]);
value_text(_) -> <<>>.

can_see_submission(User, Sub) ->
    Username = maps:get(<<"username">>, User),
    sd_users:is_admin(User) orelse maps:get(<<"by">>, Sub) =:= Username
        orelse maps:get(<<"host">>, Sub, null) =:= Username.

%% Only the person who made a submission may edit or delete it -- no time
%% limit, no host override (deliberately the simplest rule that needed no
%% new "is this locked" state on a submission; tighten later if a workflow
%% needs it, e.g. once something can act on a submission the way req.respond
%% acts on a request).
%%
%% Edits re-validate against the *same* structure the submission was made
%% against (its own definition may since have changed -- that's fine, the
%% new values must satisfy the current definition). `ref` is not editable
%% here (it's part of how the record is indexed/found; changing it needs
%% moving index entries, deliberately left out of v1). `values` and `meta`
%% are.
update_submission(User, Id, Changes) when is_integer(Id), is_map(Changes) ->
    case sd_db:hget_json("sd:subs", integer_to_list(Id)) of
        undefined -> {error, not_found, <<"No such submission.">>};
        Sub ->
            Username = maps:get(<<"username">>, User),
            case maps:get(<<"by">>, Sub) =:= Username of
                false -> {error, forbidden, <<"You can only edit your own submission.">>};
                true ->
                    case def_for_submission(Sub) of
                        undefined ->
                            {error, not_found,
                             <<"The structure this was submitted against no longer exists.">>};
                        Def ->
                            NewValues = case sd_util:get(<<"values">>, Changes, undefined) of
                                             V when is_map(V) -> V;
                                             _ -> maps:get(<<"values">>, Sub)
                                         end,
                            case norm_meta(sd_util:get(<<"meta">>, Changes, undefined)) of
                                invalid_meta -> {error, invalid, <<"meta must be a JSON object.">>};
                                Meta ->
                                    case check_values(Def, NewValues) of
                                        {ok, Clean} ->
                                            Sub1 = Sub#{<<"values">> => Clean,
                                                        <<"editedTs">> => sd_util:now_ms()},
                                            Sub2 = case Meta of
                                                       undefined -> Sub1;
                                                       _ -> Sub1#{<<"meta">> => Meta}
                                                   end,
                                            sd_db:hset_json("sd:subs", integer_to_list(Id), Sub2),
                                            {ok, Sub2};
                                        {error, Fields} ->
                                            {error, invalid_values, <<"Some fields need attention.">>,
                                             #{<<"fields">> => Fields}}
                                    end
                            end
                    end
            end
    end;
update_submission(_, _, _) -> {error, bad_request, <<"id (number) and changes are required.">>}.

delete_submission(User, Id) when is_integer(Id) ->
    case sd_db:hget_json("sd:subs", integer_to_list(Id)) of
        undefined -> {error, not_found, <<"No such submission.">>};
        Sub ->
            Username = maps:get(<<"username">>, User),
            case maps:get(<<"by">>, Sub) =:= Username of
                false -> {error, forbidden, <<"You can only delete your own submission.">>};
                true ->
                    IdBin = integer_to_binary(Id),
                    sd_db:hdel("sd:subs", integer_to_list(Id)),
                    sd_db:zrem("sd:subs:u:" ++ sd_util:s(Username), IdBin),
                    case maps:get(<<"host">>, Sub, null) of
                        H when is_binary(H) -> sd_db:zrem("sd:subs:u:" ++ sd_util:s(H), IdBin);
                        _ -> ok
                    end,
                    TKey = key(maps:get(<<"tstruct">>, Sub)),
                    sd_db:zrem("sd:subs:t:" ++ TKey, IdBin),
                    case maps:get(<<"ref">>, Sub, undefined) of
                        undefined -> ok;
                        Ref -> sd_db:zrem("sd:subs:tr:" ++ TKey ++ ":" ++ sd_util:s(Ref), IdBin)
                    end,
                    ok
            end
    end;
delete_submission(_, _) -> {error, bad_request, <<"id (number) is required.">>}.

%% A submission only records the structure's *name*, not which collection
%% it came from -- "scope" (tagged at submit time) says whether to look it
%% up in the admin-managed sd:tstructs (Option-gated) or the user-created
%% sd:tstructs:user (org-wide, no gating). Old submissions predate the
%% "scope" field and can only ever have come from the admin-managed side,
%% so they fall through to that clause correctly.
def_for_submission(#{<<"scope">> := <<"user">>, <<"tstruct">> := TName}) ->
    get_user_tstruct(TName);
def_for_submission(#{<<"tstruct">> := TName}) ->
    get_tstruct(TName).

%% =============================================================================
%% User-created structures -- "any signed-in user can define a form; once
%% made, it's the org's" =====================================================
%%
%% Deliberately a *separate* collection from sd:tstructs, not a variant of
%% it: an admin-managed TStruct can be edited freely by re-saving it, and is
%% only reachable by a regular user through an Option someone configured. A
%% user-created structure is the opposite on both axes:
%%  - any signed-in user can make one -- no admin, no unlock;
%%  - once made, it's visible org-wide to any signed-in user, immediately,
%%    with no Option needed.
%% What it keeps in common with a personal/private design (which this
%% isn't) is the immutability angle: creating one is a one-shot -- there is
%% no "edit the definition" path at all, by anyone, ever, including the
%% creator. Names are a single shared namespace (sd:tstructs:user, distinct
%% from admin's sd:tstructs), so a name is claimed on a first-come basis --
%% save rejects a name already in use (duplicate), the same shape as
%% username_taken/email_taken elsewhere in this module. Only the creator
%% (<<"owner">>) may delete it; deleting does not touch submissions already
%% made against it (same graceful degrade as an admin-deleted TStruct: a
%% later edit of such a submission fails cleanly with not_found via
%% def_for_submission, it doesn't crash).
%%
%% Field/section validation is identical (validate_fields/1,
%% validate_sections/2, check_field_refs/3) -- a user-created structure
%% obeys the same field-type and condition rules as an admin-managed one.

%% Every structure this user may open: all user-made ones plus the admin-made ones their
%% options allow. Sorted by caption. Each is the full definition map.
visible_tstructs(User) ->
    Admin = [D || D <- list_tstructs(), tstruct_ok(tstruct_for_user(User, maps:get(<<"name">>, D)))],
    All = list_user_tstructs() ++ [D || D <- Admin, not lists:member(maps:get(<<"name">>, D),
                                                    [maps:get(<<"name">>, U) || U <- list_user_tstructs()])],
    lists:sort(fun(A, B) -> cap_key(A) =< cap_key(B) end, All).

tstruct_ok({ok, _}) -> true;
tstruct_ok(_) -> false.

cap_key(D) -> string:lowercase(maps:get(<<"caption">>, D, maps:get(<<"name">>, D))).

%% "Leave Request" (a caption, any case) or "leave_request" (the name) -> the real name.
find_tstruct_name(User, Given) when is_binary(Given) ->
    Low = string:lowercase(string:trim(Given)),
    Hit = [maps:get(<<"name">>, D) || D <- visible_tstructs(User),
           string:lowercase(maps:get(<<"name">>, D)) =:= Low
               orelse string:lowercase(maps:get(<<"caption">>, D, <<>>)) =:= Low],
    case Hit of
        [Name | _] -> {ok, Name};
        [] -> error
    end.

list_user_tstructs() ->
    lists:sort(fun(A, B) -> maps:get(<<"name">>, A) =< maps:get(<<"name">>, B) end,
               [T || {_, T} <- sd_db:hgetall_json(?USER_TSTRUCTS), is_map(T)]).

get_user_tstruct(Name) -> sd_db:hget_json(?USER_TSTRUCTS, key(Name)).

save_user_tstruct(User, Raw) when is_map(Raw) ->
    Name = sd_util:get(<<"name">>, Raw),
    case valid_ident(Name) of
        false -> {error, invalid, <<"name must be letters/digits/underscore, starting with a letter.">>};
        true ->
            case get_user_tstruct(Name) of
                Existing when is_map(Existing) ->
                    {error, duplicate, <<"That name is already in use.">>};
                undefined ->
                    case validate_fields(sd_util:get(<<"fields">>, Raw, [])) of
                        {ok, Fields} ->
                            FieldNames = [maps:get(<<"name">>, F) || F <- Fields],
                            case validate_sections(sd_util:get(<<"sections">>, Raw, []), FieldNames) of
                                {ok, Sections} ->
                                    case check_field_refs(Fields, Sections, FieldNames) of
                                        ok ->
                                            Username = maps:get(<<"username">>, User),
                                            Def = #{<<"name">> => Name,
                                                    <<"caption">> => text(sd_util:get(<<"caption">>, Raw), Name),
                                                    <<"description">> => text(sd_util:get(<<"description">>, Raw), <<>>),
                                                    <<"fields">> => Fields, <<"sections">> => Sections,
                                                    <<"owner">> => Username,
                                                    <<"createdTs">> => sd_util:now_ms()},
                                            sd_db:hset_json(?USER_TSTRUCTS, key(Name), Def),
                                            {ok, Def};
                                        Err -> Err
                                    end;
                                Err -> Err
                            end;
                        Err -> Err
                    end
            end
    end;
save_user_tstruct(_, _) -> {error, bad_request, <<"Expected a JSON object.">>}.

%% Only the creator may change a structure. The name (its identity) and owner stay;
%% caption/description/fields/sections are replaced. Records already submitted are not
%% rewritten -- they are re-checked against the new definition when next edited.
update_user_tstruct(User, Raw) when is_map(Raw) ->
    Name = sd_util:get(<<"name">>, Raw),
    case is_binary(Name) andalso get_user_tstruct(Name) of
        false -> {error, invalid, <<"name is required.">>};
        undefined -> {error, not_found, <<"No such structure.">>};
        Existing ->
            Username = maps:get(<<"username">>, User),
            case maps:get(<<"owner">>, Existing, undefined) =:= Username of
                false -> {error, forbidden, <<"Only the creator can edit this structure.">>};
                true ->
                    case validate_fields(sd_util:get(<<"fields">>, Raw, [])) of
                        {ok, Fields} ->
                            FieldNames = [maps:get(<<"name">>, F) || F <- Fields],
                            case validate_sections(sd_util:get(<<"sections">>, Raw, []), FieldNames) of
                                {ok, Sections} ->
                                    case check_field_refs(Fields, Sections, FieldNames) of
                                        ok ->
                                            RealName = maps:get(<<"name">>, Existing),
                                            Def = Existing#{<<"caption">> => text(sd_util:get(<<"caption">>, Raw), RealName),
                                                            <<"description">> => text(sd_util:get(<<"description">>, Raw), <<>>),
                                                            <<"fields">> => Fields, <<"sections">> => Sections,
                                                            <<"modifiedTs">> => sd_util:now_ms()},
                                            sd_db:hset_json(?USER_TSTRUCTS, key(RealName), Def),
                                            {ok, Def};
                                        Err -> Err
                                    end;
                                Err -> Err
                            end;
                        Err -> Err
                    end
            end
    end;
update_user_tstruct(_, _) -> {error, bad_request, <<"Expected a JSON object.">>}.

delete_user_tstruct(User, Name) ->
    case get_user_tstruct(Name) of
        undefined -> {error, not_found, <<"No such structure.">>};
        Def ->
            Username = maps:get(<<"username">>, User),
            case maps:get(<<"owner">>, Def, undefined) =:= Username of
                false -> {error, forbidden, <<"Only the creator can delete this structure.">>};
                true ->
                    sd_db:hdel(?USER_TSTRUCTS, key(maps:get(<<"name">>, Def))),
                    ok
            end
    end.

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
%% barcode/QR: the scanned result is a plain string (same cap as text).
check_type(<<"barcode">>, V, _) when is_binary(V) ->
    case byte_size(V) =< 5000 of true -> {ok, V}; false -> {error, <<"Too long (max 5000 characters).">>} end;
check_type(<<"barcode">>, _, _) -> {error, <<"Barcode value must be text.">>};
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
