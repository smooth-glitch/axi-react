# Sandesh layer — backend notes

How the Sandesh spec (`Sandesh.docx`: organisation, users, hosts, approvals,
host-only messaging, cards, forms, admin console) is implemented on top of
the existing chat backend. The **frontend contract** is
[`../../docs/SANDESH_API.md`](../../docs/SANDESH_API.md) (a step-by-step
walkthrough of just login/signup is [`LOGIN_INTEGRATION.md`](LOGIN_INTEGRATION.md));
this file is for whoever runs, debugs or extends the backend.

## The design in five sentences

1. It is **additive**: new `sd_*` modules + about ten small hook lines in
   `chat_web.erl`; no existing command changed behaviour (one fix aside: an
   unknown `/command` now errors instead of being broadcast).
2. **`SANDESH_MODE=open` is the default** and changes nothing for plain chat;
   `strict` turns the spec's rules into enforcement (host-only DMs, required
   sessions, group approvals, admin unlock). One module, `sd_policy`, decides.
3. **Pre-login flows are HTTP** (`/api/sd/*`, module `sd_http`) because no
   WebSocket exists yet; **everything after connecting is one command**
   (`/sd <action> {json}`, module `sd_cmds`) with a uniform reply envelope.
4. **Everything lives in Redis** under `sd:` (same store as chat), so it
   survives restarts and needs no new infrastructure.
5. **Every decision is covered by a test** (see "Testing").

## Modules

| Module         | Job                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sd_util`      | coercion, id/mobile/email normalisation & validation, random tokens, JSON in/out, sealing secrets, `mode()`                                                                  |
| `sd_db`        | Redis helpers (JSON documents in hashes, sets, sorted sets, rate limiter). Crashes the caller on Redis failure, like `chat_store:q_ok/1`; never logs values, only verb + key |
| `sd_org`       | the org record + master lists (branches, departments, designations, categories, affiliates); first-run claim                                                                 |
| `sd_users`     | user records, indexes (email, mobile), validation, host scope matching, associations                                                                                         |
| `sd_reqs`      | the four approval workflows as one "request" record: onboarding, associate, host_transfer, group_invite                                                                      |
| `sd_auth`      | first-run setup, OTP, passwords (PBKDF2-SHA256, 100k), sessions, lockout, admin-console unlock                                                                               |
| `sd_totp`      | optional real two-factor: TOTP enrollment (RFC 6238), login-time verification, recovery codes. Free (no SMS/email cost), self-contained -- see "Two-factor (TOTP)" below     |
| `sd_policy`    | **the** place strict mode is decided: handshake, DM, broadcast, group create/add, admin gate; plus safe post-send hooks                                                      |
| `sd_config`    | lite tstructs, options + "applicable to", app connections, form validation & submissions                                                                                     |
| `sd_cards`     | message cards, sections, classification, **notifications** (priority / pending / personal / reminders: unread state, counts, read, live pushes, due-reminder firing)         |
| `sd_feed`      | the My Workspace notification feed: real items from DMs, approvals, submissions, reminders and security events, with read/resolve/dismiss/clear, coalescing and live pushes (`feed.*`, `/api/sd/feed*`) -- see docs/SANDESH_API.md |
| `sd_scheduler` | a small `gen_server` (supervised in `chat_app_sup`) that every `SANDESH_SCHEDULER_TICK_MS` (15 s) asks `sd_cards:fire_due/0` to notify due reminders                         |
| `sd_notify`    | OTP/invite delivery channel (log / fixed / webhook) and live pushes to online users                                                                                          |
| `sd_http`      | the REST endpoints                                                                                                                                                           |
| `sd_cmds`      | the `/sd` WebSocket command dispatcher                                                                                                                                       |

Touched existing files: `chat_web.erl` (route `/api/sd/`, handshake check with
optional `armSessionId`, `/sd` command, policy hooks on `/msg /replydm
/creategroup /addmember /groupmsg /replygroup` + plain broadcast, an after-`/read`
hook for notifications, two `ws_loop` clauses for pushes/forced disconnect, the
per-command session re-check for the two-week rule, `CHAT_RATE_LIMIT_MAX`),
`chat_groups.erl` (`force_add/3`), `chat_app_sup.erl` (starts `sd_scheduler`).

## Configuration (environment variables)

| Variable                      | Default             | Meaning                                                                                                                                                                                                                                         |
| ----------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SANDESH_MODE`                | `open`              | `strict` enforces the spec's rules (see SANDESH_API §1)                                                                                                                                                                                         |
| `SANDESH_OTP_MODE`            | `log`               | how OTPs/invites are delivered: `log` (written to the server log — **dev only**), `fixed` (always `123456` — **demo only**), `webhook`                                                                                                          |
| `SANDESH_NOTIFY_WEBHOOK`      | —                   | URL for `webhook` mode. Receives `POST {"kind":"otp"\|"invite"\|"onboarding","to":{"name","email","mobile"},"text":"…","code":"123456"}` (`code` only for OTPs). Fire-and-forget, 8 s timeout, failures logged. Plug any SMS/email gateway here |
| `SANDESH_DEV_OTP`             | unset               | `1` ⇒ API responses echo the OTP as `devOtp`. **Never on a shared server**                                                                                                                                                                      |
| `SANDESH_OTP_COOLDOWN_SEC`    | `30`                | resend cooldown per account/purpose; `0` disables (tests)                                                                                                                                                                                       |
| `SANDESH_SESSION_TTL_SEC`     | `1209600` (14 days) | session lifetime — **fixed, not extended by activity** (the "log in again every two weeks" rule). Shorten only for tests                                                                                                                        |
| `SANDESH_TOTP_FRESH_SEC`      | `1209600` (14 days) | how long a password-only login is accepted after a TOTP code was last given, before one is demanded again. Shorten only for tests                                                                                                               |
| `SANDESH_SESSION_CHECK_SEC`   | `30`                | how often an open WebSocket re-checks its session (on its next command); when it has ended the client gets `sd_event session_expired` and the socket closes                                                                                     |
| `SANDESH_SCHEDULER_TICK_MS`   | `15000`             | how often due reminders are fired (a reminder is at most one tick late; min 100)                                                                                                                                                                |
| `SANDESH_SETUP_TOKEN`         | unset               | if set, `setup/start` must send it as `setupToken` — recommended on any reachable server, since first-run is claimable by whoever calls first                                                                                                   |
| `SANDESH_CORS_ORIGIN`         | `*`                 | `Access-Control-Allow-Origin` for `/api/sd/*`; restrict in production                                                                                                                                                                           |
| `CHAT_RATE_LIMIT_MAX`         | `30`                | commands per 10 s per connection (existing limiter, now tunable)                                                                                                                                                                                |
| `CHAT_ENCRYPTION_KEY`         | unset               | already used for message text; also seals stored app-connection credentials (without it they're stored with a `plain:` marker and a warning is logged)                                                                                          |
| `SANDESH_TOTP_ENC_KEY`        | unset               | 32 random bytes, base64 (`openssl rand -base64 32`) -- AES-256-GCM key TOTP secrets are encrypted with at rest. Unset ⇒ a fixed, publicly-known dev key is used instead (loudly warned about in strict mode)                                    |
| `SANDESH_TOTP_ISSUER`         | `Sandesh`           | the issuer name shown inside the authenticator app next to the account                                                                                                                                                                          |
| `REDIS_HOST/PORT/PASSWORD/DB` | as before           | unchanged                                                                                                                                                                                                                                       |

`strict` with `SANDESH_OTP_MODE` = `log`/`fixed` logs a loud warning once:
anyone who can read the log can sign in as anyone.

## Before deploying this to the VM

0. **Enable HTTPS at nginx first** (required for camera/`getUserMedia` and for
   tokens/OTPs to travel securely). Run once on the VM:

   ```bash
   sudo bash nginx/setup-tls.sh
   ```

   This generates a self-signed cert with `subjectAltName=IP:10.0.2.146`
   (required by all modern browsers — a CN-only cert is rejected), writes
   `/etc/nginx/conf.d/axi-tls.conf` (HTTPS on 443, HTTP→HTTPS redirect on 80),
   tests and reloads nginx, then prints per-platform instructions for
   distributing `/etc/nginx/ssl/axi.crt` to team devices as a trusted root CA.
   Each device only needs to install it once. PR previews automatically serve
   over HTTPS too (the `preview-deploy.yml` "Write nginx routing" step now
   generates per-slot `server { listen 443 ssl; }` blocks using the same cert).

1. **nginx must route `/api/sd/` to the backend.** Without it, requests to
   `/api/sd/...` get the website instead of the API (plain chat is unaffected).
   - **PR previews:** done in `.github/workflows/preview-deploy.yml` (the
     "Write nginx routing for this slot" step now also writes
     `location /preview/<slug>/api/sd/ { proxy_pass http://127.0.0.1:<port>/api/sd/; … }`
     with `X-Real-IP`). The "Verify" step logs whether it answers.
   - **Production:** the nginx config is a file on the VM, not in this repo.
     Add, in the production server block (and keep `X-Real-IP` — the per-IP
     OTP/login/register limits key off it, same reasoning as
     `chat_web:client_ip/2`), then `sudo nginx -t && sudo systemctl reload nginx`:
     ```
     location /api/sd/ {
         proxy_pass http://127.0.0.1:8080;
         proxy_set_header Host $host;
         proxy_set_header X-Real-IP $remote_addr;
     }
     ```
     Check: `curl http://10.0.2.146/api/sd/public` must return JSON
     (`{"data":{…,"setupDone":…},"ok":true}`), not the website's HTML.
2. Leave `SANDESH_MODE` unset (open) for the client demo.
3. For real use: `SANDESH_MODE=strict`, `SANDESH_OTP_MODE=webhook` +
   `SANDESH_NOTIFY_WEBHOOK`, `SANDESH_SETUP_TOKEN`, `SANDESH_CORS_ORIGIN`,
   `CHAT_ENCRYPTION_KEY`, a Redis password. HTTPS/WSS is handled at nginx
   (see step 0 above — tokens and OTPs travel over these connections).

## Redis layout (all under `sd:`; safe to inspect with `redis-cli`)

| Key                                                 | Type                  | Holds                                                                                                                                          |
| --------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `sd:org`                                            | hash                  | `name`, `setup_done`, `created_ts`, `created_by`                                                                                               |
| `sd:cfg:<kind>`                                     | hash                  | `branches`/`departments`/`designations`/`categories`/`affiliates`: lowercased name → JSON                                                      |
| `sd:users`                                          | hash                  | username → user JSON (no credentials)                                                                                                          |
| `sd:idx:email`, `sd:idx:mobile`                     | hash                  | email / mobile digits → username                                                                                                               |
| `sd:cred`                                           | hash                  | username → `{salt,hash,iter,setTs,mustChange}` (PBKDF2)                                                                                        |
| `sd:sess:<token>`                                   | string, TTL 14 d      | `{username,createdTs}`                                                                                                                         |
| `sd:unlock:<token>`                                 | string, TTL 30 min    | admin-console unlock                                                                                                                           |
| `sd:otp:<purpose>:<key>`, `sd:otpa:…`, `sd:otpcd:…` | string, TTL           | OTP hash, attempt counter, resend cooldown (`purpose`: login/setup/unlock)                                                                     |
| `sd:lf:<user>`                                      | string, TTL 15 min    | failed-login counter (lockout at 5)                                                                                                            |
| `sd:totp`                                           | hash                  | username → `{encSecret,enabled,createdTs,confirmedTs,lastCounter,recovery:[{hash,used}]}` (secret AES-256-GCM sealed, never plaintext at rest) |
| `sd:rl:*`                                           | string, TTL           | per-IP/bucket rate limits                                                                                                                      |
| `sd:setup:pending`                                  | string, TTL 15 min    | the validated first-run profile awaiting its OTP                                                                                               |
| `sd:assoc:<user>`                                   | hash                  | peer → `host`\|`user`\|`peer`                                                                                                                  |
| `sd:reqs`, `sd:reqs:u:<user>`, `sd:seq:req`         | hash / set / counter  | requests, per-user index, id counter                                                                                                           |
| `sd:cards:<u>`, `sd:card:<u>`                       | zset / hash           | card ids by time / card JSON (newest 500 kept; each card has `read`, and reminders `dueTs`)                                                    |
| `sd:reminders`                                      | zset                  | future reminders: score = due time (ms), member = `user                                                                                        | cardId`; `sd_scheduler`claims entries with`ZREM` so none fires twice |
| `sd:sections:<u>`                                   | string                | the user's custom sections                                                                                                                     |
| `sd:tstructs`, `sd:options`, `sd:appconns`          | hash                  | definitions (`credentials` sealed)                                                                                                             |
| `sd:subs`, `sd:subs:u:<user>`, `sd:seq:sub`         | hash / zset / counter | form submissions                                                                                                                               |

Chat data (`msg:*`, `conv:*`, `group:*`, `profile:*`, `known_users`,
`dm_partners:*`) is untouched.

## Mandatory two-factor (TOTP or email) -- frontend integration

Every account needs a second factor to log in -- either a code from an
authenticator app (Google Authenticator, Authy, 1Password, ...) or an emailed
OTP code, whichever it enrolled in (see "Choosing a method" below) -- but a
**password is required only for admin accounts**. Any other account signs in
with just its identifier plus, when due, that second-factor code; a wrong or
missing password is never checked for them at all.

"When due" is now per **device**, not a single account-wide freshness clock:
a device this account has verified from in the last `SANDESH_DEVICE_TRUST_SEC`
(default 14 days) skips the code entirely; a brand-new device always asks,
however recently the account verified anywhere else. See "Device trust"
below for how a device is identified and how to integrate it.

An authenticator-app code is free and scalable (computed on the user's own
device from a shared secret -- no delivery provider, no per-login cost,
verification is a couple of HMAC computations plus one Redis round trip); an
emailed code costs a delivery per use but needs no app install, which is why
it exists as an option for citizen users who'd rather not set one up.

**A password is set only for admin accounts** (and, harmlessly, wherever the
existing invite/self-registration flow already collects one for anyone else
-- it's simply never checked at their login):

- First admin (`setup/verify`): the documented default, `"Sandesh"+username`.
- Invited (`users.invite`): same default-password convention -- the response
  to the inviter, and the notification sent to the invitee, both carry it.
- Self-registered (`POST /register`): the user supplies their own `password`
  in the registration body (validated with the same policy as a password
  change); registration fails with `weak_password` if it's missing or weak.
  All three are flagged `mustChangePassword` until changed, exactly as before
  -- meaningful only for the admin accounts that actually get checked on it.
  (`sd_cmds`'s strict-mode "change your password first" gate, `must_change/1`,
  is likewise enforced only for admins now -- a non-admin's default-password
  flag would otherwise block every action forever, since nothing in their
  login ever looks at it to prompt a change.)

**2FA enrollment is not a separate step -- it happens inline at first
login** (for a non-admin: the very first call; for an admin: the first call
that also has a correct password). A body of `{identifier, password?}` for
an account with no confirmed second factor yet doubles as the enrollment
flow, and picks the method with an optional `mfaMethod` field (`"totp"`, the
default, or `"email"`):

1. `POST /api/sd/login {identifier, password?}` → for an unenrolled account,
   **no `token`**. For `mfaMethod` `"totp"` (default):
   `{totpSetupRequired:true, mfaMethod:"totp", secret, otpauthUri, issuer,
digits, periodSec, recommendedApps}`. Render `otpauthUri` as a QR code
   (e.g. the `qrcode` npm package) for the user to scan, and show `secret` as
   text for manual entry. Retrying this call before finishing hands back the
   _same_ pending secret, so the QR the user already scanned keeps working.

   `recommendedApps` is `[{name, ios, android}, ...]` for the two apps this
   org endorses (Google Authenticator, Microsoft Authenticator) -- App
   Store/Play Store links for a "don't have an authenticator app?" prompt.
   Any RFC 6238 app works via `otpauthUri`/`secret` regardless; this is
   pure onboarding-copy data, not an integration requirement. Google
   Authenticator only reliably supports SHA1/6-digit/30s codes, which is
   exactly what `digits`/`periodSec` and the URI's `algorithm=SHA1` already
   are -- not a coincidence, that pairing is why those were chosen.

   For `mfaMethod:"email"` (citizen users who'd rather not install an app):
   `{totpSetupRequired:true, mfaMethod:"email", sent:true, expiresInSec:300}`
   -- a code was just emailed; there's no secret/QR to show. Retrying this
   call resends (subject to the usual 30s cooldown, `{sent:false,
retryAfter}`) rather than starting over.

2. `POST /api/sd/login {identifier, password?, totp:"123456"}` or
   `{..., emailOtp:"123456"}` (whichever method step 1 used) → on success,
   `{token, ..., recoveryCodes:[...10 strings], totpJustEnabled:true}`.
   **Show the recovery codes exactly once here** -- the API never returns
   them again. A wrong code returns `otp_invalid` and leaves enrollment
   pending, so the user can just try again; it also counts against the
   account's failed-attempt lockout (5 / 15 min), same as a wrong password.

`setup/verify` (creating the very first admin) works the same way, always
`mfaMethod:"totp"`: its response _is_ step 1 above (with a `defaultPassword`
field so the frontend doesn't have to know the "Sandesh"+username
convention), not a session -- `POST /api/sd/login` with that password (+ a
code, once scanned) is what produces the admin's first session.

**Once enrolled, a call from a known DEVICE needs no code at all** (and, for
a non-admin, no password either) -- see "Device trust" below for how a
device is identified. A call from an unrecognised device:

- **totp method**: returns `totp_required` (401) until one of these is sent:
  `{..., totp:"123456"}` (the app's current code), or
  `{..., recoveryCode:"ABCDE-FGHJK"}` (a backup code, for a lost device;
  works for either method, each code good once).
- **email method**: the same login call, with no `emailOtp` yet, instead
  returns **`{ok:true, data:{emailOtpRequired:true, mfaMethod:"email",
sent:true/false, expiresInSec, retryAfter?}}`** -- login itself triggers
  sending the code, since (unlike an app) there's nothing for the user to
  generate locally. Send `{..., emailOtp:"123456"}` (or `recoveryCode`) next.

**Device trust**: pass a `deviceId` in the login body -- an opaque string
your client generates once per install/browser and keeps (e.g. in
`localStorage`) -- so the backend can recognise "this same device" across
logins. Omit it and a coarser fallback (derived from the `User-Agent` header)
is used instead, so an un-migrated client still gets _some_ notion of device
rather than none, but two browsers/OSes sharing that fallback would be
treated as one device, and a client sending neither `deviceId` nor a
`User-Agent` is never treated as returning (always asks for a code -- fails
closed, not open). There's no per-user device list to inspect or revoke
individually; trust is just a sliding `SANDESH_DEVICE_TRUST_SEC`-long window
per (account, device) pair, refreshed on every successful login from it.

**Managing 2FA once signed in** (Bearer, for an account that's already
enrolled -- by definition every live session is, since enrollment is what
produces the first one):

- `GET /api/sd/2fa/totp` → `{enabled, method}` (`enabled` is always `true`
  for a live session; `method` is `"totp"` or `"email"`).
- `POST /api/sd/2fa/email/request` -- **email-method accounts only**: sends a
  fresh code to use as `code` below (there's nothing to compute locally the
  way an app does). `not_found`/400 for a totp-method or unenrolled account.
- `POST /api/sd/2fa/totp/disable {password, code}` -- `code` is the current
  TOTP/email code (fetched via the endpoint above, for email) or an unused
  recovery code. Disabling doesn't turn 2FA _off_ for the account -- the next
  login re-triggers step 1 above (fresh enrollment, method chosen again via
  `mfaMethod`), which is the intended way to move to a new device or method.
- `POST /api/sd/2fa/totp/recovery/regenerate {password, code}` →
  `{recoveryCodes:[...10 fresh strings]}`, invalidating every previously
  issued code (e.g. after a user suspects theirs leaked).

All of these share the login envelope (`{"ok":true,"data":{...}}` /
`{"ok":false,"error":{"code","message"}}`) and the same error codes table as
the rest of `sd_http` (`unauthenticated` 401, `otp_invalid` 401,
`totp_required` 401, `invalid_credentials` 401, `weak_password` 400,
`already_enabled`/`not_found` 409/404, `rate_limited` 429).

**Locked out** (no phone, no email access, no recovery codes, no live
session): there's no self-service recovery by design -- same posture as a
forgotten password. An operator clears the account's enrollment with
`redis-cli HDEL sd:totp <username>` (mirrors the existing `HDEL sd:cred
<username>` password reset in "Debugging cookbook" below); the next login
re-triggers enrollment from scratch (method chosen again via `mfaMethod`).

## Testing

Five suites (333 checks), all plain Node scripts (Node 22+), all driving a
**real running backend over real HTTP/WebSocket**. Use scratch Redis DBs
(never 0); the Sandesh suites need an **empty** DB because first-run setup
happens once per DB. Each server needs its own terminal (or clear the `$env:`
lines between runs) and its own pair of ports.

```powershell
# 1. plain chat + "Sandesh is inert in open mode"   (44 checks)
$env:REDIS_DB="12"; .\run.ps1 5556 8081
node test/integration_test.mjs 8081

# 2. the whole Sandesh layer, strict mode            (198 checks)
redis-cli -n 13 FLUSHDB
$env:REDIS_DB="13"; $env:SANDESH_MODE="strict"; $env:SANDESH_DEV_OTP="1"
$env:SANDESH_OTP_COOLDOWN_SEC="0"; $env:CHAT_RATE_LIMIT_MAX="1000"; $env:SANDESH_SCHEDULER_TICK_MS="500"
.\run.ps1 5557 8082
node test/sandesh_test.mjs http://localhost:8082

# 3. the two-week login rule with short sessions     (13 checks)
redis-cli -n 10 FLUSHDB
$env:REDIS_DB="10"; $env:SANDESH_MODE="strict"; $env:SANDESH_DEV_OTP="1"; $env:SANDESH_OTP_COOLDOWN_SEC="0"
$env:SANDESH_SESSION_TTL_SEC="6"; $env:SANDESH_SESSION_CHECK_SEC="2"
.\run.ps1 5559 8084
node test/sandesh_session_test.mjs http://localhost:8084

# 4. TOTP two-factor: enrollment, login gating, replay/recovery  (31 checks)
redis-cli -n 14 FLUSHDB
$env:REDIS_DB="14"; $env:SANDESH_MODE="strict"; $env:SANDESH_DEV_OTP="1"; $env:SANDESH_OTP_COOLDOWN_SEC="0"
$env:CHAT_RATE_LIMIT_MAX="1000"; $env:SANDESH_SCHEDULER_TICK_MS="500"
.\run.ps1 5560 8090
node test/sandesh_totp_test.mjs http://localhost:8090

# 5. Password-admin-only, per-device trust, email 2FA          (41 checks)
redis-cli -n 15 FLUSHDB
$env:REDIS_DB="15"; $env:SANDESH_MODE="strict"; $env:SANDESH_DEV_OTP="1"; $env:SANDESH_OTP_COOLDOWN_SEC="0"
$env:CHAT_RATE_LIMIT_MAX="1000"; $env:SANDESH_SCHEDULER_TICK_MS="500"; $env:SANDESH_DEVICE_TRUST_SEC="6"
.\run.ps1 5561 8092
node test/sandesh_mfa_test.mjs http://localhost:8092
```

Suites 4 and 5 use a pure-JS RFC 6238 implementation to generate real codes
from the `secret` the API returns, so they genuinely exercise the wire format
(not just the Erlang-internal math). Suite 4 takes 1-2 minutes to run for
real (not mocked): the replay-protection checks deliberately wait for the
server's own 30-second window to advance before sending the next code, the
same way a real authenticator app would. Suite 5 verifies each distinct
device with its own recovery code instead (the TOTP secret's replay-guard
counter is shared across every device, so two real app-code checks that
close together would collide) and takes under 30s, mostly the two deliberate
`SANDESH_DEVICE_TRUST_SEC`-expiry waits.

(On the Windows dev laptop Redis runs inside WSL, so `redis-cli` is used from
the WSL terminal.) Run (1) after **any** change and before any push: it is the
guarantee that the minimal chat app keeps working. Run (2), (3) and (5) when
you touch `sd_auth`/`sd_totp`; run (4) too if you touch TOTP mechanics
specifically. Suite 2 covers notifications (per-category counts, live pushes,
read by category/id/`/read dm`, reminders firing, pending clearing when
answered, custom sections not silencing); suite 3 proves a session really ends
over REST and on an open WebSocket.

Verified by hand (not in the scripts, because they need clock or environment
manipulation): data survives a backend restart; an admin password older than
30 days forces a change; webhook delivery posts the same code the dev echo
shows; in open mode an invented token cannot borrow an admin's powers.

## Debugging cookbook

Every `/sd` failure has a stable `error.code`; an unexpected server error is
`internal` and the **full crash + stacktrace is in the backend log** at
`error` level (search for `sd_cmds … crashed` / `sd_http … crashed`). Set
`LOG_LEVEL=debug` to also see one line per `/sd` call (`sd <action> ok` /
`-> <code>`) — arguments are never logged (they can hold credentials).

| Symptom                                                              | Look at                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Sign in to Sandesh first" at connect                                | strict mode and the token isn't a live session. `GET /api/sd/session` with it; 401 ⇒ expired/invalid                                                                                                                                                                                                                                                                                                                                                                                        |
| `/sd …` → `unauthenticated` on a connected socket                    | the handshake token wasn't a valid session for _that exact username_ (case!), or it's an invented token. `/sd me` shows `authenticated`                                                                                                                                                                                                                                                                                                                                                     |
| DM refused, `code:"not_associated"` (strict)                         | no association: `/sd admin.user.get {username}` → `associates`; or `redis-cli HGETALL sd:assoc:<user>`                                                                                                                                                                                                                                                                                                                                                                                      |
| OTP (setup / admin-unlock / email 2FA) "never arrives"               | `SANDESH_OTP_MODE`: `log` ⇒ it's in the backend log (`sd_notify[otp] …`); `webhook` ⇒ check the gateway/`notify webhook` warnings; resend cooldown 30 s ⇒ `sent:false, retryAfter`. TOTP-method login codes never go through here at all -- see TOTP rows below                                                                                                                                                                                                                             |
| Can't log in / `locked`                                              | 5 failures ⇒ 15 min lock. Clear now: `redis-cli DEL sd:lf:<username>`                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A non-admin can log in with ANY (or no) password                     | Intended -- a password is checked only for admin accounts (`sd_users:is_admin/1`); see "Mandatory two-factor" above                                                                                                                                                                                                                                                                                                                                                                         |
| Every login from a client asks for a code, even seconds apart        | It's sending no `deviceId` and no `User-Agent` header (or a different one each time) -- the fallback fingerprint then never repeats, so no device is ever recognised as returning. Have the client send a stable `deviceId`                                                                                                                                                                                                                                                                 |
| User forgot the (admin) password                                     | An admin password is mandatory and there's no OTP-only fallback, so `HDEL sd:cred` alone would brick the account (no password ⇒ no session ⇒ can't call `/password/change`). From an Erlang remote console on the running node (`erl -remsh axi_chat_backend@<host> -sname ops -setcookie <cookie>`, or `rebar3 shell` against the same node): `sd_auth:issue_default_password(<<"username">>).` sets it back to `"Sandesh"+username` with `mustChangePassword`, same as the invite default |
| User locked out of 2FA (lost phone/email access + no recovery codes) | `redis-cli HDEL sd:totp <username>` — the next login re-triggers enrollment from scratch (method chosen again via `mfaMethod`); the password (admin accounts) is untouched                                                                                                                                                                                                                                                                                                                  |
| User needs to switch 2FA method (app ↔ email)                        | No dedicated endpoint -- disable the current one (`POST /2fa/totp/disable`) and the next login re-enrolls with whatever `mfaMethod` it's called with                                                                                                                                                                                                                                                                                                                                        |
| A device should be forgotten (e.g. reported stolen)                  | No per-device list to target individually today -- `redis-cli KEYS "sd:devtrust:<username>:*"` then `DEL` each hit revokes every device for that account at once (or wait out `SANDESH_DEVICE_TRUST_SEC`, default 14 days)                                                                                                                                                                                                                                                                  |
| Admin action → `admin_locked`                                        | strict: `admin.unlock.start` then `admin.unlock {password, otp}`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Approval never reached anyone                                        | `sd_reqs:approvers_for`: hosts whose `hostScope` covers the person, else administrators. `admin.user.get` on the host shows `hostScope`; `req.list {status:"all"}` shows `approvers`                                                                                                                                                                                                                                                                                                        |
| Live push didn't arrive                                              | pushes only go to _currently connected_ users; `req.list` / `cards.list` always have the data                                                                                                                                                                                                                                                                                                                                                                                               |
| `sd` reply never came                                                | shouldn't happen — even rate-limited commands reply (`rate_limited`). If it does: the connection dropped, or the frame exceeded 64 KB                                                                                                                                                                                                                                                                                                                                                       |
| Inspect a record                                                     | `redis-cli HGET sd:users <username>` (JSON), `HGETALL sd:cfg:departments`, `HGETALL sd:reqs`                                                                                                                                                                                                                                                                                                                                                                                                |
| Start over (dev only)                                                | flush the scratch DB; first-run setup can then run again                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Attach a shell (`erl -sname … -remsh …`, see `DEBUGGING.md` §3) and call the
modules directly, e.g. `sd_users:get(<<"priya">>).`, `sd_reqs:list_for(<<"priya">>, <<"all">>).`,
`sd_config:options_for(sd_users:get(<<"ravi">>)).`

## Behaviours worth knowing

- **Usernames** in Sandesh are lowercase `a-z 0-9 . _ -`, 2–24 chars. Chat
  identities are case-sensitive strings; Sandesh users always connect with
  the exact lowercase name.
- **Hosts** ("Is this user a host?") are employees. `hostScope` decides who
  they can approve and invite; an onboarding request goes to every covering
  host, or to the administrators if none cover the person. Whoever approves
  becomes the host. An admin who invites someone is that person's host.
- **Associations** are stored on both sides. A host link is removed when the
  host changes; an accepted `peer` link is kept.
- **Group approvals** happen at `/addmember`. The approved invitee is added
  even if offline (`chat_groups:force_add/3`).
- **Deactivation** drops the live connection immediately and blocks login;
  data is kept. Re-activation restores access (associations survive).
- **Cards** are recorded _after_ delivery, in a wrapper that swallows and
  logs errors — a Sandesh bookkeeping failure can never turn a delivered
  message into an error.
- The per-connection **rate limiter** is unchanged (30/10 s) but `/sd` calls
  it refuses now get a normal `/sd` reply, so a caller awaiting a `reqId`
  never hangs.

## Extending: add a `/sd` action

1. Add the action to `access/1` (and `user_actions/0`) in `sd_cmds.erl`.
2. Add a `do(<<"my.action">>, Args, Ctx) -> …` clause returning
   `{ok, Map}` or `{error, Code, Message}` (or `{error, Code, Message, Details}`).
   Data must be maps of binaries (`json:encode` treats a plain string as a
   list of integers). Put the logic in the relevant `sd_*` module.
3. Add checks to `test/sandesh_test.mjs`; document it in `docs/SANDESH_API.md`.

## Spec coverage

| Spec item                                                                                                                                              | Status                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User types: employees, external users, affiliate members, hosts                                                                                        | ✅                                                                                                                                                                                                                            |
| First login: org/user/email/mobile + OTP, first user = admin, admin can appoint admins                                                                 | ✅                                                                                                                                                                                                                            |
| Setup: branches, departments, designations, user categories (add/deactivate), affiliates (+branches)                                                   | ✅                                                                                                                                                                                                                            |
| Invite users (all listed attributes, host flag + scope, reporting manager)                                                                             | ✅                                                                                                                                                                                                                            |
| Self-registration → approval by the covering host                                                                                                      | ✅                                                                                                                                                                                                                            |
| Associations: message only your host; invite → accept/ignore/reject; host transfer; admin changes host                                                 | ✅ (enforced in strict mode)                                                                                                                                                                                                  |
| Groups: host creates; invitee's host approves                                                                                                          | ✅ (strict mode)                                                                                                                                                                                                              |
| Login by email/mobile; OTP first login + every 2 weeks                                                                                                 | ✅ · password required for admins only; everyone verifies with an authenticator-app OR emailed code, per-DEVICE every 2 weeks (a new device always asks, regardless of when the account last verified elsewhere) · **SSO ❌** |
| Admin console: listings, activate/deactivate (+reassign hosts), change host, add admin, password + OTP, monthly password reset                         | ✅                                                                                                                                                                                                                            |
| Application connections (name, URL, credentials)                                                                                                       | ✅ stored (credentials sealed) · calls to them ❌                                                                                                                                                                             |
| Lite TStruct (all 12 field types, sections, conditions, ranges)                                                                                        | ✅ definition, validation, submission                                                                                                                                                                                         |
| Options (all listed types) + "Applicable to"                                                                                                           | ✅ definition + per-user filtering · **execution ❌** (get data / download / upload / pay / Axpert options)                                                                                                                   |
| Home page: options section, associates, message cards in six sections + user-defined rules                                                             | ✅                                                                                                                                                                                                                            |
| Notifications: priority, pending, personal, reminders (counts, live push, read/clear, reminders fire when due)                                         | ✅                                                                                                                                                                                                                            |
| Ask the user to log in again every two weeks — **the app's own login, not ARM** (14-day hard session, live connection closed, optional `armSessionId`) | ✅ · _how the backend gets an ARM identity for Axpert calls is an open decision (below)_                                                                                                                                      |
| My Work Space                                                                                                                                          | client-side (as today)                                                                                                                                                                                                        |
| Message history sync to the Axpert DB; push notifications; SMS/email provider                                                                          | ❌ (unchanged from before; OTP channel is pluggable)                                                                                                                                                                          |

`docs/NEXT_STEPS.md` still describes the earlier "prompt engine" design; the
Sandesh spec replaced it with lite tstructs + options.

### Open decision: the backend's ARM identity

The app signs in with its own Sandesh login and the ARM sign-in page **has
been removed from the app** (PR #10, 24 Sep 2026; it survives only as the
on-demand `window.AxShowArmSignIn()`). `chat_arm` (Axpert reads/writes) needs an ARM session
`{token, ARMSessionId}` that the frontend used to forward at connect time. Now
the handshake stores the Sandesh token and `"app"` in `arm_identity`
(`chat_web:complete_registration_checked/4`), which ARM would reject. **Nothing
breaks today** — the only caller is `chat_hosts:refresh_department_hosts/1`,
which is a no-op until `CHAT_HOST_ADS_NAME` is set — but any future Axpert
feature (department hosts, "get data" options, prompt/list APIs, the daily
sync) needs one of: a backend **service account** for ARM, a **per-use ARM
sign-in** only when a person opens an Axpert-backed option, or an ARM-side
token exchange. See `API_GUIDE.md` Part 12.6 (project root, outside the repo)
for the trade-offs.
