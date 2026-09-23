%%% Minimal HTTP + WebSocket server, hand-rolled on gen_tcp (no cowboy/
%%% ranch dependency, so the whole app stays zero-install). Upgrades
%%% WebSocket connections into the same chat_room registry the raw TCP
%%% handler uses -- this is the interface axi-react (and any future
%%% mobile client -- see the module doc for handshake/protocol details in
%%% docs/CHAT_PROTOCOL.md) actually talks to. Also accepts image/voice
%%% uploads (POST /upload) and serves them back (GET /uploads/<name>).
%%% No page-serving of any kind -- the frontend hosts its own build.
%%%
%%% Debugging: every connect/disconnect, handshake rejection, and crash is
%%% logged via OTP's `logger` (see chat.hrl's log level note and
%%% docs/DEBUGGING.md) rather than scattered io:format calls -- filter by
%%% module (`logger:set_module_level(chat_web, debug)`) when chasing a
%%% specific connection's behavior on a live node.
-module(chat_web).
-export([start/1]).
-include("chat.hrl").
-include_lib("kernel/include/logger.hrl").

-define(WS_GUID, "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").
-define(MAX_UPLOAD_SIZE, 8 * 1024 * 1024).
-define(DRAIN_CEILING, 32 * 1024 * 1024).
-define(ALLOWED_UPLOAD_TYPES, ["image/png", "image/jpeg", "image/gif", "image/webp",
                                "audio/webm", "audio/ogg", "audio/mp4"]).

start(Socket) ->
    Pid = spawn(fun() -> wait_for_socket(Socket) end),
    ok = gen_tcp:controlling_process(Socket, Pid),
    Pid ! go,
    {ok, Pid}.

wait_for_socket(Socket) ->
    receive
        go ->
            try
                read_request(Socket)
            catch
                Class:Reason:Stack ->
                    ?LOG_ERROR("chat_web handler crashed: ~p:~p~n~p", [Class, Reason, Stack]),
                    gen_tcp:close(Socket)
            end
    end.

%% ---- HTTP request parsing -------------------------------------------

%% Read raw bytes (rather than relying on {packet, line} reframing
%% already-buffered data, which isn't reliable once a connection has
%% just been handed off via controlling_process/2) until the blank line
%% that ends the HTTP header block, then parse it by hand. Whatever was
%% already read *past* that blank line (the start of a POST body, if one
%% arrived in the same TCP segment as the headers) is handed along rather
%% than discarded, so a POST handler doesn't lose the first chunk of it.
read_request(Socket) ->
    inet:setopts(Socket, [{active, false}, {packet, raw}, binary, {nodelay, true}]),
    case read_headers_blob(Socket, <<>>) of
        {ok, HeaderBlob, BodyStart} ->
            Lines = binary:split(HeaderBlob, <<"\r\n">>, [global]),
            parse_and_dispatch(Socket, Lines, BodyStart);
        error ->
            gen_tcp:close(Socket)
    end.

read_headers_blob(Socket, Acc) ->
    case binary:match(Acc, <<"\r\n\r\n">>) of
        {Pos, Len} ->
            HeaderBlob = binary:part(Acc, 0, Pos),
            BodyStart = binary:part(Acc, Pos + Len, byte_size(Acc) - Pos - Len),
            {ok, HeaderBlob, BodyStart};
        nomatch when byte_size(Acc) > 16384 ->
            error;
        nomatch ->
            case gen_tcp:recv(Socket, 0, 5000) of
                {ok, Data} -> read_headers_blob(Socket, <<Acc/binary, Data/binary>>);
                _ -> error
            end
    end.

parse_and_dispatch(Socket, [ReqLineBin | HeaderLines], BodyStart) ->
    case string:split(binary_to_list(ReqLineBin), " ", all) of
        [Method, RawPath, _Ver] ->
            %% The request line's path is the raw target -- "/?cb=123" for a
            %% cache-busted reload, "/auth/google/callback?code=..&state=.."
            %% for an OAuth redirect back -- but route matching only cares
            %% about the path itself. Splitting the query string off here,
            %% once, keeps every dispatch clause (and any future one) from
            %% having to remember to do it, rather than each accidentally
            %% 404ing on a URL that happens to carry a "?". Query params
            %% still reach the handlers that need them, just as a separate,
            %% already-decoded argument instead of raw text glued onto Path.
            {Path, QueryParams} = case string:split(RawPath, "?") of
                [P] -> {P, []};
                [P, Qs] ->
                    %% Malformed percent-encoding (attacker-controlled, not
                    %% just a theoretical case) makes this return an error
                    %% tuple instead of a list -- treat that the same as no
                    %% query string rather than letting a bad "%zz" crash
                    %% whatever handler expects a proplist.
                    case uri_string:dissect_query(Qs) of
                        Parsed when is_list(Parsed) -> {P, Parsed};
                        _ -> {P, []}
                    end
            end,
            Headers = parse_headers(HeaderLines, #{}),
            dispatch(Socket, Method, Path, QueryParams, Headers, BodyStart);
        _ ->
            gen_tcp:close(Socket)
    end;
parse_and_dispatch(Socket, [], _BodyStart) ->
    gen_tcp:close(Socket).

parse_headers([], Acc) ->
    Acc;
parse_headers([<<>> | Rest], Acc) ->
    parse_headers(Rest, Acc);
parse_headers([Line | Rest], Acc) ->
    case string:split(binary_to_list(Line), ":", leading) of
        [K, V] ->
            Key = string:lowercase(string:trim(K)),
            parse_headers(Rest, maps:put(Key, string:trim(V), Acc));
        _ ->
            parse_headers(Rest, Acc)
    end.

%% No page-serving here at all -- axi-react is the frontend and hosts its
%% own build; this server is purely the WebSocket chat API plus the
%% image/voice upload endpoints that frontend calls into. /health is the
%% one exception -- a plain liveness/readiness probe for ops use (curl,
%% uptime monitors), not something the frontend calls. New, additive route;
%% doesn't change any existing endpoint's behavior. See docs/CHAT_PROTOCOL.md.
dispatch(Socket, "GET", "/health", _QueryParams, _Headers, _BodyStart) ->
    serve_health(Socket);
dispatch(Socket, "GET", Path, _QueryParams, Headers, _BodyStart) ->
    case string:lowercase(maps:get("upgrade", Headers, "")) of
        "websocket" ->
            handshake(Socket, Headers);
        _ ->
            case string:prefix(Path, "/uploads/") of
                nomatch -> serve_404(Socket);
                Filename -> serve_upload(Socket, Filename, Headers)
            end
    end;
dispatch(Socket, "POST", "/upload", _QueryParams, Headers, BodyStart) ->
    handle_upload(Socket, Headers, BodyStart);
dispatch(Socket, _Method, _Path, _QueryParams, _Headers, _BodyStart) ->
    serve_404(Socket).

serve_404(Socket) ->
    respond(Socket, 404, "Not Found", "text/plain", <<"Not found">>),
    gen_tcp:close(Socket).

%% Reports Redis reachability (the one external dependency this process
%% has) rather than just "the process is scheduling," which the previous
%% "curl / and expect a 404" health check (deploy-backend.yml) couldn't
%% tell you at all -- a node that's up but can't reach Redis is not
%% actually healthy. `catch` guards against chat_redis's gen_server not
%% being alive/registered at all (a full Redis-outage crash loop), not
%% just an ordinary query failure.
serve_health(Socket) ->
    {RedisOk, RedisStatus} = case catch chat_redis:q(["PING"]) of
        {ok, <<"PONG">>} -> {true, "ok"};
        _ -> {false, "unreachable"}
    end,
    {UptimeMs, _} = erlang:statistics(wall_clock),
    {Code, Reason, OverallStatus} = case RedisOk of
        true -> {200, "OK", "ok"};
        false -> {503, "Service Unavailable", "degraded"}
    end,
    Json = io_lib:format(
        "{\"status\":\"~s\",\"redis\":\"~s\",\"uptime_ms\":~p}",
        [OverallStatus, RedisStatus, UptimeMs]),
    respond(Socket, Code, Reason, "application/json", list_to_binary(Json)),
    gen_tcp:close(Socket).

respond(Socket, Code, Reason, ContentType, Body) ->
    Head = ["HTTP/1.1 ", integer_to_list(Code), " ", Reason, "\r\n",
            "Content-Type: ", ContentType, "\r\n",
            "Content-Length: ", integer_to_list(byte_size(Body)), "\r\n",
            %% Belt-and-suspenders alongside the upload magic-byte check: even
            %% if a browser somehow doubted our declared Content-Type, this
            %% tells it not to sniff the body and guess at executing it as
            %% something else (relevant to /uploads/*, harmless elsewhere).
            "X-Content-Type-Options: nosniff\r\n",
            %% This app changes several times a day during the demo push --
            %% no-cache forces the browser to revalidate every request
            %% instead of silently serving a stale index.html/JS from
            %% before the latest fix (the exact "why isn't my change
            %% showing up on the phone" class of confusion).
            "Cache-Control: no-cache\r\n",
            "Accept-Ranges: bytes\r\n",
            "Connection: close\r\n\r\n"],
    gen_tcp:send(Socket, [Head, Body]).

uploads_dir() ->
    Ebin = filename:dirname(code:which(?MODULE)),
    filename:join([filename:dirname(Ebin), "uploads"]).

%% ---- Image uploads ------------------------------------------------------
%% No auth exists anywhere in this app (identity is just a claimed username
%% on the websocket, same as every other command), so this endpoint is
%% reachable by anyone who can reach the server -- consistent with, not a
%% regression from, the app's existing trust model. What it does guard,
%% because these are the actual attack surface for an endpoint that writes
%% files to disk and serves them back to other users:
%%   - a hard size cap, so one upload can't exhaust disk space
%%   - a strict content-type whitelist (images only)
%%   - a server-generated random filename -- the client's filename is never
%%     used for the on-disk path, which rules out path traversal and name
%%     collisions in one move
%%   - a matching check on the *serving* side, so a crafted GET can't walk
%%     out of the uploads directory either

%% Rate-limit check comes first, before reading the (up to 8MB) body at
%% all -- a client that's already over the limit gets a cheap, immediate
%% 429 instead of the server spending time/memory reading a body it's
%% just going to reject anyway. See chat_upload_limiter.erl.
handle_upload(Socket, Headers, BodyStart) ->
    Ip = client_ip(Socket, Headers),
    case chat_upload_limiter:check(Ip) of
        limited ->
            ?LOG_WARNING("~s hit the upload rate limit", [Ip]),
            respond_json_error(Socket, 429, "Too many uploads -- slow down");
        ok ->
            ContentType = maps:get("content-type", Headers, ""),
            case extract_boundary(ContentType) of
                {ok, Boundary} ->
                    case read_body(Socket, Headers, BodyStart) of
                        {ok, Body} ->
                            case find_file_part(Body, Boundary) of
                                {ok, _Filename, PartContentType, Data} ->
                                    store_upload(Socket, PartContentType, Data);
                                error ->
                                    respond_json_error(Socket, 400, "No file found in upload")
                            end;
                        {error, too_large} ->
                            respond_json_error(Socket, 413, "File too large (max 8 MB)");
                        {error, _} ->
                            respond_json_error(Socket, 400, "Bad request")
                    end;
                error ->
                    respond_json_error(Socket, 400, "Expected multipart/form-data")
            end
    end,
    gen_tcp:close(Socket).

%% Behind nginx (production and every preview slot -- see
%% docs/CHAT_PROTOCOL.md and the deploy workflows), the TCP socket's peer
%% is always nginx itself (127.0.0.1), not the real client -- nginx sets
%% X-Real-IP for both /upload and /uploads/* specifically so this backend
%% can still tell clients apart. Falls back to the raw socket peer address
%% when there's no proxy in front at all (plain local dev).
client_ip(Socket, Headers) ->
    case maps:find("x-real-ip", Headers) of
        {ok, Ip} ->
            Ip;
        error ->
            case inet:peername(Socket) of
                {ok, {Addr, _Port}} -> inet:ntoa(Addr);
                {error, _} -> "unknown"
            end
    end.

read_body(Socket, Headers, BodyStart) ->
    case maps:find("content-length", Headers) of
        {ok, LenStr} ->
            case string:to_integer(LenStr) of
                {Len, []} when Len >= 0, Len =< ?MAX_UPLOAD_SIZE ->
                    read_body_bytes(Socket, BodyStart, Len);
                {Len, []} when Len > ?MAX_UPLOAD_SIZE ->
                    %% Drain the rejected body (bounded) before responding,
                    %% rather than closing out from under a client still
                    %% mid-upload -- that closes the TCP connection with data
                    %% still unread, which tends to send a RST instead of a
                    %% clean FIN, and a browser surfaces that as a network
                    %% error instead of our actual "file too large" message.
                    %% Capped so a client claiming a multi-gigabyte body can't
                    %% make the server sit there reading it all first.
                    drain_body(Socket, byte_size(BodyStart), min(Len, ?DRAIN_CEILING)),
                    {error, too_large};
                _ ->
                    {error, bad_length}
            end;
        error ->
            {error, no_length}
    end.

drain_body(_Socket, AlreadyRead, Target) when AlreadyRead >= Target ->
    ok;
drain_body(Socket, AlreadyRead, Target) ->
    case gen_tcp:recv(Socket, 0, 3000) of
        {ok, Data} -> drain_body(Socket, AlreadyRead + byte_size(Data), Target);
        {error, _} -> ok
    end.

read_body_bytes(_Socket, Acc, Len) when byte_size(Acc) >= Len ->
    {ok, binary:part(Acc, 0, Len)};
read_body_bytes(Socket, Acc, Len) ->
    case gen_tcp:recv(Socket, 0, 10000) of
        {ok, Data} -> read_body_bytes(Socket, <<Acc/binary, Data/binary>>, Len);
        {error, _} -> {error, closed}
    end.

extract_boundary(ContentType) ->
    case string:find(ContentType, "boundary=") of
        nomatch ->
            error;
        Match ->
            AfterKey = string:slice(Match, string:length("boundary=")),
            Value = case string:split(AfterKey, ";") of
                [B | _] -> B;
                _ -> AfterKey
            end,
            {ok, string:trim(Value, both, "\" \r\n")}
    end.

find_file_part(Body, Boundary) ->
    BoundaryBin = list_to_binary("--" ++ Boundary),
    Parts = binary:split(Body, BoundaryBin, [global]),
    find_file_part_loop(Parts).

find_file_part_loop([]) ->
    error;
find_file_part_loop([Part | Rest]) ->
    case parse_part(Part) of
        {ok, PartHeaders, Content} ->
            Disposition = maps:get("content-disposition", PartHeaders, ""),
            case extract_disposition_field(Disposition, "filename") of
                Filename when Filename =/= undefined, Filename =/= "" ->
                    PartContentType = maps:get("content-type", PartHeaders, "application/octet-stream"),
                    {ok, Filename, PartContentType, Content};
                _ ->
                    find_file_part_loop(Rest)
            end;
        error ->
            find_file_part_loop(Rest)
    end.

%% A part looks like "\r\nHeader: v\r\nHeader2: v2\r\n\r\n<content>\r\n"
%% (the leading \r\n is the boundary line's own terminator; the trailing
%% \r\n precedes the next boundary marker).
parse_part(PartBin) ->
    Trimmed = case PartBin of
        <<"\r\n", Rest/binary>> -> Rest;
        _ -> PartBin
    end,
    case binary:match(Trimmed, <<"\r\n\r\n">>) of
        {Pos, Len} ->
            HeaderBlob = binary:part(Trimmed, 0, Pos),
            ContentRaw = binary:part(Trimmed, Pos + Len, byte_size(Trimmed) - Pos - Len),
            Content = strip_trailing_crlf(ContentRaw),
            HeaderLines = binary:split(HeaderBlob, <<"\r\n">>, [global]),
            {ok, parse_part_headers(HeaderLines), Content};
        nomatch ->
            error
    end.

strip_trailing_crlf(Bin) ->
    Size = byte_size(Bin),
    case Size >= 2 andalso binary:part(Bin, Size - 2, 2) =:= <<"\r\n">> of
        true -> binary:part(Bin, 0, Size - 2);
        false -> Bin
    end.

parse_part_headers(Lines) ->
    lists:foldl(fun(Line, Acc) ->
        case binary:split(Line, <<":">>) of
            [K, V] ->
                Key = string:lowercase(string:trim(binary_to_list(K))),
                maps:put(Key, string:trim(binary_to_list(V)), Acc);
            _ ->
                Acc
        end
    end, #{}, Lines).

extract_disposition_field(DispositionValue, Field) ->
    Marker = Field ++ "=\"",
    case string:find(DispositionValue, Marker) of
        nomatch ->
            undefined;
        Match ->
            AfterMarker = string:slice(Match, string:length(Marker)),
            case string:split(AfterMarker, "\"") of
                [Value | _] -> Value;
                _ -> undefined
            end
    end.

store_upload(Socket, ContentType, Data) ->
    %% MediaRecorder's blob.type (voice notes) commonly carries a codec
    %% parameter, e.g. "audio/webm;codecs=opus" -- strip it before comparing
    %% against the whitelist. Harmless for image uploads, which never have one.
    Trimmed = string:lowercase(string:trim(ContentType)),
    NormalizedType = string:trim(hd(string:split(Trimmed, ";"))),
    case lists:member(NormalizedType, ?ALLOWED_UPLOAD_TYPES) of
        false ->
            respond_json_error(Socket, 415, "Only images or voice notes are allowed");
        true ->
            case byte_size(Data) of
                0 ->
                    respond_json_error(Socket, 400, "Empty file");
                Size when Size > ?MAX_UPLOAD_SIZE ->
                    respond_json_error(Socket, 413, "File too large (max 8 MB)");
                _ ->
                    %% The declared Content-Type is whatever the client claimed --
                    %% never trusted alone. Check the file's actual magic bytes
                    %% match, so a renamed/relabeled non-image can't ride in
                    %% under an image content-type.
                    case matches_signature(NormalizedType, Data) of
                        false ->
                            respond_json_error(Socket, 415, "File content doesn't match its declared type");
                        true ->
                            store_upload_bytes(Socket, NormalizedType, Data)
                    end
            end
    end.

store_upload_bytes(Socket, NormalizedType, Data) ->
    Ext = extension_for(NormalizedType),
    RandomName = random_hex(24) ++ Ext,
    UploadsDir = uploads_dir(),
    ok = filelib:ensure_dir(filename:join(UploadsDir, "x")),
    Path = filename:join(UploadsDir, RandomName),
    ok = file:write_file(Path, Data),
    ?LOG_DEBUG("stored upload ~s (~p bytes, ~s)", [RandomName, byte_size(Data), NormalizedType]),
    Json = "{\"url\":\"/uploads/" ++ RandomName ++ "\"}",
    respond(Socket, 200, "OK", "application/json", list_to_binary(Json)).

%% Magic-byte signature check -- the first few bytes of each format are
%% fixed regardless of the rest of the file's content.
matches_signature("image/png", <<137, "PNG", 13, 10, 26, 10, _/binary>>) -> true;
matches_signature("image/png", _) -> false;
matches_signature("image/jpeg", <<255, 216, 255, _/binary>>) -> true;
matches_signature("image/jpeg", _) -> false;
matches_signature("image/gif", <<"GIF87a", _/binary>>) -> true;
matches_signature("image/gif", <<"GIF89a", _/binary>>) -> true;
matches_signature("image/gif", _) -> false;
matches_signature("image/webp", <<"RIFF", _Size:32/little, "WEBP", _/binary>>) -> true;
matches_signature("image/webp", _) -> false;
matches_signature("audio/webm", <<16#1A, 16#45, 16#DF, 16#A3, _/binary>>) -> true;
matches_signature("audio/webm", _) -> false;
matches_signature("audio/ogg", <<"OggS", _/binary>>) -> true;
matches_signature("audio/ogg", _) -> false;
%% ISO base media (mp4/m4a): a 32-bit box size, then the 4-byte box type
%% "ftyp" -- the size varies per file, so only the type tag itself is fixed.
matches_signature("audio/mp4", <<_Size:32, "ftyp", _/binary>>) -> true;
matches_signature("audio/mp4", _) -> false;
matches_signature(_, _) -> false.

extension_for("image/png") -> ".png";
extension_for("image/jpeg") -> ".jpg";
extension_for("image/gif") -> ".gif";
extension_for("image/webp") -> ".webp";
extension_for("audio/webm") -> ".webm";
extension_for("audio/ogg") -> ".ogg";
extension_for("audio/mp4") -> ".m4a".

random_hex(NumBytes) ->
    Bytes = crypto:strong_rand_bytes(NumBytes),
    lists:flatten([io_lib:format("~2.16.0b", [B]) || <<B>> <= Bytes]).

serve_upload(Socket, FilenameStr, Headers) ->
    case is_safe_filename(FilenameStr) of
        false ->
            serve_404(Socket);
        true ->
            Path = filename:join(uploads_dir(), FilenameStr),
            case file:read_file(Path) of
                {ok, Data} ->
                    serve_with_range(Socket, content_type_for_filename(FilenameStr), Data, Headers);
                {error, _} ->
                    serve_404(Socket)
            end
    end,
    gen_tcp:close(Socket).

%% A browser's <audio>/<video> element (preload="metadata" especially)
%% probes media with a byte-Range request, and some browsers refuse to
%% play at all -- surfacing as a bare "Error" state, with the file
%% otherwise downloading fine -- if the server always replies with the
%% whole file instead of honoring it. Only the single-range forms a media
%% element actually sends ("bytes=N-M" / "bytes=N-") are handled; anything
%% else, or no Range header at all, falls back to the original plain 200.
serve_with_range(Socket, ContentType, Data, Headers) ->
    Total = byte_size(Data),
    case maps:find("range", Headers) of
        {ok, "bytes=" ++ RangeSpec} ->
            case parse_byte_range(RangeSpec, Total) of
                {ok, Start, End} ->
                    Chunk = binary:part(Data, Start, End - Start + 1),
                    respond_range(Socket, ContentType, Chunk, Start, End, Total);
                error ->
                    respond(Socket, 200, "OK", ContentType, Data)
            end;
        _ ->
            respond(Socket, 200, "OK", ContentType, Data)
    end.

parse_byte_range(Spec, Total) when Total > 0 ->
    case string:split(Spec, "-") of
        [StartStr, ""] ->
            case string:to_integer(StartStr) of
                {Start, []} when Start >= 0, Start < Total -> {ok, Start, Total - 1};
                _ -> error
            end;
        [StartStr, EndStr] ->
            case {string:to_integer(StartStr), string:to_integer(EndStr)} of
                {{Start, []}, {End, []}} when Start >= 0, End >= Start ->
                    {ok, Start, min(End, Total - 1)};
                _ -> error
            end;
        _ ->
            error
    end;
parse_byte_range(_, _) -> error.

respond_range(Socket, ContentType, Chunk, Start, End, Total) ->
    Head = ["HTTP/1.1 206 Partial Content\r\n",
            "Content-Type: ", ContentType, "\r\n",
            "Content-Range: bytes ", integer_to_list(Start), "-", integer_to_list(End), "/", integer_to_list(Total), "\r\n",
            "Content-Length: ", integer_to_list(byte_size(Chunk)), "\r\n",
            "Accept-Ranges: bytes\r\n",
            "X-Content-Type-Options: nosniff\r\n",
            "Connection: close\r\n\r\n"],
    gen_tcp:send(Socket, [Head, Chunk]).

is_safe_filename(Name) ->
    Name =/= "" andalso
    not lists:member($/, Name) andalso
    not lists:member($\\, Name) andalso
    string:find(Name, "..") =:= nomatch.

content_type_for_filename(Name) ->
    case string:lowercase(filename:extension(Name)) of
        ".png" -> "image/png";
        ".jpg" -> "image/jpeg";
        ".jpeg" -> "image/jpeg";
        ".gif" -> "image/gif";
        ".webp" -> "image/webp";
        ".webm" -> "audio/webm";
        ".ogg" -> "audio/ogg";
        ".m4a" -> "audio/mp4";
        ".json" -> "application/json";
        ".js" -> "application/javascript";
        _ -> "application/octet-stream"
    end.

respond_json_error(Socket, Code, Message) ->
    Json = "{\"error\":\"" ++ json_escape(Message) ++ "\"}",
    respond(Socket, Code, http_reason(Code), "application/json", list_to_binary(Json)).

http_reason(400) -> "Bad Request";
http_reason(413) -> "Payload Too Large";
http_reason(415) -> "Unsupported Media Type";
http_reason(429) -> "Too Many Requests";
http_reason(_) -> "Error".

%% ---- WebSocket handshake ----------------------------------------------

handshake(Socket, Headers) ->
    Key = maps:get("sec-websocket-key", Headers, ""),
    Accept = base64:encode(crypto:hash(sha, Key ++ ?WS_GUID)),
    Resp = ["HTTP/1.1 101 Switching Protocols\r\n",
            "Upgrade: websocket\r\n",
            "Connection: Upgrade\r\n",
            "Sec-WebSocket-Accept: ", Accept, "\r\n\r\n"],
    gen_tcp:send(Socket, Resp),
    inet:setopts(Socket, [{active, once}, {packet, raw}, binary, {nodelay, true}]),
    ws_username_loop(Socket, <<>>).

%% ---- pre-login: first WS text frame is the connect payload -------------
%% {"username": "...", "token": "...", "armSessionId": "..."} -- token and
%% armSessionId are exactly what the frontend already holds after its own
%% ARM Signin (shared/axi-standalone-bridge.js's `session`), forwarded here
%% so a connection requires having actually gone through a real ARM
%% sign-in rather than just claiming any username (the previous behavior).
%%
%% Security note, read before assuming this is more than it is: this is
%% NOT independent cryptographic re-verification of the token. ARMToken is
%% an HMAC-signed JWT (confirmed from the AXput release notes' worked
%% example -- an HS256-family alg), which by construction can't be
%% verified by anyone who doesn't hold ARM's own signing secret -- unlike
%% the RS256 Google/Apple tokens chat_oauth.erl used to check against a
%% public JWKS. There is also no documented "verify this session" ARM
%% endpoint to call instead. What this DOES buy: only someone who
%% completed a real ARM sign-in has a token to present at all (the
%% browser's login overlay blocks the app until Signin succeeds), which is
%% a real improvement over the previous "type any string" model, but it's
%% presence-based trust, not a guarantee the token is still valid this
%% second. The first time this identity is actually used for a real ARM
%% API call (chat_hosts:refresh_department_hosts/1, once a real ADS
%% exists), an auth failure there is the actual validity check.
ws_username_loop(Socket, Buf) ->
    receive
        {tcp, Socket, Data} ->
            handle_username_data(Socket, <<Buf/binary, Data/binary>>);
        {tcp_closed, Socket} -> ok;
        {tcp_error, Socket, _Reason} -> ok
    end.

%% Recurses on Rest instead of handing off to ws_username_loop/ws_loop's
%% blocking receive, so any second (or third...) frame that arrived bundled
%% in the same TCP read is decoded and handled immediately instead of
%% sitting stuck in the buffer until a *later* read finally wakes the
%% process back up. Only "more" (a genuinely incomplete frame) should wait
%% on the network; a fully-buffered frame should never wait on anything.
handle_username_data(Socket, Buf) ->
    case ws_decode(Buf) of
        {ok, 1, Payload, Rest} ->
            case parse_connect_payload(Payload) of
                {ok, Name, Identity} ->
                    complete_registration(Socket, Name, Identity, Rest);
                {error, Reason} ->
                    %% debug, not warning: a rejected handshake is
                    %% expected/normal traffic (a client retrying after a
                    %% typo, a taken username), not something operators
                    %% need paged for. Never logs the raw Payload -- it
                    %% may contain a real ARM token even when malformed.
                    ?LOG_DEBUG("connect handshake rejected: ~s", [Reason]),
                    ws_send_json(Socket, "error", Reason),
                    handle_username_data(Socket, Rest)
            end;
        {ok, 8, _Payload, _Rest} ->
            gen_tcp:close(Socket);
        {ok, 9, Payload, Rest} ->
            gen_tcp:send(Socket, ws_encode(10, Payload)),
            handle_username_data(Socket, Rest);
        {ok, OtherOpcode, _Payload, Rest} ->
            ?LOG_DEBUG("dropped unhandled WS opcode ~p during handshake", [OtherOpcode]),
            handle_username_data(Socket, Rest);
        {error, too_large} ->
            gen_tcp:close(Socket);
        more ->
            inet:setopts(Socket, [{active, once}]),
            ws_username_loop(Socket, Buf)
    end.

parse_connect_payload(Payload) ->
    try json:decode(Payload) of
        #{<<"username">> := UsernameBin, <<"token">> := TokenBin, <<"armSessionId">> := ArmSessionIdBin}
                when is_binary(UsernameBin), is_binary(TokenBin), is_binary(ArmSessionIdBin) ->
            Name = string:trim(unicode:characters_to_list(UsernameBin)),
            Token = binary_to_list(TokenBin),
            ArmSessionId = binary_to_list(ArmSessionIdBin),
            validate_connect_fields(Name, Token, ArmSessionId);
        _ ->
            {error, "Expected {\"username\":..,\"token\":..,\"armSessionId\":..}"}
    catch
        _:_ -> {error, "Expected {\"username\":..,\"token\":..,\"armSessionId\":..}"}
    end.

validate_connect_fields("", _Token, _ArmSessionId) ->
    {error, "Username cannot be empty"};
validate_connect_fields(Name, _Token, _ArmSessionId) when length(Name) > ?MAX_USERNAME_LEN ->
    {error, io_lib:format("Username too long (max ~p chars)", [?MAX_USERNAME_LEN])};
validate_connect_fields(_Name, "", _ArmSessionId) ->
    {error, "Missing ARM token -- sign in before connecting"};
validate_connect_fields(_Name, _Token, "") ->
    {error, "Missing ARM session id -- sign in before connecting"};
validate_connect_fields(Name, Token, ArmSessionId) ->
    {ok, Name, #{token => Token, arm_session_id => ArmSessionId, username => Name}}.

%% Load global history *before* registering: this user isn't in
%% chat_room's recipient map yet at this point, so nothing broadcast from
%% here on can already be both in this snapshot and in a live push racing
%% it in -- closes off a rare duplicate-line-on-login window.
complete_registration(Socket, Name, Identity, Rest) ->
    GlobalHistory = chat_store:load_history("global"),
    case chat_room:register_user(Name, self()) of
        ok ->
            %% Available to any handler in this connection's process via
            %% get(arm_identity) -- e.g. the prompt engine's future
            %% ARM-backed List/Input calls. Not used for anything else in
            %% this module yet besides the opportunistic refresh below.
            put(arm_identity, Identity),
            %% Fire-and-forget: chat_arm:get_list can take up to 15s, and
            %% there's nothing real to fetch yet anyway (CHAT_HOST_ADS_NAME
            %% is unset until the backend dev's chat-host tstruct exists)
            %% -- never worth blocking this connection's handshake on it.
            spawn(fun() -> chat_hosts:refresh_department_hosts(Identity) end),
            ws_send(Socket, json_obj([{"type", "welcome"}, {"name", Name}])),
            send_history_payload(Socket, "global", [], GlobalHistory),
            handle_ws_data(Socket, Name, Rest);
        {error, taken} ->
            ws_send_json(Socket, "error", "Username taken"),
            handle_username_data(Socket, Rest)
    end.

%% ---- post-login loop ---------------------------------------------------

ws_loop(Socket, Name, Buf) ->
    receive
        {tcp, Socket, Data} ->
            handle_ws_data(Socket, Name, <<Buf/binary, Data/binary>>);
        {tcp_closed, Socket} ->
            chat_room:unregister_user(Name);
        {tcp_error, Socket, _Reason} ->
            chat_room:unregister_user(Name);
        {chat_message, Id, Ts, From, Text, ReplyTo} ->
            ws_send_chat(Socket, "chat", Id, Ts, From, Text, ReplyTo),
            ws_loop(Socket, Name, Buf);
        {private_message, Id, Ts, From, Text, ReplyTo} ->
            ws_send_chat(Socket, "private", Id, Ts, From, Text, ReplyTo),
            ws_loop(Socket, Name, Buf);
        {host_message, HostKey, Id, Ts, From, Text, ReplyTo} ->
            ws_send(Socket, json_obj2([
                {"type", {str, "host_message"}}, {"host", {str, HostKey}},
                {"id", {raw, integer_to_list(Id)}}, {"ts", {raw, integer_to_list(Ts)}},
                {"from", {str, From}}, {"text", {str, Text}},
                reply_field(ReplyTo)])),
            ws_loop(Socket, Name, Buf);
        {system, Text} ->
            ws_send_json(Socket, "system", Text),
            ws_loop(Socket, Name, Buf);
        {group_message, GroupName, Id, Ts, From, Text, ReplyTo} ->
            ws_send_group_message(Socket, GroupName, Id, Ts, From, Text, ReplyTo),
            ws_loop(Socket, Name, Buf);
        {group_system, GroupName, Text} ->
            ws_send_group_system(Socket, GroupName, Text),
            ws_loop(Socket, Name, Buf);
        {added_to_group, GroupName, Members, By} ->
            ws_send_added_to_group(Socket, GroupName, Members, By),
            ws_loop(Socket, Name, Buf);
        {typing, From} ->
            ws_send_json(Socket, "typing", From),
            ws_loop(Socket, Name, Buf);
        {typing_dm, From} ->
            ws_send(Socket, json_obj2([{"type", {str, "typing_dm"}}, {"from", {str, From}}])),
            ws_loop(Socket, Name, Buf);
        {group_typing, GroupName, From} ->
            ws_send(Socket, json_obj2([{"type", {str, "group_typing"}}, {"group", {str, GroupName}}, {"from", {str, From}}])),
            ws_loop(Socket, Name, Buf);
        {dm_read, From} ->
            ws_send(Socket, json_obj2([{"type", {str, "dm_read"}}, {"from", {str, From}}])),
            ws_loop(Socket, Name, Buf);
        {reaction, Scope, MessageId, Reactions} ->
            ws_send(Socket, json_obj2([
                {"type", {str, "reaction"}}, {"scope", {str, Scope}},
                {"messageId", {raw, integer_to_list(MessageId)}},
                {"reactions", {raw, reactions_json(Reactions)}}])),
            ws_loop(Socket, Name, Buf);
        {dm_reaction, MessageId, Reactions, UserA, UserB} ->
            ws_send(Socket, json_obj2([
                {"type", {str, "dm_reaction"}},
                {"messageId", {raw, integer_to_list(MessageId)}},
                {"reactions", {raw, reactions_json(Reactions)}},
                {"userA", {str, UserA}}, {"userB", {str, UserB}}])),
            ws_loop(Socket, Name, Buf);
        {profile_update, User, Avatar, Status} ->
            AvatarField = case Avatar of undefined -> {"avatar", {raw, "null"}}; A -> {"avatar", {str, A}} end,
            StatusField = case Status of undefined -> {"status", {raw, "null"}}; S -> {"status", {str, S}} end,
            ws_send(Socket, json_obj2([{"type", {str, "profile"}}, {"user", {str, User}}, AvatarField, StatusField])),
            ws_loop(Socket, Name, Buf);
        {deleted, MessageId} ->
            ws_send(Socket, json_obj2([
                {"type", {str, "deleted"}}, {"scope", {str, "global"}},
                {"messageId", {raw, integer_to_list(MessageId)}}])),
            ws_loop(Socket, Name, Buf);
        {delete_denied, MessageId, Reason} ->
            ws_send(Socket, json_obj2([
                {"type", {str, "delete_denied"}}, {"messageId", {raw, integer_to_list(MessageId)}},
                {"reason", {str, atom_to_list(Reason)}}])),
            ws_loop(Socket, Name, Buf);
        {dm_deleted, MessageId, UserA, UserB} ->
            ws_send(Socket, json_obj2([
                {"type", {str, "dm_deleted"}},
                {"messageId", {raw, integer_to_list(MessageId)}},
                {"userA", {str, UserA}}, {"userB", {str, UserB}}])),
            ws_loop(Socket, Name, Buf);
        {group_deleted, GroupName, MessageId} ->
            ws_send(Socket, json_obj2([
                {"type", {str, "group_deleted"}}, {"group", {str, GroupName}},
                {"messageId", {raw, integer_to_list(MessageId)}}])),
            ws_loop(Socket, Name, Buf);
        {own_message_id, Id, Ts} ->
            ws_send(Socket, json_obj2([
                {"type", {str, "own_message_id"}}, {"id", {raw, integer_to_list(Id)}},
                {"ts", {raw, integer_to_list(Ts)}}])),
            ws_loop(Socket, Name, Buf);
        {group_reaction, GroupName, MessageId, Reactions} ->
            ws_send(Socket, json_obj2([
                {"type", {str, "group_reaction"}}, {"group", {str, GroupName}},
                {"messageId", {raw, integer_to_list(MessageId)}},
                {"reactions", {raw, reactions_json(Reactions)}}])),
            ws_loop(Socket, Name, Buf);
        {link_preview, Scope, MessageId, Preview} ->
            ws_send(Socket, json_obj2(
                [{"type", {str, "link_preview"}}, {"scope", {str, Scope}},
                 {"messageId", {raw, integer_to_list(MessageId)}}]
                ++ preview_fields(Preview))),
            ws_loop(Socket, Name, Buf);
        {dm_link_preview, MessageId, Preview, UserA, UserB} ->
            ws_send(Socket, json_obj2(
                [{"type", {str, "dm_link_preview"}},
                 {"messageId", {raw, integer_to_list(MessageId)}},
                 {"userA", {str, UserA}}, {"userB", {str, UserB}}]
                ++ preview_fields(Preview))),
            ws_loop(Socket, Name, Buf);
        {group_link_preview, GroupName, MessageId, Preview} ->
            ws_send(Socket, json_obj2(
                [{"type", {str, "group_link_preview"}}, {"group", {str, GroupName}},
                 {"messageId", {raw, integer_to_list(MessageId)}}]
                ++ preview_fields(Preview))),
            ws_loop(Socket, Name, Buf);
        {gif, gif_results, Query, Gifs} ->
            ws_send(Socket, json_obj2([
                {"type", {str, "gif_results"}}, {"query", {str, Query}},
                {"results", {raw, gifs_json(Gifs)}}])),
            ws_loop(Socket, Name, Buf);
        {sticker, gif_results, Query, Stickers} ->
            ws_send(Socket, json_obj2([
                {"type", {str, "sticker_results"}}, {"query", {str, Query}},
                {"results", {raw, gifs_json(Stickers)}}])),
            ws_loop(Socket, Name, Buf)
    end.

%% See handle_username_data/2 for why this recurses on Rest rather than
%% going back through ws_loop's blocking receive.
handle_ws_data(Socket, Name, Buf) ->
    case ws_decode(Buf) of
        {ok, 1, Payload, Rest} ->
            case string:trim(binary_to_list(Payload)) of
                "/quit" ->
                    chat_room:unregister_user(Name),
                    gen_tcp:send(Socket, ws_encode(8, <<>>)),
                    gen_tcp:close(Socket);
                Line ->
                    case check_rate_limit() of
                        ok -> handle_line(Socket, Name, Line);
                        limited ->
                            ?LOG_WARNING("~s hit the rate limit", [Name]),
                            ws_send_json(Socket, "error", "Too many commands -- slow down")
                    end,
                    handle_ws_data(Socket, Name, Rest)
            end;
        {ok, 8, _Payload, _Rest} ->
            chat_room:unregister_user(Name),
            gen_tcp:close(Socket);
        {ok, 9, Payload, Rest} ->
            gen_tcp:send(Socket, ws_encode(10, Payload)),
            handle_ws_data(Socket, Name, Rest);
        {ok, OtherOpcode, _Payload, Rest} ->
            ?LOG_DEBUG("~s: dropped unhandled WS opcode ~p", [Name, OtherOpcode]),
            handle_ws_data(Socket, Name, Rest);
        {error, too_large} ->
            chat_room:unregister_user(Name),
            gen_tcp:close(Socket);
        more ->
            inet:setopts(Socket, [{active, once}]),
            ws_loop(Socket, Name, Buf)
    end.

handle_line(_Socket, _Name, "") ->
    ok;
handle_line(Socket, _Name, "/list") ->
    ws_send_users(Socket, chat_room:list_users());
handle_line(Socket, _Name, "/hosts") ->
    ws_send_hosts(Socket, chat_hosts:list_hosts());
%% Department-host messaging -- sits alongside /msg rather than replacing
%% it (see chat_room:send_host_message/3 doc). LLM hosts and "My work
%% space" never reach here: the boss's spec has those handled entirely
%% client-side ("the same experience as today's AXI chat"), so a client
%% should just switch its own view for those rather than calling this.
handle_line(Socket, Name, "/hostmsg " ++ Rest) ->
    case string:split(Rest, " ") of
        [_HostKey, Text] when length(Text) > ?MAX_MESSAGE_LEN ->
            ws_send_json(Socket, "error",
                io_lib:format("Message too long (max ~p chars)", [?MAX_MESSAGE_LEN]));
        [HostKey, Text] when Text =/= "" ->
            case chat_room:send_host_message(Name, HostKey, Text) of
                {ok, Id, Ts} ->
                    ws_send(Socket, json_obj2([
                        {"type", {str, "host_ack"}}, {"host", {str, HostKey}}, {"status", {str, "delivered"}},
                        {"id", {raw, integer_to_list(Id)}}, {"ts", {raw, integer_to_list(Ts)}}]));
                {error, not_found} ->
                    ws_send_json(Socket, "error", "No such host, or it has no one assigned yet: " ++ HostKey)
            end;
        _ ->
            ws_send_json(Socket, "error", "Usage: /hostmsg <hostKey> <message>")
    end;
handle_line(Socket, Name, "/msg " ++ Rest) ->
    case string:split(Rest, " ") of
        [_To, Text] when length(Text) > ?MAX_MESSAGE_LEN ->
            ws_send_json(Socket, "error",
                io_lib:format("Message too long (max ~p chars)", [?MAX_MESSAGE_LEN]));
        [To, Text] when Text =/= "" ->
            case chat_room:send_private(Name, To, Text) of
                {ok, Id, Ts} ->
                    ws_send(Socket, json_obj2([
                        {"type", {str, "dm_ack"}}, {"with", {str, To}}, {"status", {str, "delivered"}},
                        {"id", {raw, integer_to_list(Id)}}, {"ts", {raw, integer_to_list(Ts)}}]));
                {error, not_found} ->
                    ws_send_json(Socket, "error", "No such user: " ++ To)
            end;
        _ ->
            ws_send_json(Socket, "error", "Usage: /msg <username> <message>")
    end;
handle_line(Socket, Name, "/reply " ++ Rest) ->
    case string:split(Rest, " ") of
        [_IdStr, Text] when length(Text) > ?MAX_MESSAGE_LEN ->
            ws_send_json(Socket, "error",
                io_lib:format("Message too long (max ~p chars)", [?MAX_MESSAGE_LEN]));
        [IdStr, Text] when Text =/= "" ->
            case string:to_integer(IdStr) of
                {ReplyTo, []} -> chat_room:broadcast(Name, Text, ReplyTo);
                _ -> ws_send_json(Socket, "error", "Usage: /reply <messageId> <message>")
            end;
        _ ->
            ws_send_json(Socket, "error", "Usage: /reply <messageId> <message>")
    end;
handle_line(Socket, Name, "/replydm " ++ Rest) ->
    case string:split(Rest, " ") of
        [To, Rest2] ->
            case string:split(Rest2, " ") of
                [_IdStr, Text] when length(Text) > ?MAX_MESSAGE_LEN ->
                    ws_send_json(Socket, "error",
                        io_lib:format("Message too long (max ~p chars)", [?MAX_MESSAGE_LEN]));
                [IdStr, Text] when Text =/= "" ->
                    case string:to_integer(IdStr) of
                        {ReplyTo, []} ->
                            case chat_room:send_private(Name, To, Text, ReplyTo) of
                                {ok, Id, Ts} ->
                                    ws_send(Socket, json_obj2([
                                        {"type", {str, "dm_ack"}}, {"with", {str, To}}, {"status", {str, "delivered"}},
                                        {"id", {raw, integer_to_list(Id)}}, {"ts", {raw, integer_to_list(Ts)}}]));
                                {error, not_found} ->
                                    ws_send_json(Socket, "error", "No such user: " ++ To)
                            end;
                        _ -> ws_send_json(Socket, "error", "Usage: /replydm <username> <messageId> <message>")
                    end;
                _ ->
                    ws_send_json(Socket, "error", "Usage: /replydm <username> <messageId> <message>")
            end;
        _ ->
            ws_send_json(Socket, "error", "Usage: /replydm <username> <messageId> <message>")
    end;
handle_line(Socket, Name, "/history " ++ Rest) ->
    case string:split(Rest, " ") of
        ["global"] ->
            send_history_payload(Socket, "global", [], chat_store:load_history("global"));
        ["dm", Other] ->
            Key = chat_store:dm_key(Name, Other),
            send_history_payload(Socket, "dm", [{"with", Other}], chat_store:load_history(Key));
        ["group", GroupName] ->
            Key = "group:" ++ GroupName,
            send_history_payload(Socket, "group", [{"group", GroupName}], chat_store:load_history(Key));
        ["host", HostKey] ->
            Key = chat_room:host_conv_key(HostKey, Name),
            send_history_payload(Socket, "host", [{"host", HostKey}], chat_store:load_history(Key));
        _ ->
            ok
    end;
handle_line(_Socket, Name, "/typing " ++ Rest) ->
    case string:split(Rest, " ") of
        ["global"] -> chat_room:typing(Name);
        ["dm", Other] -> chat_room:typing_dm(Name, Other);
        ["group", GroupName] -> chat_groups:typing(GroupName, Name);
        _ -> ok
    end;
handle_line(_Socket, Name, "/read " ++ Rest) ->
    case string:split(Rest, " ") of
        ["dm", Other] -> chat_room:mark_read(Name, Other);
        _ -> ok
    end;
%% ---- DM end-to-end encryption: public key exchange ----
%% The server only ever stores/relays the public key and (separately)
%% opaque ciphertext -- it never sees a private key or plaintext DM
%% content. Publishing is idempotent (last write wins), same as the web
%% client re-sending "/list" -- a client just re-publishes on every
%% connect, no separate "do I already have one" check needed.
handle_line(_Socket, Name, "/pubkey " ++ Base64Key) when Base64Key =/= "" ->
    chat_store:set_pubkey(Name, Base64Key);
handle_line(Socket, _Name, "/getpubkey " ++ Other) ->
    KeyField = case chat_store:get_pubkey(Other) of
        undefined -> {"key", {raw, "null"}};
        Key -> {"key", {str, Key}}
    end,
    ws_send(Socket, json_obj2([{"type", {str, "pubkey"}}, {"user", {str, Other}}, KeyField]));
%% ---- profile: avatar + status ----
handle_line(_Socket, Name, "/setavatar " ++ Url) ->
    chat_store:set_avatar(Name, Url),
    chat_room:broadcast_profile(Name);
handle_line(_Socket, Name, "/setstatus " ++ Status) ->
    chat_store:set_status(Name, Status),
    chat_room:broadcast_profile(Name);
handle_line(Socket, _Name, "/getprofile " ++ Other) ->
    {Avatar, Status} = chat_store:get_profile(Other),
    AvatarField = case Avatar of undefined -> {"avatar", {raw, "null"}}; A -> {"avatar", {str, A}} end,
    StatusField = case Status of undefined -> {"status", {raw, "null"}}; S -> {"status", {str, S}} end,
    ws_send(Socket, json_obj2([{"type", {str, "profile"}}, {"user", {str, Other}}, AvatarField, StatusField]));
handle_line(_Socket, _Name, "/gifsearch") ->
    %% No query yet -- e.g. the picker was just opened. The trailing-space
    %% variant below can never carry an empty Query itself: handle_ws_data
    %% trims the whole line before it reaches here, so "/gifsearch " (with
    %% nothing after) arrives as this exact bare form instead.
    chat_gif:search_async(gif, "", self());
handle_line(_Socket, _Name, "/gifsearch " ++ Query) ->
    chat_gif:search_async(gif, Query, self());
handle_line(_Socket, _Name, "/stickersearch") ->
    chat_gif:search_async(sticker, "", self());
handle_line(_Socket, _Name, "/stickersearch " ++ Query) ->
    chat_gif:search_async(sticker, Query, self());
handle_line(_Socket, Name, "/react " ++ Rest) ->
    case string:split(Rest, " ", all) of
        ["global", MsgIdStr, Emoji] ->
            with_int(MsgIdStr, fun(Id) -> chat_room:react_global(Id, Name, Emoji) end);
        ["dm", Other, MsgIdStr, Emoji] ->
            with_int(MsgIdStr, fun(Id) -> chat_room:react_dm(Id, Name, Emoji, Other) end);
        ["group", GroupName, MsgIdStr, Emoji] ->
            with_int(MsgIdStr, fun(Id) -> chat_groups:react(GroupName, Id, Name, Emoji) end);
        _ ->
            ok
    end;
handle_line(_Socket, Name, "/delete " ++ Rest) ->
    case string:split(Rest, " ", all) of
        ["global", MsgIdStr] ->
            with_int(MsgIdStr, fun(Id) -> chat_room:delete_global(Id, Name) end);
        ["dm", Other, MsgIdStr] ->
            with_int(MsgIdStr, fun(Id) -> chat_room:delete_dm(Id, Name, Other) end);
        ["group", GroupName, MsgIdStr] ->
            with_int(MsgIdStr, fun(Id) -> chat_groups:delete(GroupName, Id, Name) end);
        _ ->
            ok
    end;
handle_line(Socket, Name, "/creategroup " ++ Rest) ->
    case string:trim(Rest) of
        "" ->
            ws_send_json(Socket, "error", "Usage: /creategroup <name>");
        GroupName when length(GroupName) > ?MAX_GROUP_NAME_LEN ->
            ws_send_json(Socket, "error",
                io_lib:format("Group name too long (max ~p chars)", [?MAX_GROUP_NAME_LEN]));
        GroupName ->
            case chat_groups:create_group(GroupName, Name) of
                {ok, Members} -> ws_send_group_created(Socket, GroupName, Members);
                {error, exists} -> ws_send_json(Socket, "error", "A group with that name already exists")
            end
    end;
handle_line(Socket, Name, "/addmember " ++ Rest) ->
    case string:split(Rest, " ") of
        [GroupName, NewMember] when NewMember =/= "" ->
            case chat_groups:add_member(GroupName, Name, NewMember) of
                {ok, Members} -> ws_send_group_created(Socket, GroupName, Members);
                {error, not_found} -> ws_send_json(Socket, "error", "No such group: " ++ GroupName);
                {error, not_member} -> ws_send_json(Socket, "error", "You're not in that group");
                {error, already_member} -> ws_send_json(Socket, "error", NewMember ++ " is already in the group");
                {error, user_offline} -> ws_send_json(Socket, "error", NewMember ++ " isn't online right now")
            end;
        _ ->
            ws_send_json(Socket, "error", "Usage: /addmember <group> <username>")
    end;
handle_line(Socket, Name, "/leavegroup " ++ Rest) ->
    GroupName = string:trim(Rest),
    case chat_groups:leave_group(GroupName, Name) of
        ok -> ws_send_json(Socket, "left_group", GroupName);
        {error, not_found} -> ws_send_json(Socket, "error", "No such group: " ++ GroupName);
        {error, not_member} -> ws_send_json(Socket, "error", "You're not in that group")
    end;
handle_line(Socket, Name, "/groupmsg " ++ Rest) ->
    case string:split(Rest, " ") of
        [_GroupName, Text] when length(Text) > ?MAX_MESSAGE_LEN ->
            ws_send_json(Socket, "error",
                io_lib:format("Message too long (max ~p chars)", [?MAX_MESSAGE_LEN]));
        [GroupName, Text] when Text =/= "" ->
            case chat_groups:group_message(GroupName, Name, Text) of
                {ok, Id, Ts} ->
                    ws_send(Socket, json_obj2([
                        {"type", {str, "group_msg_ack"}}, {"group", {str, GroupName}},
                        {"id", {raw, integer_to_list(Id)}}, {"ts", {raw, integer_to_list(Ts)}}]));
                {error, not_found} -> ws_send_json(Socket, "error", "No such group: " ++ GroupName);
                {error, not_member} -> ws_send_json(Socket, "error", "You're not in that group")
            end;
        _ ->
            ws_send_json(Socket, "error", "Usage: /groupmsg <group> <message>")
    end;
handle_line(Socket, Name, "/replygroup " ++ Rest) ->
    case string:split(Rest, " ") of
        [GroupName, Rest2] ->
            case string:split(Rest2, " ") of
                [_IdStr, Text] when length(Text) > ?MAX_MESSAGE_LEN ->
                    ws_send_json(Socket, "error",
                        io_lib:format("Message too long (max ~p chars)", [?MAX_MESSAGE_LEN]));
                [IdStr, Text] when Text =/= "" ->
                    case string:to_integer(IdStr) of
                        {ReplyTo, []} ->
                            case chat_groups:group_message(GroupName, Name, Text, ReplyTo) of
                                {ok, Id, Ts} ->
                                    ws_send(Socket, json_obj2([
                                        {"type", {str, "group_msg_ack"}}, {"group", {str, GroupName}},
                                        {"id", {raw, integer_to_list(Id)}}, {"ts", {raw, integer_to_list(Ts)}}]));
                                {error, not_found} -> ws_send_json(Socket, "error", "No such group: " ++ GroupName);
                                {error, not_member} -> ws_send_json(Socket, "error", "You're not in that group")
                            end;
                        _ -> ws_send_json(Socket, "error", "Usage: /replygroup <group> <messageId> <message>")
                    end;
                _ ->
                    ws_send_json(Socket, "error", "Usage: /replygroup <group> <messageId> <message>")
            end;
        _ ->
            ws_send_json(Socket, "error", "Usage: /replygroup <group> <messageId> <message>")
    end;
handle_line(Socket, Name, "/groups") ->
    ws_send_groups(Socket, chat_groups:list_groups_for(Name));
handle_line(Socket, _Name, Text) when length(Text) > ?MAX_MESSAGE_LEN ->
    ws_send_json(Socket, "error",
        io_lib:format("Message too long (max ~p chars)", [?MAX_MESSAGE_LEN]));
%% Safety net: a bare command name with no argument (e.g. "/getprofile"
%% with no trailing " <user>") doesn't match that command's own clause
%% above (which requires the space), so without this it falls all the way
%% through to the plain-broadcast catch-all below and gets sent to the
%% whole room as literal chat text -- confirmed live, this is exactly
%% what was showing up as spurious "/getprofile" messages. Swallow any
%% of these known command names on their own rather than broadcasting
%% them; this doesn't affect ordinary chat text, which never happens to
%% exactly equal one of these.
handle_line(_Socket, _Name, Text) when
    Text =:= "/msg"; Text =:= "/reply"; Text =:= "/replydm"; Text =:= "/history";
    Text =:= "/typing"; Text =:= "/read"; Text =:= "/pubkey"; Text =:= "/getpubkey";
    Text =:= "/setavatar"; Text =:= "/setstatus"; Text =:= "/getprofile";
    Text =:= "/react"; Text =:= "/delete"; Text =:= "/creategroup";
    Text =:= "/addmember"; Text =:= "/leavegroup"; Text =:= "/groupmsg";
    Text =:= "/replygroup"; Text =:= "/hostmsg" ->
    ok;
handle_line(_Socket, Name, Text) ->
    chat_room:broadcast(Name, Text).

%% ---- WebSocket framing (RFC 6455) --------------------------------------

ws_encode(Opcode, Payload) ->
    Len = byte_size(Payload),
    Header = if
        Len =< 125 -> <<1:1, 0:3, Opcode:4, 0:1, Len:7>>;
        Len =< 65535 -> <<1:1, 0:3, Opcode:4, 0:1, 126:7, Len:16>>;
        true -> <<1:1, 0:3, Opcode:4, 0:1, 127:7, Len:64>>
    end,
    <<Header/binary, Payload/binary>>.

ws_decode(Bin) ->
    case Bin of
        <<_Fin:1, _Rsv:3, Opcode:4, Mask:1, Len7:7, Rest/binary>> ->
            decode_len(Opcode, Mask, Len7, Rest);
        _ ->
            more
    end.

decode_len(Opcode, Mask, 126, Rest) ->
    case Rest of
        <<Len:16, Rest2/binary>> -> check_len(Opcode, Mask, Len, Rest2);
        _ -> more
    end;
decode_len(Opcode, Mask, 127, Rest) ->
    case Rest of
        <<Len:64, Rest2/binary>> -> check_len(Opcode, Mask, Len, Rest2);
        _ -> more
    end;
decode_len(Opcode, Mask, Len7, Rest) ->
    check_len(Opcode, Mask, Len7, Rest).

%% Reject an oversized declared length immediately rather than buffering
%% while we wait for a body that may never fully arrive (or would, if it
%% did, be a multi-gigabyte allocation) — see ?MAX_WS_FRAME_LEN.
check_len(_Opcode, _Mask, Len, _Rest) when Len > ?MAX_WS_FRAME_LEN ->
    {error, too_large};
check_len(Opcode, Mask, Len, Rest) ->
    decode_mask(Opcode, Mask, Len, Rest).

decode_mask(Opcode, 1, Len, Rest) when byte_size(Rest) >= 4 ->
    <<MaskKey:4/binary, Body/binary>> = Rest,
    case byte_size(Body) >= Len of
        true ->
            <<Payload:Len/binary, Leftover/binary>> = Body,
            {ok, Opcode, unmask(Payload, MaskKey), Leftover};
        false ->
            more
    end;
decode_mask(_Opcode, 1, _Len, _Rest) ->
    more;
decode_mask(Opcode, 0, Len, Rest) when byte_size(Rest) >= Len ->
    <<Payload:Len/binary, Leftover/binary>> = Rest,
    {ok, Opcode, Payload, Leftover};
decode_mask(_Opcode, 0, _Len, _Rest) ->
    more.

unmask(Payload, MaskKey) ->
    Keys = list_to_tuple(binary_to_list(MaskKey)),
    list_to_binary(unmask_bytes(binary_to_list(Payload), Keys, 0)).

unmask_bytes([], _Keys, _I) -> [];
unmask_bytes([B | Rest], Keys, I) ->
    K = element((I rem 4) + 1, Keys),
    [B bxor K | unmask_bytes(Rest, Keys, I + 1)].

%% ---- tiny JSON encoding (no external deps) -----------------------------

ws_send(Socket, Json) ->
    gen_tcp:send(Socket, ws_encode(1, list_to_binary(Json))).

ws_send_json(Socket, Type, Text) ->
    ws_send(Socket, json_obj([{"type", Type}, {"text", lists:flatten(Text)}])).

ws_send_chat(Socket, Type, Id, Ts, From, Text, ReplyTo) ->
    ws_send(Socket, json_obj2([
        {"type", {str, Type}}, {"id", {raw, integer_to_list(Id)}}, {"ts", {raw, integer_to_list(Ts)}},
        {"from", {str, From}}, {"text", {str, Text}}, reply_field(ReplyTo)])).

ws_send_users(Socket, Users) ->
    ws_send(Socket, json_obj2([{"type", {str, "users"}}, {"list", {raw, json_string_array(Users)}}])).

%% Hosts is a list of #{key, name, kind} maps from chat_hosts:list_hosts/0.
ws_send_hosts(Socket, Hosts) ->
    Items = [json_obj2([{"key", {str, Key}}, {"name", {str, HostName}}, {"kind", {str, Kind}}])
             || #{key := Key, name := HostName, kind := Kind} <- Hosts],
    ws_send(Socket, json_obj2([
        {"type", {str, "hosts"}},
        {"list", {raw, "[" ++ string:join(Items, ",") ++ "]"}}])).

ws_send_group_created(Socket, GroupName, Members) ->
    ws_send(Socket, json_obj2([
        {"type", {str, "group_created"}},
        {"name", {str, GroupName}},
        {"members", {raw, json_string_array(Members)}}])).

ws_send_group_message(Socket, GroupName, Id, Ts, From, Text, ReplyTo) ->
    ws_send(Socket, json_obj2([
        {"type", {str, "group_message"}},
        {"group", {str, GroupName}},
        {"id", {raw, integer_to_list(Id)}},
        {"ts", {raw, integer_to_list(Ts)}},
        {"from", {str, From}},
        {"text", {str, Text}},
        reply_field(ReplyTo)])).

ws_send_group_system(Socket, GroupName, Text) ->
    ws_send(Socket, json_obj2([
        {"type", {str, "group_system"}},
        {"group", {str, GroupName}},
        {"text", {str, Text}}])).

ws_send_added_to_group(Socket, GroupName, Members, By) ->
    ws_send(Socket, json_obj2([
        {"type", {str, "added_to_group"}},
        {"name", {str, GroupName}},
        {"members", {raw, json_string_array(Members)}},
        {"by", {str, By}}])).

ws_send_groups(Socket, Groups) ->
    Items = [json_obj2([{"name", {str, Name}}, {"members", {raw, json_string_array(Members)}}])
             || {Name, Members} <- Groups],
    ws_send(Socket, json_obj2([
        {"type", {str, "groups"}},
        {"list", {raw, "[" ++ string:join(Items, ",") ++ "]"}}])).

%% Scope is "global" | "dm" | "group" | "host"; ExtraFields identify which
%% conversation (e.g. [{"with", Username}] for a dm, [{"group", Name}] for
%% a group, [{"host", HostKey}] for a host -- [] for global); Items are
%% {Id, Ts, From, Text, Private, Reactions, Preview, ReplyTo, Deleted}
%% tuples from chat_store:load_history/1 (Preview/ReplyTo are [] if none).
%% Ts (epoch milliseconds) is what lets the client render "Date & time"
%% and group threads by month, per the boss's spec.
send_history_payload(Socket, Scope, ExtraFields, Items) ->
    ItemsJson = [json_obj2(
        [{"id", {raw, integer_to_list(Id)}}, {"ts", {raw, integer_to_list(Ts)}},
         {"from", {str, From}}, {"text", {str, Text}},
         {"private", {raw, bool_str(Private)}}, {"reactions", {raw, reactions_json(Reactions)}},
         {"deleted", {raw, bool_str(Deleted)}},
         reply_field(ReplyTo)]
        ++ preview_fields(Preview))
                 || {Id, Ts, From, Text, Private, Reactions, Preview, ReplyTo, Deleted} <- Items],
    ListJson = "[" ++ string:join(ItemsJson, ",") ++ "]",
    Fields = [{"type", {str, "history"}}, {"scope", {str, Scope}}] ++
             [{K, {str, V}} || {K, V} <- ExtraFields] ++
             [{"list", {raw, ListJson}}],
    ws_send(Socket, json_obj2(Fields)).

bool_str(true) -> "true";
bool_str(false) -> "false".

reactions_json(Reactions) ->
    Items = [json_obj2([{"user", {str, U}}, {"emoji", {str, E}}]) || {U, E} <- Reactions],
    "[" ++ string:join(Items, ",") ++ "]".

gifs_json(Gifs) ->
    Items = [json_obj2([
        {"id", {str, Id}}, {"url", {str, Url}}, {"preview", {str, Preview}},
        {"width", {str, Width}}, {"height", {str, Height}}])
             || {Id, Url, Preview, Width, Height} <- Gifs],
    "[" ++ string:join(Items, ",") ++ "]".

%% Preview is [] (none) or {Title, Description, Image}, each of which is
%% itself `undefined` or a string -- returns a list of {K, {str, V}} pairs
%% ready to splice into a json_obj2 field list. Always emits all four keys
%% (empty string for missing ones) so the client doesn't need to branch on
%% whether they're present. Used identically for a live push and a history
%% item, so both shapes go through this same function.
preview_fields([]) ->
    [{"previewUrl", {str, ""}}, {"previewTitle", {str, ""}},
     {"previewDescription", {str, ""}}, {"previewImage", {str, ""}}];
preview_fields({Url, Title, Description, Image}) ->
    [{"previewUrl", {str, default_str(Url)}},
     {"previewTitle", {str, default_str(Title)}},
     {"previewDescription", {str, default_str(Description)}},
     {"previewImage", {str, default_str(Image)}}].

default_str(undefined) -> "";
default_str(V) -> V.

%% ReplyTo is [] (not a reply) or a message id -- emitted as JSON null or a
%% raw integer so the client can tell "no reply" apart from "reply to
%% message 0" without a sentinel value collision.
reply_field([]) -> {"replyTo", {raw, "null"}};
reply_field(ReplyTo) -> {"replyTo", {raw, integer_to_list(ReplyTo)}}.

%% Parses Str as a plain integer (no leading/trailing junk) and calls Fun
%% with it; silently does nothing on a malformed id rather than crashing
%% the connection on attacker-controlled input.
with_int(Str, Fun) ->
    case string:to_integer(Str) of
        {Int, []} -> Fun(Int);
        _ -> ok
    end.

%% Sliding-window rate limit, ?RATE_LIMIT_MAX_COMMANDS per
%% ?RATE_LIMIT_WINDOW_MS (see chat.hrl), per connection. State lives in
%% this connection process's own dictionary -- each WS connection is
%% already its own Erlang process, so there's no cross-connection
%% contention to worry about, and nothing else in this process uses the
%% dictionary for anything that could collide with this key.
check_rate_limit() ->
    Now = erlang:monotonic_time(millisecond),
    case get(rate_limit) of
        undefined ->
            put(rate_limit, {1, Now}),
            ok;
        {_Count, WindowStart} when Now - WindowStart > ?RATE_LIMIT_WINDOW_MS ->
            put(rate_limit, {1, Now}),
            ok;
        {Count, WindowStart} when Count < ?RATE_LIMIT_MAX_COMMANDS ->
            put(rate_limit, {Count + 1, WindowStart}),
            ok;
        {_Count, _WindowStart} ->
            limited
    end.

json_obj(Pairs) ->
    Body = string:join(
        ["\"" ++ K ++ "\":\"" ++ json_escape(V) ++ "\"" || {K, V} <- Pairs], ","),
    "{" ++ Body ++ "}".

%% General-purpose JSON object builder: each field is either a plain
%% string value ({str, V}, quoted+escaped) or a pre-built JSON fragment
%% ({raw, V}, embedded verbatim -- e.g. an array from json_string_array/1).
json_obj2(Pairs) ->
    "{" ++ string:join([json_field(P) || P <- Pairs], ",") ++ "}".

json_field({K, {str, V}}) ->
    "\"" ++ K ++ "\":\"" ++ json_escape(lists:flatten(V)) ++ "\"";
json_field({K, {raw, V}}) ->
    "\"" ++ K ++ "\":" ++ V.

json_string_array(List) ->
    "[" ++ string:join(["\"" ++ json_escape(X) ++ "\"" || X <- List], ",") ++ "]".

json_escape(Str) ->
    lists:flatten([escape_char(C) || C <- Str]).

escape_char($") -> "\\\"";
escape_char($\\) -> "\\\\";
escape_char($\n) -> "\\n";
escape_char($\r) -> "\\r";
escape_char($\t) -> "\\t";
escape_char(C) when C < 32 -> io_lib:format("\\u~4.16.0B", [C]);
escape_char(C) -> [C].
