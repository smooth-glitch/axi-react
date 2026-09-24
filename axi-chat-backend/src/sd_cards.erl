%%% The spec's home-page "right section": messages from different sources
%%% shown as cards (sender, time, text) and classified into priority,
%%% pending, reminders, updates, general and personal -- plus sections users
%%% add themselves with rules that decide which messages land in them.
%%%
%%% Cards are a per-user inbox *index* over messages the backend already
%%% delivers (DMs, group messages) and over system events (approval
%%% requests, reminders). A card carries a `chat` reference -- the frontend
%%% uses it to open the sender's conversation when a card is selected
%%% ("When a message is selected, the message will be displayed in the chat
%%% window of the sender.").
%%%
%%% Storage per user: `sd:cards:<u>` (sorted set, score = ts, member = card
%%% id) + `sd:card:<u>` (hash id -> JSON), capped at ?MAX_CARDS newest.
%%% Sections: `sd:sections:<u>` (one JSON list of the user's custom ones).
%%%
%%% Classification order (first match wins):
%%%   1. the user's own sections, in order, by their rules
%%%   2. kind = request  -> pending      (an approval waiting on them)
%%%      kind = reminder -> reminders
%%%      kind = system   -> updates
%%%   3. text marked urgent ("!" prefix, #urgent, #priority) -> priority
%%%   4. kind = dm    -> personal
%%%      kind = group / host / anything else -> general
%%%
%%% Notifications are a layer over cards: exactly four categories notify --
%%% priority, pending, personal, reminders -- decided by the built-in
%%% classification (so a user's own custom sections can't silence them).
%%% "updates" and "general" cards exist but never notify. Every card starts
%%% unread; the notification counts are the unread cards in those four
%%% categories. A reminder only notifies once it is due (sd_scheduler fires
%%% due reminders); a pending card stops notifying when its request is
%%% answered; personal cards from a sender are read when the user sends
%%% `/read dm <sender>` (which the chat UI already does on opening a DM).
-module(sd_cards).
-export([add/2, record_dm/5, record_group/6, add_reminder/3,
         list/3, dismiss/2, sections/1, save_section/2, delete_section/2,
         builtin_sections/0, classify/2,
         summary/1, notifications/4, mark_read/2, mark_dm_read/2, resolve_request/2,
         fire_due/0, categories/0]).

-define(NOTIFY_CATEGORIES, [<<"priority">>, <<"pending">>, <<"personal">>, <<"reminders">>]).
-define(REMINDERS_ZSET, "sd:reminders").

categories() -> ?NOTIFY_CATEGORIES.

-define(MAX_CARDS, 500).
-define(MAX_CUSTOM_SECTIONS, 20).
-define(MAX_RULES, 20).

builtin_sections() ->
    [#{<<"id">> => Id, <<"name">> => Name, <<"builtin">> => true}
     || {Id, Name} <- [{<<"priority">>, <<"Priority">>}, {<<"pending">>, <<"Pending">>},
                       {<<"reminders">>, <<"Reminders">>}, {<<"updates">>, <<"Updates">>},
                       {<<"general">>, <<"General">>}, {<<"personal">>, <<"Personal">>}]].

%% ---- writing cards ---------------------------------------------------------------------------

%% Card: kind, from, text and optionally chat / ref / dueTs. id and ts are
%% filled in. Also pushed live to the user if they're connected.
add(User, Card) when is_map(Card) ->
    U = sd_util:norm_user(User),
    Id = sd_util:rand_token(),
    Full = Card#{<<"id">> => Id, <<"ts">> => maps:get(<<"ts">>, Card, sd_util:now_ms()),
                 <<"read">> => false},
    sd_db:hset_json(card_hash(U), Id, Full),
    sd_db:zadd(card_zset(U), maps:get(<<"ts">>, Full), Id),
    trim(U),
    Classified = decorate(Full, custom_sections(U)),
    sd_notify:push_event(U, <<"card">>, Classified),
    push_notification(U, Classified),
    {ok, Classified}.

%% A brand-new card that is a live notification (right category, and -- for a
%% reminder -- already due) is pushed with the fresh counts, so a badge can
%% update without a round trip. Offline users get nothing here; they read
%% notifications.summary when they connect.
push_notification(U, Card) ->
    case notifying(Card) andalso is_online(U) of
        true ->
            sd_notify:push_event(U, <<"notification">>,
                                 #{<<"card">> => Card, <<"category">> => category(Card),
                                   <<"counts">> => summary(U)});
        false -> ok
    end.

push_counts(U) ->
    case is_online(U) of
        true -> sd_notify:push_event(U, <<"notifications_changed">>, summary(U));
        false -> ok
    end.

is_online(U) -> chat_room:get_pid(sd_util:s(U)) =/= error.

%% section (custom sections first) + notification category + read/due flags.
decorate(Card, Custom) ->
    Card#{<<"section">> => classify(Card, Custom),
          <<"category">> => category(Card),
          <<"read">> => maps:get(<<"read">>, Card, false),
          <<"due">> => is_due(Card)}.

%% A DM was just delivered/queued to `To`.
record_dm(To, MsgId, Ts, From, Text) ->
    case sd_users:exists(To) of
        false -> ok;
        true ->
            add(To, #{<<"kind">> => <<"dm">>, <<"from">> => sd_util:b(From), <<"text">> => sd_util:b(Text),
                      <<"ts">> => Ts, <<"chat">> => #{<<"scope">> => <<"dm">>, <<"with">> => sd_util:b(From)},
                      <<"messageId">> => MsgId}),
            ok
    end.

%% A group message: one card for every member except the sender.
record_group(Members, From, Group, MsgId, Ts, Text) ->
    lists:foreach(
        fun(M) ->
            case sd_util:norm_user(M) =/= sd_util:norm_user(From) andalso sd_users:exists(M) of
                true ->
                    add(M, #{<<"kind">> => <<"group">>, <<"from">> => sd_util:b(From),
                             <<"text">> => sd_util:b(Text), <<"ts">> => Ts,
                             <<"chat">> => #{<<"scope">> => <<"group">>, <<"group">> => sd_util:b(Group)},
                             <<"messageId">> => MsgId});
                false -> ok
            end
        end, Members),
    ok.

%% DueTs: null / a time in the past = notify now; a future epoch-ms time =
%% notify then (sd_scheduler fires it). Either way the card exists at once.
add_reminder(User, Text, DueTs) ->
    U = sd_util:norm_user(User),
    Future = is_integer(DueTs) andalso DueTs > sd_util:now_ms(),
    {ok, Card} = add(U, #{<<"kind">> => <<"reminder">>, <<"from">> => U,
                          <<"text">> => Text, <<"dueTs">> => DueTs}),
    Future andalso sd_db:zadd(?REMINDERS_ZSET, DueTs, <<U/binary, "|", (maps:get(<<"id">>, Card))/binary>>),
    {ok, Card}.

%% Called on a timer (sd_scheduler): every reminder whose time has come
%% becomes a live notification. ZREM is the claim -- only the caller that
%% actually removes the entry fires it, so two nodes (or a slow tick) can
%% never double-notify.
fire_due() ->
    Now = sd_util:now_ms(),
    Due = sd_db:q(["ZRANGEBYSCORE", ?REMINDERS_ZSET, "-inf", integer_to_list(Now), "LIMIT", "0", "200"]),
    lists:foreach(
        fun(Member) ->
            case sd_db:q(["ZREM", ?REMINDERS_ZSET, Member]) of
                <<"1">> -> fire(Member);
                _ -> ok
            end
        end, Due),
    length(Due).

fire(Member) ->
    case binary:split(Member, <<"|">>) of
        [U, CardId] ->
            case sd_db:hget_json(card_hash(U), CardId) of
                Card when is_map(Card) -> push_notification(U, decorate(Card, custom_sections(U)));
                _ -> ok    %% dismissed before it was due
            end;
        _ -> ok
    end.

trim(U) ->
    Z = card_zset(U),
    N = binary_to_integer(sd_db:q(["ZCARD", Z])),
    case N > ?MAX_CARDS of
        false -> ok;
        true ->
            Old = sd_db:q(["ZRANGE", Z, "0", integer_to_list(N - ?MAX_CARDS - 1)]),
            lists:foreach(fun(Id) -> sd_db:hdel(card_hash(U), Id) end, Old),
            sd_db:ztrim(Z, ?MAX_CARDS)
    end.

card_zset(U) -> "sd:cards:" ++ sd_util:s(U).
card_hash(U) -> "sd:card:" ++ sd_util:s(U).

%% ---- reading -------------------------------------------------------------------------------------

%% Section: <<"all">> or a section id. Newest first.
list(User, Section, Limit) ->
    U = sd_util:norm_user(User),
    Custom = custom_sections(U),
    Cards = [decorate(C, Custom) || C <- load_cards(U)],
    Filtered = case Section of
                   <<"all">> -> Cards;
                   _ -> [C || C <- Cards, maps:get(<<"section">>, C) =:= Section]
               end,
    lists:sublist(Filtered, max(1, min(Limit, 200))).

%% The user's newest 500 cards (the retention cap), one Redis round trip.
load_cards(U) ->
    case sd_db:zrevrange(card_zset(U), 0, 499) of
        [] -> [];
        Ids ->
            Docs = sd_db:q(["HMGET", card_hash(U) | Ids]),
            [C || Bin <- Docs, Bin =/= undefined, {ok, C} <- [sd_util:jdec(Bin)], is_map(C)]
    end.

%% ---- notifications ----------------------------------------------------------------------------------

%% priority | pending | personal | reminders -- or `none` for updates/general
%% (and any custom section). Uses the built-in classification on purpose.
category(Card) ->
    case builtin_class(Card) of
        C when C =:= <<"priority">>; C =:= <<"pending">>; C =:= <<"personal">>; C =:= <<"reminders">> -> C;
        _ -> null
    end.

%% A reminder with no dueTs, or one in the past, is due.
is_due(#{<<"dueTs">> := T}) when is_integer(T) -> T =< sd_util:now_ms();
is_due(_) -> true.

%% Unread, in one of the four categories, and (for reminders) due.
notifying(Card) ->
    maps:get(<<"read">>, Card, false) =/= true andalso category(Card) =/= null andalso is_due(Card).

%% #{counts => #{priority, pending, personal, reminders}, total, personalBySender}
summary(User) ->
    U = sd_util:norm_user(User),
    Live = [C || C <- load_cards(U), notifying(C)],
    Zero = maps:from_list([{K, 0} || K <- ?NOTIFY_CATEGORIES]),
    Counts = lists:foldl(fun(C, Acc) -> maps:update_with(category(C), fun(N) -> N + 1 end, Acc) end, Zero, Live),
    BySender = lists:foldl(
        fun(#{<<"kind">> := <<"dm">>, <<"from">> := F} = C, Acc) ->
                case category(C) of
                    <<"personal">> -> maps:update_with(F, fun(N) -> N + 1 end, 1, Acc);
                    _ -> Acc
                end;
           (_, Acc) -> Acc
        end, #{}, Live),
    #{<<"counts">> => Counts, <<"total">> => length(Live), <<"personalBySender">> => BySender}.

%% Category: <<"all">> (the four notifying ones) or one of them.
%% UnreadOnly=true -> only live notifications; false -> read ones too, and
%% reminders that aren't due yet ("due":false) so an "upcoming" list is possible.
notifications(User, Category, UnreadOnly, Limit) ->
    U = sd_util:norm_user(User),
    Custom = custom_sections(U),
    Cards = [decorate(C, Custom) || C <- load_cards(U), category(C) =/= null],
    ByCat = case Category of
                <<"all">> -> Cards;
                _ -> [C || C <- Cards, maps:get(<<"category">>, C) =:= Category]
            end,
    Shown = case UnreadOnly of
                true -> [C || C <- ByCat, notifying(C)];
                false -> ByCat
            end,
    lists:sublist(Shown, max(1, min(Limit, 200))).

%% Spec: {ids, [CardId]} | {category, Cat} | all. Returns the new summary
%% and tells a connected user's other tabs/devices via notifications_changed.
mark_read(User, Spec) ->
    U = sd_util:norm_user(User),
    Wanted = fun(C) ->
                 case Spec of
                     all -> notifying(C);
                     {category, Cat} -> notifying(C) andalso category(C) =:= Cat;
                     {ids, Ids} -> lists:member(maps:get(<<"id">>, C), Ids)
                 end
             end,
    mark_where(U, Wanted),
    push_counts(U),
    summary(U).

%% Reading a DM thread (the chat UI sends `/read dm <user>` when one is
%% opened) clears the personal notifications from that person.
mark_dm_read(User, Other) ->
    U = sd_util:norm_user(User), O = sd_util:norm_user(Other),
    N = mark_where(U, fun(#{<<"kind">> := <<"dm">>, <<"from">> := F} = C) ->
                              maps:get(<<"read">>, C, false) =/= true andalso sd_util:norm_user(F) =:= O;
                         (_) -> false
                      end),
    N > 0 andalso push_counts(U),
    ok.

%% An approval that has been answered is no longer "pending" for anyone.
resolve_request(User, RequestId) ->
    U = sd_util:norm_user(User),
    N = mark_where(U, fun(#{<<"ref">> := #{<<"requestId">> := Id}} = C) ->
                              Id =:= RequestId andalso maps:get(<<"read">>, C, false) =/= true;
                         (_) -> false
                      end),
    N > 0 andalso push_counts(U),
    ok.

%% Marks every card the predicate accepts as read; returns how many changed.
mark_where(U, Pred) ->
    Changed = [C || C <- load_cards(U), Pred(C)],
    lists:foreach(fun(C) ->
                      sd_db:hset_json(card_hash(U), maps:get(<<"id">>, C), C#{<<"read">> => true})
                  end, Changed),
    length(Changed).

dismiss(User, all) ->
    U = sd_util:norm_user(User),
    sd_db:del(card_zset(U)), sd_db:del(card_hash(U)),
    push_counts(U),
    ok;
dismiss(User, Id) when is_binary(Id) ->
    U = sd_util:norm_user(User),
    sd_db:q(["ZREM", card_zset(U), Id]),
    sd_db:hdel(card_hash(U), Id),
    push_counts(U),
    ok.

%% ---- classification ----------------------------------------------------------------------------------

classify(Card, Custom) ->
    case first_matching(Custom, Card) of
        {ok, Id} -> Id;
        none -> builtin_class(Card)
    end.

first_matching([], _Card) -> none;
first_matching([S | Rest], Card) ->
    Rules = maps:get(<<"rules">>, S, []),
    Hits = [rule_matches(R, Card) || R <- Rules],
    Matched = case maps:get(<<"match">>, S, <<"any">>) of
                  <<"all">> -> Rules =/= [] andalso lists:all(fun(X) -> X end, Hits);
                  _ -> lists:any(fun(X) -> X end, Hits)
              end,
    case Matched of
        true -> {ok, maps:get(<<"id">>, S)};
        false -> first_matching(Rest, Card)
    end.

rule_matches(#{<<"field">> := Field, <<"op">> := Op, <<"value">> := Value}, Card) ->
    Actual = string:lowercase(sd_util:b(maps:get(Field, Card, <<>>))),
    Want = string:lowercase(sd_util:b(Value)),
    case Op of
        <<"equals">> -> Actual =:= Want;
        <<"starts">> -> binary:longest_common_prefix([Actual, Want]) =:= byte_size(Want) andalso Want =/= <<>>;
        <<"contains">> -> Want =/= <<>> andalso binary:match(Actual, Want) =/= nomatch;
        _ -> false
    end;
rule_matches(_, _) -> false.

builtin_class(#{<<"kind">> := <<"request">>}) -> <<"pending">>;
builtin_class(#{<<"kind">> := <<"reminder">>}) -> <<"reminders">>;
builtin_class(#{<<"kind">> := <<"system">>}) -> <<"updates">>;
builtin_class(Card) ->
    Text = string:lowercase(sd_util:b(maps:get(<<"text">>, Card, <<>>))),
    Urgent = case Text of
                 <<"!", _/binary>> -> true;
                 _ -> binary:match(Text, [<<"#urgent">>, <<"#priority">>]) =/= nomatch
             end,
    case {Urgent, maps:get(<<"kind">>, Card, <<>>)} of
        {true, _} -> <<"priority">>;
        {_, <<"dm">>} -> <<"personal">>;
        _ -> <<"general">>
    end.

%% ---- the user's own sections ----------------------------------------------------------------------------

sections(User) ->
    builtin_sections() ++ custom_sections(sd_util:norm_user(User)).

custom_sections(U) ->
    case sd_db:get_json("sd:sections:" ++ sd_util:s(U)) of
        L when is_list(L) -> L;
        _ -> []
    end.

%% Raw: name, rules [{field, op, value}], match (any|all), optional id (to edit).
save_section(User, Raw) when is_map(Raw) ->
    U = sd_util:norm_user(User),
    Existing = custom_sections(U),
    Name = case sd_util:get(<<"name">>, Raw) of
               N when is_binary(N) -> string:trim(N);
               _ -> <<>>
           end,
    case {Name, validate_rules(sd_util:get(<<"rules">>, Raw, []))} of
        {<<>>, _} -> {error, invalid, <<"name is required.">>};
        {_, {error, _, _} = Err} -> Err;
        _ when byte_size(Name) > 40 -> {error, invalid, <<"name is too long.">>};
        {_, {ok, Rules}} ->
            Match = case sd_util:get(<<"match">>, Raw) of <<"all">> -> <<"all">>; _ -> <<"any">> end,
            Id = case sd_util:get(<<"id">>, Raw) of
                     I when is_binary(I) -> I;
                     _ -> <<"s", (sd_util:rand_digits(8))/binary>>
                 end,
            Builtin = [maps:get(<<"id">>, B) || B <- builtin_sections()],
            Section = #{<<"id">> => Id, <<"name">> => Name, <<"rules">> => Rules,
                        <<"match">> => Match, <<"builtin">> => false},
            IsEdit = lists:any(fun(S) -> maps:get(<<"id">>, S) =:= Id end, Existing),
            case {lists:member(Id, Builtin), IsEdit, length(Existing) >= ?MAX_CUSTOM_SECTIONS} of
                {true, _, _} ->
                    {error, not_allowed, <<"Built-in sections can't be changed.">>};
                {_, false, true} ->
                    {error, limit, <<"You can have at most 20 custom sections.">>};
                _ ->
                    New = case IsEdit of
                              true -> [case maps:get(<<"id">>, S) of Id -> Section; _ -> S end || S <- Existing];
                              false -> Existing ++ [Section]
                          end,
                    sd_db:set("sd:sections:" ++ sd_util:s(U), sd_util:jenc(New)),
                    {ok, Section}
            end
    end;
save_section(_, _) -> {error, bad_request, <<"Expected a JSON object.">>}.

delete_section(User, Id) ->
    U = sd_util:norm_user(User),
    Existing = custom_sections(U),
    case lists:any(fun(S) -> maps:get(<<"id">>, S) =:= Id end, Existing) of
        false -> {error, not_found, <<"No such section.">>};
        true ->
            sd_db:set("sd:sections:" ++ sd_util:s(U),
                      sd_util:jenc([S || S <- Existing, maps:get(<<"id">>, S) =/= Id])),
            ok
    end.

validate_rules(Rules) when is_list(Rules), length(Rules) =< ?MAX_RULES ->
    validate_rules(Rules, []);
validate_rules(_) -> {error, invalid, <<"rules must be a list of at most 20 rules.">>}.

validate_rules([], Acc) -> {ok, lists:reverse(Acc)};
validate_rules([#{<<"field">> := F, <<"op">> := Op, <<"value">> := V} | Rest], Acc)
        when (F =:= <<"from">> orelse F =:= <<"text">> orelse F =:= <<"kind">>),
             (Op =:= <<"contains">> orelse Op =:= <<"equals">> orelse Op =:= <<"starts">>),
             is_binary(V), byte_size(V) > 0, byte_size(V) =< 200 ->
    validate_rules(Rest, [#{<<"field">> => F, <<"op">> => Op, <<"value">> => V} | Acc]);
validate_rules(_, _) ->
    {error, invalid,
     <<"Each rule needs field (from|text|kind), op (contains|equals|starts) and a non-empty value.">>}.
