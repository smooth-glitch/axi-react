%%% Top supervisor: restarts chat_room / chat_listener / chat_web_listener
%%% independently if any of them crashes, without taking down already-
%%% connected clients on the others.
-module(chat_app_sup).
-behaviour(supervisor).

-export([start_link/2]).
-export([init/1]).

start_link(TcpPort, WebPort) ->
    supervisor:start_link({local, ?MODULE}, ?MODULE, [TcpPort, WebPort]).

init([TcpPort, WebPort]) ->
    %% intensity/period is a budget shared across every child under this
    %% supervisor, not per-child -- exceed it and chat_app_sup itself gives
    %% up and terminates, taking the whole node down (chat_web_listener
    %% included, dropping every connected client, not just the one feature
    %% that was actually failing). That matters more than it used to:
    %% since chat_store.erl's q_ok/1 helper logs-then-crashes the *calling*
    %% process on any Redis failure (by design -- see its doc comment),
    %% chat_room/chat_groups now crash on literally the next chat command
    %% (a message, a reaction, a delete...) that arrives during a Redis
    %% blip, not just on startup. A single brief Redis restart/reconnect
    %% with even light chat activity during it could burn through the
    %% previous 5-in-10s budget and crash the entire node over what's
    %% often a multi-second, self-resolving hiccup.
    %%
    %% 20 restarts / 60s gives real headroom for that case (and
    %% chat_groups' own init/1, which also calls chat_store and would
    %% otherwise fail to even start back up during an outage) without
    %% pretending Redis can never really be down for good -- a genuinely
    %% sustained outage still eventually exhausts this and takes the node
    %% down, at which point systemd's `Restart=on-failure`/`RestartSec=5`
    %% (see the deploy VM's axi-chat-backend.service, not in this repo)
    %% is the actual safety net, retrying every 5s until Redis recovers.
    SupFlags = #{strategy => one_for_one, intensity => 20, period => 60},
    ChatRedis = #{id => chat_redis,
                  start => {chat_redis, start_link, []},
                  restart => permanent,
                  shutdown => 5000,
                  type => worker,
                  modules => [chat_redis]},
    ChatHosts = #{id => chat_hosts,
                  start => {chat_hosts, start_link, []},
                  restart => permanent,
                  shutdown => 5000,
                  type => worker,
                  modules => [chat_hosts]},
    ChatRoom = #{id => chat_room,
                 start => {chat_room, start_link, []},
                 restart => permanent,
                 shutdown => 5000,
                 type => worker,
                 modules => [chat_room]},
    ChatGroups = #{id => chat_groups,
                   start => {chat_groups, start_link, []},
                   restart => permanent,
                   shutdown => 5000,
                   type => worker,
                   modules => [chat_groups]},
    UploadLimiter = #{id => chat_upload_limiter,
                       start => {chat_upload_limiter, start_link, []},
                       restart => permanent,
                       shutdown => 5000,
                       type => worker,
                       modules => [chat_upload_limiter]},
    WebListener = #{id => chat_web_listener,
                    start => {chat_web_listener, start_link, [WebPort]},
                    restart => permanent,
                    shutdown => 5000,
                    type => worker,
                    modules => [chat_web_listener]},
    %% TcpPort is `undefined` for a hosted deploy (chat_app:start_web_only/1)
    %% that deliberately doesn't open the raw TCP port at all -- see its doc
    %% comment for why a second open port there is actively dangerous, not
    %% just unused.
    Children = case TcpPort of
        undefined ->
            [ChatRedis, ChatHosts, ChatRoom, ChatGroups, UploadLimiter, WebListener];
        _ ->
            Listener = #{id => chat_listener,
                         start => {chat_listener, start_link, [TcpPort]},
                         restart => permanent,
                         shutdown => 5000,
                         type => worker,
                         modules => [chat_listener]},
            [ChatRedis, ChatHosts, ChatRoom, ChatGroups, UploadLimiter, Listener, WebListener]
    end,
    {ok, {SupFlags, Children}}.
