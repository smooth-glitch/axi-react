# AXI Chat Backend

Erlang/OTP real-time chat backend for the [`axi-react`](..) app. Handles
online presence, 1:1/group message routing, and Redis-backed persistence
over a hand-rolled WebSocket server -- `axi-react` is the only frontend
this talks to.

## Architecture

```
chat_app / chat_app_sup   entry point + supervisor (restarts any crashed piece)
chat_redis                supervised Redis connection (via eredis)
chat_room                 gen_server: online-user registry, routes DMs/broadcasts
chat_groups               gen_server: group membership + message routing
chat_web / chat_web_listener   hand-rolled HTTP + WebSocket server
chat_store                Redis persistence: messages, groups, profiles
chat_arm                  ARM API client (reads Axpert data via the same
                           REST endpoint axi-react's login already uses)
chat_gif / chat_link_preview   Giphy search, link-preview fetching
```

Each connected user is its own lightweight Erlang process -- one user's
connection crashing never affects anyone else's.

## Data flow

- **Messages/groups/profiles** live in Redis (`chat_redis.erl`/
  `chat_store.erl`) as the live server-side store.
- **Directory/host/prompt data** (associates, chat hosts, external users)
  comes from the ARM API via `chat_arm.erl`, using the same
  `{token, ARMSessionId}` the frontend already holds after its own ARM
  sign-in -- this backend never sees a password or signs in itself.
- A separate once-daily job pushes each user's Redis data to the real DB
  via the ARM API's `AXput` once that endpoint is available; the browser's
  IndexedDB is the first place a client restores history from, falling
  back to Redis and then that DB only when IndexedDB has nothing.

## Setup

### 1. Install Erlang/OTP

Free, official installer: https://www.erlang.org/downloads

### 2. Install and start Redis

```bash
# WSL/Linux
sudo apt install redis-server
sudo service redis-server start
```

Defaults to `127.0.0.1:6379`, no password -- override via `REDIS_HOST`/
`REDIS_PORT`/`REDIS_PASSWORD` env vars (see `chat_redis.erl`).

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

## Protocol

No REST API for chat itself -- the client sends plain-text commands over
the WebSocket (`/msg`, `/reply`, `/react`, `/delete`, `/setavatar`, ...)
and receives JSON events back (`chat`, `history`, `reaction`, `deleted`,
`profile`, ...). See `src/chat_web.erl` for the full command set.

Separately, `POST /upload` and `GET /uploads/<name>` handle image/voice
attachments (multipart upload, magic-byte content-type verification,
random server-generated filenames).

## Deploy

Builds into a Docker image via `Dockerfile` (rebar3 compile, then run the
compiled beams directly with `erl`) for deployment to the team's VM, with
push-to-`main` auto-deploy -- see the CI/CD section of
`../docs/NEXT_STEPS.md`.
