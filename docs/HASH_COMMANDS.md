# `#commands` — the chat prompt bar's action menu

Type `#` in the message box, pick a command from a list, and the chat does it —
like Discord's `/` menu. Every backend feature has a `#command`. This document
is everything the frontend needs to wire it in; **no frontend code changes were
made** — this is purely a backend feature plus this contract.

Source of truth: `axi-chat-backend/src/chat_cmds.erl` (the command table is
`commands/0` — the reference tables below are generated from it). If this doc
and the code disagree, the code wins.

---

## The idea in one paragraph

A `#command` line is **rewritten by the server into the existing `/command` it
stands for** and then runs through exactly the same code path, permission
checks, rate limit and length caps as if the client had sent that `/command`.
`#dm alice hi` *is* `/msg alice hi`; `#accept 12` *is*
`/sd req.respond {"id":12,"action":"accept"}`. So the events you get back are
the events you already handle — there is no new reply format to learn for
executing a command. The new pieces are only the **menu** (`/cmds`), the
**as-you-type suggestions** (`/cmdcomplete`) and **error replies** for a
malformed `#command`.

---

## Wiring it in — the 5 steps

1. **On connect (and again after a Sandesh sign-in/out), send `/cmds`.** You get
   one `cmd_catalog` event with every command, its arguments, its category and
   whether *this user* may run it right now. Cache it. (~15 KB; once per session.)
2. **When the input starts with `#`, show the menu.** Filter the cached catalog
   **locally** as they type — match the text after `#` against `name` and
   `aliases` (prefix match), group by `category`, show `summary`, and grey out
   (or hide) entries where `available` is `false` — `requires` says why
   (`signin` | `host` | `manage` | `admin`). Selecting one inserts `#name `.
3. **For the arguments, ask `/cmdcomplete`.** After a command is chosen, send
   `/cmdcomplete {"input":"<text up to the caret>","reqId":<n>}` (debounce ~150 ms)
   to get suggestions for the argument being typed — online users, your groups,
   department hosts, enum values. Replace the reply's `token` with the chosen
   `value`. Ignore replies whose `reqId` is stale. `kind:"text"` means "now
   typing free text — no suggestions".
4. **On Enter**, if the text is `#` + a word that is a `name` or `alias` in the
   catalog, **send the raw line as its own WebSocket frame** (do not wrap it, do
   not convert it to a `/command` yourself). Render the replies with the handlers
   you already have. If the first word is *not* in the catalog, treat the text
   as an ordinary message (see "Hashtags" below).
5. **Show errors.** A malformed command comes back as an `error` event with a
   machine-readable `code`; show `text`. Errors from the underlying command
   (`not_allowed`, `not_associated`, `No such user`, …) look exactly as they do
   today.

Minimal sketch:

```js
// 1. once per session
ws.send("/cmds");
ws.onmessage = e => { const m = JSON.parse(e.data);
  if (m.type === "cmd_catalog") catalog = m.commands;
  if (m.type === "cmd_suggestions" && m.reqId === lastReq) showSuggestions(m);
  /* ...your existing handlers... */ };

// 2 + 3. while typing
function onInput(text, caret) {
  if (!text.startsWith("#")) return hideMenu();
  const before = text.slice(0, caret);
  if (!before.includes(" ")) return showMenu(filterLocally(before.slice(1)));   // command name
  ws.send("/cmdcomplete " + JSON.stringify({ input: before, reqId: ++lastReq })); // arguments
}

// 4. on Enter
function onSend(text) {
  const word = (text.match(/^#([A-Za-z][\w-]*)/) || [])[1]?.toLowerCase();
  const known = word && catalog.some(c => c.name === word || c.aliases.includes(word));
  if (known) ws.send(text);          // raw #line, its own frame
  else sendAsNormalMessage(text);    // whatever you do today (/msg, /groupmsg, plain text...)
}
```

---

## Frames

### `/cmds [prefix]`  →  `cmd_catalog`

```json
{"type":"cmd_catalog","prefix":"#","escape":"##","filter":"",
 "categories":[{"id":"messaging","label":"Messaging"}, "..."],
 "commands":[{
   "name":"dm","aliases":["msg","pm"],"category":"messaging",
   "summary":"Send a direct message to someone",
   "usage":"#dm <user> <text...>",
   "args":[{"name":"user","type":"user","required":true},
           {"name":"text","type":"text","required":true,"rest":true,"max":2000}],
   "reply":["dm_ack"],
   "available":true,"requires":"none"}]}
```

- `/cmds re` returns only commands whose name/alias starts with `re` (`filter`
  echoes it). Usually you just filter the cached full list yourself.
- `args[].type`: `user` · `group` · `host` · `msgid` (number) · `emoji` · `url`
  · `word` · `enum` (has `values`) · `text` (has `rest:true` and `max`).
- `reply` lists the event `type`s the command normally produces (`sd` = the
  Sandesh envelope, see below). An empty list means "no direct reply".
- `available`/`requires` are **advisory** (for greying out). The server
  re-checks on every run, so a stale catalog can never grant access.
- JSON key order is not guaranteed — read fields by name.

### `/cmdcomplete {"input":"…","reqId":…}`  →  `cmd_suggestions`

```json
{"type":"cmd_suggestions","reqId":7,"input":"#dm al","kind":"arg","command":"dm",
 "token":"al",
 "arg":{"name":"user","type":"user","required":true,"index":0},
 "items":[{"value":"alice","label":"alice","hint":"online"}]}
```

- `kind`: `command` (still typing the name; items carry `value`, `label`
  `#name`, `hint` = summary, `usage`, `category`, `available`) · `arg` (items
  are candidates for the current argument) · `text` (typing free text — no
  items) · `none` (unknown command, or nothing more to type).
- `token` is the partial word being typed — replace it with the chosen `value`.
- The input is sent **inside JSON on purpose**: the server trims every incoming
  line, so a bare `/cmdcomplete #dm ` would lose the trailing space that means
  "now on the first argument". Max 512 bytes.
- Suggestions come only from data the user can already see (`/list`, `/groups`,
  `/hosts`) — this is not a directory search. Max 10 per reply (25 for commands).

### `#help [command]`

`#help` → the same `cmd_catalog`. `#help dm` → `{"type":"cmd_help","command":{…one entry…}}`.

---

## What comes back when you run one

| Kind of command | You get |
|---|---|
| Chat commands (`#dm`, `#groupmsg`, `#react…`, `#users`, …) | Exactly the events of the `/command` it stands for — see `CHAT_PROTOCOL.md`. The table's *Reply* column names them. |
| Sandesh commands (`#me`, `#cards`, `#accept`, …) | The normal `sd` envelope, with `reqId` set to `"#<name>"` so you can match it: `{"type":"sd","action":"cards.list","reqId":"#cards","ok":true,"data":{…}}` or `"ok":false,"error":{"code":…,"message":…}`. Codes include `unauthenticated`, `forbidden`, `admin_locked`, `session_expired`, `password_change_required`, `rate_limited`. See `SANDESH_API.md`. |
| A malformed `#command` | `{"type":"error","code":C,"text":…}` — `C` is `usage` (adds `command` and `usage`), `unknown_command` (adds `suggestions`: up to 5 close names), `invalid_encoding`, or `internal`. |

---

## Rules worth knowing

- **Arguments are space-separated, no quoting.** The **last** argument of a
  command marked `rest` (`text`) takes the whole remainder of the line, spaces
  and all: `#dm bob see you at 5` → user `bob`, text `see you at 5`.
  Extra spaces between arguments are ignored; **extra arguments are an error**
  (`#users now` → `usage`) rather than silently dropped.
- **Validation happens before anything runs**: numbers must be digits;
  usernames ≤ 24 chars, group names ≤ 32; no control characters (tab/newline)
  in a non-text argument; `#avatar` accepts only `http(s)://…` or `/uploads/…`;
  enums are matched case-insensitively. Whole line ≤ 2000 bytes, valid UTF-8.
- **Names are matched exactly** (case-insensitive). `#de` never runs
  `#delete` — prefixes are for the menu only.
- **Permissions are the same as the slash command's.** In `SANDESH_MODE=strict`,
  `#dm` still needs an association, `#creategroup` is host-only, broadcasting is
  admin-only, admin commands need the admin role **and** the console unlock. A
  `#command` can't do anything its `/command` can't.
- **Passwords and one-time codes are deliberately not commands.** Anything typed
  in the message bar can end up in history or on screen; the admin console
  unlock (`admin.unlock` — password + OTP) and login stay in their own forms.
- **Rate limits.** Running commands share the existing budget (30 per 10 s per
  connection). `/cmds` and `/cmdcomplete` have their own, larger budget (120 per
  10 s) so typing never starves real commands. Over the limit → the usual
  `Too many commands -- slow down` error.
- **Hashtags.** A `#` followed by a **letter** is treated as a command:
  a known one runs; an unknown one (`#urgent`) gets an `unknown_command` error
  instead of being posted (same rule the server already applies to `/typos`).
  A `#` followed by anything else (`#1 priority`, `# 5`) is ordinary text.
  To post a literal message that starts with `#` to the **global room**, send
  `##text` (the server posts `#text`). Only a frame that *starts with* `#` is
  ever interpreted: text your client sends as `/msg bob #urgent` or
  `/groupmsg team #urgent` is never touched. So in a DM or group view, send the
  raw line only when it is a real command (step 4) and send anything else the
  way you do today.
- **Context isn't implied.** `#react 12 👍` reacts in the *global* room;
  `#reactdm bob 12 👍` / `#reactgroup team 12 👍` name their scope. A client that
  knows the open conversation can pre-fill these after `#`.

---

## Command reference

Generated from `chat_cmds:commands/0`. `<x>` required, `[x]` optional,
`<x...>` = the rest of the line.

**Messaging**

| Command | Aliases | What it does | Reply |
|---|---|---|---|
| `#dm <user> <text...>` | `#msg`, `#pm` | Send a direct message to someone | `dm_ack` |
| `#host <host> <text...>` | - | Message a department host (HR, Finance, ...) | `host_ack` |
| `#reply <messageId> <text...>` | - | Reply to a message in the global room | `own_message_id` |
| `#replydm <user> <messageId> <text...>` | - | Reply to a message in a direct conversation | `dm_ack` |
| `#groupmsg <group> <text...>` | `#gm` | Send a message to a group | `group_msg_ack` |
| `#replygroup <group> <messageId> <text...>` | - | Reply to a message in a group | `group_msg_ack` |
| `#react <messageId> <emoji>` | - | React to a global-room message (toggles) | `reaction` |
| `#reactdm <user> <messageId> <emoji>` | - | React to a message in a direct conversation | `dm_reaction` |
| `#reactgroup <group> <messageId> <emoji>` | - | React to a message in a group | `group_reaction` |
| `#delete <messageId>` | - | Delete your own global-room message | `deleted`, `delete_denied` |
| `#deletedm <user> <messageId>` | - | Delete your own message in a direct conversation | `dm_deleted`, `delete_denied` |
| `#deletegroup <group> <messageId>` | - | Delete your own message in a group | `group_deleted`, `delete_denied` |
| `#gif [query...]` | - | Search GIFs | `gif_results` |
| `#sticker [query...]` | - | Search stickers | `sticker_results` |

**Look things up**

| Command | Aliases | What it does | Reply |
|---|---|---|---|
| `#users` | `#online`, `#who` | Who is online right now | `users` |
| `#hosts` | - | The host directory (AI hosts, workspace, departments) | `hosts` |
| `#groups` | - | The groups you are in | `groups` |
| `#inbox` | `#conversations` | Your direct-message threads, newest first | `conversations` |
| `#history` | - | Reload the global room's recent messages | `history` |
| `#historydm <user>` | - | Load your direct-message history with someone | `history` |
| `#historygroup <group>` | - | Load a group's recent messages | `history` |
| `#historyhost <host>` | - | Load your conversation with a department host | `history` |
| `#read <user>` | - | Mark a direct conversation as read |  |
| `#profile <user>` | - | See someone's avatar and status | `profile` |

**Groups**

| Command | Aliases | What it does | Reply |
|---|---|---|---|
| `#creategroup <name>` | `#newgroup` | Create a group (no spaces in the name) | `group_created` |
| `#addmember <group> <user>` | `#invitegroup` | Add an online user to a group you are in | `group_created` |
| `#leavegroup <group>` | `#leave` | Leave a group | `left_group` |

**Your profile**

| Command | Aliases | What it does | Reply |
|---|---|---|---|
| `#status <status...>` | - | Set your status line |  |
| `#avatar <url>` | - | Set your avatar (an http(s) link or an uploaded /uploads/ file) |  |

**People and approvals (Sandesh)**

| Command | Aliases | What it does | Reply |
|---|---|---|---|
| `#me` | `#whoami` | Your Sandesh account, permissions and counters | `sd` |
| `#associates` | `#contacts` | People you are connected with | `sd` |
| `#find <query...>` | `#search` | Find a person by username, email or mobile number | `sd` |
| `#connect <user...>` | - | Invite someone to be your associate | `sd` |
| `#disconnect <user>` | - | Remove an associate | `sd` |
| `#requests [status]` | `#approvals` | Your pending approvals and invitations | `sd` |
| `#accept <requestId>` | - | Accept a request or invitation | `sd` |
| `#reject <requestId>` | - | Reject a request or invitation | `sd` |
| `#ignore <requestId>` | - | Ignore a request or invitation | `sd` |
| `#myusers` | - | Users you host (hosts only) | `sd` |
| `#transfer <user> <toHost>` | - | Ask another host to take over one of your users (hosts only) | `sd` |

**Notifications and cards (Sandesh)**

| Command | Aliases | What it does | Reply |
|---|---|---|---|
| `#notifications [category]` | `#notifs` | Your notifications (unread first) | `sd` |
| `#markread <category>` | - | Mark notifications as read | `sd` |
| `#cards [section]` | - | Your message cards (optionally one section) | `sd` |
| `#dismiss <cardId>` | - | Dismiss a card (or "all") | `sd` |
| `#remind <text...>` | `#reminder` | Add a reminder card for yourself | `sd` |

**Forms (Sandesh)**

| Command | Aliases | What it does | Reply |
|---|---|---|---|
| `#forms` | `#options` | The forms and options available to you | `sd` |
| `#form <name>` | - | Open a form definition | `sd` |
| `#submissions` | - | Forms you have submitted | `sd` |

**Administration (Sandesh, admins only)**

| Command | Aliases | What it does | Reply |
|---|---|---|---|
| `#admin-org` | - | Organisation details and headline counts | `sd` |
| `#admin-users [query...]` | - | List or search all users | `sd` |
| `#admin-admins` | - | List administrators | `sd` |
| `#admin-affiliates` | - | List affiliates with their hosts and users | `sd` |
| `#admin-activate <user>` | - | Activate a user account | `sd` |
| `#admin-deactivate <user>` | - | Deactivate a user account (disconnects them) | `sd` |

**Help**

| Command | Aliases | What it does | Reply |
|---|---|---|---|
| `#help [command]` | `#commands` | List all # commands, or explain one | `cmd_catalog`, `cmd_help` |


---

## Adding or changing a command (backend)

Edit `commands/0` in `chat_cmds.erl` — one `cmd(...)` entry: name, aliases,
category, summary, argument specs, and what it rewrites to (`{line, Fun}` for a
`/command`, `{sd, <<"action">>, Fun}` for a Sandesh action). The catalog, the
suggestions, the validation, the usage strings and this table's source all come
from that one entry. Rules: names `[a-z][a-z0-9-]*`, unique across names and
aliases; a `text` argument must be last; never build a Sandesh action's JSON by
string-pasting — return a map, the module encodes it. Then run the tests below;
the unit tests check the whole table (unique names, text-last, every command
rewrites to a `/…` line).

## Testing

```bash
# unit tests (no Redis, no server):
rebar3 eunit --module=chat_cmds_tests            # or: .\tools\rebar3.cmd eunit --module=chat_cmds_tests

# end-to-end over a real WebSocket (server + Redis running, default open mode):
node test/hash_commands_test.mjs 8080          # smoke test + rate limits (needs the DEFAULT rate limit)
node test/hash_commands_full_test.mjs 8081     # every chat command + alias; fails if one is never executed
node test/hash_commands_edge_test.mjs 8081     # invalid UTF-8 on a raw socket, size limits, suggestion
                                               # ranking, 40-client concurrent burst
                                               # (full + edge: start the backend with CHAT_RATE_LIMIT_MAX=1000)

# strict Sandesh mode (needs a scratch, EMPTY Redis DB — see the file's header):
node test/hash_commands_strict_test.mjs http://localhost:8083   # every Sandesh command + alias, as admin/host/
                                               # employee: approvals, transfers, cards, forms, admin lock
```

The two `*_full`/`*_strict` runs end with a **coverage check that fails if any
command in the server's own catalog was never executed**, so adding a command
without a test turns the suite red.

Not covered: the raw TCP dev listener (`chat_client_handler`, port 5555) does not
know `#commands` — it is a separate, older dev-only protocol.
