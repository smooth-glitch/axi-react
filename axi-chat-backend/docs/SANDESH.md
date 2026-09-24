# Sandesh layer — backend notes

How the Sandesh spec (`Sandesh.docx`: organisation, users, hosts, approvals,
host-only messaging, cards, forms, admin console) is implemented on top of
the existing chat backend. The **frontend contract** is
[`../../docs/SANDESH_API.md`](../../docs/SANDESH_API.md); this file is for
whoever runs, debugs or extends the backend.

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

| Module | Job |
|---|---|
| `sd_util` | coercion, id/mobile/email normalisation & validation, random tokens, JSON in/out, sealing secrets, `mode()` |
| `sd_db` | Redis helpers (JSON documents in hashes, sets, sorted sets, rate limiter). Crashes the caller on Redis failure, like `chat_store:q_ok/1`; never logs values, only verb + key |
| `sd_org` | the org record + master lists (branches, departments, designations, categories, affiliates); first-run claim |
| `sd_users` | user records, indexes (email, mobile), validation, host scope matching, associations |
| `sd_reqs` | the four approval workflows as one "request" record: onboarding, associate, host_transfer, group_invite |
| `sd_auth` | first-run setup, OTP, passwords (PBKDF2-SHA256, 100k), sessions, lockout, admin-console unlock |
| `sd_policy` | **the** place strict mode is decided: handshake, DM, broadcast, group create/add, admin gate; plus safe post-send hooks |
| `sd_config` | lite tstructs, options + "applicable to", app connections, form validation & submissions |
| `sd_cards` | message cards, sections, classification, **notifications** (priority / pending / personal / reminders: unread state, counts, read, live pushes, due-reminder firing) |
| `sd_scheduler` | a small `gen_server` (supervised in `chat_app_sup`) that every `SANDESH_SCHEDULER_TICK_MS` (15 s) asks `sd_cards:fire_due/0` to notify due reminders |
| `sd_notify` | OTP/invite delivery channel (log / fixed / webhook) and live pushes to online users |
| `sd_http` | the REST endpoints |
| `sd_cmds` | the `/sd` WebSocket command dispatcher |

Touched existing files: `chat_web.erl` (route `/api/sd/`, handshake check with
optional `armSessionId`, `/sd` command, policy hooks on `/msg /replydm
/creategroup /addmember /groupmsg /replygroup` + plain broadcast, an after-`/read`
hook for notifications, two `ws_loop` clauses for pushes/forced disconnect, the
per-command session re-check for the two-week rule, `CHAT_RATE_LIMIT_MAX`),
`chat_groups.erl` (`force_add/3`), `chat_app_sup.erl` (starts `sd_scheduler`).

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `SANDESH_MODE` | `open` | `strict` enforces the spec's rules (see SANDESH_API §1) |
| `SANDESH_OTP_MODE` | `log` | how OTPs/invites are delivered: `log` (written to the server log — **dev only**), `fixed` (always `123456` — **demo only**), `webhook` |
| `SANDESH_NOTIFY_WEBHOOK` | — | URL for `webhook` mode. Receives `POST {"kind":"otp"\|"invite"\|"onboarding","to":{"name","email","mobile"},"text":"…","code":"123456"}` (`code` only for OTPs). Fire-and-forget, 8 s timeout, failures logged. Plug any SMS/email gateway here |
| `SANDESH_DEV_OTP` | unset | `1` ⇒ API responses echo the OTP as `devOtp`. **Never on a shared server** |
| `SANDESH_OTP_COOLDOWN_SEC` | `30` | resend cooldown per account/purpose; `0` disables (tests) |
| `SANDESH_SESSION_TTL_SEC` | `1209600` (14 days) | session lifetime — **fixed, not extended by activity** (the "log in again every two weeks" rule). Shorten only for tests |
| `SANDESH_SESSION_CHECK_SEC` | `30` | how often an open WebSocket re-checks its session (on its next command); when it has ended the client gets `sd_event session_expired` and the socket closes |
| `SANDESH_SCHEDULER_TICK_MS` | `15000` | how often due reminders are fired (a reminder is at most one tick late; min 100) |
| `SANDESH_SETUP_TOKEN` | unset | if set, `setup/start` must send it as `setupToken` — recommended on any reachable server, since first-run is claimable by whoever calls first |
| `SANDESH_CORS_ORIGIN` | `*` | `Access-Control-Allow-Origin` for `/api/sd/*`; restrict in production |
| `CHAT_RATE_LIMIT_MAX` | `30` | commands per 10 s per connection (existing limiter, now tunable) |
| `CHAT_ENCRYPTION_KEY` | unset | already used for message text; also seals stored app-connection credentials (without it they're stored with a `plain:` marker and a warning is logged) |
| `REDIS_HOST/PORT/PASSWORD/DB` | as before | unchanged |

`strict` with `SANDESH_OTP_MODE` = `log`/`fixed` logs a loud warning once:
anyone who can read the log can sign in as anyone.

## Before deploying this to the VM

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
   `CHAT_ENCRYPTION_KEY`, a Redis password, and HTTPS/WSS at nginx (tokens
   and OTPs travel over these connections).

## Redis layout (all under `sd:`; safe to inspect with `redis-cli`)

| Key | Type | Holds |
|---|---|---|
| `sd:org` | hash | `name`, `setup_done`, `created_ts`, `created_by` |
| `sd:cfg:<kind>` | hash | `branches`/`departments`/`designations`/`categories`/`affiliates`: lowercased name → JSON |
| `sd:users` | hash | username → user JSON (no credentials) |
| `sd:idx:email`, `sd:idx:mobile` | hash | email / mobile digits → username |
| `sd:cred` | hash | username → `{salt,hash,iter,setTs,mustChange}` (PBKDF2) |
| `sd:sess:<token>` | string, TTL 14 d | `{username,createdTs}` |
| `sd:unlock:<token>` | string, TTL 30 min | admin-console unlock |
| `sd:otp:<purpose>:<key>`, `sd:otpa:…`, `sd:otpcd:…` | string, TTL | OTP hash, attempt counter, resend cooldown (`purpose`: login/setup/unlock) |
| `sd:lf:<user>` | string, TTL 15 min | failed-login counter (lockout at 5) |
| `sd:rl:*` | string, TTL | per-IP/bucket rate limits |
| `sd:setup:pending` | string, TTL 15 min | the validated first-run profile awaiting its OTP |
| `sd:assoc:<user>` | hash | peer → `host`\|`user`\|`peer` |
| `sd:reqs`, `sd:reqs:u:<user>`, `sd:seq:req` | hash / set / counter | requests, per-user index, id counter |
| `sd:cards:<u>`, `sd:card:<u>` | zset / hash | card ids by time / card JSON (newest 500 kept; each card has `read`, and reminders `dueTs`) |
| `sd:reminders` | zset | future reminders: score = due time (ms), member = `user|cardId`; `sd_scheduler` claims entries with `ZREM` so none fires twice |
| `sd:sections:<u>` | string | the user's custom sections |
| `sd:tstructs`, `sd:options`, `sd:appconns` | hash | definitions (`credentials` sealed) |
| `sd:subs`, `sd:subs:u:<user>`, `sd:seq:sub` | hash / zset / counter | form submissions |

Chat data (`msg:*`, `conv:*`, `group:*`, `profile:*`, `known_users`,
`dm_partners:*`) is untouched.

## Testing

Three suites (255 checks), all plain Node scripts (Node 22+), all driving a
**real running backend over real HTTP/WebSocket**. Use scratch Redis DBs
(never 0); the two Sandesh suites need an **empty** DB because first-run setup
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
```

(On the Windows dev laptop Redis runs inside WSL, so `redis-cli` is used from
the WSL terminal.) Run (1) after **any** change and before any push: it is the
guarantee that the minimal chat app keeps working. Run (2) and (3) when you
touch `sd_*`. Suite 2 covers notifications (per-category counts, live pushes,
read by category/id/`/read dm`, reminders firing, pending clearing when
answered, custom sections not silencing); suite 3 proves a session really ends
over REST and on an open WebSocket.

Verified by hand (not in the scripts, because they need clock or environment
manipulation): data survives a backend restart; an admin password older than
30 days forces a change; a last-OTP older than 14 days makes a password-only
login return `otp_required`; webhook delivery posts the same code the dev
echo shows; in open mode an invented token cannot borrow an admin's powers.

## Debugging cookbook

Every `/sd` failure has a stable `error.code`; an unexpected server error is
`internal` and the **full crash + stacktrace is in the backend log** at
`error` level (search for `sd_cmds … crashed` / `sd_http … crashed`). Set
`LOG_LEVEL=debug` to also see one line per `/sd` call (`sd <action> ok` /
`-> <code>`) — arguments are never logged (they can hold credentials).

| Symptom | Look at |
|---|---|
| "Sign in to Sandesh first" at connect | strict mode and the token isn't a live session. `GET /api/sd/session` with it; 401 ⇒ expired/invalid |
| `/sd …` → `unauthenticated` on a connected socket | the handshake token wasn't a valid session for *that exact username* (case!), or it's an invented token. `/sd me` shows `authenticated` |
| DM refused, `code:"not_associated"` (strict) | no association: `/sd admin.user.get {username}` → `associates`; or `redis-cli HGETALL sd:assoc:<user>` |
| OTP "never arrives" | `SANDESH_OTP_MODE`: `log` ⇒ it's in the backend log (`sd_notify[otp] …`); `webhook` ⇒ check the gateway/`notify webhook` warnings; resend cooldown 30 s ⇒ `sent:false, retryAfter` |
| Can't log in / `locked` | 5 failures ⇒ 15 min lock. Clear now: `redis-cli DEL sd:lf:<username>` |
| Admin forgot the password | `redis-cli HDEL sd:cred <username>` — the admin can then sign in with an emailed OTP and set a new password (no old password needed when none exists) |
| Admin action → `admin_locked` | strict: `admin.unlock.start` then `admin.unlock {password, otp}` |
| Approval never reached anyone | `sd_reqs:approvers_for`: hosts whose `hostScope` covers the person, else administrators. `admin.user.get` on the host shows `hostScope`; `req.list {status:"all"}` shows `approvers` |
| Live push didn't arrive | pushes only go to *currently connected* users; `req.list` / `cards.list` always have the data |
| `sd` reply never came | shouldn't happen — even rate-limited commands reply (`rate_limited`). If it does: the connection dropped, or the frame exceeded 64 KB |
| Inspect a record | `redis-cli HGET sd:users <username>` (JSON), `HGETALL sd:cfg:departments`, `HGETALL sd:reqs` |
| Start over (dev only) | flush the scratch DB; first-run setup can then run again |

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
- **Cards** are recorded *after* delivery, in a wrapper that swallows and
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

| Spec item | Status |
|---|---|
| User types: employees, external users, affiliate members, hosts | ✅ |
| First login: org/user/email/mobile + OTP, first user = admin, admin can appoint admins | ✅ |
| Setup: branches, departments, designations, user categories (add/deactivate), affiliates (+branches) | ✅ |
| Invite users (all listed attributes, host flag + scope, reporting manager) | ✅ |
| Self-registration → approval by the covering host | ✅ |
| Associations: message only your host; invite → accept/ignore/reject; host transfer; admin changes host | ✅ (enforced in strict mode) |
| Groups: host creates; invitee's host approves | ✅ (strict mode) |
| Login by email/mobile; OTP first login + every 2 weeks | ✅ · **SSO ❌** |
| Admin console: listings, activate/deactivate (+reassign hosts), change host, add admin, password + OTP, monthly password reset | ✅ |
| Application connections (name, URL, credentials) | ✅ stored (credentials sealed) · calls to them ❌ |
| Lite TStruct (all 12 field types, sections, conditions, ranges) | ✅ definition, validation, submission |
| Options (all listed types) + "Applicable to" | ✅ definition + per-user filtering · **execution ❌** (get data / download / upload / pay / Axpert options) |
| Home page: options section, associates, message cards in six sections + user-defined rules | ✅ |
| Notifications: priority, pending, personal, reminders (counts, live push, read/clear, reminders fire when due) | ✅ |
| Ask the user to log in again every two weeks — **the app's own login, not ARM** (14-day hard session, live connection closed, optional `armSessionId`) | ✅ · *how the backend gets an ARM identity for Axpert calls is an open decision (below)* |
| My Work Space | client-side (as today) |
| Message history sync to the Axpert DB; push notifications; SMS/email provider | ❌ (unchanged from before; OTP channel is pluggable) |

`docs/NEXT_STEPS.md` still describes the earlier "prompt engine" design; the
Sandesh spec replaced it with lite tstructs + options.

### Open decision: the backend's ARM identity

The app signs in with its own Sandesh login and the ARM sign-in page is being
removed from the app. `chat_arm` (Axpert reads/writes) needs an ARM session
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
