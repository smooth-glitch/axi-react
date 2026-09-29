%%% Files for the "upload" / "download" options (docs/LITE_TSTRUCT.md, options).
%%%
%%% Bytes live on disk under a server-generated id (never a client-supplied path),
%%% metadata in the Redis hash sd:files, and a per-user sorted set (sd:files:u:<user>)
%%% lists what each person uploaded.
%%%
%%% Who may read a file: whoever uploaded it, an administrator, or anyone an active
%%% download option pointing at it applies to (sd_config:option_targets_file/2). Who
%%% may attach a file to a download option: only its uploader (sd_config:check_target/3).
-module(sd_files).
-export([get/1, list_for/1, store/4, read/2, max_bytes/0, dir/0, valid_id/1]).

-compile({no_auto_import, [get/1]}).

-define(FILES, "sd:files").
%% 10 MB matches the VM's nginx client_max_body_size; raise both together (SANDESH_MAX_FILE_MB).
-define(DEFAULT_MAX_MB, 10).

max_bytes() ->
    Mb = case os:getenv("SANDESH_MAX_FILE_MB") of
             false -> ?DEFAULT_MAX_MB;
             S -> case string:to_integer(S) of {N, []} when N > 0 -> N; _ -> ?DEFAULT_MAX_MB end
         end,
    Mb * 1024 * 1024.

%% SANDESH_FILES_DIR overrides; by default next to the chat uploads directory.
dir() ->
    case os:getenv("SANDESH_FILES_DIR") of
        false ->
            Ebin = filename:dirname(code:which(?MODULE)),
            filename:join([filename:dirname(Ebin), "uploads", "sd-files"]);
        D -> D
    end.

%% Ids are 24 lowercase hex characters -- anything else can't be one of ours.
valid_id(Id) when is_binary(Id) ->
    byte_size(Id) =:= 24 andalso re:run(Id, "^[0-9a-f]{24}$", [{capture, none}]) =:= match;
valid_id(_) -> false.

get(Id) ->
    case valid_id(Id) of
        true -> sd_db:hget_json(?FILES, binary_to_list(Id));
        false -> undefined
    end.

list_for(User) ->
    Name = sd_util:s(maps:get(<<"username">>, User)),
    Ids = sd_db:zrevrange("sd:files:u:" ++ Name, 0, 99),
    [M || Id <- Ids, M <- [get(Id)], is_map(M)].

%% -> {ok, Meta}. Caller has already enforced the size limit.
store(User, Name0, Mime0, Bin) when is_binary(Bin) ->
    Id = binary:encode_hex(crypto:strong_rand_bytes(12), lowercase),
    Path = filename:join(dir(), binary_to_list(Id)),
    ok = filelib:ensure_dir(Path),
    case file:write_file(Path, Bin) of
        ok ->
            Username = maps:get(<<"username">>, User),
            Now = sd_util:now_ms(),
            Meta = #{<<"id">> => Id, <<"name">> => clean_name(Name0), <<"mime">> => clean_mime(Mime0),
                     <<"size">> => byte_size(Bin), <<"by">> => Username, <<"ts">> => Now},
            sd_db:hset_json(?FILES, binary_to_list(Id), Meta),
            sd_db:zadd("sd:files:u:" ++ sd_util:s(Username), Now, Id),
            {ok, Meta};
        {error, Reason} ->
            {error, internal, iolist_to_binary(io_lib:format("Couldn't store the file (~p).", [Reason]))}
    end.

%% -> {ok, Meta, Bin} | {error, Code, Msg}
read(User, Id) ->
    case get(Id) of
        undefined -> {error, not_found, <<"No such file.">>};
        Meta ->
            Allowed = maps:get(<<"by">>, Meta) =:= maps:get(<<"username">>, User)
                orelse sd_users:is_admin(User)
                orelse sd_config:option_targets_file(Id, User),
            case Allowed of
                false -> {error, forbidden, <<"That file isn't available to you.">>};
                true ->
                    case file:read_file(filename:join(dir(), binary_to_list(Id))) of
                        {ok, Bin} -> {ok, Meta, Bin};
                        {error, _} -> {error, not_found, <<"That file is no longer stored.">>}
                    end
            end
    end.

%% Display name only: no path separators or control characters, bounded length.
clean_name(N) when is_binary(N) ->
    Base = lists:last(binary:split(N, [<<"/">>, <<"\\">>], [global])),
    Cleaned = << <<C>> || <<C>> <= Base, C >= 32, C =/= 127, C =/= $" >>,
    case string:trim(Cleaned) of
        <<>> -> <<"file">>;
        T -> binary:part(T, 0, min(200, byte_size(T)))
    end;
clean_name(_) -> <<"file">>.

clean_mime(M0) when is_binary(M0), byte_size(M0) =< 200 ->
    %% keep "type/subtype"; drop parameters such as "; charset=utf-8" (and anything odd)
    [M | _] = binary:split(M0, <<";">>),
    Trimmed = string:trim(M),
    case re:run(Trimmed, "^[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+$", [{capture, none}]) of
        match -> Trimmed;
        nomatch -> <<"application/octet-stream">>
    end;
clean_mime(_) -> <<"application/octet-stream">>.
