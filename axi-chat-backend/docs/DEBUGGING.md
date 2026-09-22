# Debugging & Handover Guide

Written so someone with no prior context on this codebase — a new
teammate, or whoever inherits this after Arjun — can diagnose a problem
without having to read every module first.

## 1. Run the integration test suite first

Before debugging anything, confirm the basics still work:

```bash
# 1. Start Redis (see README.md if it's not already running)
# 2. Start the backend: .\run.ps1 (Windows) or the erl command in README.md
# 3. In another terminal:
node test/integration_test.mjs 8080   # or whatever port you started on
```

This drives a real WebSocket connection (two simulated clients) through
the actual protocol — handshake, DMs, groups, host messaging, reactions,
deletes, rate limiting — and prints `N passed, N failed`. If this fails,
you have a real, reproducible starting point instead of guessing from a
user's bug report. It does **not** cover file uploads, GIF/sticker search
(depends on Giphy's live API), the raw TCP dev listener, or anything with
more than 2 concurrent clients.

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
ids, Redis passwords, raw HTTP request/response bodies from ARM API calls.
If you're adding a new log line, keep it that way — log the *fact* that
something happened and its non-sensitive parameters (a username, a status
code), never the credential or payload itself.

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
redis-cli ZRANGE conv:global:msgs -10 -1   # last 10 message ids in the global room
redis-cli SMEMBERS groups                  # every group name
redis-cli HGETALL group:squad              # one group's owner/members
redis-cli GET next_msg_id                  # the message-id counter (see §6)
redis-cli HGETALL profile:arjun            # one user's avatar/status/pubkey
```

## 5. Common issues and what they look like

| Symptom | Likely cause | Where to look |
|---|---|---|
| Server won't start, `{error,eaddrinuse}` in the crash log | Something else is already using that port (often a frontend dev server on 8080) | Pick a different port, or find what's using it (`netstat -ano \| findstr :8080` on Windows) |
| Every command times out / nothing happens after connecting | Redis isn't running or isn't reachable | Check `redis-cli ping`; check `REDIS_HOST`/`REDIS_PORT` env vars match where Redis actually is |
| `chat_redis is connecting to '...' with NO PASSWORD SET` warning | Exactly what it says — `REDIS_PASSWORD` isn't set and the host isn't loopback | Set `REDIS_PASSWORD` before this points anywhere but a local dev Redis |
| A client gets `"Too many commands -- slow down"` during normal use | Legitimate rate limiting (30 commands/10s) tripped by something sending faster than a human types — check for a client-side bug sending duplicate commands, not a server bug | `?LOG_WARNING` fires in `chat_room`'s logs with the username |
| `/hostmsg` always errors "No such host" for every key including real department names | Expected until the backend dev's chat-host tstruct exists — see `chat_hosts.erl`'s `CHAT_HOST_ADS_NAME` placeholder | `docs/CHAT_PROTOCOL.md`'s "Host directory" section |
| ARM API calls (`chat_arm.erl`) always fail | Check the `?LOG_WARNING` for the HTTP status/reason (never the body) — could be network, could be an actually-invalid/expired token being forwarded from the frontend | `chat_arm.erl`'s `post_json/3` |
| A message's reactions/history look wrong after a server restart during testing | If this is a *fresh dev Redis* that predates the message-id fix (see `chat_store.erl`'s `save_message/6` comment on why it uses Redis `INCR`, not `erlang:unique_integer/1`), old test data may have colliding ids — `redis-cli FLUSHDB` to reset (never do this against real data) | `chat_store.erl` |

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
