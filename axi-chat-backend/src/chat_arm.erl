%%% ARM API client -- lets the chat backend read Axpert data (the
%%% AxExternalUsers directory, chat-host config, and eventually List-prompt
%%% results) and write it back (the once-daily Redis-to-DB sync, eventually
%%% Input-prompt tstruct saves) via the same REST endpoints the React
%%% frontend already uses.
%%%
%%% No sign-in here: the frontend signs into ARM API itself (see
%%% shared/axi-standalone-bridge.js in the axi-react repo) and forwards the
%%% resulting {token, ARMSessionId, username} once per chat connection --
%%% this module never sees a password and makes no Signin call of its own,
%%% it only spends a session someone else already established.
%%%
%%% Same stock-OTP-only approach as the rest of this app: httpc/ssl (inets) for
%%% the network call, json (built into OTP 27+) for the body.
-module(chat_arm).
-export([get_list/2, get_list/3, put/2]).
-include_lib("kernel/include/logger.hrl").

-define(AXI_ARM_BASE_URL, "https://agile.axi-global.com/ARM_API").
-define(AXI_ARM_PROJECT, "erpdemo").
-define(AXLIST_URL, ?AXI_ARM_BASE_URL ++ "/AxList/api/v1/AxList").
-define(PUSH_TO_QUEUE_URL, ?AXI_ARM_BASE_URL ++ "/ARM_APIs/api/v1/ARMPushToQueue").
-define(FETCH_TIMEOUT, 15000).
-define(CONNECT_TIMEOUT, 5000).

%% Identity is #{token := Token, arm_session_id := ArmSessionId} -- exactly
%% what the frontend holds after its own ARM Signin. AdsNames is a list of
%% strings (ADS names), matching axi-standalone-bridge.js's GetDataFromAxList.
%% Returns {ok, DecodedJsonMap} | {error, Reason}; the map has the same
%% {result:{success,data:[{data:[...]}]}} shape the frontend already knows
%% how to unwrap.
get_list(Identity, AdsNames) ->
    get_list(Identity, AdsNames, #{}).

get_list(#{token := Token, arm_session_id := ArmSessionId}, AdsNames, SqlParams) ->
    ensure_http_apps(),
    Body = json:encode(#{
        <<"ARMSessionId">> => to_bin(ArmSessionId),
        <<"action">> => <<"view">>,
        <<"Project">> => <<?AXI_ARM_PROJECT>>,
        <<"ADSNames">> => [to_bin(N) || N <- AdsNames],
        <<"sqlparams">> => SqlParams,
        <<"trace">> => false,
        <<"getallrecordscount">> => true,
        <<"CachePermissions">> => true,
        <<"RefreshCache">> => true,
        <<"pageno">> => 1,
        <<"pagesize">> => 1000,
        <<"keyfield">> => <<"username">>,
        <<"keyvalue">> => <<"ALL">>,
        <<"AxClient_dateformat">> => <<"MM/dd/yyyy">>,
        <<"select_columns">> => [],
        <<"aggregations">> => #{},
        <<"groupby_columns">> => [],
        <<"sorting">> => [],
        <<"filters">> => []
    }),
    post_json(?AXLIST_URL, Body, Token).

%% Writes don't go through a direct "put" endpoint -- Axpert processes them
%% asynchronously off a queue instead. This builds the AxPut-format payload
%% (the same data/submitdata/dc/row shape a create/edit/delete transaction
%% uses -- see release notes) and pushes it onto "CachedSaveQueue" via
%% ARMPushToQueue. A successful response here means "queued," not "saved" --
%% there's no synchronous save confirmation in this flow.
%%
%% Identity is #{token := Token, arm_session_id := ArmSessionId,
%% username := Username} -- the same three things the frontend already
%% holds after its own ARM Signin (axi-standalone-bridge.js's `session`).
%% TransItems is a list of already-shaped transaction maps, e.g.:
%%   #{<<"transid">> => <<"impdt">>, <<"action">> => <<"create">>,
%%     <<"submitdata">> => #{<<"dc1">> => #{<<"row1">> => #{...}}}}
%% (add <<"keyfield">>/<<"keyvalue">> for an "edit" action). Building the
%% actual dc/row/field shape for a given transid is the caller's job --
%% this function only handles the envelope and the queue push.
put(#{token := Token, arm_session_id := ArmSessionId, username := Username}, TransItems) ->
    ensure_http_apps(),
    QueueData = json:encode(#{
        <<"_parameters">> => [#{
            <<"ARMSessionId">> => to_bin(ArmSessionId),
            <<"ARMToken">> => to_bin(Token),
            <<"isaxput">> => <<"true">>,
            <<"project">> => <<?AXI_ARM_PROJECT>>,
            <<"username">> => to_bin(Username),
            <<"trace">> => false,
            <<"validateonly">> => false,
            <<"axclient_dateformat">> => <<"yyyy-MM-dd">>,
            <<"millisecsintimestamp">> => true,
            <<"data">> => TransItems
        }]
    }),
    Body = json:encode(#{
        <<"queuename">> => <<"CachedSaveQueue">>,
        <<"queuedata">> => QueueData
    }),
    post_json(?PUSH_TO_QUEUE_URL, Body, Token).

%% Never logs Body/Headers/Token here or anywhere in this module -- Body
%% carries the ARM token embedded in the request payload for put/2, and
%% RespBody is real Axpert data. Logs are limited to the URL (fixed,
%% carries no secrets) and the HTTP status/error reason -- enough to
%% diagnose "is ARM reachable / did auth fail" without ever writing a
%% credential or a user's data to disk.
post_json(Url, Body, Token) ->
    Headers = [{"Accept", "application/json"} | auth_header(Token)],
    Opts = [{timeout, ?FETCH_TIMEOUT}, {connect_timeout, ?CONNECT_TIMEOUT}, {autoredirect, false}],
    Req = {Url, Headers, "application/json", Body},
    case httpc:request(post, Req, Opts, [{body_format, binary}]) of
        {ok, {{_, 200, _}, _RespHeaders, RespBody}} ->
            try
                {ok, json:decode(RespBody)}
            catch
                _:_ ->
                    ?LOG_WARNING("ARM API call to ~s returned unparseable JSON", [Url]),
                    {error, {bad_json, RespBody}}
            end;
        {ok, {{_, Code, _}, _RespHeaders, RespBody}} ->
            ?LOG_WARNING("ARM API call to ~s failed with HTTP ~p", [Url, Code]),
            {error, {http_error, Code, RespBody}};
        {error, Reason} ->
            ?LOG_WARNING("ARM API call to ~s failed: ~p", [Url, Reason]),
            {error, Reason}
    end.

auth_header(undefined) -> [];
auth_header(Token) -> [{"Authorization", "Bearer " ++ to_str(Token)}].

to_bin(V) when is_binary(V) -> V;
to_bin(V) when is_list(V) -> list_to_binary(V).

to_str(V) when is_list(V) -> V;
to_str(V) when is_binary(V) -> binary_to_list(V).

ensure_http_apps() ->
    {ok, _} = application:ensure_all_started(inets),
    {ok, _} = application:ensure_all_started(ssl).
