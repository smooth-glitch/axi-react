# Sandesh API — what the frontend builds against

Everything from the Sandesh spec that isn't plain chat: organisation setup,
users, hosts, approvals, host-only messaging, groups, message cards, forms
("lite tstructs"), options and the admin console. Plain chat itself
(`/msg`, `/groupmsg`, history, reactions…) is unchanged and documented in
[`CHAT_PROTOCOL.md`](CHAT_PROTOCOL.md).

Source of truth is the code in `axi-chat-backend/src/sd_*.erl`. Every
behaviour described here is exercised by the tests in `axi-chat-backend/test/`
(`sandesh_test.mjs` 203 checks, `sandesh_session_test.mjs` 14,
`sandesh_totp_test.mjs` 31, `sandesh_mfa_test.mjs` 41, and
`integration_test.mjs` 44 for plain chat) — if this doc and the code
disagree, the test is right; tell the backend owner. Backend internals, env vars and debugging live in
[`axi-chat-backend/docs/SANDESH.md`](../axi-chat-backend/docs/SANDESH.md); a
step-by-step login/signup integration walkthrough (the same content as this
doc's §3 login section, laid out flow-by-flow) is
[`axi-chat-backend/docs/LOGIN_INTEGRATION.md`](../axi-chat-backend/docs/LOGIN_INTEGRATION.md).

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
1. REST   POST /api/sd/login  {identifier, password?, totp|emailOtp|recoveryCode?, deviceId?}   →  { token, user, … }
2. WS     connect, first frame: {"username": <user.username>, "token": <token>}
3. WS     send  /sd <action> {json}   ←→   {"type":"sd", "ok":…, "data"|"error":…}
          listen for  {"type":"sd_event", "event":…}  pushes
```

`password` is required only for admin accounts (see §3's "Login rules"
below) — everyone else logs in with just `identifier` plus, when due, a
second-factor code.

`username` in the handshake must equal `user.username` from step 1
(usernames are lowercase; the backend rejects a token used under a different
name).

**There is no ARM sign-in in this flow.** The app signs in with its own
Sandesh login (step 1) and the token from it *is* the identity.
`armSessionId` used to be a required handshake field; it is now **optional**
(defaults to `"app"`, not interpreted), so stop sending it. **The ARM sign-in
page has already been removed from the app** (PR #10, 24 Sep 2026): Sandesh
sign-in is the only front door, and the ARM sign-in is kept only as an
on-demand function (`window.AxShowArmSignIn()`). A client that still sends the
ARM values keeps working.

### The two-week login (sessions)

A session lasts **exactly 14 days and is not extended by activity** — after
that the person must sign in again. What the frontend sees:

| Where | Signal | What to do |
|---|---|---|
| sign-in reply, `GET /api/sd/session`, `/sd me` | `expiresTs` / `sessionExpiresTs` (epoch ms) | optionally show "sign in again by …" |
| REST, after it ends | `401 unauthenticated` | show the sign-in screen |
| an **open** WebSocket, when it ends | `{"type":"sd_event","event":"feed_item","data":{"notification","counts"}}` | a workspace-panel item was created or changed (new message, count bumped, resolved, read) | upsert by `notification.id`; `counts` = `{high,medium,low,resolved,unread,total}` |
| `{"type":"sd_event","event":"feed_removed","data":{"ids","counts"}}` | items dismissed / cleared (also your other tabs) | remove by id |
| `{"type":"sd_event","event":"feed_changed","data":{"ids","read","counts"}}` | those items were marked read (`read:true`) or unread (`read:false`) | set `read` on the listed ids; `counts` refreshes the badges |
| `{"type":"sd_event","event":"session_expired","reason":"two_week_login"}`, then the server closes the socket | show the sign-in screen (don't auto-reconnect with the old token) |
| `/sd …` in the short gap before that | `error.code:"session_expired"`; `/sd me` → `authenticated:false, sessionExpired:true` | same |

A connection re-checks its session at most every 30 s (on its next command),
so it can take up to about 30 s after the end time for the socket to close.

Separately, from **the same device**, no second-factor code is needed again
for 14 days after the last one — but this is now tracked **per device**, not
just per account: a `deviceId` (a stable, client-generated id — see §3's
"Login rules") that hasn't verified in the last 14 days, or a device the
backend has never seen, is asked for a code (`totp_required`, or for an
email-method account, the login call itself sends one — see §3) regardless
of how recently the account verified somewhere else. An admin's password
must also be changed every 30 days, independent of device trust. `GET
/api/sd/session` (with the token) restores the user after a page reload; a
401 means sign in again.

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
| `POST /api/sd/setup/verify` | `{otp}` | enrollment step 1 (see "Login rules" below): `{totpSetupRequired:true, mfaMethod:"totp", secret, otpauthUri, issuer, digits, periodSec, recommendedApps, defaultPassword, org, user}`. **Not a session yet** — `POST /api/sd/login` with that password (+ a code, once scanned) produces the admin's first session. |
| `POST /api/sd/register` | self-registration fields (§5) + `password` | `{registered, status:"pending", username, requestId, awaitingApprovalFrom}` |
| `POST /api/sd/login` | `{identifier, password?, totp?, emailOtp?, recoveryCode?, deviceId?, mfaMethod?}` | a **session**, or an enrollment/2FA step — see "Login rules" below |
| `GET /api/sd/session` | header `Authorization: Bearer <token>` | `{user, sessionExpiresTs, password:{hasPassword,expired,mustChange}, totpDue, mode}` — `401` once the 14-day session has ended |
| `POST /api/sd/logout` | Bearer | `{loggedOut:true}` |
| `POST /api/sd/password/change` | Bearer; `{oldPassword?, newPassword}` | `{changed:true}` (`oldPassword` not needed if the user has no password yet) |
| `POST /api/sd/admin/unlock/start` | Bearer | `{sent, …}` — OTP for the admin console |
| `POST /api/sd/admin/unlock` | Bearer; `{password, otp}` | `{unlockedForSec}` (strict mode only needs this) |
| `GET /api/sd/2fa/totp` | Bearer | `{enabled, method}` — `method` is `"totp"` or `"email"` |
| `POST /api/sd/2fa/totp/disable` | Bearer; `{password, code}` | `{disabled:true}` — `code` is the current totp/email code, or a recovery code. The next login re-enrolls (fresh secret or a fresh emailed code, per `mfaMethod`) |
| `POST /api/sd/2fa/totp/recovery/regenerate` | Bearer; `{password, code}` | `{recoveryCodes:[...10 fresh strings]}`, invalidating every previous code |
| `POST /api/sd/2fa/email/request` | Bearer | `{sent, expiresInSec, devOtp?}` — **email-method accounts only**: fetches the code to pass as `code` to the two endpoints above (there's nothing to compute locally, unlike an app) |

**Session** = `{token, expiresTs, user, mustChangePassword, totpDue}` (setup
also adds `org`). `totpDue` means a code is due again **on this device** — a
call from it with no code then fails with `totp_required` (totp method) or,
for an email-method account, sends one automatically (see "Login rules").

### Login rules (from the spec)

- **Sign in with** email, mobile number or username. Mobiles match however
  they're formatted (`+91 98860 12345` = `919886012345`).
- **A password is required only for admin accounts.** Every other account's
  password, if it even set one, is never checked at login — send `password`
  for an admin, omit it (or send anything) for anyone else.
- **Every account needs a second factor** — an authenticator-app TOTP code or
  an emailed OTP code, whichever it enrolled in — but only from a **device
  this account hasn't verified from in the last 14 days**. A trusted device's
  login succeeds outright (once any password requirement is met); a new or
  expired-trust device always asks. See "Enrollment" and "Device trust" below.
- **Admin:** default password is `"Sandesh" + username`. It must be changed at
  first login (`mustChangePassword`), and again **every 30 days**
  (`/sd me → password.expired`). New passwords: ≥ 8 chars, letters + a digit,
  not the default.
- **Admin console** = password **and** a delivered OTP (`admin/unlock`), in
  strict mode — unaffected by any of the above.
- **Abuse limits:** OTP/TOTP/email-code valid 5 min (TOTP: 30s step, ±1 step
  drift), 5 tries per code; resend cooldown 30 s; 5 failed logins locks the
  account for 15 min (`locked`, HTTP 429); per-IP limits on login/register/setup.

#### Enrollment (first-ever login, or after disabling 2FA)

A body of `{identifier, password?}` for an account with no confirmed second
factor yet doubles as the enrollment flow. Pick the method with an optional
`mfaMethod` field — `"totp"` (default) or `"email"`:

1. `POST /api/sd/login {identifier, password?}` → **no `token`**. For
   `mfaMethod:"totp"`: `{totpSetupRequired:true, mfaMethod:"totp", secret,
   otpauthUri, issuer, digits, periodSec, recommendedApps}` — render
   `otpauthUri` as a QR code (the `qrcode` npm package works well) and show
   `secret` as text for manual entry. Re-calling this before finishing gives
   back the **same** QR — safe to re-hit if the user navigates away.
   For `mfaMethod:"email"`: `{totpSetupRequired:true, mfaMethod:"email",
   sent:true, expiresInSec:300, devOtp?}` — a code was just emailed instead;
   there's no secret/QR. Re-calling resends (30s cooldown:
   `{sent:false, retryAfter}`).

   `recommendedApps` is `[{name, ios, android}]` — Google Authenticator +
   Microsoft Authenticator store links, for a "don't have one?" prompt.

2. `POST /api/sd/login {identifier, password?, totp:"123456"}` (or
   `{..., emailOtp:"123456"}`, whichever step 1 used) → `{token, user,
   expiresTs, mustChangePassword, recoveryCodes:[...10 strings],
   totpJustEnabled:true}`. **Show the recovery codes exactly once, right
   here** — the API never returns them again. Wrong code → `otp_invalid`, let
   them retry, no need to restart the flow.

`setup/verify` (the very first admin) works the same way — its response *is*
step 1 above, always `mfaMethod:"totp"`, plus `defaultPassword` (so the
frontend doesn't have to know the `"Sandesh"+username` convention).

#### Device trust

Pass `deviceId` — an opaque string your client generates once per
install/browser and persists (e.g. `localStorage`) — in every login call, so
the backend can recognise "this same device" across logins. Omit it and a
coarser fallback (derived from the `User-Agent` header) is used instead, so
things still work before you wire this up, but two browsers/OSes that share
that fallback would be treated as one device, and a request with neither
`deviceId` nor a `User-Agent` is **never** treated as returning (always asks
for a code — fails closed).

Once enrolled, a call from a **known, still-trusted** device succeeds with
just `{identifier, password?}` — no code needed, `totpSetupRequired` absent,
`recoveryCodes` absent, ordinary session response. A call from an
**unrecognised or trust-expired** device:
- **totp method**: `totp_required` (401). Retry with `{..., totp:"123456"}`,
  or `{..., recoveryCode:"ABCDE-FGHJK"}` if the device with the app is lost
  (each recovery code works once, for either method).
- **email method**: the *same* login call, with no `emailOtp` yet, instead
  returns `{ok:true, data:{emailOtpRequired:true, mfaMethod:"email",
  sent:true/false, expiresInSec, retryAfter?, devOtp?}}` — login itself
  triggers sending the code, since there's nothing to generate locally. Retry
  with `{..., emailOtp:"123456"}`.

A successful code check trusts that device for another 14 days, independent
of every other device on the account.

### First-time setup (spec: "First login")

```
GET  /api/sd/public                → setupDone:false → show "Set up your organisation"
POST /api/sd/setup/start  {org,name,username?,email,mobile}   → OTP sent
POST /api/sd/setup/verify {otp}    → enrollment step 1 (mfaMethod:"totp"); defaultPassword included
POST /api/sd/login {identifier, password:defaultPassword, totp:"123456"}  → session; mustChangePassword === true
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
| `me` | none | → `{authenticated, mode, sessionExpired, …}`; when signed in also `user, org, sessionExpiresTs, notifications{counts,total,personalBySender}, permissions{isAdmin,isHost,canManageUsers}, pendingRequests, password{hasPassword,expired,mustChange}, totpDue, adminUnlocked` — **one call gives the whole header: who, badges, when to sign in again**. `totpDue` reflects the **calling device's** trust, same as the REST session endpoint |

### Associates, hosts, approvals

| Action | Level | Args → Returns |
|---|---|---|
| `assoc.list` | user | → `{associates:[{user:{public profile}, relation:"host"\|"user"\|"peer", online}]}` — your left-hand contact list. `relation` is what *they are to you*: `host` = your host, `user` = someone you host, `peer` = an accepted invitation. |
| `assoc.invite` | user | `{to}` (username, email or mobile) → `{request}` |
| `assoc.remove` | user | `{user}` — removes a `peer` link only |
| `users.search` | user | `{q}` → `{users:[public profile]}`. **Strict mode: exact username/email/mobile only** (no browsing the directory). Open mode: partial name match. **Hosts are only listed for the people they are for** (see *Hosts visibility* below); everyone else is listed as before. |
| `hosts.mine` | user | → `{hosts:[{username,name,designation,department,branch,isHost,online,relation}]}` — only the hosts that cover the caller: `relation:"assigned"` for the one they are assigned to (even if an administrator put them there outside the host's usual scope), `"covering"` for the others. Never the full host list. |
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
| `reminder.add` | user | `{text, dueTs?}` — no `dueTs` (or a past one) notifies immediately; a future one fires at that time (within ~2 s) |

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

### My Workspace notification feed (the right-hand expandable panel)

The real notifications behind the MWS panel. Every item comes from something that actually
happened to **this user** -- nothing is a preset, so there is no role-based mock list any more:
who gets what follows from who the event is addressed to (approvers get approvals, hosts/admins get
submissions, everyone gets their own messages and security events).

It is a **separate layer** from `notifications.*` above (the four badge categories). Keep using
`notifications.*` for the chat-list badges; use `feed.*` for the workspace panel.

**The item is the object the panel already renders**, so it is a drop-in for `buildInitialRoleNotifications`:

```json
{ "id": "k3J…", "priority": "high", "category": "messages",
  "title": "Sam W", "message": "!server is down", "ts": 1790000000000,
  "icon": "chat", "read": false, "resolved": false, "resolvedTs": null,
  "actionType": "open_chat", "actionLabel": "Open chat", "chatId": "user-sam1",
  "count": 3, "severity": "high", "from": "sam1",
  "chat": {"scope":"dm","with":"sam1"}, "ref": null }
```

| Field | Notes |
|---|---|
| `priority` | `high` (red) \| `medium` (yellow) \| `low` (grey) \| `resolved` (green). Exactly the panel's four tabs |
| `severity` | the priority it has/had before being resolved (`high\|medium\|low`) |
| `ts` | epoch **milliseconds** of the last activity -- format it client-side ("15m ago"). There is deliberately no pre-formatted `time` string: it would go stale |
| `read` | drives the unread dot and the "N unread" count |
| `count` | how many messages are folded into this row (see "coalescing") |
| `category` | `messages` \| `approvals` \| `submissions` \| `reminders` \| `security` \| `system` |
| `actionType` / `actionLabel` | what the arrow button does: `open_chat` (use `chatId`), `approvals` (open the approvals view; `ref.requestId`), `submissions` (`ref.submissionId`, `ref.tstruct`), `none` (no button). Same names `handleAction` already switches on |
| `chatId` | in the frontend's own convention: `user-<username>` for a DM, `room-<group>` for a group -- pass straight to `onSelectChat` |
| `ref` | what it is about: `{requestId,type}`, `{submissionId,tstruct}`, `{cardId}`; else `null` |

**Priority rules.** DM = `medium`; group message = `low`; either becomes `high` when the text is urgent
(`!` prefix, `#urgent`, `#priority`). Approval waiting on you = `high`. Form submitted to you = `medium`.
Due reminder = `medium`. Security: account locked / 2FA turned off = `high`; signed in elsewhere / recovery
codes regenerated = `medium`; password changed = `low`. The outcome of an approval you asked for = `low`.

**Where items come from** (all real events): DMs and group messages (only from *other* people); approval
requests waiting on you (associate, host transfer, group invite, new-user onboarding); the answer to a request
you raised; a form submitted to you as its host or as an admin (never to the submitter); reminders when they
come due; and account-security events (a new sign-in ended your other session, account locked after repeated
failed sign-ins, password changed, 2FA turned off, recovery codes regenerated).

**Coalescing.** Messages fold into one row per conversation (`count` goes up, the text is the latest, it
turns unread again) instead of flooding the panel. New activity also **re-opens** a conversation you had
resolved. Approvals, submissions and reminders are one row each.

**Resolved.** Marking done (`feed.resolve`) turns an item green and read. An approval also turns green **by
itself** for every approver when anyone answers it, and a DM row is marked read when the chat opens
(`/read dm <user>`, which the chat UI already sends). Keeps the newest 300 items per user.

| Action (WS `/sd …`) | REST | Args → Returns |
|---|---|---|
| `feed.list` | `GET /api/sd/feed?priority=&category=&unreadOnly=&limit=&before=` | `{priority?:"all\|high\|medium\|low\|resolved", category?, unreadOnly?, limit? (50, max 200), before?: ts}` → `{notifications:[item], counts, hasMore}` newest activity first. Page with `before` = the last item's `ts` |
| `feed.summary` | `GET /api/sd/feed/summary` | → `{high, medium, low, resolved, unread, total}` (the tab badges + "N unread"). Also in `/sd me` as `feed` |
| `feed.read` | `POST /api/sd/feed/read` | `{ids:[id]}` or `{all:true}`; add `read:false` to mark **unread** (the panel's toggle) → `{updated, counts}` |
| `feed.resolve` | `POST /api/sd/feed/resolve` | `{id}` → `{notification, counts}` (`not_found` for an unknown id) |
| `feed.dismiss` | `POST /api/sd/feed/dismiss` | `{id}` → `{dismissed:true, counts}` |
| `feed.clear` | `POST /api/sd/feed/clear` | removes every **resolved** item ("Clear Resolved") → `{cleared, counts}` |

REST needs `Authorization: Bearer <token>` (401 otherwise) and answers in the usual `{ok,data}` envelope, so the
panel can load **before** the socket is up. Offline users simply accumulate items -- call `feed.list` on connect.

**Live, with no refresh and no polling** (see §6). Every change is pushed to the affected user's open app
the moment it happens: `feed_item` (new *or changed* item -- upsert by `id`), `feed_removed` (`ids`), and
`feed_changed` (`ids` + `read`: those items were marked read/unread). Each carries `counts`, so the header
updates without another call. Nothing that causes a notification ever waits on it: the feed is written by
its own background worker, so sending a message or answering an approval is never slowed down by it.
**Reload `feed.list` on every (re)connect of the socket** -- pushes only reach a connected app, so anything
that happened while it was disconnected is picked up by that reload. Due reminders arrive within ~2 s of their time.

**Wiring it into MyWorkspace (for the frontend dev)** -- replace the local list with server state:

```js
// on mount / after the socket connects
const { notifications, counts } = (await sandeshApi.get('/feed')).data;   // or ws.sd('feed.list')
setNotifications(notifications);

// live: upsert / remove
onSdEvent('feed_item',    ({ notification }) => setNotifications(p => [notification, ...p.filter(n => n.id !== notification.id)]));
onSdEvent('feed_removed', ({ ids })          => setNotifications(p => p.filter(n => !ids.includes(n.id))));
onSdEvent('feed_changed', ({ ids, read }) => setNotifications(p => p.map(n => ids.includes(n.id) ? { ...n, read } : n)));
onSocketOpen(() => reload());   // every (re)connect: pushes only reach a connected app

// the existing handlers become one call each
handleResolve      = (id) => ws.sd('feed.resolve', { id });
handleMarkRead     = (n)  => ws.sd('feed.read', { ids: [n.id], read: !n.read });
handleMarkAllRead  = ()   => ws.sd('feed.read', { all: true });
handleClearResolved= ()   => ws.sd('feed.clear');
handleDismiss      = (id) => ws.sd('feed.dismiss', { id });
```

`handleAction` keeps working unchanged (`actionType`, `chatId`). The panel can drop `buildInitialRoleNotifications`,
the role presets, and the `approvals` merge: approvals now arrive as `category:"approvals"` items. Format `ts`
with the same relative-time helper used elsewhere. The counts object maps 1:1 onto the existing `priorityCounts`.
Not included on purpose: the old fake "Erlang node sync", "Database backup" and "Quota" presets -- those had no
real event behind them.

### Options and forms ("lite tstructs")

| Action | Level | Args → Returns |
|---|---|---|
| `options.list` | user | → `{options:[{id,caption,type,category,target,targetScope,display,order,owner}]}` — only the options **this user** is allowed to see ("Applicable to" already applied). This is the "Options section" above the chat. With no arguments it returns every one of them (unchanged). With any of `category`, `q`, `page`, `pageSize` it returns **one page** instead — see "Smart Prompts by category" below. |
| `options.categories` | user | → `{categories:[{id,label,icon,types,executable,count}], total}` — one entry per Smart Prompts **pill**, with how many options this user has in it. See below. |
| `tstruct.get` | user | `{name}` → `{tstruct}` — only if one of your options points at it |
| `tstruct.submit` | user | `{name, values:{field: value}}` → `{submission}` or error `invalid_values` with `error.details.fields = {field: message}` |
| `submissions.list` | user | `{tstruct?, ref?, limit?, offset?}` → `{submissions, total, offset, limit, hasMore}` — yours, plus those from the people you host **now** (a newly assigned host sees their earlier history too); `tstruct` narrows to one structure (an administrator sees every submission of it). Newest first. `limit` 1–500 (default 500); page with `offset` while `hasMore`. Nothing is dropped after the newest N any more. |

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

#### User-made structures, options and files

Any signed-in user can also make their own structures and options (level `user`):

| Action | Args → Returns |
|---|---|
| `tstruct.user.list` / `.get` | `{}` / `{name}` → `{tstructs}` / `{tstruct}` — every user-made structure is visible to everyone |
| `tstruct.user.save` | `{name, caption?, description?, fields[], sections[]}` → `{tstruct}` (`owner`, `createdTs` set); `duplicate` if the name is taken |
| `tstruct.user.update` | same body → `{tstruct}` — **creator only** (`forbidden` otherwise, not even an administrator). Name and owner never change; records already saved are re-checked against the new definition when next edited |
| `tstruct.user.delete` | `{name}` — creator only. Options pointing at it are left (they then answer `not_found`); records are kept but can no longer be edited |
| `tstruct.user.submit` | `{name, values}` → `{submission}` (same validation as `tstruct.submit`) |
| `option.user.list` | → `{options, types}` — the options you made (an administrator gets all) |
| `option.user.save` | `{id?, caption, type, target?, display?, applicable?, active?, order?}` → `{option}`; a new option gets a server id (`o<n>`); only its creator (or an administrator) can change an existing one |
| `option.user.delete` | `{id}` — creator or administrator |

### Smart Prompts by category (pills + popup)

Instead of one button per option, My Workspace shows **one pill per category** with a count, and a click opens a popup that lists that category's options with a search bar.

**Pills — `options.categories`** (optional arg `includeEmpty: true` also returns categories the user has nothing in):

```json
{"categories":[
  {"id":"data_input","label":"Data input","icon":"edit_note","types":["data_input"],"executable":true,"count":12},
  {"id":"download","label":"Download","icon":"download","types":["download"],"executable":true,"count":3},
  {"id":"upload","label":"Upload","icon":"upload","types":["upload"],"executable":true,"count":1},
  {"id":"get_data","label":"API display","icon":"table_chart","types":["get_data"],"executable":false,"count":2},
  {"id":"pay","label":"Pay","icon":"payments","types":["pay"],"executable":false,"count":1},
  {"id":"axpert","label":"Axpert option","icon":"widgets","types":["axpert_tstruct","axpert_smartview","axpert_iview","axpert_page"],"executable":false,"count":4}],
 "total":23}
```

* Order is fixed (as above). Categories with no options for this user are left out, so a pill never shows `0`.
* `count` and the popup list follow the **same rules** as `options.list`: active options only, and only those whose "Applicable to" matches this user (category, department, branch, designation, affiliate).
* `executable:false` = "config only": the option can be configured but the chat cannot run it yet (`get_data`, `pay`, the four `axpert_*` types). Show the pill greyed or with a "coming soon" note, or hide it — a product decision.
* The four Axpert types are one **"Axpert option"** pill (`id:"axpert"`), as in the Option Builder.

**Popup — `options.list`** with arguments (all optional):

| arg | meaning |
|---|---|
| `category` | a category id from above (`"data_input"`, `"axpert"`, …). A raw option type such as `"axpert_iview"` also works and selects its whole category. Anything else → `invalid` error listing the valid ids. |
| `q` | search text; matches **caption, id or target**, ignoring case and surrounding spaces. Control characters are dropped, and it is cut at 100 characters. |
| `page` | 1-based; default 1. Out of range is clamped to the last page; junk becomes 1. |
| `pageSize` | default 20, max 100, min 1. |

Reply: `{options:[…], category, q, page, pageSize, total, totalPages, hasMore}` — `total` is the number of matches (after `category` and `q`), so it is the number to show in the popup title. An empty result is `total:0, totalPages:1, options:[]`, not an error. Sorted by the configured `order`, then caption A–Z (case-insensitive). Each option also carries its `category` id.

**Keeping the badges live:** when an administrator adds, changes or removes an option, every connected client receives `{"type":"sd_event","event":"options_changed"}`. Re-call `options.categories` (and `options.list` if a popup is open) when it arrives. Changing "Applicable to" or turning an option off moves the counts the same way.

Options now carry `owner` (null = made by an administrator), `targetScope` (`"admin"` / `"user"`, which kind of form a `data_input` option opens), `createdTs` and `modifiedTs`; `options.list` returns `targetScope` and `owner`. Rules the server enforces:

* A **user-made** option may only point at a **user-made** structure. Only an administrator can point an option at an admin-managed form, and only admin-made options grant access to one (`tstruct.get` / `tstruct.submit`) — a user can't widen who reaches a restricted form.
* A `download` option's `target` is a file id; a user can only attach a file **they uploaded**.
* `applicable` ("Applicable to") is enforced by `options.list` for user-made options exactly as for admin ones.

**Files** (for `upload` / `download` options) are plain HTTP, all with `Authorization: Bearer <token>`:

| Request | Result |
|---|---|
| `POST /api/sd/files?name=<file name>` — raw bytes as the body, `Content-Type` = the file's type | `{file:{id,name,mime,size,by,ts}}`. `413 too_large` above the limit (`SANDESH_MAX_FILE_MB`, default **10**, keep it ≤ nginx's `client_max_body_size`); 60 uploads/hour per user; `Content-Length` required |
| `GET /api/sd/files` | `{files}` — what you uploaded |
| `GET /api/sd/files/<id>` | the bytes as `application/octet-stream`, `attachment`, `nosniff`; name in `X-File-Name` (percent-encoded UTF-8, exposed to browsers) |

A file can be read by its uploader, an administrator, or anyone an **active `download` option pointing at it applies to**. Bytes are stored under a server-generated id in `SANDESH_FILES_DIR` (default `<app dir>/uploads/sd-files` — set it to a persistent path on servers that rebuild the app directory).

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
| `invalid_credentials` | 401 | wrong password (admin accounts), or unknown identifier (same answer either way — no enumeration) |
| `totp_required` | 401 | this device's 2FA trust is due; send `totp` or `recoveryCode` (totp-method accounts only — an email-method account gets an `ok:true` response with `emailOtpRequired` instead, see §3) |
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
| User login (email/mobile; password for admins only; 2FA every 2 weeks per device) | `/api/sd/login`, `/api/sd/2fa/*` |
| Admin console (listings, activate/deactivate, host change, admins, password) | `admin.*`, `/api/sd/admin/unlock`, `password/change` |
| Messaging | existing chat protocol |
| Setup application connections | `admin.appconn.*` |
| Lite TStruct | `admin.tstruct.*`, `tstruct.get`, `tstruct.submit` |
| Configuring options + "Applicable to" | `admin.option.*`, `options.list` |
| Home page: options section, associates (left), cards (right) | `options.list`, `assoc.list`, `cards.*`, `sections.*` |
| Notifications: priority, pending, personal, reminders | `notifications.*`, `reminder.add`, `notification` / `notifications_changed` pushes |
| My Workspace notification panel (real, prioritised, resolvable) | `feed.*`, `GET/POST /api/sd/feed*`, `feed_item` / `feed_removed` / `feed_changed` pushes |
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

## Live change events

Besides replies, the server pushes small `{"type":"sd_event","event":...,"data":{...}}` messages over the WebSocket when something changes. They carry only what changed; clients re-read the affected list.

| Event | Sent to | `data` |
|---|---|---|
| `tstructs_changed` | everyone connected | `scope` (`user`/`admin`), `name`, `action`, `by` |
| `options_changed` | everyone connected | `id`, `action`, `by` |
| `submissions_changed` | the submitter, the form's host, and admins | `id`, `tstruct`, `action` (`created`/`updated`/`deleted`), `by` |

Events sent while a client is offline are lost, so after reconnecting a client should re-read everything it shows (the web app does this on its `resync`).

## Hosts visibility, sign-up manager, and status on connect

- **Hosts visibility.** A host is visible to, and reachable by: themselves, administrators, other hosts (staff), the people
  they are assigned to or cover, and anyone connected with them (accepted invitation). Ordinary people are visible to
  everyone as before. Enforced in `users.search`, `hosts.mine` and direct messages (`sd_users:can_see_host/2`,
  `sd_policy:can_message/2`). In `open` mode the DM rule applies to people signed in to Sandesh (plain chat clients are
  unaffected); in `strict` mode a DM already needs an association. A refused DM answers
  `{"type":"error","code":"not_associated"}`. The `/hostmsg` department-host channel goes through the same rule.
- **Reporting manager.** `reportingManager` is ignored on `POST /api/sd/register` (like `isHost`, `roles`, ...). An
  administrator sets it with `admin.user.update`, a host with `users.invite`.
- **Status on connect.** Right after `welcome` (and the global history) the server sends one ordinary
  `{"type":"profile","user","avatar"|null,"status"|null}` event for each person the client already knows (itself, people
  online, its direct-message partners, its Sandesh connections) who has an avatar or a status. Handle it exactly like the
  live `profile` event. People with neither are skipped.
