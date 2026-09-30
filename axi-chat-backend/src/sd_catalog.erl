%%% Products and services the enterprise offers (a shop's goods, a hospital's services, ...). Administrators
%%% maintain them; everyone signed in can browse and search. Items are plain records; nothing here waits on anything
%%% outside Redis.
-module(sd_catalog).
-export([save/1, delete/2, get/2, list/2, kinds/0]).

-compile({no_auto_import, [get/1]}).

-define(HASH, "sd:catalog").
-define(KINDS, [<<"product">>, <<"service">>]).

kinds() -> ?KINDS.

key(Kind, Id) -> binary_to_list(Kind) ++ ":" ++ sd_util:s(Id).

%% {kind, id?, name, description, price, currency, unit, category, sku, active, tags}
%% No id -> a new one is made (kind prefix + counter). Saving with an id replaces that item.
save(Raw) when is_map(Raw) ->
    Kind = sd_util:get(<<"kind">>, Raw),
    Name = str(sd_util:get(<<"name">>, Raw), 120),
    Price = sd_util:get(<<"price">>, Raw, null),
    case {lists:member(Kind, ?KINDS), Name, price_ok(Price)} of
        {false, _, _} -> {error, invalid, <<"kind must be product or service.">>};
        {_, <<>>, _} -> {error, invalid, <<"name is required.">>};
        {_, _, false} -> {error, invalid, <<"price must be a number of 0 or more.">>};
        _ ->
            case id_for(Kind, sd_util:get(<<"id">>, Raw)) of
                {error, _, _} = E -> E;
                Id ->
                    Item = #{<<"id">> => Id, <<"kind">> => Kind, <<"name">> => Name,
                             <<"description">> => str(sd_util:get(<<"description">>, Raw), 1000),
                             <<"price">> => Price,
                             <<"currency">> => str(sd_util:get(<<"currency">>, Raw, <<"INR">>), 8),
                             <<"unit">> => str(sd_util:get(<<"unit">>, Raw), 30),
                             <<"category">> => str(sd_util:get(<<"category">>, Raw), 60),
                             <<"sku">> => str(sd_util:get(<<"sku">>, Raw), 60),
                             <<"tags">> => tags(sd_util:get(<<"tags">>, Raw, [])),
                             <<"active">> => sd_util:get(<<"active">>, Raw, true) =/= false,
                             <<"updated">> => sd_util:now_ms()},
                    sd_db:hset_json(?HASH, key(Kind, Id), Item),
                    {ok, Item}
            end
    end;
save(_) -> {error, bad_request, <<"Expected a JSON object.">>}.

id_for(Kind, undefined) -> id_for(Kind, null);
id_for(Kind, null) ->
    Prefix = case Kind of <<"product">> -> <<"p">>; _ -> <<"s">> end,
    <<Prefix/binary, (integer_to_binary(sd_db:incr("sd:seq:catalog")))/binary>>;
id_for(Kind, Id) when is_binary(Id) ->
    case re:run(Id, "^[A-Za-z0-9_-]{1,40}$", [{capture, none}]) of
        match ->
            case sd_db:hget_json(?HASH, key(Kind, Id)) of
                undefined -> {error, not_found, <<"No such item.">>};
                _ -> Id
            end;
        _ -> {error, invalid, <<"Bad id.">>}
    end;
id_for(_, _) -> {error, invalid, <<"Bad id.">>}.

price_ok(null) -> true;
price_ok(P) when is_number(P) -> P >= 0;
price_ok(_) -> false.

str(V, Max) when is_binary(V) -> T = string:trim(V), binary:part(T, 0, min(byte_size(T), Max));
str(_, _) -> <<>>.

tags(L) when is_list(L) ->
    lists:sublist(lists:usort([T || X <- L, T <- [str(X, 30)], T =/= <<>>]), 20);
tags(_) -> [].

get(Kind, Id) -> sd_db:hget_json(?HASH, key(Kind, Id)).

delete(Kind, Id) ->
    case get(Kind, Id) of
        undefined -> {error, not_found, <<"No such item.">>};
        _ -> sd_db:hdel(?HASH, key(Kind, Id)), ok
    end.

%% Args: kind (optional), q (name/description/sku/tags), category, includeInactive (admins only), limit, offset.
list(IsAdmin, Args) ->
    Kind = sd_util:get(<<"kind">>, Args),
    Cat = str(sd_util:get(<<"category">>, Args), 60),
    Q = string:lowercase(str(sd_util:get(<<"q">>, Args), 100)),
    Inactive = IsAdmin andalso sd_util:get(<<"includeInactive">>, Args) =:= true,
    All = [I || {_, I} <- sd_db:hgetall_json(?HASH), is_map(I)],
    Hits = [I || I <- All,
                 Kind =:= undefined orelse Kind =:= null orelse maps:get(<<"kind">>, I) =:= Kind,
                 Cat =:= <<>> orelse maps:get(<<"category">>, I) =:= Cat,
                 Inactive orelse maps:get(<<"active">>, I, true),
                 Q =:= <<>> orelse text_match(I, Q)],
    Sorted = lists:sort(fun(A, B) -> string:lowercase(maps:get(<<"name">>, A)) =< string:lowercase(maps:get(<<"name">>, B)) end, Hits),
    Limit = case sd_util:get(<<"limit">>, Args) of L when is_integer(L), L >= 1 -> min(L, 100); _ -> 20 end,
    Off = case sd_util:get(<<"offset">>, Args) of O when is_integer(O), O >= 0 -> O; _ -> 0 end,
    Page = lists:sublist(drop(Off, Sorted), Limit),
    Cats = lists:usort([C || I <- All, C <- [maps:get(<<"category">>, I)], C =/= <<>>]),
    #{<<"items">> => Page, <<"total">> => length(Hits), <<"offset">> => Off, <<"limit">> => Limit,
      <<"hasMore">> => Off + length(Page) < length(Hits), <<"categories">> => Cats}.

drop(N, L) when N >= length(L) -> [];
drop(N, L) -> lists:nthtail(N, L).

text_match(I, Q) ->
    Texts = [maps:get(<<"name">>, I), maps:get(<<"description">>, I), maps:get(<<"sku">>, I)] ++ maps:get(<<"tags">>, I, []),
    lists:any(fun(T) -> binary:match(string:lowercase(T), Q) =/= nomatch end, Texts).
