%%% Names that may contain spaces (a group called "design team", a host called
%%% "Human Resources") can't be found by splitting a line on spaces. Instead the
%%% line is matched against the names that really exist and the longest one
%%% wins; the rest of the line is what follows it.
-module(chat_names).
-export([longest/3, group_conflict/2]).

%% Cands = [{Text, Value}]. Exact = true is case-sensitive.
%% {ok, Value, Rest} when Str starts with Text (as whole words), else none.
longest(Cands, Str, Exact) ->
    S = skip(Str),
    Fit = [{length(T), V} || {T, V} <- Cands, T =/= "", starts(T, S, Exact)],
    case lists:reverse(lists:sort(Fit)) of
        [{Len, V} | _] -> {ok, V, skip(lists:nthtail(Len, S))};
        [] -> none
    end.

starts(T, S, Exact) ->
    {T1, S1} = case Exact of true -> {T, S}; false -> {string:lowercase(T), string:lowercase(S)} end,
    lists:prefix(T1, S1) andalso
        (length(S1) =:= length(T1) orelse lists:nth(length(T1) + 1, S1) =:= $\s).

skip([$\s | T]) -> skip(T);
skip(S) -> S.

%% A new group name may not equal, or be a whole-word prefix of, an existing one
%% (or the other way round) -- otherwise "design team hi" could mean two things.
group_conflict(New, Existing) ->
    lists:any(fun(E) -> starts(E, New, true) orelse starts(New, E, true) end, Existing).
