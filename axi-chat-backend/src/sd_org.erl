%%% Organisation-level data for Sandesh: the org itself (name, first-run
%%% state) and the administrator-maintained master lists from the spec's
%%% "Setup" section -- branches, departments, designations, user categories
%%% and affiliates.
%%%
%%% Stored in Redis as one hash per kind (`sd:cfg:<kind>`), field = lowercased
%%% name (so names are unique case-insensitively), value = JSON document.
%%% Names are the identity: user records reference them by name, so an item
%%% that is still referenced can't be deleted (categories can only be
%%% deactivated, per the spec).
-module(sd_org).
-export([info/0, setup_done/0, finish_setup/2, finish_setup/3, set_name/1, set_profile/1, seed_defaults/0, ensure_defaults/0,
         validate_location/1, validate_contact/1,
         public/0, list/1, get/2, exists/2, active/2, save/2, delete/2, kinds/0]).

-define(ORG, "sd:org").
-define(KINDS, [branches, departments, designations, categories, affiliates, roles]).

%% From the spec: "User categories - Customer, Vendor, Consultant, Patient,
%% Student, Citizen, Shareholder, Doctor, Professional. New categories can
%% be added & the existing categories can be deactivated."
-define(DEFAULT_CATEGORIES, [<<"Customer">>, <<"Vendor">>, <<"Consultant">>, <<"Patient">>,
                             <<"Student">>, <<"Citizen">>, <<"Shareholder">>, <<"Doctor">>,
                             <<"Professional">>, <<"Service provider">>, <<"Contract employee">>,
                             <<"Gig worker">>, <<"Freelancer">>, <<"Candidate">>]).
%% Pseudo-categories used by option applicability, never stored as items.
-define(RESERVED, [<<"employee">>, <<"affiliate">>]).

kinds() -> ?KINDS.

%% ---- the org itself ----------------------------------------------------------

info() ->
    Map = maps:from_list(sd_db:hgetall(?ORG)),
    Json = fun(K) -> case maps:find(K, Map) of
                         {ok, B} -> case sd_util:jdec(B) of {ok, M} when is_map(M) -> M; _ -> null end;
                         error -> null
                     end end,
    #{<<"name">> => maps:get(<<"name">>, Map, null),
      <<"setupDone">> => maps:get(<<"setup_done">>, Map, <<"0">>) =:= <<"1">>,
      <<"location">> => Json(<<"location">>),
      <<"contact">> => Json(<<"contact">>),
      <<"code">> => maps:get(<<"code">>, Map, null),
      <<"createdTs">> => case maps:find(<<"created_ts">>, Map) of
                             {ok, T} -> binary_to_integer(T);
                             error -> null
                         end}.

setup_done() -> sd_db:hget(?ORG, "setup_done") =:= <<"1">>.

%% Atomic claim of the one-time first-run setup: only the caller that flips
%% setup_done from unset to "1" wins, so two simultaneous "first users"
%% can't both become administrator.
finish_setup(OrgName, Admin) -> finish_setup(OrgName, Admin, #{}).

%% Profile: optional #{<<"location">> => Map, <<"contact">> => Map} (already validated).
finish_setup(OrgName, Admin, Profile) ->
    case sd_db:q(["HSETNX", ?ORG, "setup_done", "1"]) of
        <<"1">> ->
            sd_db:q(["HSET", ?ORG, "name", OrgName, "created_ts",
                     integer_to_list(sd_util:now_ms()), "created_by", Admin]),
            lists:foreach(fun(K) ->
                              case maps:get(K, Profile, undefined) of
                                  M when is_map(M), map_size(M) > 0 -> sd_db:hset(?ORG, binary_to_list(K), sd_util:jenc(M));
                                  _ -> ok
                              end
                          end, [<<"location">>, <<"contact">>]),
            seed_defaults(),
            ok;
        _ ->
            {error, already_setup}
    end.

%% Called at boot: an older deployment picks up categories added to the defaults later. Never re-adds one that
%% exists (categories can only be deactivated, so an admin's choice is kept).
ensure_defaults() ->
    case setup_done() of
        true -> seed_defaults();
        false -> ok
    end.

%% Change the organisation's own profile: any of name, location, contact (each validated).
set_profile(Args) when is_map(Args) ->
    Name = case sd_util:get(<<"name">>, Args) of B when is_binary(B) -> string:trim(B); _ -> undefined end,
    Loc = case maps:is_key(<<"location">>, Args) of true -> validate_location(maps:get(<<"location">>, Args)); false -> skip end,
    Con = case maps:is_key(<<"contact">>, Args) of true -> validate_contact(maps:get(<<"contact">>, Args)); false -> skip end,
    case {Name, Loc, Con} of
        {<<>>, _, _} -> {error, invalid, <<"name can't be empty.">>};
        {_, {error, _, _} = E, _} -> E;
        {_, _, {error, _, _} = E} -> E;
        _ ->
            case Name of undefined -> ok; _ -> sd_db:hset(?ORG, "name", Name) end,
            case Loc of {ok, L} -> sd_db:hset(?ORG, "location", sd_util:jenc(L)); _ -> ok end,
            case Con of {ok, C} -> sd_db:hset(?ORG, "contact", sd_util:jenc(C)); _ -> ok end,
            ok
    end.

%% ---- profile parts ------------------------------------------------------------------------------------------
%% location: {address, country, city, pin}, every part optional text; contact: {name, email, mobile}.
validate_location(M) when is_map(M) ->
    text_fields(M, [{<<"address">>, 200}, {<<"country">>, 60}, {<<"city">>, 60}, {<<"pin">>, 12}], <<"location">>);
validate_location(null) -> {ok, #{}};
validate_location(_) -> {error, invalid, <<"location must be an object {address, country, city, pin}.">>}.

validate_contact(M) when is_map(M) ->
    case text_fields(M, [{<<"name">>, 80}, {<<"email">>, 120}, {<<"mobile">>, 20}], <<"contact">>) of
        {ok, C} ->
            case {maps:get(<<"email">>, C, <<>>), maps:get(<<"mobile">>, C, <<>>)} of
                {E, _} when E =/= <<>>, not is_binary(E) -> {error, invalid, <<"contact.email is not valid.">>};
                {E, _} when E =/= <<>> ->
                    case sd_util:valid_email(E) of
                        true -> {ok, C};
                        false -> {error, invalid, <<"contact.email is not valid.">>}
                    end;
                _ -> {ok, C}
            end;
        Err -> Err
    end;
validate_contact(null) -> {ok, #{}};
validate_contact(_) -> {error, invalid, <<"contact must be an object {name, email, mobile}.">>}.

text_fields(M, Specs, What) ->
    lists:foldl(
      fun({K, Max}, {ok, Acc}) ->
              case maps:get(K, M, undefined) of
                  undefined -> {ok, Acc};
                  null -> {ok, Acc};
                  V when is_binary(V) ->
                      Clean = string:trim(<< <<C>> || <<C>> <= V, C >= 32, C =/= 127 >>),
                      case {byte_size(Clean) =< Max, unicode:characters_to_binary(Clean, utf8, utf8)} of
                          {true, Clean} -> case Clean of <<>> -> {ok, Acc}; _ -> {ok, Acc#{K => Clean}} end;
                          {false, _} -> {error, invalid, iolist_to_binary([What, ".", K, " is too long (max ", integer_to_binary(Max), ")."])};
                          _ -> {error, invalid, iolist_to_binary([What, ".", K, " is not valid text."])}
                      end;
                  _ -> {error, invalid, iolist_to_binary([What, ".", K, " must be text."])}
              end;
         (_, Err) -> Err
      end, {ok, #{}}, Specs).

set_name(Name) -> sd_db:hset(?ORG, "name", Name).

seed_defaults() ->
    lists:foreach(
        fun(Name) ->
            case exists(categories, Name) of
                true -> ok;
                false -> store(categories, Name, #{<<"name">> => Name, <<"active">> => true})
            end
        end, ?DEFAULT_CATEGORIES).

%% What an anonymous visitor needs to fill in the self-registration form --
%% names only, no descriptions or locations beyond what a dropdown needs.
public() ->
    Names = fun(Kind) -> [maps:get(<<"name">>, I) || I <- active(Kind, all)] end,
    Aff = [#{<<"name">> => maps:get(<<"name">>, A),
             <<"category">> => maps:get(<<"category">>, A, null),
             <<"branches">> => [maps:get(<<"name">>, B) || B <- maps:get(<<"branches">>, A, [])]}
           || A <- list(affiliates)],
    Info = info(),
    #{<<"org">> => maps:get(<<"name">>, Info),
      <<"setupDone">> => maps:get(<<"setupDone">>, Info),
      <<"location">> => case maps:get(<<"location">>, Info) of
                            L when is_map(L) -> maps:with([<<"city">>, <<"country">>], L);
                            _ -> null
                        end,
      <<"categories">> => Names(categories),
      <<"branches">> => Names(branches),
      <<"departments">> => Names(departments),
      <<"designations">> => Names(designations),
      <<"affiliates">> => Aff,
      <<"onboarding">> => sd_onboarding:public()}.

%% ---- master lists --------------------------------------------------------------

list(Kind) ->
    lists:sort(fun(A, B) -> maps:get(<<"name">>, A) =< maps:get(<<"name">>, B) end,
               [Item || {_K, Item} <- sd_db:hgetall_json(hash(Kind)), is_map(Item)]).

%% Only items still active (categories are the only kind that can be
%% deactivated; everything else is always active).
active(Kind, all) ->
    [I || I <- list(Kind), maps:get(<<"active">>, I, true) =/= false].

get(Kind, Name) -> sd_db:hget_json(hash(Kind), field(Name)).

exists(Kind, Name) -> get(Kind, Name) =/= undefined.

%% ---- save / delete -----------------------------------------------------------------

save(Kind, Raw) when is_map(Raw) ->
    case validate(Kind, Raw) of
        {ok, Item} ->
            Name = maps:get(<<"name">>, Item),
            case lists:member(string:lowercase(Name), ?RESERVED) andalso Kind =:= categories of
                true ->
                    {error, reserved_name, <<"That category name is reserved.">>};
                false ->
                    store(Kind, Name, Item),
                    {ok, Item}
            end;
        Err -> Err
    end;
save(_, _) ->
    {error, bad_request, <<"Expected a JSON object.">>}.

delete(categories, _Name) ->
    {error, not_allowed, <<"Categories can't be deleted, only deactivated (set active to false).">>};
delete(Kind, Name) ->
    case get(Kind, Name) of
        undefined -> {error, not_found, <<"No such item.">>};
        Item ->
            RealName = maps:get(<<"name">>, Item),
            case sd_users:count_using(Kind, RealName) of
                0 ->
                    sd_db:hdel(hash(Kind), field(RealName)),
                    ok;
                N ->
                    {error, in_use, iolist_to_binary(
                        io_lib:format("Still used by ~p user(s); reassign them first.", [N]))}
            end
    end.

store(Kind, Name, Item) -> sd_db:hset_json(hash(Kind), field(Name), Item).

hash(Kind) -> "sd:cfg:" ++ atom_to_list(Kind).
field(Name) -> string:lowercase(string:trim(sd_util:b(Name))).

%% ---- validation ------------------------------------------------------------------------

validate(branches, R) ->
    chain([fun() -> req_str(R, <<"name">>, 80) end,
           fun() -> req_str(R, <<"country">>, 80) end,
           fun() -> req_str(R, <<"city">>, 80) end,
           fun() -> req_str(R, <<"pin">>, 20) end],
          fun([N, Co, Ci, P]) ->
              #{<<"name">> => N, <<"country">> => Co, <<"city">> => Ci, <<"pin">> => P}
          end);
validate(Kind, R) when Kind =:= departments; Kind =:= designations ->
    chain([fun() -> req_str(R, <<"name">>, 80) end,
           fun() -> opt_str(R, <<"description">>, 500) end],
          fun([N, D]) -> #{<<"name">> => N, <<"description">> => D} end);
%% Roles (employees only): used to decide who an option applies to and who may approve a wizard step.
validate(roles, R) ->
    chain([fun() -> req_str(R, <<"name">>, 60) end,
           fun() -> opt_str(R, <<"description">>, 300) end],
          fun([N, D]) -> #{<<"name">> => N, <<"description">> => D} end);
validate(categories, R) ->
    chain([fun() -> req_str(R, <<"name">>, 60) end],
          fun([N]) ->
              #{<<"name">> => N,
                <<"active">> => sd_util:get(<<"active">>, R, true) =/= false}
          end);
validate(affiliates, R) ->
    case chain([fun() -> req_str(R, <<"name">>, 100) end,
                fun() -> req_str(R, <<"category">>, 60) end,
                fun() -> opt_str(R, <<"country">>, 80) end,
                fun() -> opt_str(R, <<"city">>, 80) end,
                fun() -> opt_str(R, <<"pin">>, 20) end],
               fun([N, Cat, Co, Ci, P]) ->
                   #{<<"name">> => N, <<"category">> => Cat, <<"country">> => Co,
                     <<"city">> => Ci, <<"pin">> => P}
               end) of
        {ok, Base} ->
            Cat = maps:get(<<"category">>, Base),
            case get(categories, Cat) of
                undefined ->
                    {error, invalid, <<"Unknown affiliate category (add it under user categories first).">>};
                _ ->
                    case validate_aff_branches(sd_util:get(<<"branches">>, R, [])) of
                        {ok, Bs} -> {ok, Base#{<<"category">> => maps:get(<<"name">>, get(categories, Cat)),
                                                <<"branches">> => Bs}};
                        Err -> Err
                    end
            end;
        Err -> Err
    end;
validate(_, _) ->
    {error, bad_request, <<"Unknown kind.">>}.

validate_aff_branches(List) when is_list(List) ->
    validate_aff_branches(List, []);
validate_aff_branches(_) ->
    {error, invalid, <<"branches must be a list.">>}.

validate_aff_branches([], Acc) -> {ok, lists:reverse(Acc)};
validate_aff_branches([B | Rest], Acc) when is_map(B) ->
    case chain([fun() -> req_str(B, <<"name">>, 80) end,
                fun() -> opt_str(B, <<"country">>, 80) end,
                fun() -> opt_str(B, <<"city">>, 80) end,
                fun() -> opt_str(B, <<"pin">>, 20) end],
               fun([N, Co, Ci, P]) ->
                   #{<<"name">> => N, <<"country">> => Co, <<"city">> => Ci, <<"pin">> => P}
               end) of
        {ok, Item} -> validate_aff_branches(Rest, [Item | Acc]);
        Err -> Err
    end;
validate_aff_branches(_, _) ->
    {error, invalid, <<"Each affiliate branch must be an object with a name.">>}.

%% Runs the checks in order; stops at the first {error,_,_}.
chain(Checks, Build) -> chain(Checks, Build, []).
chain([], Build, Acc) -> {ok, Build(lists:reverse(Acc))};
chain([Check | Rest], Build, Acc) ->
    case Check() of
        {ok, V} -> chain(Rest, Build, [V | Acc]);
        Err -> Err
    end.

req_str(Map, Key, Max) ->
    case sd_util:get(Key, Map) of
        V when is_binary(V) ->
            T = string:trim(V),
            case {byte_size(T), byte_size(T) =< Max} of
                {0, _} -> {error, invalid, <<Key/binary, " is required.">>};
                {_, false} -> {error, invalid, <<Key/binary, " is too long.">>};
                _ -> {ok, T}
            end;
        _ ->
            {error, invalid, <<Key/binary, " is required.">>}
    end.

opt_str(Map, Key, Max) ->
    case sd_util:get(Key, Map) of
        undefined -> {ok, <<>>};
        null -> {ok, <<>>};
        V when is_binary(V) ->
            T = string:trim(V),
            case byte_size(T) =< Max of
                true -> {ok, T};
                false -> {error, invalid, <<Key/binary, " is too long.">>}
            end;
        _ ->
            {error, invalid, <<Key/binary, " must be text.">>}
    end.
