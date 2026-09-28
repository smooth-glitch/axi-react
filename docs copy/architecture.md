# Architecture

```
┌──────────────────────────── Browser ────────────────────────────┐
│  React + Vite app (studio)          host app → @tstruct/react     │
│  ┌──────────┐  ┌────────────────────────────────────────────┐   │
│  │ Sidebar  │  │ Centre pane (one route at a time)          │   │
│  │ structs  │  │ Overview · Definitions · Builder · Records │   │
│  │ (menu)   │  │ Form · Edit record · Edit definition       │   │
│  └──────────┘  └────────────────────────────────────────────┘   │
│        core/api.js ─► core/localApi.js ─► core/localDb.js         │
│        (same functions)  (rules, REST-shaped)   (IndexedDB)       │
└──────────────────────────────────────────────────────────────────┘
   struct  record  option  file(+blob)   — stored in this browser only
```

* **There is no backend.** Everything the Express + Redis server used to do — validation, ids, timestamps, key lookup, sorting, file storage — now runs in the browser ([local-storage.md](local-storage.md)). The former `server/` and `server-erlang/` folders have been deleted.
* The same frontend code builds two ways: the **studio** app and the **`@tstruct/react` library** that other applications embed ([embedding.md](embedding.md)).
* `core/api.js` keeps the function names, return values and error shape (`err.status`, `err.details`) the UI was written against, so the storage move touched no screen.
* `createdBy` / `modifiedBy` come from `configure({ user })` or default to `"anonymous"`.

## Design decisions

| Decision | Why |
|---|---|
| React + Vite (was React Native Web) | The UI is embedded in another React + Vite application, so it is plain React and also builds as a library ([vite-migration.md](vite-migration.md)) |
| Browser storage, no backend | The host project supplies no matching API for this feature yet; keeping the data local makes the feature self-contained. The seam (`core/api.js`) makes a server easy to bring back ([local-storage.md](local-storage.md#going-back-to-a-server-later)) |
| Definition-driven UI | Forms are rendered from the struct JSON at runtime (`DynamicForm` → `DynamicField`), so adding a struct needs no code |
| Validation on both layers | The form validates for instant feedback (`core/validation.js`); every write is validated again in `core/localApi.js` (required, ranges, formats), so hosts calling the API functions directly get the same guarantees |
| Field ids are stable | A field's `id` is generated from its name once, then never changes when the label is edited. Records reference values by field id, so renaming a field cannot orphan data |
| Edit = replace | Updating replaces the whole definition / record `data`. Existing records are not migrated when a definition changes |
| Only visible fields are saved | Fields hidden by a condition are skipped in validation and are not written to the record |
| Options are their own entity | An Option is unrelated to any struct (it may point at one by name), has its own storage, functions, screens and nav entry, and self-contained components so it can be linked, iframed or imported |
| Files as Blobs in IndexedDB | Uploaded files are stored next to their metadata (25 MB limit each); downloads are a temporary `<a download>` on a blob URL |
| Struct `key` | Struct ids are UUIDs; an optional unique, readable key lets other applications refer to a struct stably ([embedding.md](embedding.md)) |
| Record `ref` / `meta` | Let a host link records to its own entities and filter by them |

## Main flows

(Paths like `/api/structs` below are the REST-shaped calls `core/api.js` makes to `core/localApi.js`; nothing goes over the network.)

### 1. Create a struct
1. **Builder** (`/structs/new`, optional *Key*) keeps *drafts* (form-friendly strings) in React state.
2. **Save** → `buildStructPayload()` converts drafts to the definition JSON (generates field/section ids from names, converts draft conditions to `{field: <id>, operator, value}`, numeric values become numbers) and validates it client-side.
3. `createStruct` → the local API validates (`name`, non-empty `fields`, unique ids, known types, key pattern/uniqueness) and stores it in the `structs` store.
4. Sidebar list is refreshed (`StructsContext.refresh()`), a toast is shown, and the app opens the **form** route for the new struct.

### 2. Fill a form (create a record)
1. Records screen → **New record** → `/structs/:id/form`. The struct is loaded with `getStruct` (id or key).
2. `DynamicForm` renders unsectioned fields first, then each visible section. On **every** value change it re-evaluates `isFieldVisible()` for each field (its own condition and its section's), so fields/sections appear and disappear live.
3. `fill` fields are computed from the selected item of their source `selection` field; `selection` options are fetched from the field's `apiUrl` (an external API) at runtime.
4. **Submit** → client validation on visible fields → data cleaned (numbers → `Number`, phone → E.164, hidden fields dropped) → `createRecord` (optional `ref`/`meta`).
5. The local API runs `validateRecord()` (a 400-style error with per-field `details` on failure) and stores the record.
6. The app shows a toast and navigates back to the records screen, which loads fresh data on mount.

### 3. Browse and edit records
* Selecting a struct in the sidebar opens `/structs/:id/records` (table on wide panes, cards on narrow). Clicking a row opens the detail drawer.
* **Edit record** → `/structs/:id/record/:recordId`: `getStruct` + `getRecord`, then the same `DynamicForm` with `initialValues`. Submit → `updateRecord` (re-validated; keeps `id`, `createdAt`, `createdBy`; updates `modifiedAt`/`modifiedBy`).

### 4. Edit a definition
* Sidebar → **Definitions** (`/structs`) lists every struct with counts. Clicking one (or **Edit definition** on the records page) opens `/structs/:id/edit`: the builder pre-filled via `structToDrafts()`.
* Existing fields/sections keep their ids (`draft.id`); new ones get generated ids that avoid collisions. Save → `updateStruct`.
* Because records are not migrated: renaming is safe, removing a field hides its saved values, changing a field's type may leave old values invalid. The edit screen warns when records exist.

### 5. Options (standalone actions)
* **Create/edit** (`/options/new`): caption + type + per-type config + "applicable to" → `createOption` / `updateOption`. For a `download` option the builder first stores the file with `uploadFile` (or picks an earlier upload) and saves its `fileId`.
* **Run** (`/options/:id/run`): `dataInput` → `listStructs`, find the struct by name, navigate to `/structs/:id/form`; `download` → `downloadFile(fileId)` (blob → browser download); `upload` → file picker → `uploadFile` → show the `fileId`; other types → "not wired up yet".
* "Applicable to" is stored but **not enforced** (no user identity). Details: [options.md](options.md).

### 6. Conditions
* Stored on a field (`field.condition`) or a section (`section.condition`).
* `isFieldVisible(field, struct, formData)` → section condition AND field condition, used by the form and by `validateRecord`, which skips validation for hidden fields.
* Details: [field-types-and-conditions.md](field-types-and-conditions.md).

## Logging

`web/src/core/logger.js` — timestamp + level + scope. Logged: every API call (`api` scope: request, response/error, duration), local store operations (`local`), each condition evaluation (`conditions`), field changes (`form`), toasts, location capture. Open the browser console to debug.
