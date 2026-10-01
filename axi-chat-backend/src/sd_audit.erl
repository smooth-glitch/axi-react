%%% Admin audit trail: who changed what, when. One JSON entry per change in the Redis list
%%% `sd:audit` (newest first, capped), plus a feed notice to the person affected.
%%% Logging never fails the operation it describes.
-module(sd_audit).
-export([log/4, list/2, page/3]).

-define(KEY, "sd:audit").
-define(MAX, 5000).

%% Actor: username of who did it. Action: e.g. <<"user.update">>. Target: username (or <<"-">>).
%% Details: any JSON-able map (before/after, counts, ...).
log(Actor, Action, Target, Details) ->
    try
        Entry = #{<<"ts">> => sd_util:now_ms(), <<"actor">> => Actor, <<"action">> => Action,
                  <<"target">> => Target, <<"details">> => Details},
        sd_db:q(["LPUSH", ?KEY, sd_util:jenc(Entry)]),
        sd_db:q(["LTRIM", ?KEY, "0", integer_to_list(?MAX - 1)]),
        ok
    catch _:_ -> ok
    end.

%% Newest first. Filter: undefined | username (matches actor or target).
list(Filter, Limit) ->
    {Entries, _Total} = page(Filter, Limit, 0),
    Entries.

%% One page of the log plus how many entries match in all: {Entries, Total}.
page(Filter, Limit, Offset) ->
    Raw = sd_db:q(["LRANGE", ?KEY, "0", integer_to_list(?MAX - 1)]),
    All = [E || R <- Raw, {ok, E} <- [sd_util:jdec(R)]],
    Match = case Filter of
                undefined -> All;
                F -> N = sd_util:norm_user(F),
                     [E || E <- All, maps:get(<<"actor">>, E, <<>>) =:= N orelse maps:get(<<"target">>, E, <<>>) =:= N]
            end,
    Total = length(Match),
    Rest = case Offset >= Total of true -> []; false -> lists:nthtail(Offset, Match) end,
    {lists:sublist(Rest, max(1, min(Limit, 500))), Total}.
