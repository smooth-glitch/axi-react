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
[`../docs/CHAT_PROTOCOL.md`](../docs/CHAT_PROTOCOL.md) (plain chat) and
[`../docs/SANDESH_API.md`](../docs/SANDESH_API.md) (login, org, users, hosts,
approvals, cards, forms, admin console) and
[`../docs/HASH_COMMANDS.md`](../docs/HASH_COMMANDS.md) (the prompt bar's `#command`
menu) instead, not this file. Running,
configuring or debugging the Sandesh layer:
[`docs/SANDESH.md`](docs/SANDESH.md). The [root README](../README.md) has a full "start here, by role"
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
chat_cmds                 #commands (Discord-style prompt-bar menu): parses
                           and validates "#dm alice hi", rewrites it into the
                           existing "/msg ..." / "/sd ..." command, serves the
                           catalog + as-you-type suggestions. Stateless; adds
                           no permission logic of its own -- see
                           ../docs/HASH_COMMANDS.md
sd_*                      the Sandesh layer (org, users, hosts, approvals,
                           host-only messaging, cards, forms, admin console)
                           -- additive, off-by-default rules; see
                           docs/SANDESH.md
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

Optionally set `CHAT_ENCRYPTION_KEY` (32 random bytes, base64-encoded --
`openssl rand -base64 32`) to AES-256-GCM encrypt message text at rest in
Redis (see `chat_store.erl`'s "At-rest message encryption" section). Unset
means messages are stored in plaintext, same as before, with a startup
warning. This is at-rest only -- it doesn't change the WebSocket protocol
at all; clients still always receive plain, unencrypted text.

Optionally set `GIPHY_API_KEY` for GIF/sticker search (`/gifsearch`,
`/stickersearch`) to work -- unset just means that feature always returns
no results, logged once at startup.

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

For the Sandesh layer (strict mode, scratch Redis DB) see `docs/SANDESH.md`
"Testing" -- `node test/sandesh_test.mjs`.

For the `#command` layer: `rebar3 eunit --module=chat_cmds_tests` (no Redis
needed), `node test/hash_commands_test.mjs 8080`, and
`node test/hash_commands_strict_test.mjs` (strict mode) -- see
[`../docs/HASH_COMMANDS.md`](../docs/HASH_COMMANDS.md) "Testing".

Drives a real WebSocket connection through the full protocol (handshake,
DMs, groups, host directory, reactions, deletes, rate limiting) and
prints `N passed, N failed`. No dependencies beyond Node 22+ (uses the
built-in `WebSocket` global). Run this after any change before trusting
it works -- see `docs/DEBUGGING.md` for what it doesn't cover.

## Protocol

Full reference: [`../docs/CHAT_PROTOCOL.md`](../docs/CHAT_PROTOCOL.md).

Summary: connect with a JSON handshake (`{username, token}` -- `token` is
the session token from the app's own Sandesh login; `armSessionId` is optional
since the ARM sign-in page was removed), then the client sends plain-text
commands over the WebSocket (`/msg`, `/hostmsg`, `/react`, `/delete`,
`/setavatar`, ...) and receives JSON events back (`chat`, `history`, `hosts`,
`reaction`, `deleted`, `profile`, ...). See `src/chat_web.erl` for the full
command set, or the protocol doc for a complete table with example payloads.

Two layers sit on top of that, each with its own doc:

- **Sandesh** -- `/sd <action> {json}` and `/api/sd/*`: login, organisation,
  approvals, cards, forms, admin console ([`../docs/SANDESH_API.md`](../docs/SANDESH_API.md)).
- **`#commands`** -- the prompt bar's Discord-style action menu. Typing `#dm
  alice hi` is rewritten by `chat_cmds` into `/msg alice hi` (or a `/sd`
  action) and runs through the same code and permission checks; `/cmds` serves
  the catalog and `/cmdcomplete` the as-you-type suggestions
  ([`../docs/HASH_COMMANDS.md`](../docs/HASH_COMMANDS.md)). **Adding a backend
  feature? Give it a `#command` too** -- one entry in `chat_cmds:commands/0`.

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

- **WebSocket identity.** In `SANDESH_MODE=strict` the handshake token must be
  a live Sandesh session (issued by this backend, 14-day lifetime) for exactly
  the username being claimed. In the default `open` mode any non-empty token is
  accepted for **plain chat** only -- an invented token never gains Sandesh
  powers. The earlier ARM-token handshake was *not* independently verifiable
  (HMAC-signed JWT, no ARM secret here); see `docs/CHAT_PROTOCOL.md`'s
  "Connecting" section for the exact trust model, and
  `docs/SANDESH.md` for the strict-mode rules.
- **Per-connection rate limiting** (30 commands/10s) against flooding.
  The read-only `#command` helpers (`/cmds`, `/cmdcomplete`) have their own
  120/10s budget so as-you-type suggestions can't starve real commands.
- **`#commands` add no new privileges**: each is validated, then rewritten into
  the existing `/command` and run through the same policy checks. Arguments
  are bounded and control-character-free, Sandesh arguments are built as JSON
  (never string-pasted), and passwords/OTPs are deliberately not commands.
- **Per-IP rate limiting on `POST /upload`** (20 uploads/60s, `chat_upload_limiter.erl`) — behind nginx, keyed off the `X-Real-IP` header nginx sets, not the raw socket peer (which is always nginx itself in production/preview).
- **No TLS in this backend.** Plain `ws://`, not `wss://`, by design --
  see the comment in `chat_web.erl`'s module doc for why native TLS
  wasn't attempted here. **A reverse proxy (nginx) terminating HTTPS/WSS
  on the deploy VM is a hard requirement before real chat traffic**, not
  optional hardening.
- Redis has no password by default for local dev; a loud startup warning
  fires if a non-loopback `REDIS_HOST` has no `REDIS_PASSWORD` set.
- **Message text is AES-256-GCM encrypted at rest in Redis** when
  `CHAT_ENCRYPTION_KEY` is set -- protects against someone with raw Redis
  access (a leaked password, a backup file, `redis-cli HGETALL`) reading
  chat history. This is at-rest encryption, not end-to-end: the backend
  process itself still sees plaintext on every send/read, and every WS
  event a client receives is unencrypted, exactly as documented in
  `docs/CHAT_PROTOCOL.md`. Real E2EE would need the client to hold the
  keys and encrypt before sending -- the protocol already has a pubkey
  exchange for this (`/pubkey`, `/getpubkey`) but per the protocol doc it's
  only consumed by the iOS client today, not the web app.

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
