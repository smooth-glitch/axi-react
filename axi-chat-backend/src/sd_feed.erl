%%% The "My Workspace" notification feed: the real notifications behind the right-hand
%%% expandable panel. Every item comes from something that actually happened -- an approval
%%% waiting on you, a message from someone, a due reminder, a form submitted to you, a security
%%% event on your account -- never from a preset.
%%%
%%% It is deliberately shaped like the object the panel already renders, so the frontend swaps
%%% its hard-coded list for this one with no remapping:
%%%   id, priority (high|medium|low|resolved), category, title, message, ts, icon, read,
%%%   actionType, actionLabel, chatId?, plus `ref` (what it is about), `count` (coalesced
%%%   messages) and `resolved`/`resolvedTs`.
%%%
%%% This is a SEPARATE layer from sd_cards' notifications.* (the spec's four badge categories:
%%% priority / pending / personal / reminders). Those stay exactly as they were; this feed is
%%% the richer inbox for the workspace panel: severity colours, resolve, dismiss, actions.
%%%
%%% Priority: an item has a `severity` (high|medium|low) set when it is created. `priority` is
%%% the severity, or "resolved" once the item has been resolved (by the user, or automatically
%%% when e.g. an approval is answered). New activity on a coalesced item re-opens it.
%%%
%%% Sources (all wired at the place the event happens):
%%%   sd_cards:add        -> DMs, group messages, approval requests, due reminders  (from_card/2)
%%%   sd_reqs             -> approval answered (resolves approvers' items, tells the requester)
%%%   sd_cmds submissions -> a form submitted to its host / admins
%%%   sd_auth / sd_totp   -> new sign-in ended your other session, account locked, password
%%%                          changed, 2FA disabled, recovery codes regenerated
%%%
%%% Storage per user: `sd:feed:<u>` (sorted set, score = last activity ms, member = id),
%%% `sd:feedi:<u>` (hash id -> JSON), `sd:feedk:<u>` (hash coalescing key -> id). Newest ?MAX
%%% kept. Offline users accumulate items and read them with feed.list when they connect; the
%%% live push (feed_item / feed_removed / feed_changed) is only a convenience.
-module(sd_feed).
-export([from_card/2, notify/3, dm_read/2, resolve_request/2, request_outcome/3,
         submission_created/1, security/3,
         call/3, list/2, summary/1]).
-include_lib("kernel/include/logger.hrl").

-define(MAX, 300).
-define(SEVERITIES, [<<"high">>, <<"medium">>, <<"low">>]).
-define(PRIORITIES, [<<"all">>, <<"high">>, <<"medium">>, <<"low">>, <<"resolved">>]).

%% ---- the API surface shared by the WebSocket (`/sd feed.*`) and REST (`/api/sd/feed*`) ---------

%% Action: list | summary | read | resolve | dismiss | clear.   Returns {ok, Map} | {error, Code, Msg}.
call(<<"list">>, User, Args) ->
    Priority = case sd_util:get(<<"priority">>, Args, <<"all">>) of P when is_binary(P) -> P; _ -> <<"all">> end,
    case lists:member(Priority, ?PRIORITIES) of
        false -> {error, invalid, <<"priority must be one of: all, high, medium, low, resolved.">>};
        true ->
            Opts = #{priority => Priority,
                     category => case sd_util:get(<<"category">>, Args) of C when is_binary(C) -> C; _ -> undefined end,
                     unread => sd_util:get(<<"unreadOnly">>, Args, false) =:= true,
                     before => case sd_util:get(<<"before">>, Args) of B when is_integer(B) -> B; _ -> undefined end,
                     limit => case sd_util:get(<<"limit">>, Args, 50) of L when is_integer(L) -> L; _ -> 50 end},
            {ok, list(User, Opts)}
    end;
call(<<"summary">>, User, _Args) ->
    {ok, summary(User)};
call(<<"read">>, User, Args) ->
    Read = sd_util:get(<<"read">>, Args, true) =/= false,   %% read:false = mark UNread (the panel's toggle)
    case {sd_util:get(<<"all">>, Args, false), sd_util:get(<<"ids">>, Args)} of
        {true, _} -> {ok, mark_read(User, all, Read)};
        {_, Ids} when is_list(Ids) ->
            case Ids =/= [] andalso lists:all(fun is_binary/1, Ids) of
                true -> {ok, mark_read(User, {ids, Ids}, Read)};
                false -> {error, invalid, <<"ids must be a non-empty list of notification ids.">>}
            end;
        _ -> {error, invalid, <<"Send {\"ids\":[...]} or {\"all\":true} (optionally \"read\":false to mark unread).">>}
    end;
call(<<"resolve">>, User, Args) ->
    with_id(Args, fun(Id) -> resolve(User, Id) end);
call(<<"dismiss">>, User, Args) ->
    with_id(Args, fun(Id) -> dismiss(User, Id) end);
call(<<"clear">>, User, _Args) ->
    {ok, clear_resolved(User)};
call(_, _, _) ->
    {error, not_found, <<"No such feed action.">>}.

with_id(Args, Fun) ->
    case sd_util:get(<<"id">>, Args) of
        Id when is_binary(Id), Id =/= <<>> -> Fun(Id);
        _ -> {error, invalid, <<"id is required.">>}
    end.

%% ---- reading -------------------------------------------------------------------------------------

%% #{notifications => [Item], counts => Counts, hasMore => bool}. Newest activity first.
list(User, Opts) ->
    U = sd_util:norm_user(User),
    All = load(U),
    Views = [view(I) || I <- All],
    Filtered = [V || V <- Views, matches(V, Opts)],
    Limit = max(1, min(maps:get(limit, Opts, 50), 200)),
    Page = lists:sublist(Filtered, Limit),
    #{<<"notifications">> => Page, <<"counts">> => counts(Views),
      <<"hasMore">> => length(Filtered) > Limit}.

matches(V, Opts) ->
    (maps:get(priority, Opts, <<"all">>) =:= <<"all">> orelse maps:get(<<"priority">>, V) =:= maps:get(priority, Opts))
    andalso (case maps:get(category, Opts, undefined) of undefined -> true; C -> maps:get(<<"category">>, V) =:= C end)
    andalso (maps:get(unread, Opts, false) =/= true orelse maps:get(<<"read">>, V) =:= false)
    andalso (case maps:get(before, Opts, undefined) of undefined -> true; T -> maps:get(<<"ts">>, V) < T end).

%% #{high, medium, low, resolved, unread, total}  -- exactly the panel's tab badges + "N unread".
summary(User) ->
    counts([view(I) || I <- load(sd_util:norm_user(User))]).

counts(Views) ->
    Zero = #{<<"high">> => 0, <<"medium">> => 0, <<"low">> => 0, <<"resolved">> => 0,
             <<"unread">> => 0, <<"total">> => length(Views)},
    lists:foldl(
        fun(V, Acc) ->
            A1 = maps:update_with(maps:get(<<"priority">>, V), fun(N) -> N + 1 end, Acc),
            case maps:get(<<"read">>, V) of
                false -> maps:update_with(<<"unread">>, fun(N) -> N + 1 end, A1);
                true -> A1
            end
        end, Zero, Views).

%% Newest activity first; the sorted set is the index, the hash holds the documents.
load(U) ->
    case sd_db:zrevrange(zset(U), 0, ?MAX - 1) of
        [] -> [];
        Ids ->
            Docs = sd_db:q(["HMGET", hash(U) | Ids]),
            [I || Bin <- Docs, Bin =/= undefined, {ok, I} <- [sd_util:jdec(Bin)], is_map(I)]
    end.

%% What clients receive: the stored item with `priority` derived from severity/resolved.
view(I) ->
    Resolved = maps:get(<<"resolved">>, I, false) =:= true,
    (maps:without([<<"key">>], I))#{
        <<"priority">> => case Resolved of true -> <<"resolved">>; false -> maps:get(<<"severity">>, I, <<"low">>) end,
        <<"resolved">> => Resolved}.

%% ---- changing state --------------------------------------------------------------------------------

%% Read (or, Read=false, unread) by ids or all.
mark_read(User, Spec, Read) ->
    U = sd_util:norm_user(User),
    Changed = update_where(U,
        fun(I) ->
            maps:get(<<"read">>, I, false) =/= Read andalso
                case Spec of all -> true; {ids, Ids} -> lists:member(maps:get(<<"id">>, I), Ids) end
        end,
        fun(I) -> I#{<<"read">> => Read} end),
    push_counts(U),
    #{<<"updated">> => length(Changed), <<"counts">> => summary(U)}.

%% The user marks an item done: it turns green ("resolved") and counts as read.
resolve(User, Id) ->
    U = sd_util:norm_user(User),
    case get_item(U, Id) of
        undefined -> {error, not_found, <<"No such notification.">>};
        I ->
            New = I#{<<"resolved">> => true, <<"resolvedTs">> => sd_util:now_ms(), <<"read">> => true},
            put_item(U, New, keep_ts),
            push_item(U, New),
            {ok, #{<<"notification">> => view(New), <<"counts">> => summary(U)}}
    end.

dismiss(User, Id) ->
    U = sd_util:norm_user(User),
    case get_item(U, Id) of
        undefined -> {error, not_found, <<"No such notification.">>};
        _ ->
            remove(U, [Id]),
            push_removed(U, [Id]),
            {ok, #{<<"dismissed">> => true, <<"counts">> => summary(U)}}
    end.

%% "Clear Resolved": removes every resolved item.
clear_resolved(User) ->
    U = sd_util:norm_user(User),
    Ids = [maps:get(<<"id">>, I) || I <- load(U), maps:get(<<"resolved">>, I, false) =:= true],
    Ids =/= [] andalso (remove(U, Ids) =:= ok) andalso push_removed(U, Ids),
    #{<<"cleared">> => length(Ids), <<"counts">> => summary(U)}.

%% Applies Change to every item Pred accepts; returns those items (as changed).
update_where(U, Pred, Change) ->
    Hit = [Change(I) || I <- load(U), Pred(I)],
    lists:foreach(fun(I) -> put_item(U, I, keep_ts) end, Hit),
    Hit.

remove(U, Ids) ->
    lists:foreach(fun(Id) -> sd_db:hdel(hash(U), Id), sd_db:q(["ZREM", zset(U), Id]) end, Ids),
    ok.

%% ---- writing items (called from the places events happen) -------------------------------------------------

%% Spec: severity, category, title, message + optional key (coalescing), icon, actionType,
%% actionLabel, chatId, chat, ref, from. A second item with the same `key` UPDATES the first
%% (count + 1, latest message, unread again, re-opened) instead of piling up.
notify(User, Spec, _Opts) when is_map(Spec) ->
    U = sd_util:norm_user(User),
    case sd_users:exists(U) of
        false -> skipped;
        true ->
            Now = sd_util:now_ms(),
            Item = case existing(U, maps:get(<<"key">>, Spec, undefined)) of
                       undefined ->
                           Spec#{<<"id">> => sd_util:rand_token(), <<"ts">> => Now, <<"count">> => 1,
                                 <<"read">> => false, <<"resolved">> => false, <<"resolvedTs">> => null};
                       Old ->
                           maps:merge(Old, Spec#{<<"ts">> => Now,
                                                 <<"count">> => maps:get(<<"count">>, Old, 1) + 1,
                                                 <<"read">> => false, <<"resolved">> => false,
                                                 <<"resolvedTs">> => null})
                   end,
            Clean = Item#{<<"severity">> => severity(maps:get(<<"severity">>, Item, <<"low">>))},
            put_item(U, Clean, bump_ts),
            case maps:get(<<"key">>, Clean, undefined) of
                undefined -> ok;
                K -> sd_db:hset(keys(U), K, maps:get(<<"id">>, Clean))
            end,
            trim(U),
            push_item(U, Clean),
            {ok, view(Clean)}
    end.

severity(S) -> case lists:member(S, ?SEVERITIES) of true -> S; false -> <<"low">> end.

existing(_U, undefined) -> undefined;
existing(U, Key) ->
    case sd_db:hget(keys(U), Key) of
        undefined -> undefined;
        Id -> get_item(U, Id)     %% undefined if it was dismissed/trimmed since
    end.

get_item(U, Id) ->
    case sd_db:hget(hash(U), Id) of
        undefined -> undefined;
        Bin -> case sd_util:jdec(Bin) of {ok, I} when is_map(I) -> I; _ -> undefined end
    end.

%% keep_ts: leave the item where it sits (state changes don't reorder). bump_ts: it just had activity.
put_item(U, Item, Mode) ->
    Id = maps:get(<<"id">>, Item),
    sd_db:hset_json(hash(U), Id, Item),
    case Mode of
        bump_ts -> sd_db:zadd(zset(U), maps:get(<<"ts">>, Item), Id);
        keep_ts -> sd_db:q(["ZADD", zset(U), "XX", integer_to_list(maps:get(<<"ts">>, Item)), Id])
    end,
    ok.

trim(U) ->
    Z = zset(U),
    N = binary_to_integer(sd_db:q(["ZCARD", Z])),
    case N > ?MAX of
        false -> ok;
        true ->
            Old = sd_db:q(["ZRANGE", Z, "0", integer_to_list(N - ?MAX - 1)]),
            remove(U, Old)
    end.

zset(U) -> "sd:feed:" ++ sd_util:s(U).
hash(U) -> "sd:feedi:" ++ sd_util:s(U).
keys(U) -> "sd:feedk:" ++ sd_util:s(U).

%% ---- live pushes ------------------------------------------------------------------------------------------------
%%   feed_item     {notification, counts}   new or changed item -- upsert it by id
%%   feed_removed  {ids, counts}            dismissed / cleared
%%   feed_changed  {counts}                 bulk read/unread (also reaches the user's other tabs)

push_item(U, Item) ->
    is_online(U) andalso
        sd_notify:push_event(U, <<"feed_item">>, #{<<"notification">> => view(Item), <<"counts">> => summary(U)}),
    ok.

push_removed(U, Ids) ->
    is_online(U) andalso
        sd_notify:push_event(U, <<"feed_removed">>, #{<<"ids">> => Ids, <<"counts">> => summary(U)}),
    ok.

push_counts(U) ->
    is_online(U) andalso sd_notify:push_event(U, <<"feed_changed">>, #{<<"counts">> => summary(U)}),
    ok.

is_online(U) -> chat_room:get_pid(sd_util:s(U)) =/= error.

%% ---- sources ----------------------------------------------------------------------------------------------------------

%% From every sd_cards card, as it is created (a due reminder: when it fires). Never lets a
%% feed problem break the message/request that triggered it.
from_card(User, Card) ->
    try from_card_(sd_util:norm_user(User), Card)
    catch C:R -> ?LOG_WARNING("sd_feed:from_card failed: ~p:~p", [C, R]), ok
    end.

from_card_(U, #{<<"kind">> := <<"dm">>, <<"from">> := From} = Card) ->
    F = sd_util:norm_user(From),
    notify(U, #{<<"key">> => <<"dm:", F/binary>>, <<"severity">> => urgent_or(Card, <<"medium">>),
                <<"category">> => <<"messages">>, <<"title">> => display(F),
                <<"message">> => clip(maps:get(<<"text">>, Card, <<>>)), <<"icon">> => <<"chat">>,
                <<"actionType">> => <<"open_chat">>, <<"actionLabel">> => <<"Open chat">>,
                <<"chatId">> => <<"user-", F/binary>>,
                <<"chat">> => #{<<"scope">> => <<"dm">>, <<"with">> => F},
                <<"from">> => F}, []);
from_card_(U, #{<<"kind">> := <<"group">>, <<"from">> := From, <<"chat">> := #{<<"group">> := G}} = Card) ->
    notify(U, #{<<"key">> => <<"group:", G/binary>>, <<"severity">> => urgent_or(Card, <<"low">>),
                <<"category">> => <<"messages">>, <<"title">> => G,
                <<"message">> => <<(display(From))/binary, ": ", (clip(maps:get(<<"text">>, Card, <<>>)))/binary>>,
                <<"icon">> => <<"forum">>, <<"actionType">> => <<"open_chat">>,
                <<"actionLabel">> => <<"Open group">>, <<"chatId">> => <<"room-", G/binary>>,
                <<"chat">> => #{<<"scope">> => <<"group">>, <<"group">> => G},
                <<"from">> => sd_util:norm_user(From)}, []);
from_card_(U, #{<<"kind">> := <<"request">>, <<"ref">> := #{<<"requestId">> := ReqId} = Ref} = Card) ->
    notify(U, #{<<"key">> => <<"req:", (integer_to_binary(ReqId))/binary>>, <<"severity">> => <<"high">>,
                <<"category">> => <<"approvals">>, <<"title">> => request_title(maps:get(<<"type">>, Ref, <<>>)),
                <<"message">> => maps:get(<<"text">>, Card, <<>>), <<"icon">> => <<"how_to_reg">>,
                <<"actionType">> => <<"approvals">>, <<"actionLabel">> => <<"Review approval">>,
                <<"ref">> => Ref, <<"from">> => sd_util:norm_user(maps:get(<<"from">>, Card, <<>>))}, []);
from_card_(U, #{<<"kind">> := <<"reminder">>, <<"id">> := CardId} = Card) ->
    case maps:get(<<"dueTs">>, Card, null) of
        T when is_integer(T), T > 0 ->
            case T > sd_util:now_ms() of
                true -> skipped;                     %% not due yet: sd_scheduler calls again when it is
                false -> reminder_item(U, CardId, Card)
            end;
        _ -> reminder_item(U, CardId, Card)
    end;
from_card_(U, #{<<"kind">> := <<"system">>} = Card) ->
    notify(U, #{<<"severity">> => <<"low">>, <<"category">> => <<"system">>, <<"title">> => <<"System notice">>,
                <<"message">> => clip(maps:get(<<"text">>, Card, <<>>)), <<"icon">> => <<"info">>}, []);
from_card_(_, _) -> ok.

reminder_item(U, CardId, Card) ->
    notify(U, #{<<"key">> => <<"rem:", CardId/binary>>, <<"severity">> => <<"medium">>,
                <<"category">> => <<"reminders">>, <<"title">> => <<"Reminder">>,
                <<"message">> => clip(maps:get(<<"text">>, Card, <<>>)), <<"icon">> => <<"alarm">>,
                <<"ref">> => #{<<"cardId">> => CardId}}, []).

%% Text marked urgent ("!" prefix, #urgent, #priority -- sd_cards' own rule) is high, otherwise Default.
urgent_or(Card, Default) ->
    case sd_cards:category(Card) of <<"priority">> -> <<"high">>; _ -> Default end.

request_title(<<"onboarding">>) -> <<"New user awaiting approval">>;
request_title(<<"associate">>) -> <<"Connection request">>;
request_title(<<"host_transfer">>) -> <<"Host transfer request">>;
request_title(<<"group_invite">>) -> <<"Group invitation">>;
request_title(_) -> <<"Approval needed">>.

%% Opening a DM (`/read dm <user>`) reads that person's item.
dm_read(User, Other) ->
    U = sd_util:norm_user(User),
    Key = <<"dm:", (sd_util:norm_user(Other))/binary>>,
    case existing(U, Key) of
        undefined -> ok;
        #{<<"read">> := true} -> ok;
        Item -> New = Item#{<<"read">> => true}, put_item(U, New, keep_ts), push_item(U, New)
    end.

%% An answered approval is done for every approver: their item turns green.
resolve_request(User, ReqId) ->
    U = sd_util:norm_user(User),
    case existing(U, <<"req:", (integer_to_binary(ReqId))/binary>>) of
        undefined -> ok;
        #{<<"resolved">> := true} -> ok;
        Item ->
            New = Item#{<<"resolved">> => true, <<"resolvedTs">> => sd_util:now_ms(), <<"read">> => true},
            put_item(U, New, keep_ts), push_item(U, New)
    end.

%% Tells whoever raised a request how it went (onboarding excluded: that person has no session yet
%% and is told by email/SMS already).
request_outcome(_Req, _Status, undefined) -> ok;
request_outcome(#{<<"type">> := <<"onboarding">>}, _, _) -> ok;
request_outcome(#{<<"from">> := From, <<"id">> := Id, <<"type">> := Type}, Status, ByName)
        when Status =:= <<"accepted">>; Status =:= <<"rejected">> ->
    Approved = Status =:= <<"accepted">>,
    Verb = case Approved of true -> <<"approved">>; false -> <<"declined">> end,
    Thing = case Type of
                <<"associate">> -> <<"connection request">>;
                <<"host_transfer">> -> <<"host transfer request">>;
                <<"group_invite">> -> <<"group invitation">>;
                _ -> <<"request">>
            end,
    catch notify(From, #{<<"key">> => <<"outcome:", (integer_to_binary(Id))/binary>>,
                         <<"severity">> => <<"low">>, <<"category">> => <<"approvals">>,
                         <<"title">> => case Approved of true -> <<"Request approved">>; false -> <<"Request declined">> end,
                         <<"message">> => <<ByName/binary, " ", Verb/binary, " your ", Thing/binary, ".">>,
                         <<"icon">> => case Approved of true -> <<"verified_user">>; false -> <<"block">> end,
                         <<"actionType">> => <<"approvals">>, <<"actionLabel">> => <<"View record">>,
                         <<"ref">> => #{<<"requestId">> => Id, <<"type">> => Type}}, []),
    ok;
request_outcome(_, _, _) -> ok.

%% A form was submitted: tell its host and the admins (not the person who submitted it).
submission_created(Sub) ->
    try
        By = sd_util:norm_user(maps:get(<<"by">>, Sub, <<>>)),
        Host = case maps:get(<<"host">>, Sub, null) of H when is_binary(H) -> [sd_util:norm_user(H)]; _ -> [] end,
        Admins = [sd_util:norm_user(maps:get(<<"username">>, A)) || A <- sd_users:admins()],
        Tstruct = sd_util:b(maps:get(<<"tstruct">>, Sub, <<"form">>)),
        Id = sd_util:b(maps:get(<<"id">>, Sub)),
        lists:foreach(
            fun(U) ->
                notify(U, #{<<"key">> => <<"sub:", Id/binary>>, <<"severity">> => <<"medium">>,
                            <<"category">> => <<"submissions">>, <<"title">> => <<"New submission: ", Tstruct/binary>>,
                            <<"message">> => <<(display(By))/binary, " submitted ", Tstruct/binary, ".">>,
                            <<"icon">> => <<"assignment_turned_in">>, <<"actionType">> => <<"submissions">>,
                            <<"actionLabel">> => <<"View submission">>,
                            <<"ref">> => #{<<"submissionId">> => maps:get(<<"id">>, Sub), <<"tstruct">> => Tstruct},
                            <<"from">> => By}, [])
            end, [U || U <- lists:usort(Host ++ Admins), U =/= By])
    catch C:R -> ?LOG_WARNING("sd_feed:submission_created failed: ~p:~p", [C, R]), ok
    end.

%% Account security events, addressed to the account holder.
%% Kind: session_replaced | account_locked | password_changed | totp_disabled | recovery_regenerated
security(User, Kind, _Extra) ->
    try
        {Sev, Title, Msg, Icon} = security_text(Kind),
        notify(User, #{<<"severity">> => Sev, <<"category">> => <<"security">>, <<"title">> => Title,
                       <<"message">> => Msg, <<"icon">> => Icon, <<"actionType">> => <<"none">>}, [])
    catch C:R -> ?LOG_WARNING("sd_feed:security failed: ~p:~p", [C, R]), ok
    end.

security_text(session_replaced) ->
    {<<"medium">>, <<"Signed in on another device">>,
     <<"A new sign-in ended your other active session. If that wasn't you, change your password.">>, <<"devices">>};
security_text(account_locked) ->
    {<<"high">>, <<"Account temporarily locked">>,
     <<"Too many failed sign-in attempts. It unlocks automatically in a few minutes. If that wasn't you, tell your administrator.">>,
     <<"lock">>};
security_text(password_changed) ->
    {<<"low">>, <<"Password changed">>, <<"Your password was changed.">>, <<"password">>};
security_text(totp_disabled) ->
    {<<"high">>, <<"Two-factor authentication turned off">>,
     <<"The authenticator app was removed from your account. If that wasn't you, contact your administrator.">>, <<"security">>};
security_text(recovery_regenerated) ->
    {<<"medium">>, <<"Recovery codes regenerated">>,
     <<"Your old recovery codes no longer work. Use the new set.">>, <<"key">>}.

%% ---- small helpers ------------------------------------------------------------------------------------------

display(Username) ->
    case sd_users:get(Username) of
        #{<<"name">> := N} when is_binary(N), N =/= <<>> -> N;
        _ -> sd_util:b(Username)
    end.

%% Messages can be long; the panel shows a preview. 200 characters, on a code-point boundary.
clip(Text) ->
    B = sd_util:b(Text),
    case string:length(B) > 200 of
        true -> unicode:characters_to_binary([string:slice(B, 0, 199), <<"…"/utf8>>]);
        false -> B
    end.
