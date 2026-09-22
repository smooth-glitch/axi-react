# AXI Chat Backend

> **Proprietary — All Rights Reserved.** Property of Agile Labs Private
> Limited, not open source — see [`../LICENSE`](../LICENSE).

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

Frontend devs integrating against this backend want
[`../docs/CHAT_PROTOCOL.md`](../docs/CHAT_PROTOCOL.md) instead, not this
file. The [root README](../README.md) has a full "start here, by role"
table if you landed here looking for something else (frontend setup, CI/CD,
the deploy VM).

## Contents

- [Architecture](#architecture)
- [Data flow](#data-flow)
- [Setup](#setup)
- [Protocol](#protocol)
- [Security posture](#security-posture-read-before-deploying-anywhere-real)
- [Deploy & infrastructure](#deploy--infrastructure)

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

## Deploy & infrastructure

Builds into a Docker image via `Dockerfile` (rebar3 compile, then run the
compiled beams directly with `erl`) -- useful for local container testing,
but **not** what actually ships to the team's VM; the real deploy path
below runs `rebar3` directly on the VM instead.

### Production

A push to `main` that touches `axi-chat-backend/**` runs
[`../.github/workflows/deploy-backend.yml`](../.github/workflows/deploy-backend.yml)
on a **self-hosted GitHub Actions runner installed on the deploy VM itself**
(`10.0.2.146`, office-network-only, unreachable from GitHub's cloud
runners -- the runner makes the outbound connection instead, so no inbound
firewall changes are needed). That workflow:

1. Checks out the repo, then runs `restorecon -R` on the checkout.
   **SELinux (Oracle Linux, enforcing) blocks executing binaries out of a
   user's home directory by default** -- the VM has a persistent fcontext
   rule for this checkout path, but `restorecon` still has to run after
   every fresh checkout to apply it to the newly-written files, or the
   build silently fails to execute.
2. Compiles with `rebar3` (`export PATH=/opt/erlang/27.3.4.18/bin:$PATH`
   first -- the runner's non-interactive shell doesn't inherit a login
   shell's PATH).
3. Restarts the `axi-chat-backend` systemd service.
4. Verifies it actually came back up by curling `http://127.0.0.1:8080/`
   directly (bypassing nginx) and checking for `404` -- that's the
   expected "no page-serving by design" response; anything else (`502`,
   connection refused) means the restart didn't bring a healthy backend
   up. Curling through nginx's `/` instead would say nothing, since that
   path now serves the React frontend build, not this backend.

On the VM, nginx is the single front door for real traffic: `/ws`,
`/upload`, and `/uploads/*` are routed to this backend; everything else
(the static frontend build) is handled separately -- see the root
README's [Infrastructure & deployment](../README.md#infrastructure--deployment)
section for the frontend side of this. Production always runs against
Redis logical DB `0`.

### PR previews

Every PR gets a fully isolated preview stack
([`preview-deploy.yml`](../.github/workflows/preview-deploy.yml)), torn
down on close
([`preview-cleanup.yml`](../.github/workflows/preview-cleanup.yml)), so
two branches can run side by side without colliding:

- Its own Redis logical DB, `1`-`15` (set via the `REDIS_DB` env var --
  see `chat_redis.erl`), assigned per preview slot.
- Its own backend process on its own port (`9000 + slot`), run via the
  systemd **template unit** `axi-chat-backend-preview@<slot>.service`,
  configured by a generated env file at
  `/etc/axi-chat-backend-preview/<slot>.env` (`REDIS_DB`, `PORT`,
  `LOG_LEVEL`, etc. -- see the workflow for the exact fields).
- Its own URL path, `/preview/<branch-slug>/`, with nginx routing
  `/preview/<slug>/ws`, `/upload`, and `/uploads/` to that slot's port,
  and everything else to that slot's frontend build.
- Slot numbers come from `/opt/preview/allocate-slot.sh` (a
  flock-guarded registry script on the VM) and are freed by the cleanup
  workflow when the PR closes.
- Reachable only from the office network/VPN -- the cleanup and deploy
  workflows post the preview URL as a PR comment.

**Security note:** `REDIS_PASSWORD` for preview instances is pulled from
a GitHub Actions secret and written into each slot's env file with
`chmod 640`, owner `root:opc` -- never hardcode a Redis password in a
workflow file or commit one to this repo. See
[Security posture](#security-posture-read-before-deploying-anywhere-real)
above for the rest of the security model.
