%%% Approval workflows from the Sandesh spec, all modelled as one kind of
%%% record -- a "request" -- so the frontend has a single inbox to render:
%%%
%%%   onboarding    a self-registered user waits for a host whose scope
%%%                 covers them to approve ("The onboarding approval will be
%%%                 sent to the host who can approve their onboarding").
%%%                 If no host covers them, administrators are the approvers.
%%%   associate     "A user may invite other users which may be accepted,
%%%                 ignored or rejected by the receiving user."
%%%   host_transfer "A host may transfer a user to another host which may be
%%%                 accepted or rejected by the receiving host."
%%%   group_invite  a group invitation for someone outside the inviter's own
%%%                 users "needs an approval from the invited user's host."
%%%
%%% A request lives in the hash `sd:reqs` (id -> JSON) and is indexed per
%%% involved user in `sd:reqs:u:<user>` so /sd req.list is one lookup.
%%% Everything is durable: an approver who is offline simply finds the
%%% request waiting when they next connect (a live push is only a bonus).
-module(sd_reqs).
-export([create_onboarding/1, create_associate/2, create_host_transfer/3,
         create_group_invite/3, respond/3, list_for/2, get/1, approvers_for/1,
         view/1, pending_count/1]).

-compile({no_auto_import, [get/1]}).

-define(REQS, "sd:reqs").

%% ---- creation --------------------------------------------------------------------------

%% Called right after a self-registration. Returns {ok, Request}.
create_onboarding(NewUser) ->
    Approvers = approvers_for(NewUser),
    make(<<"onboarding">>, maps:get(<<"username">>, NewUser), maps:get(<<"username">>, NewUser),
         Approvers, #{}).

create_associate(From, ToUsername) ->
    F = sd_util:norm_user(From), T = sd_util:norm_user(ToUsername),
    case {F =:= T, sd_users:get(T), sd_users:associated(F, T)} of
        {true, _, _} -> {error, invalid, <<"You can't invite yourself.">>};
        {_, undefined, _} -> {error, not_found, <<"No such user.">>};
        {_, #{<<"status">> := S}, _} when S =/= <<"active">> ->
            {error, not_found, <<"No such user.">>};
        {_, _, true} -> {error, already_associated, <<"You're already connected.">>};
        _ ->
            case existing_pending(<<"associate">>, F, T) of
                true -> {error, duplicate, <<"An invitation is already pending.">>};
                false -> make(<<"associate">>, F, T, [T], #{})
            end
    end.

%% From must currently be the user's host; ToHost must be able to host.
create_host_transfer(From, Subject, ToHost) ->
    F = sd_util:norm_user(From), S = sd_util:norm_user(Subject), T = sd_util:norm_user(ToHost),
    case {sd_users:get(S), sd_users:get(T)} of
        {undefined, _} -> {error, not_found, <<"No such user.">>};
        {_, undefined} -> {error, not_found, <<"No such receiving host.">>};
        {User, ToUser} ->
            Current = sd_util:get(<<"host">>, User),
            IsAdmin = sd_users:is_admin(sd_users:get(F)),
            case {Current =:= F orelse IsAdmin,
                  sd_users:is_active(ToUser) andalso (sd_users:is_host(ToUser) orelse sd_users:is_admin(ToUser)),
                  T =:= Current} of
                {false, _, _} -> {error, forbidden, <<"You aren't this user's host.">>};
                {_, false, _} -> {error, invalid, <<"The receiving user isn't an active host.">>};
                {_, _, true} -> {error, invalid, <<"They're already this user's host.">>};
                _ -> make(<<"host_transfer">>, F, S, [T], #{<<"toHost">> => T})
            end
    end.

%% Invitee's host approves. Returns {ok, Request}.
create_group_invite(Inviter, Group, Invitee) ->
    I = sd_util:norm_user(Inviter), V = sd_util:norm_user(Invitee),
    case sd_users:get(V) of
        undefined -> {error, not_found, <<"No such user.">>};
        User ->
            case existing_pending(<<"group_invite">>, I, V, Group) of
                true -> {error, duplicate, <<"An invitation for them is already pending.">>};
                false -> make(<<"group_invite">>, I, V, approvers_for(User), #{<<"group">> => sd_util:b(Group)})
            end
    end.

%% Hosts whose scope covers the user; else the administrators. For someone
%% who already has a host, that host is the approver.
approvers_for(User) ->
    case sd_util:get(<<"host">>, User) of
        H when is_binary(H) ->
            case sd_users:get(H) of
                #{<<"status">> := <<"active">>} -> [H];
                _ -> fallback(User)
            end;
        _ -> fallback(User)
    end.

fallback(User) ->
    case [maps:get(<<"username">>, H) || H <- sd_users:hosts_covering(User)] of
        [] -> [maps:get(<<"username">>, A) || A <- sd_users:admins()];
        Hosts -> Hosts
    end.

make(Type, From, Subject, Approvers, Data) ->
    Id = sd_db:incr("sd:seq:req"),
    Req = #{<<"id">> => Id, <<"type">> => Type, <<"status">> => <<"pending">>,
            <<"from">> => From, <<"subject">> => Subject, <<"approvers">> => Approvers,
            <<"data">> => Data, <<"createdTs">> => sd_util:now_ms(),
            <<"resolvedTs">> => null, <<"resolvedBy">> => null},
    sd_db:hset_json(?REQS, integer_to_list(Id), Req),
    lists:foreach(fun(U) -> sd_db:sadd(index(U), integer_to_binary(Id)) end,
                  lists:usort([From, Subject | Approvers])),
    announce_created(Req),
    {ok, view(Req)}.

announce_created(Req) ->
    View = view(Req),
    Type = maps:get(<<"type">>, Req),
    From = maps:get(<<"from">>, Req),
    lists:foreach(
        fun(Approver) ->
            sd_cards:add(Approver, #{<<"kind">> => <<"request">>, <<"from">> => From,
                                     <<"text">> => request_text(View),
                                     <<"ref">> => #{<<"requestId">> => maps:get(<<"id">>, Req),
                                                    <<"type">> => Type}}),
            sd_notify:push_event(Approver, <<"request_created">>, View)
        end, maps:get(<<"approvers">>, Req)).

%% Takes the *view* (has display names), so a card reads "Priya S wants to
%% transfer Erin E to you" rather than showing raw usernames.
request_text(#{<<"type">> := <<"onboarding">>, <<"subjectName">> := S}) ->
    <<S/binary, " has registered and is waiting for approval.">>;
request_text(#{<<"type">> := <<"associate">>, <<"fromName">> := F}) ->
    <<F/binary, " wants to connect with you.">>;
request_text(#{<<"type">> := <<"host_transfer">>, <<"fromName">> := F, <<"subjectName">> := S}) ->
    <<F/binary, " wants to transfer ", S/binary, " to you as their host.">>;
request_text(#{<<"type">> := <<"group_invite">>, <<"fromName">> := F, <<"subjectName">> := S,
               <<"data">> := #{<<"group">> := G}}) ->
    <<F/binary, " wants to add ", S/binary, " to group ", G/binary, ".">>.

existing_pending(Type, From, To) ->
    lists:any(fun(#{<<"type">> := T, <<"status">> := <<"pending">>, <<"from">> := F, <<"subject">> := S}) ->
                      T =:= Type andalso F =:= From andalso S =:= To;
                 (_) -> false
              end, all_for(From)).

existing_pending(Type, From, To, Group) ->
    lists:any(fun(#{<<"type">> := T, <<"status">> := <<"pending">>, <<"from">> := F,
                    <<"subject">> := S, <<"data">> := D}) ->
                      T =:= Type andalso F =:= From andalso S =:= To andalso
                          maps:get(<<"group">>, D, undefined) =:= sd_util:b(Group);
                 (_) -> false
              end, all_for(From)).

%% ---- reading -----------------------------------------------------------------------------

index(User) -> "sd:reqs:u:" ++ sd_util:s(sd_util:norm_user(User)).

get(Id) ->
    sd_db:hget_json(?REQS, integer_to_list(Id)).

all_for(User) ->
    Reqs = [R || B <- sd_db:smembers(index(User)),
                 R <- [sd_db:hget_json(?REQS, binary_to_list(B))], is_map(R)],
    lists:sort(fun(A, B) -> maps:get(<<"id">>, A) >= maps:get(<<"id">>, B) end, Reqs).

%% Filter: <<"pending">> | <<"all">> | any specific status.
list_for(User, Filter) ->
    [view(R) || R <- all_for(User),
                Filter =:= <<"all">> orelse maps:get(<<"status">>, R) =:= Filter].

%% How many requests are waiting on THIS user to respond.
pending_count(User) ->
    U = sd_util:norm_user(User),
    length([R || R <- all_for(U),
                 maps:get(<<"status">>, R) =:= <<"pending">>,
                 lists:member(U, maps:get(<<"approvers">>, R))]).

%% The shape sent to clients: the record plus display names.
view(Req) ->
    Name = fun(U) -> case sd_users:get(U) of
                         #{<<"name">> := N} -> N;
                         _ -> U
                     end end,
    Req#{<<"fromName">> => Name(maps:get(<<"from">>, Req)),
         <<"subjectName">> => Name(maps:get(<<"subject">>, Req))}.

%% ---- responding ------------------------------------------------------------------------------

%% Action: accept | reject | ignore. Responder must be an approver (or an
%% administrator, for everything except a personal "associate" invitation).
respond(Id, Responder, Action) when Action =:= accept; Action =:= reject; Action =:= ignore ->
    R = sd_util:norm_user(Responder),
    case get(Id) of
        undefined -> {error, not_found, <<"No such request.">>};
        #{<<"status">> := S} when S =/= <<"pending">> ->
            {error, already_resolved, <<"That request has already been answered.">>};
        Req ->
            Type = maps:get(<<"type">>, Req),
            IsApprover = lists:member(R, maps:get(<<"approvers">>, Req)),
            IsAdmin = sd_users:is_admin(sd_users:get(R)) andalso Type =/= <<"associate">>,
            case IsApprover orelse IsAdmin of
                false -> {error, forbidden, <<"This request isn't yours to answer.">>};
                true -> apply_response(Req, R, Action)
            end
    end;
respond(_, _, _) ->
    {error, invalid, <<"action must be accept, reject or ignore.">>}.

apply_response(Req, Responder, accept) ->
    case on_accept(maps:get(<<"type">>, Req), Req, Responder) of
        ok -> {ok, resolve(Req, <<"accepted">>, Responder)};
        {error, _, _} = Err -> Err
    end;
apply_response(Req, Responder, Action) ->
    Status = atom_to_binary(case Action of reject -> rejected; ignore -> ignored end, utf8),
    on_decline(maps:get(<<"type">>, Req), Req),
    {ok, resolve(Req, Status, Responder)}.

on_accept(<<"onboarding">>, Req, Responder) ->
    Subject = maps:get(<<"subject">>, Req),
    case sd_users:get(Subject) of
        undefined -> {error, not_found, <<"That user no longer exists.">>};
        _ ->
            {ok, _} = sd_users:set_status(Subject, <<"active">>),
            {ok, _} = sd_users:set_host(Subject, Responder),
            welcome(Subject, Responder),
            ok
    end;
on_accept(<<"associate">>, Req, _Responder) ->
    sd_users:assoc_add(maps:get(<<"from">>, Req), maps:get(<<"subject">>, Req), peer),
    ok;
on_accept(<<"host_transfer">>, Req, Responder) ->
    Subject = maps:get(<<"subject">>, Req),
    Target = maps:get(<<"toHost">>, maps:get(<<"data">>, Req)),
    %% The receiving host (or an admin acting for them) accepts.
    _ = Responder,
    case sd_users:set_host(Subject, Target) of
        {ok, _} -> ok;
        {error, _, _} = Err -> Err
    end;
on_accept(<<"group_invite">>, Req, _Responder) ->
    Group = sd_util:s(maps:get(<<"group">>, maps:get(<<"data">>, Req))),
    Invitee = sd_util:s(maps:get(<<"subject">>, Req)),
    Inviter = sd_util:s(maps:get(<<"from">>, Req)),
    case chat_groups:force_add(Group, Inviter, Invitee) of
        {ok, _} -> ok;
        {error, not_found} -> {error, not_found, <<"That group no longer exists.">>};
        {error, already_member} -> ok
    end.

on_decline(<<"onboarding">>, Req) ->
    sd_users:set_status(maps:get(<<"subject">>, Req), <<"rejected">>),
    ok;
on_decline(_, _) -> ok.

%% Tell a newly approved person (offline by definition: they can't sign in
%% until approved) through the configured delivery channel.
welcome(Subject, Host) ->
    case sd_users:get(Subject) of
        undefined -> ok;
        U ->
            sd_notify:deliver(onboarding, sd_util:take([<<"name">>, <<"email">>, <<"mobile">>], U),
                              #{<<"text">> => <<"Your Sandesh registration was approved by ",
                                                Host/binary, ". You can now sign in.">>})
    end.

resolve(Req, Status, Responder) ->
    Done = Req#{<<"status">> => Status, <<"resolvedTs">> => sd_util:now_ms(),
                <<"resolvedBy">> => Responder},
    sd_db:hset_json(?REQS, integer_to_list(maps:get(<<"id">>, Req)), Done),
    View = view(Done),
    %% An answered approval stops being a "pending" notification for every
    %% approver (whoever answered it, or it was answered for them).
    lists:foreach(fun(A) -> catch sd_cards:resolve_request(A, maps:get(<<"id">>, Done)) end,
                  maps:get(<<"approvers">>, Done)),
    %% Tell everyone involved, so open inboxes update without a refresh.
    lists:foreach(
        fun(U) -> sd_notify:push_event(U, <<"request_resolved">>, View) end,
        lists:usort([maps:get(<<"from">>, Done) | maps:get(<<"approvers">>, Done)])),
    View.
