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
-define(MAX_PAGE_SIZE, 25).

%% ---- the command table -----------------------------------------------------------------------
%%
%% Args are {Name, Type, req | opt}. Types:
%%   user | group | host | msgid | emoji | url | word | phrase (several words, only before single-token args) | {enum, [Value]}
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
     cmd("profile", [], lookup, "See someone's avatar and status",
         [{user, user, req}],
         {line, fun([U]) -> "/getprofile " ++ U end}, ["profile"]),

     %% ---- groups ----
     cmd("creategroup", ["newgroup"], groups, "Create a group (the name can have spaces)",
         [{name, group, req}],
         {line, fun([G]) -> "/creategroup " ++ G end}, ["group_created"]),
     cmd("addmember", ["invitegroup"], groups, "Add an online user to a group you are in",
         [{group, group, req}, {user, user, req}],
         {line, fun([G, U]) -> "/addmember " ++ G ++ " " ++ U end}, ["group_created"]),
     cmd("leavegroup", ["leave"], groups, "Leave a group",
         [{group, group, req}],
         {line, fun([G]) -> "/leavegroup " ++ G end}, ["left_group"]),

     %% ---- your profile ----

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
     cmd("transfer", [], people, "Ask another host to take over one of your users (hosts only)",
         [{user, user, req}, {toHost, user, req}],
         {sd, <<"host.transfer">>, fun([U, H]) -> #{<<"user">> => ub(U), <<"toHost">> => ub(H)} end}, ["sd"]),

     %% ---- notifications, cards, reminders ----
     cmd("notifications", ["notifs"], inbox, "Your notifications (unread first)",
         [{category, CatEnum, opt}],
         {sd, <<"notifications.list">>, fun([C]) -> opt_field(<<"category">>, C, #{}) end}, ["sd"]),
     cmd("remind", ["reminder"], inbox, "Add a reminder card for yourself",
         [{text, {text, 500}, req}],
         {sd, <<"reminder.add">>, fun([T]) -> #{<<"text">> => ub(T)} end}, ["sd"]),

     %% ---- forms ----
     cmd("forms", ["options"], forms, "The forms and options available to you",
         [], {sd, <<"options.list">>, fun([]) -> #{} end}, ["sd"]),
     cmd("lookups", ["cfg-lookups"], forms, "Org config lists for Option Builder dropdowns (branches, departments, etc.)",
         [], {sd, <<"cfg.lookups">>, fun([]) -> #{} end}, ["sd"]),
     cmd("form", [], forms, "Open a form definition",
         [{name, word, req}],
         {sd, <<"tstruct.get">>, fun([N]) -> #{<<"name">> => ub(N)} end}, ["sd"]),
     cmd("submissions", [], forms, "Forms you have submitted",
         [], {sd, <<"submissions.list">>, fun([]) -> #{} end}, ["sd"]),
     %% ---- lite tstruct viewer (hash commands) ----
     %% #tstruct <name>         -- open the viewer: returns the definition + your own records
     %% #tstruct-add <name>     -- opens the definition only (caller fills values via tstruct.user.submit)
     %% #tstruct-edit <name> <id> -- open the viewer with a specific record pre-selected for editing
     %% #tstruct-delete <name> <id> -- delete your own record
     cmd("tstruct", ["ts", "struct"], forms, "Open a lite T-Struct in the viewer (definition + your records)",
         [{name, phrase, req}],
         {sd, <<"tstruct.user.open">>, fun([N]) -> #{<<"name">> => ub(N)} end}, ["sd"]),
     cmd("tstruct-add", ["ts-add", "struct-add"], forms, "Open a lite T-Struct to add a new record",
         [{name, phrase, req}],
         {sd, <<"tstruct.user.open">>, fun([N]) -> #{<<"name">> => ub(N), <<"mode">> => <<"add">>} end}, ["sd"]),
     cmd("tstruct-edit", ["ts-edit", "struct-edit"], forms, "Edit your own record in a lite T-Struct",
         [{name, phrase, req}, {submissionId, msgid, req}],
         {sd, <<"tstruct.user.open">>, fun([N, I]) -> #{<<"name">> => ub(N), <<"editRecordId">> => I} end}, ["sd"]),
     cmd("tstruct-delete", ["ts-delete", "struct-delete"], forms, "Delete your own record from a lite T-Struct",
         [{name, phrase, req}, {submissionId, msgid, req}],
         {sd, <<"submissions.delete">>, fun([_N, I]) -> #{<<"id">> => I} end}, ["sd"]),

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
parse_args([{Name, phrase, Req} | More], Str, Acc) ->
    parse_phrase(Name, Req, More, Str, Acc);
%% Groups and hosts may have several words in their name ("design team"): match
%% the line against the ones that exist first (longest wins), then fall back.
parse_args([{Name, Type, Req} | More], Str, Acc) when Type =:= group; Type =:= host ->
    case chat_names:longest(known(Type), Str, Type =:= group) of
        {ok, Val, Rest} -> parse_args(More, Rest, [Val | Acc]);
        none ->
            case lists:any(fun({_, T, _}) -> is_text(T) end, More) of
                false when Type =:= group -> parse_phrase(Name, Type, Req, More, Str, Acc);
                _ -> parse_word(Name, Type, Req, More, Str, Acc)
            end
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

%% A multi-word value (e.g. a T-Struct called "Leave Request"). It takes every token
%% except the ones the remaining (single-token) args need at the end of the line.
parse_phrase(Name, Req, More, Str, Acc) -> parse_phrase(Name, phrase, Req, More, Str, Acc).

parse_phrase(Name, Type, Req, More, Str, Acc) ->
    Toks = string:tokens(Str, " "),
    Keep = length(Toks) - length(More),
    if
        Keep < 1, Req =:= req -> {error, missing(Name)};
        Keep < 1 -> parse_args(More, Str, ["" | Acc]);
        true ->
            {Head, Tail} = lists:split(Keep, Toks),
            Phrase = string:join(Head, " "),
            case phrase_ok(Name, Type, Phrase) of
                {ok, Val} -> parse_args(More, string:join(Tail, " "), [Val | Acc]);
                {error, _} = E -> E
            end
    end.

phrase_ok(Name, group, Phrase) -> convert(Name, group, Phrase);
phrase_ok(Name, _, Phrase) -> sized(Name, Phrase, 100, "a name").

%% {Text, Value} for every group / host that exists (empty if the registry isn't up).
known(group) ->
    try [{G, G} || G <- chat_groups:all_names()] catch _:_ -> [] end;
known(host) ->
    try lists:append([[{K, K}, {N, K}] || #{key := K, name := N} <- chat_hosts:list_hosts()])
    catch _:_ -> [] end.

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
type_name(phrase) -> "text";
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
                    In -> complete(binary_to_list(In), maps:get(<<"reqId">>, Args, null), Name,
                                   pos_int(maps:get(<<"page">>, Args, 1), 1, 100000),
                                   pos_int(maps:get(<<"pageSize">>, Args, 0), 0, ?MAX_PAGE_SIZE));
                    _ -> error_json("invalid_encoding", "input is not valid UTF-8.", #{})
                end;
            _ ->
                error_json("usage", "Usage: /cmdcomplete {\"input\":\"#dm al\"} (input up to 512 bytes).", #{})
        end
    catch Class:Reason:Stack ->
        ?LOG_ERROR("chat_cmds complete crashed: ~p:~p at ~p", [Class, reason_tag(Reason), crash_site(Stack)]),
        error_json("internal", "Something went wrong completing that.", #{})
    end.

pos_int(V, _Min, Max) when is_integer(V), V >= 0 -> min(V, Max);
pos_int(_, Min, _) -> Min.

%% Slice a full result list into one page. PageSize 0 = the default for that kind of list.
%% Adds page / pageSize / total / totalPages / hasMore so the client can draw a pager.
paginate(Items, Page0, Size0, DefaultSize) ->
    Size = case Size0 of 0 -> DefaultSize; _ -> Size0 end,
    Total = length(Items),
    TotalPages = max(1, (Total + Size - 1) div Size),
    Page = min(max(Page0, 1), TotalPages),
    Slice = lists:sublist(Items, (Page - 1) * Size + 1, Size),
    {Slice, #{<<"page">> => Page, <<"pageSize">> => Size, <<"total">> => Total,
              <<"totalPages">> => TotalPages, <<"hasMore">> => Page < TotalPages}}.

complete(Input, ReqId, Name, Page, Size) ->
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
            {PageHits, PageInfo} = paginate(Hits, Page, Size, ?MAX_CMD_SUGGESTIONS),
            Items = [begin
                         J = command_json(C, Ctx),
                         #{<<"value">> => maps:get(<<"name">>, J), <<"label">> => <<"#", (maps:get(<<"name">>, J))/binary>>,
                           <<"hint">> => maps:get(<<"summary">>, J), <<"usage">> => maps:get(<<"usage">>, J),
                           <<"category">> => maps:get(<<"category">>, J), <<"available">> => maps:get(<<"available">>, J)}
                     end || C <- PageHits],
            jenc(maps:merge(Base#{<<"kind">> => <<"command">>, <<"token">> => safe_or_empty(Tok), <<"items">> => Items}, PageInfo));
        {Tok, [$\s | After]} ->
            case find(ascii_lower(Tok)) of
                undefined -> jenc(Base#{<<"kind">> => <<"none">>, <<"items">> => []});
                #{name := CName, args := Specs} -> complete_arg(Base, CName, Specs, After, Name, Page, Size)
            end
    end.

complete_arg(Base, CName, Specs, After, Name, Page, Size) ->
    Common = Base#{<<"command">> => tb(CName)},
    case walk(Specs, After, Name, 0) of
        none ->
            jenc(Common#{<<"kind">> => <<"none">>, <<"items">> => []});
        {Idx, Partial} ->
            {_, Type, _} = Spec = lists:nth(min(Idx, length(Specs) - 1) + 1, Specs),
            case is_text(Type) of
                true ->
                    jenc(Common#{<<"kind">> => <<"text">>, <<"token">> => safe_or_empty(Partial),
                                 <<"arg">> => (arg_json(Spec))#{<<"index">> => min(Idx, length(Specs) - 1)},
                                 <<"items">> => []});
                false ->
                    All = [C || C <- match(Partial, candidates(Type, Name)), safe(element(1, C)) =/= skip],
                    {Slice, PageInfo} = paginate(All, Page, Size, ?MAX_ARG_SUGGESTIONS),
                    Items = [item_json(C) || C <- Slice],
                    jenc(maps:merge(Common#{<<"kind">> => <<"arg">>, <<"token">> => safe_or_empty(Partial),
                                            <<"arg">> => (arg_json(Spec))#{<<"index">> => min(Idx, length(Specs) - 1)},
                                            <<"items">> => Items}, PageInfo))
            end
    end.

%% Find which argument is being typed and what has been typed of it so far.
%% Names that may have spaces (tstruct captions, groups, hosts) swallow the rest of the
%% line until what was typed is exactly a known name followed by a space.
walk([], _Str, _Name, _Idx) -> none;
walk([{_, T, _} | More], Str, Name, Idx) ->
    S = skip_spaces(Str),
    Multi = lists:member(T, [phrase, group, host]) andalso
            (T =:= phrase orelse not lists:any(fun({_, T2, _}) -> is_text(T2) end, More)),
    walk_arg(is_text(T), Multi, T, More, S, Name, Idx).

walk_arg(true, _, _, _, S, _, Idx) -> {Idx, S};
walk_arg(false, true, T, More, S, Name, Idx) ->
    Known = [{X, X} || X <- known_texts(T, Name)],
    Ended = S =/= "" andalso lists:last(S) =:= $\s,
    case chat_names:longest(Known, S, false) of
        {ok, _, Rest} when Rest =/= ""; Ended -> walk(More, Rest, Name, Idx + 1);
        _ -> {Idx, S}
    end;
walk_arg(false, false, _, More, S, Name, Idx) ->
    {Tok, Rest} = lists:splitwith(fun(C) -> C =/= $\s end, S),
    case {Rest, More} of
        {[], _} -> {Idx, Tok};
        {_, []} -> none;
        _ -> walk(More, Rest, Name, Idx + 1)
    end.

known_texts(phrase, Self) -> lists:append([[V, A] || {V, _, A} <- candidates(phrase, Self)]);
known_texts(host, Self) -> lists:append([[V, H] || {V, H} <- candidates(host, Self)]);
known_texts(Type, Self) -> [V || {V, _} <- candidates(Type, Self)].

safe_or_empty(Bytes) ->
    case safe(Bytes) of skip -> <<>>; B -> B end.

item_json({V, H, _Alt}) -> item_json(V, H);
item_json({V, H}) -> item_json(V, H).

item_json(Value, Hint) ->
    V = safe(Value),
    #{<<"value">> => V, <<"label">> => V, <<"hint">> => tb(Hint)}.

%% What the argument could be, as {Value, Hint}. Only data this connection may
%% already see through /list, /groups and /hosts -- no directory browsing.
candidates(phrase, Self) ->
    try sd_users:get(Self) of
        undefined -> [];
        User ->
            [{binary_to_list(maps:get(<<"caption">>, D, maps:get(<<"name">>, D))),
              binary_to_list(maps:get(<<"name">>, D)),
              binary_to_list(maps:get(<<"name">>, D))} || D <- sd_config:visible_tstructs(User)]
    catch _:_ -> []   %% store unreachable: no suggestions rather than an error
    end;
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
    Low = fun(C) -> ascii_lower(element(1, C)) end,
    Alt = fun({_, _, A}) -> ascii_lower(A); (_) -> "" end,
    Pre = [C || C <- Cands, lists:prefix(Q, Low(C)) orelse (Alt(C) =/= "" andalso lists:prefix(Q, Alt(C)))],
    Sub = [C || C <- Cands, Q =/= "", not lists:member(C, Pre),
                string:find(Low(C), Q) =/= nomatch orelse string:find(Alt(C), Q) =/= nomatch],
    lists:sort(Pre) ++ lists:sort(Sub).