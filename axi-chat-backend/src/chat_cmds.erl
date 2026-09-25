%%% #commands -- the chat prompt bar's action menu.
%%%
%%% A user types `#` in the message box, picks a command from a list, and the
%%% chat performs the action ("#dm alice hi", "#creategroup design_team",
%%% "#accept 12", "#cards", ...). Every feature the backend has is reachable
%%% this way.
%%%
%%% How it works -- and why it is safe. A `#command` line is never executed
%%% by code of its own. It is parsed, its arguments are validated, and it is
%%% then REWRITTEN into the equivalent existing command, which chat_web runs
%%% exactly as if the client had sent it:
%%%
%%%     #dm alice hello      ->  /msg alice hello
%%%     #accept 12           ->  /sd req.respond {"id":12,"action":"accept","reqId":"#accept"}
%%%
%%% So every rule the older commands enforce -- Sandesh mode/permissions
%%% (sd_policy, sd_cmds:access/1), message-length caps, per-connection rate
%%% limit, "sender only" deletes -- applies to a #command with no second copy
%%% to keep in sync. Rewritten lines always start with "/", so a rewrite can
%%% never re-enter this module.
%%%
%%% Frontend surface (all documented in docs/HASH_COMMANDS.md):
%%%   /cmds [prefix]                 -> {"type":"cmd_catalog", ...}   every command, once per session
%%%   /cmdcomplete {"input":"#dm al"} -> {"type":"cmd_suggestions", ...} as-you-type suggestions
%%%   #help [command]                -> cmd_catalog | cmd_help
%%%   any #command line              -> the events of the command it stands for
%%%   a malformed #command           -> {"type":"error","code":...,"usage":...}
%%%
%%% Conventions kept from the rest of the backend: text arrives as a list of
%%% BYTES (UTF-8 bytes, one per element -- see chat_web:handle_ws_data), so
%%% anything sent back is built with list_to_binary/1, never
%%% unicode:characters_to_binary/1 (which would double-encode). Nothing here
%%% turns client input into an atom, and no argument text is ever logged.
-module(chat_cmds).
-export([run/2, catalog_json/1, complete_json/2, commands/0, find/1, usage/1]).
-include("chat.hrl").
-include_lib("kernel/include/logger.hrl").

-define(MAX_NAME_LEN, 32).
-define(MAX_WORD_LEN, 64).
-define(MAX_EMOJI_LEN, 32).
-define(MAX_URL_LEN, 512).
-define(MAX_COMPLETE_INPUT, 512).
-define(MAX_ARG_SUGGESTIONS, 10).
-define(MAX_CMD_SUGGESTIONS, 25).

%% ---- the command table -----------------------------------------------------------------------
%%
%% Args are {Name, Type, req | opt}. Types:
%%   user | group | host | msgid | emoji | url | word | {enum, [Value]}
%%   text | {text, MaxBytes}   -- the rest of the line; only allowed as the LAST arg
%% A missing optional argument reaches the target fun as "".
%% Target is {line, fun(Vals)} (rewrite to a slash command) or
%%   {sd, Action, fun(Vals)} (rewrite to "/sd Action {json}") or `help`.
%% Vals are strings (lists of bytes), except msgid which is an integer.
%% Keep summaries plain ASCII.

commands() ->
    Cats = [priority, pending, personal, reminders],
    CatEnum = {enum, ["all" | [atom_to_list(C) || C <- Cats]]},
    [
     %% ---- messaging ----
     cmd("dm", ["msg", "pm"], messaging, "Send a direct message to someone",
         [{user, user, req}, {text, text, req}],
         {line, fun([U, T]) -> "/msg " ++ U ++ " " ++ T end}, ["dm_ack"]),
     cmd("host", [], messaging, "Message a department host (HR, Finance, ...)",
         [{host, host, req}, {text, text, req}],
         {line, fun([H, T]) -> "/hostmsg " ++ H ++ " " ++ T end}, ["host_ack"]),
     cmd("reply", [], messaging, "Reply to a message in the global room",
         [{messageId, msgid, req}, {text, text, req}],
         {line, fun([I, T]) -> "/reply " ++ integer_to_list(I) ++ " " ++ T end}, ["own_message_id"]),
     cmd("replydm", [], messaging, "Reply to a message in a direct conversation",
         [{user, user, req}, {messageId, msgid, req}, {text, text, req}],
         {line, fun([U, I, T]) -> "/replydm " ++ U ++ " " ++ integer_to_list(I) ++ " " ++ T end}, ["dm_ack"]),
     cmd("groupmsg", ["gm"], messaging, "Send a message to a group",
         [{group, group, req}, {text, text, req}],
         {line, fun([G, T]) -> "/groupmsg " ++ G ++ " " ++ T end}, ["group_msg_ack"]),
     cmd("replygroup", [], messaging, "Reply to a message in a group",
         [{group, group, req}, {messageId, msgid, req}, {text, text, req}],
         {line, fun([G, I, T]) -> "/replygroup " ++ G ++ " " ++ integer_to_list(I) ++ " " ++ T end}, ["group_msg_ack"]),
     cmd("react", [], messaging, "React to a global-room message (toggles)",
         [{messageId, msgid, req}, {emoji, emoji, req}],
         {line, fun([I, E]) -> "/react global " ++ integer_to_list(I) ++ " " ++ E end}, ["reaction"]),
     cmd("reactdm", [], messaging, "React to a message in a direct conversation",
         [{user, user, req}, {messageId, msgid, req}, {emoji, emoji, req}],
         {line, fun([U, I, E]) -> "/react dm " ++ U ++ " " ++ integer_to_list(I) ++ " " ++ E end}, ["dm_reaction"]),
     cmd("reactgroup", [], messaging, "React to a message in a group",
         [{group, group, req}, {messageId, msgid, req}, {emoji, emoji, req}],
         {line, fun([G, I, E]) -> "/react group " ++ G ++ " " ++ integer_to_list(I) ++ " " ++ E end}, ["group_reaction"]),
     cmd("delete", [], messaging, "Delete your own global-room message",
         [{messageId, msgid, req}],
         {line, fun([I]) -> "/delete global " ++ integer_to_list(I) end}, ["deleted", "delete_denied"]),
     cmd("deletedm", [], messaging, "Delete your own message in a direct conversation",
         [{user, user, req}, {messageId, msgid, req}],
         {line, fun([U, I]) -> "/delete dm " ++ U ++ " " ++ integer_to_list(I) end}, ["dm_deleted", "delete_denied"]),
     cmd("deletegroup", [], messaging, "Delete your own message in a group",
         [{group, group, req}, {messageId, msgid, req}],
         {line, fun([G, I]) -> "/delete group " ++ G ++ " " ++ integer_to_list(I) end}, ["group_deleted", "delete_denied"]),
     cmd("gif", [], messaging, "Search GIFs",
         [{query, {text, 100}, opt}],
         {line, fun([Q]) -> "/gifsearch" ++ opt(Q) end}, ["gif_results"]),
     cmd("sticker", [], messaging, "Search stickers",
         [{query, {text, 100}, opt}],
         {line, fun([Q]) -> "/stickersearch" ++ opt(Q) end}, ["sticker_results"]),

     %% ---- look things up ----
     cmd("users", ["online", "who"], lookup, "Who is online right now",
         [], {line, fun([]) -> "/list" end}, ["users"]),
     cmd("hosts", [], lookup, "The host directory (AI hosts, workspace, departments)",
         [], {line, fun([]) -> "/hosts" end}, ["hosts"]),
     cmd("groups", [], lookup, "The groups you are in",
         [], {line, fun([]) -> "/groups" end}, ["groups"]),
     cmd("inbox", ["conversations"], lookup, "Your direct-message threads, newest first",
         [], {line, fun([]) -> "/conversations" end}, ["conversations"]),
     cmd("history", [], lookup, "Reload the global room's recent messages",
         [], {line, fun([]) -> "/history global" end}, ["history"]),
     cmd("historydm", [], lookup, "Load your direct-message history with someone",
         [{user, user, req}],
         {line, fun([U]) -> "/history dm " ++ U end}, ["history"]),
     cmd("historygroup", [], lookup, "Load a group's recent messages",
         [{group, group, req}],
         {line, fun([G]) -> "/history group " ++ G end}, ["history"]),
     cmd("historyhost", [], lookup, "Load your conversation with a department host",
         [{host, host, req}],
         {line, fun([H]) -> "/history host " ++ H end}, ["history"]),
     cmd("read", [], lookup, "Mark a direct conversation as read",
         [{user, user, req}],
         {line, fun([U]) -> "/read dm " ++ U end}, []),
     cmd("profile", [], lookup, "See someone's avatar and status",
         [{user, user, req}],
         {line, fun([U]) -> "/getprofile " ++ U end}, ["profile"]),

     %% ---- groups ----
     cmd("creategroup", ["newgroup"], groups, "Create a group (no spaces in the name)",
         [{name, group, req}],
         {line, fun([G]) -> "/creategroup " ++ G end}, ["group_created"]),
     cmd("addmember", ["invitegroup"], groups, "Add an online user to a group you are in",
         [{group, group, req}, {user, user, req}],
         {line, fun([G, U]) -> "/addmember " ++ G ++ " " ++ U end}, ["group_created"]),
     cmd("leavegroup", ["leave"], groups, "Leave a group",
         [{group, group, req}],
         {line, fun([G]) -> "/leavegroup " ++ G end}, ["left_group"]),

     %% ---- your profile ----
     cmd("status", [], profile, "Set your status line",
         [{status, {text, 140}, req}],
         {line, fun([S]) -> "/setstatus " ++ S end}, []),
     cmd("avatar", [], profile, "Set your avatar (an http(s) link or an uploaded /uploads/ file)",
         [{url, url, req}],
         {line, fun([U]) -> "/setavatar " ++ U end}, []),

     %% ---- people & approvals (Sandesh) ----
     cmd("me", ["whoami"], people, "Your Sandesh account, permissions and counters",
         [], {sd, <<"me">>, fun([]) -> #{} end}, ["sd"]),
     cmd("associates", ["contacts"], people, "People you are connected with",
         [], {sd, <<"assoc.list">>, fun([]) -> #{} end}, ["sd"]),
     cmd("find", ["search"], people, "Find a person by username, email or mobile number",
         [{query, {text, 100}, req}],
         {sd, <<"users.search">>, fun([Q]) -> #{<<"q">> => ub(Q)} end}, ["sd"]),
     cmd("connect", [], people, "Invite someone to be your associate",
         [{user, {text, 100}, req}],
         {sd, <<"assoc.invite">>, fun([U]) -> #{<<"to">> => ub(U)} end}, ["sd"]),
     cmd("disconnect", [], people, "Remove an associate",
         [{user, user, req}],
         {sd, <<"assoc.remove">>, fun([U]) -> #{<<"user">> => ub(U)} end}, ["sd"]),
     cmd("requests", ["approvals"], people, "Your pending approvals and invitations",
         [{status, {enum, ["pending", "all", "accepted", "rejected", "ignored"]}, opt}],
         {sd, <<"req.list">>, fun([S]) -> opt_field(<<"status">>, S, #{}) end}, ["sd"]),
     cmd("accept", [], people, "Accept a request or invitation",
         [{requestId, msgid, req}],
         {sd, <<"req.respond">>, fun([I]) -> #{<<"id">> => I, <<"action">> => <<"accept">>} end}, ["sd"]),
     cmd("reject", [], people, "Reject a request or invitation",
         [{requestId, msgid, req}],
         {sd, <<"req.respond">>, fun([I]) -> #{<<"id">> => I, <<"action">> => <<"reject">>} end}, ["sd"]),
     cmd("ignore", [], people, "Ignore a request or invitation",
         [{requestId, msgid, req}],
         {sd, <<"req.respond">>, fun([I]) -> #{<<"id">> => I, <<"action">> => <<"ignore">>} end}, ["sd"]),
     cmd("myusers", [], people, "Users you host (hosts only)",
         [], {sd, <<"host.users">>, fun([]) -> #{} end}, ["sd"]),
     cmd("transfer", [], people, "Ask another host to take over one of your users (hosts only)",
         [{user, user, req}, {toHost, user, req}],
         {sd, <<"host.transfer">>, fun([U, H]) -> #{<<"user">> => ub(U), <<"toHost">> => ub(H)} end}, ["sd"]),

     %% ---- notifications, cards, reminders ----
     cmd("notifications", ["notifs"], inbox, "Your notifications (unread first)",
         [{category, CatEnum, opt}],
         {sd, <<"notifications.list">>, fun([C]) -> opt_field(<<"category">>, C, #{}) end}, ["sd"]),
     cmd("markread", [], inbox, "Mark notifications as read",
         [{category, CatEnum, req}],
         {sd, <<"notifications.read">>,
          fun(["all"]) -> #{<<"all">> => true};
             ([C]) -> #{<<"category">> => ub(C)} end}, ["sd"]),
     cmd("cards", [], inbox, "Your message cards (optionally one section)",
         [{section, word, opt}],
         {sd, <<"cards.list">>, fun([S]) -> opt_field(<<"section">>, S, #{}) end}, ["sd"]),
     cmd("dismiss", [], inbox, "Dismiss a card (or \"all\")",
         [{cardId, word, req}],
         {sd, <<"cards.dismiss">>, fun([I]) -> #{<<"id">> => ub(I)} end}, ["sd"]),
     cmd("remind", ["reminder"], inbox, "Add a reminder card for yourself",
         [{text, {text, 500}, req}],
         {sd, <<"reminder.add">>, fun([T]) -> #{<<"text">> => ub(T)} end}, ["sd"]),

     %% ---- forms ----
     cmd("forms", ["options"], forms, "The forms and options available to you",
         [], {sd, <<"options.list">>, fun([]) -> #{} end}, ["sd"]),
     cmd("form", [], forms, "Open a form definition",
         [{name, word, req}],
         {sd, <<"tstruct.get">>, fun([N]) -> #{<<"name">> => ub(N)} end}, ["sd"]),
     cmd("submissions", [], forms, "Forms you have submitted",
         [], {sd, <<"submissions.list">>, fun([]) -> #{} end}, ["sd"]),

     %% ---- administration (permission-gated; the server re-checks on every run) ----
     cmd("admin-org", [], admin, "Organisation details and headline counts",
         [], {sd, <<"admin.org.get">>, fun([]) -> #{} end}, ["sd"]),
     cmd("admin-users", [], admin, "List or search all users",
         [{query, {text, 100}, opt}],
         {sd, <<"admin.users.list">>, fun([Q]) -> opt_field(<<"q">>, Q, #{}) end}, ["sd"]),
     cmd("admin-admins", [], admin, "List administrators",
         [], {sd, <<"admin.admins.list">>, fun([]) -> #{} end}, ["sd"]),
     cmd("admin-affiliates", [], admin, "List affiliates with their hosts and users",
         [], {sd, <<"admin.affiliates.list">>, fun([]) -> #{} end}, ["sd"]),
     cmd("admin-activate", [], admin, "Activate a user account",
         [{user, user, req}],
         {sd, <<"admin.user.status">>, fun([U]) -> #{<<"username">> => ub(U), <<"active">> => true} end}, ["sd"]),
     cmd("admin-deactivate", [], admin, "Deactivate a user account (disconnects them)",
         [{user, user, req}],
         {sd, <<"admin.user.status">>, fun([U]) -> #{<<"username">> => ub(U), <<"active">> => false} end}, ["sd"]),

     %% ---- help ----
     cmd("help", ["commands"], help, "List all # commands, or explain one",
         [{command, word, opt}], help, ["cmd_catalog", "cmd_help"])
    ].

categories() ->
    [{messaging, "Messaging"}, {lookup, "Look things up"}, {groups, "Groups"}, {profile, "Your profile"},
     {people, "People and approvals"}, {inbox, "Notifications and cards"}, {forms, "Forms"},
     {admin, "Administration"}, {help, "Help"}].

cmd(Name, Aliases, Category, Summary, Args, Target, Reply) ->
    #{name => Name, aliases => Aliases, category => Category, summary => Summary,
      args => Args, target => Target, reply => Reply}.

opt("") -> "";
opt(S) -> " " ++ S.

opt_field(_Key, "", Map) -> Map;
opt_field(Key, V, Map) -> Map#{Key => ub(V)}.

%% ---- running a #command line -----------------------------------------------------------------

%% Line is the trimmed frame, starting with "#" then a letter (chat_web checks).
%% {line, SlashLine}  -> chat_web runs SlashLine as if the client had sent it
%% {reply, JsonBin}   -> chat_web sends JsonBin to this connection as-is
run(Line, Name) ->
    try do_run(Line, Name)
    catch Class:Reason:Stack ->
        %% No arguments in the log (they may be message text) -- class, reason
        %% tag and the crash site only.
        ?LOG_ERROR("chat_cmds crashed: ~p:~p at ~p", [Class, reason_tag(Reason), crash_site(Stack)]),
        {reply, error_json("internal", "Something went wrong running that command.", #{})}
    end.

reason_tag(R) when is_atom(R) -> R;
reason_tag(R) when is_tuple(R), tuple_size(R) > 0, is_atom(element(1, R)) -> element(1, R);
reason_tag(_) -> other.

crash_site([{M, F, _, Loc} | _]) -> {M, F, proplists:get_value(line, Loc)};
crash_site(_) -> unknown.

do_run([$# | Body], Name) ->
    case utf8_ok(Body) of
        false ->
            {reply, error_json("invalid_encoding", "That command is not valid UTF-8 text.", #{})};
        true ->
            {Token, Rest} = take_token(Body),
            case find(ascii_lower(Token)) of
                undefined -> {reply, unknown_json(Token)};
                Cmd -> exec(Cmd, Rest, Name)
            end
    end.

exec(#{name := CName, args := Specs, target := Target} = Cmd, Rest, Name) ->
    case parse_args(Specs, Rest) of
        {error, Msg} ->
            {reply, usage_json(Cmd, Msg)};
        {ok, Vals} ->
            ?LOG_DEBUG("~s ran #~s", [Name, CName]),
            case Target of
                {line, Fun} ->
                    {line, Fun(Vals)};
                {sd, Action, Fun} ->
                    Args = (Fun(Vals))#{<<"reqId">> => list_to_binary("#" ++ CName)},
                    {line, "/sd " ++ binary_to_list(Action) ++ " " ++ binary_to_list(jenc(Args))};
                help ->
                    [Q] = Vals,
                    {reply, help_json(Q, Name)}
            end
    end.

%% Exact name or alias only -- a prefix is never enough to EXECUTE ("#de"
%% must not silently run "#delete"); prefixes are for suggestions.
find(Token) ->
    case lists:search(fun(#{name := N, aliases := A}) -> lists:member(Token, [N | A]) end, commands()) of
        {value, Cmd} -> Cmd;
        false -> undefined
    end.

%% ---- argument parsing -----------------------------------------------------------------------

parse_args(Specs, Str) -> parse_args(Specs, Str, []).

parse_args([], Str, Acc) ->
    case skip_spaces(Str) of
        "" -> {ok, lists:reverse(Acc)};
        _ -> {error, "Too many arguments."}
    end;
parse_args([{Name, Type, Req} | More], Str, Acc) ->
    case is_text(Type) of
        true -> parse_text(Name, Type, Req, More, Str, Acc);
        false -> parse_word(Name, Type, Req, More, Str, Acc)
    end.

%% The rest of the line. Must be the last arg of its command (the unit tests
%% check every entry of commands/0, so a table typo can't ship).
parse_text(Name, Type, Req, [], Str, Acc) ->
    Text = skip_spaces(Str),
    Max = case Type of {text, M} -> M; text -> ?MAX_MESSAGE_LEN end,
    if
        Text =:= "", Req =:= req -> {error, missing(Name)};
        length(Text) > Max -> {error, io_lib:format("<~s> is too long (max ~p characters).", [Name, Max])};
        true -> {ok, lists:reverse([Text | Acc])}
    end.

parse_word(Name, Type, Req, More, Str, Acc) ->
    case take_token(Str) of
        {"", _} when Req =:= req -> {error, missing(Name)};
        {"", _} -> parse_args(More, "", ["" | Acc]);
        {Tok, Rest} ->
            case convert(Name, Type, Tok) of
                {ok, Val} -> parse_args(More, Rest, [Val | Acc]);
                {error, _} = E -> E
            end
    end.

missing(Name) -> io_lib:format("Missing <~s>.", [Name]).

convert(Name, user, Tok) ->
    sized(Name, Tok, ?MAX_USERNAME_LEN, "a username");
convert(Name, group, Tok) ->
    sized(Name, Tok, ?MAX_GROUP_NAME_LEN, "a group name");
convert(Name, host, Tok) ->
    sized(Name, Tok, ?MAX_WORD_LEN, "a host key");
convert(Name, word, Tok) ->
    sized(Name, Tok, ?MAX_WORD_LEN, "a single word");
convert(Name, emoji, Tok) ->
    sized(Name, Tok, ?MAX_EMOJI_LEN, "an emoji");
convert(Name, msgid, Tok) ->
    case length(Tok) =< 18 andalso lists:all(fun(C) -> C >= $0 andalso C =< $9 end, Tok) of
        true -> {ok, list_to_integer(Tok)};
        false -> {error, io_lib:format("<~s> must be a number.", [Name])}
    end;
convert(Name, {enum, Values}, Tok) ->
    Low = ascii_lower(Tok),
    case lists:member(Low, Values) of
        true -> {ok, Low};
        false -> {error, io_lib:format("<~s> must be one of: ~s.", [Name, string:join(Values, ", ")])}
    end;
convert(Name, url, Tok) ->
    Ok = length(Tok) =< ?MAX_URL_LEN andalso not has_control(Tok) andalso
         (lists:prefix("https://", Tok) orelse lists:prefix("http://", Tok)
          orelse lists:prefix("/uploads/", Tok)),
    case Ok of
        true -> {ok, Tok};
        false -> {error, io_lib:format("<~s> must be an http(s):// link or an /uploads/ path.", [Name])}
    end.

sized(Name, Tok, Max, What) ->
    case length(Tok) =< Max andalso not has_control(Tok) of
        true -> {ok, Tok};
        false -> {error, io_lib:format("<~s> must be ~s (up to ~p characters, no control characters).", [Name, What, Max])}
    end.

has_control(Str) -> lists:any(fun(C) -> C < 32 orelse C =:= 127 end, Str).

%% Space-delimited only: a tab or newline stays inside its token, where
%% has_control/1 rejects it for every non-text argument.
take_token(Str) ->
    lists:splitwith(fun(C) -> C =/= $\s end, skip_spaces(Str)).

skip_spaces([$\s | T]) -> skip_spaces(T);
skip_spaces(S) -> S.

%% ASCII-only lowercase: command names are ASCII, and a byte list is not a
%% code-point list, so string:lowercase/1 would mangle bytes >= 128.
ascii_lower(Str) -> [case C >= $A andalso C =< $Z of true -> C + 32; false -> C end || C <- Str].

utf8_ok(Bytes) ->
    is_binary(unicode:characters_to_binary(list_to_binary(Bytes), utf8, utf8)).

%% ---- JSON -------------------------------------------------------------------------------------

jenc(Term) -> iolist_to_binary(json:encode(Term)).

%% Text from this module's own tables (may hold io_lib output -- flatten first).
tb(Str) -> unicode:characters_to_binary(lists:flatten(Str)).

%% User-supplied byte list -> binary. Callers have already checked UTF-8.
ub(Bytes) -> list_to_binary(Bytes).

%% A byte list from elsewhere in the server (a stored username) that is safe to
%% put in JSON, or `skip` -- json:encode/1 raises on invalid UTF-8, and one
%% hostile stored name must not be able to crash a stranger's autocomplete.
safe(Bytes) ->
    try list_to_binary(Bytes) of
        B -> case unicode:characters_to_binary(B, utf8, utf8) of
                 B2 when is_binary(B2) -> B2;
                 _ -> skip
             end
    catch _:_ -> skip
    end.

error_json(Code, Text, Extra) ->
    jenc(maps:merge(#{<<"type">> => <<"error">>, <<"code">> => tb(Code), <<"text">> => tb(Text)}, Extra)).

usage_json(Cmd, Msg) ->
    error_json("usage", [Msg, " Usage: ", usage(Cmd)],
               #{<<"command">> => tb(maps:get(name, Cmd)), <<"usage">> => tb(usage(Cmd))}).

%% Only a plain [A-Za-z0-9_-] token is ever echoed back: an arbitrary one could
%% be cut mid-UTF-8-sequence or carry control characters.
unknown_json(Token) ->
    Echo = case is_plain(Token) of true -> "#" ++ Token; false -> "That command" end,
    Sugg = suggest_names(ascii_lower(Token)),
    error_json("unknown_command",
               Echo ++ " is not a command. Type #help to see them all, or ## to send a message that starts with #.",
               #{<<"suggestions">> => [tb(S) || S <- Sugg]}).

is_plain(Token) ->
    Token =/= "" andalso length(Token) =< ?MAX_NAME_LEN andalso
        lists:all(fun(C) -> (C >= $a andalso C =< $z) orelse (C >= $A andalso C =< $Z)
                            orelse (C >= $0 andalso C =< $9) orelse C =:= $_ orelse C =:= $- end, Token).

suggest_names(Token) ->
    case is_plain(Token) of
        false -> [];
        true ->
            Names = [N || #{name := N} <- commands()],
            Pre = [N || N <- Names, lists:prefix(Token, N)],
            Sub = [N || N <- Names, string:find(N, Token) =/= nomatch, not lists:member(N, Pre)],
            %% typos ("#dmm", "#gruops"): closest first
            Near = [N || {D, N} <- lists:sort([{edit_distance(Token, N), N} || N <- Names]),
                         D =< 2, not lists:member(N, Pre), not lists:member(N, Sub)],
            lists:sublist(Pre ++ Sub ++ Near, 5)
    end.

%% Levenshtein distance; both strings are short (<= ?MAX_NAME_LEN).
edit_distance(A, B) ->
    Row0 = lists:seq(0, length(B)),
    {_, Last} = lists:foldl(
        fun(CA, {I, Prev}) ->
            Row = lists:reverse(element(2, lists:foldl(
                fun(CB, {[Diag | _] = PrevRest, [Left | _] = Acc}) ->
                    [_, Up | _] = PrevRest,
                    Cost = case CA =:= CB of true -> 0; false -> 1 end,
                    {tl(PrevRest), [min(min(Up + 1, Left + 1), Diag + Cost) | Acc]}
                end, {Prev, [I + 1]}, B))),
            {I + 1, Row}
        end, {0, Row0}, A),
    lists:last(Last).

usage(#{name := Name, args := Specs}) ->
    lists:flatten(["#", Name, [[" ", arg_usage(S)] || S <- Specs]]).

arg_usage({Name, Type, Req}) ->
    Dots = case is_text(Type) of true -> "..."; false -> "" end,
    case Req of
        req -> ["<", atom_to_list(Name), Dots, ">"];
        opt -> ["[", atom_to_list(Name), Dots, "]"]
    end.

is_text(text) -> true;
is_text({text, _}) -> true;
is_text(_) -> false.

type_name(T) when is_atom(T) -> atom_to_list(T);
type_name({text, _}) -> "text";
type_name({enum, _}) -> "enum".

arg_json({Name, Type, Req}) ->
    Base = #{<<"name">> => tb(atom_to_list(Name)), <<"type">> => tb(type_name(Type)),
             <<"required">> => Req =:= req},
    case Type of
        {enum, Vs} -> Base#{<<"values">> => [tb(V) || V <- Vs]};
        {text, Max} -> Base#{<<"rest">> => true, <<"max">> => Max};
        text -> Base#{<<"rest">> => true, <<"max">> => ?MAX_MESSAGE_LEN};
        _ -> Base
    end.

%% `requires` is what the caller lacks (none = they can run it); `available`
%% is the same fact as a boolean. Advisory: the server enforces on execution.
command_json(#{name := Name, aliases := Aliases, category := Cat, summary := Summary,
               args := Specs, target := Target, reply := Reply} = Cmd, Ctx) ->
    Lack = case Target of
               {sd, Action, _} -> sd_cmds:availability(Action, Ctx);
               _ -> available
           end,
    #{<<"name">> => tb(Name), <<"aliases">> => [tb(A) || A <- Aliases],
      <<"category">> => tb(atom_to_list(Cat)), <<"summary">> => tb(Summary),
      <<"usage">> => tb(usage(Cmd)), <<"args">> => [arg_json(S) || S <- Specs],
      <<"reply">> => [tb(R) || R <- Reply],
      <<"available">> => Lack =:= available,
      <<"requires">> => tb(case Lack of available -> "none"; L -> atom_to_list(L) end)}.

%% ---- /cmds and #help --------------------------------------------------------------------------

%% Query: "" for everything, or a name prefix ("/cmds re" -> reply, react, ...).
catalog_json(Query) ->
    try
        Q = ascii_lower(Query),
        Ctx = sd_cmds:caller(),
        Cmds = case Q of
                   "" -> commands();
                   _ -> case is_plain(Q) of
                            true -> [C || #{name := N, aliases := A} = C <- commands(),
                                          lists:any(fun(X) -> lists:prefix(Q, X) end, [N | A])];
                            false -> []
                        end
               end,
        jenc(#{<<"type">> => <<"cmd_catalog">>, <<"prefix">> => <<"#">>, <<"escape">> => <<"##">>,
               <<"filter">> => case is_plain(Q) of true -> tb(Q); false -> <<>> end,
               <<"categories">> => [#{<<"id">> => tb(atom_to_list(Id)), <<"label">> => tb(Label)}
                                    || {Id, Label} <- categories()],
               <<"commands">> => [command_json(C, Ctx) || C <- Cmds]})
    catch Class:Reason:Stack ->
        ?LOG_ERROR("chat_cmds catalog crashed: ~p:~p at ~p", [Class, reason_tag(Reason), crash_site(Stack)]),
        error_json("internal", "Something went wrong listing the commands.", #{})
    end.

help_json("", _Name) ->
    catalog_json("");
help_json(Q0, _Name) ->
    Q = ascii_lower(case Q0 of [$# | T] -> T; T -> T end),
    case find(Q) of
        undefined -> unknown_json(Q);
        Cmd -> jenc(#{<<"type">> => <<"cmd_help">>, <<"command">> => command_json(Cmd, sd_cmds:caller())})
    end.

%% ---- /cmdcomplete: as-you-type suggestions --------------------------------------------------------

%% Body is what follows "/cmdcomplete ": {"input":"#dm al","reqId":1}. The input
%% travels inside JSON on purpose -- chat_web trims every incoming line, so a
%% trailing space ("#dm " = "now typing the first argument") would be lost if
%% it were sent bare.
complete_json(Body, Name) ->
    try
        case sd_util:jdec(list_to_binary(Body)) of
            {ok, #{<<"input">> := In} = Args} when is_binary(In), byte_size(In) =< ?MAX_COMPLETE_INPUT ->
                case unicode:characters_to_binary(In, utf8, utf8) of
                    In -> complete(binary_to_list(In), maps:get(<<"reqId">>, Args, null), Name);
                    _ -> error_json("invalid_encoding", "input is not valid UTF-8.", #{})
                end;
            _ ->
                error_json("usage", "Usage: /cmdcomplete {\"input\":\"#dm al\"} (input up to 512 bytes).", #{})
        end
    catch Class:Reason:Stack ->
        ?LOG_ERROR("chat_cmds complete crashed: ~p:~p at ~p", [Class, reason_tag(Reason), crash_site(Stack)]),
        error_json("internal", "Something went wrong completing that.", #{})
    end.

complete(Input, ReqId, Name) ->
    Bare = case Input of [$# | R] -> R; R -> R end,
    Base = #{<<"type">> => <<"cmd_suggestions">>, <<"input">> => list_to_binary(Input),
             <<"reqId">> => ReqId},
    case lists:splitwith(fun(C) -> C =/= $\s end, Bare) of
        {Tok, []} ->
            %% Still typing the command name.
            Ctx = sd_cmds:caller(),
            Q = ascii_lower(Tok),
            Hits = case is_plain(Q) orelse Q =:= "" of
                       true -> [C || #{name := N, aliases := A} = C <- commands(),
                                     lists:any(fun(X) -> lists:prefix(Q, X) end, [N | A])];
                       false -> []
                   end,
            Items = [begin
                         J = command_json(C, Ctx),
                         #{<<"value">> => maps:get(<<"name">>, J), <<"label">> => <<"#", (maps:get(<<"name">>, J))/binary>>,
                           <<"hint">> => maps:get(<<"summary">>, J), <<"usage">> => maps:get(<<"usage">>, J),
                           <<"category">> => maps:get(<<"category">>, J), <<"available">> => maps:get(<<"available">>, J)}
                     end || C <- lists:sublist(Hits, ?MAX_CMD_SUGGESTIONS)],
            jenc(Base#{<<"kind">> => <<"command">>, <<"token">> => safe_or_empty(Tok), <<"items">> => Items});
        {Tok, [$\s | After]} ->
            case find(ascii_lower(Tok)) of
                undefined -> jenc(Base#{<<"kind">> => <<"none">>, <<"items">> => []});
                #{name := CName, args := Specs} -> complete_arg(Base, CName, Specs, After, Name)
            end
    end.

complete_arg(Base, CName, Specs, After, Name) ->
    Parts = string:split(After, " ", all),
    Partial = lists:last(Parts),
    Done = [P || P <- lists:droplast(Parts), P =/= ""],
    Idx = length(Done),
    Common = Base#{<<"command">> => tb(CName)},
    case spec_at(Idx, Specs) of
        none ->
            jenc(Common#{<<"kind">> => <<"none">>, <<"items">> => []});
        {_, Type, _} = Spec ->
            {Kind, Items} =
                case is_text(Type) of
                    true -> {<<"text">>, []};
                    false -> {<<"arg">>, [item_json(V, Hint) || {V, Hint} <- match(Partial, candidates(Type, Name)),
                                                                safe(V) =/= skip]}
                end,
            jenc(Common#{<<"kind">> => Kind, <<"token">> => safe_or_empty(Partial),
                         <<"arg">> => (arg_json(Spec))#{<<"index">> => min(Idx, length(Specs) - 1)},
                         <<"items">> => Items})
    end.

%% The argument being typed after Idx finished ones. Once a trailing text
%% argument has started, everything further is still that text.
spec_at(Idx, Specs) when Idx < length(Specs) -> lists:nth(Idx + 1, Specs);
spec_at(_Idx, []) -> none;
spec_at(_Idx, Specs) ->
    {_, Type, _} = Last = lists:last(Specs),
    case is_text(Type) of true -> Last; false -> none end.

safe_or_empty(Bytes) ->
    case safe(Bytes) of skip -> <<>>; B -> B end.

item_json(Value, Hint) ->
    V = safe(Value),
    #{<<"value">> => V, <<"label">> => V, <<"hint">> => tb(Hint)}.

%% What the argument could be, as {Value, Hint}. Only data this connection may
%% already see through /list, /groups and /hosts -- no directory browsing.
candidates(user, Self) ->
    [{U, "online"} || U <- chat_room:list_users(), U =/= Self];
candidates(group, Self) ->
    [{G, integer_to_list(length(M)) ++ " members"} || {G, M} <- chat_groups:list_groups_for(Self)];
candidates(host, _Self) ->
    [{K, N} || #{key := K, name := N, kind := "department"} <- chat_hosts:list_hosts()];
candidates({enum, Vs}, _Self) ->
    [{V, ""} || V <- Vs];
candidates(_, _) ->
    [].

%% Prefix matches first, then substring matches; each alphabetical; capped.
match(Partial, Cands) ->
    Q = ascii_lower(Partial),
    Low = fun({V, _}) -> ascii_lower(V) end,
    Pre = [C || C <- Cands, lists:prefix(Q, Low(C))],
    Sub = [C || C <- Cands, Q =/= "", not lists:prefix(Q, Low(C)), string:find(Low(C), Q) =/= nomatch],
    lists:sublist(lists:sort(Pre) ++ lists:sort(Sub), ?MAX_ARG_SUGGESTIONS).
