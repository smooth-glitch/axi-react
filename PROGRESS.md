# Lite Tstruct Builder — Progress

## Current state (latest)
- **Frontend is now React + Vite** (`web/`), replacing the React Native Web / Expo app (the old Expo code has been deleted). Same routes, design and behaviour; the unchanged 157-check e2e suite passed on the new build, and the suite grew with the embedding checks and is now **264/264** including the Options feature.
- **Host-embedding pieces (done)**: struct `key` (stable alias usable instead of the id everywhere), record `ref` + `meta` with `?ref=` filtering, `X-Tstruct-User` header, optional `API_TOKEN` bearer auth and `CORS_ORIGINS` allow-list; embeddable library `@tstruct/react` (`<StructForm>`, `<RecordList>`, `<TstructProvider>`, `configure()`, brand overrides); chrome-less iframe pages `/embed/:struct/form|records` with postMessage events; `host-demo.html` as a working example. See docs/embedding.md.
- Form fix: the column grid now follows the container width (ResizeObserver) so it can't go stale (a hot-reloaded tab could show a single column).
- Selection-field error message now names the failing host and hints at CORS.
- Docs: `docs/` (README index, getting-started, architecture, backend, redis, api, field-types-and-conditions, frontend, embedding, testing, vite-migration).

## Phase: "Configuring Options" (standalone feature) — built

An **Option** is a standalone configurable action, unrelated to any struct, with its own nav entry (**Options** in the sidebar, `/options`), storage, API and screens. Full guide: docs/options.md.

- **Redis**: `option:<id>` + set `options:index`; file metadata `file:<id>` + set `files:index` (uuid ids, JSON strings, same conventions as structs/records).
- **File storage**: uploads go to `server/uploads/` (`<uuid>-<name>`, git-ignored, `UPLOAD_DIR` / `MAX_UPLOAD_MB`); `POST /api/files` (multipart), `GET /api/files` (metadata list, used to pick an earlier upload), `GET /api/files/:id` (streams with `Content-Disposition: attachment`). Tested with curl on a real binary file (byte-for-byte identical, UTF-8 names round-trip).
- **API**: `POST/GET/GET one/PUT/DELETE /api/options` with per-type config validation (`dataInput {structName}`, `download {fileId}` (file must exist), `upload {}`, `apiDisplay {apiName, displayAs}`, `pay {paymentConfig}`, `axpertOption {subtype, target}`). Tested with curl (all types, all validation errors, CRUD, delete keeps the file).
- **Functional types**: `dataInput` (looks the struct up by name — case-insensitive — via `GET /api/structs`, then opens its form), `download` (real browser download of the stored file), `upload` (file picker → `POST /api/files` → shows the fileId, "Download it back"). **Config-only**: `apiDisplay`, `pay`, `axpertOption` (configurable + listed; running shows "This option type isn't wired up yet").
- **Screens**: OptionsList (`/options`), OptionBuilder (`/options/new`, `/options/:id/edit`; id read-only, caption, type dropdown with all six types' config fields, file upload/pick for `download`, Applicable-to), OptionRun (`/options/:id/run`).
- **"Applicable to"** (config only — stored, never enforced; no user identity exists): the shape from the brief — `userCategories` (multi-select, scope all/selected) plus an **Affiliate scope** block (shown when `userCategories contains "affiliate"`) and an **Employee scope** block (departments/branches/designations, each all-or-selected; shown when it contains `"employee"`). Block visibility is driven by the existing `evaluateCondition`; its `contains` operator already supported membership in an array on both client and server, so **no extension was needed**. Hidden blocks are not saved (like hidden fields).
- **Integration path designed for (both, no changes needed here)**: (1) the standalone route `/options` and the chrome-less iframe routes `/embed/options[/new|/:id/edit|/:id/run]` (postMessage events `option-saved`, `option-deleted`, `option-run`, `resize`); (2) the three screens are self-contained components (`OptionsList`, `OptionBuilder`, `OptionRun` in `web/src/ui/options`, exported from `@tstruct/react`) that use **no router and no app-level nav state** — the host decides what "open this struct" means via `OptionRun`'s `onOpenStruct` callback (inline form when absent). `host-demo.html?options=1` demonstrates path 2.
- **Assumption to confirm**: the brief said the "applicable to" shape is the same as "the previous prompt", which was not available; the final message's description (categories + two scope blocks with `contains` conditions) was implemented. If your original shape differs, only `web/src/core/options.js`, `server/src/lib/applicableTo.js` and `web/src/ui/options/ApplicableTo.jsx` need to change.
- **Out of scope (unchanged)**: real integrations for `apiDisplay` / `pay` / `axpertOption`; enforcing "applicable to" at run time; validating that a struct name exists before run time.
- **Docs updated**: options.md (new), api.md, redis.md, backend.md, frontend.md, embedding.md, architecture.md, getting-started.md, testing.md, README.md.

## How to run
`npm run dev` from the repo root starts Redis (if needed), the API and the web app (http://localhost:8081); or run the three parts manually. E2E: `cd e2e && node e2e.js`. Details: docs/getting-started.md.

---
(Older notes below describe the Expo-era build; that code no longer exists — the app now lives in `web/`.)


## How to run
1. Redis on `localhost:6379`.
2. `cd server && npm install && npm start` (port 4000; pino logs every request and Redis read/write).
3. `cd app && npm install && npm run web` (http://localhost:8081). API base is `EXPO_PUBLIC_API_URL` (default `http://localhost:4000`).

## Built
- [x] Monorepo: `/server`, `/app`
- [x] Server: Express + ioredis + pino, request in/out logging, Redis helper logging
- [x] Structs API (POST/GET list/GET one) — curl-tested
- [x] Records API (POST with server-side required/type validation, GET list, GET one) — curl-tested
- [x] App: Expo + Expo Router, web export bundles cleanly (`expo export --platform web`)
- [x] StructListScreen (`/`) — empty state, "+ New Struct"
- [x] StructBuilderScreen (`/structs/new`) — name, repeatable field rows, inline type extras, per-field settings bottom sheet (required / section / condition), sections
- [x] StructFormScreen (`/structs/:id/form`) — DynamicForm + DynamicField for all 12 types, live conditions
- [x] RecordListScreen (`/structs/:id/records`)

## Record editing + docs (done)
- Records can be edited: `PUT /api/structs/:id/records/:rid` (validated; keeps id/createdAt, bumps modifiedAt) and the route `/structs/:id/record/:recordId` (form pre-filled; selection items re-hydrated so `fill` fields work). Entry point: the record detail drawer's **Edit record** button.
- `docs/` folder added: README (index), getting-started, architecture, backend, redis, api, field-types-and-conditions, frontend, testing, vite-migration.
- E2E is now **157/157** (adds the record-edit flow, PUT record API checks and form-grid layout checks).
- Record forms (new + edit) use the whole centre pane with a 1/2/3-column field grid (620/980 px breakpoints); docs/embedding.md added.

## UI/UX pass v2 - DONE (restrained, professional; persistent struct menu)
Stack (per brief): styled-components/native (styling), react-native-paper (base components), lucide-react-native (icons), react-native-reanimated + moti (motion), Inter font. Tokens: `app/lib/tokens.js` (light + dark, one file, no hex/magic numbers elsewhere). Kit: `app/components/kit/`.
- Layout: dark left sidebar (Overview, Definitions, struct list with search + record counts) + centre pane. Below 960px the sidebar becomes the home screen and everything stacks. Light orange gradient accent; light/dark/system theme toggle.
- Overview: hero, count-up stats, struct cards. Records: table on wide panes (stacked cards on narrow), search, detail drawer, skeleton loading, "New record" + "Edit definition". Page change = short cross-fade (no staggered row animation).
- Definitions page (`/structs`) lists every struct; click one to edit it (`/structs/:id/edit`, the builder pre-filled). New `PUT /api/structs/:id`. Editing keeps existing field ids (renaming a field is safe, new fields get new ids); existing records are not migrated. A warning shows when records exist.
- Custom dropdown (kit `Select`) replaces the browser's native list everywhere: popover, opens upward when needed, search for 8+ options, keyboard (arrows/enter/esc), check mark on selection.
- Builder: slide-over drawers for the type picker, field editor and section editor; plain-language conditions; animated rows with reorder/duplicate/remove.
- Form: chat-bubble card (avatar + bubble), animated progress bar, sections as collapsible groups, conditional fields animate in/out, inline errors, sticky Submit/Discard bar.
- Navigation: form -> records and edit -> definitions use `dismissTo` (pop to the existing screen, no duplicate screens); the records screen refetches whenever it regains focus.
- Dev note: run `expo start` WITHOUT CI=1, otherwise Metro disables reloads and serves stale code.

## UI/UX pass v1 (superseded)
Inspired by the Axpert Studio recording (navy chrome, white cards on a soft blue band, coloured type icons, collapsible section cards, categorised field-type picker, success toasts, illustrated empty states, floating Submit). Still strictly single-column, four separate routes.
- Design system: `lib/theme.js` (tokens), Urbanist font, `components/ui.js` (T, Button w/ gradient, Input w/ icon + focus ring, styled Select, Collapsible, Chip, ProgressBar, BottomSheet, FadeIn, SearchBar...), `Toast.js`, `EmptyState.js`.
- List: search, avatar cards, "N fields · created", Fill form / Records (count) buttons, illustrated empty state.
- Builder: "Add Field" opens a categorised type picker (Basic / Components / Special, coloured icons) -> field editor bottom sheet (name, type, options, required, section, condition). Field rows show type icon + chips (Required / section / Conditional) with move up/down, duplicate, remove. Sections edited in their own sheet.
- Conditions are now edited in plain language ("Show only when <field> <is|is not|greater than|...> <value>", value picker for list fields) - stored JSON shape is unchanged.
- Form: hero header with progress ("2 of 3 required fields completed"), sections as collapsible cards (re-open when they hold errors), fields fade in when revealed by a condition, inline error messages + summary banner, sticky Submit bar, retry banner if a selection API fails.
- Records: searchable cards (#n, relative time), first 3 values previewed, tap to expand all with type icons.
- Toasts on struct saved / record saved. Back from records now always returns to the list (form <-> records use replace).
- Server: `GET /api/structs` also returns fieldCount and recordCount.
- Dev note: run `expo start` WITHOUT CI=1, otherwise Metro disables reloads and serves stale code.

## Live testing (done)
Playwright E2E in `e2e/e2e.js` (Chrome; 1440px + a 400px phone context) - **133/133 passing**. Run: `cd e2e && npm i && node e2e.js` with server + app running (`CHROME_PATH` overrides the Chrome location). It deletes the structs it creates from Redis when it finishes.
Covers: empty states, theme toggle, builder (type picker, all field types, editor drawer, sections, conditions, reorder/duplicate/remove, validation), stored definition, form (conditions, all operators, validation, location, selection + fill, progress, collapsible sections), submit + toasts, records table/detail drawer/search, sidebar, Definitions + Edit flow (ids preserved, records untouched), custom dropdown (search, keyboard, clear), phone layout, server-side validation incl. PUT.
Bugs found and fixed during testing: missing server-side validation (mobile/time/date/location/list); Sections card hidden its "Add section" button; Enter re-opened the dropdown right after picking; records screen showed stale data after adding a record; duplicate screens stacking in navigation; shadows styled-components can't parse.
Still untested: native (Expo Go) run, especially the native datetimepicker branch of DateField.

## Decisions / deviations
- Struct ids are uuids (spec example used `leaveRequest`; ids are server-generated).
- Field ids are generated from the field name in camelCase (`Employment type` -> `employmentType`); conditions reference these ids.
- Conditions are edited with a small plain-language editor (field / operator / value); the stored JSON is `{field, operator, value}`. There is no free-form JSON editor any more.
- Server and app each have their own `evaluateCondition` (server: `server/src/lib/validate.js`, app: `app/lib/conditions.js`); both compare numbers loosely.
- `selection` fetches `apiUrl` at runtime; accepts an array of strings/objects (or `{items|data|results: []}`). Object items use `id|value` as value and `label|name|title` as label.
- `fill` fields: `sourceField` (selection field id) + optional `sourceProp` (property of the selected item; default = its label).
- `mobile` values are saved in E.164 format; optional `countryPicker` and `defaultCountry` (default US).
- Server validates required, numbers, email, url, date/time format+range, mobile, location, list membership. `selection` values are only type-checked (options come from the client-side apiUrl).
- Expo SDK 54 pinned (`expo install --fix` fails on this Windows box, so versions were pinned via npm).
- Hidden fields (by their own or section condition) are skipped in validation and not saved.

## Next
- UI/UX improvement pass.


## Host-palette re-theme
The app now uses the host app's (Sandesh) look, all via `web/src/core/tokens.js`: coral `#ff7a59` (hover `#ff6540`, active `#e6532e`), gradient `#ff7a59 → #ff5757`, peach background `#fff3eb`, text `#1f2937 / #64748b / #94a3b8`, warm coral shadows, radii 6/10/16/24/pill, Plus Jakarta Sans, status colours `#059669 / #d97706 / #dc2626`. The sidebar is now light frosted glass (was dark navy). The host has no dark mode, so the **default is light** (dark is still selectable via the theme toggle; cycle is light → dark → system). Embedding hosts can still override any token via `TstructProvider theme={...}`. e2e: 264/264.
