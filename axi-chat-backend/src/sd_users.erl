%%% Sandesh user directory: profiles, roles, hosts, status and associations.
%%%
%%% One JSON document per user in the hash `sd:users` (field = lowercased
%%% username), plus two lookup indexes (`sd:idx:email`, `sd:idx:mobile`) so a
%%% login identifier can be an email, a mobile number or a username.
%%%
%%% User record (all keys camelCase, exactly as sent to / received from the
%%% frontend):
%%%   username, name, email, mobile, role ("admin" | "user"),
%%%   isEmployee, branch, department, designation, reportingManager,
%%%   affiliate, affiliateBranch, category, country, city, pin,
%%%   isHost, hostScope, canManageUsers,
%%%   host (username of this user's host, or null),
%%%   status ("active" | "inactive" | "pending" | "rejected"),
%%%   createdBy, createdTs, updatedTs, lastLoginTs, lastOtpTs
%%%
%%% Associations (`sd:assoc:<user>`, a hash peer -> relation) record who may
%%% message whom under the spec's rule "users can message only their host"
%%% plus accepted invitations. Relations: "host" (that peer is MY host),
%%% "user" (that peer is a user I host), "peer" (accepted invitation).
-module(sd_users).
-export([get/1, find/1, list/0, exists/1, create/2, create_dry/1, update/3, set_status/2,
         set_host/2, mark_login/1, mark_otp/1, replace/1,
         public/1, full/1, is_admin/1, is_host/1, is_active/1, effective_category/1,
         admins/0, users_of_host/1, hosts_covering/1, host_covers/2, count_using/2,
         search/2, unique_username/1, valid_host_scope/1,
         assoc_list/1, assoc_add/3, assoc_remove/2, associated/2, assoc_relation/2]).

-compile({no_auto_import, [get/1]}).

-define(USERS, "sd:users").
-define(IDX_EMAIL, "sd:idx:email").
-define(IDX_MOBILE, "sd:idx:mobile").

%% ---- lookup -------------------------------------------------------------------------

get(Username) ->
    sd_db:hget_json(?USERS, sd_util:norm_user(Username)).

exists(Username) -> get(Username) =/= undefined.

%% Identifier may be a username, an email address or a mobile number.
find(Identifier) ->
    Id = string:trim(sd_util:b(Identifier)),
    case binary:match(Id, <<"@">>) of
        nomatch ->
            case get(Id) of
                undefined -> by_mobile(Id);
                User -> User
            end;
        _ ->
            case sd_db:hget(?IDX_EMAIL, sd_util:norm_email(Id)) of
                undefined -> undefined;
                U -> get(U)
            end
    end.

by_mobile(Id) ->
    case sd_util:mobile_digits(Id) of
        <<>> -> undefined;
        Digits ->
            case byte_size(Digits) >= 7 andalso sd_db:hget(?IDX_MOBILE, Digits) of
                false -> undefined;
                undefined -> undefined;
                U -> get(U)
            end
    end.

list() ->
    lists:sort(fun(A, B) -> maps:get(<<"username">>, A) =< maps:get(<<"username">>, B) end,
               [U || {_K, U} <- sd_db:hgetall_json(?USERS), is_map(U)]).

admins() -> [U || U <- list(), is_admin(U), is_active(U)].

is_admin(#{<<"role">> := <<"admin">>}) -> true;
is_admin(_) -> false.

is_host(U) -> maps:get(<<"isHost">>, U, false) =:= true.

is_active(#{<<"status">> := <<"active">>}) -> true;
is_active(_) -> false.

%% What option-applicability rules see (see sd_config): employees and
%% affiliate members are pseudo-categories; everyone else uses their category.
effective_category(U) ->
    case maps:get(<<"isEmployee">>, U, false) of
        true -> <<"Employee">>;
        _ ->
            case sd_util:get(<<"affiliate">>, U) of
                undefined -> sd_util:get(<<"category">>, U, <<>>);
                null -> sd_util:get(<<"category">>, U, <<>>);
                _ -> <<"Affiliate">>
            end
    end.

%% ---- views ------------------------------------------------------------------------------

%% Minimal profile another user may see (contact lists, invite search).
public(U) ->
    sd_util:take([<<"username">>, <<"name">>, <<"designation">>, <<"department">>,
                  <<"branch">>, <<"affiliate">>, <<"category">>, <<"isEmployee">>,
                  <<"isHost">>, <<"status">>], U).

%% Everything an admin (or the user themselves) may see -- never credentials,
%% which live in a separate hash and are never part of this record.
full(U) -> U.

%% ---- create / update -----------------------------------------------------------------------

%% Opts: mode => invite | register | setup, actor => binary(),
%%       role => <<"admin">> | <<"user">>, host => binary() | undefined,
%%       status => <<"active">> | <<"pending">>, username => binary() (optional)
create(Attrs, Opts) when is_map(Attrs) ->
    Mode = maps:get(mode, Opts, invite),
    case validate_profile(Attrs, Mode, undefined) of
        {ok, Profile} ->
            Email = maps:get(<<"email">>, Profile),
            Mobile = maps:get(<<"mobile">>, Profile),
            case check_scope(Opts, Profile) of
                ok -> create_checked(Attrs, Opts, Profile, Email, Mobile);
                Err -> Err
            end;
        Err -> Err
    end.

%% A host inviting someone may only invite people their scope covers
%% (Opts carries scope_host => the host's record); admins skip this.
check_scope(Opts, Profile) ->
    case maps:get(scope_host, Opts, undefined) of
        undefined -> ok;
        Host ->
            case host_covers(Host, Profile) of
                true -> ok;
                false -> {error, forbidden, <<"That person is outside the users you can host.">>}
            end
    end.

create_checked(Attrs, Opts, Profile, Email, Mobile) ->
    case check_unique(Email, Mobile, undefined) of
        ok ->
            case pick_username(Attrs, Email) of
                {ok, Username} ->
                    Now = sd_util:now_ms(),
                    Host = maps:get(host, Opts, undefined),
                    User = Profile#{
                        <<"username">> => Username,
                        <<"role">> => maps:get(role, Opts, <<"user">>),
                        <<"host">> => case Host of undefined -> null; H -> H end,
                        <<"status">> => maps:get(status, Opts, <<"active">>),
                        <<"createdBy">> => maps:get(actor, Opts, Username),
                        <<"createdTs">> => Now,
                        <<"updatedTs">> => Now,
                        <<"lastLoginTs">> => null,
                        <<"lastOtpTs">> => null},
                    store_new(User),
                    case Host of
                        undefined -> ok;
                        _ -> assoc_add(Username, Host, host)
                    end,
                    {ok, User};
                Err -> Err
            end;
        Err -> Err
    end.

%% First-run setup: validates the would-be administrator (and picks a free
%% username) without storing anything, so the OTP step can be sent to a
%% profile we already know is acceptable.
create_dry(Attrs) when is_map(Attrs) ->
    case validate_profile(Attrs, setup, undefined) of
        {ok, Profile} ->
            case check_unique(maps:get(<<"email">>, Profile), maps:get(<<"mobile">>, Profile), undefined) of
                ok ->
                    case pick_username(Attrs, maps:get(<<"email">>, Profile)) of
                        {ok, Username} -> {ok, Profile#{<<"username">> => Username}};
                        Err -> Err
                    end;
                Err -> Err
            end;
        Err -> Err
    end.

%% Attrs may contain any editable profile field; the merged profile is
%% re-validated as a whole so an update can never leave a record invalid.
update(Username, Attrs, _Actor) when is_map(Attrs) ->
    case get(Username) of
        undefined -> {error, not_found, <<"No such user.">>};
        Old ->
            Editable = [<<"name">>, <<"email">>, <<"mobile">>, <<"isEmployee">>, <<"branch">>,
                        <<"department">>, <<"designation">>, <<"reportingManager">>,
                        <<"affiliate">>, <<"affiliateBranch">>, <<"category">>, <<"country">>,
                        <<"city">>, <<"pin">>, <<"isHost">>, <<"hostScope">>, <<"canManageUsers">>],
            Merged = maps:merge(Old, maps:with(Editable, Attrs)),
            case validate_profile(Merged, update, Old) of
                {ok, Profile} ->
                    Email = maps:get(<<"email">>, Profile),
                    Mobile = maps:get(<<"mobile">>, Profile),
                    case check_unique(Email, Mobile, maps:get(<<"username">>, Old)) of
                        ok ->
                            New = maps:merge(Old, Profile#{<<"updatedTs">> => sd_util:now_ms()}),
                            reindex(Old, New),
                            put_user(New),
                            {ok, New};
                        Err -> Err
                    end;
                Err -> Err
            end
    end.

set_status(Username, Status) ->
    case get(Username) of
        undefined -> {error, not_found, <<"No such user.">>};
        U ->
            New = U#{<<"status">> => Status, <<"updatedTs">> => sd_util:now_ms()},
            put_user(New),
            {ok, New}
    end.

set_host(Username, HostOrNull) ->
    case get(Username) of
        undefined -> {error, not_found, <<"No such user.">>};
        U ->
            Old = sd_util:get(<<"host">>, U),
            New = U#{<<"host">> => HostOrNull, <<"updatedTs">> => sd_util:now_ms()},
            put_user(New),
            %% The old host link goes; a peer link (accepted invitation) is kept.
            case is_binary(Old) andalso assoc_relation(Username, Old) =:= <<"host">> of
                true -> assoc_remove(Username, Old);
                false -> ok
            end,
            case is_binary(HostOrNull) of
                true -> assoc_add(Username, HostOrNull, host);
                false -> ok
            end,
            {ok, New}
    end.

mark_login(Username) -> touch(Username, <<"lastLoginTs">>).
mark_otp(Username) -> touch(Username, <<"lastOtpTs">>).

touch(Username, Field) ->
    case get(Username) of
        undefined -> ok;
        U -> put_user(U#{Field => sd_util:now_ms()})
    end.

%% Overwrite a whole record (caller has already validated it).
replace(User) -> put_user(User).

put_user(U) ->
    sd_db:hset_json(?USERS, sd_util:norm_user(maps:get(<<"username">>, U)), U).

store_new(U) ->
    put_user(U),
    Username = maps:get(<<"username">>, U),
    sd_db:hset(?IDX_EMAIL, maps:get(<<"email">>, U), Username),
    case maps:get(<<"mobile">>, U) of
        <<>> -> ok;
        M -> sd_db:hset(?IDX_MOBILE, sd_util:mobile_digits(M), Username)
    end.

reindex(Old, New) ->
    Username = maps:get(<<"username">>, New),
    OldE = maps:get(<<"email">>, Old), NewE = maps:get(<<"email">>, New),
    case OldE =:= NewE of
        true -> ok;
        false -> sd_db:hdel(?IDX_EMAIL, OldE), sd_db:hset(?IDX_EMAIL, NewE, Username)
    end,
    OldM = mobile_key(Old), NewM = mobile_key(New),
    case OldM =:= NewM of
        true -> ok;
        false ->
            OldM =/= <<>> andalso sd_db:hdel(?IDX_MOBILE, OldM),
            NewM =/= <<>> andalso sd_db:hset(?IDX_MOBILE, NewM, Username),
            ok
    end.

mobile_key(U) -> sd_util:mobile_digits(maps:get(<<"mobile">>, U, <<>>)).

%% Email/mobile must belong to at most one user. A previously *rejected*
%% self-registration doesn't block the same person registering again.
check_unique(Email, Mobile, Self) ->
    case owner(?IDX_EMAIL, Email) of
        {taken, Other} when Other =/= Self -> {error, email_taken, <<"That email is already registered.">>};
        _ ->
            case Mobile of
                <<>> -> ok;
                _ ->
                    case owner(?IDX_MOBILE, sd_util:mobile_digits(Mobile)) of
                        {taken, Other2} when Other2 =/= Self ->
                            {error, mobile_taken, <<"That mobile number is already registered.">>};
                        _ -> ok
                    end
            end
    end.

owner(Index, Key) ->
    case sd_db:hget(Index, Key) of
        undefined -> free;
        Username ->
            case get(Username) of
                #{<<"status">> := <<"rejected">>} ->
                    %% Free the identifiers of a rejected registration.
                    sd_db:hdel(Index, Key),
                    free;
                undefined -> free;
                _ -> {taken, Username}
            end
    end.

%% ---- usernames -------------------------------------------------------------------------------

pick_username(Attrs, Email) ->
    case sd_util:get(<<"username">>, Attrs) of
        undefined -> {ok, unique_username(Email)};
        null -> {ok, unique_username(Email)};
        Wanted when is_binary(Wanted) ->
            U = sd_util:norm_user(Wanted),
            case sd_util:valid_username(U) of
                false -> {error, invalid, <<"username must be 2-24 chars: a-z 0-9 . _ -">>};
                true ->
                    case exists(U) of
                        true -> {error, username_taken, <<"That username is taken.">>};
                        false -> {ok, U}
                    end
            end;
        _ -> {error, invalid, <<"username must be text.">>}
    end.

%% Derives a free username from an email's local part (or a plain name).
unique_username(Source) ->
    [Local | _] = binary:split(sd_util:b(Source), <<"@">>),
    Clean0 = << <<(clean_char(C))>> || <<C>> <= string:lowercase(Local),
                                       C < 128 >>,
    Clean1 = string:slice(Clean0, 0, 20),
    Base = case sd_util:valid_username(Clean1) of
               true -> Clean1;
               false -> <<"user">>
           end,
    free_username(Base, 0).

free_username(Base, 0) ->
    case exists(Base) of
        false -> Base;
        true -> free_username(Base, 1)
    end;
free_username(Base, N) ->
    Candidate = <<Base/binary, (sd_util:rand_digits(3))/binary>>,
    case exists(Candidate) of
        false -> Candidate;
        true when N < 20 -> free_username(Base, N + 1);
        true -> <<Base/binary, (sd_util:rand_digits(6))/binary>>
    end.

clean_char(C) when (C >= $a andalso C =< $z); (C >= $0 andalso C =< $9); C =:= $.; C =:= $_; C =:= $- -> C;
clean_char(_) -> $..

%% ---- validation of the profile fields ---------------------------------------------------------------

validate_profile(A, Mode, _Existing) ->
    Name = str(A, <<"name">>),
    Email = sd_util:norm_email(str(A, <<"email">>)),
    Mobile = case str(A, <<"mobile">>) of <<>> -> <<>>; M -> sd_util:norm_mobile(M) end,
    IsEmp = sd_util:is_true(sd_util:get(<<"isEmployee">>, A, false)),
    Aff = opt_name(A, <<"affiliate">>),
    run([
        fun() -> check(Name =/= <<>>, invalid, <<"name is required.">>) end,
        fun() -> check(byte_size(Name) =< 80, invalid, <<"name is too long.">>) end,
        fun() -> check(sd_util:valid_email(Email), invalid_email, <<"A valid email is required.">>) end,
        fun() -> check(Mobile =:= <<>> orelse sd_util:valid_mobile(Mobile), invalid_mobile,
                       <<"mobile must be 7-15 digits, optionally starting with +.">>) end,
        fun() -> check(Mode =/= setup orelse Mobile =/= <<>>, invalid_mobile,
                       <<"mobile is required.">>) end,
        fun() -> check(not (IsEmp andalso Aff =/= undefined), invalid,
                       <<"A user can't be both an employee and part of an affiliate.">>) end
    ], fun() ->
        Base = #{<<"name">> => Name, <<"email">> => Email, <<"mobile">> => Mobile,
                 <<"isEmployee">> => IsEmp},
        case Mode of
            setup -> {ok, setup_fields(Base)};
            _ ->
                case IsEmp of
                    true -> employee_fields(A, Base);
                    false ->
                        case Aff of
                            undefined -> external_fields(A, Base);
                            AffName -> affiliate_fields(A, Base, AffName)
                        end
                end
        end
    end).

%% The first administrator exists before any branch/department/designation
%% has been configured (those are set up *by* this user), so none of the
%% employee reference fields can be required for them.
setup_fields(Base) ->
    Base#{<<"isEmployee">> => true, <<"branch">> => null, <<"department">> => null,
          <<"designation">> => null, <<"reportingManager">> => null, <<"affiliate">> => null,
          <<"affiliateBranch">> => null, <<"category">> => null, <<"country">> => null,
          <<"city">> => null, <<"pin">> => null, <<"isHost">> => false, <<"hostScope">> => null,
          <<"canManageUsers">> => true}.

employee_fields(A, Base) ->
    Ref = fun(Kind, Key) -> ref_field(A, Kind, Key) end,
    case chain([fun() -> Ref(branches, <<"branch">>) end,
                fun() -> Ref(departments, <<"department">>) end,
                fun() -> Ref(designations, <<"designation">>) end,
                fun() -> manager(A) end,
                fun() -> host_fields(A) end],
               fun([Br, De, Ds, Mgr, {IsHost, Scope}]) ->
                   Base#{<<"branch">> => Br, <<"department">> => De, <<"designation">> => Ds,
                         <<"reportingManager">> => Mgr, <<"isHost">> => IsHost,
                         <<"hostScope">> => Scope, <<"affiliate">> => null,
                         <<"affiliateBranch">> => null, <<"category">> => null,
                         <<"country">> => opt(A, <<"country">>), <<"city">> => opt(A, <<"city">>),
                         <<"pin">> => opt(A, <<"pin">>),
                         <<"canManageUsers">> => sd_util:is_true(sd_util:get(<<"canManageUsers">>, A, false))}
               end) of
        {ok, U} -> {ok, U};
        Err -> Err
    end.

affiliate_fields(A, Base, AffName) ->
    case sd_org:get(affiliates, AffName) of
        undefined ->
            {error, invalid, <<"Unknown affiliate organisation.">>};
        Aff ->
            BranchName = opt_name(A, <<"affiliateBranch">>),
            KnownBranches = [maps:get(<<"name">>, B) || B <- maps:get(<<"branches">>, Aff, [])],
            case BranchName =:= undefined orelse
                 lists:member(string:lowercase(BranchName), [string:lowercase(K) || K <- KnownBranches]) of
                false ->
                    {error, invalid, <<"That branch doesn't belong to the chosen affiliate.">>};
                true ->
                    {ok, no_host(Base#{<<"affiliate">> => maps:get(<<"name">>, Aff),
                                        <<"affiliateBranch">> => case BranchName of
                                                                    undefined -> null;
                                                                    Bn -> canonical(KnownBranches, Bn)
                                                                end,
                                        <<"category">> => maps:get(<<"category">>, Aff, null),
                                        <<"country">> => opt(A, <<"country">>),
                                        <<"city">> => opt(A, <<"city">>),
                                        <<"pin">> => opt(A, <<"pin">>),
                                        <<"canManageUsers">> =>
                                            sd_util:is_true(sd_util:get(<<"canManageUsers">>, A, false))})}
            end
    end.

%% Individual external user: category + location are required by the spec.
external_fields(A, Base) ->
    case chain([fun() -> ref_field(A, categories, <<"category">>) end,
                fun() -> req(A, <<"country">>) end,
                fun() -> req(A, <<"city">>) end,
                fun() -> req(A, <<"pin">>) end],
               fun([Cat, Co, Ci, P]) ->
                   no_host(Base#{<<"category">> => Cat, <<"country">> => Co, <<"city">> => Ci,
                                 <<"pin">> => P, <<"affiliate">> => null,
                                 <<"affiliateBranch">> => null,
                                 <<"canManageUsers">> =>
                                     sd_util:is_true(sd_util:get(<<"canManageUsers">>, A, false))})
               end) of
        {ok, U} -> {ok, U};
        Err -> Err
    end.

%% Non-employees can't be hosts; keep the employee-only fields explicit.
no_host(U) ->
    U#{<<"branch">> => null, <<"department">> => null, <<"designation">> => null,
       <<"reportingManager">> => null, <<"isHost">> => false, <<"hostScope">> => null}.

canonical(Known, Given) ->
    case [K || K <- Known, string:lowercase(K) =:= string:lowercase(Given)] of
        [K | _] -> K;
        [] -> Given
    end.

%% A reference into one of the master lists (branch, department, ...),
%% normalised to the list's own spelling so casing can't drift.
ref_field(A, Kind, Key) ->
    case opt_name(A, Key) of
        undefined -> {error, invalid, <<Key/binary, " is required.">>};
        V ->
            case sd_org:get(Kind, V) of
                undefined -> {error, invalid, <<Key/binary, " isn't in the organisation's list.">>};
                Item ->
                    case maps:get(<<"active">>, Item, true) of
                        false -> {error, invalid, <<Key/binary, " is deactivated.">>};
                        _ -> {ok, maps:get(<<"name">>, Item)}
                    end
            end
    end.

manager(A) ->
    case opt_name(A, <<"reportingManager">>) of
        undefined -> {ok, null};
        M ->
            case get(M) of
                #{<<"isEmployee">> := true, <<"username">> := U} -> {ok, U};
                _ -> {error, invalid, <<"reportingManager must be an existing employee.">>}
            end
    end.

host_fields(A) ->
    case sd_util:is_true(sd_util:get(<<"isHost">>, A, false)) of
        false -> {ok, {false, null}};
        true ->
            case valid_host_scope(sd_util:get(<<"hostScope">>, A)) of
                {ok, Scope} -> {ok, {true, Scope}};
                Err -> Err
            end
    end.

%% "If yes, this user can be the host for: Employees (any / selected branch /
%% department / designations), Affiliates (any / selected), Users from
%% selected user categories." Matching is OR across whatever is selected.
valid_host_scope(undefined) -> {error, invalid, <<"hostScope is required for a host.">>};
valid_host_scope(null) -> {error, invalid, <<"hostScope is required for a host.">>};
valid_host_scope(S) when is_map(S) ->
    Emp = sd_util:get(<<"employees">>, S, #{}),
    AffS = sd_util:get(<<"affiliates">>, S, #{}),
    case is_map(Emp) andalso is_map(AffS) of
        false -> {error, invalid, <<"hostScope.employees / .affiliates must be objects.">>};
        true ->
            chain([fun() -> names(Emp, <<"branches">>, branches) end,
                   fun() -> names(Emp, <<"departments">>, departments) end,
                   fun() -> names(Emp, <<"designations">>, designations) end,
                   fun() -> names(AffS, <<"selected">>, affiliates) end,
                   fun() -> names(S, <<"categories">>, categories) end],
                  fun([Br, De, Ds, Sel, Cats]) ->
                      #{<<"employees">> => #{<<"any">> => sd_util:is_true(sd_util:get(<<"any">>, Emp, false)),
                                              <<"branches">> => Br, <<"departments">> => De,
                                              <<"designations">> => Ds},
                        <<"affiliates">> => #{<<"any">> => sd_util:is_true(sd_util:get(<<"any">>, AffS, false)),
                                               <<"selected">> => Sel},
                        <<"categories">> => Cats}
                  end)
    end;
valid_host_scope(_) -> {error, invalid, <<"hostScope must be an object.">>}.

%% A list of names that must each exist in the given master list.
names(Map, Key, Kind) ->
    case sd_util:get(Key, Map, []) of
        L when is_list(L) ->
            Resolved = [{V, case is_binary(V) of true -> sd_org:get(Kind, V); false -> undefined end} || V <- L],
            case [V || {V, undefined} <- Resolved] of
                [] -> {ok, [maps:get(<<"name">>, I) || {_, I} <- Resolved]};
                [Bad | _] -> {error, invalid, iolist_to_binary(io_lib:format("~s: unknown value ~s", [Key, printable(Bad)]))}
            end;
        _ -> {error, invalid, <<Key/binary, " must be a list.">>}
    end.

printable(B) when is_binary(B) -> B;
printable(Other) -> io_lib:format("~p", [Other]).

%% ---- tiny validation plumbing -------------------------------------------------------------------------

str(Map, Key) ->
    case sd_util:get(Key, Map) of
        V when is_binary(V) -> string:trim(V);
        _ -> <<>>
    end.

opt(Map, Key) ->
    case str(Map, Key) of
        <<>> -> null;
        V -> V
    end.

req(Map, Key) ->
    case str(Map, Key) of
        <<>> -> {error, invalid, <<Key/binary, " is required.">>};
        V -> {ok, V}
    end.

opt_name(Map, Key) ->
    case str(Map, Key) of
        <<>> -> undefined;
        V -> V
    end.

check(true, _, _) -> ok;
check(false, Code, Msg) -> {error, Code, Msg}.

run([], Ok) -> Ok();
run([F | Rest], Ok) ->
    case F() of
        ok -> run(Rest, Ok);
        {error, _, _} = Err -> Err
    end.

chain(Checks, Build) -> chain(Checks, Build, []).
chain([], Build, Acc) -> {ok, Build(lists:reverse(Acc))};
chain([C | Rest], Build, Acc) ->
    case C() of
        {ok, V} -> chain(Rest, Build, [V | Acc]);
        {error, _, _} = Err -> Err
    end.

%% ---- hosts ---------------------------------------------------------------------------------------------------

users_of_host(Host) ->
    H = sd_util:norm_user(Host),
    [U || U <- list(), sd_util:get(<<"host">>, U) =:= H].

%% Does this host's scope cover that user?
host_covers(Host, User) ->
    case maps:get(<<"hostScope">>, Host, null) of
        Scope when is_map(Scope) -> covers(Scope, User);
        _ -> false
    end.

covers(Scope, User) ->
    Emp = maps:get(<<"employees">>, Scope, #{}),
    Aff = maps:get(<<"affiliates">>, Scope, #{}),
    Cats = maps:get(<<"categories">>, Scope, []),
    In = fun(V, L) -> V =/= undefined andalso V =/= null andalso
                       lists:member(string:lowercase(V), [string:lowercase(X) || X <- L]) end,
    case maps:get(<<"isEmployee">>, User, false) of
        true ->
            maps:get(<<"any">>, Emp, false) =:= true orelse
            In(sd_util:get(<<"branch">>, User), maps:get(<<"branches">>, Emp, [])) orelse
            In(sd_util:get(<<"department">>, User), maps:get(<<"departments">>, Emp, [])) orelse
            In(sd_util:get(<<"designation">>, User), maps:get(<<"designations">>, Emp, []));
        false ->
            AffName = sd_util:get(<<"affiliate">>, User),
            (AffName =/= undefined andalso AffName =/= null andalso
                (maps:get(<<"any">>, Aff, false) =:= true orelse
                 In(AffName, maps:get(<<"selected">>, Aff, [])))) orelse
            In(sd_util:get(<<"category">>, User), Cats)
    end.

%% Active hosts whose scope covers User -- who an onboarding request is sent to.
hosts_covering(User) ->
    [H || H <- list(), is_active(H), is_host(H), host_covers(H, User),
          maps:get(<<"username">>, H) =/= maps:get(<<"username">>, User, <<>>)].

count_using(Kind, Name) ->
    Field = case Kind of
                branches -> <<"branch">>;
                departments -> <<"department">>;
                designations -> <<"designation">>;
                categories -> <<"category">>;
                affiliates -> <<"affiliate">>
            end,
    Lower = string:lowercase(Name),
    length([U || U <- list(),
                 case sd_util:get(Field, U) of
                     V when is_binary(V) -> string:lowercase(V) =:= Lower;
                     _ -> false
                 end]).

%% Case-insensitive substring match on name/username among active users.
search(Query, Limit) ->
    Q = string:lowercase(string:trim(sd_util:b(Query))),
    Hits = [U || U <- list(), is_active(U),
                 Q =:= <<>> orelse
                 binary:match(string:lowercase(maps:get(<<"name">>, U)), Q) =/= nomatch orelse
                 binary:match(maps:get(<<"username">>, U), Q) =/= nomatch],
    lists:sublist(Hits, Limit).

%% ---- associations -------------------------------------------------------------------------------------------

assoc_key(User) -> "sd:assoc:" ++ sd_util:s(sd_util:norm_user(User)).

%% [{PeerUsername, Relation}] -- Relation from User's point of view.
assoc_list(User) ->
    sd_db:hgetall(assoc_key(User)).

assoc_relation(User, Peer) ->
    sd_db:hget(assoc_key(User), sd_util:norm_user(Peer)).

associated(A, B) ->
    assoc_relation(A, B) =/= undefined.

%% Relation is what B is *to A*: host | user | peer. The reverse side is
%% written too, so lookups never need to check both directions.
assoc_add(A, B, Relation) ->
    An = sd_util:norm_user(A), Bn = sd_util:norm_user(B),
    sd_db:hset(assoc_key(An), Bn, atom_to_binary(Relation, utf8)),
    sd_db:hset(assoc_key(Bn), An, atom_to_binary(inverse(Relation), utf8)),
    ok.

assoc_remove(A, B) ->
    An = sd_util:norm_user(A), Bn = sd_util:norm_user(B),
    sd_db:hdel(assoc_key(An), Bn),
    sd_db:hdel(assoc_key(Bn), An),
    ok.

inverse(host) -> user;
inverse(user) -> host;
inverse(peer) -> peer.
