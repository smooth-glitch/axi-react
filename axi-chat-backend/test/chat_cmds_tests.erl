%%% Unit tests for the #command layer (chat_cmds). No Redis, no running server:
%%% they cover parsing, validation, rewriting into the existing commands, and
%%% the JSON the frontend consumes. Run: rebar3 eunit --module=chat_cmds_tests
-module(chat_cmds_tests).
-include_lib("eunit/include/eunit.hrl").

run(Line) -> chat_cmds:run(Line, "alice").

%% Line is a list of BYTES (that is what chat_web hands over).
bytes(Utf8) -> binary_to_list(unicode:characters_to_binary(Utf8)).

reply(Line) ->
    {reply, Json} = run(Line),
    json:decode(Json).

%% ---- the table itself ----------------------------------------------------------------------

table_names_are_unique_and_well_formed_test() ->
    All = lists:append([[N | A] || #{name := N, aliases := A} <- chat_cmds:commands()]),
    ?assertEqual(length(All), length(lists:usort(All))),
    [?assertMatch({match, _}, re:run(N, "^[a-z][a-z0-9-]{0,31}$")) || N <- All].

text_arg_is_always_last_test() ->
    lists:foreach(
      fun(#{name := N, args := Specs}) ->
          Texts = [I || {I, {_, T, _}} <- lists:zip(lists:seq(1, length(Specs)), Specs),
                        T =:= text orelse (is_tuple(T) andalso element(1, T) =:= text)],
          ?assertEqual({N, true}, {N, Texts =:= [] orelse Texts =:= [length(Specs)]})
      end, chat_cmds:commands()).

%% Whatever a command rewrites to must be a slash command: that is what
%% guarantees a rewrite can never re-enter the # parser.
every_command_rewrites_to_a_slash_line_test() ->
    Sample = fun(user) -> "bob"; (group) -> "team"; (host) -> "hr"; (msgid) -> "42";
                (emoji) -> "x"; (url) -> "https://a.b/c.png"; (word) -> "abc";
                ({enum, [V | _]}) -> V; (text) -> "hello there"; ({text, _}) -> "hello there" end,
    lists:foreach(
      fun(#{name := N, args := Specs}) ->
          Args = string:join([Sample(T) || {_, T, _} <- Specs], " "),
          case run("#" ++ N ++ " " ++ Args) of
              {line, [$/ | _]} -> ok;
              {reply, _} -> ?assertEqual("help", N);
              Other -> erlang:error({bad_rewrite, N, Other})
          end
      end, chat_cmds:commands()).

%% ---- rewriting ------------------------------------------------------------------------------

dm_rewrites_test() ->
    ?assertEqual({line, "/msg bob hello there"}, run("#dm bob hello there")).

command_name_and_alias_and_case_test() ->
    ?assertEqual({line, "/msg bob hi"}, run("#DM bob hi")),
    ?assertEqual({line, "/msg bob hi"}, run("#msg bob hi")),
    ?assertEqual({line, "/list"}, run("#online")).

extra_spaces_between_args_are_ignored_test() ->
    ?assertEqual({line, "/msg bob hi  there"}, run("#dm   bob    hi  there")).

message_text_is_passed_through_untouched_test() ->
    %% a slash or hash inside the text must not be re-interpreted
    ?assertEqual({line, "/msg bob /quit"}, run("#dm bob /quit")),
    ?assertEqual({line, "/msg bob #dm x y"}, run("#dm bob #dm x y")),
    ?assertEqual({line, "/msg bob a\nb"}, run("#dm bob a\nb")).

ids_are_normalised_test() ->
    ?assertEqual({line, "/delete global 7"}, run("#delete 007")),
    ?assertEqual({line, "/react dm bob 12 X"}, run("#reactdm bob 12 X")).

optional_args_test() ->
    ?assertEqual({line, "/gifsearch"}, run("#gif")),
    ?assertEqual({line, "/gifsearch cat"}, run("#gif cat")),
    ?assertEqual({line, "/history global"}, run("#history")).

utf8_text_survives_test() ->
    Line = "#dm bob " ++ bytes("héllo 👍"),
    ?assertEqual({line, "/msg bob " ++ bytes("héllo 👍")}, run(Line)).

%% ---- Sandesh actions: arguments become JSON, never string-pasted --------------------------------

sd_line(Line) ->
    {line, "/sd " ++ Rest} = run(Line),
    [Action, Json] = string:split(Rest, " "),
    {Action, json:decode(list_to_binary(Json))}.

sd_accept_test() ->
    ?assertEqual({"req.respond", #{<<"id">> => 12, <<"action">> => <<"accept">>, <<"reqId">> => <<"#accept">>}},
                 sd_line("#accept 12")).

sd_text_cannot_break_out_of_json_test() ->
    Evil = "say \"hi\", \\ and {\"reqId\":\"x\"} and \n newline",
    {"reminder.add", Args} = sd_line("#remind " ++ Evil),
    ?assertEqual(list_to_binary(Evil), maps:get(<<"text">>, Args)),
    ?assertEqual(<<"#remind">>, maps:get(<<"reqId">>, Args)).

sd_utf8_is_not_double_encoded_test() ->
    {"reminder.add", Args} = sd_line("#remind " ++ bytes("café")),
    ?assertEqual(<<"café"/utf8>>, maps:get(<<"text">>, Args)).

sd_markread_test() ->
    {_, All} = sd_line("#markread ALL"),
    ?assertEqual(true, maps:get(<<"all">>, All)),
    {_, Cat} = sd_line("#markread personal"),
    ?assertEqual(<<"personal">>, maps:get(<<"category">>, Cat)),
    ?assertMatch({reply, _}, run("#markread bogus")).

sd_optional_field_is_omitted_test() ->
    {_, NoStatus} = sd_line("#requests"),
    ?assertNot(maps:is_key(<<"status">>, NoStatus)),
    {_, WithStatus} = sd_line("#requests all"),
    ?assertEqual(<<"all">>, maps:get(<<"status">>, WithStatus)).

admin_status_test() ->
    {"admin.user.status", A} = sd_line("#admin-deactivate bob"),
    ?assertEqual(false, maps:get(<<"active">>, A)),
    ?assertEqual(<<"bob">>, maps:get(<<"username">>, A)).

%% ---- rejecting bad input --------------------------------------------------------------------------

error_code(Line) ->
    #{<<"type">> := <<"error">>, <<"code">> := Code} = reply(Line),
    Code.

unknown_command_test() ->
    ?assertEqual(<<"unknown_command">>, error_code("#nope")),
    #{<<"suggestions">> := S} = reply("#dmm"),
    ?assert(lists:member(<<"dm">>, S)).

a_prefix_never_executes_test() ->
    %% "#de" must not run "#delete"
    ?assertEqual(<<"unknown_command">>, error_code("#de 5")).

unknown_command_does_not_echo_junk_test() ->
    #{<<"text">> := Text} = reply("#a\tb<script>"),
    ?assertEqual(nomatch, binary:match(Text, <<"script">>)).

missing_and_extra_args_test() ->
    ?assertEqual(<<"usage">>, error_code("#dm")),
    ?assertEqual(<<"usage">>, error_code("#dm bob")),
    ?assertEqual(<<"usage">>, error_code("#users extra")),
    ?assertEqual(<<"usage">>, error_code("#delete 5 6")).

usage_error_carries_usage_string_test() ->
    #{<<"usage">> := U, <<"command">> := C} = reply("#dm"),
    ?assertEqual(<<"#dm <user> <text...>">>, U),
    ?assertEqual(<<"dm">>, C).

bad_ids_test() ->
    [?assertEqual(<<"usage">>, error_code("#delete " ++ Id))
     || Id <- ["abc", "-5", "+5", "5.0", "1e3", "12345678901234567890"]].

control_characters_in_arguments_are_rejected_test() ->
    %% a newline inside a non-text token would otherwise let a value smuggle a
    %% second line into the rewritten command
    ?assertEqual(<<"usage">>, error_code("#historydm bob\nfoo")),
    ?assertEqual(<<"usage">>, error_code("#creategroup a\tb")),
    ?assertEqual(<<"usage">>, error_code("#read bo" ++ [0] ++ "b")).

argument_length_limits_test() ->
    ?assertEqual(<<"usage">>, error_code("#historydm " ++ lists:duplicate(25, $a))),
    ?assertMatch({line, _}, run("#historydm " ++ lists:duplicate(24, $a))),
    ?assertEqual(<<"usage">>, error_code("#creategroup " ++ lists:duplicate(33, $a))),
    ?assertEqual(<<"usage">>, error_code("#status " ++ lists:duplicate(141, $a))).

avatar_url_is_restricted_test() ->
    ?assertMatch({line, "/setavatar https://x.io/a.png"}, run("#avatar https://x.io/a.png")),
    ?assertMatch({line, "/setavatar /uploads/abc.png"}, run("#avatar /uploads/abc.png")),
    ?assertEqual(<<"usage">>, error_code("#avatar javascript:alert(1)")),
    ?assertEqual(<<"usage">>, error_code("#avatar data:text/html,x")),
    ?assertEqual(<<"usage">>, error_code("#avatar //evil.example/x.png")).

invalid_utf8_is_rejected_not_crashed_test() ->
    ?assertEqual(<<"invalid_encoding">>, error_code([$#, $d, $m, $\s, $b, $\s, 16#ff, 16#fe])).

garbage_never_crashes_test() ->
    %% every one of these must come back as a value, not an exception
    Inputs = ["#a", "#a-", "#" ++ lists:duplicate(500, $x), "#dm " ++ lists:duplicate(1990, $y),
              "#help " ++ lists:duplicate(300, $z), "#markread   ", "#requests \t", "#form \n"],
    [?assert(is_tuple(run(I))) || I <- Inputs].

%% ---- help & catalog ---------------------------------------------------------------------------------

help_test() ->
    #{<<"type">> := <<"cmd_catalog">>} = reply("#help"),
    #{<<"type">> := <<"cmd_help">>, <<"command">> := #{<<"name">> := <<"dm">>}} = reply("#help dm"),
    #{<<"type">> := <<"cmd_help">>, <<"command">> := #{<<"name">> := <<"dm">>}} = reply("#help #DM"),
    ?assertEqual(<<"unknown_command">>, error_code("#help nope")).

catalog_shape_test() ->
    #{<<"type">> := <<"cmd_catalog">>, <<"prefix">> := <<"#">>, <<"escape">> := <<"##">>,
      <<"commands">> := Cmds, <<"categories">> := Cats} = json:decode(chat_cmds:catalog_json("")),
    ?assertEqual(length(chat_cmds:commands()), length(Cmds)),
    CatIds = [Id || #{<<"id">> := Id} <- Cats],
    [begin
         ?assert(lists:member(maps:get(<<"category">>, C), CatIds)),
         [?assert(maps:is_key(K, C)) || K <- [<<"name">>, <<"aliases">>, <<"summary">>, <<"usage">>,
                                              <<"args">>, <<"reply">>, <<"available">>, <<"requires">>]]
     end || C <- Cmds].

catalog_reports_availability_without_a_sandesh_session_test() ->
    #{<<"commands">> := Cmds} = json:decode(chat_cmds:catalog_json("")),
    ByName = maps:from_list([{maps:get(<<"name">>, C), C} || C <- Cmds]),
    ?assertMatch(#{<<"available">> := true, <<"requires">> := <<"none">>}, maps:get(<<"dm">>, ByName)),
    ?assertMatch(#{<<"available">> := true}, maps:get(<<"me">>, ByName)),
    ?assertMatch(#{<<"available">> := false, <<"requires">> := <<"signin">>}, maps:get(<<"cards">>, ByName)),
    ?assertMatch(#{<<"available">> := false, <<"requires">> := <<"signin">>}, maps:get(<<"admin-users">>, ByName)).

catalog_describes_args_test() ->
    #{<<"commands">> := Cmds} = json:decode(chat_cmds:catalog_json("")),
    [Dm] = [C || #{<<"name">> := <<"dm">>} = C <- Cmds],
    ?assertMatch([#{<<"name">> := <<"user">>, <<"type">> := <<"user">>, <<"required">> := true},
                  #{<<"name">> := <<"text">>, <<"type">> := <<"text">>, <<"rest">> := true, <<"max">> := 2000}],
                 maps:get(<<"args">>, Dm)),
    [Mr] = [C || #{<<"name">> := <<"markread">>} = C <- Cmds],
    [#{<<"values">> := Vs}] = maps:get(<<"args">>, Mr),
    ?assert(lists:member(<<"all">>, Vs)).

catalog_prefix_filter_test() ->
    #{<<"commands">> := Cmds} = json:decode(chat_cmds:catalog_json("RE")),
    Names = [maps:get(<<"name">>, C) || C <- Cmds],
    ?assert(lists:member(<<"reply">>, Names)),
    ?assert(lists:member(<<"react">>, Names)),
    ?assert(lists:member(<<"reminder">>, [A || C <- Cmds, A <- maps:get(<<"aliases">>, C)])),
    ?assertNot(lists:member(<<"dm">>, Names)),
    #{<<"commands">> := None} = json:decode(chat_cmds:catalog_json("zzz")),
    ?assertEqual([], None),
    %% junk filters are an empty result, not a crash
    #{<<"commands">> := Junk} = json:decode(chat_cmds:catalog_json("a b\n%")),
    ?assertEqual([], Junk).

%% ---- /cmdcomplete -------------------------------------------------------------------------------------

complete(Json) -> json:decode(chat_cmds:complete_json(Json, "alice")).

complete_command_names_test() ->
    #{<<"kind">> := <<"command">>, <<"items">> := Items, <<"reqId">> := 7} =
        complete("{\"input\":\"#gr\",\"reqId\":7}"),
    Vals = [V || #{<<"value">> := V} <- Items],
    ?assert(lists:member(<<"groups">>, Vals)),
    ?assert(lists:member(<<"groupmsg">>, Vals)),
    ?assertNot(lists:member(<<"dm">>, Vals)),
    [?assert(maps:is_key(K, I)) || I <- Items, K <- [<<"label">>, <<"hint">>, <<"usage">>, <<"available">>]].

complete_bare_hash_lists_commands_test() ->
    #{<<"kind">> := <<"command">>, <<"items">> := Items} = complete("{\"input\":\"#\"}"),
    ?assert(length(Items) > 10).

complete_enum_argument_test() ->
    #{<<"kind">> := <<"arg">>, <<"items">> := Items, <<"token">> := <<"pe">>,
      <<"arg">> := #{<<"name">> := <<"category">>, <<"index">> := 0}} =
        complete("{\"input\":\"#markread pe\"}"),
    ?assertEqual([<<"pending">>, <<"personal">>], [V || #{<<"value">> := V} <- Items]).

complete_trailing_space_starts_next_argument_test() ->
    %% the reason input travels inside JSON: "#dm bob " != "#dm bob"
    #{<<"kind">> := <<"text">>, <<"arg">> := #{<<"name">> := <<"text">>, <<"index">> := 1}} =
        complete("{\"input\":\"#dm bob \"}"),
    #{<<"kind">> := <<"text">>} = complete("{\"input\":\"#dm bob hello wor\"}").

complete_unknown_or_finished_test() ->
    ?assertMatch(#{<<"kind">> := <<"none">>, <<"items">> := []}, complete("{\"input\":\"#nope x\"}")),
    ?assertMatch(#{<<"kind">> := <<"none">>, <<"items">> := []}, complete("{\"input\":\"#users x\"}")),
    ?assertMatch(#{<<"kind">> := <<"none">>}, complete("{\"input\":\"#historydm bob x\"}")).

complete_rejects_bad_requests_test() ->
    Bad = ["", "not json", "[]", "{\"input\":5}", "{}",
           "{\"input\":\"" ++ lists:duplicate(600, $a) ++ "\"}"],
    [?assertMatch(#{<<"type">> := <<"error">>, <<"code">> := <<"usage">>}, complete(B)) || B <- Bad].
