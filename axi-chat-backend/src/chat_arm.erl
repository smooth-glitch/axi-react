%%% ARM API client -- lets the chat backend read Axpert data (the
%%% AxExternalUsers directory, chat-host config, and eventually List-prompt
%%% results) via the same REST endpoint the React frontend already uses.
%%%
%%% No sign-in here: the frontend signs into ARM API itself (see
%%% shared/axi-standalone-bridge.js in the axi-react repo) and forwards the
%%% resulting {token, ARMSessionId} once per chat connection -- this module
%%% never sees a password and makes no Signin call of its own, it only
%%% spends a session someone else already established.
%%%
%%% Same stock-OTP-only approach as the rest of this app: httpc/ssl (inets) for
%%% the network call, json (built into OTP 27+) for the body.
-module(chat_arm).
-export([get_list/2, get_list/3]).

-define(AXI_ARM_BASE_URL, "https://agile.axi-global.com/ARM_API").
-define(AXI_ARM_PROJECT, "erpdemo").
-define(AXLIST_URL, ?AXI_ARM_BASE_URL ++ "/AxList/api/v1/AxList").
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

post_json(Url, Body, Token) ->
    Headers = [{"Accept", "application/json"} | auth_header(Token)],
    Opts = [{timeout, ?FETCH_TIMEOUT}, {connect_timeout, ?CONNECT_TIMEOUT}, {autoredirect, false}],
    Req = {Url, Headers, "application/json", Body},
    case httpc:request(post, Req, Opts, [{body_format, binary}]) of
        {ok, {{_, 200, _}, _RespHeaders, RespBody}} ->
            try
                {ok, json:decode(RespBody)}
            catch
                _:_ -> {error, {bad_json, RespBody}}
            end;
        {ok, {{_, Code, _}, _RespHeaders, RespBody}} ->
            {error, {http_error, Code, RespBody}};
        {error, Reason} ->
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
