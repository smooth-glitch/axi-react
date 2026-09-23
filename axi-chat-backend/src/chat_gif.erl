%%% Server-side proxy for GIF and sticker search (Giphy). The API key lives
%%% only here -- it's never sent to the client, which only ever sees
%%% already-fetched URLs and asks this module to search on its behalf over
%%% the existing WebSocket connection (see chat_web.erl's "/gifsearch " and
%%% "/stickersearch " commands). Stickers are just Giphy's sticker endpoints
%%% instead of its gif endpoints -- same request/response shape (a JSON
%%% "data" array of the same {id, images} objects), so one parameterized
%%% module covers both rather than duplicating the fetch/parse pipeline.
%%%
%%% Unlike chat_link_preview, this doesn't need the SSRF host-validation
%%% machinery: the fetch target is always a fixed Giphy API host, never a
%%% user-supplied URL -- the only untrusted input is the search query text,
%%% which goes in as a query parameter (properly encoded via
%%% uri_string:compose_query/1, so it can't break out of the URL or inject
%%% extra parameters).
-module(chat_gif).
-export([search_async/3]).
-include_lib("kernel/include/logger.hrl").

-define(GIF_SEARCH_URL, "https://api.giphy.com/v1/gifs/search").
-define(GIF_TRENDING_URL, "https://api.giphy.com/v1/gifs/trending").
-define(STICKER_SEARCH_URL, "https://api.giphy.com/v1/stickers/search").
-define(STICKER_TRENDING_URL, "https://api.giphy.com/v1/stickers/trending").
-define(FETCH_TIMEOUT, 6000).
-define(CONNECT_TIMEOUT, 4000).
-define(MAX_RESULTS, 24).
-define(MAX_QUERY_LEN, 80).

%% Kind is 'gif' | 'sticker', picking which pair of Giphy endpoints to hit.
%% Runs the search in its own process so the caller's WebSocket loop stays
%% responsive to other messages while Giphy is slow to answer -- same
%% fetch-then-message-back shape as chat_link_preview:maybe_fetch_and_notify/3.
%% Always replies exactly once with {Kind, gif_results, Query, Results};
%% Results is [] on any failure (bad query, network error, malformed
%% response) rather than surfacing an error type the caller would have to
%% branch on -- an empty result set and "nothing found" look the same to the
%% UI either way. An empty/whitespace-only Query fetches trending items
%% instead of erroring out, so the picker has something to show the moment
%% it opens, before the person has typed anything.
search_async(Kind, Query, ReplyPid) ->
    spawn(fun() ->
        Results = case fetch(Kind, string:trim(Query)) of
            {ok, Items} -> Items;
            {error, _} -> []
        end,
        ReplyPid ! {Kind, gif_results, Query, Results}
    end),
    ok.

fetch(Kind, Query) ->
    case giphy_api_key() of
        undefined ->
            {error, not_configured};
        ApiKey ->
            fetch(Kind, Query, ApiKey)
    end.

fetch(Kind, "", ApiKey) ->
    request(trending_url(Kind), [
        {"api_key", ApiKey},
        {"limit", integer_to_list(?MAX_RESULTS)},
        {"rating", "g"}
    ]);
fetch(_Kind, Q, _ApiKey) when length(Q) > ?MAX_QUERY_LEN ->
    {error, query_too_long};
fetch(Kind, Q, ApiKey) ->
    request(search_url(Kind), [
        {"api_key", ApiKey},
        {"q", Q},
        {"limit", integer_to_list(?MAX_RESULTS)},
        {"rating", "g"}
    ]).

%% Was hardcoded in source (a real, live credential committed to version
%% control) -- now read from GIPHY_API_KEY same as every other secret in
%% this app. Cached in persistent_term after the first lookup + a one-time
%% warning if unset, rather than re-reading the env on every single GIF/
%% sticker search. Unset means GIF/sticker search just always returns no
%% results (see search_async/3's doc) -- a missing key degrades a nice-to-
%% have feature, it was never load-bearing for anything else.
giphy_api_key() ->
    case persistent_term:get({?MODULE, api_key}, not_loaded) of
        not_loaded ->
            Key = load_giphy_api_key(),
            persistent_term:put({?MODULE, api_key}, Key),
            Key;
        Key ->
            Key
    end.

load_giphy_api_key() ->
    case os:getenv("GIPHY_API_KEY") of
        false ->
            ?LOG_WARNING("GIPHY_API_KEY is not set -- GIF/sticker search is disabled (will always return no results)."),
            undefined;
        "" ->
            ?LOG_WARNING("GIPHY_API_KEY is not set -- GIF/sticker search is disabled (will always return no results)."),
            undefined;
        Key ->
            Key
    end.

search_url(gif) -> ?GIF_SEARCH_URL;
search_url(sticker) -> ?STICKER_SEARCH_URL.

trending_url(gif) -> ?GIF_TRENDING_URL;
trending_url(sticker) -> ?STICKER_TRENDING_URL.

request(BaseUrl, QueryParams) ->
    {ok, _} = application:ensure_all_started(inets),
    {ok, _} = application:ensure_all_started(ssl),
    Url = BaseUrl ++ "?" ++ uri_string:compose_query(QueryParams),
    Opts = [{timeout, ?FETCH_TIMEOUT}, {connect_timeout, ?CONNECT_TIMEOUT}, {autoredirect, false}],
    case httpc:request(get, {Url, []}, Opts, [{body_format, binary}]) of
        {ok, {{_, 200, _}, _Headers, Body}} ->
            parse_results(Body);
        _ ->
            {error, request_failed}
    end.

parse_results(Body) ->
    try json:decode(Body) of
        #{<<"data">> := Data} when is_list(Data) ->
            {ok, lists:filtermap(fun extract_item/1, Data)};
        _ ->
            {error, bad_shape}
    catch
        _:_ -> {error, bad_json}
    end.

%% Only fixed_width (picker thumbnail) and original (what actually gets
%% sent/rendered full-size) are needed -- Giphy's payload has a couple dozen
%% other rendition sizes nothing here uses.
extract_item(#{<<"id">> := Id, <<"images">> := Images}) ->
    case {maps:find(<<"fixed_width">>, Images), maps:find(<<"original">>, Images)} of
        {{ok, Preview}, {ok, Original}} ->
            Url = maps:get(<<"url">>, Original, <<>>),
            PreviewUrl = maps:get(<<"url">>, Preview, <<>>),
            case {Url, PreviewUrl} of
                {<<>>, _} -> false;
                {_, <<>>} -> false;
                _ ->
                    {true, {
                        binary_to_list(Id),
                        binary_to_list(Url),
                        binary_to_list(PreviewUrl),
                        binary_to_list(maps:get(<<"width">>, Preview, <<"0">>)),
                        binary_to_list(maps:get(<<"height">>, Preview, <<"0">>))
                    }}
            end;
        _ ->
            false
    end;
extract_item(_) ->
    false.
