# Connectum backend: frontend integration guide

For Gunn and Anish. Everything here is **backend only and additive**: no existing action, field or reply shape changed, and
no frontend file was touched. New things simply appear next to the old ones.

All `/sd` calls use the existing protocol: send `/sd <action> {json, "reqId": "..."}` over the WebSocket, get
`{"type":"sd","action":..,"reqId":..,"ok":true,"data":{..}}` or `{"ok":false,"error":{"code","message","details"?}}`.
Actions marked **admin** need an administrator (and the admin unlock in strict mode). Slow actions (data sources,
payments, wizard steps, custom commands) are answered by a worker, so the reply may arrive a little later and *never blocks
other requests*: match replies by `reqId`, never by order. When too many slow calls are in flight you get `error.code = "busy"`:
retry shortly.

Assumption: **one deployment = one enterprise**. A person who belongs to several enterprises keeps several server addresses
("channels"); the QR code carries the address.

---

## 1. Connectum codes and QR

| Action | Args | Returns |
|---|---|---|
| `connect.my` | – | `{person:{code,display,payload,url,name,username}, enterprise:{code,display,payload,url,name,location,categories,setupDone}}` |
| `connect.scan` | `{code}` | person code → `{type:"person",user,alreadyConnected}` (they become associates at once); enterprise code → `{type:"enterprise",enterprise,alreadyMember:true}` |
| `connect.rotate` | – | new personal code (old one stops working) |
| `connect.lookup` | `{code}` | who a code belongs to (signed in) |
| `GET /api/sd/connect/<code>` | public | `{type:"enterprise",enterprise:{...}}`. Personal codes answer "not found" so codes can't be harvested |

* Draw the QR from `payload` (a link `<SANDESH_PUBLIC_URL>/connect/<CODE>` when the server has a public URL, else `connectum:<CODE>`).
* Codes are 8 characters shown `XXXX-XXXX`. Typing is forgiving (case, spaces, dashes, O/0, I/L/1 all fine); send whatever the
  person typed.
* `POST /api/sd/register` accepts an optional `code` (the enterprise code). It must be right when given; with
  `SANDESH_REQUIRE_CODE=1` it is mandatory (`error.code = "code_required"`, bad one: `"invalid_code"`).
* On a scan the code owner gets a low-priority feed item and a live `associate_connected` event `{user, via:"code"}`.

## 2. Enterprise profile and registration form

* `GET /api/sd/public` now also returns `location` (`{city,country}` only) and `onboarding`:
  `{ "<Category>": {requireApproval, requiredFields:[...], welcome} }`. Use it to build the registration form: mark
  `requiredFields` mandatory for the chosen category and show `welcome` afterwards.
* Registration reply is unchanged plus `welcome`. `status` is `"pending"` (an approval request was raised) or `"active"`
  (the category needs no approval; `requestId:null`).
* `admin.org.set` accepts `name`, `location {address,country,city,pin}`, `contact {name,email,mobile}`. `admin.org.get` returns them plus `code`.
* More default categories: Service provider, Contract employee, Gig worker, Freelancer, Candidate.

**Onboarding processes (admin):** `admin.onboarding.list`, `admin.onboarding.save {category, requireApproval, approverRoles[], requiredFields[], welcome}`,
`admin.onboarding.delete {category}`; anyone: `onboarding.get {category}`. `requiredFields` may be `address, gender, dob, education, skills, branch, department`.
Missing details on registration → `invalid` with the missing names in the message.
Approvers holding `approverRoles` get the normal approval request (no host link is set when a non-host approves).

## 3. People: roles and personal details

* Roles: `admin.cfg.save {kind:"roles", item:{name}}` (also list/delete like the other kinds). Assign with `admin.user.update {username, roles:[...]}` / `users.invite`.
* `profile.get` / `profile.update {address, gender, dob, education, skills}`: `gender` = male|female|other|prefer_not_to_say (loose input is normalised),
  `dob` = `YYYY-MM-DD`, `skills` = list or comma text (≤30 × 40 chars). These are private (never in the public user card).
* User objects gain `roles` and the detail fields (private to the person and admins).

## 4. Options: roles, conditions, running

* Option `applicable` gains `roles:["Registrar"]`. Options gain `condition`: `{"field":"city","op":"eq","value":"Pune"}` or
  `{"all":[..]}` / `{"any":[..]}`; ops `eq ne gt lt gte lte in notempty`; fields are global variables (below).
* `option.run {id, values?, amount?}` (slow):
  * `get_data` → `{option, display, result}`; `display` is the option's `display`: `table` → `{columns, rows, total, truncated}`,
    `name_value` → `{pairs:[{name,value}]}`, `text` → `{text}`. The option's `target` must name a **data source** (§6), else `error.code="not_configured"`.
  * `pay` → `{payment}` (§7). `data_input` → `{open:"tstruct", target}`; `download`/`upload` → `{open:"download"|"upload", target}` (use the existing file/tstruct calls).
  * Axpert types → `error.code = "not_supported"`.
* Pay options also store `amount`, `currency` (default INR), `description`, `verifyDatasource`. `options.list` shape is unchanged.

## 5. Global variables (drive conditions and data source parameters)

Built in: `userName, username, email, category, affiliate, branch, department, designation, city, country, pin, isHost`.
* `globals.list` → `{builtins, custom, values}` (instant, uses defaults).
* `globals.resolve` (slow) → `values` with data-source-backed variables resolved (falls back to defaults if the application is down).
* **admin** `admin.globals.save {name, default, description, datasource?, column?}` / `admin.globals.delete {name}`.

## 6. Applications and data sources (`#datasources`)

* `applications.list` → `[{name, commandLine}]` (no addresses or credentials). `applications.commands {name}` (slow) → `[{name,caption,description}]`.
* **admin** `admin.appconn.save {name,url,authType:none|basic|bearer,credentials,commandLine,allowUserDatasources,queryPath,commandsPath}`,
  `admin.appconn.test {name}` (slow), `admin.datasource.list`.
* `datasource.list / get {name} / save / delete {name}`, `datasource.run {name, values?, limit?}` (slow) → `{columns, rows:[{col:val}], total, truncated}`.
  * Definition: `{name, type:"sql"|"api", connection, sql | path+method(GET|POST), params:[{name,default?}], applicable?, description?}`.
  * SQL is SELECT/WITH only, one statement, no comments; `:name` placeholders are sent as **bound parameters**, never pasted in. A placeholder may be a
    parameter or a global variable name (filled from the caller's own details).
  * People may define personal data sources only on connections the admin opened with `allowUserDatasources`.
  * Errors to show nicely: `upstream_unavailable`, `upstream_timeout`, `upstream_denied`, `upstream_error`, `bad_response`, `too_large`, `rate_limited` (60/min).

## 7. Payments

`pay.create {option, amount?}` (slow), `pay.confirm {id, reference}` (slow), `pay.status {id}`, `pay.cancel {id}`, `pay.list {status?}`; **admin** `admin.pay.mark {id,status:"paid"|"failed",reference?}`.
States: `created → submitted → paid | failed`, `cancelled`. Live event `payment_updated {id,status}`. An enterprise system can settle by
`POST /api/sd/pay/webhook` with header `x-webhook-secret` (enabled by env `SANDESH_PAY_WEBHOOK_SECRET`). Sandesh holds no money: the UI should collect the payer's
reference (UPI id, receipt no.) and call `pay.confirm`.

## 8. Records list (`#list`)

`records.list {tstruct, q?, from?, to?, scope?:"mine"|"all", limit?(≤100, default 20), offset?}` → `{records, total, offset, limit, hasMore}`. People see their own; admins/hosts what they may see.
`q` matches any value (any case); `from`/`to` are epoch ms. Existing `submissions.list` is unchanged.

## 9. Catalog: products and services

`catalog.list {kind?, category?, q?, limit?, offset?}` → `{items, total, offset, limit, hasMore, categories}`, `catalog.get {kind,id}`.
**admin** `admin.catalog.save {kind:"product"|"service", id?, name, description, price, currency, unit, category, sku, tags, active}` (saving with an `id` replaces the item),
`admin.catalog.delete {kind,id}`. Inactive items are hidden from non-admins.

## 10. Wizards (`#wizard`)

* People: `wizard.list`, `wizard.get {name}`, `wizard.start {name}` (slow), `wizard.current {runId}` (slow, resume), `wizard.step {runId, step, value}` (slow),
  `wizard.cancel {runId}`, `wizard.runs`, `wizard.run {runId}` (owner, approvers, admins).
* **admin** `admin.wizard.list`, `admin.wizard.save {name, caption, description, applicable, condition, active, steps:[...]}`, `admin.wizard.delete {name}`.
* Every start/step/current reply is `{run:{id,wizard,caption,status,stepId,answers,...}, step:<what to draw> | null}`.
  `status` = running | waiting | done | rejected | cancelled. `step` is `null` once finished.
* `step` always has `{id,type,caption,number,of,waiting}`. Step types and what to send as `value`:

| type | draw | `value` |
|---|---|---|
| `input` | form from `fields`/`sections` (same as tstructs) | `{field: value}`; errors come as `error.details.fields{name:msg}` |
| `upload` | file picker (`accept` = extensions); upload first with `POST /api/sd/files` | the file id |
| `download` | `file {id,name,size,mime}` and/or `text`; download via `GET /api/sd/files/<id>` | anything (acknowledges) |
| `approval` | "waiting for approval" (`waiting:true`); nothing to send | – (answering gives `error.code="waiting"`) |
| `pay` | `amount`, `currency`, `description` | `{reference}` |
| `decision` | buttons from `choices` | one choice |
| `list` | `options:[{value,label}]`, `multi` | value, or list of values when `multi` |
| `summary` | `answers`; confirming ends the run | `{confirm:true}` |

* Steps can have a `condition` (over global variables and earlier answers: use the step id, or `stepId.field` for input fields): false → the step is skipped.
  The counter `number`/`of` is by position, so it can jump.
* Send the `step` id you were shown; an old one gives `error.code="stale"`.
* Approval steps raise a normal **approval request** (`type:"wizard"`, `data:{runId,stepId,wizard,message}`) for people with the given roles/designations
  (both given = must have both; nobody matches → admins). The approver's inbox already lists it: show `data.message`, let them open `wizard.run {runId}` to see the answers
  and the uploaded file, then `req.respond` as today. The owner gets a live `wizard_updated {runId,status}` event.
* Errors: `not_found` (unknown/not for you), `waiting`, `stale`, `already_finished`, `too_many` (20 open runs), `payment_not_found`.

## 11. Custom `#` commands

`cmd.list` → `{commands, kinds}`, `cmd.save {name, kind, target, summary?, applicable? (admin only), active?}`, `cmd.delete {name}`.
`kind`: `option | wizard | tstruct | list | datasource | catalog` (`target` = option id / wizard / tstruct / tstruct / data source / `product|service|all`).
Names are lower-case, 2–32 chars, and can't reuse a built-in command or alias. Admins define global ones; people define their own (max 20).

Nothing special is needed to run them: typing `#name [text]` already works. The reply is `{type:"sd", action:"cmd.custom", reqId:"#name", data:{command, action, result}}`
where `action`/`result` are those of the underlying call (e.g. `wizard.start`, then draw `result` exactly like §10). `/cmds`, `/cmdcomplete` and `#help` list a person's custom
commands under the category `custom` (a new category entry, plus `available` as usual). The text after the name is passed as the search text/`input` (≤200 chars).

## 12. Chat: edit and richer uploads

* **Edit** (sender only, within `CHAT_EDIT_WINDOW_SEC`, default 900 s):
  `/edit global <id> <text>`, `/edit dm <user> <id> <text>`, `/edit group <group> <id> <text>`.
  Events to everyone in the conversation: `{type:"edited",scope:"global",messageId,text,editedTs}`, `{type:"dm_edited",messageId,text,editedTs,userA,userB}`,
  `{type:"group_edited",group,messageId,text,editedTs}`. To the requester on refusal: `{type:"edit_denied",messageId,reason}` with reason
  `forbidden | not_found | deleted | expired`. `text` ≤ 2000 chars.
* **History** items gain `editedTs` (number, or `null` if never edited): show "edited". Existing fields are unchanged.
* **Uploads** (`POST /upload`, multipart, as today): now also accepts `video/mp4`, `video/webm`, `video/quicktime`, `application/pdf`, Word/Excel/PowerPoint
  (`.docx .xlsx .pptx`) and `text/plain`. Limits: images/voice 8 MB, documents 20 MB, video 25 MB (413 with the limit in the message); wrong content for the declared
  type → 415. The reply is `{url}` as before plus `type`, `size` and `name` (display name). Documents are served as downloads; video supports Range requests.

---

## Sample flows (all built from the pieces above)

**Hospital** – categories: Patient, Doctor. Onboarding for Patient: `requiredFields:["dob","address"]`, `approverRoles:["Registrar"]`. Catalog services (consultation, x-ray).
Wizard `book_visit`: `input`(details) → `decision`(Insured/Cash) → `upload`(insurance card, only if Insured) → `list`(catalog service) → `approval`(role Registrar) →
`pay`(fee) → `download`(instructions) → `summary`. Custom command `#visit` → wizard `book_visit`. Option "My reports" (`get_data`, data source on the patient database).

**Supermarket** – catalog products, `#shop` custom command (kind catalog), option "My orders" (`get_data`, `name_value`), pay option for top-ups with `verifyDatasource`.

**Recruiting** – category Candidate with auto-approval (`requireApproval:false`), wizard `apply`: `input`(details) → `upload`(CV, `accept:["pdf","docx"]`) →
`approval`(designation Manager) → `summary`. Custom command `#apply`.

## Suggested wiring order

1. Registration form from `/api/sd/public.onboarding`, `code` field / QR scan (§1–2).
2. `#` menu: nothing to do for custom commands except handle their reply (§11) and the `custom` category.
3. Wizard runner screen (§10): one component, switch on `step.type`.
4. Data-driven screens: `option.run` results (table / name-value / text) (§4, §6), `records.list` pager (§8), catalog list (§9).
5. Payments screen (§7), chat "edited" label and new attachment types (§12).
