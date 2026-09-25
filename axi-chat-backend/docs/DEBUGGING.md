# Debugging & Handover Guide

Written so someone with no prior context on this codebase — a new
teammate, or whoever inherits this codebase later — can diagnose a problem
without having to read every module first.

## 1. Run the integration test suite first

Before debugging anything, confirm the basics still work:

```bash
# Local dev:
# 1. Start Redis (see README.md if it's not already running)
# 2. Start the backend: .\run.ps1 (Windows) or the erl command in README.md
# 3. In another terminal:
node test/integration_test.mjs 8080   # or whatever port you started on

# Against a live deployment (prod or a preview slot):
node test/integration_test.mjs --url ws://10.0.2.146/ws
node test/integration_test.mjs --url ws://10.0.2.146/preview/<branch-slug>/ws
```

This drives a real WebSocket connection (two simulated clients) through
the actual protocol — handshake, DMs, groups, host messaging, reactions,
deletes, rate limiting — and prints `N passed, N failed`. If this fails,
you have a real, reproducible starting point instead of guessing from a
user's bug report. It does **not** cover file uploads, GIF/sticker search
(depends on Giphy's live API), the raw TCP dev listener, or anything with
more than 2 concurrent clients.

**Other suites** (each is a plain Node script driving a real server; details in
the file headers, `docs/SANDESH.md` "Testing" and `docs/HASH_COMMANDS.md`
"Testing"):

| Touched... | Run | Checks |
|---|---|---|
| anything | `node test/integration_test.mjs 8080` | 44 |
| `sd_*` | `node test/sandesh_test.mjs <url>` (strict mode, empty scratch DB) · `node test/sandesh_session_test.mjs <url>` | 198 · 13 |
| `chat_cmds.erl` or any command | `rebar3 eunit --module=chat_cmds_tests` (no Redis) | 38 |
| `chat_cmds.erl` or any command | `node test/hash_commands_test.mjs 8080` (default rate limit) | 48 |
| `chat_cmds.erl` or any command | `node test/hash_commands_full_test.mjs 8081` · `node test/hash_commands_edge_test.mjs 8081` (start the backend with `CHAT_RATE_LIMIT_MAX=1000`) | 78 · 59 |
| `chat_cmds.erl` or any `/sd` action | `node test/hash_commands_strict_test.mjs <url>` (strict mode, empty scratch DB) | 140 |

The `hash_commands_full` and `hash_commands_strict` runs end with a coverage
check that fails if a command in the server's catalog was never executed.
On the Windows dev laptop Redis lives in WSL: if `127.0.0.1:6379` is
unreachable from Windows (another Redis already owns the port in WSL), start a
throwaway one on another port and pass `REDIS_PORT` to `run.ps1`.

## 2. Reading the logs

This app uses OTP's built-in `logger` (not scattered `print` statements)
so log level controls verbosity without touching code:

```bash
LOG_LEVEL=debug ./run.ps1     # everything, including rejected handshakes and rate-limit hits
LOG_LEVEL=info  ./run.ps1     # default -- connect/disconnect events, warnings, errors
LOG_LEVEL=warning ./run.ps1   # quiet -- only warnings/errors (Redis misconfig, ARM API failures, rate limiting)
```

What you'll see at each level:
- **`info`** (default): every connect (`"<user> connected (N total online)"`) and disconnect, distinguishing a clean `/quit`/close from an unexpected process death (crash, network drop) — useful for spotting a pattern of dropped connections.
- **`debug`**: also shows rejected handshakes (bad payload, username taken) and rate-limit hits — noisy, but exactly what you want when chasing one specific connection's behavior.
- **`warning`**: Redis running with no password on a non-loopback host, ARM API call failures (HTTP status or network error — never the request/response body, since that could carry a token or real user data), rate limit violations.
- **`error`**: an unhandled crash in the HTTP/WS request handler (`chat_web.erl`'s `wait_for_socket/1`), including the exception class/reason/stacktrace.

To turn up verbosity for just one module on an already-running node (see
§3 for how to attach):
```erlang
logger:set_module_level(chat_web, debug).
```

**Never logged, anywhere in this codebase, by design:** ARM tokens/session
ids, Redis passwords, `CHAT_ENCRYPTION_KEY`, raw HTTP request/response
bodies from ARM API calls, and message plaintext. If you're adding a new
log line, keep it that way — log the *fact* that something happened and
its non-sensitive parameters (a username, a status code, a message id),
never the credential or payload itself.

Every Redis call in `chat_store.erl` now logs at `error` level (via its
`q_ok/1` helper) with the exact command that failed before the calling
process crashes on a genuine Redis outage — check for these first if
`chat_room`/`chat_groups` are restarting unexpectedly (§3's
`sys:get_state/1` will show a freshly-restarted, emptied state if so).

**`#commands`:** a normal run logs nothing above `debug` (`LOG_LEVEL=debug` adds
one line per command: `<user> ran #<name>` -- the name only, never the
arguments). An unexpected exception is logged as `chat_cmds crashed: <class>:<reason
tag> at {Module,Function,Line}` -- deliberately *without* the stacktrace
arguments, which could hold message text -- and the client gets an
`internal` error event. To reproduce a crash, run the same line in the
unit-test harness: `chat_cmds:run("#the line", "someuser")` returns
`{line, "/..."}` or `{reply, Json}` and needs no server.

**Sandesh layer:** `/sd` and `/api/sd/*` failures carry a stable
`error.code`; unexpected ones are `internal` with the full stacktrace in the
log (`sd_cmds … crashed` / `sd_http … crashed`), and `LOG_LEVEL=debug` adds
one line per `/sd` call (never the arguments). There is a symptom → cause
table, Redis inspection commands and admin-recovery steps in
[`SANDESH.md`](SANDESH.md#debugging-cookbook).

## 3. Attaching to a live node

By default this runs `-noshell` with no node name, which keeps things
simple for normal operation but means you can't attach to it. To debug a
running instance interactively, start it named instead:

```bash
erl -sname chatdebug -pa _build/default/lib/axi_chat_backend/ebin -pa _build/default/lib/eredis/ebin -s chat_app start 5555 8080
```

Then from another terminal on the same machine:
```bash
erl -sname debugger -remsh chatdebug@<hostname>
```

Once attached, useful things to inspect:
```erlang
sys:get_state(chat_room).    % who's online, right now
sys:get_state(chat_hosts).   % the cached department-host list
sys:get_state(chat_groups).  % all groups and their members
chat_room:list_users().      % same as the WS /list command, from the shell
```

## 4. Inspecting Redis directly

All persistent state lives in Redis as plain hashes/sets/sorted-sets —
nothing exotic, so `redis-cli` alone gets you a long way:

```bash
redis-cli HGETALL msg:42        # one message's full stored fields
                                 # (the "text" field reads as opaque base64
                                 # "v1:..." if CHAT_ENCRYPTION_KEY is set on
                                 # this deployment -- that's expected, see
                                 # chat_store.erl's encryption section; use
                                 # the WS protocol or /health, not redis-cli,
                                 # to check actual message content)
redis-cli ZRANGE conv:global:msgs -10 -1   # last 10 message ids in the global room
redis-cli SMEMBERS groups                  # every group name
redis-cli HGETALL group:squad              # one group's owner/members
redis-cli GET next_msg_id                  # the message-id counter (see §6)
redis-cli HGETALL profile:someuser         # one user's avatar/status/pubkey
```

## 5. Common issues and what they look like

| Symptom | Likely cause | Where to look |
|---|---|---|
| Server won't start, `{error,eaddrinuse}` in the crash log | Something else is already using that port (often a frontend dev server on 8080) | Pick a different port, or find what's using it (`netstat -ano \| findstr :8080` on Windows) |
| Every command times out / nothing happens after connecting | Redis isn't running or isn't reachable | Check `redis-cli ping`; check `REDIS_HOST`/`REDIS_PORT` env vars match where Redis actually is; `curl http://<host>:<port>/health` gives the same answer without needing shell access to the box |
| Message history shows `"[unable to decrypt message]"` for old rows | `CHAT_ENCRYPTION_KEY` changed, was removed, or a message was written by a different key (e.g. mixing a local dev key with the VM's) | `chat_store.erl`'s `decrypt_payload/1` — this is expected/non-fatal, only affects rows written under a key you no longer have; new messages are unaffected |
| GIF/sticker search always returns nothing | `GIPHY_API_KEY` isn't set | `?LOG_WARNING` fires once at startup from `chat_gif.erl`; set the env var to enable it |
| `chat_redis is connecting to '...' with NO PASSWORD SET` warning | Exactly what it says — `REDIS_PASSWORD` isn't set and the host isn't loopback | Set `REDIS_PASSWORD` before this points anywhere but a local dev Redis |
| The whole backend keeps restart-looping (repeated `Chat server: web UI on...` boot lines in the journal, every connected client dropped) | A *sustained* Redis outage — `chat_store.erl`'s `q_ok/1` crashes the calling process on every Redis failure, and `chat_app_sup`'s restart budget (20 restarts/60s — see its `init/1` comment) eventually exhausts under continued chat activity, taking the whole node down; systemd's `Restart=on-failure`/`RestartSec=5` then keeps retrying it every 5s until Redis actually comes back | Fix Redis first (`redis-cli ping`); this is the intended fail-safe behavior for an outage that doesn't resolve on its own, not a bug — a brief blip (a few seconds) should NOT trigger this, only a real outage |
| A client gets `"Too many commands -- slow down"` during normal use | Legitimate rate limiting (30 commands/10s) tripped by something sending faster than a human types — check for a client-side bug sending duplicate commands, not a server bug. `/cmds` and `/cmdcomplete` have a separate 120/10s budget; if *those* trip, the UI is firing a suggestion request per keystroke without debouncing | `?LOG_WARNING` fires in `chat_room`'s logs with the username |
| `POST /upload` returns `429 {"error":"Too many uploads -- slow down"}` | Legitimate per-IP upload rate limit (20/60s) tripped, OR every client is being seen as the same IP (check nginx's `X-Real-IP` is actually being set for `/upload` — see `chat_web.erl`'s `client_ip/2`; if it's missing, every request behind that proxy falls back to the proxy's own IP and shares one limit) | `?LOG_WARNING` fires in `chat_web`'s logs with the IP; `chat_upload_limiter.erl` |
| A `#word` a user typed didn't post and they got `unknown_command` | Working as designed: `#` + a letter is a command, and an unknown one is an error (like an unknown `/typo`), so `#urgent` never posts by accident. `##urgent` posts the literal `#urgent` to the global room; `#1`/`# 5` (non-letter after `#`) are ordinary text. The frontend should only send a raw `#line` if its first word is in the catalog | `chat_web.erl` `handle_line` `#` clauses; `docs/HASH_COMMANDS.md` "Hashtags" |
| A `#command` returns `usage` even though it looks right | Validation is stricter than the old commands: numeric ids only, username ≤ 24 / group ≤ 32 chars, no tab/newline inside a non-text argument, extra arguments are an error, `#avatar` needs `http(s)://` or `/uploads/`. The error carries `usage` and a `text` saying which argument | `chat_cmds:commands/0` (the arg specs), `convert/3` |
| `/cmds` says `available:false` / `requires:"signin"` for a Sandesh command | The connection has no Sandesh session (open-mode chat with an invented token) or the user lacks the role. Advisory only — running it returns the real `sd` error. `admin_locked` means the admin console isn't unlocked yet (strict mode); it is a runtime state so the catalog still shows admin commands as available to admins | `sd_cmds:availability/2` |
| A `#command`'s Sandesh reply never arrives | Match on `reqId`, which is `"#<canonical name>"` even when an alias was typed (`#whoami` -> `"#me"`). A malformed one gets a plain `error` event instead (no `sd` envelope) | `chat_cmds:exec/3` |
| `/hostmsg` always errors "No such host" for every key including real department names | Expected until the backend dev's chat-host tstruct exists — see `chat_hosts.erl`'s `CHAT_HOST_ADS_NAME` placeholder | `docs/CHAT_PROTOCOL.md`'s "Host directory" section |
| ARM API calls (`chat_arm.erl`) always fail | Check the `?LOG_WARNING` for the HTTP status/reason (never the body) — could be network, could be an actually-invalid/expired token being forwarded from the frontend | `chat_arm.erl`'s `post_json/3` |
| A message's reactions/history look wrong after a server restart during testing | If this is a *fresh dev Redis* that predates the message-id fix (see `chat_store.erl`'s `save_message/6` comment on why it uses Redis `INCR`, not `erlang:unique_integer/1`), old test data may have colliding ids — `redis-cli FLUSHDB` to reset (never do this against real data) | `chat_store.erl` |
| A PR's preview never gets a URL comment / preview 404s at its path | Check the `Deploy preview` Actions run's logs for the actual failure — most likely a build error in that branch's code. If the run succeeded but the URL still 404s, check `cat /opt/preview/slots.tsv` on the VM for that branch's assigned slot, then `systemctl status axi-chat-backend-preview@<slot>.service` | `.github/workflows/preview-deploy.yml`, `/opt/preview/` on the VM |
| Preview slots seem to be piling up / running out (max 15) | A PR that never got closed (or was closed without the cleanup workflow running) leaves its slot allocated forever | `cat /opt/preview/slots.tsv` to see what's allocated; `/opt/preview/teardown-slot.sh <branch-slug>` to manually free one |

## 6. Why message ids come from Redis, not the Erlang VM

`erlang:unique_integer/1` resets to 1 on every VM restart. Redis data
survives restarts. If ids came from the VM counter, a restart would reuse
ids already stored in Redis, silently corrupting history (see the git log
for the message-id fix commit for the full explanation). Ids come from
Redis's own `INCR next_msg_id` instead, which is safe across restarts by
construction. If you ever see message ids that look wrong (way lower than
expected, or a "message from the future" in an old thread), this counter
is the first thing to check (`redis-cli GET next_msg_id`).

## 7. Mobile client readiness

The protocol (`docs/CHAT_PROTOCOL.md`) is plain WebSocket + JSON with no
browser-specific mechanisms — no cookies, no `Origin` header checks, no
assumptions about a DOM or `fetch`. Any native WebSocket client (iOS
`URLSessionWebSocketTask`, Android `OkHttp`/`okhttp-ws`, React Native's
built-in `WebSocket`) can connect and speak the exact same protocol a
browser does, unchanged.

**What is NOT covered, and needs a product decision before a real mobile
app ships:** push notifications. A WebSocket only delivers messages while
the app is actively connected — a backgrounded or force-quit mobile app
won't see them. Real mobile chat apps solve this with APNs (iOS) / FCM
(Android) push, which means: a way to register/store each user's device
push token, and a hook (probably in `chat_room.erl`'s message-delivery
paths) to fire a push when the recipient isn't currently connected. This
is genuinely unbuilt — don't assume it exists.
