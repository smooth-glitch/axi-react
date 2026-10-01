%%% Durable outgoing-mail queue. Invitations and other non-secret emails are written to Redis first and sent from
%%% there, so a backend restart (a deploy, a crash) in the middle of a retry no longer loses them.
%%%
%%%   sd:mailq            sorted set: job id -> time it is due (ms)
%%%   sd:mailq:job        hash: job id -> JSON job (kind, to, subject, body, attempts, ...)
%%%   sd:mailq:dead       list (newest first, latest 100): jobs that were refused for good or ran out of attempts
%%%
%%% sd_scheduler calls fire_due/0 on every tick. A job is "leased" (pushed LEASE_MS into the future) before it is
%%% sent, so a crash mid-send simply makes it due again later: it is never lost, and two ticks never send it twice.
%%% Retry delays come from SMTP_RETRY_DELAYS_MS (default "0,5000,30000,120000,600000,3600000": the first attempt is
%%% immediate). A temporary failure (connection trouble, 4xx) is retried; a permanent one (5xx) goes to the dead list.
%%%
%%% One-time sign-in codes are NOT queued: they are short-lived secrets and are not worth keeping in Redis in
%%% plain text (sd_notify retries those in memory for a minute or so instead).
-module(sd_mailq).
-export([enqueue/4, fire_due/0, kick/0, pending/0, dead/0, delays/0, transient/1]).
-include_lib("kernel/include/logger.hrl").

-define(QUEUE, "sd:mailq").
-define(JOB, "sd:mailq:job").
-define(DEAD, "sd:mailq:dead").
-define(DEAD_MAX, 100).
-define(LEASE_MS, 120000).
-define(BATCH, 5).

%% Stores the job and returns its id. Raises if Redis is unavailable (the caller then falls back to sending directly).
enqueue(Kind, Email, Subject, Body) ->
    Id = binary_to_list(sd_util:rand_token()),
    Now = sd_util:now_ms(),
    Doc = #{<<"id">> => list_to_binary(Id), <<"kind">> => sd_util:b(Kind), <<"to">> => sd_util:b(Email),
            <<"subject">> => sd_util:b(Subject), <<"body">> => sd_util:b(Body),
            <<"attempts">> => 0, <<"createdTs">> => Now},
    sd_db:hset_json(?JOB, Id, Doc),
    sd_db:q(["ZADD", ?QUEUE, integer_to_list(Now + hd(delays())), Id]),
    Id.

%% Send right away instead of waiting for the next tick.
kick() -> spawn(fun() -> try fire_due() catch _:_ -> ok end end), ok.

%% Called by sd_scheduler on every tick.
fire_due() ->
    Now = sd_util:now_ms(),
    Ids = sd_db:q(["ZRANGEBYSCORE", ?QUEUE, "-inf", integer_to_list(Now), "LIMIT", "0", integer_to_list(?BATCH)]),
    lists:foreach(
      fun(IdB) ->
          Id = binary_to_list(IdB),
          sd_db:q(["ZADD", ?QUEUE, integer_to_list(Now + ?LEASE_MS), Id]),   %% lease: never lost, never double-sent
          spawn(fun() -> process(Id) end)
      end, Ids),
    ok.

process(Id) ->
    try
        case sd_db:hget_json(?JOB, Id) of
            undefined -> sd_db:q(["ZREM", ?QUEUE, Id]);                       %% orphan entry
            Job -> attempt(Id, Job)
        end
    catch Class:Reason ->
        ?LOG_WARNING("sd_mailq: job ~s could not be processed now (~p:~p); it stays queued", [Id, Class, Reason])
    end.

attempt(Id, Job) ->
    Email = maps:get(<<"to">>, Job),
    Kind = maps:get(<<"kind">>, Job),
    Attempts = maps:get(<<"attempts">>, Job, 0),
    case sd_smtp:send(Email, binary_to_list(maps:get(<<"subject">>, Job)), maps:get(<<"body">>, Job)) of
        ok ->
            ?LOG_NOTICE("sd_notify[~s]: email sent to ~s", [Kind, Email]),
            done(Id);
        {error, Why} ->
            Next = Attempts + 1,
            Delays = delays(),
            case transient(Why) andalso Next < length(Delays) of
                true ->
                    Due = sd_util:now_ms() + lists:nth(Next + 1, Delays),
                    sd_db:hset_json(?JOB, Id, Job#{<<"attempts">> => Next, <<"lastError">> => err_text(Why)}),
                    sd_db:q(["ZADD", ?QUEUE, integer_to_list(Due), Id]),
                    ?LOG_WARNING("sd_notify[~s]: email to ~s failed (~s); will retry (attempt ~b of ~b)",
                                 [Kind, Email, err_text(Why), Next + 1, length(Delays)]);
                false ->
                    ?LOG_WARNING("sd_notify[~s]: email to ~s failed for good after ~b attempt(s): ~s",
                                 [Kind, Email, Next, err_text(Why)]),
                    Dead = maps:without([<<"body">>], Job#{<<"attempts">> => Next, <<"lastError">> => err_text(Why),
                                                          <<"failedTs">> => sd_util:now_ms()}),
                    sd_db:q(["LPUSH", ?DEAD, sd_util:jenc(Dead)]),
                    sd_db:q(["LTRIM", ?DEAD, "0", integer_to_list(?DEAD_MAX - 1)]),
                    done(Id)
            end
    end.

done(Id) ->
    sd_db:hdel(?JOB, Id),
    sd_db:q(["ZREM", ?QUEUE, Id]),
    ok.

%% Waiting to be sent: [#{id, kind, to, subject, attempts, lastError?, nextTs}] soonest first. Bodies are not returned.
pending() ->
    Raw = sd_db:q(["ZRANGE", ?QUEUE, "0", "99", "WITHSCORES"]),
    [begin
         Id = binary_to_list(IdB),
         Job = case sd_db:hget_json(?JOB, Id) of undefined -> #{}; J -> maps:without([<<"body">>], J) end,
         Job#{<<"nextTs">> => binary_to_integer(ScoreB)}
     end || {IdB, ScoreB} <- pairs(Raw)].

dead() ->
    [E || R <- sd_db:q(["LRANGE", ?DEAD, "0", integer_to_list(?DEAD_MAX - 1)]), {ok, E} <- [sd_util:jdec(R)]].

pairs([A, B | Rest]) -> [{A, B} | pairs(Rest)];
pairs(_) -> [].

transient({unexpected_reply, [$4 | _], _}) -> true;      %% 4xx: ask again later
transient({unexpected_reply, _, _}) -> false;            %% 5xx: refused for good
transient(no_recipient) -> false;
transient(_) -> true.                                    %% connection / TLS / timeout trouble

err_text(Why) -> list_to_binary(lists:flatten(io_lib:format("~p", [Why]))).

delays() ->
    Default = [0, 5000, 30000, 120000, 600000, 3600000],
    case os:getenv("SMTP_RETRY_DELAYS_MS") of
        false -> Default;
        S ->
            Parts = [string:trim(P) || P <- string:split(S, ",", all)],
            try [list_to_integer(P) || P <- Parts, P =/= ""] of
                [] -> Default;
                L -> L
            catch _:_ -> Default
            end
    end.
