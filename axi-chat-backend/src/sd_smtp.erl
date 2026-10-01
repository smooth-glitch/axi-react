%%% Minimal SMTP client (STARTTLS + AUTH LOGIN/PLAIN), no external dependencies, enough to send
%%% plain-text mail through Office 365 / any submission server on port 587.
%%%
%%% Configuration (environment; the password is never logged or returned):
%%%   SMTP_HOST      e.g. smtp.office365.com
%%%   SMTP_PORT      default 587
%%%   SMTP_USER      login (also the default sender)
%%%   SMTP_PASS      password
%%%   SMTP_FROM      sender address (default SMTP_USER)
%%%   SMTP_FROM_NAME display name (default "Connectum")
%%%   SMTP_STARTTLS  "0" to skip STARTTLS (tests against a local fake server only; default on)
%%% With STARTTLS on, the server certificate is verified against the system CA store.
-module(sd_smtp).
-export([configured/0, send/3, probe/0, from_name/0]).
-include_lib("kernel/include/logger.hrl").

-define(TIMEOUT, 20000).

configured() ->
    [] =/= env("SMTP_HOST") andalso [] =/= env("SMTP_USER") andalso [] =/= env("SMTP_PASS").

from_name() -> case env("SMTP_FROM_NAME") of [] -> "Connectum"; N -> N end.

%% Connects, upgrades to TLS, authenticates and quits without sending anything: proves the settings work.
probe() ->
    session(fun(_Sock, _Mod) -> ok end).

%% To: address (binary/string). Returns ok | {error, Reason} (Reason never contains the password).
send(To, Subject, Body) ->
    ToA = clean_addr(To),
    case ToA =:= [] of
        true -> {error, no_recipient};
        false ->
            From = case env("SMTP_FROM") of [] -> env("SMTP_USER"); F -> F end,
            session(fun(Sock, Mod) -> deliver(Sock, Mod, From, ToA, Subject, Body) end)
    end.

%% ---- protocol ------------------------------------------------------------------------------------------

session(Fun) ->
    Host = env("SMTP_HOST"),
    Port = case env("SMTP_PORT") of [] -> 587; P -> list_to_integer(P) end,
    try
        {ok, _} = application:ensure_all_started(ssl),
        {ok, Sock0} = gen_tcp:connect(Host, Port, [binary, {active, false}, {packet, line}], ?TIMEOUT),
        try
            expect(Sock0, gen_tcp, "220"),
            ehlo(Sock0, gen_tcp),
            {Sock, Mod} =
                case env("SMTP_STARTTLS") of
                    "0" -> {Sock0, gen_tcp};
                    _ ->
                        cmd(Sock0, gen_tcp, "STARTTLS", "220"),
                        {ok, S} = ssl:connect(Sock0, tls_opts(Host), ?TIMEOUT),
                        ehlo(S, ssl),
                        {S, ssl}
                end,
            auth(Sock, Mod),
            Result = Fun(Sock, Mod),
            try cmd(Sock, Mod, "QUIT", "221") catch _:_ -> ok end,
            Result
        after
            try gen_tcp:close(Sock0) catch _:_ -> ok end
        end
    catch
        throw:{smtp, Why} -> {error, Why};
        C:R ->
            ?LOG_WARNING("sd_smtp failed: ~p:~p", [C, scrub(R)]),
            {error, {C, scrub(R)}}
    end.

tls_opts(Host) ->
    [{verify, verify_peer}, {cacerts, public_key:cacerts_get()},
     {server_name_indication, Host},
     {customize_hostname_check, [{match_fun, public_key:pkix_verify_hostname_match_fun(https)}]},
     binary, {active, false}, {packet, line}].

ehlo(Sock, Mod) -> cmd(Sock, Mod, "EHLO connectum.local", "250").

auth(Sock, Mod) ->
    User = env("SMTP_USER"), Pass = env("SMTP_PASS"),
    cmd(Sock, Mod, "AUTH LOGIN", "334"),
    cmd(Sock, Mod, b64(User), "334"),
    cmd(Sock, Mod, b64(Pass), "235").

deliver(Sock, Mod, From, To, Subject, Body) ->
    cmd(Sock, Mod, "MAIL FROM:<" ++ From ++ ">", "250"),
    cmd(Sock, Mod, "RCPT TO:<" ++ To ++ ">", "25"),
    cmd(Sock, Mod, "DATA", "354"),
    Msg = [header("From", from_name() ++ " <" ++ From ++ ">"), header("To", To),
           header("Subject", encode_subject(Subject)),
           header("Date", rfc_date()), header("MIME-Version", "1.0"),
           header("Content-Type", "text/plain; charset=UTF-8"),
           header("Content-Transfer-Encoding", "base64"),
           "\r\n", wrap(base64:encode(unicode:characters_to_binary(Body))), "\r\n.\r\n"],
    send_raw(Sock, Mod, Msg),
    expect(Sock, Mod, "250").

cmd(Sock, Mod, Line, Expect) ->
    send_raw(Sock, Mod, [Line, "\r\n"]),
    expect(Sock, Mod, Expect).

send_raw(Sock, gen_tcp, Data) -> ok = gen_tcp:send(Sock, Data);
send_raw(Sock, ssl, Data) -> ok = ssl:send(Sock, Data).

%% Reads a (possibly multi-line) reply and checks its code starts with Expect.
expect(Sock, Mod, Expect) ->
    case read_reply(Sock, Mod, []) of
        {Code, Text} ->
            case lists:prefix(Expect, Code) of
                true -> ok;
                false -> throw({smtp, {unexpected_reply, Code, scrub(Text)}})
            end
    end.

read_reply(Sock, Mod, Acc) ->
    {ok, Line} = recv(Sock, Mod),
    L = binary_to_list(Line),
    Code = lists:sublist(L, 3),
    case L of
        [_, _, _, $- | _] -> read_reply(Sock, Mod, [L | Acc]);
        _ -> {Code, string:trim(lists:flatten(lists:reverse([L | Acc])))}
    end.

recv(Sock, gen_tcp) -> gen_tcp:recv(Sock, 0, ?TIMEOUT);
recv(Sock, ssl) -> ssl:recv(Sock, 0, ?TIMEOUT).

%% ---- helpers -------------------------------------------------------------------------------------------

header(Name, Value) -> [Name, ": ", strip_crlf(Value), "\r\n"].

%% Non-ASCII subjects as RFC 2047 encoded-words.
encode_subject(S0) ->
    S = strip_crlf(S0),
    case lists:all(fun(C) -> C < 128 end, S) of
        true -> S;
        false -> "=?UTF-8?B?" ++ binary_to_list(base64:encode(unicode:characters_to_binary(S))) ++ "?="
    end.

strip_crlf(V) -> [C || C <- to_list(V), C =/= $\r, C =/= $\n].

clean_addr(A) ->
    L = [C || C <- to_list(A), C =/= $\r, C =/= $\n, C =/= $<, C =/= $>, C =/= $\s],
    case string:find(L, "@") of nomatch -> []; _ -> L end.

wrap(B) when byte_size(B) =< 76 -> B;
wrap(B) -> <<Line:76/binary, Rest/binary>> = B, [Line, "\r\n", wrap(Rest)].

b64(S) -> base64:encode_to_string(unicode:characters_to_binary(S)).

rfc_date() ->
    {{Y, M, D}, {H, Mi, S}} = calendar:universal_time(),
    Days = {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"},
    Months = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"},
    Dow = element(calendar:day_of_the_week(Y, M, D), Days),
    lists:flatten(io_lib:format("~s, ~2..0w ~s ~w ~2..0w:~2..0w:~2..0w +0000",
                                [Dow, D, element(M, Months), Y, H, Mi, S])).

env(Name) -> case os:getenv(Name) of false -> []; V -> string:trim(V) end.

to_list(B) when is_binary(B) -> unicode:characters_to_list(B);
to_list(L) when is_list(L) -> L.

%% Never let credentials reach a log line or an error returned to a caller.
scrub(T) ->
    Pass = env("SMTP_PASS"),
    Flat = lists:flatten(io_lib:format("~p", [T])),
    case Pass of [] -> Flat; _ -> binary_to_list(binary:replace(list_to_binary(Flat), list_to_binary(Pass), <<"***">>, [global])) end.
