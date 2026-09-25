# Frontend

A **React 18.3.1 + Vite 8.3.0** app in [`web/`](../web). It is both the standalone studio (sidebar, builder, records…) and an **embeddable component library** (`@tstruct/react`) built from the same code. (It used to be React Native Web / Expo; see [vite-migration.md](vite-migration.md).)

## Stack

| Concern | Library |
|---|---|
| Build / dev server | Vite 8.3.0 (`npm run dev` on port **8081**) |
| Routing | `react-router-dom` 7 |
| Styling | `styled-components` 6, driven by design tokens (`ThemeProvider`) |
| Animation | `framer-motion` (page fade, drawers, dropdown, layout animations, count-up hero) |
| Icons | `lucide-react` |
| Font | Plus Jakarta Sans (300–800) via `@fontsource/plus-jakarta-sans` — same as the host app |
| Phone validation | `libphonenumber-js` |
| Location | browser Geolocation API; map pin picker with Leaflet + OpenStreetMap (`ui/MapPicker.jsx`, loaded on demand) |

No component library: the kit (`ui/kit`) is hand-written on the tokens, including a custom dropdown, drawer, toasts and switch.

## Source layout

```
web/
├── index.html, host-demo.html        two entry pages (studio; host-app demo)
├── vite.config.js                    dev/build config; alias '@tstruct/react' -> src/embed/index.js
├── vite.lib.config.js                library build -> dist-lib/tstruct-react.js
└── src/
    ├── main.jsx                      studio entry: providers + route table
    ├── host-demo.jsx                 a fake host application using only the public package API
    ├── core/                         framework-free logic (no React)
    │   ├── api.js                    data functions (+ configure()), thin layer over localApi
    │   ├── conditions.js, validation.js, builderModel.js, format.js, logger.js
    │   ├── options.js                option types, "applicable to" blocks/logic (reuses evaluateCondition)
    │   ├── fieldTypes.js             field-type catalogue (icon names, not components)
    │   ├── tokens.js                 design tokens + buildTheme(mode, overrides)
    │   └── embedBridge.js            postMessage helper for iframes
    ├── ui/                           reusable React components (also exported)
    │   ├── kit/                      Text, Button/IconButton, Input, Select, SwitchField, Card/Badge/Avatar/Skeleton/EmptyState/HoverCard/Alert/IconTile, Sheet, Toast
    │   ├── options/                  OptionsList, OptionBuilder, OptionRun, ApplicableTo (self-contained; no router)
    │   ├── builder/                  StructBuilder, TypePickerSheet, FieldEditorSheet, SectionEditorSheet, FieldTypeExtras, ConditionEditor
    │   ├── DynamicForm.jsx, DynamicField.jsx, StructForm.jsx (StructForm + RecordList)
    │   ├── RecordTable.jsx, RecordDetail.jsx, RecordsBrowser.jsx
    │   ├── Provider.jsx              TstructProvider / Ensure
    │   ├── theme.jsx, hooks.js, icons.js
    └── studio/                       the standalone app: Shell, Sidebar, Page, StructsContext, pages/*
```
`core/` never imports React or the DOM, so it can be reused anywhere (a host can also import `evaluateCondition`, `validateField`, the API client…).

## Routes

| Route | Page | Notes |
|---|---|---|
| `/` | `pages/Home.jsx` | Overview (hero, count-up stats, struct cards); on narrow screens it renders the struct list |
| `/structs` | `Definitions.jsx` | Every definition (with key/field/section/record counts); click to edit |
| `/structs/new` | `StructPages.jsx` → `NewStruct` | Builder (create) |
| `/structs/:id/edit` | `EditStruct` | Builder pre-filled; warns when records exist |
| `/structs/:id/records` | `RecordPages.jsx` → `Records` | Table/cards + search + detail drawer |
| `/structs/:id/form` | `NewRecord` | Full-width form (1/2/3 columns) |
| `/structs/:id/record/:recordId` | `EditRecord` | Form pre-filled with a saved record |
| `/options` | `OptionPages.jsx` → `OptionsPage` | **Options** list (own sidebar entry; standalone feature, see [options.md](options.md)) |
| `/options/new`, `/options/:optionId/edit` | `OptionBuilderPage` | Option builder |
| `/options/:optionId/run` | `OptionRunPage` | Run an option (dataInput → `/structs/:id/form`, download, upload, placeholders) |
| `/embed/options`, `/embed/options/new`, `/embed/options/:id/edit\|run` | `OptionEmbed.jsx` | Chrome-less Options pages for iframes |
| `/embed/:structRef/form` | `Embed.jsx` | Chrome-less form for iframes (see [embedding.md](embedding.md)) |
| `/embed/:structRef/records` | `Embed.jsx` | Chrome-less records list |

`:id` / `:structRef` may be a struct id **or its key** (e.g. `/structs/leave-request/form`).

### Navigation
* Layout: fixed dark **sidebar** (288 px) + centre pane when the window is ≥ 960 px; below that the home route shows the struct list full-screen and the pages stack.
* Wide sidebar clicks use `replace` (no history spam), narrow ones `push`. Back = `navigate(-1)` (or `/` if there is no history).
* Saving/cancelling forms navigates with `replace` to the records / definitions route. Pages **remount on every route change**, so data is always fresh (no stale screens).
* The page body cross-fades on route change (`Page.jsx`).

## Design system

Everything visual comes from [`core/tokens.js`](../web/src/core/tokens.js) — no hex colours or magic numbers in components:

* `palette.light` / `palette.dark` (bg, surface, border, text*, **primary = coral `#ff7a59`** (hover `#ff6540`, active `#e6532e`), peach backgrounds (`bg #fff3eb`, `primarySoft #ffe2d1`), `glass`/`glassThick`/`glassBorder`/`blur` tokens for frosted surfaces, `gradient`, danger/success/warning + soft variants, navigation-chrome colours),
* `spacing`, `radius`, `type` scale, `shadow`, `layout` (sidebar width, breakpoints, max widths, control height, form grid breakpoints), `motion`.
* `buildTheme(mode, overrides)` — overrides let a host re-brand (`{ primary, gradient, ... }`, or per mode `{ dark: {...} }`).

`ui/theme.jsx`: `AppThemeProvider` (styled-components theme + light/dark/system, preference saved in `localStorage['tstruct.theme']` in the studio), `GlobalStyle` (studio only), `TstructRoot` (scoped reset for embedded components), `useThemeMode`.

Breakpoints: 960 px (sidebar vs stacked), 720 px (records table vs cards; drawer vs bottom sheet). The form grid is driven by the **width of the form container** (ResizeObserver, `useElementWidth`): 1 column < 620 px, 2 from 620 px, 3 from 980 px; multi-line text and location fields span the full row.

## Kit notes

* `Text` — `<Text $variant="body|bodyStrong|small|caption|label|title|heading|display" $color="textMuted" $ellipsis $lines={2}>`.
* `Button` — variants `primary` (coral gradient `#ff7a59→#ff5757` + warm glow, lifts on hover, squishes on press), `secondary`, `ghost`, `danger`; `icon` takes a lucide component; `testID` → `data-testid`.
* `Input` — `onChangeText(value)`, `icon`, `invalid`, `multiline`, `editable`; native input attributes pass through.
* **`Select`** — custom dropdown (portal): opens under the trigger (upward when short of room), search box from 8 options, arrows/Enter/Escape, check mark, "placeholder" row to clear. Roles: trigger `combobox`, rows `option` (`aria-selected`). `options` = `string[]` or `[{value,label}]`; `onChange(undefined)` clears.
* `Sheet` — right drawer (bottom sheet on narrow), portal, Esc/backdrop/X close.
* `HoverCard` — clickable card that lifts on hover; a plain `div` (may contain buttons).
* `useToast().show({ title, message, type })`.

## Options (`ui/options/`)
Self-contained screens (no router, no global nav state) so a host can import them or iframe their routes; the studio pages are thin wrappers that turn callbacks into navigation.
* `OptionsList` — cards (caption, type badge, "Config only", applicable-to summary), Run / Edit / Delete (confirmation drawer), search.
* `OptionBuilder` — id (read-only), caption, type dropdown, per-type config (`download` has upload-or-pick-a-file), and `ApplicableTo`.
* `ApplicableTo` — user categories (All / Selected + toggle chips + custom tags) and the **Affiliate scope** / **Employee scope** blocks, shown by `visibleBlocks()` = `evaluateCondition` on `{ userCategories }` (animated in/out like struct sections).
* `OptionRun` — `dataInput`: lookup by name → `onOpenStruct(struct)` (inline form when the callback is absent), "Struct not found" state; `download`: real browser download + "Download again"; `upload`: drop zone / picker → `fileId` → "Download it back"; other types: "isn't wired up yet".
* API helpers in `core/api.js`: `listOptions/getOption/createOption/updateOption/deleteOption`, `listFiles`, `uploadFile(file)` (stores the Blob in IndexedDB), `downloadFile(fileId)` (blob URL + temporary `<a download>`).

## State

No global store: `StructsProvider` (`studio/StructsContext.jsx`: `{ structs, error, refresh }` for sidebar/home/definitions — call `refresh()` after writes), the theme context, and local state per page.

## Data layer: `core/api.js` -> `core/localApi.js` -> `core/localDb.js`

There is no backend: data is stored in the browser (IndexedDB), see [local-storage.md](local-storage.md). `core/api.js` exposes the functions the UI uses; each one sends a REST-shaped request to `core/localApi.js` (validation, ids, timestamps, key lookup, sorting) which persists through `core/localDb.js`. Every call logs request, response/error and duration. Failures throw an `Error` with `.status` (400 / 404 / 409 / 413) and, for validation failures, `.details` (`[{fieldId, message}]`).

`configure({ user, storageName, maxUploadMb })` (`apiUrl`, `getAuthToken`, `headers` are still accepted but ignored). Every function takes a struct **id or key**:

`listStructs`, `getStruct`, `createStruct`, `updateStruct`, `listRecords(structRef, {ref})`, `getRecord`, `createRecord(structRef, data, {ref, meta})`, `updateRecord(structRef, recordId, data, {ref, meta})`, `listOptions/getOption/createOption/updateOption/deleteOption`, `listFiles`, `uploadFile`, `downloadFile`, and `fetchSelectionItems(apiUrl)` (the one real network call: it loads a `selection` field's options from the field's own external URL).

## The form engine (`ui/DynamicForm.jsx`)

* State: `values` (numbers as strings), `items` (selected raw item per selection field, for `fill`), `errors`.
* `effective` = values + computed `fill` values; conditions and validation read it.
* Visible fields = `struct.fields.filter(isFieldVisible)`; unsectioned first, then sections (collapsible). Fields appear/disappear with framer-motion (`AnimatePresence`).
* Progress bar = filled required visible fields / required visible fields.
* Submit: validate visible fields → inline errors + summary alert (re-opens collapsed sections with errors) or clean the data (numbers → `Number`, phone → E.164, empty and hidden fields dropped) → `onSubmit(data)`. Errors thrown with `.details` are shown per field.
* **Editing / pre-filling**: `initialValues`. Numbers become text; selection items are re-hydrated when options load; stored fill values show meanwhile.
* Props: `struct`, `onSubmit`, `onCancel`, `submitLabel`, `initialValues`, `intro`, `hideHeader`.

`StructForm` (`ui/StructForm.jsx`) wraps it: loads the struct (and record in edit mode), saves via the API, and reports through callbacks — this is the component hosts use.

## The builder model (`core/builderModel.js`)

* **Drafts** are form-friendly (strings for numbers, `options` as a comma string, conditions as `{fieldKey, operator, value}` referencing other drafts by `key`).
* `buildStructPayload(name, fields, sections, structKey)` → `{ payload }` or `{ error }`: validates (names, options, API URL, fill source, condition completeness, key pattern), assigns ids (an existing `draft.id` is preserved; new ids are camelCase of the label, de-duplicated), resolves conditions to field ids, and returns `key: <string|null>`.
* `structToDrafts(struct)` is the inverse (used by the edit page).

## Adding a new field type

1. **Store**: add to `FIELD_TYPES` and a `case` in `validateRecord` (both in `core/localApi.js`).
2. **Catalogue**: entry in `core/fieldTypes.js` (label, lucide icon name, tone, category, hint); add the icon to `ui/icons.js`.
3. **Builder**: options UI in `ui/builder/FieldTypeExtras.jsx`; map draft ⇄ definition in `core/builderModel.js`.
4. **Form**: input in `ui/DynamicField.jsx`; client rules in `core/validation.js`; cleaning in `DynamicForm.jsx` if needed.
5. **Display**: `core/format.js` (`formatValue`) if the value isn't a plain string/number.
6. Document it in [field-types-and-conditions.md](field-types-and-conditions.md) and [api.md](api.md); extend the e2e test.

## Logging & debugging

`core/logger.js` → `createLogger(scope)` prints `ISO time [level] [scope] message {data}`. Scopes: `api` (every request/response), `conditions` (every evaluation), `form`, `field`, `toast`. Use the browser console to see why a field is/isn't showing.

## Test hooks & accessibility

Interactive elements carry `data-testid`s and ARIA roles/labels (used by the e2e suite): `new-struct`, `nav-overview`, `nav-options`, `nav-definitions`, `new-option`, `option-<caption>`, `run-<caption>`, `edit-option-<caption>`, `delete-option-<caption>`, `option-caption`, `option-type`, `option-id`, `cfg-*`, `option-file-input`, `pick-file`, `selected-file`, `save-option`, `run-file-input`, `upload-drop`, `uploaded-file-id`, `not-wired`, `struct-not-found`, `applicable-to`, `cat-<name>`, `block-<affiliate|employee>`, `scope-<block>-<field>-(all|selected)`, `nav-struct-<name>`, `theme-toggle`, `home-struct-<name>`, `def-<name>`, `edit-<name>`, `add-record`, `edit-definition`, `record-<n>`, `record-detail`, `edit-record`, `struct-name`, `struct-key`, `add-field`, `add-section`, `type-<label>`, `field-name`, `save-field`, `section-name`, `save-section`, `field-row-<i>`, `save-struct`, `submit`. Sidebar items expose `aria-current="page"`; dropdown options `role="option"` + `aria-selected`; drawers `role="dialog"`.

## Builds

```bash
cd web
npm run dev          # http://localhost:8081  (studio at /, host demo at /host-demo.html)
npm run build        # static site -> web/dist   (set VITE_API_URL at build time)
npm run build:lib    # embeddable library -> web/dist-lib/tstruct-react.js  (react, react-dom, styled-components are external)
```
