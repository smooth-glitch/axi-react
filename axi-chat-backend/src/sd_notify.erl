%%% Outbound delivery for Sandesh: OTP codes / invitations to people, and
%%% live events pushed to users who are connected right now.
%%%
%%% Delivery channel (SANDESH_OTP_MODE) -- the spec doesn't fix an SMS/email
%%% provider yet, so this is pluggable rather than hardcoded:
%%%   log      (default) the message, including any OTP, is written to the
%%%            server log. Dev only -- never use on a shared/real deployment.
%%%   fixed    OTP is always 123456 (the value the current frontend demo
%%%            screen advertises). Dev/demo only.
%%%   smtp     send real email through SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS (see sd_smtp.erl);
%%%            falls back to the log (and says so) for a person with no email address.
%%%   webhook  POST JSON to SANDESH_NOTIFY_WEBHOOK so any SMS/email gateway
%%%            can be plugged in without changing this code:
%%%            {"kind":"otp"|"invite"|..., "to":{"name","email","mobile"},
%%%             "text":"...", "code":"123456"}
%%% SANDESH_DEV_OTP=1 additionally echoes the OTP in the API response so a
%%% frontend developer (or a test) can finish a login without reading logs.
-module(sd_notify).
-export([otp_code/0, deliver/3, dev_echo/0, push/2, push_event/3, push_event_to/3, broadcast_event/2, disconnect/1, replaced/1]).
-include_lib("kernel/include/logger.hrl").

%% The code to issue. `fixed` mode makes it predictable for demos.
otp_code() ->
    case channel() of
        fixed -> <<"123456">>;
        _ -> sd_util:rand_digits(6)
    end.

dev_echo() -> os:getenv("SANDESH_DEV_OTP") =:= "1".

channel() ->
    case os:getenv("SANDESH_OTP_MODE") of
        "fixed" -> fixed;
        "webhook" -> webhook;
        "smtp" -> smtp;
        _ -> log
    end.

%% Kind: otp | invite | onboarding | ... (free text label for the receiver).
%% To: #{<<"name">>, <<"email">>, <<"mobile">>}. Extra: #{<<"code">> => ...}.
deliver(Kind, To, Extra) ->
    Text = maps:get(<<"text">>, Extra, <<>>),
    case channel() of
        webhook -> webhook(Kind, To, Extra);
        smtp -> smtp(Kind, To, Extra);
        _ ->
            warn_dev_channel(),
            %% Deliberately includes the code: log/fixed modes are dev-only.
            ?LOG_NOTICE("sd_notify[~s] to ~s <~s>: ~s ~s",
                        [Kind, maps:get(<<"name">>, To, <<>>), maps:get(<<"email">>, To, <<>>),
                         Text, maps:get(<<"code">>, Extra, <<>>)])
    end,
    ok.

%% In strict mode, OTP codes going to the server log (or being a fixed
%% value) means anyone who can read the log can sign in as anyone. Say so,
%% loudly, once -- it's the kind of thing that must not be missed on a
%% shared VM.
warn_dev_channel() ->
    case sd_util:strict() andalso persistent_term:get({?MODULE, warned}, false) =:= false of
        true ->
            persistent_term:put({?MODULE, warned}, true),
            ?LOG_WARNING(
                "SANDESH_MODE=strict but SANDESH_OTP_MODE is '~s': one-time codes are written to "
                "this log (or are a fixed value). Anyone who can read the log can sign in as "
                "anyone. Set SANDESH_OTP_MODE=webhook + SANDESH_NOTIFY_WEBHOOK before real use.",
                [case channel() of fixed -> "fixed"; _ -> "log" end]);
        false -> ok
    end.

%% Email through SMTP, off the caller's process so a slow mail server never blocks a request.
smtp(Kind, To, Extra) ->
    Email = maps:get(<<"email">>, To, <<>>),
    case sd_smtp:configured() andalso is_binary(Email) andalso Email =/= <<>> of
        false ->
            ?LOG_WARNING("sd_notify[~s]: SMTP not configured or no email for ~s; nothing sent",
                         [Kind, maps:get(<<"name">>, To, <<>>)]);
        true ->
            {Subject, Body} = mail_text(Kind, To, Extra),
            spawn(fun() -> send_with_retry(Kind, Email, Subject, Body, retry_delays()) end)
    end,
    ok.

%% Mail servers hiccup (connection reset, 4xx "try later"). Try again a couple of times, then give up and say so in
%% the log. A permanent refusal (bad address, wrong login: 5xx) is not retried. Delays in ms, SMTP_RETRY_DELAYS_MS
%% (default "0,5000,30000": the first attempt is immediate).
send_with_retry(Kind, Email, Subject, Body, [Delay | Rest]) ->
    timer:sleep(Delay),
    case sd_smtp:send(Email, Subject, Body) of
        ok ->
            ?LOG_NOTICE("sd_notify[~s]: email sent to ~s", [Kind, Email]);
        {error, Why} ->
            case Rest =/= [] andalso transient(Why) of
                true ->
                    ?LOG_WARNING("sd_notify[~s]: email to ~s failed (~p); will retry", [Kind, Email, Why]),
                    send_with_retry(Kind, Email, Subject, Body, Rest);
                false ->
                    ?LOG_WARNING("sd_notify[~s]: email to ~s failed: ~p", [Kind, Email, Why])
            end
    end.

transient({unexpected_reply, [$4 | _], _}) -> true;      %% 4xx: ask again later
transient({unexpected_reply, _, _}) -> false;            %% 5xx: refused for good
transient(no_recipient) -> false;
transient(_) -> true.                                    %% connection / TLS / timeout trouble

retry_delays() ->
    Default = [0, 5000, 30000],
    case os:getenv("SMTP_RETRY_DELAYS_MS") of
        false -> Default;
        S ->
            Parts = [string:trim(P) || P <- string:split(S, ",", all)],
            try [list_to_integer(P) || P <- Parts, P =/= ""] of
                [] -> Default;
                L -> L
            catch _:_ -> Default
            end
    end.

mail_text(Kind, To, Extra) ->
    Name = maps:get(<<"name">>, To, <<>>),
    Text = maps:get(<<"text">>, Extra, <<>>),
    Code = maps:get(<<"code">>, Extra, <<>>),
    AppUrl = case os:getenv("APP_URL") of false -> "https://10.0.2.146"; U -> U end,
    Subject = case Kind of
                  invite -> "You're invited to Connectum";
                  otp -> "Your Connectum sign-in code";
                  _ -> "Connectum notification"
              end,
    Greeting = case Name of <<>> -> "Hello,"; _ -> ["Hello ", Name, ","] end,
    CodeLine = case Code of <<>> -> ""; _ -> ["\r\n\r\nYour code: ", Code, "\r\n(It expires shortly. Never share it with anyone.)"] end,
    Body = unicode:characters_to_binary(
             [Greeting, "\r\n\r\n", Text, CodeLine,
              "\r\n\r\nOpen the app: ", AppUrl,
              "\r\nThe app is reachable on the office network. Working remotely? You need VPN access: "
              "contact AXPERT SUPPORT to get your VPN config.\r\n\r\n-- Connectum, Agile Labs\r\n"]),
    {Subject, Body}.

webhook(Kind, To, Extra) ->
    case os:getenv("SANDESH_NOTIFY_WEBHOOK") of
        false -> ?LOG_WARNING("SANDESH_OTP_MODE=webhook but SANDESH_NOTIFY_WEBHOOK is not set");
        "" -> ?LOG_WARNING("SANDESH_OTP_MODE=webhook but SANDESH_NOTIFY_WEBHOOK is not set");
        Url ->
            Body = sd_util:jenc(maps:merge(#{<<"kind">> => sd_util:b(Kind), <<"to">> => To}, Extra)),
            %% Fire and forget: a slow SMS gateway must never block a login.
            spawn(fun() ->
                try
                    {ok, _} = application:ensure_all_started(inets),
                    {ok, _} = application:ensure_all_started(ssl),
                    Req = {Url, [], "application/json", Body},
                    case httpc:request(post, Req, [{timeout, 8000}, {connect_timeout, 4000}], []) of
                        {ok, {{_, Code, _}, _, _}} when Code >= 200, Code < 300 -> ok;
                        {ok, {{_, Code, _}, _, _}} -> ?LOG_WARNING("notify webhook answered HTTP ~p", [Code]);
                        {error, Reason} -> ?LOG_WARNING("notify webhook failed: ~p", [Reason])
                    end
                catch C:R -> ?LOG_WARNING("notify webhook crashed: ~p:~p", [C, R])
                end
            end)
    end.

%% ---- live pushes to connected users ---------------------------------------------------------

%% Sends a raw JSON binary to the user's socket if they're online; a no-op
%% otherwise (offline users see the same information via /sd req.list and
%% /sd cards.list when they reconnect -- pushes are a convenience, never the
%% only copy).
push(Username, JsonBin) when is_binary(JsonBin) ->
    case chat_room:get_pid(sd_util:s(Username)) of
        {ok, Pid} -> Pid ! {sd_push, JsonBin}, ok;
        error -> offline
    end.

%% {"type":"sd_event","event":Event,"data":Data}
push_event(Username, Event, Data) ->
    push(Username, sd_util:jenc(#{<<"type">> => <<"sd_event">>,
                                  <<"event">> => sd_util:b(Event), <<"data">> => Data})).

%% The same event to several users (each at most once), and to everyone online. Used for
%% "something you may be looking at changed" hints: the client re-reads what it shows.
push_event_to(Usernames, Event, Data) ->
    lists:foreach(fun(U) -> push_event(U, Event, Data) end,
                  lists:usort([sd_util:s(U) || U <- Usernames, is_binary(U) orelse is_list(U)])),
    ok.

broadcast_event(Event, Data) ->
    Online = try chat_room:list_users() catch _:_ -> [] end,
    push_event_to(Online, Event, Data).

%% Ends the user's live connection because they signed in somewhere else
%% (one active session per account). The client gets `session_replaced`.
replaced(Username) ->
    case chat_room:get_pid(sd_util:s(Username)) of
        {ok, Pid} -> Pid ! sd_replaced, ok;
        error -> offline
    end.

%% Ends the user's live connection (used when an account is deactivated).
disconnect(Username) ->
    case chat_room:get_pid(sd_util:s(Username)) of
        {ok, Pid} -> Pid ! sd_disconnect, ok;
        error -> offline
    end.
