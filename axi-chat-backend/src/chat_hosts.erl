%%% Host directory -- the boss's spec calls for a directory of associates
%%% + chat hosts, where hosts are either "preconfigured" (Open AI, AI
%%% Router, Claude, Gemini, "My work space" -- always listed, fixed,
%%% never data-driven per spec) or "department" hosts (HR, Finance, IT
%%% Support... configured via a chat-host tstruct that doesn't exist in
%%% the backend yet).
%%%
%%% Preconfigured LLM hosts and "My work space" never get routed through
%%% here at all -- selecting one is "the same experience as today's AXI
%%% chat" per spec, which is already fully client-side (Provider Switcher/
%%% Composer/MessageThread). This module only exists so the directory has
%%% one source of truth to list them from, and so department-host message
%%% routing (chat_room:send_host_message/3,4) has somewhere to resolve a
%%% host key to an actual recipient.
-module(chat_hosts).
-behaviour(gen_server).

-export([start_link/0, list_hosts/0, resolve_host/2, refresh_department_hosts/1]).
-export([init/1, handle_call/3, handle_cast/2]).

%% Fixed per the boss's spec -- kind is "llm" | "workspace" | "department".
-define(PRECONFIGURED, [
    {"openai", "Open AI", "llm"},
    {"ai_router", "AI Router", "llm"},
    {"claude", "Claude", "llm"},
    {"gemini", "Gemini", "llm"},
    {"workspace", "My work space", "workspace"}
]).

%% TODO(backend dev): placeholder -- there is no chat-host tstruct/ADS yet.
%% Set this to the real ADS name once it exists, and fill in
%% decode_department_hosts/1 to match its actual columns (host name, host
%% user name / group per the "Chat host tstruct" spec in NEXT_STEPS.md).
-define(CHAT_HOST_ADS_NAME, undefined).

-record(state, {department_hosts = #{} :: #{string() => map()}}).

start_link() ->
    gen_server:start_link({local, ?MODULE}, ?MODULE, [], []).

init([]) ->
    {ok, #state{}}.

%% Every host the directory should show, as
%% #{key, name, kind}. Department hosts are whatever's currently cached --
%% empty until refresh_department_hosts/1 has real data to load.
list_hosts() ->
    gen_server:call(?MODULE, list_hosts).

%% Resolves a department-host key to the username a message to it should
%% currently go to. RequestingUser matters once "selected user in a
%% group" / "all users in a group" modes are real (a group host might
%% route differently depending on who's asking); unused for now since no
%% real department host config exists yet.
%% {error, not_found} covers both "no such host" and "host exists but has
%% no assigned user yet" (the spec's "Not assigned" mode) -- callers don't
%% need to tell those apart.
resolve_host(Key, RequestingUser) ->
    gen_server:call(?MODULE, {resolve_host, Key, RequestingUser}).

%% Opportunistically refreshes the department-host cache using whichever
%% connected user's ARM identity happens to call this -- this data isn't
%% user-specific, so any authenticated session can read it. Safe to call
%% on every connect; a no-op until CHAT_HOST_ADS_NAME is set.
refresh_department_hosts(Identity) ->
    case ?CHAT_HOST_ADS_NAME of
        undefined ->
            ok;
        AdsName ->
            case chat_arm:get_list(Identity, [AdsName]) of
                {ok, Response} ->
                    gen_server:cast(?MODULE, {department_hosts, decode_department_hosts(Response)});
                {error, _Reason} ->
                    ok
            end
    end.

handle_call(list_hosts, _From, State = #state{department_hosts = Department}) ->
    Preconfigured = [#{key => K, name => N, kind => Kind} || {K, N, Kind} <- ?PRECONFIGURED],
    DepartmentList = [H#{key => K, kind => "department"} || {K, H} <- maps:to_list(Department)],
    {reply, Preconfigured ++ DepartmentList, State};
handle_call({resolve_host, Key, _RequestingUser}, _From, State = #state{department_hosts = Department}) ->
    case maps:find(Key, Department) of
        {ok, #{user := User}} when User =/= undefined, User =/= [] ->
            {reply, {ok, User}, State};
        _ ->
            {reply, {error, not_found}, State}
    end.

handle_cast({department_hosts, Hosts}, State) ->
    {noreply, State#state{department_hosts = Hosts}}.

%% Placeholder -- the real shape depends entirely on the chat-host ADS's
%% actual columns, which don't exist yet. Returns #{Key => #{name, user}}
%% once implemented.
decode_department_hosts(_Response) ->
    #{}.
