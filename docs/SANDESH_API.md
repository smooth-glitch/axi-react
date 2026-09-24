# Sandesh API — what the frontend builds against

Everything from the Sandesh spec that isn't plain chat: organisation setup,
users, hosts, approvals, host-only messaging, groups, message cards, forms
("lite tstructs"), options and the admin console. Plain chat itself
(`/msg`, `/groupmsg`, history, reactions…) is unchanged and documented in
[`CHAT_PROTOCOL.md`](CHAT_PROTOCOL.md).

Source of truth is the code in `axi-chat-backend/src/sd_*.erl`. Every
behaviour described here is exercised by the tests in `axi-chat-backend/test/`
(`sandesh_test.mjs` 198 checks, `sandesh_session_test.mjs` 13, and
`integration_test.mjs` 44 for plain chat) — if this doc and the code
disagree, the test is right; tell the backend owner. Backend internals, env vars and debugging live in
[`axi-chat-backend/docs/SANDESH.md`](../axi-chat-backend/docs/SANDESH.md).

---

## 1. Two modes — read this first

The backend runs in one of two modes (`SANDESH_MODE`), and **the default is
`open`**.

| | `open` (default) | `strict` |
|---|---|---|
| Plain chat with any username + any token | ✅ works exactly as before | ❌ handshake refused |
| `/sd …` commands | only with a real Sandesh session | only with a real Sandesh session |
| DMs | anyone ↔ anyone | **only your host and people you've connected with** |
| Global room (plain text) | anyone | administrators only |
| Groups | anyone creates / adds | only hosts create; adding someone else's user needs *their host's* approval |
| Admin console | admin session | admin session **+ password & OTP unlock** |

**Build and demo against `open`.** Nothing you already built breaks: a fake
token still connects and chats. Sandesh features light up when you sign in
through `/api/sd/login` and pass the returned token on the WebSocket.
`strict` is what the finished product runs; switch to it to test the real
rules. `/sd me` (or `GET /api/sd/public`) tells you which mode you're on.

---

## 2. The integration in three steps

```
1. REST   POST /api/sd/login  {identifier, otp | password}   →  { token, user, … }
2. WS     connect, first frame: {"username": <user.username>, "token": <token>}
3. WS     send  /sd <action> {json}   ←→   {"type":"sd", "ok":…, "data"|"error":…}
          listen for  {"type":"sd_event", "event":…}  pushes
```

`username` in the handshake must equal `user.username` from step 1
(usernames are lowercase; the backend rejects a token used under a different
name).

**There is no ARM sign-in in this flow.** The app signs in with its own
Sandesh login (step 1) and the token from it *is* the identity.
`armSessionId` used to be a required handshake field; it is now **optional**
(defaults to `"app"`, not interpreted), so drop the ARM sign-in page and stop
sending it. A client that still sends the ARM values keeps working.

### The two-week login (sessions)

A session lasts **exactly 14 days and is not extended by activity** — after
that the person must sign in again. What the frontend sees:

| Where | Signal | What to do |
|---|---|---|
| sign-in reply, `GET /api/sd/session`, `/sd me` | `expiresTs` / `sessionExpiresTs` (epoch ms) | optionally show "sign in again by …" |
| REST, after it ends | `401 unauthenticated` | show the sign-in screen |
| an **open** WebSocket, when it ends | `{"type":"sd_event","event":"session_expired","reason":"two_week_login"}`, then the server closes the socket | show the sign-in screen (don't auto-reconnect with the old token) |
| `/sd …` in the short gap before that | `error.code:"session_expired"`; `/sd me` → `authenticated:false, sessionExpired:true` | same |

A connection re-checks its session at most every 30 s (on its next command),
so it can take up to about 30 s after the end time for the socket to close.
Separately, a **password** login needs a fresh one-time code if the last code
is older than 14 days (`otp_required`), and an admin's password must be
changed every 30 days. `GET /api/sd/session` (with the token) restores the
user after a page reload; a 401 means sign in again.

### Local dev

```powershell
# Redis running, then, in axi-chat-backend:
$env:SANDESH_DEV_OTP = "1"      # API echoes OTP codes as `devOtp` — no SMS needed
.\run.ps1                       # ws://localhost:8080 , open mode
```

With `SANDESH_DEV_OTP=1` every "send an OTP" response contains `devOtp`, so
you can build the whole login UI without an SMS/email provider. (Never set
that on a shared server.) With `SANDESH_OTP_MODE=fixed` the code is always
`123456`, matching the demo text on the current login screen.

### A reply-matching helper (copy this)

```js
let seq = 0; const waiting = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.type === "sd" && waiting.has(m.reqId)) {           // a reply to something we sent
    const { resolve, reject } = waiting.get(m.reqId); waiting.delete(m.reqId);
    m.ok ? resolve(m.data) : reject(Object.assign(new Error(m.error.message), m.error));
  } else if (m.type === "sd_event") {                                // a live push
    if (m.event === "session_expired") showSignIn();                 // the 14 days are up
    else handleEvent(m.event, m.data);
  }
  /* …existing chat events… */
});
export const sd = (action, args = {}) => new Promise((resolve, reject) => {
  const reqId = ++seq; waiting.set(reqId, { resolve, reject });
  ws.send(`/sd ${action} ${JSON.stringify({ ...args, reqId })}`);
});
// await sd("assoc.invite", { to: "bob" })   → data, or throws {code, message, details}
```

`reqId` (any JSON value) is echoed back untouched. **Every** `/sd` command
gets a reply with its `reqId` — including when the server is rate limiting
you (`code: "rate_limited"`) — so a pending promise can never hang.

---

## 3. REST API (before the WebSocket exists)

Base: the backend origin (`http://localhost:8080` in dev; `/api/sd/...` behind
nginx on the VM). JSON in, JSON out. CORS is on (`SANDESH_CORS_ORIGIN`,
default `*`).

Success: `200 {"ok":true,"data":{…}}`
Failure: `4xx {"ok":false,"error":{"code":"…","message":"…","details":{…}}}`
(same `error` object as the WebSocket replies — see §6 for codes).

| Endpoint | Body | Returns |
|---|---|---|
| `GET /api/sd/public` | — | `{org, setupDone, categories[], branches[], departments[], designations[], affiliates[{name,category,branches[]}]}` — names for the **registration form**, no login needed. `setupDone:false` ⇒ show the first-time setup screen. |
| `POST /api/sd/setup/start` | `{org, name, username?, email, mobile, setupToken?}` | `{sent, expiresInSec, username, devOtp?}` — validates and sends an OTP. Only works before the org exists. |
| `POST /api/sd/setup/verify` | `{otp}` | a **session** (below) for the new first administrator. `mustChangePassword` is `true`. |
| `POST /api/sd/register` | self-registration fields (§5) | `{registered, status:"pending", username, requestId, awaitingApprovalFrom}` |
| `POST /api/sd/otp/send` | `{identifier}` | `{sent:true, expiresInSec, devOtp?}` or `{sent:false, retryAfter}`. `identifier` = username, email or mobile. Unknown identifiers also get `sent:true` (no account enumeration). |
| `POST /api/sd/login` | `{identifier, otp}` **or** `{identifier, password}` **or** both | a **session** |
| `GET /api/sd/session` | header `Authorization: Bearer <token>` | `{user, sessionExpiresTs, password:{hasPassword,expired,mustChange}, otpDue, mode}` — `401` once the 14-day session has ended |
| `POST /api/sd/logout` | Bearer | `{loggedOut:true}` |
| `POST /api/sd/password/change` | Bearer; `{oldPassword?, newPassword}` | `{changed:true}` (`oldPassword` not needed if the user has no password yet) |
| `POST /api/sd/admin/unlock/start` | Bearer | `{sent, …}` — OTP for the admin console |
| `POST /api/sd/admin/unlock` | Bearer; `{password, otp}` | `{unlockedForSec}` (strict mode only needs this) |

**Session** = `{token, expiresTs, user, mustChangePassword, otpDue}` (setup
also adds `org`). `otpDue` means the 14-day OTP re-check is due — a
password-only login then fails with `otp_required` (an OTP has just been
sent; retry with `{identifier, password, otp}`).

### Login rules (from the spec)

- **Sign in with** email, mobile number or username. Mobiles match however
  they're formatted (`+91 98860 12345` = `919886012345`).
- **First login = OTP.** Invited users have no password: they sign in with
  `{identifier, otp}`. After that they may set one (`password/change`).
- **OTP again every 14 days**, even with a password.
- **Admin:** default password is `"Sandesh" + username`. It must be changed at
  first login (`mustChangePassword`), and again **every 30 days**
  (`/sd me → password.expired`). New passwords: ≥ 8 chars, letters + a digit,
  not the default.
- **Admin console** = password **and** OTP (`admin/unlock`), in strict mode.
- **Abuse limits:** OTP valid 5 min, 5 tries per code; resend cooldown 30 s;
  5 failed logins locks the account for 15 min (`locked`, HTTP 429); per-IP
  limits on OTP/login/register/setup.

### First-time setup (spec: "First login")

```
GET  /api/sd/public                → setupDone:false → show "Set up your organisation"
POST /api/sd/setup/start  {org,name,username?,email,mobile}   → OTP sent
POST /api/sd/setup/verify {otp}   → session; user.role === "admin"; mustChangePassword === true
POST /api/sd/password/change      → then continue
```

If the deployment sets `SANDESH_SETUP_TOKEN`, `setup/start` must include the
same value as `setupToken` (stops a stranger claiming the first-run slot on a
reachable server). Setup can only ever run once.

---

## 4. WebSocket: the `/sd` command

```
/sd <action> {"arg":"…","reqId":1}
```

Reply (always, exactly one):

```json
{"type":"sd","action":"assoc.invite","reqId":1,"ok":true,"data":{…}}
{"type":"sd","action":"assoc.invite","reqId":1,"ok":false,
 "error":{"code":"not_found","message":"No such user.","details":{…}}}
```

- Branch on `error.code`; show `error.message` to people. `details` is only
  present for `invalid_values` (per-field messages).
- A bare `/sd` is shorthand for `/sd me`.
- `/sd` arguments may be large (form definitions); they aren't capped at the
  2000-char chat-message limit (the 64 KB WebSocket frame limit applies).
- The per-connection limit is 30 commands / 10 s (`CHAT_RATE_LIMIT_MAX` can
  raise it on a deployment). Load lists in parallel sparingly, or batch by
  screen.

### Who may call what

`none` = anyone connected · `user` = signed in · `host` = a host or admin ·
`manage` = admin or a user with `canManageUsers` · `admin` = administrators
(+ console unlock in strict mode).

A connection counts as **signed in only if its handshake token was a valid
session for that exact username** — even in open mode, a connection using an
invented token gets `unauthenticated` for every action except `me`.

---

## 5. Actions

Arguments are JSON keys in the command; "→" is `data` in the reply.

### Identity

| Action | Level | Args → Returns |
|---|---|---|
| `me` | none | → `{authenticated, mode, sessionExpired, …}`; when signed in also `user, org, sessionExpiresTs, notifications{counts,total,personalBySender}, permissions{isAdmin,isHost,canManageUsers}, pendingRequests, password{hasPassword,expired,mustChange}, otpDue, adminUnlocked` — **one call gives the whole header: who, badges, when to sign in again** |

### Associates, hosts, approvals

| Action | Level | Args → Returns |
|---|---|---|
| `assoc.list` | user | → `{associates:[{user:{public profile}, relation:"host"\|"user"\|"peer", online}]}` — your left-hand contact list. `relation` is what *they are to you*: `host` = your host, `user` = someone you host, `peer` = an accepted invitation. |
| `assoc.invite` | user | `{to}` (username, email or mobile) → `{request}` |
| `assoc.remove` | user | `{user}` — removes a `peer` link only |
| `users.search` | user | `{q}` → `{users:[public profile]}`. **Strict mode: exact username/email/mobile only** (no browsing the directory). Open mode: partial name match. |
| `req.list` | user | `{status?}` (`pending` default, `all`, or a status) → `{requests:[…]}` — everything waiting on you, and things you started |
| `req.respond` | user | `{id, action:"accept"\|"reject"\|"ignore"}` → `{request}` |
| `host.users` | host | → `{users:[…full records…, online]}` — people you host |
| `host.transfer` | user | `{user, toHost}` → `{request}` — you must be that user's host |
| `users.invite` | host | invite fields (below) + optional `host` (admins only) → `{user}` |

**Requests** are one record type for every approval in the spec. `type`:

| `type` | Meaning | Who answers | On accept |
|---|---|---|---|
| `onboarding` | a self-registered user awaits approval | hosts whose scope covers them; **else the administrators** | user becomes `active`, approver becomes their host |
| `associate` | "A user may invite other users…" | the invited user (an admin can't answer for them) | both become `peer`s and can DM |
| `host_transfer` | "A host may transfer a user to another host" | the receiving host | user's host changes; old host link removed |
| `group_invite` | adding someone outside your own users to a group | **the invitee's host** | invitee is added to the group (even if offline) |

`accept` / `reject` / `ignore` all work for every type. An administrator may
answer any request except `associate`.

**Invite fields** (`users.invite`, also `admin.user.update`):
`name, email, mobile?, username?` (else derived from the email),
`isEmployee`, and then —

- employee: `branch, department, designation` (must exist in the master
  lists), `reportingManager?`, `isHost?` + `hostScope`, `canManageUsers?`
- part of an affiliate: `affiliate`, `affiliateBranch?`, `canManageUsers?`
- neither: `category, country, city, pin`

`hostScope` (who this host may host — matched with OR):
`{"employees":{"any":false,"branches":[…],"departments":[…],"designations":[…]},
"affiliates":{"any":false,"selected":[…]}, "categories":[…]}`.
A host can only invite people their own scope covers (`forbidden`
otherwise); admins can invite anyone. The inviter becomes the new user's host.

**Self-registration** (`POST /api/sd/register`) takes the same fields; the
person is `pending` until a covering host (or admin) approves, and can't get
an OTP until then (`pending_approval`).

### Cards, sections, reminders (the right-hand panel)

| Action | Level | Args → Returns |
|---|---|---|
| `cards.list` | user | `{section?, limit?}` (`all` default, or a section id) → `{cards:[…], sections:[…]}` newest first |
| `cards.dismiss` | user | `{id}` or `{id:"all"}` |
| `sections.list` | user | → `{sections}` — the six built-ins + the user's own |
| `sections.save` | user | `{name, rules:[{field:"from"\|"text"\|"kind", op:"contains"\|"equals"\|"starts", value}], match?:"any"\|"all", id?}` (`id` edits) → `{section}` |
| `sections.delete` | user | `{id}` |
| `reminder.add` | user | `{text, dueTs?}` → `{card}` |

A **card** is `{id, kind, from, text, ts, section, chat?, ref?, messageId?, dueTs?}`.
`kind`: `dm`, `group`, `request` (an approval waiting on you), `reminder`,
`system`. `chat` says how to open the sender's conversation
(`{scope:"dm", with}` or `{scope:"group", group}`) — that is "selecting a
message shows it in the chat window of the sender". `ref` links to a request
or submission.

Classification (first match wins): your own sections' rules → `request` ⇒
**pending**, `reminder` ⇒ **reminders**, `system` ⇒ **updates** → text that
starts with `!` or contains `#urgent`/`#priority` ⇒ **priority** → DMs ⇒
**personal**, group messages ⇒ **general**. Cards are created when a message
is delivered/queued to you (DMs, group messages) and for approvals.

### Notifications: priority, pending, personal, reminders

Exactly **four** categories notify. Everything else (`updates`, `general`,
custom sections) is a silent card. The category is decided by the built-in
rules only, so a user's own sections can never silence a notification.

| Category | A card counts when… |
|---|---|
| `priority` | text starts with `!` or contains `#urgent` / `#priority` (DM or group message) |
| `pending` | an approval is **waiting on you** (onboarding, invitation, host transfer, group invite) |
| `personal` | it's a direct message |
| `reminders` | it's a reminder **whose time has come** (a reminder with a future `dueTs` is silent until then) |

A card is **unread** until it is read. The counts are the unread cards in
those four categories.

| Action | Level | Args → Returns |
|---|---|---|
| `notifications.summary` | user | → `{counts:{priority,pending,personal,reminders}, total, personalBySender:{username:n}}` — `personalBySender` is the per-conversation badge |
| `notifications.list` | user | `{category?:"priority"\|"pending"\|"personal"\|"reminders"\|"all", unreadOnly?:true, limit?}` → `{notifications:[card], counts}`. With `unreadOnly:false` read ones are included, and upcoming reminders appear with `due:false` |
| `notifications.read` | user | one of `{ids:[cardId]}`, `{category}`, `{all:true}` → the new summary |
| `reminder.add` | user | `{text, dueTs?}` — no `dueTs` (or a past one) notifies immediately; a future one fires at that time (within ~15 s) |

**What marks things read without the UI asking:** sending `/read dm <user>`
(the chat UI already does this when a DM is opened) clears that sender's
personal/priority notifications; answering a request (`req.respond`, by
anyone) clears its `pending` notification for every approver.

**Live:** `notification` `{card, category, counts}` when a new one arrives,
`notifications_changed` `{counts, total, personalBySender}` when counts change
(read, answered, dismissed) — see §6. Offline users get no push; call
`notifications.summary` (or read it from `/sd me`) on connect.

A card now also carries `read`, `category` (one of the four, or `null`) and
`due`.

### Options and forms ("lite tstructs")

| Action | Level | Args → Returns |
|---|---|---|
| `options.list` | user | → `{options:[{id,caption,type,target,display,order}]}` — only the options **this user** is allowed to see ("Applicable to" already applied). This is the "Options section" above the chat. |
| `tstruct.get` | user | `{name}` → `{tstruct}` — only if one of your options points at it |
| `tstruct.submit` | user | `{name, values:{field: value}}` → `{submission}` or error `invalid_values` with `error.details.fields = {field: message}` |
| `submissions.list` | user | → `{submissions}` — yours, plus those from people you host |

Option `type`: `data_input` (opens the form named in `target`), `get_data`
(`target` = API name, `display` = `table`\|`name_value`\|`text`), `download`,
`upload`, `pay`, `axpert_tstruct`, `axpert_smartview`, `axpert_iview`,
`axpert_page`. **The backend stores, filters and validates these; it does not
yet execute `get_data`/`download`/`upload`/`pay`/`axpert_*`** — see "Not built".

Form field `type`: `text` (`multiline`, `rich`), `date` (`min`,`max`
`YYYY-MM-DD`), `time` (`HH:MM`), `wholenumber` / `number` (`min`,`max`),
`email`, `url`, `mobile` (`withCountryCode`), `location` (`{lat,lng}` or
`"lat,lng"`), `list` (`options[]`, `multi`), `selection` (`api`), `fill`
(`fillFrom`). Fields have `required`, `section`, and a `condition` —
`{field, op:eq|ne|gt|lt|gte|lte|in|notempty, value}` or `{all:[…]}` /
`{any:[…]}`. **Hidden fields are neither required nor stored** (a value sent
for one is dropped). The same rules run on the server, so the client can
render from the definition and rely on `invalid_values` for the final say.

### Admin console (`admin.*`)

`admin` level = administrator (strict mode: after `admin.unlock`). Use the
`admin.unlock.start` / `admin.unlock` actions (level `user`) or the REST
equivalents.

| Action | Args → Returns |
|---|---|
| `admin.unlock.start` / `admin.unlock` | `{}` → `{sent,…}` / `{password, otp}` → `{unlockedForSec}` |
| `admin.org.get` / `admin.org.set` | → `{org, counts{users,admins,pendingApprovals}}` / `{name}` |
| `admin.cfg.list` | `{kind}` → `{items}` — `kind`: `branches`, `departments`, `designations`, `categories`, `affiliates` |
| `admin.cfg.save` | `{kind, item}` → `{item}` (create or update by `name`) |
| `admin.cfg.delete` | `{kind, name}` — refused with `in_use` while users reference it; **categories can't be deleted**, only deactivated (`item.active:false`) |
| `admin.users.list` | `{status?, q?, page?, pageSize?}` → `{users, total, page, pageSize}` — each row has the spec's columns (`userType` employee/affiliate/external, `organisation`, `branch`, `department`, `designation`, `active`) |
| `admin.user.get` | `{username}` → `{user, associates:[{username,name,relation}]}` ("view associated users") |
| `admin.user.update` | `{username, …fields}` → `{user}` |
| `admin.user.status` | `{username, active}` → `{user, orphans:[…]}` — level `manage`. Deactivating **drops their live connection** and, for a host, returns `orphans` (their users) so you can reassign. Can't deactivate yourself or the last admin. |
| `admin.host.reassign` | `{from, to}` → `{moved, count}` — move all of one host's users to another |
| `admin.host.change` | `{user, host}` (or `host:null`) → `{user}` |
| `admin.affiliates.list` | → `{affiliates:[{name,category,branches,…,hosts:[usernames],users:[…]}]}` |
| `admin.admins.list` / `.add` / `.remove` | `{username}` → `{admins}`; the last admin can't be removed (`last_admin`) |
| `admin.tstruct.list` / `.get` / `.save` / `.delete` | form definitions; `.save` takes `{name, caption?, description?, fields[], sections[]}`; delete refused with `in_use` if an option points at it |
| `admin.option.list` / `.save` / `.delete` | `.save` takes `{id, caption, type, target?, display?, applicable?, active?, order?}` |
| `admin.appconn.list` / `.save` / `.delete` | application connections `{name, url, authType:none\|basic\|bearer, credentials?}`. Credentials are stored encrypted and **never returned** (`hasCredentials` only). Omitting `credentials` on update keeps the stored ones. |

`applicable` ("Applicable to"): each key is `"all"` (default) or a list —
`{categories, affiliates, departments, branches, designations}`. Categories
may include the two pseudo-categories `"Employee"` and `"Affiliate"`.
Affiliate restrictions apply only to affiliate members; department / branch /
designation restrictions only to employees.

---

## 6. Live events

Pushed without asking. Pushes are a convenience — everything they carry can
also be fetched (`req.list`, `cards.list`) after a reconnect.

| Message | When | Shape |
|---|---|---|
| `{"type":"sd_event","event":"request_created","data":<request>}` | someone needs your answer | request view |
| `{"type":"sd_event","event":"request_resolved","data":<request>}` | a request you started or could answer was answered | request view |
| `{"type":"sd_event","event":"card","data":<card>}` | a new card for you (message, approval, reminder) | card with `section`, `category`, `read`, `due` |
| `{"type":"sd_event","event":"notification","data":{"card","category","counts"}}` | a **new notification** (right category; a reminder only once due) | `counts` = the full summary, so a badge updates with no extra call |
| `{"type":"sd_event","event":"notifications_changed","data":<summary>}` | counts changed: read, answered, dismissed (also fires for your other tabs) | `{counts, total, personalBySender}` |
| `{"type":"sd_event","event":"session_expired","reason":"two_week_login"}` | the 14-day session ended; the socket closes right after | show sign-in |
| `{"type":"sd_event","event":"disconnected","reason":"account_deactivated"}` | an admin deactivated you; the socket closes right after | — |
| `{"type":"group_invite_pending","group","user","request"}` | your `/addmember` needs the invitee's host's approval | reply to `/addmember` |
| `{"type":"error","code":"not_associated"\|"not_allowed","text":"…"}` | a chat command was refused by strict-mode rules | ordinary `error` event + `code` |

Request view: `{id, type, status, from, fromName, subject, subjectName,
approvers[], data, createdTs, resolvedTs, resolvedBy}` where `status` is
`pending|accepted|rejected|ignored`.

---

## 7. Error codes

| `code` | HTTP | Meaning |
|---|---|---|
| `unauthenticated` | 401 | no/expired session, or the connection has no Sandesh session |
| `session_expired` | 401 | the connection *was* signed in but its 14-day session has ended — sign in again |
| `invalid_credentials` | 401 | wrong details (same answer for unknown user — no enumeration) |
| `otp_required` | 401 | 14-day OTP check is due; an OTP was just sent |
| `otp_invalid` / `otp_locked` | 401 / 429 | wrong or expired code / too many wrong codes |
| `locked` / `rate_limited` | 429 | too many attempts / requests |
| `forbidden` | 403 | signed in but not allowed |
| `admin_locked` | 403 | strict mode: unlock the admin console first |
| `password_change_required` | 403 | change the password first |
| `account_inactive` / `pending_approval` / `rejected` | 403 | account state |
| `invalid`, `invalid_email`, `invalid_mobile`, `weak_password`, `invalid_values`, `bad_request`, `bad_json` | 400 | bad input (`invalid_values` carries `details.fields`) |
| `not_found`, `no_pending_setup` | 404 | |
| `email_taken`, `mobile_taken`, `username_taken`, `in_use`, `duplicate`, `already_associated`, `already_resolved`, `already_setup`, `not_ready`, `last_admin` | 409 | conflicts |
| `reserved_name`, `not_allowed`, `limit` | 400 | rule violations |
| `unknown_action` | — | typo in the action name |
| `internal` | 500 | server bug — check the backend log (`docs/DEBUGGING.md`) |

---

## 8. Where each part of the spec lives

| Spec section | API |
|---|---|
| Users: employees, external users, affiliate members, hosts | user record + `hostScope` (§5) |
| First login (org, user, email, mobile, OTP → first admin) | `/api/sd/setup/*` |
| Setup: branches, departments, designations, categories, affiliates | `admin.cfg.*` |
| Invite users | `users.invite` |
| User self-registration → host approval | `/api/sd/register`, `req.list`, `req.respond` |
| User associations ("message only your host"; invitations; host transfer) | `assoc.*`, `host.transfer`, strict-mode DM rule |
| User groups (host creates; invitee's host approves) | `/creategroup`, `/addmember`, `group_invite` requests |
| User login (email/mobile, OTP every 2 weeks) | `/api/sd/login`, `/api/sd/otp/send` |
| Admin console (listings, activate/deactivate, host change, admins, password) | `admin.*`, `/api/sd/admin/unlock`, `password/change` |
| Messaging | existing chat protocol |
| Setup application connections | `admin.appconn.*` |
| Lite TStruct | `admin.tstruct.*`, `tstruct.get`, `tstruct.submit` |
| Configuring options + "Applicable to" | `admin.option.*`, `options.list` |
| Home page: options section, associates (left), cards (right) | `options.list`, `assoc.list`, `cards.*`, `sections.*` |
| Notifications: priority, pending, personal, reminders | `notifications.*`, `reminder.add`, `notification` / `notifications_changed` pushes |
| Ask the user to log in again every two weeks (app login, not ARM) | 14-day session, `sessionExpiresTs`, `session_expired`; ARM sign-in no longer needed |
| My Work Space | client-side only, as today (`workspace` host is never routed by the backend) |

## 9. Not built yet (don't wait on these)

- **Executing options** against external systems — `get_data` (call an API and
  return table/name-value/text), `download`, `upload`, `pay`, and the Axpert
  options (tstruct / smart view / iview / custom page). The backend defines,
  stores, filters and validates them and hands the frontend the definition;
  the calls themselves need the Axpert/ARM contracts (and a payment provider)
  to be fixed.
- **SSO** login.
- **Real SMS/email delivery.** OTPs and invitations go to a pluggable channel:
  server log (dev), fixed code (demo), or a **webhook** you point at any
  gateway. No provider is wired in.
- Email/mobile verification at self-registration (it's approved by a host
  instead).
- Cards for department-host messages (`/hostmsg`) — those hosts don't exist yet.
- Existing plain-chat users are not Sandesh users; nothing migrates them.
