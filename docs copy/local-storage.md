# Data storage — everything lives in the browser

The app has **no backend**. Structs, records, options and uploaded files are stored in the user's browser (IndexedDB). Nothing is sent to a server, so there is nothing to install, start, secure or deploy besides the static site.

This replaced the former Express + Redis API (and its Erlang port), which have been removed from the repository (they remain in git history for `server/`). An e2e check fails if the app makes any request to `:4000`.

## How it works

```
UI / host components ──► core/api.js ──► core/localApi.js ──► core/localDb.js ──► IndexedDB
   (unchanged)             same exported     REST-shaped          object stores
                           functions         router + rules
```

* [`core/api.js`](../web/src/core/api.js) — the same exported functions as before (`listStructs`, `getStruct`, `createStruct`, `updateStruct`, `listRecords`, `getRecord`, `createRecord`, `updateRecord`, `listOptions`, …, `uploadFile`, `downloadFile`, `configure`), with the same return values and the same `Error` objects (`err.status`, `err.details`). No screen or component was changed to support the move.
* [`core/localApi.js`](../web/src/core/localApi.js) — a port of everything the server used to enforce: struct definition checks (name, non-empty fields, unique ids, known types, key pattern / uniqueness → 409), record validation for every field type (incl. phone numbers with `libphonenumber-js`, exactly as the Node server did), `ref` / `meta` rules, option config normalisation per type, "applicable to" normalisation, file size limit (413), 404s. It exposes `handle(method, path, body, { user })`, which speaks the same REST-shaped paths (`/api/structs/...`) and returns `{ status, body }`; the e2e suite uses it directly for its API-contract checks.
* [`core/localDb.js`](../web/src/core/localDb.js) — a small promise wrapper over IndexedDB with five object stores:

| Store | Key | Value |
|---|---|---|
| `structs` | `<structId>` | the struct definition (same JSON as before) |
| `records` | `<structId>:<recordId>` | the record |
| `options` | `<optionId>` | the option |
| `files` | `<fileId>` | file metadata (`id`, `originalName`, `mimeType`, `size`, `uploadedAt`, `uploadedBy`) |
| `blobs` | `<fileId>` | the file itself (a `File` / `Blob`) |

If IndexedDB is not available (some private modes), an in-memory store is used instead: the app keeps working but the data disappears when the page closes.

## What this means

| Topic | Behaviour |
|---|---|
| Who sees the data | Only this browser profile, on this **origin** (scheme + host + port). Another browser, another device or a private window sees an empty app |
| Persistence | Survives reloads and restarts. Lost if the user clears site data or the browser evicts it under storage pressure |
| Capacity | Browser quota (typically hundreds of MB to GB). Uploads are limited to 25 MB each (`configure({ maxUploadMb })`) |
| Several tabs | Tabs of the same origin share the data; a tab sees changes made in another on its next load (there is no live sync) |
| Backup / move data | Not built in. (Possible later: an export/import of the five stores as JSON + files) |
| Auth / CORS / rate limits | Not applicable — no network calls to secure. `createdBy` / `modifiedBy` come from `configure({ user })` or default to `"anonymous"` |
| Data from the old server | **Not migrated.** Anything created earlier through the Express/Erlang server (Redis) is not visible to the app |

## Hosts and embedding

* `configure({ user, storageName, maxUploadMb })` — `user` fills `createdBy` / `modifiedBy`; `storageName` (default `"tstruct"`) is the IndexedDB database name, use it to keep a host's data separate from the studio's. `apiUrl`, `getAuthToken` and `headers` are **still accepted but ignored**, so existing host code and `<TstructProvider apiUrl=…>` props keep working.
* **Components** (`<StructForm>`, `<RecordList>`, `<OptionsList>` …) rendered inside the host page store data under the **host's** origin.
* **iframe embeds** (`/embed/...`) run on the origin that serves this app, so their data is stored under **that** origin — a host that mixes iframes and components will therefore see two separate data sets. Pick one integration style per data set, or serve the app from the same origin as the host.
* `selection` fields still fetch their options from the field's own `apiUrl` (an external API you choose) — that is unrelated to the removed backend and works as before, subject to that API's CORS settings.

## Going back to a server later

The seam is `core/api.js`. To use a real backend again, replace the body of `request()` (and `uploadFile` / `downloadFile`) with `fetch` calls to the REST API documented in [api.md](api.md); a new server would implement that contract (the former Express implementation is in git history). `localApi.js` and `localDb.js` can then be deleted.

## Tests

`npm run e2e` (needs only the web app on :8081) — 281 checks, each run in a brand-new browser profile, so nothing needs cleaning up. See [testing.md](testing.md).
