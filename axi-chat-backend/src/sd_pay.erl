%%% Payments behind a `pay` option. Sandesh doesn't hold money or talk to a payment provider itself: it keeps the
%%% payment's record and state, and lets the enterprise's systems settle it, in whichever of these ways fits:
%%%   * the person submits a reference (UPI id, receipt no.) -- pay.confirm
%%%       - with `verifyDatasource` on the option: the data source is asked; a row back means paid
%%%       - without: the payment stays "submitted" until an administrator marks it (admin.pay.mark)
%%%   * the enterprise's payment system calls POST /api/sd/pay/webhook with the shared secret
%%%     (env SANDESH_PAY_WEBHOOK_SECRET; unset = webhook disabled)
%%% States: created -> submitted -> paid | failed; created/submitted -> cancelled. paid and failed are final.
-module(sd_pay).
-export([config/2, create/2, confirm/3, status/2, cancel/2, list/2, mark/3, webhook/2, webhook_enabled/0]).

-compile({no_auto_import, [get/1]}).

-define(PAYS, "sd:pays").

%% Extra keys a pay option stores: amount (> 0), currency, description, verifyDatasource.
config(<<"pay">>, Raw) ->
    Amount = sd_util:get(<<"amount">>, Raw, null),
    Ver = sd_util:get(<<"verifyDatasource">>, Raw, null),
    Cur = case sd_util:get(<<"currency">>, Raw) of C when is_binary(C), C =/= <<>> -> binary:part(C, 0, min(8, byte_size(C))); _ -> <<"INR">> end,
    Desc = case sd_util:get(<<"description">>, Raw) of D when is_binary(D) -> binary:part(D, 0, min(200, byte_size(D))); _ -> <<>> end,
    case {Amount =:= null orelse (is_number(Amount) andalso Amount > 0),
          Ver =:= null orelse (is_binary(Ver) andalso sd_datasource:get(Ver) =/= undefined)} of
        {false, _} -> {error, invalid, <<"amount must be a number above 0.">>};
        {_, false} -> {error, invalid, <<"Unknown data source in verifyDatasource.">>};
        _ -> {ok, #{<<"amount">> => Amount, <<"currency">> => Cur, <<"description">> => Desc, <<"verifyDatasource">> => Ver}}
    end;
config(_, _) -> {ok, #{}}.

get(Id) when is_integer(Id) -> sd_db:hget_json(?PAYS, integer_to_list(Id));
get(_) -> undefined.
put(P) -> sd_db:hset_json(?PAYS, integer_to_list(maps:get(<<"id">>, P)), P#{<<"updatedTs">> => sd_util:now_ms()}).
put_(P) -> Q = P#{<<"updatedTs">> => sd_util:now_ms()}, put(Q), Q.

%% Option = a stored pay option. Amount: the option's own, else the caller's `amount` (must be > 0).
create(User, Args) ->
    Opt = maps:get(option, Args),
    Me = maps:get(<<"username">>, User),
    Given = sd_util:get(<<"amount">>, maps:get(input, Args), null),
    Amount = case maps:get(<<"amount">>, Opt, null) of null -> Given; A -> A end,
    case is_number(Amount) andalso Amount > 0 andalso Amount =< 100000000 of
        false -> {error, invalid, <<"amount is required (a number above 0).">>};
        true ->
            case sd_db:rate(["pay:", Me], 30, 3600) of
                limited -> {error, rate_limited, <<"Too many payments started; try later.">>};
                ok ->
                    Id = sd_db:incr("sd:seq:pay"),
                    P = #{<<"id">> => Id, <<"by">> => Me, <<"option">> => maps:get(<<"id">>, Opt),
                          <<"amount">> => Amount, <<"currency">> => maps:get(<<"currency">>, Opt, <<"INR">>),
                          <<"description">> => maps:get(<<"description">>, Opt, <<>>),
                          <<"status">> => <<"created">>, <<"reference">> => null, <<"createdTs">> => sd_util:now_ms()},
                    put_(P),
                    sd_db:zadd("sd:pays:u:" ++ sd_util:s(Me), maps:get(<<"createdTs">> , P), integer_to_binary(Id)),
                    {ok, #{<<"payment">> => P}}
            end
    end.

own(User, Id) ->
    case get(Id) of
        #{<<"by">> := By} = P ->
            case By =:= maps:get(<<"username">>, User) orelse sd_users:is_admin(User) of
                true -> {ok, P};
                false -> {error, not_found, <<"No such payment.">>}
            end;
        _ -> {error, not_found, <<"No such payment.">>}
    end.

status(User, Id) ->
    case own(User, Id) of {ok, P} -> {ok, #{<<"payment">> => P}}; E -> E end.

cancel(User, Id) ->
    case own(User, Id) of
        {ok, #{<<"status">> := S} = P} when S =:= <<"created">>; S =:= <<"submitted">> ->
            {ok, #{<<"payment">> => put_(P#{<<"status">> => <<"cancelled">>})}};
        {ok, _} -> {error, already_final, <<"That payment can't be cancelled any more.">>};
        E -> E
    end.

%% The payer gives a reference. Slow when a data source verifies it (runs in a worker, see sd_lane).
confirm(User, Id, Ref0) ->
    Ref = case Ref0 of R when is_binary(R) -> string:trim(R); _ -> <<>> end,
    case {own(User, Id), Ref} of
        {{error, _, _} = E, _} -> E;
        {_, <<>>} -> {error, invalid, <<"reference is required.">>};
        {{ok, #{<<"by">> := By}}, _} when By =/= <<>>, By =/= <<>> ->
            {ok, P} = own(User, Id),
            case maps:get(<<"status">>, P) of
                S when S =:= <<"paid">>; S =:= <<"failed">>; S =:= <<"cancelled">> ->
                    {error, already_final, <<"That payment is already settled.">>};
                _ ->
                    P1 = P#{<<"reference">> => binary:part(Ref, 0, min(100, byte_size(Ref)))},
                    Opt = sd_db:hget_json("sd:options", string:lowercase(binary_to_list(maps:get(<<"option">>, P)))),
                    Ver = case Opt of #{<<"verifyDatasource">> := V} when is_binary(V) -> V; _ -> null end,
                    case Ver of
                        null -> {ok, #{<<"payment">> => put_(P1#{<<"status">> => <<"submitted">>})}};
                        DS ->
                            Vals = maps:merge(sd_globals:values(User),
                                              #{<<"reference">> => maps:get(<<"reference">>, P1), <<"amount">> => maps:get(<<"amount">>, P),
                                                <<"paymentId">> => maps:get(<<"id">>, P)}),
                            case sd_datasource:run(DS, Vals, #{<<"limit">> => 1}) of
                                {ok, #{<<"rows">> := [_ | _]}} -> {ok, #{<<"payment">> => settle(P1, <<"paid">>)}};
                                {ok, _} -> {ok, #{<<"payment">> => put_(P1#{<<"status">> => <<"submitted">>}), <<"verified">> => false}};
                                {error, _, _} = E -> E
                            end
                    end
            end
    end.

settle(P, Status) ->
    Q = put_(P#{<<"status">> => Status, <<"settledTs">> => sd_util:now_ms()}),
    sd_notify:push_event(maps:get(<<"by">>, Q), <<"payment_updated">>,
                         #{<<"id">> => maps:get(<<"id">>, Q), <<"status">> => Status}),
    Q.

list(User, Args) ->
    Me = maps:get(<<"username">>, User),
    Ids = sd_db:zrevrange("sd:pays:u:" ++ sd_util:s(Me), 0, 49),
    All = [P || B <- Ids, P <- [sd_db:hget_json(?PAYS, binary_to_list(B))], is_map(P)],
    Filter = sd_util:get(<<"status">>, Args),
    #{<<"payments">> => [P || P <- All, Filter =:= undefined orelse maps:get(<<"status">>, P) =:= Filter]}.

%% Administrator settles a payment by hand.
mark(Id, Status, Ref) when Status =:= <<"paid">>; Status =:= <<"failed">> ->
    case get(Id) of
        undefined -> {error, not_found, <<"No such payment.">>};
        #{<<"status">> := S} when S =:= <<"paid">>; S =:= <<"failed">> ->
            {error, already_final, <<"That payment is already settled.">>};
        P ->
            P1 = case Ref of R when is_binary(R), R =/= <<>> -> P#{<<"reference">> => R}; _ -> P end,
            {ok, #{<<"payment">> => settle(P1, Status)}}
    end;
mark(_, _, _) -> {error, invalid, <<"status must be paid or failed.">>}.

%% ---- webhook ----------------------------------------------------------------------------------------------------------
webhook_enabled() -> secret() =/= undefined.

secret() ->
    case os:getenv("SANDESH_PAY_WEBHOOK_SECRET") of
        false -> undefined;
        "" -> undefined;
        S -> list_to_binary(S)
    end.

%% Given = the value of the X-Webhook-Secret header. Body: {id, status: paid|failed, reference?}
webhook(Given, Body) ->
    case secret() of
        undefined -> {error, not_found, <<"No such endpoint.">>};
        S ->
            case is_binary(Given) andalso byte_size(Given) =:= byte_size(S) andalso crypto:hash_equals(Given, S) of
                false -> {error, unauthenticated, <<"Bad webhook secret.">>};
                true -> mark(sd_util:get(<<"id">>, Body), sd_util:get(<<"status">>, Body), sd_util:get(<<"reference">>, Body))
            end
    end.
