%%% Outbound delivery for Sandesh: OTP codes / invitations to people, and
%%% live events pushed to users who are connected right now.
%%%
%%% Delivery channel (SANDESH_OTP_MODE) -- the spec doesn't fix an SMS/email
%%% provider yet, so this is pluggable rather than hardcoded:
%%%   log      (default) the message, including any OTP, is written to the
%%%            server log. Dev only -- never use on a shared/real deployment.
%%%   fixed    OTP is always 123456 (the value the current frontend demo
%%%            screen advertises). Dev/demo only.
%%%   webhook  POST JSON to SANDESH_NOTIFY_WEBHOOK so any SMS/email gateway
%%%            can be plugged in without changing this code:
%%%            {"kind":"otp"|"invite"|..., "to":{"name","email","mobile"},
%%%             "text":"...", "code":"123456"}
%%% SANDESH_DEV_OTP=1 additionally echoes the OTP in the API response so a
%%% frontend developer (or a test) can finish a login without reading logs.
-module(sd_notify).
-export([otp_code/0, deliver/3, dev_echo/0, push/2, push_event/3, disconnect/1]).
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
        _ -> log
    end.

%% Kind: otp | invite | onboarding | ... (free text label for the receiver).
%% To: #{<<"name">>, <<"email">>, <<"mobile">>}. Extra: #{<<"code">> => ...}.
deliver(Kind, To, Extra) ->
    Text = maps:get(<<"text">>, Extra, <<>>),
    case channel() of
        webhook -> webhook(Kind, To, Extra);
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

%% Ends the user's live connection (used when an account is deactivated).
disconnect(Username) ->
    case chat_room:get_pid(sd_util:s(Username)) of
        {ok, Pid} -> Pid ! sd_disconnect, ok;
        error -> offline
    end.
