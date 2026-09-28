# Lite TStruct — how it works (backend owner's notes)

This is my own reference for the "Lite TStruct" feature (small in-chat forms:
leave requests, tickets, vitals, whatever an admin defines) — what's built,
where it lives, and how the pieces fit. Written so I can explain the
architecture without re-reading the source every time.

Status: **fully built, fully tested, Redis-backed.** Verified 28 Sep 2026 by
compiling for real, running it against a live Redis, and running the
198-check `sandesh_test.mjs` suite end to end — 198/198 passed, including
all 19 TStruct-specific checks. Confirmed with `redis-cli` too, so this
isn't just "the code exists," it's "I watched it write real rows to Redis
and read them back correctly."

---

## 1. The three concepts

| Term | What it is | Example |
|---|---|---|
| **TStruct** | A form *definition*: a name + a list of fields | `leave_request` = from_date, to_date, kind, days... |
| **Option** | A button the user sees ("Options section" above chat) that points at *something* — a TStruct, an upload, a download, etc. | "Apply for leave" → type `data_input`, target `leave_request` |
| **Submission** | One filled-in form, submitted by a user | Ravi's leave request for Oct 1–3 |

The reason these are separate: a TStruct only becomes visible to a user if
some **Option** points at it *and* that Option's "Applicable to" rule
includes them. A form existing isn't enough — someone has to be *offered*
it. This is deliberate (see §4) and is enforced server-side, not just hidden
in the UI.

## 2. Where the code lives

```
sd_config.erl   — defines, validates, stores, and reads back TStructs,
                  Options, and Application Connections. All the actual
                  logic (field validation, condition evaluation, "who
                  can see this") is here. No network/protocol code.

sd_cmds.erl     — the `/sd <action> {json}` dispatch table. Thin wrappers
                  that pull args out of the request and call sd_config.
                  Also where permission LEVELS are declared (user vs admin).

sd_db.erl       — generic Redis helpers (HSET/HGET/etc as JSON, INCR for
                  ids, sorted sets). Every sd_* module goes through this
                  instead of touching chat_redis directly.

chat_redis.erl  — the actual Redis connection (via eredis), supervised,
                  auto-reconnecting. One shared connection for the whole
                  app, not just this feature.
```

Nothing feature-specific lives in `chat_redis.erl` — that module doesn't
know TStructs exist. It's just the pipe. `sd_config.erl` is where I'd go to
change behaviour; `sd_cmds.erl` is where I'd go to add a new action or
change who's allowed to call it.

## 3. What's stored in Redis, and how

Everything is a Redis **hash**, one field per record, value = JSON. No SQL,
no separate tables — this is intentional, matches how the rest of `sd_*`
stores things.

| Redis key | What's in it | Field → Value |
|---|---|---|
| `sd:tstructs` | every form definition | `<lowercased name>` → `{name, caption, description, fields[], sections[]}` |
| `sd:options` | every option (button) | `<lowercased id>` → `{id, caption, type, target, applicable, active, order}` |
| `sd:subs` | every submission ever made | `<numeric id>` → `{id, tstruct, by, host, values, ts}` |
| `sd:subs:u:<username>` | a sorted set (by submit time) of submission ids this user can see | member = submission id |
| `sd:seq:sub` | a plain Redis counter (`INCR`) | next submission id |
| `sd:appconns` | external system credentials (for options not yet wired up) | sealed/encrypted, never sent to clients |

Why `sd:subs:u:<username>` exists as its own key, separate from `sd:subs`:
when someone asks "show me my submissions," we need *their own* submissions
**plus** their host's users' submissions, sorted by time, without scanning
every submission that's ever been made. So on submit, the backend writes the
id into a sorted set for the submitter *and* their host (see `submit/3` in
`sd_config.erl`) — that's the fan-out. Reading is then one `ZREVRANGE`
instead of a table scan.

I confirmed this by hand after a real submission:

```
sd:tstructs  HGET leave_request        -> the form definition JSON
sd:subs      HGET 1                    -> the submission JSON
sd:subs:u:ravi   ZRANGE 0 -1           -> ["1"]
sd:subs:u:priya  ZRANGE 0 -1           -> ["1"]   (priya is ravi's host)
sd:seq:sub   GET                       -> "1"
```

That's real persistence — if the Erlang node restarts, all of this is still
there, because none of it lives in process memory.

## 4. The permission model (why a user can't just ask for any form)

Two separate gates, both server-side:

1. **Can you even see the button?** `options_for(User)` filters
   `sd:options` by the option's `applicable` rule (category, department,
   branch, designation, or affiliate). This is what `options.list` returns.
2. **Can you fetch the form itself?** `tstruct_for_user(User, Name)` checks
   that *one of the user's own visible options* is a `data_input` pointing
   at that exact TStruct name. Admins bypass this (they can preview any
   form). Everyone else gets `forbidden` if they try to fetch a form no
   option of theirs points at — even if they know the exact name.

This means a user can't discover forms by guessing names, and an admin
building a new form + option pair doesn't need to separately manage "who's
allowed to fetch this" — it falls straight out of who can see the option.

## 5. Field types and validation (all server-side, client can trust it)

Twelve field types: `text`, `date`, `time`, `wholenumber`, `number`,
`email`, `url`, `mobile`, `location`, `list`, `selection`, `fill`. Each has
its own `check_type/3` clause in `sd_config.erl` — e.g. `date` checks both
the `YYYY-MM-DD` shape *and* that the date actually exists
(`calendar:valid_date/3`), then an optional min/max range; `mobile` can
require a country code; `list` can be single or multi-select and only
accepts values from its own `options[]`.

**Conditions** — a field or section can say "only show me if `kind` equals
`Sick`" (`{field, op, value}`, or `{all:[...]}` / `{any:[...]}` to combine
several). This does three things at once when a form is submitted:
- A hidden field is **not required**, even if it's marked required.
- A hidden field's value, if one was sent anyway, is **silently dropped**
  — it never reaches storage. (Tested: `doctor_note` sent while `kind` was
  `Casual` gets dropped from the stored submission.)
- Conditions can only reference fields that actually exist on the form —
  `admin.tstruct.save` rejects a definition with a dangling reference before
  it's ever stored.

**On submit**, every visible+required field with no value produces a
per-field error; every field gets type-checked; the whole thing comes back
as one `invalid_values` error with `error.details.fields = {fieldName:
message}` — not a single generic "bad request." Nothing is partially saved
on failure.

## 6. The five actions

| Action | Who | Does |
|---|---|---|
| `options.list` | any user | the buttons *this* user is allowed to see |
| `tstruct.get` | any user (if their options allow it) / any admin | fetch one form's definition |
| `tstruct.submit` | any user (if their options allow it) | validate + store a submission |
| `submissions.list` | any user | their own submissions + their hosted users' |
| `admin.tstruct.list/get/save/delete` | admin only | manage form definitions |

`admin.option.*` and `admin.appconn.*` are the same pattern, for the
buttons and the (not-yet-executed) external-system connections — not
TStruct-specific but part of the same "admin-configurable content" module.

One deliberate guard: `admin.tstruct.delete` refuses with `in_use` if any
option still targets that form. You have to remove/repoint the option
first. Stops a form disappearing out from under an option that still
advertises it.

## 7. What this does *not* do

- It doesn't execute anything against an external system. `data_input` (a
  TStruct form) is fully live; `get_data`, `download`, `upload`, `pay`, and
  the `axpert_*` option types are defined, stored, and filtered the same
  way, but actually *running* them needs the Axpert/ARM contract and a
  payment provider, neither of which is fixed yet. Not a gap in this
  feature — a documented "not built" boundary (see `SANDESH_API.md` §9).
- It doesn't render anything. That's the frontend's job entirely — this
  module hands back a JSON field-list; nothing here knows about React.

## 8. One thing to watch operationally

`admin.appconn.save` seals credentials with AES-256-GCM using
`CHAT_ENCRYPTION_KEY` — but if that env var isn't set, it falls back to
storing them as `plain:<json>` in Redis (with a loud warning in the log,
not silently). I saw this myself during testing because I hadn't set the
key. Not a bug — it's a deliberate local-dev fallback — but it means: any
Redis instance that isn't throwaway/local needs `CHAT_ENCRYPTION_KEY` set,
or appconn credentials sit in Redis in cleartext.
