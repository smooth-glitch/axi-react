# AXI Chat Backend — WebSocket Protocol

What the frontend team builds the frontend chat UI against today. Source
of truth is `axi-chat-backend/src/chat_web.erl` — if this doc and the code
ever disagree, the code wins; flag it to the backend owner to fix the doc.

**Scope note, read this first:** this documents the real-time messaging
transport plus the host directory — connect, DM, group chat, host
messaging, reactions, typing, uploads. The **directory itself** is real
today (`/hosts` lists the fixed preconfigured hosts always, per the boss's
spec) but **department hosts are empty until the backend dev creates the
chat-host tstruct** — the mechanism is wired end-to-end, there's just
nothing configured to return yet. The **prompt engine**
(List/Input/Upload/Download/Payment/OTP as a configurable per-host
interaction unit) doesn't exist at all yet — that's separate, future work
(Phase 3+ in `NEXT_STEPS.md`).

---

## Connecting

1. Open a WebSocket to the backend.
   - **Local dev** (running `axi-chat-backend` standalone, no nginx in
     front): `ws://localhost:8080` — root path, no prefix.
   - **On the deploy VM** (behind nginx, which also serves this frontend's
     build at `/`): `ws://<vm-host>/ws` — nginx routes `/ws` specifically
     to the backend; `chat_web.erl` itself doesn't care what path a
     WebSocket upgrade arrives on, so this is purely nginx's routing
     choice, not a protocol detail. `/upload` and `/uploads/*` are routed
     the same way for file attachments.
   - Whatever environment you're in, the frontend needs to pick the right
     URL — this is not something the protocol itself can tell you at
     runtime.
2. The **first text frame you send must be JSON**, not a bare string:
   ```json
   {"username": "alice", "token": "<ARM token>", "armSessionId": "<ARM session id>"}
   ```
   `token` and `armSessionId` are exactly what you already have after
   your own ARM Signin (`session.token`/`session.armSessionId` in
   `shared/axi-standalone-bridge.js`) — forward them as-is, don't
   re-derive anything. `username` max 24 chars.
3. Server replies:
   - Success: `{"type":"welcome","name":"alice"}`, immediately followed by
     a `history` event for the global room (see below).
   - Failure: `{"type":"error","text":"..."}` — malformed/missing fields,
     empty/too-long username, or username already taken. Connection stays
     open, retry with a corrected payload on the same socket.

**Security note — read this before assuming more than it claims.** This
is **not** independent cryptographic re-verification of the token.
`ARMToken` is an HMAC-signed JWT (confirmed from the real `AXput` release
notes' worked example), which by construction can't be verified by
anyone without ARM's own signing secret — unlike the RS256 tokens the old
Ember project's Google/Apple sign-in could check against a public JWKS.
There's also no documented "verify this session" ARM endpoint to call
instead. What this buys: a connection now requires having actually gone
through a real ARM sign-in (the browser blocks the app until Signin
succeeds), rather than the previous behavior of accepting literally any
typed string as an identity. It does not confirm the token is *currently*
still valid — that only gets checked the first time it's actually used
for a real ARM API call.

Once connected, every message you send is a **plain-text command** (not
JSON); every message you receive is a **JSON event**. This is intentionally
asymmetric — commands are cheap to parse server-side, events are easy to
consume client-side.

---

## Commands you send (plain text, one per WS text frame)

| Command | Effect |
|---|---|
| `/list` | Server replies with `{"type":"users","list":[...]}` — currently-online usernames. |
| `/hosts` | Server replies with `{"type":"hosts","list":[...]}` — the full host directory (see "Host directory" below). |
| `/hostmsg <hostKey> <text>` | Send a message to a **department** host (see below — do NOT use this for `llm`/`workspace`-kind hosts). Reply: `host_ack` event, or an error if the host doesn't exist or has no one assigned yet. |
| `/msg <username> <text>` | Send a DM to another associate directly. Reply: `dm_ack` event, or an error if the user doesn't exist. |
| `/reply <messageId> <text>` | Reply to a message in the **global** room. |
| `/replydm <username> <messageId> <text>` | Reply to a message within a DM thread. |
| `/history global` | Re-fetch global room history (also sent automatically on connect). |
| `/history dm <username>` | Fetch DM history with that user. |
| `/history group <groupName>` | Fetch a group's history. |
| `/history host <hostKey>` | Fetch your history with a department host. |
| `/typing global` | Broadcast a typing indicator to the global room. |
| `/typing dm <username>` | Broadcast a typing indicator to that DM. |
| `/typing group <groupName>` | Broadcast a typing indicator to that group. |
| `/read dm <username>` | Mark a DM thread as read (triggers `dm_read` to the other party). |
| `/pubkey <base64Key>` | Publish your E2EE public key (for DM encryption support — currently only consumed by the iOS client's crypto, not yet by any web/React flow). |
| `/getpubkey <username>` | Fetch another user's public key. |
| `/setavatar <url>` | Set your avatar URL. Broadcasts a `profile` event to contacts. |
| `/setstatus <text>` | Set your status line. Same broadcast as above. |
| `/getprofile <username>` | Fetch another user's avatar/status. |
| `/gifsearch [query]` | Search GIFs (Giphy-backed). Reply: `gif_results` event. |
| `/stickersearch [query]` | Same, for stickers. Reply: `sticker_results`. |
| `/react global <messageId> <emoji>` | Toggle a reaction on a global message. |
| `/react dm <username> <messageId> <emoji>` | Toggle a reaction on a DM message. |
| `/react group <groupName> <messageId> <emoji>` | Toggle a reaction on a group message. |
| `/delete global <messageId>` | Delete your own message (sender-only, enforced server-side). |
| `/delete dm <username> <messageId>` | Same, for a DM. |
| `/delete group <groupName> <messageId>` | Same, for a group message. |
| `/creategroup <name>` | Create a group (you become the sole/owner member). Max 32 chars. |
| `/addmember <group> <username>` | Add an online user to a group you're in. |
| `/leavegroup <group>` | Leave a group. |
| `/groupmsg <group> <text>` | Send a message to a group. |
| `/replygroup <group> <messageId> <text>` | Reply within a group thread. |
| `/groups` | List the groups you're in. Reply: `groups` event. |
| `/quit` | Clean disconnect. |
| Anything else (no leading `/`) | Broadcast as a plain message to the **global** room. |

Messages are capped at 2000 chars — longer ones get an `error` event back
instead of being sent.

---

## Events you receive (JSON, one object per WS text frame)

Every event has a `"type"` field. Shapes below use `...` for fields that
mirror the command that triggered them.

| `type` | When | Key fields |
|---|---|---|
| `welcome` | Right after a successful handshake | `name` |
| `history` | On connect, or after `/history ...` | `scope` (`global`/`dm`/`group`/`host`), `with`/`group`/`host` (if scoped), `list`: array of message objects (see below) |
| `hosts` | Reply to `/hosts` | `list`: array of `{key, name, kind}` — see "Host directory" below |
| `host_ack` | Your `/hostmsg` was delivered | `host`, `status`, `id`, `ts` |
| `host_message` | You received a message via a department host | `host`, `id`, `ts`, `from`, `text`, `replyTo` |
| `chat` | Someone posted in the global room | `id`, `ts`, `from`, `text`, `replyTo` (int or `null`) |
| `private` | You received a DM | same shape as `chat` |
| `system` | A system notice (join/leave, etc.) | `text` |
| `group_message` | A group message | `group`, `id`, `ts`, `from`, `text`, `replyTo` |
| `group_system` | A group system notice | `group`, `text` |
| `added_to_group` | You were added to a group | `name`, `members` (array), `by` |
| `group_created` | Your `/creategroup` succeeded | `name`, `members` |
| `groups` | Reply to `/groups` | `list`: array of `{name, members}` |
| `users` | Reply to `/list` | `list`: array of usernames |
| `typing` | Someone's typing in global | `text` (the username) |
| `typing_dm` | Someone's typing in your DM | `from` |
| `group_typing` | Someone's typing in a group you're in | `group`, `from` |
| `dm_read` | Your DM was marked read | `from` |
| `dm_ack` | Your `/msg` was delivered | `with`, `status`, `id`, `ts` |
| `group_msg_ack` | Your `/groupmsg`/`/replygroup` was delivered | `group`, `id`, `ts` |
| `reaction` / `dm_reaction` / `group_reaction` | A reaction changed | `messageId`, `reactions`: array of `{user, emoji}`; DM/group variants add `userA`/`userB` or `group` |
| `profile` | Someone's avatar/status changed | `user`, `avatar` (or `null`), `status` (or `null`) |
| `deleted` / `dm_deleted` / `group_deleted` | A message was deleted | `messageId`; DM/group variants add `userA`/`userB` or `group` |
| `delete_denied` | Your `/delete` was rejected (not your message, or it doesn't exist) | `messageId`, `reason` (`"forbidden"` or `"not_found"`) |
| `own_message_id` | Echo of your own broadcast's assigned id/timestamp | `id`, `ts` |
| `link_preview` / `dm_link_preview` / `group_link_preview` | A pasted link's preview finished fetching | `messageId`, `previewUrl`, `previewTitle`, `previewDescription`, `previewImage` (all `""` if none) |
| `gif_results` / `sticker_results` | Reply to a search | `query`, `results`: array of `{id, url, preview, width, height}` |
| `pubkey` | Reply to `/getpubkey` | `user`, `key` (or `null`) |
| `left_group` | Your `/leavegroup` succeeded | (text payload, not JSON object — see `json_obj` vs `json_obj2` in source) |
| `error` | Any command usage error | `text` |

### Message object shape (inside a `history` event's `list`)

```json
{
  "id": 123,
  "ts": 1790071256909,
  "from": "alice",
  "text": "hello",
  "private": false,
  "reactions": [{"user": "bob", "emoji": "👍"}],
  "deleted": false,
  "replyTo": null,
  "previewUrl": "", "previewTitle": "", "previewDescription": "", "previewImage": ""
}
```

`ts` is epoch milliseconds (`erlang:system_time(millisecond)` at the
moment the message was saved) — this is what "Date & time" on a message
card and any month-grouping should be computed from.

History returns at most the last 50 messages for that conversation, oldest
first.

---

## Host directory

Per the boss's spec, the directory a user sees is **associates + hosts**.
Associates are just other online users (`/list`) — no separate concept
needed there yet since there's no "user master"/org-chart data source
wired up. Hosts come from `/hosts`, and are one of three `kind`s:

- **`"llm"`** (`openai`, `ai_router`, `claude`, `gemini`) and
  **`"workspace"`** (`workspace`, "My work space") — fixed, always
  present regardless of backend config, per spec. **Selecting one of
  these is a client-side-only concern** — per the boss's doc, it's "the
  same experience as today's AXI chat" (the existing Provider Switcher/
  Composer/MessageThread). **Do not** call `/hostmsg` for these — there's
  nothing on the backend to route to, since the LLM call itself doesn't
  go through this Erlang service at all.
- **`"department"`** (e.g. a future `hr`, `finance`) — configured chat
  hosts (HR, Finance, IT Support, etc. per the spec's "Chat host tstruct").
  **Currently always an empty list** — the backend dev hasn't created the
  chat-host tstruct yet, so there's nothing to populate this with. The
  mechanism (`/hostmsg`, `/history host`, message routing, resolving a
  host to whichever person/group is currently assigned) is fully wired
  and tested end-to-end — it just has no real hosts to resolve to yet.
  Calling `/hostmsg` for a host key that doesn't exist (which, right now,
  is any department host key at all) gets you back an `error` event.

Once the chat-host tstruct exists, department hosts will start appearing
in `/hosts`'s response with no frontend changes needed — the shape
(`{key, name, kind: "department"}`) is already final.

A department-host conversation threads separately from an ordinary DM
with whoever currently happens to be assigned to that host — if HR's
assigned person changes later, your history with "HR" stays intact rather
than splitting.

---

## File uploads (separate from the WS protocol — plain HTTP)

- `POST /upload` — multipart/form-data, one file field. Images
  (png/jpeg/gif/webp) and voice notes (webm/ogg/mp4 audio), max 8MB.
  Returns `{"url": "/uploads/<random-name>"}` on success. Content-type is
  verified against the file's actual magic bytes, not just the declared
  header — a mismatch is rejected. Rate-limited per client IP (20
  uploads/60s) — a `429` with `{"error": "..."}` means slow down, same
  error shape as every other rejection on this endpoint (400/413/415).
- `GET /uploads/<name>` — serves it back. Supports HTTP Range requests
  (needed for `<audio>`/`<video>` elements to seek/preload correctly).

There's no `chat` command tying an uploaded file to a message yet — the
current pattern (inherited from the original single-page client this
protocol was built for) is: upload the file, get the URL back, then send
that URL as the `text` of an ordinary `/msg`/`/groupmsg`/broadcast. Worth
revisiting once the frontend's actual attachment UX is designed.

---

## Health check (ops use, not for the frontend)

- `GET /health` — plain HTTP, no WS upgrade. Returns JSON:
  `{"status": "ok"|"degraded", "redis": "ok"|"unreachable", "uptime_ms": N}`,
  with HTTP 200 when `status` is `"ok"` and 503 when `"degraded"` (Redis
  unreachable). Meant for `curl`/uptime monitors/ops, not something the
  chat UI calls — nothing about the frontend's flow depends on this route.

---

## What's deliberately NOT here yet

- Real department hosts — the directory mechanism exists (`/hosts`,
  `/hostmsg`, host-scoped history/routing) but has nothing configured
  until the backend dev creates the chat-host tstruct (see "Host
  directory" above).
- An associate directory beyond "who's currently online" — no user-master/
  org-chart data source exists yet either.
- Prompts (List/Input/Upload/Download/Payment/OTP) as a configurable
  interaction unit.
- Independent cryptographic verification of the ARM token on connect
  (see the security note under "Connecting" for exactly what this does
  and doesn't guarantee).
- Month-grouping itself — `history` returns a flat, most-recent-50 list.
  Every message now carries `ts` (epoch ms), so the client has what it
  needs to compute month groups itself; the backend doesn't pre-group.

These land once the backend dev's `AxExternalUsers`/chat-host/prompt
tstructs exist and `chat_arm.erl` has real data to read — see
`NEXT_STEPS.md` Phase 3 and Section 8.
