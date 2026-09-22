# AXI Chat Backend

Erlang/OTP real-time chat backend for the [`axi-react`](..) app. Handles
online presence, associate DMs, group chat, and the associate+host
directory over a hand-rolled WebSocket server, with Redis-backed
persistence -- `axi-react` (and, in the future, a mobile client using the
same protocol) is the frontend this talks to.

**New here? Read [`docs/DEBUGGING.md`](docs/DEBUGGING.md) first** -- it
covers running the test suite, reading logs, attaching to a live node,
inspecting Redis directly, and the most common failure modes. This
README covers setup and architecture; that doc covers "something's wrong,
where do I look."

## Architecture

```
chat_app / chat_app_sup   entry point + supervisor (restarts any crashed piece)
chat_redis                supervised Redis connection (via eredis)
chat_hosts                host directory: fixed preconfigured hosts (LLM/
                           workspace) + department hosts (from the ARM API,
                           once the backend dev's chat-host tstruct exists)
chat_room                 gen_server: online-user registry, routes DMs/
                           broadcasts/department-host messages
chat_groups               gen_server: group membership + message routing
chat_web / chat_web_listener   hand-rolled HTTP + WebSocket server
chat_store                Redis persistence: messages, groups, profiles
                           (message ids from Redis INCR, not the VM's own
                           counter -- see chat_store.erl's save_message/6
                           doc comment for why that matters)
chat_arm                  ARM API client: reads (GetList/AxList) and
                           writes (AXput via ARMPushToQueue) Axpert data,
                           using the {token, ARMSessionId} the frontend
                           already holds after its own ARM sign-in
chat_gif / chat_link_preview   Giphy search, link-preview fetching
```

Each connected user is its own lightweight Erlang process -- one user's
connection crashing never affects anyone else's. Logging is via OTP's
`logger` throughout (see `docs/DEBUGGING.md` §2), not scattered print
statements -- `LOG_LEVEL=debug` on startup for verbose output.

## Data flow

- **Messages/groups/profiles** live in Redis (`chat_redis.erl`/
  `chat_store.erl`) as the live server-side store.
- **Directory/host/prompt data** (associates, chat hosts, external users)
  comes from the ARM API via `chat_arm.erl`, using the same
  `{token, ARMSessionId, username}` the frontend already holds after its
  own ARM sign-in -- this backend never sees a password or signs in
  itself, and a WebSocket connection requires having gone through a real
  ARM sign-in (see "Security" below).
- A separate once-daily job pushes each user's Redis data to the real DB
  via the ARM API's `AXput`/`ARMPushToQueue` mechanism (implemented in
  `chat_arm:put/2`) once the backend dev's target tstruct exists; the
  browser's IndexedDB is the first place a client restores history from,
  falling back to Redis and then that DB only when IndexedDB has nothing.

## Setup

### 1. Install Erlang/OTP 27+

Free, official installer: https://www.erlang.org/downloads. OTP 27+ is
required -- this app uses the built-in `json` module, which doesn't exist
in older releases.

### 2. Install and start Redis

```bash
# WSL/Linux
sudo apt install redis-server
sudo service redis-server start
```

Defaults to `127.0.0.1:6379`, no password -- override via `REDIS_HOST`/
`REDIS_PORT`/`REDIS_PASSWORD` env vars (see `chat_redis.erl`). A startup
warning fires automatically if `REDIS_HOST` isn't loopback and no
password is set.

### 3. Build & run

**Windows (PowerShell):**

```powershell
.\build.ps1
.\run.ps1
```

**macOS/Linux:**

```bash
./tools/rebar3 compile
erl -noshell -pa _build/default/lib/axi_chat_backend/ebin -pa _build/default/lib/eredis/ebin -s chat_app start 5555 8080
```

### 4. Verify it actually works

```bash
node test/integration_test.mjs 8080
```

Drives a real WebSocket connection through the full protocol (handshake,
DMs, groups, host directory, reactions, deletes, rate limiting) and
prints `N passed, N failed`. No dependencies beyond Node 22+ (uses the
built-in `WebSocket` global). Run this after any change before trusting
it works -- see `docs/DEBUGGING.md` for what it doesn't cover.

## Protocol

Full reference: [`../docs/CHAT_PROTOCOL.md`](../docs/CHAT_PROTOCOL.md).

Summary: connect with a JSON handshake (`{username, token, armSessionId}`
-- the same ARM credentials the frontend already has), then the client
sends plain-text commands over the WebSocket (`/msg`, `/hostmsg`,
`/react`, `/delete`, `/setavatar`, ...) and receives JSON events back
(`chat`, `history`, `hosts`, `reaction`, `deleted`, `profile`, ...). See
`src/chat_web.erl` for the full command set, or the protocol doc for a
complete table with example payloads.

Separately, `POST /upload` and `GET /uploads/<name>` handle image/voice
attachments (multipart upload, magic-byte content-type verification,
random server-generated filenames) -- plain HTTP, no WebSocket needed.

### Mobile clients

The protocol has no browser-specific assumptions (no cookies, no `Origin`
checks) -- any native WebSocket client (iOS, Android, React Native) can
connect and speak the identical protocol. **Not covered:** push
notifications for messages arriving while the app isn't actively
connected -- that needs APNs/FCM integration, which doesn't exist yet.
See `docs/DEBUGGING.md` §7.

## Security posture (read before deploying anywhere real)

- **WebSocket connect requires real ARM credentials** (`{username, token,
  armSessionId}`), not a claimable username -- but this is *not*
  independent cryptographic re-verification (`ARMToken` is an HMAC-signed
  JWT; we don't hold ARM's secret to check it ourselves). See
  `docs/CHAT_PROTOCOL.md`'s "Connecting" section for the exact trust
  model.
- **Per-connection rate limiting** (30 commands/10s) against flooding.
- **No TLS in this backend.** Plain `ws://`, not `wss://`, by design --
  see the comment in `chat_web.erl`'s module doc for why native TLS
  wasn't attempted here. **A reverse proxy (nginx) terminating HTTPS/WSS
  on the deploy VM is a hard requirement before real chat traffic**, not
  optional hardening.
- Redis has no password by default for local dev; a loud startup warning
  fires if a non-loopback `REDIS_HOST` has no `REDIS_PASSWORD` set.

Full audit trail and reasoning: see the git log (search for "Security
pass" and "spec audit") and `../docs/NEXT_STEPS.md`'s security checklist.

## Deploy

Builds into a Docker image via `Dockerfile` (rebar3 compile, then run the
compiled beams directly with `erl`) for deployment to the team's VM, with
push-to-`main` auto-deploy -- see the CI/CD section of
`../docs/NEXT_STEPS.md`.
