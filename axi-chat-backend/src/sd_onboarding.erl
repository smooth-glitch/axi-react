%%% Onboarding process per user category. What happens when someone registers as, say, a Patient or a Vendor:
%%%   requireApproval   true (default) = a request goes to approvers; false = the account is active straight away
%%%   approverRoles     who approves: people holding any of these roles (else the person's host / covering hosts /
%%%                     administrators, as before)
%%%   requiredFields    details that must be filled in at registration (on top of name, email, mobile, country, pin)
%%%   welcome           a short message shown to the person when they register
%%% A category with no policy behaves exactly as before.
-module(sd_onboarding).
-export([get/1, list/0, save/1, delete/1, check_registration/1, approvers/1, public/0, fields/0]).

-compile({no_auto_import, [get/1]}).

-define(HASH, "sd:onboarding").
-define(FIELDS, [<<"address">>, <<"gender">>, <<"dob">>, <<"education">>, <<"skills">>,
                 <<"branch">>, <<"department">>]).

fields() -> ?FIELDS.

key(Cat) -> string:lowercase(string:trim(sd_util:s(Cat))).

default(Cat) ->
    #{<<"category">> => Cat, <<"requireApproval">> => true, <<"approverRoles">> => [],
      <<"requiredFields">> => [], <<"welcome">> => <<>>, <<"custom">> => false}.

get(Cat) when is_binary(Cat) ->
    case sd_db:hget_json(?HASH, key(Cat)) of
        P when is_map(P) -> maps:merge(default(Cat), P#{<<"custom">> => true});
        _ -> default(Cat)
    end;
get(_) -> default(<<>>).

list() ->
    [get(maps:get(<<"name">>, C)) || C <- sd_org:list(categories)].

save(Raw) when is_map(Raw) ->
    Cat = sd_util:get(<<"category">>, Raw),
    case is_binary(Cat) andalso sd_org:get(categories, Cat) of
        false -> {error, invalid, <<"category is required.">>};
        undefined -> {error, invalid, <<"Unknown user category.">>};
        Found ->
            Name = maps:get(<<"name">>, Found),
            Req = sd_util:get(<<"requireApproval">>, Raw, true),
            Roles = names(sd_util:get(<<"approverRoles">>, Raw, [])),
            Fields = names(sd_util:get(<<"requiredFields">>, Raw, [])),
            Welcome = case sd_util:get(<<"welcome">>, Raw, <<>>) of
                          W when is_binary(W) -> T = string:trim(W), binary:part(T, 0, min(500, byte_size(T)));
                          _ -> <<>>
                      end,
            KnownRoles = [maps:get(<<"name">>, R) || R <- sd_org:list(roles)],
            CanonRoles = [canon(R, KnownRoles) || R <- Roles],
            CanonFields = [canon(F, ?FIELDS) || F <- Fields],
            case {is_boolean(Req), lists:member(undefined, CanonRoles), lists:member(undefined, CanonFields),
                  Req =:= false andalso CanonRoles =/= []} of
                {false, _, _, _} -> {error, invalid, <<"requireApproval must be true or false.">>};
                {_, true, _, _} -> {error, invalid, <<"Unknown role in approverRoles (add it under roles first).">>};
                {_, _, true, _} -> {error, invalid,
                                    iolist_to_binary([<<"requiredFields may only be: ">>, lists:join(<<", ">>, ?FIELDS)])};
                {_, _, _, true} -> {error, invalid, <<"approverRoles makes no sense when nobody needs to approve.">>};
                _ ->
                    P = #{<<"category">> => Name, <<"requireApproval">> => Req, <<"approverRoles">> => lists:usort(CanonRoles),
                          <<"requiredFields">> => lists:usort(CanonFields), <<"welcome">> => Welcome},
                    sd_db:hset_json(?HASH, key(Name), P),
                    {ok, get(Name)}
            end
    end;
save(_) -> {error, bad_request, <<"Expected a JSON object.">>}.

delete(Cat) ->
    case sd_db:hget_json(?HASH, key(Cat)) of
        undefined -> {error, not_found, <<"That category has no custom process.">>};
        _ -> sd_db:hdel(?HASH, key(Cat)), ok
    end.

names(L) when is_list(L) -> [T || X <- L, is_binary(X), T <- [string:trim(X)], T =/= <<>>];
names(_) -> [].

canon(N, Known) ->
    case [K || K <- Known, string:lowercase(K) =:= string:lowercase(N)] of
        [K | _] -> K;
        [] -> undefined
    end.

%% ---- registration -----------------------------------------------------------------------------------------------

%% Checks a self-registration body against its category's policy.
check_registration(Body) ->
    case sd_util:get(<<"category">>, Body) of
        Cat when is_binary(Cat), Cat =/= <<>> ->
            #{<<"requiredFields">> := Req} = get(Cat),
            Missing = [F || F <- Req, empty(sd_util:get(F, Body))],
            case Missing of
                [] -> ok;
                _ -> {error, invalid, iolist_to_binary([<<"For ">>, Cat, <<" these are required: ">>,
                                                        lists:join(<<", ">>, Missing), <<".">>])}
            end;
        _ -> ok
    end.

empty(undefined) -> true;
empty(null) -> true;
empty(<<>>) -> true;
empty([]) -> true;
empty(V) when is_binary(V) -> string:trim(V) =:= <<>>;
empty(_) -> false.

%% Who is asked to approve this new (pending) user, or none when the category needs no approval.
%% -> none | {approvers, [Username]}
approvers(User) ->
    Cat = sd_util:get(<<"category">>, User),
    #{<<"requireApproval">> := NeedsApproval, <<"approverRoles">> := Roles} = get(sd_util:b(Cat)),
    Self = maps:get(<<"username">>, User),
    case NeedsApproval of
        false -> none;
        true ->
            ByRole = lists:usort([maps:get(<<"username">>, U) || R <- Roles, U <- sd_users:users_with_role(R),
                                  maps:get(<<"username">>, U) =/= Self]),
            case ByRole of
                [] -> {approvers, sd_reqs:approvers_for(User)};
                _ -> {approvers, ByRole}
            end
    end.

%% What the registration form needs to know, per category (part of the public organisation info).
public() ->
    maps:from_list([{maps:get(<<"category">>, P),
                     maps:with([<<"requireApproval">>, <<"requiredFields">>, <<"welcome">>], P)}
                    || P <- list()]).
