%%% Global variables: named values available everywhere a condition, a data source or a wizard needs to know
%%% "who is asking".
%%%
%%% Built in (always there, from the signed-in user):
%%%   userName, username, email, category, affiliate, branch, department, designation, city, country, pin, isHost
%%% Custom (an administrator makes them): a name plus either a fixed default value, or a data source that is asked
%%% for the value (`datasource` + `column`), falling back to the default when the source has nothing.
%%%
%%% `values/1` is the plain, instant part (built-ins + defaults) and is what option rules use, so filtering a user's
%%% options never waits on anything outside. `resolve/2` also asks data sources -- that call can be slow, so it is
%%% only used by actions that run off the connection (see sd_lane) and always with a time limit.
-module(sd_globals).
-export([builtins/0, known/0, values/1, list/0, get/1, save/1, delete/1, resolve/2, referenced/1]).

-define(HASH, "sd:globals").

%% name -> how to read it from a user record
builtins() ->
    [{<<"userName">>, <<"name">>}, {<<"username">>, <<"username">>}, {<<"email">>, <<"email">>},
     {<<"category">>, category}, {<<"affiliate">>, <<"affiliate">>}, {<<"branch">>, <<"branch">>},
     {<<"department">>, <<"department">>}, {<<"designation">>, <<"designation">>}, {<<"city">>, <<"city">>},
     {<<"country">>, <<"country">>}, {<<"pin">>, <<"pin">>}, {<<"isHost">>, <<"isHost">>}].

%% Every name a rule may refer to: built-ins plus the custom ones.
known() -> [N || {N, _} <- builtins()] ++ [maps:get(<<"name">>, G) || G <- list()].

%% Instant values for this user: built-ins, then each custom variable's default.
values(User) ->
    Base = maps:from_list([{N, builtin(How, User)} || {N, How} <- builtins()]),
    lists:foldl(fun(G, Acc) ->
                    N = maps:get(<<"name">>, G),
                    case maps:is_key(N, Acc) of
                        true -> Acc;
                        false -> Acc#{N => maps:get(<<"default">>, G, null)}
                    end
                end, Base, list()).

builtin(category, User) -> sd_users:effective_category(User);
builtin(Key, User) ->
    case maps:get(Key, User, null) of
        undefined -> null;
        V -> V
    end.

%% ---- custom variables ---------------------------------------------------------------------------------------

list() ->
    lists:sort(fun(A, B) -> maps:get(<<"name">>, A) =< maps:get(<<"name">>, B) end,
               [G || {_, G} <- sd_db:hgetall_json(?HASH), is_map(G)]).

get(Name) -> sd_db:hget_json(?HASH, key(Name)).

key(Name) -> string:lowercase(string:trim(sd_util:s(Name))).

%% name (letters/digits/_ , starts with a letter, max 40; may not shadow a built-in), default (any JSON scalar) and
%% optionally datasource + column (the column of the source's first row that supplies the value).
save(Raw) when is_map(Raw) ->
    Name = sd_util:get(<<"name">>, Raw),
    Builtin = [string:lowercase(N) || {N, _} <- builtins()],
    Default = sd_util:get(<<"default">>, Raw, null),
    Source = case sd_util:get(<<"datasource">>, Raw) of B when is_binary(B), B =/= <<>> -> B; _ -> null end,
    Column = case sd_util:get(<<"column">>, Raw) of C when is_binary(C), C =/= <<>> -> C; _ -> null end,
    Desc = case sd_util:get(<<"description">>, Raw) of D when is_binary(D) -> binary:part(D, 0, min(byte_size(D), 200)); _ -> <<>> end,
    case valid_name(Name) of
        false -> {error, invalid, <<"name must be letters, digits or _, starting with a letter (max 40).">>};
        true ->
            case lists:member(string:lowercase(Name), Builtin) of
                true -> {error, invalid, <<"That name is built in and can't be redefined.">>};
                false ->
                    case {scalar(Default), Source, Column} of
                        {false, _, _} -> {error, invalid, <<"default must be text, a number, true/false or null.">>};
                        {true, null, null} -> store(Name, Default, null, null, Desc);
                        {true, null, _} -> {error, invalid, <<"column needs a datasource.">>};
                        {true, _, null} -> {error, invalid, <<"a datasource needs a column to read.">>};
                        {true, S, Co} ->
                            case sd_datasource:get(S) of
                                undefined -> {error, invalid, <<"Unknown data source.">>};
                                _ -> store(Name, Default, S, Co, Desc)
                            end
                    end
            end
    end;
save(_) -> {error, bad_request, <<"Expected a JSON object.">>}.

store(Name, Default, Source, Column, Desc) ->
    G = #{<<"name">> => Name, <<"default">> => Default, <<"datasource">> => Source, <<"column">> => Column,
          <<"description">> => Desc},
    sd_db:hset_json(?HASH, key(Name), G),
    {ok, G}.

delete(Name) ->
    case get(Name) of
        undefined -> {error, not_found, <<"No such variable.">>};
        G ->
            sd_db:hdel(?HASH, key(maps:get(<<"name">>, G))),
            ok
    end.

valid_name(N) when is_binary(N) ->
    re:run(N, "^[A-Za-z][A-Za-z0-9_]{0,39}$", [{capture, none}]) =:= match;
valid_name(_) -> false.

scalar(null) -> true;
scalar(V) when is_binary(V) -> byte_size(V) =< 500;
scalar(V) when is_number(V); is_boolean(V) -> true;
scalar(_) -> false.

%% Every variable name a condition mentions (so a condition can be checked against the known names).
referenced(#{<<"all">> := L}) when is_list(L) -> lists:append([referenced(C) || C <- L]);
referenced(#{<<"any">> := L}) when is_list(L) -> lists:append([referenced(C) || C <- L]);
referenced(#{<<"field">> := F}) when is_binary(F) -> [F];
referenced(_) -> [].

%% ---- resolving (may ask data sources; never call from a shared server) ----------------------------------------

%% Values for this user including custom variables backed by data sources. Extra = #{Name => Value} lets a caller
%% supply inputs the data source needs. A source that fails or returns nothing yields the default.
resolve(User, Extra) ->
    Base = maps:merge(values(User), Extra),
    lists:foldl(fun(G, Acc) ->
                    case {maps:get(<<"datasource">>, G, null), maps:get(<<"column">>, G, null)} of
                        {S, Col} when is_binary(S), is_binary(Col) ->
                            N = maps:get(<<"name">>, G),
                            case sd_datasource:run(S, Acc, #{<<"limit">> => 1}) of
                                {ok, #{<<"rows">> := [Row | _]}} when is_map(Row) ->
                                    case maps:find(Col, Row) of
                                        {ok, V} -> Acc#{N => V};
                                        error -> Acc
                                    end;
                                _ -> Acc
                            end;
                        _ -> Acc
                    end
                end, Base, list()).
