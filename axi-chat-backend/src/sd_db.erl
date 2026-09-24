%%% Thin Redis helpers for the sd_* modules -- the same "log the failing
%%% command, then crash the caller" contract chat_store:q_ok/1 uses, plus
%%% JSON-valued hash fields (every Sandesh record is one JSON document in a
%%% hash field) and a Redis-backed rate limiter.
-module(sd_db).
-export([q/1, hget/2, hset/3, hdel/2, hgetall/1, hkeys/1, hlen/1,
         get/1, set/2, setex/3, del/1, incr/1, expire/2, ttl/1,
         sadd/2, srem/2, smembers/1, sismember/2,
         zadd/3, zrevrange/3, ztrim/2,
         hget_json/2, hset_json/3, hgetall_json/1,
         get_json/1, setex_json/3,
         rate/3, flush_test_db/0]).
-include_lib("kernel/include/logger.hrl").
-compile({no_auto_import, [get/1]}).

q(Command) ->
    case chat_redis:q(Command) of
        {ok, Reply} -> Reply;
        {error, Reason} ->
            ?LOG_ERROR("Redis command failed: ~p -- command: ~p", [Reason, redact(Command)]),
            error({redis_command_failed, Reason})
    end.

%% Never let a value (which could be a password hash or sealed secret) land
%% in a log line -- only the verb and key.
redact([Verb, Key | _]) -> [Verb, Key, '...'];
redact(Other) -> Other.

hget(Key, Field) -> q(["HGET", Key, Field]).
hset(Key, Field, Value) -> q(["HSET", Key, Field, Value]), ok.
hdel(Key, Field) -> q(["HDEL", Key, Field]), ok.
hkeys(Key) -> q(["HKEYS", Key]).
hlen(Key) -> binary_to_integer(q(["HLEN", Key])).

hgetall(Key) ->
    pair_up(q(["HGETALL", Key])).

pair_up([]) -> [];
pair_up([K, V | Rest]) -> [{K, V} | pair_up(Rest)].

get(Key) ->
    case q(["GET", Key]) of
        undefined -> undefined;
        V -> V
    end.

set(Key, Value) -> q(["SET", Key, Value]), ok.
setex(Key, Ttl, Value) -> q(["SETEX", Key, integer_to_list(Ttl), Value]), ok.
del(Key) -> q(["DEL", Key]), ok.
incr(Key) -> binary_to_integer(q(["INCR", Key])).
expire(Key, Secs) -> q(["EXPIRE", Key, integer_to_list(Secs)]), ok.
ttl(Key) -> binary_to_integer(q(["TTL", Key])).

sadd(Key, Member) -> q(["SADD", Key, Member]), ok.
srem(Key, Member) -> q(["SREM", Key, Member]), ok.
smembers(Key) -> q(["SMEMBERS", Key]).
sismember(Key, Member) -> q(["SISMEMBER", Key, Member]) =:= <<"1">>.

zadd(Key, Score, Member) -> q(["ZADD", Key, integer_to_list(Score), Member]), ok.
%% Newest first, indexes inclusive.
zrevrange(Key, From, To) -> q(["ZREVRANGE", Key, integer_to_list(From), integer_to_list(To)]).
%% Keep only the newest Max members.
ztrim(Key, Max) -> q(["ZREMRANGEBYRANK", Key, "0", integer_to_list(-(Max + 1))]), ok.

%% ---- JSON documents ----------------------------------------------------------

hget_json(Key, Field) ->
    case hget(Key, Field) of
        undefined -> undefined;
        Bin -> decode(Bin)
    end.

hset_json(Key, Field, Map) -> hset(Key, Field, sd_util:jenc(Map)).

hgetall_json(Key) ->
    [{K, decode(V)} || {K, V} <- hgetall(Key)].

get_json(Key) ->
    case get(Key) of
        undefined -> undefined;
        Bin -> decode(Bin)
    end.

setex_json(Key, Ttl, Map) -> setex(Key, Ttl, sd_util:jenc(Map)).

decode(Bin) ->
    case sd_util:jdec(Bin) of
        {ok, T} -> T;
        error ->
            ?LOG_ERROR("sd_db: corrupt JSON document in Redis (~p bytes)", [byte_size(Bin)]),
            undefined
    end.

%% ---- rate limiting -----------------------------------------------------------
%% Fixed window: at most Max events per WindowSecs for Bucket. Redis-backed
%% (not per-process state) because HTTP requests each run in a fresh,
%% short-lived process with no memory of earlier ones.
rate(Bucket, Max, WindowSecs) ->
    Key = "sd:rl:" ++ sd_util:s(Bucket),
    N = incr(Key),
    case N of
        1 -> expire(Key, WindowSecs);
        _ -> ok
    end,
    case N =< Max of
        true -> ok;
        false -> limited
    end.

%% Test support only: wipes the *current logical DB*. Refuses to run on DB 0
%% (production) so a stray call can never destroy real data.
flush_test_db() ->
    case os:getenv("REDIS_DB") of
        Db when Db =/= false, Db =/= "", Db =/= "0" -> q(["FLUSHDB"]), ok;
        _ -> {error, refused_on_db0}
    end.
