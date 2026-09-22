# Axpert Chat Plugin — Next Steps & Progress Tracker

Source: `AxpertChat.docx` (your boss's plan). This doc maps that vision onto the
current AXI React app, lists what's genuinely missing, and tracks progress
for a three-person team — the Backend Owner on the Erlang chat backend, the Frontend Owners
on the React frontend.

**How to use this file**: tick a box with `- [x]` as you finish that item,
commit, push. This is the shared source of truth for progress — both owners
edit it directly rather than keeping status anywhere else. Keep edits to
*your own* checkboxes in the same commit as the code that finishes them, so
the history stays meaningful.

> This app now lives in its own repo (`axi-react`), split out from
> `smooth-glitch/axibot` where it was originally built. File paths below are
> relative to this repo's root unless noted otherwise; `shared/` holds the
> real ARM-API-integrated files this app depends on — see the root
> `README.md`'s "Shared files" section.
>
> The Erlang chat backend lives in this same repo now, at
> `axi-chat-backend/` (renamed from the standalone `ember-chat`/Ember
> project it started as — see that folder's own `README.md` for its
> architecture and setup). One repo, one remote, both layers.

---

## 1. The vision, in plain terms

Five concepts carry the whole document:

1. **External users & associates.** Anyone a user might message — colleagues,
   or external people (customers, suppliers, patients, students…) registered
   via an `AxExternalUsers` table with category, email, org, designation.
2. **Chat hosts.** Departmental SPOCs (HR, Finance, IT Support…) that any
   user or external user can message — a host can be one person, a user
   group, or "not assigned."
3. **Prompts.** The core interaction unit. Each prompt is one of six types —
   **List** (an ADS result, shown as table/name-value/HTML, with a "Smart
   View" popup), **Input** (a tstruct form), **Upload file**, **Download
   file**, **Payment**, or **OTP** — configured per user-category/host pair
   and surfaced as quick actions in a conversation.
4. **Card-based chat window.** A directory of associates + hosts (including
   LLM hosts: OpenAI, AI Router, Claude, Gemini, and "My work space").
   Messages render as expandable cards — sender, timestamp, color-coded
   type — grouped by month as volume grows.
5. **Persona journeys.** The source doc illustrates the prompt system with a
   detailed hospital scenario (doctors, patients, nurses, lab techs, front
   office) plus generic employee/customer/supplier flows.

**Confirmed scope**: this starts as an internal org chat app (associates +
department chat hosts + LLM hosts), then gets outsourced to external clients
who configure it for their own personas/workflows. The hospital scenario is
**not** in scope — it was illustrative only. That means the directory,
prompt engine, and host config all need to be **data-driven from day one** —
no persona, host name, or prompt list hardcoded anywhere in the frontend —
since the exact same components have to work for the internal build and for
whatever a future client configures. This is the single biggest
architectural constraint on Phases 1–3.

---

## 2. Backend data structures (from the boss's spec)

Backend-owned tables/tstructs — not yours to build — but the contract every
frontend form, list, and directory entry in Phases 1–3 has to match.

### `AxExternalUsers` table (from tstruct "Register External Users")

| Field | Notes |
|---|---|
| Name | |
| Category | Employee, Customer, Supplier, Contractor, Advisor, Consultant, Patient, Student, Doctor, Others |
| Email Id | **Mandatory** |
| Mobile no | Optional |
| Organisation name | |
| Designation | |
| Location/Branch | |

### Chat host tstruct

| Field | Notes |
|---|---|
| Chat host name | e.g. "HR executive", "HR Manager", "GM Finance", "CHD" |
| Host user name | Selection from user master; one of — Not assigned / All users in a group / Selected user in a group |
| Host user group | Only used when "Host user group" mode is selected |
| User name | Selection from user master and registered associates |

### Prompt definition tstruct

| Field | Notes |
|---|---|
| Prompt text | Unique per user-category + host pair |
| Prompt type | List, Input, Upload file, Upload picture, Download file, Payment, OTP |

Type-specific fields, shown only for that prompt type:

| Prompt type | Extra fields |
|---|---|
| **List** | ADS name · Display list as (Table / Name-value pair / HTML) · HTML Text (when display = HTML) |
| **Input** | Transid selection · Notify to host · User category (dropdown, from `AxExternalUsers` categories) · Host (dropdown, from chat hosts — default "My work space") |

### Runtime behavior per prompt type

- **List** — tied to an ADS; result fetched via the **GetList API**; global
  vars and the selected entity value are passed as parameters by default.
  Renders as a table by default, or as name-value pairs, or as HTML with
  data embedded. A table result gets a "view as Smart View" option (popup).
- **Input** — tied to a tstruct; opens a popup form. On save, the tstruct is
  saved and the result renders as HTML in the chat thread. Has an Edit
  button that reopens the form in edit mode.
- **Download file** — downloads a print format or attachment from a
  transaction, identified by transid + key field + key value; an optional
  filename/path can be given.
- **Upload file** — uploads and attaches file(s) to a transaction via
  transid + recordid + filenames; if transid/recordid aren't provided, files
  land in the file system and are viewable later.

### Chat window structure

- **Contact list** = associates (reporting manager, skip-level manager,
  peers, subordinates, and any user groups this user belongs to) +
  configured chat hosts.
- **Preconfigured hosts**, always listed: Open AI, AI Router, Claude,
  Gemini, and "My work space" (the app-interaction host — today's AXI chat).
- Selecting a human associate or department host → 1:1 chat (new build,
  human-to-human).
- Selecting an LLM host → the same experience as today's AXI chat.
- **Message card**: From, Date & time, colour-coded type, Text — each card
  can expand or collapse.
- As volume grows: cascading cards, grouped by month for performance/
  readability; custom grouping is configurable per host-user pair.
- A standard prompt bar is shown per conversation, scoped to that
  user-category + host pair; selecting a prompt executes it and the result
  renders in-thread.

---

## 3. What's already built

> **Scope correction (post-audit):** Templates, the System Prompt Editor
> ("user prompt"), and the Admin Dashboard are being **removed from the
> app entirely**, not extended — the boss's spec doesn't call for any of
> them, and the generic prompt engine (Section 4) replaces what the
> System Prompt Editor did as a one-off. This is the Frontend Owners' work,
> starting once the Backend Owner's backend base is done — don't build anything new
> on top of these three in the meantime. The "✅ Built"/"🟡 Partial" rows
> below referencing them describe what exists *today*, not what to keep
> extending.

| Vision concept | Status | Where |
|---|---|---|
| Chat with an LLM host (OpenAI/Claude/Gemini) | ✅ Built | Provider Switcher, Composer, Message Thread |
| List prompt → table result from an ADS | ✅ Built (as Data Bin datasources) | Data Bin wizard, `services/dataSources.js` |
| Input prompt → tstruct form popup | 🟡 Partial, and slated for removal — see scope correction above | System Prompt Editor |
| Upload file prompt | ✅ Built | `services/fileUpload.js` |
| Download file prompt | ✅ Built (chat/message export) | `services/chatExport.js`, `pdfExport.js` |
| Message cards, expand/collapse | ✅ Built (single-thread form) | MessageBubble / MessageThread |
| Smart View popup on a list result | ⬜ Deferred — needs a scoped design pass | — |
| Associate/host directory + multi-conversation nav | ⬜ Missing | — |
| External user registration | ⬜ Missing | — |
| Chat host configuration (admin side) | ⬜ Missing | — |
| Generic prompt engine (configurable, all 6 types) | ⬜ Missing | — |
| Payment / OTP prompts | ⬜ Missing | — |
| Month-grouped, cascading card view | ⬜ Missing | — |

---

## 4. New concepts the frontend needs — gap checklist

These don't extend existing components — they're new surfaces the current
IA has no place for yet.

- [ ] **Remove templates, the System Prompt Editor, and the Admin
      Dashboard** — not extended, deleted entirely (see the scope
      correction in Section 3). The Frontend Owners' first task once the
      Backend Owner's backend base is done.
- [ ] **Directory & navigation shell** — a left-rail list of associates,
      external users, and hosts (departmental + LLM), replacing today's
      single-conversation layout with a conversation list + active-
      conversation view.
- [ ] **Prompt engine** — a renderer that takes a prompt definition (type +
      config) and produces the right UI. Genuinely new: none of List/Input/
      Upload/Download/Payment/OTP exist today as a *generic, configurable*
      system, only as one-off features.
- [ ] **Card-based thread redesign** — From/timestamp/color-coded-type
      cards, expand/collapse, month grouping, cascading for volume. A real
      redesign of MessageThread, not a copy of the LLM chat bubble style.
- [ ] **Smart View** — the popup table view for List-prompt results. Deep
      Axpert-platform integration (fakes jQuery/GetDataFromAxList, injects
      an external script) — needs a scoped design pass with the backend
      dev, not a blind port.
- [ ] **Registration & host admin** — forms for "Register External Users"
      and chat-host configuration. **Not** an extension of the existing
      Admin Dashboard — that's being removed (Section 3) — this is new,
      built fresh.
- [ ] **Payment & OTP flows** — new UI patterns with no analog in the
      current app; scope depends entirely on backend/provider decisions.

---

## 5. Recommended phased roadmap

### Phase 1 — Directory shell + navigation redesign
*Foundational — unblocks everything else.*

- [ ] Associate/host directory component (data-driven, no hardcoded hosts)
- [ ] Conversation-list navigation shell
- [ ] Routing between conversations
- [ ] Wire today's LLM chat in as the first working "host" type in the new shell

### Phase 2 — Card-based thread redesign
*Depends on Phase 1's shell existing.*

- [ ] From/timestamp/color-coded-type card format
- [ ] Expand/collapse per card
- [ ] Month grouping
- [ ] Cascading cards for high-volume threads
- [ ] Apply to both LLM and human-to-human conversations via the shared thread component

### Phase 3 — Prompt engine (List & Input first)
*Needs backend tstruct/ADS contracts confirmed first.*

- [ ] Generic prompt renderer (reads a prompt definition, dispatches to the right UI)
- [ ] List prompt type (reuse Data Bin datasource patterns)
- [ ] Input prompt type (the System Prompt Editor is being removed, not
      reused — its form pattern can still inform this build, but expect
      to build the actual component fresh)
- [ ] Wire in existing Upload/Download services

### Phase 4 — Registration & host admin
*Built fresh — the old Admin Dashboard is being removed (Section 3), not extended.*

- [ ] External-user registration form (`AxExternalUsers` fields)
- [ ] Chat-host configuration UI
- [ ] New admin surface for both — whatever replaces the old Admin
      Dashboard's navigation, TBD by the Frontend Owners when they get here

### Phase 5 — Payment, OTP, Smart View
*Highest external-dependency risk — sequence last.*

- [ ] Payment prompt UI (pending gateway/provider decision)
- [ ] OTP prompt UI (pending channel/provider decision)
- [ ] Smart View popup (pending scoped design pass)

---

## 6. Three-person GitHub workflow

Dividing by **feature ownership / layer**, not by file type — two people
editing the same file is where every conflict in this codebase has actually
come from so far. The Erlang backend now lives in this same repo
(`axi-chat-backend/`) rather than a separate one, but it's still a wholly
separate directory/language/toolchain from the React side, so it still
naturally avoids file-level overlap with the React work.

### Split work by module, not by task type

**Backend Owner — Erlang chat backend (`axi-chat-backend/`)**
- [x] Chat backend service in Erlang — connections, message routing,
      real-time delivery over WebSocket (confirmed, not polling), and the
      command/event protocol the React app calls (see
      `axi-chat-backend/README.md`'s "Protocol" section)
- [x] Persistence — messages/groups/profiles in Redis (live store), with a
      once-daily job (pending) syncing each user's data to the real DB via
      the ARM API's `AXput` once that endpoint exists
- [x] `chat_arm.erl` — ARM API client for reading Axpert data (directory,
      chat-host config, prompt definitions), using the same
      `{token, ARMSessionId}` the frontend already gets from its own ARM
      sign-in; the backend never handles a password itself
- [ ] Prompt-engine backend support: List (`GetList`/`AxList`), Input
      (tstruct save via `AXput`), Upload/Download file endpoints
- [ ] Chat-host and external-user data access via the ARM API once the
      backend dev creates the `AxExternalUsers`/chat-host tables (not done
      yet as of this writing) — no direct DB connection, all reads/writes
      go through ARM API calls
- [ ] Publishing the API contract (WS command/event shapes) that the
      Frontend Owners build the frontend against — do this early, before
      they're blocked on real data
- [x] **VM access + CI/CD auto-deploy** (Section 7) — done and verified
      live for both halves: Erlang/Redis/nginx set up, backend running as
      a systemd service, React frontend built and served by nginx at `/`,
      self-hosted GitHub Actions runner deploying both on every push
      (separate workflows, only the changed half rebuilds). TLS still
      open (needs a domain) — see Section 7 for the full breakdown.
- [ ] **Chase the boss/backend dev on the open data contracts** (Section
      8) — `AxExternalUsers`/chat-host/prompt-definition table shapes.
      This is the one thing genuinely gating most of the remaining
      backend work, so keeping it moving is on you, not just waiting on it.

**Frontend Owners — React frontend**
- Split Phase 1–2 work between the two of you by module, same principle as
  before (natural boundaries: `src/features/<name>/`, `src/services/<name>.js`):
  - [ ] Associate/host directory + conversation-list navigation shell +
        routing (one owner)
      - [ ] Card-based message thread redesign + prompt renderer
        components per type (other owner)
  - [ ] Both: wire against the Backend Owner's published API contract rather than
        against mocks once it's available

> **The one shared file to watch**: `src/app/App.jsx` is the single root
> component every feature mounts into, and every edit to it during this
> project's own build triggered a full dev-server reload. Whoever needs an
> App.jsx change flags it in standup before touching it; keep those edits
> small and merge them fast so the others aren't blocked long.

### Cross-testing (boss's requirement)

Your boss wants each person testing the others' features to catch bugs
before they reach the shared VM:

- [ ] Before merging a PR, at least one of the *other two* people pulls the
      branch and exercises the feature manually (not just a code review) —
      the Backend Owner tests the Frontend Owners' UI flows against real usage; the Frontend Owners
      take turns exercising the Backend Owner's backend endpoints/chat behavior.
- [ ] Log what you tested and found (even informally, in the PR itself) so
      there's a record of what's been verified beyond "it compiles."
- [ ] Treat the live VM deployment (Section 7) as the shared integration
      point — this is where cross-testing happens against the real,
      deployed stack, not just against `localhost`.

### Branching & PRs

- **Branch per feature, not per person**: `feat/directory-shell`,
  `feat/card-thread`, `feat/erlang-chat-router` — makes ownership legible in
  the branch list itself.
- **Small, frequent PRs** (a few hundred lines, not a whole phase) — easier
  to review, less likely to go stale against `main`.
- **Pull & rebase onto `main` daily**, before starting each day's work —
  catches conflicts while they're small.
- **At least one other person reviews (and cross-tests) every PR** before
  merge — keeps everyone current on the parts they didn't build.
- **Draft PRs for in-progress work** — signals "I'm working here" without
  waiting for a finished feature.
- **Every push to `main` auto-deploys to the VM** (see Section 7) — so a
  merged PR is live and testable within minutes, which is exactly what
  makes the cross-testing step above practical.

### Before building a shared piece, agree the contract first

Where the backend and frontend meet — the Erlang API's endpoints/payload
shapes, or where the directory hands off a "selected conversation" to the
card thread — write down the contract *before* people build against it.
Building against an agreed contract in parallel is what actually avoids
conflicts, not just avoiding the same file.

### Daily sync

A 5-minute async check-in (a Teams thread is fine) covering: what each of
you is touching today, anything that needs cross-testing, and any
shared-file or API-contract change coming up.

---

## 7. Build & deploy

Confirmed: local development, then every push to GitHub auto-deploys to a
VM your boss provides — that VM is the shared production/test server for
live testing. No cloud PaaS (Vercel/Netlify-style) in the picture.

- **Local dev** — frontend: `npm run dev` in `axi-react-src/`, signing in
  to the real ARM API standalone. Backend: `.\build.ps1` then `.\run.ps1`
  inside `axi-chat-backend/` (or `./tools/rebar3 compile` + `erl ...` on
  macOS/Linux — see that folder's `README.md`), against a local Redis
  instance (`redis-server`, defaults to `127.0.0.1:6379` — see
  `chat_redis.erl` for the env vars to point it elsewhere).
- **Build** — `npm run build` produces a static `dist/` (`index.html` +
  hashed JS/CSS) that needs nothing but a file server; no Node process
  required at runtime. The Erlang backend builds via `rebar3 compile`
  (fetches `eredis` from Hex) — see `axi-chat-backend/Dockerfile` for the
  containerized build.
- **CI/CD — auto-deploy on push — DONE for the backend, verified live:**
  - [x] VM access confirmed: `10.0.2.146`, Oracle Linux 9, reachable only
        from the office network/VPN, user `opc`, key-based SSH
        (`erlang.ppk`).
  - [x] Erlang/OTP 27.3.4.18 built from source via `kerl` and installed at
        `/opt/erlang/27.3.4.18` — EPEL's own `erlang` package is only
        26.x, too old for this app's OTP 27+ `json` module usage.
  - [x] Redis installed, password-protected (env file at
        `/etc/axi-chat-backend.env`, `root:opc` `640`), bound to
        `127.0.0.1` only, AOF persistence on, running as a systemd
        service.
  - [x] nginx installed as a reverse proxy — port 80 → `127.0.0.1:8080`
        (the app's own port is never exposed externally), WebSocket
        upgrade headers configured. **TLS still not set up** — needs a
        domain, tracked as its own item above.
  - [x] Firewall opened for `http`/`https` only — `ssh` untouched, the
        app's own port never exposed.
  - [x] `axi-chat-backend` runs as its own systemd service
        (`axi-chat-backend.service`), auto-restart on failure.
  - [x] **Chose a self-hosted GitHub Actions runner over an SSH-based
        deploy job** — GitHub's cloud-hosted runners cannot reach
        `10.0.2.146` at all (private, office-network-only), so a normal
        "SSH in from Actions" workflow was never going to work here. The
        runner lives on the VM itself and makes an outbound connection to
        GitHub, sidestepping the inbound-reachability problem entirely.
        Installed at `/home/opc/actions-runner`, labeled `axi-vm`, running
        as its own systemd service.
  - [x] Workflow: `.github/workflows/deploy-backend.yml` — triggers on
        push to `main` touching `axi-chat-backend/**`, builds via
        `rebar3`, restarts the service, and verifies the backend actually
        responds correctly before the job succeeds.
  - [x] **Verified with a real push** — checkout → build → restart →
        health check all passed, then confirmed live from an outside
        machine over the real network.
  - [x] **Frontend build/deploy — also done and verified live.**
        `.github/workflows/deploy-frontend.yml` builds via `npm` and
        rsyncs `dist/` to `/var/www/axi-react` on the VM. Required
        reworking the VM's nginx config: it now serves this static build
        at `/`, and routes `/ws` (WebSocket), `/upload`, and `/uploads/*`
        to the Erlang backend — see `docs/CHAT_PROTOCOL.md`'s
        "Connecting" section for the exact prod-vs-local-dev WS URLs.
        Verified: the real built app (not a placeholder) is being served,
        and `/ws` still reaches the backend correctly after the rework.
  - [ ] Several SELinux (Enforcing) gotchas hit along the way, fixed but
        worth knowing about for future VM work: binaries executed from a
        user's home directory need a `bin_t` context
        (`restorecon`/`semanage fcontext`), nginx needs
        `httpd_can_network_connect=1` to proxy to any backend at all, and
        static content directories need `httpd_sys_content_t` for nginx
        to read them.
- [ ] **Confirm with backend**: does production still need
      `shared/axi-standalone-bridge.js`'s standalone sign-in screen? Its whole job
      is bridging to the real ARM API when there's no Axpert host around —
      once this runs on the VM (presumably inside Axpert, or behind
      existing org auth), a different auth path may take over.
- [ ] **Make environment-driven** (currently hardcoded in
      `shared/axi-standalone-bridge.js`): the ARM API base URL / project name, and
      provider API keys — needed before a second deployment target
      (a client) exists.

### Security checklist (audited — see `axi-chat-backend/src/`)

Fixed, verified live (real WebSocket client, not just module-level tests):
- [x] **WS connect now requires a real ARM identity** — first frame is
      `{username, token, armSessionId}`, not a bare claimable username.
      Not independent cryptographic re-verification (ARMToken is an
      HMAC-signed JWT — can't be verified without ARM's own secret) — see
      the security note in `docs/CHAT_PROTOCOL.md`'s "Connecting" section
      for exactly what this does and doesn't guarantee.
- [x] **Per-connection rate limiting** — 30 commands / 10s, tested live
      (flooded 40, 10 correctly rejected).
- [x] **Startup warning if Redis has no password** on a non-loopback host
      — can't enforce this from code (the VM's Redis config is out of this
      repo's hands), but it's now loud and unmissable in the server log
      rather than a silent gap.

**Not fixed — genuinely can't be from this side, blocking before real
associates use this for real chats:**
- [ ] **TLS.** This backend has zero encryption in transit right now —
      plain `ws://`, not `wss://`. Deliberately *not* solved by hacking
      native TLS into `chat_web.erl` (would mean rewriting every
      `gen_tcp:*` call and `{tcp, ...}` message pattern in a ~1000-line
      file to be transport-agnostic, untestable properly without a real
      cert/domain, high risk of a subtle bug in code that currently
      works). **The fix is an nginx (or similar) reverse proxy on the VM
      terminating HTTPS/WSS** in front of this backend's plain WS port —
      standard practice, needs a domain + cert, both blocked on VM access.
      Do not treat this app as ready for real chat traffic until this
      exists.
- [ ] **Redis auth/lockdown on the actual VM** — the warning above only
      fires if someone's watching the log; nothing stops a VM Redis from
      being deployed with no password if whoever sets it up misses that
      warning. Explicit VM setup step (Section 7's earlier checklist).

---

## 8. Open questions for the boss / backend dev

- [ ] **Data contracts** — exact shape of `AxExternalUsers`, the chat-host
      tstruct, and the prompt-definition tstruct as they'll actually be
      exposed via API (needed before the directory or prompt engine can be
      built against real data, not just this doc's field list).
- [ ] **Smart View** — is the Smart List / Smart View platform integration
      (fakes jQuery/GetDataFromAxList, injects an external script) still the
      intended approach, or is there a cleaner API now?
- [ ] **Payment** — which payment gateway/provider, and is it available in
      a sandbox for frontend development?
- [ ] **OTP** — which OTP channel (SMS/email) and provider — affects the UI
      (code length, resend timing, etc.).
- [x] **Real-time** — resolved: WebSocket, hand-rolled in
      `axi-chat-backend/src/chat_web.erl` (not polling).
- [ ] **Existing AXI** — does "My work space" / LLM chat stay exactly as-is
      inside the new shell, or does the boss want changes to it as part of
      this pass?
- [ ] **Deployment target** — confirm exactly how `dist/` and the Erlang
      backend get served on the boss's VM (see Section 7): access method,
      whether frontend and backend share the VM, and what web/reverse-proxy
      server (if any) fronts them.
- [x] **`AXput` syntax** — resolved: not a direct write endpoint, it's
      queue-based. Build the `data`/`submitdata` (dc/row) payload, wrap it
      in a `_parameters` object with `ARMSessionId`/`ARMToken`/`project`/
      `username`, JSON-encode that as a string, and POST it as `queuedata`
      to `ARM_APIs/api/v1/ARMPushToQueue` (`queuename: "CachedSaveQueue"`).
      Success there means "queued," not "saved" — no synchronous save
      confirmation. Implemented as `chat_arm:put/2` in
      `axi-chat-backend/src/chat_arm.erl`.
- [ ] **`AxExternalUsers`/chat-host tables** — not created yet as of this
      writing (the backend dev's task); blocks the directory and prompt
      engine from reading real data via `chat_arm.erl` until they exist.
