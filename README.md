# AXI — React SPA + Erlang Chat Backend

> **Proprietary — All Rights Reserved.** This repository is the property
> of Agile Labs Private Limited, not open source. It is publicly reachable on GitHub only as a
> practical necessity (private-repo access could not be granted to the
> full dev team at the time of writing) — that does **not** grant anyone
> outside the authorized development team any right to use, copy,
> modify, or redistribute this code. See [`LICENSE`](LICENSE) for the
> full terms.

One repo, one remote, two layers: a React SPA (frontend) and an Erlang/OTP
real-time chat backend. This is the true single-root React app for AXI
(Axpert Insights) — one `createRoot()`, one component tree, real owned
state. It was split out from `smooth-glitch/axibot` (where it was
originally built alongside a legacy vanilla-JS hybrid version, now
retired) so the frontend team can work here directly with no legacy code
in the way.

## Start here, by role

| You are... | Read this |
| --- | --- |
| A **frontend dev** working on the React app | This file, then [Frontend: architecture](#frontend-architecture) |
| The **backend dev** working on the Erlang chat service | [`axi-chat-backend/README.md`](axi-chat-backend/README.md), then [`axi-chat-backend/docs/DEBUGGING.md`](axi-chat-backend/docs/DEBUGGING.md) |
| Wiring the **frontend chat UI** to the backend | [`docs/CHAT_PROTOCOL.md`](docs/CHAT_PROTOCOL.md) — the WebSocket protocol reference |
| Wiring the **sign-in, org, approvals, cards, forms and admin screens** (Sandesh) | [`docs/SANDESH_API.md`](docs/SANDESH_API.md) — REST + `/sd` WebSocket API |
| Wiring the **prompt bar's `#command` menu** (type `#`, pick an action) | [`docs/HASH_COMMANDS.md`](docs/HASH_COMMANDS.md) — catalog, suggestions, every command |
| Touching **CI/CD, the deploy VM, nginx, or preview environments** | [Infrastructure & deployment](#infrastructure--deployment) below |
| Planning **what to build next** | [`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md) — the shared progress tracker for the whole team |
| Picking up the **Data Bin wizard rewrite** specifically | [`EXTRACTION_NOTES.md`](EXTRACTION_NOTES.md) — line-by-line notes on the vanilla-JS source being ported |

## Repo layout

```
axi-react/
├── src/                  React app: entry point, features, services, store
├── shared/               Real ARM-API-integrated JS, loaded as <script> globals (see below)
├── public/                Static assets; shared/ files are copied here at build time, not committed
├── scripts/               Build helper scripts (public-asset sync)
├── docs/                  Cross-cutting docs: chat protocol, Sandesh API, #commands, roadmap
├── axi-chat-backend/       Erlang/OTP chat backend — its own README, own setup, own deploy
├── .github/workflows/      CI/CD: frontend deploy, backend deploy, PR preview environments
├── EXTRACTION_NOTES.md    Working notes for porting the vanilla-JS Data Bin wizard to React
└── index.html, vite.config.js, package.json   Frontend build config
```

## Frontend: quick start

```bash
npm install
npm run dev
```

Then open the printed local URL. You land on the **Sandesh sign-in screen** —
Sandesh's own login is the app's only front door. (The old ARM sign-in page is
**no longer shown at start-up**; the ARM sign-in code is still in
`shared/axi-standalone-bridge.js` — copied into `public/` at dev/build time,
see [Shared files](#shared-files) — and can be opened on demand with
`window.AxShowArmSignIn()` for anything that needs an ARM session, such as
Axpert data. Without one, ARM-backed features like the AI provider key from
Axpert and Data Bin have nothing to load; nothing freezes.)

Chat needs the Erlang backend on port 8080 in dev (`axi-chat-backend/README.md`).
**Rebuild it after pulling** (`build.ps1`, then `run.ps1`): a stale backend
build shows "Disconnected from Sandesh backend" in the chat.

### Building for deployment

```bash
npm run build
```

Outputs a complete, self-contained app to `dist/` — `index.html`, hashed
JS/CSS bundles, and the shared service scripts/styles this app loads as
plain globals (see [Architecture](#frontend-architecture)). Serve `dist/`
with any static file server; nothing else needs to be copied alongside it.
In practice this happens automatically on push to `main` — see
[Infrastructure & deployment](#infrastructure--deployment).

## Frontend: architecture

- `src/main.jsx` → `src/app/App.jsx` — the single React root. `App.jsx`
  renders every feature (message thread, composer, data bin wizard, admin
  dashboard, provider switcher, prompt templates, export chat, system
  prompt editor) as normal children of one tree. **The admin dashboard,
  prompt templates, and system prompt editor are slated for removal
  entirely** (not extended) once the chat-host/directory/prompt-engine
  work replaces them — see `docs/NEXT_STEPS.md` Section 3's scope
  correction. Still present in the code as of this writing.
- `src/store/chatStore.js` — owns app state (chats, active chat, busy,
  pending attachments), including chat persistence to `localStorage`.
- `src/services/` — `handleSend` and its supporting AI dispatch /
  dataset-context / file-handling / response-parsing / vector-search /
  PDF-and-chat-export logic, each as a real ES module.
- `src/features/*/` — the 8 feature components (message thread, composer,
  data bin wizard, admin dashboard, provider switcher, prompt templates,
  export chat, system prompt editor).
- `shared/` — real ARM-API-integrated files (see below) that this app loads
  as plain global `<script>` tags rather than ES modules, reached via
  `window.*`. Deliberately **not** rewritten as part of the React
  conversion — too risky to blind-refactor without a live session to test
  against.

### Shared files

`shared/axi-databin-services.js`, `axi-admin-services.js`,
`axi-standalone-bridge.js`, `axi-foundation.js`, `axi-databin-core.js`,
`axi-databin-extras.js`, `axi-ui-polish.js`, `axi-push-to-tstruct.js`, and
`styles.css` are real, tested, ARM-API-integrated code — not the retired
vanilla-hybrid app. `axi-databin-core.js`/`axi-databin-extras.js`/
`axi-ui-polish.js`/`axi-push-to-tstruct.js` specifically are loaded
dynamically by `App.jsx` after its first render commits (not as static
`<head>` tags), since their boot routines query markup that only exists
once React has rendered it — this page ships only `<div id="root">`, not
static HTML.

`public/`'s copies of these files are **not** committed —
`scripts/sync-public-assets.mjs` copies them fresh from `shared/` before
every `npm run dev` / `npm run build` (wired as `predev`/`prebuild`). A real
copy, not a symlink, so it works identically on every OS (symlinks broke on
Windows checkouts without `core.symlinks` enabled). **Always edit the
`shared/` copy**, never the one under `public/` — it gets overwritten on the
next `dev`/`build`. Run `node scripts/sync-public-assets.mjs` manually for a
fresh copy without starting the dev server.

**These files originated in `smooth-glitch/axibot`.** There is currently no
automated sync between the two repos — if a fix lands in axibot's copy,
port it here manually (and vice versa). See `docs/NEXT_STEPS.md` for the
active roadmap and open questions, including this one.

### Legacy per-feature builds

Before this became a true SPA, each feature built as its own self-contained
IIFE bundle for pasting into a host page's script slot. That build path
still exists, in case it's ever needed again:

```bash
npm run build:legacy              # builds all 8 feature bundles into dist/
npm run build:databin             # just one feature, e.g. the Data Bin wizard
```

## Backend

This repo also holds the real-time chat backend — Erlang/OTP, at
[`axi-chat-backend/`](axi-chat-backend/README.md) — one repo, one remote,
both layers. See that folder's `README.md` for architecture and setup,
its `docs/DEBUGGING.md` for troubleshooting, and
[`docs/CHAT_PROTOCOL.md`](docs/CHAT_PROTOCOL.md) for the WebSocket
protocol this app's chat UI will eventually talk to. Two further contracts
sit on top of it: [`docs/SANDESH_API.md`](docs/SANDESH_API.md) (login,
organisation, approvals, cards, forms, admin console) and
[`docs/HASH_COMMANDS.md`](docs/HASH_COMMANDS.md) (the prompt bar's `#command`
menu — one command per backend feature). **Not yet wired up to any frontend
component** — see [Known gaps](#known-gaps) below.

## Infrastructure & deployment

Both layers deploy from this one repo via GitHub Actions, running on a
**self-hosted runner installed directly on the deploy VM** (`10.0.2.146`,
office-network-only). That's a deliberate architecture choice, not a
workaround: GitHub's own cloud-hosted runners can't reach that VM at all
(it isn't internet-reachable), but a runner living on the VM can always
make the outbound connection to GitHub, so no inbound firewall changes are
needed.

| Workflow | Triggers on | What it does |
| --- | --- | --- |
| [`deploy-backend.yml`](.github/workflows/deploy-backend.yml) | Push to `main` touching `axi-chat-backend/**` | `rebar3 compile`, restarts the `axi-chat-backend` systemd service, verifies it came back up |
| [`deploy-frontend.yml`](.github/workflows/deploy-frontend.yml) | Push to `main` touching `src/`, `public/`, `shared/`, `index.html`, or the package/vite files | `npm ci && npm run build`, rsyncs `dist/` to `/var/www/axi-react` (served by nginx at `/`) |
| [`preview-deploy.yml`](.github/workflows/preview-deploy.yml) | PR opened/updated | Builds and deploys a **fully isolated preview** of both layers for that branch (see below) |
| [`preview-cleanup.yml`](.github/workflows/preview-cleanup.yml) | PR closed/merged | Tears the preview back down and frees its slot |

On the VM, **nginx is the single front door**: `/ws`, `/upload`, and
`/uploads/*` are routed to the Erlang backend; everything else is the
static frontend build. Production always runs on Redis logical DB `0`.

**PR previews** get their own fully isolated stack, so two people can have
two different branches live at once without colliding:

- its own Redis logical DB (`1`–`15`, assigned by slot — see `REDIS_DB` in
  `axi-chat-backend`'s `chat_redis.erl`)
- its own backend process on its own port (`9000 + slot`, run via the
  systemd template unit `axi-chat-backend-preview@<slot>.service`)
- its own URL path, `/preview/<branch-slug>/`, for both the frontend build
  and the backend's WS/upload endpoints
- a slot number assigned by `/opt/preview/allocate-slot.sh` (a
  flock-guarded registry script on the VM) and freed by
  `preview-cleanup.yml` on PR close
- a comment posted back on the PR with the live preview URL (reachable
  only from the office network/VPN)

A few VM-specific details worth knowing before touching any deploy
workflow:

- **SELinux (Oracle Linux, enforcing)** blocks executing binaries out of a
  user's home directory by default. `restorecon -R` runs on every fresh
  checkout/build output to (re)apply the VM's persistent fcontext rule —
  don't drop this step from a workflow, checkouts silently stop being
  executable without it.
- The backend build step exports `PATH=/opt/erlang/27.3.4.18/bin:$PATH`
  explicitly rather than relying on a login-shell PATH — the runner's
  non-interactive shell doesn't pick up the same environment a human
  SSH session would.
- Every deploy step ends with an actual health check (curl against the
  real endpoint, not just "the command exited 0") — keep that pattern for
  any new deploy step you add.

## Known gaps

Not yet built: **Smart List** (the interactive-table popup on List-prompt
results — deep Axpert-platform integration, needs its own design decision,
not a quick port) and the **header resources drawer** (links/images/videos
panel). The **associate/host directory and chat UI itself aren't built
yet either** — the Erlang backend (`axi-chat-backend/`) is ready and
tested (host directory, DMs, groups, real-time messaging all work — see
its `README.md`), but nothing in this React app calls it yet. See
`docs/NEXT_STEPS.md` for the full roadmap.
