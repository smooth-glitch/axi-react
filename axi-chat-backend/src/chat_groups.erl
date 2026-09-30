%%% Group chat registry + router. Kept separate from chat_room (which
%%% only knows about 1:1 identity and the global room) so each module
%%% stays focused. Resolves member pids through chat_room:get_pid/1
%%% rather than keeping its own copy of the online-user registry.
%%%
%%% Membership is just a set of username strings, with no persistence
%%% and no account system behind it -- consistent with the rest of the
%%% app. That means a group "survives" only as long as the process is
%%% running, and if a username is later reclaimed by someone else, they
%%% inherit whatever groups that name was in. Acceptable for now; real
%%% accounts would be the fix, see README.
%%%
%%% Group membership itself IS durable, though: it's loaded from
%%% chat_store on init and written through on every mutation, so groups
%%% survive a node restart even though this process's state doesn't.
-module(chat_groups).
-behaviour(gen_server).

-export([start_link/0]).
-export([create_group/2, add_member/3, force_add/3, leave_group/2, list_groups_for/1,
         list_members/1, list_groups_detailed/1, all_names/0, owner/1, group_message/3, group_message/4, typing/2, react/4, delete/3, edit/4]).
-export([init/1, handle_call/3, handle_cast/2, handle_info/2, terminate/2, code_change/3]).

-record(group, {owner :: string(), members :: [string()]}).
-record(state, {groups = #{} :: #{string() => #group{}}}).

start_link() ->
    gen_server:start_link({local, ?MODULE}, ?MODULE, [], []).

create_group(Name, Owner) ->
    gen_server:call(?MODULE, {create, Name, Owner}).

all_names() -> gen_server:call(?MODULE, all_names).

owner(GroupName) -> gen_server:call(?MODULE, {owner, GroupName}).

%% Only the group's creator (its admin) can add members.
add_member(GroupName, Requester, NewMember) ->
    gen_server:call(?MODULE, {add_member, GroupName, Requester, NewMember}).

%% Adds an already-approved member even if they're offline right now (the
%% Sandesh approval flow -- see sd_reqs -- can complete long after the
%% invitee last connected). Doesn't require Requester to be a member, since
%% by the time this runs the approval, not membership, is the authority.
force_add(GroupName, Requester, NewMember) ->
    gen_server:call(?MODULE, {force_add, GroupName, Requester, NewMember}).

leave_group(GroupName, Username) ->
    gen_server:call(?MODULE, {leave, GroupName, Username}).

list_groups_for(Username) ->
    gen_server:call(?MODULE, {list_for, Username}).

%% [{Name, Members, Owner}] for the groups Username is in (Owner = the group's admin).
list_groups_detailed(Username) ->
    gen_server:call(?MODULE, {list_detailed, Username}).

list_members(GroupName) ->
    gen_server:call(?MODULE, {members, GroupName}).

group_message(GroupName, From, Text) ->
    group_message(GroupName, From, Text, []).

group_message(GroupName, From, Text, ReplyTo) ->
    %% waits longer than the worker (Redis gives up after 5 s); any failure is an error reply, never a crash
    try gen_server:call(?MODULE, {message, GroupName, From, Text, ReplyTo}, 12000)
    catch exit:_ -> {error, unavailable}
    end.

typing(GroupName, From) -> gen_server:cast(?MODULE, {typing, GroupName, From}).
react(GroupName, MessageId, User, Emoji) -> gen_server:cast(?MODULE, {react, GroupName, MessageId, User, Emoji}).
delete(GroupName, MessageId, User) -> gen_server:cast(?MODULE, {delete, GroupName, MessageId, User}).
edit(GroupName, MessageId, User, Text) -> gen_server:cast(?MODULE, {edit, GroupName, MessageId, User, Text}).

%% A short-lived worker does the slow (Redis) part and answers the caller; a failure becomes ErrReply.
offload_reply(From, Fun, ErrReply) ->
    _ = spawn(fun() ->
        Reply = try Fun()
                catch Class:Reason:Stack ->
                    logger:error("chat_groups job failed: ~p:~p at ~p", [Class, Reason, hd(Stack ++ [none])]),
                    ErrReply
                end,
        gen_server:reply(From, Reply)
    end),
    ok.

init([]) ->
    Groups = maps:from_list(
        [{Name, #group{owner = Owner, members = Members}}
         || {Name, Owner, Members} <- chat_store:load_groups()]),
    {ok, #state{groups = Groups}}.

handle_call({create, Name, Owner}, _From, State = #state{groups = Groups}) ->
    case maps:is_key(Name, Groups) of
        true ->
            {reply, {error, exists}, State};
        false ->
            Group = #group{owner = Owner, members = [Owner]},
            chat_writer:run_async(fun() -> chat_store:save_group(Name, Owner, [Owner]) end),
            {reply, {ok, [Owner]}, State#state{groups = maps:put(Name, Group, Groups)}}
    end;
handle_call(all_names, _From, State = #state{groups = Groups}) ->
    {reply, maps:keys(Groups), State};
handle_call({owner, GroupName}, _From, State = #state{groups = Groups}) ->
    case maps:find(GroupName, Groups) of
        {ok, #group{owner = Owner}} -> {reply, {ok, Owner}, State};
        error -> {reply, {error, not_found}, State}
    end;
handle_call({add_member, GroupName, Requester, NewMember}, _From, State = #state{groups = Groups}) ->
    case maps:find(GroupName, Groups) of
        error ->
            {reply, {error, not_found}, State};
        {ok, Group = #group{members = Members}} ->
            case {lists:member(Requester, Members), lists:member(NewMember, Members)} of
                {false, _} ->
                    {reply, {error, not_member}, State};
                _ when Requester =/= Group#group.owner ->
                    {reply, {error, not_owner}, State};
                {true, true} ->
                    {reply, {error, already_member}, State};
                {true, false} ->
                    case chat_room:get_pid(NewMember) of
                        error ->
                            {reply, {error, user_offline}, State};
                        {ok, NewMemberPid} ->
                            NewMembers = lists:usort([NewMember | Members]),
                            NewGroup = Group#group{members = NewMembers},
                            NewGroups = maps:put(GroupName, NewGroup, Groups),
                            chat_writer:run_async(fun() -> chat_store:save_group(GroupName, Group#group.owner, NewMembers) end),
                            NewMemberPid ! {added_to_group, GroupName, NewMembers, Requester},
                            SystemText = io_lib:format("~s added ~s to the group", [Requester, NewMember]),
                            notify_members(Members, [], {group_system, GroupName, SystemText}),
                            {reply, {ok, NewMembers}, State#state{groups = NewGroups}}
                    end
            end
    end;
handle_call({force_add, GroupName, Requester, NewMember}, _From, State = #state{groups = Groups}) ->
    case maps:find(GroupName, Groups) of
        error ->
            {reply, {error, not_found}, State};
        {ok, Group = #group{members = Members}} ->
            case lists:member(NewMember, Members) of
                true ->
                    {reply, {error, already_member}, State};
                false ->
                    NewMembers = lists:usort([NewMember | Members]),
                    chat_writer:run_async(fun() -> chat_store:save_group(GroupName, Group#group.owner, NewMembers) end),
                    case chat_room:get_pid(NewMember) of
                        {ok, Pid} -> Pid ! {added_to_group, GroupName, NewMembers, Requester};
                        error -> ok
                    end,
                    SystemText = io_lib:format("~s added ~s to the group", [Requester, NewMember]),
                    notify_members(Members, [], {group_system, GroupName, SystemText}),
                    {reply, {ok, NewMembers},
                     State#state{groups = maps:put(GroupName, Group#group{members = NewMembers}, Groups)}}
            end
    end;
handle_call({leave, GroupName, Username}, _From, State = #state{groups = Groups}) ->
    case maps:find(GroupName, Groups) of
        error ->
            {reply, {error, not_found}, State};
        {ok, Group = #group{members = Members}} ->
            case lists:member(Username, Members) of
                false ->
                    {reply, {error, not_member}, State};
                true ->
                    NewMembers = lists:delete(Username, Members),
                    SystemText = io_lib:format("~s left the group", [Username]),
                    notify_members(NewMembers, [], {group_system, GroupName, SystemText}),
                    NewGroups = case NewMembers of
                        [] ->
                            chat_writer:run_async(fun() -> chat_store:delete_group(GroupName) end),
                            maps:remove(GroupName, Groups);
                        _ ->
                            chat_writer:run_async(fun() -> chat_store:save_group(GroupName, Group#group.owner, NewMembers) end),
                            maps:put(GroupName, Group#group{members = NewMembers}, Groups)
                    end,
                    {reply, ok, State#state{groups = NewGroups}}
            end
    end;
handle_call({list_for, Username}, _From, State = #state{groups = Groups}) ->
    Result = maps:fold(
        fun(Name, #group{members = Members}, Acc) ->
            case lists:member(Username, Members) of
                true -> [{Name, Members} | Acc];
                false -> Acc
            end
        end, [], Groups),
    {reply, Result, State};
handle_call({list_detailed, Username}, _From, State = #state{groups = Groups}) ->
    Result = maps:fold(
        fun(Name, #group{members = Members, owner = Owner}, Acc) ->
            case lists:member(Username, Members) of
                true -> [{Name, Members, Owner} | Acc];
                false -> Acc
            end
        end, [], Groups),
    {reply, Result, State};
handle_call({members, GroupName}, _From, State = #state{groups = Groups}) ->
    case maps:find(GroupName, Groups) of
        {ok, #group{members = Members}} -> {reply, {ok, Members}, State};
        error -> {reply, {error, not_found}, State}
    end;
handle_call({message, GroupName, From, Text, ReplyTo}, From0, State = #state{groups = Groups}) ->
    case maps:find(GroupName, Groups) of
        error ->
            {reply, {error, not_found}, State};
        {ok, #group{members = Members}} ->
            case lists:member(From, Members) of
                false ->
                    {reply, {error, not_member}, State};
                true ->
                    %% Redis (message id) is awaited by a worker, never by this process
                    offload_reply(From0, fun() ->
                        {Id, Ts} = chat_store:save_message("group:" ++ GroupName, From, Text, group_message, false, ReplyTo),
                        notify_members(Members, [From], {group_message, GroupName, Id, Ts, From, Text, ReplyTo}),
                        chat_link_preview:maybe_fetch_and_notify(Id, Text, fun(MsgId, Preview) ->
                            notify_members(Members, [], {group_link_preview, GroupName, MsgId, Preview})
                        end),
                        {ok, Id, Ts}
                    end, {error, unavailable}),
                    {noreply, State}
            end
    end.

handle_cast({typing, GroupName, From}, State = #state{groups = Groups}) ->
    case maps:find(GroupName, Groups) of
        {ok, #group{members = Members}} ->
            notify_members(Members, [From], {group_typing, GroupName, From});
        error ->
            ok
    end,
    {noreply, State};
handle_cast({react, GroupName, MessageId, User, Emoji}, State = #state{groups = Groups}) ->
    chat_writer:run_async(fun() ->
        case maps:find(GroupName, Groups) of
            {ok, #group{members = Members}} ->
                case chat_store:toggle_reaction(MessageId, User, Emoji) of
                    {ok, Reactions} -> notify_members(Members, [], {group_reaction, GroupName, MessageId, Reactions});
                    {error, not_found} -> ok
                end;
            error ->
                ok
        end
    end),
    {noreply, State};
handle_cast({edit, GroupName, MessageId, User, Text}, State = #state{groups = Groups}) ->
    chat_writer:run_async(fun() ->
        case maps:find(GroupName, Groups) of
            {ok, #group{members = Members}} ->
                case lists:member(User, Members) of
                    false -> ok;
                    true ->
                        case chat_store:edit_message(MessageId, User, "group:" ++ GroupName, Text, chat_room:edit_window_ms()) of
                            {ok, Ts} -> notify_members(Members, [], {group_edited, GroupName, MessageId, Text, Ts});
                            {error, Reason} ->
                                case chat_room:get_pid(User) of
                                    {ok, Pid} -> Pid ! {edit_denied, MessageId, Reason};
                                    error -> ok
                                end
                        end
                end;
            error -> ok
        end
    end),
    {noreply, State};
handle_cast({delete, GroupName, MessageId, User}, State = #state{groups = Groups}) ->
    chat_writer:run_async(fun() ->
        case maps:find(GroupName, Groups) of
            {ok, #group{members = Members}} ->
                case chat_store:delete_message(MessageId, User) of
                    {ok, deleted} -> notify_members(Members, [], {group_deleted, GroupName, MessageId});
                    {error, Reason} ->
                        case chat_room:get_pid(User) of
                            {ok, Pid} -> Pid ! {delete_denied, MessageId, Reason};
                            error -> ok
                        end
                end;
            error ->
                ok
        end
    end),
    {noreply, State};
handle_cast(_Msg, State) -> {noreply, State}.
handle_info(_Msg, State) -> {noreply, State}.
terminate(_Reason, _State) -> ok.
code_change(_Old, State, _Extra) -> {ok, State}.

%% Push Msg to every member in Members except those listed in Exclude,
%% skipping anyone currently offline.
notify_members(Members, Exclude, Msg) ->
    lists:foreach(
        fun(Member) ->
            case lists:member(Member, Exclude) of
                true -> ok;
                false ->
                    case chat_room:get_pid(Member) of
                        {ok, Pid} -> Pid ! Msg;
                        error -> ok
                    end
            end
        end, Members).
