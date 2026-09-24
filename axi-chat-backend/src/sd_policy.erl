%%% Where the spec's rules become enforcement -- and the ONE place that
%%% decides whether they are enforced at all.
%%%
%%% SANDESH_MODE=open (default): every function here says "allowed". The chat
%%% behaves exactly as it did before Sandesh existed, so a frontend that only
%%% knows the plain chat protocol (the minimal demo app) is unaffected.
%%%
%%% SANDESH_MODE=strict: the spec applies.
%%%  - A WebSocket connection needs a real Sandesh session (from
%%%    POST /api/sd/login) belonging to the username being claimed.
%%%  - "Users can message only to their host" (+ people they've accepted an
%%%    invitation from): a DM needs an association.
%%%  - Only hosts create groups; adding someone outside your own users needs
%%%    the approval of THEIR host.
%%%  - Admin actions need the admin console unlock (password + OTP).
%%%
%%% Chat_web calls these hooks; they take/return plain strings like the rest
%%% of the chat_* modules.
-module(sd_policy).
-export([handshake/2, can_message/2, can_broadcast/1, can_create_group/1, group_add/3, admin_gate/1,
         after_dm/5, after_group/5, after_read/2, session_alive/0]).
-include_lib("kernel/include/logger.hrl").

%% Live connections and the two-week login: a WebSocket that was opened with
%% a Sandesh session keeps working only while that session exists. Every
%% incoming command calls this; it re-checks Redis at most once per
%% SANDESH_SESSION_CHECK_SEC (default 30) so it costs one cheap lookup per
%% connection per 30 s. `expired` => chat_web tells the client
%% (session_expired) and closes the connection, so the app shows its sign-in
%% screen. Connections that never had a Sandesh session (open-mode plain
%% chat) are never affected.
session_alive() ->
    case get(sd_session) of
        #{token := Token} ->
            %% Milliseconds, not whole seconds: with second granularity a gap
            %% of 1.1 s can straddle two ticks and read as 2.
            Now = erlang:monotonic_time(millisecond),
            Every = check_interval() * 1000,
            case get(sd_session_checked) of
                Last when is_integer(Last), Now - Last < Every -> ok;
                _ ->
                    put(sd_session_checked, Now),
                    case sd_auth:session_alive(Token) of
                        true -> ok;
                        false -> expired
                    end
            end;
        _ -> ok
    end.

check_interval() ->
    case os:getenv("SANDESH_SESSION_CHECK_SEC") of
        false -> 30;
        S -> case string:to_integer(S) of {N, []} when N >= 0 -> N; _ -> 30 end
    end.

%% The user opened/read a DM thread: its personal notifications are read.
after_read(Reader, Other) ->
    safely(fun() -> sd_cards:mark_dm_read(Reader, Other) end).

%% ---- post-send hooks: feed the recipient's message cards ---------------------------------------
%% Called after a message has ALREADY been delivered/stored. Wrapped so a
%% problem in Sandesh bookkeeping (Redis hiccup, bad data) is logged and
%% swallowed -- it must never turn a delivered message into an error.

after_dm(From, To, Id, Ts, Text) ->
    safely(fun() -> sd_cards:record_dm(To, Id, Ts, From, Text) end).

after_group(From, Group, Id, Ts, Text) ->
    safely(fun() ->
        case chat_groups:list_members(Group) of
            {ok, Members} -> sd_cards:record_group(Members, From, Group, Id, Ts, Text);
            _ -> ok
        end
    end).

safely(Fun) ->
    try Fun(), ok
    catch Class:Reason ->
        ?LOG_WARNING("sd_policy post-send hook failed (message was still delivered): ~p:~p",
                     [Class, Reason]),
        ok
    end.

%% Called while a WebSocket connection is being accepted.
%%   {ok, #{token, username}}  a valid Sandesh session for exactly this username
%%   legacy                    open mode, no (valid) session: plain chat only
%%   {error, Message}          strict mode and the session isn't good enough
handshake(Name, Token) ->
    Bin = list_to_binary(Token),
    Result = case sd_auth:session(Bin) of
                 {ok, User, _State} ->
                     case maps:get(<<"username">>, User) =:= sd_util:b(Name) of
                         true -> {ok, #{token => Bin, username => maps:get(<<"username">>, User)}};
                         false -> mismatch
                     end;
                 error -> none
             end,
    case {Result, sd_util:strict()} of
        {{ok, _} = Ok, _} -> Ok;
        {mismatch, true} -> {error, "That session belongs to a different username."};
        {none, true} -> {error, "Sign in to Sandesh first (POST /api/sd/login) and pass the returned token."};
        {_, false} -> legacy
    end.

%% true | {false, Message}
can_message(From, To) ->
    case sd_util:strict() of
        false -> true;
        true ->
            F = sd_users:get(From), T = sd_users:get(To),
            Ok = F =/= undefined andalso T =/= undefined andalso
                 sd_users:is_active(F) andalso sd_users:is_active(T) andalso
                 sd_users:associated(From, To),
            case Ok of
                true -> true;
                false -> {false, "You can only message your host and people you've connected with."}
            end
    end.

%% The global room reaches everyone connected -- the opposite of "users can
%% message only to their host". In strict mode only administrators may post
%% to it (announcements); everyone else uses DMs and groups.
can_broadcast(User) ->
    case sd_util:strict() of
        false -> true;
        true ->
            case sd_users:get(User) of
                U when is_map(U) ->
                    case sd_users:is_admin(U) of
                        true -> true;
                        false -> {false, "Broadcasting to everyone is disabled. Message your host or a group."}
                    end;
                _ -> {false, "Broadcasting to everyone is disabled. Message your host or a group."}
            end
    end.

can_create_group(User) ->
    case sd_util:strict() of
        false -> true;
        true ->
            case sd_users:get(User) of
                undefined -> {false, "Only registered users can create groups."};
                U ->
                    case sd_users:is_host(U) orelse sd_users:is_admin(U) of
                        true -> true;
                        false -> {false, "Only hosts can create groups."}
                    end
            end
    end.

%% allow | {pending, RequestView} | {deny, Message}
group_add(Group, Requester, NewMember) ->
    case sd_util:strict() of
        false -> allow;
        true -> strict_group_add(Group, Requester, NewMember)
    end.

strict_group_add(Group, Requester, NewMember) ->
    R = sd_users:get(Requester), N = sd_users:get(NewMember),
    Members = case chat_groups:list_members(Group) of
                  {ok, M} -> M;
                  _ -> []
              end,
    case {R, N} of
        {undefined, _} -> {deny, "Only registered users can add members."};
        {_, undefined} -> {deny, "No such Sandesh user: " ++ NewMember};
        _ ->
            case lists:member(Requester, Members) of
                false -> allow;   %% chat_groups reports not_found / not_member itself
                true ->
                    IsHostOrAdmin = sd_users:is_host(R) orelse sd_users:is_admin(R),
                    OwnUser = sd_util:get(<<"host">>, N) =:= sd_util:b(Requester),
                    case {IsHostOrAdmin, OwnUser orelse sd_users:is_admin(R)} of
                        {false, _} -> {deny, "Only hosts can add members to a group."};
                        {true, true} -> allow;
                        {true, false} ->
                            case sd_reqs:create_group_invite(Requester, Group, NewMember) of
                                {ok, View} -> {pending, View};
                                {error, _, Msg} -> {deny, binary_to_list(Msg)}
                            end
                    end
            end
    end.

%% Admin console gate. ok | {error, Code, Message}
admin_gate(Token) ->
    case sd_util:strict() of
        false -> ok;
        true ->
            case sd_auth:admin_unlocked(Token) of
                true -> ok;
                false -> {error, admin_locked,
                          <<"Unlock the admin console with your password and a one-time code first.">>}
            end
    end.
