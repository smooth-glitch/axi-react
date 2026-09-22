%%% Redis connection -- supervised as one named eredis client (see
%%% chat_app_sup.erl), reused by every process in this app that needs
%%% storage. eredis serializes concurrent calls from multiple processes
%%% internally, and auto-reconnects (reconnect_sleep below) if the
%%% connection drops, so nothing here needs its own pooling or retry logic.
%%%
%%% Host/port/password come from env vars so the same release binary works
%%% unchanged from a laptop (defaults to a local Redis with no password) to
%%% the VM (real host + a real requirepass) -- see docs/NEXT_STEPS.md's
%%% deploy section for what the VM side needs.
-module(chat_redis).
-export([start_link/0, q/1]).

-define(NAME, ?MODULE).

start_link() ->
    Options = [
        {host, get_env_str("REDIS_HOST", "127.0.0.1")},
        {port, get_env_int("REDIS_PORT", 6379)},
        {password, get_env_str("REDIS_PASSWORD", "")},
        {reconnect_sleep, 1000},
        {name, {local, ?NAME}}
    ],
    eredis:start_link(Options).

%% Command is a list like ["HSET", Key, Field, Value, ...] -- eredis
%% converts lists/atoms/binaries/integers/floats to Redis's wire format
%% itself (see eredis:to_binary/1), so callers never need to pre-encode
%% anything other than the compound values (reactions, previews, member
%% lists) this app JSON-encodes itself in chat_store.erl.
q(Command) ->
    eredis:q(?NAME, Command).

get_env_str(Var, Default) ->
    case os:getenv(Var) of
        false -> Default;
        "" -> Default;
        Value -> Value
    end.

get_env_int(Var, Default) ->
    case os:getenv(Var) of
        false -> Default;
        "" -> Default;
        Value ->
            case string:to_integer(Value) of
                {Int, []} -> Int;
                _ -> Default
            end
    end.
