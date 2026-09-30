%%% Connectum codes: every enterprise and every person has one unique code, shown as a QR code. People connect to
%%% an enterprise, or to each other, by scanning it or typing it in.
%%%
%%% One deployment = one enterprise (it may run on the enterprise's own server or private cloud). The code is
%%% therefore paired with the deployment's public address (SANDESH_PUBLIC_URL) inside the QR payload, so a
%%% person's app can hold several enterprises ("channels"): each is just another address to talk to.
%%%
%%% Codes are 8 characters of Crockford base32 (no I, L, O, U), shown as XXXX-XXXX. Typing is forgiving:
%%% case, spaces and dashes are ignored, and O/0, I/L/1 are read the way a person meant them.
%%%
%%%   enterprise code   stored in the org record; public (anyone may look up who it belongs to)
%%%   person code       private to its owner until they show it; can be replaced at any time (rotate)
%%%                     -- a person's code is never resolved for anonymous visitors, so codes can't be harvested.
-module(sd_connect).
-export([normalize/1, display/1, org_code/0, user_code/1, rotate_user_code/1, lookup/1,
         my/1, enterprise_card/0, payload/1, public_lookup/1, scan/2, check_registration_code/1]).

-define(CODES, "sd:connect:code").      %% code -> "o" | "u:<username>"
-define(USERS, "sd:connect:user").      %% username -> code
-define(ALPHABET, "0123456789ABCDEFGHJKMNPQRSTVWXYZ").

%% ---- code text --------------------------------------------------------------------------------------------

%% -> {ok, <<"7K2M9QDF">>} | error
normalize(Text) when is_binary(Text) ->
    Up = string:uppercase(Text),
    Chars = [fix(C) || <<C>> <= Up, is_alnum(C)],
    Bin = list_to_binary(Chars),
    case byte_size(Bin) =:= 8 andalso lists:all(fun(C) -> lists:member(C, ?ALPHABET) end, binary_to_list(Bin)) of
        true -> {ok, Bin};
        false -> error
    end;
normalize(_) -> error.

is_alnum(C) -> (C >= $0 andalso C =< $9) orelse (C >= $A andalso C =< $Z).
fix($O) -> $0;
fix($I) -> $1;
fix($L) -> $1;
fix($U) -> $V;
fix(C) -> C.

display(<<A:4/binary, B:4/binary>>) -> <<A/binary, "-", B/binary>>;
display(Other) -> Other.

new_code() ->
    << <<(lists:nth((N rem 32) + 1, ?ALPHABET))>> || <<N:5>> <= crypto:strong_rand_bytes(5) >>.

%% Claims a fresh unique code for Value. HSETNX makes two callers unable to take the same one.
claim(Value) ->
    Code = new_code(),
    case sd_db:q(["HSETNX", ?CODES, Code, Value]) of
        <<"1">> -> Code;
        _ -> claim(Value)
    end.

%% ---- the codes --------------------------------------------------------------------------------------------

%% The enterprise's code (created the first time it is asked for, so older deployments get one too).
org_code() ->
    case sd_db:hget("sd:org", "code") of
        undefined ->
            Code = claim(<<"o">>),
            case sd_db:q(["HSETNX", "sd:org", "code", Code]) of
                <<"1">> -> Code;
                _ ->                                   %% someone else set one first: use theirs, free ours
                    sd_db:hdel(?CODES, Code),
                    sd_db:hget("sd:org", "code")
            end;
        Code -> Code
    end.

user_code(Username) ->
    U = sd_util:s(sd_util:norm_user(Username)),
    case sd_db:hget(?USERS, U) of
        undefined ->
            Code = claim(<<"u:", (sd_util:b(U))/binary>>),
            case sd_db:q(["HSETNX", ?USERS, U, Code]) of
                <<"1">> -> Code;
                _ -> sd_db:hdel(?CODES, Code), sd_db:hget(?USERS, U)
            end;
        Code -> Code
    end.

%% A new personal code; the old one stops working immediately.
rotate_user_code(Username) ->
    U = sd_util:s(sd_util:norm_user(Username)),
    Old = sd_db:hget(?USERS, U),
    New = claim(<<"u:", (sd_util:b(U))/binary>>),
    sd_db:hset(?USERS, U, New),
    case Old of undefined -> ok; _ -> sd_db:hdel(?CODES, Old) end,
    New.

%% -> {org} | {user, Username} | not_found | invalid
lookup(Text) ->
    case normalize(Text) of
        error -> invalid;
        {ok, Code} ->
            case sd_db:hget(?CODES, Code) of
                <<"o">> -> org;
                <<"u:", U/binary>> -> {user, U};
                _ -> not_found
            end
    end.

%% ---- what the QR carries ------------------------------------------------------------------------------------

%% The text to encode into the QR image. With SANDESH_PUBLIC_URL set it is a link
%% (<public url>/connect/<CODE>) that also tells the app where this enterprise lives; without it, "connectum:<CODE>".
payload(Code) ->
    case public_url() of
        undefined -> {<<"connectum:", Code/binary>>, null};
        Base -> Url = <<Base/binary, "/connect/", Code/binary>>, {Url, Url}
    end.

public_url() ->
    case os:getenv("SANDESH_PUBLIC_URL") of
        false -> undefined;
        "" -> undefined;
        S -> string:trim(sd_util:b(S), trailing, "/")
    end.

code_view(Code) ->
    {Payload, Url} = payload(Code),
    #{<<"code">> => Code, <<"display">> => display(Code), <<"payload">> => Payload, <<"url">> => Url}.

%% What an anonymous visitor may see about the enterprise behind a code.
enterprise_card() ->
    Info = sd_org:info(),
    Pub = sd_org:public(),
    (code_view(org_code()))#{<<"name">> => maps:get(<<"name">>, Info),
                             <<"location">> => case maps:get(<<"location">>, Info) of
                                                   L when is_map(L) -> L;
                                                   _ -> null
                                               end,
                             <<"categories">> => maps:get(<<"categories">>, Pub),
                             <<"setupDone">> => maps:get(<<"setupDone">>, Info)}.

%% Public lookup (no sign-in): only enterprise codes resolve. A personal code looks exactly like an unknown one.
public_lookup(Text) ->
    case lookup(Text) of
        org -> {ok, #{<<"type">> => <<"enterprise">>, <<"enterprise">> => enterprise_card()}};
        _ -> {error, not_found, <<"No enterprise found for that code.">>}
    end.

%% "My codes": the caller's own code and the enterprise's, both ready to draw as QR images.
my(User) ->
    Name = maps:get(<<"username">>, User),
    #{<<"person">> => (code_view(user_code(Name)))#{<<"name">> => maps:get(<<"name">>, User),
                                                    <<"username">> => Name},
      <<"enterprise">> => enterprise_card()}.

%% ---- scanning ------------------------------------------------------------------------------------------------

%% A signed-in user scans or types a code.
%%   personal code   -> the two become associates straight away (showing your code is consent), the owner is told
%%   enterprise code -> this is the enterprise the caller is already in: return its card
scan(User, Text) ->
    Me = maps:get(<<"username">>, User),
    case lookup(Text) of
        invalid -> {error, invalid_code, <<"That isn't a valid Connectum code.">>};
        not_found -> {error, not_found, <<"No one has that code.">>};
        org -> {ok, #{<<"type">> => <<"enterprise">>, <<"enterprise">> => enterprise_card(),
                      <<"alreadyMember">> => true}};
        {user, Me} -> {error, invalid, <<"That's your own code.">>};
        {user, Other} ->
            case sd_users:get(Other) of
                #{<<"status">> := <<"active">>} = Target ->
                    case sd_users:associated(Me, Other) of
                        true ->
                            {ok, #{<<"type">> => <<"person">>, <<"user">> => sd_users:public(Target),
                                   <<"alreadyConnected">> => true}};
                        false ->
                            sd_users:assoc_add(Me, Other, peer),
                            tell_owner(Other, User),
                            {ok, #{<<"type">> => <<"person">>, <<"user">> => sd_users:public(Target),
                                   <<"alreadyConnected">> => false}}
                    end;
                _ -> {error, not_found, <<"No one has that code.">>}
            end
    end.

tell_owner(Owner, Scanner) ->
    Name = maps:get(<<"name">>, Scanner),
    Who = maps:get(<<"username">>, Scanner),
    sd_feed_srv:async(fun() ->
        sd_feed:notify(Owner, #{<<"severity">> => <<"low">>, <<"category">> => <<"system">>,
                                <<"title">> => <<"New connection">>,
                                <<"message">> => <<Name/binary, " connected with you by scanning your code.">>,
                                <<"icon">> => <<"qr_code_scanner">>,
                                <<"key">> => <<"scan:", Who/binary>>}, [])
    end),
    sd_notify:push_event(Owner, <<"associate_connected">>, #{<<"user">> => Who, <<"via">> => <<"code">>}),
    ok.

%% ---- registration ----------------------------------------------------------------------------------------------

%% Self-registration may carry the enterprise code (that is how a scanned QR reaches it). It must be right when given;
%% SANDESH_REQUIRE_CODE=1 makes it mandatory (an enterprise that only wants people who scanned its QR).
check_registration_code(Body) ->
    case sd_util:get(<<"code">>, Body) of
        V when is_binary(V), V =/= <<>> ->
            case lookup(V) of
                org -> ok;
                _ -> {error, invalid_code, <<"That enterprise code isn't right.">>}
            end;
        _ ->
            case os:getenv("SANDESH_REQUIRE_CODE") of
                "1" -> {error, code_required, <<"Scan or enter this enterprise's Connectum code to register.">>};
                _ -> ok
            end
    end.
