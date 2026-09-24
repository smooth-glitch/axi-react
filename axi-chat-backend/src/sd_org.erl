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
-export([info/0, setup_done/0, finish_setup/2, set_name/1, seed_defaults/0,
         public/0, list/1, get/2, exists/2, active/2, save/2, delete/2, kinds/0]).

-define(ORG, "sd:org").
-define(KINDS, [branches, departments, designations, categories, affiliates]).

%% From the spec: "User categories - Customer, Vendor, Consultant, Patient,
%% Student, Citizen, Shareholder, Doctor, Professional. New categories can
%% be added & the existing categories can be deactivated."
-define(DEFAULT_CATEGORIES, [<<"Customer">>, <<"Vendor">>, <<"Consultant">>, <<"Patient">>,
                             <<"Student">>, <<"Citizen">>, <<"Shareholder">>, <<"Doctor">>,
                             <<"Professional">>]).
%% Pseudo-categories used by option applicability, never stored as items.
-define(RESERVED, [<<"employee">>, <<"affiliate">>]).

kinds() -> ?KINDS.

%% ---- the org itself ----------------------------------------------------------

info() ->
    Map = maps:from_list(sd_db:hgetall(?ORG)),
    #{<<"name">> => maps:get(<<"name">>, Map, null),
      <<"setupDone">> => maps:get(<<"setup_done">>, Map, <<"0">>) =:= <<"1">>,
      <<"createdTs">> => case maps:find(<<"created_ts">>, Map) of
                             {ok, T} -> binary_to_integer(T);
                             error -> null
                         end}.

setup_done() -> sd_db:hget(?ORG, "setup_done") =:= <<"1">>.

%% Atomic claim of the one-time first-run setup: only the caller that flips
%% setup_done from unset to "1" wins, so two simultaneous "first users"
%% can't both become administrator.
finish_setup(OrgName, Admin) ->
    case sd_db:q(["HSETNX", ?ORG, "setup_done", "1"]) of
        <<"1">> ->
            sd_db:q(["HSET", ?ORG, "name", OrgName, "created_ts",
                     integer_to_list(sd_util:now_ms()), "created_by", Admin]),
            seed_defaults(),
            ok;
        _ ->
            {error, already_setup}
    end.

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
      <<"categories">> => Names(categories),
      <<"branches">> => Names(branches),
      <<"departments">> => Names(departments),
      <<"designations">> => Names(designations),
      <<"affiliates">> => Aff}.

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
