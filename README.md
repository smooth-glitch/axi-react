# AXI — React SPA

> **Proprietary — All Rights Reserved.** This repository is company
> property, not open source. It is publicly reachable on GitHub only as a
> practical necessity (private-repo access could not be granted to the
> full dev team at the time of writing) — that does **not** grant anyone
> outside the authorized development team any right to use, copy,
> modify, or redistribute this code. See [`LICENSE`](LICENSE) for the
> full terms.

The true single-root React app for AXI (Axpert Insights) — one
`createRoot()`, one component tree, real owned state. This repo was split
out from `smooth-glitch/axibot` (where the app was originally built
alongside a legacy vanilla-JS hybrid version, now retired) so the frontend
team can work here directly with no legacy code in the way.

## Backend

This repo also holds the real-time chat backend — Erlang/OTP, at
[`axi-chat-backend/`](axi-chat-backend/README.md) — one repo, one remote,
both layers. See that folder's `README.md` for setup, and
[`docs/CHAT_PROTOCOL.md`](docs/CHAT_PROTOCOL.md) for the WebSocket
protocol this app's chat UI will eventually talk to. Not yet wired up to
any frontend component — see "Known gaps" below.

## Running it

```bash
npm install
npm run dev
```

Then open the printed local URL. You'll be prompted to sign in against the
real ARM REST API on load (see `shared/axi-standalone-bridge.js`, copied
into `public/` at dev/build time — see "Shared files" below).

## Building for deployment

```bash
npm run build
```

Outputs a complete, self-contained app to `dist/` — `index.html`, hashed
JS/CSS bundles, and the shared service scripts/styles this app loads as
plain globals (see "Architecture" below). Serve `dist/` with any static
file server; nothing else needs to be copied alongside it.

## Architecture

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

## Known gaps

Not yet built: **Smart List** (the interactive-table popup on List-prompt
results — deep Axpert-platform integration, needs its own design decision,
not a quick port) and the **header resources drawer** (links/images/videos
panel). The **associate/host directory and chat UI itself aren't built
yet either** — the Erlang backend (`axi-chat-backend/`) is ready and
tested (host directory, DMs, groups, real-time messaging all work — see
its `README.md`), but nothing in this React app calls it yet. See
`docs/NEXT_STEPS.md` for the full roadmap.

## Legacy per-feature builds

Before this became a true SPA, each feature built as its own self-contained
IIFE bundle for pasting into a host page's script slot. That build path
still exists, in case it's ever needed again:

```bash
npm run build:legacy              # builds all 8 feature bundles into dist/
npm run build:databin             # just one feature, e.g. the Data Bin wizard
```
