# Axpert Chat Plugin — Next Steps & Progress Tracker

Source: `AxpertChat.docx` (your boss's plan). This doc maps that vision onto the
current AXI React app, lists what's genuinely missing, and tracks progress
for a three-person team — Arjun on the Erlang chat backend, Anish and Gunn
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

| Vision concept | Status | Where |
|---|---|---|
| Chat with an LLM host (OpenAI/Claude/Gemini) | ✅ Built | Provider Switcher, Composer, Message Thread |
| List prompt → table result from an ADS | ✅ Built (as Data Bin datasources) | Data Bin wizard, `services/dataSources.js` |
| Input prompt → tstruct form popup | 🟡 Partial — one instance, not generalized | System Prompt Editor |
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
      and chat-host configuration, likely extensions of the existing Admin
      Dashboard.
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
- [ ] Input prompt type (reuse System Prompt editor's form pattern)
- [ ] Wire in existing Upload/Download services

### Phase 4 — Registration & host admin
*Extends the existing Admin Dashboard.*

- [ ] External-user registration form (`AxExternalUsers` fields)
- [ ] Chat-host configuration UI
- [ ] Both as new tabs/panels in the existing Admin Dashboard

### Phase 5 — Payment, OTP, Smart View
*Highest external-dependency risk — sequence last.*

- [ ] Payment prompt UI (pending gateway/provider decision)
- [ ] OTP prompt UI (pending channel/provider decision)
- [ ] Smart View popup (pending scoped design pass)

---

## 6. Three-person GitHub workflow

Dividing by **feature ownership / layer**, not by file type — two people
editing the same file is where every conflict in this codebase has actually
come from so far, and the Erlang backend is a separate codebase entirely so
it naturally avoids overlap with the React work.

### Split work by module, not by task type

**Arjun — Erlang chat backend**
- [ ] Chat backend service in Erlang (the "separately-owned backend" this
      doc's frontend work builds against) — connections, message routing,
      real-time delivery (websocket/polling — see the open question in
      Section 8), and the API contract the React app calls
- [ ] Prompt-engine backend support: List (GetList API), Input (tstruct
      save), Upload/Download file endpoints
- [ ] Chat-host and external-user data access — reads/writes against the
      existing schema (e.g. `erpdemo`); no new database or schema setup
      needed, this plugs into the schema already in place
- [ ] Publishing the API contract (endpoints, payload shapes) that Anish
      and Gunn build the frontend against — do this early, before they're
      blocked on real data

**Anish & Gunn — React frontend**
- Split Phase 1–2 work between the two of you by module, same principle as
  before (natural boundaries: `src/features/<name>/`, `src/services/<name>.js`):
  - [ ] Associate/host directory + conversation-list navigation shell +
        routing (one owner)
      - [ ] Card-based message thread redesign + prompt renderer
        components per type (other owner)
  - [ ] Both: wire against Arjun's published API contract rather than
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
      Arjun tests Anish/Gunn's UI flows against real usage; Anish and Gunn
      take turns exercising Arjun's backend endpoints/chat behavior.
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

- **Local dev** stays exactly as now — everyone runs `npm run dev` in
  `axi-react-src/` (frontend) or the Erlang release locally (backend)
  against their own machines, each signing in to the real ARM API
  standalone.
- **Build** — `npm run build` produces a static `dist/` (`index.html` +
  hashed JS/CSS) that needs nothing but a file server; no Node process
  required at runtime. The Erlang backend builds/releases separately
  (e.g. via `rebar3 release`).
- **CI/CD — auto-deploy on push**: a push to `main` on GitHub must trigger
  an automatic deploy to the boss's VM so the team can test live changes
  immediately.
  - [ ] Get VM access details from the boss (IP/hostname, SSH access, and
        whether it's one VM hosting both frontend + Erlang backend or two
        separate targets).
  - [ ] Set up a GitHub Actions workflow (or webhook-triggered script on
        the VM) that: builds the React app (`npm run build`) and the
        Erlang release, then ships both to the VM and restarts the Erlang
        service.
  - [ ] Decide the deploy mechanism: GitHub Actions `deploy` job over SSH
        (`scp`/`rsync` + remote restart command) vs. a lightweight webhook
        listener running on the VM that pulls and rebuilds on push —
        either works, pick based on what access the boss grants.
  - [ ] Store any VM credentials/SSH keys as GitHub Actions secrets, never
        committed to the repo.
  - [ ] Confirm whether deploys should trigger on every push to `main`, or
        only on PR merge (recommended, so in-progress branch pushes don't
        hit the shared VM before review).
- [ ] **Confirm with backend**: does production still need
      `shared/axi-standalone-bridge.js`'s standalone sign-in screen? Its whole job
      is bridging to the real ARM API when there's no Axpert host around —
      once this runs on the VM (presumably inside Axpert, or behind
      existing org auth), a different auth path may take over.
- [ ] **Make environment-driven** (currently hardcoded in
      `shared/axi-standalone-bridge.js`): the ARM API base URL / project name, and
      provider API keys — needed before a second deployment target
      (a client) exists.

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
- [ ] **Real-time** — human-to-human chat implies live delivery — is there
      a websocket/polling mechanism planned on the backend, or does the
      frontend need to design around polling for now?
- [ ] **Existing AXI** — does "My work space" / LLM chat stay exactly as-is
      inside the new shell, or does the boss want changes to it as part of
      this pass?
- [ ] **Deployment target** — confirm exactly how `dist/` and the Erlang
      release get served on the boss's VM (see Section 7): access method,
      whether frontend and backend share the VM, and what web/reverse-proxy
      server (if any) fronts them.
- [ ] **Database/schema** — confirmed this plugs into an existing schema
      (e.g. `erpdemo`) rather than needing a new DB setup; still need the
      exact schema/table access details from the backend dev once Arjun
      starts wiring the Erlang service to it.
