# Architecture

```
┌──────────────────────────── Browser ────────────────────────────┐
│  React + Vite app (studio)          host app → @tstruct/react     │
│  ┌──────────┐  ┌────────────────────────────────────────────┐   │
│  │ Sidebar  │  │ Centre pane (one route at a time)          │   │
│  │ structs  │  │ Overview · Definitions · Builder · Records │   │
│  │ (menu)   │  │ Form · Edit record · Edit definition       │   │
│  └──────────┘  └────────────────────────────────────────────┘   │
│        core/api.js ── fetch (JSON, logged) ──┐                  │
└──────────────────────────────────────────────┼──────────────────┘
                                               ▼
                       Express API  (server/, port 4000)
                       routes → validation → lib/redis.js
                                               ▼
                                            Redis
   struct:<id>  records:<id>:index  record:<id>:<rid>  structs:index  structs:keys
```

* The frontend and backend are independent processes that only talk over the REST API described in [api.md](api.md).
* The same frontend code builds two ways: the **studio** app and the **`@tstruct/react` library** that other applications embed ([embedding.md](embedding.md)).
* Redis is the only datastore. Everything is stored as JSON strings (`SET`/`GET`), Redis Sets as indexes and one hash for struct keys. See [redis.md](redis.md).
* Optional shared-secret auth (`API_TOKEN`) and a CORS allow-list (`CORS_ORIGINS`); the acting user can be passed in `X-Tstruct-User`. Otherwise `createdBy` / `modifiedBy` default to `"anonymous"`.

## Design decisions

| Decision | Why |
|---|---|
| React + Vite (was React Native Web) | The UI is embedded in another React + Vite application, so it is plain React and also builds as a library ([vite-migration.md](vite-migration.md)) |
| Definition-driven UI | Forms are rendered from the struct JSON at runtime (`DynamicForm` → `DynamicField`), so adding a struct needs no code |
| Validation on both sides | The client validates for instant feedback; the server re-validates every write (required, ranges, formats) because it is the source of truth |
| Two small copies of the condition logic | `web/src/core/conditions.js` and `server/src/lib/validate.js` implement the same `evaluateCondition`. They are kept in sync by hand (no shared package in this small monorepo) |
| Field ids are stable | A field's `id` is generated from its name once, then never changes when the label is edited. Records reference values by field id, so renaming a field cannot orphan data |
| Edit = replace | `PUT` replaces the whole definition / record `data`. Existing records are not migrated when a definition changes |
| Only visible fields are saved | Fields hidden by a condition are skipped in validation and are not written to the record |
| Options are their own entity | An Option is unrelated to any struct (it may point at one by name), has its own storage, API, screens and nav entry, and self-contained components so it can be linked, iframed or imported |
| Files on local disk | Uploads are stored under `server/uploads/` with metadata in Redis; simple for one server, needs shared storage to scale out |
| Struct `key` | Struct ids are UUIDs; an optional unique, readable key lets other applications refer to a struct stably ([embedding.md](embedding.md)) |
| Record `ref` / `meta` | Let a host link records to its own entities and filter by them |

## Main flows

### 1. Create a struct
1. **Builder** (`/structs/new`, optional *Key*) keeps *drafts* (form-friendly strings) in React state.
2. **Save** → `buildStructPayload()` converts drafts to the definition JSON (generates field/section ids from names, converts draft conditions `{fieldKey, operator, value}` to `{field: <id>, operator, value}`, numeric values become numbers) and validates it client-side.
3. `POST /api/structs` → server validates (`name`, non-empty `fields`, unique ids, known types) → `SET struct:<uuid>` + `SADD structs:index`.
4. Sidebar list is refreshed (`StructsContext.refresh()`), a toast is shown, and the app opens the **form** route for the new struct.

### 2. Fill a form (create a record)
1. Records screen → **New record** → `/structs/:id/form`. The struct is fetched with `GET /api/structs/:id`.
2. `DynamicForm` renders unsectioned fields first, then each visible section. On **every** value change the component re-renders and re-evaluates `isFieldVisible()` for each field (its own condition and its section's), so fields/sections appear and disappear live (with animations).
3. `fill` fields are computed from the selected item of their source `selection` field; `selection` options are fetched from the field's `apiUrl` at runtime.
4. **Submit** → client validation (`lib/validation.js`) on visible fields → data cleaned (numbers → `Number`, phone → E.164, hidden fields dropped) → `POST /api/structs/:id/records` (id or key; optional `ref`/`meta`).
5. Server loads the struct, runs `validateRecord()` (400 with per-field errors on failure), then `SET record:<sid>:<rid>` + `SADD records:<sid>:index`.
6. The app shows a toast and navigates back to the records screen, which loads fresh data on mount.

### 3. Browse and edit records
* Selecting a struct in the sidebar opens `/structs/:id/records` (table on wide panes, cards on narrow). Clicking a row opens the detail drawer.
* **Edit record** → `/structs/:id/record/:recordId`: `GET struct` + `GET record`, then the same `DynamicForm` with `initialValues`. Submit → `PUT /api/structs/:id/records/:recordId` (server re-validates; keeps `id`, `createdAt`, `createdBy`; updates `modifiedAt`/`modifiedBy`).

### 4. Edit a definition
* Sidebar → **Definitions** (`/structs`) lists every struct with counts. Clicking one (or **Edit definition** on the records page) opens `/structs/:id/edit`: the builder pre-filled via `structToDrafts()`.
* Existing fields/sections keep their ids (`draft.id`); new ones get generated ids that avoid collisions. Save → `PUT /api/structs/:id`.
* Because records are not migrated: renaming is safe, removing a field hides its saved values, changing a field's type may leave old values invalid. The edit screen warns when records exist.

### 5. Options (standalone actions)
* **Create/edit** (`/options/new`): caption + type + per-type config + "applicable to" → `POST/PUT /api/options`. For a `download` option the builder first uploads the file with `POST /api/files` (or picks an earlier upload) and stores its `fileId`.
* **Run** (`/options/:id/run`): `dataInput` → `GET /api/structs`, find the struct by name, navigate to `/structs/:id/form`; `download` → `GET /api/files/:fileId` (fetch + blob → browser download); `upload` → file picker → `POST /api/files` → show the `fileId`; other types → "not wired up yet".
* "Applicable to" is stored but **not enforced** (no user identity). Details: [options.md](options.md).

### 6. Conditions
* Stored on a field (`field.condition`) or a section (`section.condition`).
* Client: `isFieldVisible(field, struct, formData)` → section condition AND field condition.
* Server: `validateRecord` skips validation for fields whose condition (or section condition) is false, using the submitted `data`.
* Details: [field-types-and-conditions.md](field-types-and-conditions.md).

## Logging

* **Backend**: pino (pretty-printed) — every request in/out with duration, every Redis read/write, validation results, errors.
* **Frontend**: `web/src/core/logger.js` — timestamp + level + scope. Logged: every API call (request, response/error, duration), each condition evaluation (`conditions` scope), field changes (`form` scope), toasts, location capture. Open the browser console to debug why a field is/isn't showing.
