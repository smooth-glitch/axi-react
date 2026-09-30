# Frontend hand-off: `#commands` changes

Backend work is done (see `docs/HASH_COMMANDS.md` for the wire contract). This file
lists what the frontend still has to do. Notifications (`#notifications`, the
notification feed) are being handled separately and are **not** covered here.

**Deploy note:** none of this works until the updated `axi-chat-backend` is restarted
on the VM (new `chat_cmds`, `chat_names`, `chat_groups`, `chat_web`, `sd_config`,
`sd_cmds`).

Files you will mostly touch (all under `src/features/emberChat/`):
`data/hashCommandsCatalog.js`, `components/Composer.jsx`,
`components/CommandMenuPopup.jsx`, `EmberChatScreen.jsx` (`handleRouteHashCommand`).

---

## 1. The command set (what the menu shows)

The menu and the help modal show only the commands in `FRIENDLY_COMMAND_NAMES`
(`hashCommandsCatalog.js`):

| Group | Commands |
|---|---|
| Messaging | `#dm <user> <text>` · `#host <host> <text>` · `#groupmsg <group> <text>` |
| Look up | `#users` · `#hosts` · `#groups` · `#inbox` · `#profile <user>` |
| Groups | `#creategroup <name>` · `#addmember <group> <user>` · `#leavegroup <group>` |
| Profile | `#me` |
| People | `#associates` · `#find <query>` · `#connect <user>` · `#disconnect <user>` · `#requests [status]` · `#accept <id>` · `#reject <id>` |
| Cards | `#remind <text>` |
| T-Struct | `#tstruct <name>` (aliases `#ts`, `#struct`) · `#tstruct-add <name>` |
| Help | `#help [command]` |

**Removed everywhere (backend + catalog): `#gif`, `#sticker`, `#status`, `#avatar`,
`#cards`, `#delete*`, `#react*`, `#read`, `#markread`, `#dismiss`, `#ignore`,
`#myusers`.** Typing them now gives `unknown_command`.

**⚠ The frontend still calls four of the removed commands, so those screens are broken
until this is fixed.** They were removed from the *menu/typed* `#` layer, but the
underlying Sandesh actions (`/sd …`) still exist. Switch these calls to
`sandeshSocket.sd(action, args)` (it returns a promise: `{ok, data}` or
`{ok:false, error}`):

| Currently sends | Replace with | Result |
|---|---|---|
| `#cards [section]` (Cards modal; reply handler `reqId === "#cards"`) | `sandeshSocket.sd("cards.list", {section})` (omit `section` for all) | `data.cards` |
| `#dismiss <id>` (`onDismissCard`) | `sandeshSocket.sd("cards.dismiss", {id})` (`id: "all"` clears all) | `ok` |
| `#markread <category\|all>` (`onMarkRead` in Notifications modal) | `sandeshSocket.sd("notifications.read", cat === "all" ? {all: true} : {category: cat})` | `ok` — **notifications dev: please pick this up** |
| `#myusers` (Hosted Users modal) | `sandeshSocket.sd("host.users")` | `data` = hosted users |

`#transfer <user> <toHost>` still exists as a `#` command (used by Hosted Users). Also
the "Command: `#cards …` / `#markread …` / `#myusers`" hint text shown inside the
Cards, Notifications and Hosted Users modals mentions removed commands — reword it
(cards → `#remind <text>`).

TODO:
- Delete the dead branches for the removed commands in `handleRouteHashCommand`
  (`gif`, `sticker`, `status`, `avatar`, `cards`, `delete`, `deletedm`,
  `deletegroup`, `react`, `reactdm`, `reactgroup`, `read`, `markread`, `dismiss`,
  `ignore`, `myusers`) **after** moving the calls in the table above to `sd()`.
  Reactions, message delete and status use `/react`, `/delete`, `/setstatus`
  slash commands directly from the UI, which still exist and are unaffected.
- Aliases are optional to show. They still work when typed, but only as an **exact**
  word (`#pm` yes, `#p` no).

---

## 2. Paginated suggestions (`/cmdcomplete`)

`Composer.jsx` already sends `/cmdcomplete {"input", "reqId"}` (debounced 150 ms) and
listens for `cmd_suggestions`. Add paging:

Request — two new optional fields:
```json
/cmdcomplete {"input":"#tstruct ","page":2,"pageSize":10,"reqId":9}
```
Reply — new fields on every `kind:"command"` and `kind:"arg"` reply:
```json
{"type":"cmd_suggestions","kind":"arg","command":"tstruct","token":"",
 "items":[{"value":"Leave Request","label":"Leave Request","hint":"leave_request"}],
 "page":2,"pageSize":10,"total":37,"totalPages":4,"hasMore":true,"reqId":9}
```

TODO:
1. Keep `page` in Composer state. **Reset to 1 whenever the input text changes**;
   only change it from the pager.
2. Add a small pager under the suggestion list: "‹ Prev · 2 / 4 · Next ›" (or
   "Load more" using `hasMore`). Hide it when `totalPages === 1`. Show `total`
   ("37 forms") so the user knows how many there are.
3. Use `pageSize` 8–10 so the popup never crowds the screen (server caps at 25).
4. Ignore replies whose `reqId` is stale (already done) — this matters more now
   because paging fires requests quickly.
5. Paging never errors: an out-of-range page is clamped and `page` in the reply is
   the page actually returned — **render from the reply's `page`, not your own counter**.
6. An empty argument (`"#tstruct "`) returns *everything* available, page by page —
   that is the "browse all forms" experience. Typing filters (prefix matches first,
   then "contains").
7. Selecting an item: replace the `token` with the item's `value` (for tstruct that is
   the caption, spaces included — no quoting needed). Then add a trailing space only
   if another argument follows.

What lists: `#tstruct*` → the forms the user may open (caption shown, technical name
as `hint`); `#dm`/`#profile`/`#connect`… → online users; group args → the user's
groups; `#host` → department hosts. Suggestions are empty for free-text arguments
(`kind:"text"`).

**Two bugs in `Composer.jsx` that stop `#tstruct` (and multi-word names) from listing today**
(the server side is verified end to end: listing, paging, multi-word captions):
1. `const argIndex = parts.length - 2` counts *words*. For `#tstruct Leave Re` that gives
   argument index 1, which doesn't exist, so the menu closes. For arguments that take a
   multi-word name (`tstruct*` name, group, host) the argument index and `currentToken`
   must come from the server reply (`event.arg.index`, `event.token`), not from splitting on
   spaces. Simplest: always send `/cmdcomplete` with the full text and let the reply decide.
2. `setShowCmdMenu(locals.length > 0)` hides the menu when there are no *local* suggestions
   (there are none for tstructs), and the `cmd_suggestions` handler only calls
   `setArgSuggestions` — it never re-opens the menu. In that handler also call
   `setShowCmdMenu(true)` when `items.length > 0`, and set `currentArgSpec` from `event.arg`.
   Also handle an empty `items` reply by clearing the stale list.

Note: `computeLocalArgSuggestions` (instant local suggestions) will not know about
paging. Either drop it for `phrase`-style args (tstruct/group/host) or only use it as
a placeholder until the server reply arrives.

---

## 3. Multi-word names (T-Struct, groups, hosts)

Names with spaces now work end to end. Do **not** split these on whitespace yourself.

| Command | Rule |
|---|---|
| `#tstruct Leave Request` | whole rest of the line is the name (caption or technical name, any case) |
| `#tstruct-add Leave Request` | same |
| `#creategroup design team` | whole rest = group name (max 32 chars) |
| `#leavegroup design team` · `#historygroup design team` | whole rest |
| `#addmember design team bob` | last word = user, before it = group |
| `#groupmsg design team hello all` | longest **existing** group name that starts the text; else first word |
| `#host Human Resources need a form` | longest existing host key/name that starts the text; else first word |

TODO:
- `EmberChatScreen.jsx`: `handleRouteHashCommand` already has a `splitKnownName(kind)`
  helper for `#host`, `#groupmsg`, `#historygroup`, `#historyhost`, `#addmember`,
  `#leavegroup`, `#creategroup`. Check it against the real chat list (it matches
  against `chats`) and delete any remaining `parts[0]` use for group/host names.
- `#tstruct` and `#tstruct-add/-edit` open the viewer from the `sd` reply
  (`reqId "#tstruct"` etc.). The viewer path is now URL-encoded
  (`encodeURIComponent(tstruct.name)`) — keep that anywhere a name goes in a URL.
  The reply's `tstruct.name` is always the real technical name; use it, not what the
  user typed.
- `parseCommandLine` matches only the command word, so it is fine as is. But do not
  use `rest.split(/\s+/)` results for names.
- Group chat ids are `room-<name>`; names can now contain spaces, uppercase and
  punctuation. Check anything that builds/parses these ids or puts them in a URL or
  CSS selector.
- **New-group modal**: it used to force names to `lower_snake_case` (24 chars).
  That is already changed to keep spaces and allow 32 chars. Make sure the modal's
  own validation/hint text no longer says "no spaces".
- Server errors to show for group creation: "A group with that name already exists"
  and "That name is too close to an existing group's name (one starts with the other)".
  (A new name may not equal, start with, or be the start of an existing group name —
  otherwise `#groupmsg design team hi` would be ambiguous.)

---

## 4. Group admin (creator only can add members)

Whoever creates a group is its admin. Only they can add members; anyone else gets
`{"type":"error","code":"not_allowed","text":"Only the group admin (<name>) can add members"}`.

TODO:
- Show that error as a toast when it comes back from `#addmember` / `/addmember`.
- **Do not add the member to local state optimistically.** `#addmember` and the
  Members modal's `onAdd` currently update `groupMembersByName` and show
  "Added @x" before the server answers, so a non-admin sees a false success. Wait for
  the `group_created` event (it carries the full `members` list) and set state from it.
- Hide/disable "Add member" for non-admins. **The client cannot know who the admin is
  yet:** the `groups` / `group_created` events don't include the owner. Ask backend to
  add `"owner"` to both (small change) — until then, rely on the error above.
- If the admin leaves, nobody can add members (ownership does not transfer). Tell
  users this, or ask backend for a transfer rule.

---

## 5. Other commands that need real wiring

Backend commands whose UI is partly stubbed or optimistic in `handleRouteHashCommand`:

- **`#accept <id>` / `#reject <id>`** need a numeric request id. Users can't guess it.
  Best: on `#requests`, list pending items with their ids in the approvals panel and
  make Accept/Reject buttons send `#accept <id>` / `#reject <id>`; also suggest
  ids via `/cmdcomplete` if you want (backend currently returns none for ids).
  On `sd` reply (`reqId "#accept"` / `"#reject"`, `ok:true`) refresh the approvals list
  (already done for accept/reject).
- **`#requests [status]`** — `status` is one of `pending|all|accepted|rejected|ignored`
  (default pending). Autocomplete for it is served by `/cmdcomplete` (enum).
- **`#connect <user>` / `#disconnect <user>`** — show the `sd` result (ok/error) as a
  toast instead of assuming success; refresh `#associates` afterward.
- **`#find <query>`** — render the `users.search` result as a list with a
  "Connect" button (which sends `#connect <user>`).
- **`#me`** — the single profile command. Show account, role/permissions and counters
  in the profile modal (`sd` action `me`). Status / avatar are edited through the
  profile UI (slash commands), not `#` commands.
- **`#remind <text>`** — replaces `#cards`. Reply is `sd` action `reminder.add`;
  show the new reminder card in the cards/My Workspace view and toast on success.
- **`#inbox`, `#users`, `#hosts`, `#groups`, `#profile <user>`** — these produce
  `conversations`, `users`, `hosts`, `groups`, `profile` events; make sure each one
  opens or refreshes its panel rather than only toasting.
- **`#help [command]`** — `#help` returns the catalog; `#help dm` returns
  `{"type":"cmd_help","command":{...}}` (currently just toasted; a small help card
  with `usage` and `summary` would be better).

For every command: the reply is either the normal event for that feature or an
`error` event. Always surface `error.text`. Codes you will see:
`unknown_command` (has `suggestions`), `usage` (has `usage` and `command` — show the
usage line), `invalid_encoding`, `not_allowed`, `internal`.

---

## 6. Checklist / how to test

1. Type `#` → only the ~27 friendly commands appear; no gif/sticker/react/delete/etc.
2. `#tstruct ` → forms listed with a pager; page through; type to filter; pick one
   with a multi-word caption → viewer opens.
3. `#tstruct Leave Request` typed by hand (any case) → viewer opens; each
   record in the viewer has Edit / Delete buttons (delete asks for confirmation first).
4. `#creategroup design team` → group "design team" appears; `#groupmsg design team
   hi` posts to it; `#creategroup design` afterwards → "too close" error.
5. Second user: `#addmember design team carol` as non-admin → error toast, no local
   change. As the creator → member added.
6. `#host Human Resources hello` (use a real host name) → conversation opens.
7. `#gif`, `#react 5 x` → "unknown command" error is shown, nothing crashes.

---

# Part 2 — Backend features that are NOT wired to the frontend yet

Audit of backend vs. `src/services/sandeshSocket.js` + `EmberChatScreen.jsx`.
(Notifications are excluded — already in progress.)

## A. Profile picture (avatar) — **not wired at all**

Backend is ready; the frontend has no upload, no avatar setting, no `profile` event
handler, and no place that renders another user's picture (only `.avatar` CSS with
initials exist). Only `/setstatus` is used today.

**Backend pieces**
- **Upload:** `POST {apiBase}/upload`, `multipart/form-data`, one file part (any field
  name). Images or voice notes only, **max 8 MB**, and the file's real bytes must
  match its declared type. Rate-limited per IP (HTTP 429). No auth header needed.
  Success → `200 {"url":"/uploads/<random-name>"}`. Errors → `{"error": "..."}` with
  400 (bad request / no file), 413 (too large), 415 (not an image / type mismatch),
  429 (slow down).
- **Serve:** `GET {apiBase}/uploads/<name>`. The returned `url` is a *path*: prefix
  it with the API base (use the same https-aware base helper `sandeshApi.getBaseUrl()`
  as other calls) to build an `<img src>`.
- **Set:** WebSocket `/setavatar <url>` — `url` is the `/uploads/...` path from the
  upload (an `https://` link also works). Send only those two forms; the slash command
  itself does not validate the URL.
- **Read one user:** `/getprofile <username>` → `{"type":"profile","user","avatar","status"}`
  (`avatar`/`status` are `null` if never set).
- **Live updates:** whenever anyone calls `/setavatar` or `/setstatus`, every connected
  client receives `{"type":"profile","user":"bob","avatar":"/uploads/x.png"|null,"status":"..."|null}`.

**Frontend TODO**
1. Add a new helper (e.g. `uploadAvatar(file)` in `sandeshApi.js`). Do **not** reuse
   `sandeshFiles.uploadFile` — that posts the raw file to the Sandesh file store
   (`/files`, needs a token, different response). The chat upload is a
   `FormData` with the file appended, e.g.
   `fd.append("file", file); fetch(base + "/upload", {method: "POST", body: fd})`
   (do not set `Content-Type` yourself; the browser adds the boundary). Check
   client-side first (image type, ≤ 8 MB) and map 413/415/429 to readable errors.
2. In `ProfileModal`: add "Change photo" (file picker + crop/preview) and "Remove
   photo" (`/setavatar` with empty is **not** supported — ask backend if removal is
   needed). On success: upload → `/setavatar <url>` → update `currentUser.avatar` and
   `sandesh_session_user` in localStorage → toast.
3. In `EmberChatScreen` socket handler add `event.type === "profile"`: store
   `{avatar, status}` in a `profilesByUser` map keyed by username; update the chat
   list, message bubbles, headers, online-users, associates, members modals to render
   `<img>` when `avatar` exists, else the existing initials.
4. On sign-in/reconnect, request `/getprofile <user>` for people first shown in the UI
   (chat list, group members) that aren't in `profilesByUser` yet; cache to avoid
   repeated calls. Your own avatar/status: fetch with `/getprofile <you>` on connect
   so it survives a reload (today status is only kept in localStorage).
5. `#profile <user>` should open the user-profile modal from the `profile` event.
6. Always render avatar with `loading="lazy"`, a fixed size, and an `onError` fallback
   to initials.

## B. Other gaps found

| # | Backend feature | State in frontend | What to do |
|---|---|---|---|
| 1 | **Live profile updates** (`profile` event, status changes) | ignored | Handle as in A.3; also show other people's status text. |
| 2 | **GIF / sticker search** (`/gifsearch <q>` → `gif_results`; `/stickersearch <q>` → `sticker_results`) | `ContentPanel.jsx` uses a hard-coded Giphy list; server search is never called | Add a search box in the GIF/sticker panel that sends the slash command (debounced) and renders the results event; keep the static list as the empty-query default. |
| 3 | **Replies** (`/reply`, `/replydm`, `/replygroup` — persist `replyTo`) | UI keeps `replyTo` locally, but only plain `/msg`, `/groupmsg`, `/hostmsg` are sent, so reply links are lost on reload and for the other person | When `replyTo` is set send `/replydm <user> <id> <text>` / `/replygroup <group> <id> <text>` / `/reply <id> <text>` (global). Use the ids from `dm_ack`/`group_msg_ack`. There is no reply command for host chats. |
| 4 | **Link previews** (`link_preview`, `dm_link_preview`, `group_link_preview` events) | not handled | Attach `{id, preview}` to the message with that id and render a preview card under it. |
| 5 | **Group system messages** (`group_system`: "x added y to the group", "x left") | not handled | Render as a centered system line in the group. |
| 6 | **Host message ack** (`host_ack`) | not handled | Use it to mark host-chat messages as delivered (like `dm_ack`). |
| 7 | **E2E public keys** (`/getpubkey`, `/pubkey`, `pubkey` event) | not handled | Only needed if end-to-end encryption is planned — confirm with backend/product before building. |
| 8 | **Group admin owner** | `groups`/`group_created` don't carry the owner | Backend follow-up (add `owner`); see section 4 above. |
| 9 | **`#help <command>`** (`cmd_help`) | only toasted | Small help card with usage + summary. |
| 10 | **Paginated `/cmdcomplete`** | not sent/rendered | See section 2 above. |

## C. Sandesh (`/sd`) actions with no frontend caller

These exist on the server but nothing in `src/` calls them (some are reached only through
`#` commands, which is fine). Confirm each with the product owner before building UI:

- **Admin console:** `admin.appconn.list/save/delete` (application connections),
  `admin.unlock` / `admin.unlock.start` (unlock a locked user), `admin.host.reassign`,
  `admin.user.get`, `admin.tstruct.get`, `admin.admins.*` (partly used).
- **User-made options:** `option.user.list/save/delete` (users creating their own
  options) — no UI.
- **Lite T-Struct owner tools:** `tstruct.user.save/update/delete` — check whether the
  T-Struct designer uses them; `#tstruct*` covers only viewing/adding records.
- **Sections:** `sections.list/save/delete` — partly referenced; verify the admin UI
  covers save and delete.
- **Directory:** `users.search` (used via `#find`), `assoc.*` (via `#connect`,
  `#disconnect`, `#associates`) — fine as long as the `#` routes stay.

## D. Backend follow-ups the frontend will need

1. Add `owner` to `groups` and `group_created` events (group admin UI).
2. ~~Avatar removal~~ — done: `/removeavatar`.
3. Decide whether ownership transfers when a group admin leaves.
