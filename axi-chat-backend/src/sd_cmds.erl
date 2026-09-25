%%% The WebSocket side of Sandesh: one command, `/sd <action> [json]`.
%%%
%%%   /sd me
%%%   /sd assoc.invite {"to":"bob","reqId":7}
%%%
%%% Every reply is the same envelope, so a frontend needs one handler:
%%%   {"type":"sd","action":"assoc.invite","reqId":7,"ok":true,"data":{...}}
%%%   {"type":"sd","action":"assoc.invite","reqId":7,"ok":false,
%%%    "error":{"code":"not_found","message":"No such user.","details":{...}}}
%%% `reqId` (any JSON value, optional) is echoed back untouched so replies
%%% can be matched to requests. `error.code` is a stable machine-readable
%%% string (branch on it, show `message` to people).
%%%
%%% Live pushes use a different envelope:
%%%   {"type":"sd_event","event":"request_created"|"request_resolved"|"card","data":{...}}
%%%
%%% Who may call what (level in access/1): none = anyone connected, user =
%%% a signed-in Sandesh user, host = a host or admin, manage = admin or a user
%%% allowed to activate/deactivate users, admin = administrators (plus the
%%% console unlock in strict mode). A connection only counts as "signed in"
%%% if its handshake token was a valid Sandesh session for that username --
%%% a bare chat connection with an invented token never gets Sandesh powers,
%%% even in open mode.
-module(sd_cmds).
-export([handle/2, rate_limited/1, caller/0, availability/2]).
-include_lib("kernel/include/logger.hrl").

%% For the #command catalog (chat_cmds): who is this connection, and may they
%% call an action? Advisory only -- it lets the UI grey out commands; run/3
%% still enforces every rule when the command is actually executed.
caller() -> ctx().

%% available | signin | host | manage | admin (the level the caller lacks).
%% Ignores the strict-mode admin-console unlock and the forced password change:
%% those surface as their own error codes when the command runs.
availability(Action, Ctx) ->
    case access(Action) of
        unknown -> signin;
        none -> available;
        Level ->
            case maps:get(user, Ctx) of
                undefined -> signin;
                User ->
                    IsAdmin = sd_users:is_admin(User),
                    Ok = case Level of
                             user -> true;
                             host -> IsAdmin orelse sd_users:is_host(User);
                             manage -> IsAdmin orelse maps:get(<<"canManageUsers">>, User, false) =:= true;
                             admin -> IsAdmin
                         end,
                    case Ok of true -> available; false -> Level end
            end
    end.

%% The per-connection command limiter (chat_web) refused this line. A plain
%% "error" event would leave a client that is awaiting the reply to its
%% `reqId` hanging forever, so answer in the normal /sd envelope instead --
%% same action, same reqId, ok:false, code "rate_limited".
rate_limited(Line) ->
    Bin = list_to_binary(Line),
    Tail = string:trim(binary:part(Bin, 3, byte_size(Bin) - 3)),   %% drop "/sd"
    {Action, Body} = case binary:split(Tail, <<" ">>) of
                         [A] -> {A, <<>>};
                         [A, B] -> {A, string:trim(B)}
                     end,
    ReqId = case parse_args(Body) of
                {ok, Args} -> maps:get(<<"reqId">>, Args, null);
                error -> null
            end,
    reply(Action, ReqId, {error, rate_limited, <<"Too many commands -- slow down and retry.">>}).

%% Rest is what follows "/sd " -- a byte string ("action" or "action {json}").
%% Returns the reply as a JSON binary, ready to send as one text frame.
handle(_Name, Rest) ->
    Bin = string:trim(list_to_binary(Rest)),
    {Action, Body} = case binary:split(Bin, <<" ">>) of
                         [A] -> {A, <<>>};
                         [A, B] -> {A, string:trim(B)}
                     end,
    case parse_args(Body) of
        {ok, Args} ->
            ReqId = maps:get(<<"reqId">>, Args, null),
            Result = try run(Action, Args, ctx())
                     catch Class:Reason:Stack ->
                         ?LOG_ERROR("sd_cmds ~s crashed: ~p:~p~n~p", [Action, Class, Reason, Stack]),
                         {error, internal, <<"Something went wrong on the server.">>}
                     end,
            log_result(Action, Result),
            reply(Action, ReqId, Result);
        error ->
            reply(Action, null, {error, bad_json, <<"The argument after the action must be a JSON object.">>})
    end.

parse_args(<<>>) -> {ok, #{}};
parse_args(Body) ->
    case sd_util:jdec(Body) of
        {ok, M} when is_map(M) -> {ok, M};
        _ -> error
    end.

%% Never logs arguments (they may hold credentials) -- action and outcome only.
log_result(Action, {ok, _}) -> ?LOG_DEBUG("sd ~s ok", [Action]);
log_result(Action, {error, Code, _}) -> ?LOG_DEBUG("sd ~s -> ~p", [Action, Code]);
log_result(Action, {error, Code, _, _}) -> ?LOG_DEBUG("sd ~s -> ~p", [Action, Code]).

reply(Action, ReqId, {ok, Data}) ->
    sd_util:jenc(#{<<"type">> => <<"sd">>, <<"action">> => Action, <<"reqId">> => ReqId,
                   <<"ok">> => true, <<"data">> => Data});
reply(Action, ReqId, {error, Code, Msg}) ->
    err(Action, ReqId, Code, Msg, null);
reply(Action, ReqId, {error, Code, Msg, Details}) ->
    err(Action, ReqId, Code, Msg, Details).

err(Action, ReqId, Code, Msg, Details) ->
    E0 = #{<<"code">> => atom_to_binary(Code, utf8), <<"message">> => Msg},
    E = case Details of null -> E0; _ -> E0#{<<"details">> => Details} end,
    sd_util:jenc(#{<<"type">> => <<"sd">>, <<"action">> => Action, <<"reqId">> => ReqId,
                   <<"ok">> => false, <<"error">> => E}).

%% ---- who is calling ----------------------------------------------------------------------------

ctx() ->
    case get(sd_session) of
        #{token := Token, username := Username} ->
            %% The two-week login: once the session is gone, this connection
            %% is no longer a signed-in Sandesh user, whatever it was at connect.
            case sd_auth:session_alive(Token) of
                false -> #{token => Token, user => undefined, expired => true};
                true ->
                    case sd_users:get(Username) of
                        #{<<"status">> := <<"active">>} = User -> #{token => Token, user => User};
                        _ -> #{token => Token, user => undefined, inactive => true}
                    end
            end;
        _ -> #{token => undefined, user => undefined}
    end.

%% ---- access ----------------------------------------------------------------------------------------

access(<<"me">>) -> none;
access(<<"admin.", _/binary>> = A) when A =:= <<"admin.unlock.start">>; A =:= <<"admin.unlock">> -> user;
access(<<"admin.user.status">>) -> manage;
access(<<"admin.", _/binary>>) -> admin;
access(A) when A =:= <<"users.invite">>; A =:= <<"host.users">> -> host;
access(A) ->
    case lists:member(A, user_actions()) of
        true -> user;
        false -> unknown
    end.

user_actions() ->
    [<<"assoc.list">>, <<"assoc.invite">>, <<"assoc.remove">>, <<"users.search">>,
     <<"req.list">>, <<"req.respond">>, <<"host.transfer">>,
     <<"cards.list">>, <<"cards.dismiss">>, <<"sections.list">>, <<"sections.save">>,
     <<"sections.delete">>, <<"reminder.add">>,
     <<"notifications.summary">>, <<"notifications.list">>, <<"notifications.read">>,
     <<"options.list">>, <<"tstruct.get">>, <<"tstruct.submit">>, <<"submissions.list">>].

run(Action, Args, Ctx) ->
    Level = access(Action),
    case Level of
        unknown -> {error, unknown_action, <<"Unknown sd action: ", Action/binary>>};
        none -> do(Action, Args, Ctx);
        _ ->
            case require(Level, Ctx) of
                ok -> do(Action, Args, Ctx);
                {error, _, _} = E -> E
            end
    end.

require(Level, Ctx) ->
    case maps:get(user, Ctx) of
        undefined ->
            case {maps:get(expired, Ctx, false), maps:get(inactive, Ctx, false)} of
                {true, _} -> {error, session_expired,
                              <<"Your two-week session has ended. Sign in again.">>};
                {_, true} -> {error, account_inactive, <<"This account is deactivated.">>};
                _ -> {error, unauthenticated,
                      <<"Sign in to Sandesh (POST /api/sd/login) and connect with the returned token.">>}
            end;
        User -> require_level(Level, User, Ctx)
    end.

require_level(Level, User, Ctx) ->
    case must_change(User) of
        true when Level =/= user -> {error, password_change_required, <<"Change your password first.">>};
        true -> {error, password_change_required, <<"Change your password first.">>};
        false ->
            IsAdmin = sd_users:is_admin(User),
            case Level of
                user -> ok;
                host ->
                    case sd_users:is_host(User) orelse IsAdmin of
                        true -> ok;
                        false -> {error, forbidden, <<"Hosts and administrators only.">>}
                    end;
                manage ->
                    case IsAdmin orelse maps:get(<<"canManageUsers">>, User, false) =:= true of
                        false -> {error, forbidden, <<"You can't manage users.">>};
                        true when IsAdmin -> sd_policy:admin_gate(maps:get(token, Ctx));
                        true -> ok
                    end;
                admin ->
                    case IsAdmin of
                        true -> sd_policy:admin_gate(maps:get(token, Ctx));
                        false -> {error, forbidden, <<"Administrators only.">>}
                    end
            end
    end.

%% Enforced only in strict mode; in open mode the flag is informational.
must_change(User) ->
    sd_util:strict() andalso
        maps:get(<<"mustChange">>, sd_auth:password_state(maps:get(<<"username">>, User))).

%% ---- actions ------------------------------------------------------------------------------------------

do(<<"me">>, _Args, #{user := undefined} = Ctx) ->
    {ok, #{<<"authenticated">> => false, <<"mode">> => mode(),
           <<"sessionExpired">> => maps:get(expired, Ctx, false)}};
do(<<"me">>, _Args, #{user := User, token := Token}) ->
    Name = maps:get(<<"username">>, User),
    {ok, #{<<"authenticated">> => true, <<"mode">> => mode(), <<"user">> => User,
           <<"org">> => maps:get(<<"name">>, sd_org:info()),
           <<"sessionExpiresTs">> => sd_auth:session_expires(Token),
           <<"notifications">> => sd_cards:summary(Name),
           <<"permissions">> => #{<<"isAdmin">> => sd_users:is_admin(User),
                                  <<"isHost">> => sd_users:is_host(User),
                                  <<"canManageUsers">> => maps:get(<<"canManageUsers">>, User, false) =:= true},
           <<"pendingRequests">> => sd_reqs:pending_count(Name),
           <<"password">> => sd_auth:password_state(Name),
           <<"otpDue">> => not sd_auth:otp_fresh(User),
           <<"adminUnlocked">> => sd_auth:admin_unlocked(Token)}};

%% ---- associations -----------------------------------------------------------------------------------------
do(<<"assoc.list">>, _Args, #{user := User}) ->
    Online = [sd_util:norm_user(N) || N <- chat_room:list_users()],
    Rows = [#{<<"user">> => sd_users:public(P), <<"relation">> => Rel,
              <<"online">> => lists:member(Peer, Online)}
            || {Peer, Rel} <- sd_users:assoc_list(maps:get(<<"username">>, User)),
               P <- [sd_users:get(Peer)], P =/= undefined, sd_users:is_active(P)],
    {ok, #{<<"associates">> => Rows}};
do(<<"assoc.invite">>, Args, #{user := User}) ->
    %% `to` may be a username, email or mobile number.
    with_bin(<<"to">>, Args, fun(To) ->
        case sd_users:find(To) of
            undefined -> {error, not_found, <<"No such user.">>};
            Target ->
                case sd_reqs:create_associate(maps:get(<<"username">>, User), maps:get(<<"username">>, Target)) of
                    {ok, View} -> {ok, #{<<"request">> => View}};
                    Err -> Err
                end
        end
    end);
do(<<"assoc.remove">>, Args, #{user := User}) ->
    with_bin(<<"user">>, Args, fun(Other) ->
        Me = maps:get(<<"username">>, User),
        case sd_users:assoc_relation(Me, Other) of
            <<"peer">> -> sd_users:assoc_remove(Me, Other), {ok, #{<<"removed">> => true}};
            undefined -> {error, not_found, <<"You aren't connected.">>};
            _ -> {error, not_allowed, <<"Host links are changed by a host or administrator.">>}
        end
    end);
do(<<"users.search">>, Args, #{user := User}) ->
    Q = case maps:get(<<"q">>, Args, <<>>) of B when is_binary(B) -> B; _ -> <<>> end,
    Me = maps:get(<<"username">>, User),
    Found = case sd_util:strict() of
                %% Strict: no browsing the directory (a customer shouldn't be
                %% able to list every employee) -- only an exact username,
                %% email or mobile number finds someone.
                true ->
                    case Q =/= <<>> andalso sd_users:find(Q) of
                        U when is_map(U) -> [U];
                        _ -> []
                    end;
                false -> sd_users:search(Q, 21)
            end,
    Hits = [sd_users:public(U) || U <- Found, sd_users:is_active(U), maps:get(<<"username">>, U) =/= Me],
    {ok, #{<<"users">> => lists:sublist(Hits, 20)}};

%% ---- requests (approvals / invitations) ---------------------------------------------------------------------
do(<<"req.list">>, Args, #{user := User}) ->
    Filter = case maps:get(<<"status">>, Args, <<"pending">>) of
                 F when is_binary(F) -> F;
                 _ -> <<"pending">>
             end,
    {ok, #{<<"requests">> => sd_reqs:list_for(maps:get(<<"username">>, User), Filter)}};
do(<<"req.respond">>, Args, #{user := User}) ->
    case {maps:get(<<"id">>, Args, undefined), maps:get(<<"action">>, Args, undefined)} of
        {Id, Act} when is_integer(Id) ->
            case action_atom(Act) of
                error -> {error, invalid, <<"action must be accept, reject or ignore.">>};
                A -> case sd_reqs:respond(Id, maps:get(<<"username">>, User), A) of
                         {ok, View} -> {ok, #{<<"request">> => View}};
                         Err -> Err
                     end
            end;
        _ -> {error, invalid, <<"id (number) and action are required.">>}
    end;

do(<<"host.users">>, _Args, #{user := User}) ->
    Users = [U#{<<"online">> => is_online(maps:get(<<"username">>, U))}
             || U <- sd_users:users_of_host(maps:get(<<"username">>, User))],
    {ok, #{<<"users">> => Users}};
do(<<"host.transfer">>, Args, #{user := User}) ->
    with_bin(<<"user">>, Args, fun(Subject) ->
        with_bin(<<"toHost">>, Args, fun(To) ->
            case sd_reqs:create_host_transfer(maps:get(<<"username">>, User), Subject, To) of
                {ok, View} -> {ok, #{<<"request">> => View}};
                Err -> Err
            end
        end)
    end);

do(<<"users.invite">>, Args, #{user := Actor}) ->
    invite_user(Args, Actor);

%% ---- cards / sections / reminders -----------------------------------------------------------------------------
do(<<"cards.list">>, Args, #{user := User}) ->
    Section = case maps:get(<<"section">>, Args, <<"all">>) of S when is_binary(S) -> S; _ -> <<"all">> end,
    Limit = case maps:get(<<"limit">>, Args, 50) of L when is_integer(L) -> L; _ -> 50 end,
    Name = maps:get(<<"username">>, User),
    {ok, #{<<"cards">> => sd_cards:list(Name, Section, Limit), <<"sections">> => sd_cards:sections(Name)}};
do(<<"cards.dismiss">>, Args, #{user := User}) ->
    Name = maps:get(<<"username">>, User),
    case maps:get(<<"id">>, Args, undefined) of
        <<"all">> -> sd_cards:dismiss(Name, all), {ok, #{<<"dismissed">> => true}};
        Id when is_binary(Id) -> sd_cards:dismiss(Name, Id), {ok, #{<<"dismissed">> => true}};
        _ -> {error, invalid, <<"id is required (a card id, or \"all\").">>}
    end;
do(<<"sections.list">>, _Args, #{user := User}) ->
    {ok, #{<<"sections">> => sd_cards:sections(maps:get(<<"username">>, User))}};
do(<<"sections.save">>, Args, #{user := User}) ->
    case sd_cards:save_section(maps:get(<<"username">>, User), Args) of
        {ok, S} -> {ok, #{<<"section">> => S}};
        Err -> Err
    end;
do(<<"sections.delete">>, Args, #{user := User}) ->
    with_bin(<<"id">>, Args, fun(Id) ->
        case sd_cards:delete_section(maps:get(<<"username">>, User), Id) of
            ok -> {ok, #{<<"deleted">> => true}};
            Err -> Err
        end
    end);
do(<<"reminder.add">>, Args, #{user := User}) ->
    with_bin(<<"text">>, Args, fun(Text) ->
        Due = case maps:get(<<"dueTs">>, Args, null) of D when is_integer(D) -> D; _ -> null end,
        {ok, Card} = sd_cards:add_reminder(maps:get(<<"username">>, User), Text, Due),
        {ok, #{<<"card">> => Card}}
    end);

%% ---- notifications: priority, pending, personal, reminders -------------------------------------------------------
do(<<"notifications.summary">>, _Args, #{user := User}) ->
    {ok, sd_cards:summary(maps:get(<<"username">>, User))};
do(<<"notifications.list">>, Args, #{user := User}) ->
    Category = case maps:get(<<"category">>, Args, <<"all">>) of
                   <<"all">> -> <<"all">>;
                   C when is_binary(C) -> C;
                   _ -> <<"all">>
               end,
    case Category =:= <<"all">> orelse lists:member(Category, sd_cards:categories()) of
        false -> {error, invalid, <<"category must be one of: priority, pending, personal, reminders, all">>};
        true ->
            UnreadOnly = maps:get(<<"unreadOnly">>, Args, true) =/= false,
            Limit = case maps:get(<<"limit">>, Args, 50) of L when is_integer(L) -> L; _ -> 50 end,
            Name = maps:get(<<"username">>, User),
            {ok, #{<<"notifications">> => sd_cards:notifications(Name, Category, UnreadOnly, Limit),
                   <<"counts">> => maps:get(<<"counts">>, sd_cards:summary(Name))}}
    end;
do(<<"notifications.read">>, Args, #{user := User}) ->
    Name = maps:get(<<"username">>, User),
    case {maps:get(<<"all">>, Args, false), maps:get(<<"category">>, Args, undefined),
          maps:get(<<"ids">>, Args, undefined)} of
        {true, _, _} -> {ok, sd_cards:mark_read(Name, all)};
        {_, Cat, _} when is_binary(Cat) ->
            case lists:member(Cat, sd_cards:categories()) of
                true -> {ok, sd_cards:mark_read(Name, {category, Cat})};
                false -> {error, invalid, <<"category must be one of: priority, pending, personal, reminders">>}
            end;
        {_, _, Ids} when is_list(Ids) ->
            case lists:all(fun is_binary/1, Ids) of
                true -> {ok, sd_cards:mark_read(Name, {ids, Ids})};
                false -> {error, invalid, <<"ids must be a list of card ids.">>}
            end;
        _ -> {error, invalid, <<"Send {\"ids\":[...]}, {\"category\":\"personal\"} or {\"all\":true}.">>}
    end;

%% ---- options / forms -----------------------------------------------------------------------------------------------
do(<<"options.list">>, _Args, #{user := User}) ->
    {ok, #{<<"options">> => sd_config:options_for(User)}};
do(<<"tstruct.get">>, Args, #{user := User}) ->
    with_bin(<<"name">>, Args, fun(Name) ->
        case sd_config:tstruct_for_user(User, Name) of
            {ok, Def} -> {ok, #{<<"tstruct">> => Def}};
            Err -> Err
        end
    end);
do(<<"tstruct.submit">>, Args, #{user := User}) ->
    with_bin(<<"name">>, Args, fun(Name) ->
        case sd_config:submit(User, Name, maps:get(<<"values">>, Args, #{})) of
            {ok, Sub} -> {ok, #{<<"submission">> => Sub}};
            Err -> Err
        end
    end);
do(<<"submissions.list">>, _Args, #{user := User}) ->
    {ok, #{<<"submissions">> => sd_config:list_submissions(User)}};

%% ---- admin console unlock (password + OTP) -----------------------------------------------------------------------
do(<<"admin.unlock.start">>, _Args, #{token := Token}) ->
    sd_auth:admin_unlock_start(Token);
do(<<"admin.unlock">>, Args, #{token := Token}) ->
    sd_auth:admin_unlock(Token, maps:get(<<"password">>, Args, undefined), maps:get(<<"otp">>, Args, undefined));

%% ---- admin: organisation & master data ---------------------------------------------------------------------------------
do(<<"admin.org.get">>, _Args, _Ctx) ->
    {ok, #{<<"org">> => sd_org:info(),
           <<"counts">> => #{<<"users">> => length(sd_users:list()),
                             <<"admins">> => length(sd_users:admins()),
                             <<"pendingApprovals">> => length([U || U <- sd_users:list(),
                                                                    maps:get(<<"status">>, U) =:= <<"pending">>])}}};
do(<<"admin.org.set">>, Args, _Ctx) ->
    with_bin(<<"name">>, Args, fun(Name) -> sd_org:set_name(Name), {ok, #{<<"org">> => sd_org:info()}} end);
do(<<"admin.cfg.list">>, Args, _Ctx) ->
    with_kind(Args, fun(Kind) -> {ok, #{<<"items">> => sd_org:list(Kind)}} end);
do(<<"admin.cfg.save">>, Args, _Ctx) ->
    with_kind(Args, fun(Kind) ->
        case sd_org:save(Kind, maps:get(<<"item">>, Args, #{})) of
            {ok, Item} -> {ok, #{<<"item">> => Item}};
            Err -> Err
        end
    end);
do(<<"admin.cfg.delete">>, Args, _Ctx) ->
    with_kind(Args, fun(Kind) ->
        with_bin(<<"name">>, Args, fun(Name) ->
            case sd_org:delete(Kind, Name) of
                ok -> {ok, #{<<"deleted">> => true}};
                Err -> Err
            end
        end)
    end);

%% ---- admin: users ------------------------------------------------------------------------------------------------------------
do(<<"admin.users.list">>, Args, _Ctx) ->
    list_users(Args);
do(<<"admin.user.get">>, Args, _Ctx) ->
    with_bin(<<"username">>, Args, fun(Name) ->
        case sd_users:get(Name) of
            undefined -> {error, not_found, <<"No such user.">>};
            U ->
                Assoc = [#{<<"username">> => Peer, <<"relation">> => Rel,
                           <<"name">> => case sd_users:get(Peer) of #{<<"name">> := N} -> N; _ -> Peer end}
                         || {Peer, Rel} <- sd_users:assoc_list(Name)],
                {ok, #{<<"user">> => U, <<"associates">> => Assoc}}
        end
    end);
do(<<"admin.user.update">>, Args, #{user := Actor}) ->
    with_bin(<<"username">>, Args, fun(Name) ->
        case sd_users:update(Name, Args, maps:get(<<"username">>, Actor)) of
            {ok, U} -> {ok, #{<<"user">> => U}};
            Err -> Err
        end
    end);
do(<<"admin.user.status">>, Args, #{user := Actor}) ->
    with_bin(<<"username">>, Args, fun(Name) ->
        case maps:get(<<"active">>, Args, undefined) of
            Active when is_boolean(Active) -> set_active(Actor, sd_util:norm_user(Name), Active);
            _ -> {error, invalid, <<"active (true/false) is required.">>}
        end
    end);
do(<<"admin.host.change">>, Args, _Ctx) ->
    with_bin(<<"user">>, Args, fun(Name) ->
        case maps:get(<<"host">>, Args, undefined) of
            null -> reassign_one(Name, null);
            H when is_binary(H) -> reassign_one(Name, sd_util:norm_user(H));
            _ -> {error, invalid, <<"host is required (a username, or null to clear).">>}
        end
    end);
do(<<"admin.host.reassign">>, Args, _Ctx) ->
    with_bin(<<"from">>, Args, fun(From) ->
        with_bin(<<"to">>, Args, fun(To) -> reassign_all(sd_util:norm_user(From), sd_util:norm_user(To)) end)
    end);
do(<<"admin.affiliates.list">>, _Args, _Ctx) ->
    {ok, #{<<"affiliates">> => affiliate_rows()}};
do(<<"admin.admins.list">>, _Args, _Ctx) ->
    {ok, #{<<"admins">> => sd_users:admins()}};
do(<<"admin.admins.add">>, Args, _Ctx) ->
    with_bin(<<"username">>, Args, fun(Name) ->
        case sd_users:get(Name) of
            #{<<"status">> := <<"active">>} = U ->
                sd_users:replace(U#{<<"role">> => <<"admin">>, <<"updatedTs">> => sd_util:now_ms()}),
                {ok, #{<<"admins">> => sd_users:admins()}};
            _ -> {error, not_found, <<"No such active user.">>}
        end
    end);
do(<<"admin.admins.remove">>, Args, _Ctx) ->
    with_bin(<<"username">>, Args, fun(Name) ->
        case {sd_users:get(Name), length(sd_users:admins())} of
            {undefined, _} -> {error, not_found, <<"No such user.">>};
            {#{<<"role">> := <<"admin">>} = U, N} when N > 1 ->
                sd_users:replace(U#{<<"role">> => <<"user">>, <<"updatedTs">> => sd_util:now_ms()}),
                {ok, #{<<"admins">> => sd_users:admins()}};
            {#{<<"role">> := <<"admin">>}, _} -> {error, last_admin, <<"There must be at least one administrator.">>};
            _ -> {error, invalid, <<"That user isn't an administrator.">>}
        end
    end);

%% ---- admin: lite tstructs, options, application connections ------------------------------------------------------------------------
do(<<"admin.tstruct.list">>, _Args, _Ctx) -> {ok, #{<<"tstructs">> => sd_config:list_tstructs()}};
do(<<"admin.tstruct.get">>, Args, _Ctx) ->
    with_bin(<<"name">>, Args, fun(N) ->
        case sd_config:get_tstruct(N) of
            undefined -> {error, not_found, <<"No such lite structure.">>};
            D -> {ok, #{<<"tstruct">> => D}}
        end
    end);
do(<<"admin.tstruct.save">>, Args, _Ctx) ->
    case sd_config:save_tstruct(Args) of {ok, D} -> {ok, #{<<"tstruct">> => D}}; Err -> Err end;
do(<<"admin.tstruct.delete">>, Args, _Ctx) ->
    with_bin(<<"name">>, Args, fun(N) ->
        case sd_config:delete_tstruct(N) of ok -> {ok, #{<<"deleted">> => true}}; Err -> Err end
    end);
do(<<"admin.option.list">>, _Args, _Ctx) ->
    {ok, #{<<"options">> => sd_config:list_options(), <<"types">> => sd_config:option_types()}};
do(<<"admin.option.save">>, Args, _Ctx) ->
    case sd_config:save_option(Args) of {ok, O} -> {ok, #{<<"option">> => O}}; Err -> Err end;
do(<<"admin.option.delete">>, Args, _Ctx) ->
    with_bin(<<"id">>, Args, fun(Id) ->
        case sd_config:delete_option(Id) of ok -> {ok, #{<<"deleted">> => true}}; Err -> Err end
    end);
do(<<"admin.appconn.list">>, _Args, _Ctx) -> {ok, #{<<"connections">> => sd_config:list_appconns()}};
do(<<"admin.appconn.save">>, Args, _Ctx) ->
    case sd_config:save_appconn(Args) of {ok, C} -> {ok, #{<<"connection">> => C}}; Err -> Err end;
do(<<"admin.appconn.delete">>, Args, _Ctx) ->
    with_bin(<<"name">>, Args, fun(N) ->
        case sd_config:delete_appconn(N) of ok -> {ok, #{<<"deleted">> => true}}; Err -> Err end
    end);

do(Action, _, _) ->
    {error, unknown_action, <<"Unknown sd action: ", Action/binary>>}.

%% ---- helpers ------------------------------------------------------------------------------------------------------------------------

mode() -> atom_to_binary(sd_util:mode(), utf8).

is_online(Username) ->
    lists:member(sd_util:s(Username), chat_room:list_users()).

action_atom(<<"accept">>) -> accept;
action_atom(<<"reject">>) -> reject;
action_atom(<<"ignore">>) -> ignore;
action_atom(_) -> error.

with_bin(Key, Args, Fun) ->
    case maps:get(Key, Args, undefined) of
        V when is_binary(V), V =/= <<>> -> Fun(V);
        _ -> {error, invalid, <<Key/binary, " is required.">>}
    end.

%% Kinds are looked up in a fixed table -- never turned into atoms from
%% client input.
with_kind(Args, Fun) ->
    case maps:get(<<"kind">>, Args, undefined) of
        <<"branches">> -> Fun(branches);
        <<"departments">> -> Fun(departments);
        <<"designations">> -> Fun(designations);
        <<"categories">> -> Fun(categories);
        <<"affiliates">> -> Fun(affiliates);
        _ -> {error, invalid, <<"kind must be one of: branches, departments, designations, categories, affiliates">>}
    end.

%% "Other users can be invited by providing ...": an administrator or a host
%% (for users their scope covers). The inviter becomes the new user's host.
invite_user(Args, Actor) ->
    ActorName = maps:get(<<"username">>, Actor),
    IsAdmin = sd_users:is_admin(Actor),
    HostName = case maps:get(<<"host">>, Args, undefined) of
                   H when is_binary(H), IsAdmin -> sd_util:norm_user(H);
                   _ -> ActorName
               end,
    case sd_users:get(HostName) of
        #{<<"status">> := <<"active">>} = HostUser ->
            case sd_users:is_host(HostUser) orelse sd_users:is_admin(HostUser) of
                false -> {error, invalid, <<"That user isn't a host.">>};
                true ->
                    Opts0 = #{mode => invite, actor => ActorName, host => HostName, status => <<"active">>},
                    Opts = case IsAdmin of
                               true -> Opts0;
                               false -> Opts0#{scope_host => HostUser}
                           end,
                    case sd_users:create(Args, Opts) of
                        {ok, User} ->
                            sd_notify:deliver(invite,
                                sd_util:take([<<"name">>, <<"email">>, <<"mobile">>], User),
                                #{<<"text">> => <<"You've been invited to Sandesh by ",
                                                  (maps:get(<<"name">>, Actor))/binary,
                                                  ". Sign in with your email or mobile number; "
                                                  "we'll send you a one-time code.">>}),
                            {ok, #{<<"user">> => User}};
                        Err -> Err
                    end
            end;
        _ -> {error, invalid, <<"The chosen host isn't an active user.">>}
    end.

list_users(Args) ->
    Status = maps:get(<<"status">>, Args, <<"all">>),
    Q = string:lowercase(case maps:get(<<"q">>, Args, <<>>) of B when is_binary(B) -> B; _ -> <<>> end),
    Page = max(1, int(maps:get(<<"page">>, Args, 1), 1)),
    Size = max(1, min(200, int(maps:get(<<"pageSize">>, Args, 50), 50))),
    OrgName = maps:get(<<"name">>, sd_org:info()),
    All = [U || U <- sd_users:list(),
                Status =:= <<"all">> orelse maps:get(<<"status">>, U) =:= Status,
                Q =:= <<>> orelse matches(U, Q)],
    Rows = [row(U, OrgName) || U <- lists:sublist(All, (Page - 1) * Size + 1, Size)],
    {ok, #{<<"users">> => Rows, <<"total">> => length(All), <<"page">> => Page, <<"pageSize">> => Size}}.

matches(U, Q) ->
    lists:any(fun(K) ->
                  case maps:get(K, U, null) of
                      V when is_binary(V) -> binary:match(string:lowercase(V), Q) =/= nomatch;
                      _ -> false
                  end
              end, [<<"username">>, <<"name">>, <<"email">>, <<"mobile">>]).

%% The columns the spec asks the admin's user listing to show: user name,
%% employee/affiliate, organisation name, branch, department, designation,
%% active.
row(U, OrgName) ->
    {Type, Org} = case {maps:get(<<"isEmployee">>, U, false), maps:get(<<"affiliate">>, U, null)} of
                      {true, _} -> {<<"employee">>, OrgName};
                      {_, A} when is_binary(A) -> {<<"affiliate">>, A};
                      _ -> {<<"external">>, null}
                  end,
    U#{<<"userType">> => Type, <<"organisation">> => Org,
       <<"active">> => maps:get(<<"status">>, U) =:= <<"active">>,
       <<"online">> => is_online(maps:get(<<"username">>, U))}.

int(V, _) when is_integer(V) -> V;
int(_, Default) -> Default.

set_active(Actor, Target, Active) ->
    ActorName = maps:get(<<"username">>, Actor),
    case sd_users:get(Target) of
        undefined -> {error, not_found, <<"No such user.">>};
        _ when Target =:= ActorName -> {error, invalid, <<"You can't change your own status.">>};
        U ->
            TargetIsAdmin = sd_users:is_admin(U),
            ActorIsAdmin = sd_users:is_admin(Actor),
            case {TargetIsAdmin andalso not ActorIsAdmin,
                  TargetIsAdmin andalso (not Active) andalso length(sd_users:admins()) =< 1} of
                {true, _} -> {error, forbidden, <<"Only an administrator can change an administrator.">>};
                {_, true} -> {error, last_admin, <<"There must be at least one active administrator.">>};
                _ ->
                    Status = case Active of true -> <<"active">>; false -> <<"inactive">> end,
                    {ok, New} = sd_users:set_status(Target, Status),
                    Active orelse sd_notify:disconnect(Target),
                    %% A deactivated host leaves users without one -- hand the
                    %% admin the list so they can pick a new host ("provide
                    %% option to assign new hosts for users").
                    Orphans = case (not Active) andalso sd_users:is_host(U) of
                                  true -> [sd_users:public(X) || X <- sd_users:users_of_host(Target)];
                                  false -> []
                              end,
                    {ok, #{<<"user">> => New, <<"orphans">> => Orphans}}
            end
    end.

reassign_one(Name, null) ->
    case sd_users:set_host(Name, null) of
        {ok, U} -> {ok, #{<<"user">> => U}};
        Err -> Err
    end;
reassign_one(Name, Host) ->
    case valid_host_target(Host) of
        ok ->
            case sd_users:set_host(Name, Host) of
                {ok, U} -> {ok, #{<<"user">> => U}};
                Err -> Err
            end;
        Err -> Err
    end.

reassign_all(From, To) ->
    case {sd_users:get(From), valid_host_target(To)} of
        {undefined, _} -> {error, not_found, <<"No such user to move users from.">>};
        {_, {error, _, _} = Err} -> Err;
        _ when From =:= To -> {error, invalid, <<"from and to are the same user.">>};
        _ ->
            Moved = [begin {ok, _} = sd_users:set_host(maps:get(<<"username">>, U), To), maps:get(<<"username">>, U) end
                     || U <- sd_users:users_of_host(From)],
            {ok, #{<<"moved">> => Moved, <<"count">> => length(Moved)}}
    end.

valid_host_target(Host) ->
    case sd_users:get(Host) of
        #{<<"status">> := <<"active">>} = U ->
            case sd_users:is_host(U) orelse sd_users:is_admin(U) of
                true -> ok;
                false -> {error, invalid, <<"The new host must be a host or administrator.">>}
            end;
        _ -> {error, not_found, <<"No such active host.">>}
    end.

%% "Affiliate listing - Affiliate name, branch, category, host users, users."
affiliate_rows() ->
    Hosts = [H || H <- sd_users:list(), sd_users:is_active(H), sd_users:is_host(H)],
    All = sd_users:list(),
    [begin
         Name = maps:get(<<"name">>, A),
         Probe = #{<<"isEmployee">> => false, <<"affiliate">> => Name,
                   <<"category">> => maps:get(<<"category">>, A, null)},
         A#{<<"hosts">> => [maps:get(<<"username">>, H) || H <- Hosts, sd_users:host_covers(H, Probe)],
            <<"users">> => [sd_util:take([<<"username">>, <<"name">>, <<"affiliateBranch">>, <<"status">>], U)
                            || U <- All, maps:get(<<"affiliate">>, U, null) =:= Name]}
     end || A <- sd_org:list(affiliates)].
