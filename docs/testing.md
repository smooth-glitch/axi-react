# Testing

## End-to-end suite — `e2e/e2e.js`

A single Playwright script that drives the **real UI in Chrome** against the running app, API and Redis, and also exercises the API directly.

### Run

```bash
# prerequisites: Redis, API (:4000) and the web app (`npm run dev` in web/, :8081) are running
cd e2e
npm install
node e2e.js            # or: npm test   (from the repo root: npm run e2e)
```

Environment overrides: `APP_URL` (default `http://localhost:8081`), `API_URL` (default `http://localhost:4000`), `CHROME_PATH` (default Windows Chrome path), `SHOTS_DIR` (where screenshots are written, default `.`).

Output is one `PASS`/`FAIL` line per check, then `N/N passed` (exit code `1` if anything failed). Screenshots (`picker.png`, `form_errors.png`, `records_detail.png`, `dropdown.png`, `definitions.png`, `narrow_detail.png`, `dark.png`, …) are saved for review; a failing step also saves `fail_<step>.png`.

### Side effects and cleanup

The run creates structs, records, options and uploaded files. At the end it deletes **every struct (and its records) that did not exist when it started** by talking to Redis directly (`../server/node_modules/ioredis`). If it crashes before cleanup, remove the leftovers with the snippet in [redis.md](redis.md#cleanup--reset). It also removes struct keys from the `structs:keys` hash, and the options and uploaded files (Redis + the files on disk) created during the run. A tiny mock HTTP server on port `4100` provides the `selection` API (`http://localhost:4100/vendors`). The host-application checks load `http://localhost:8081/host-demo.html` (see [embedding.md](embedding.md)).

### What it covers (264 checks)

| Area | Examples |
|---|---|
| Empty states | no structs → prompt + CTA |
| Shell | sidebar, overview stats, theme toggle (default light → dark → system → light) |
| Builder | type picker, all field types, editor drawer, sections, plain-language conditions, reorder / duplicate / remove, validation messages, saving, toast, sidebar active state |
| Stored definition | ids, ranges, options, phone country, fill wiring, numeric condition values, section condition |
| Form | bubble header + progress, conditional section/field show & hide, collapsible sections, client validation for every validated type, location capture, selection + fill, submit, toast |
| Records | table, detail drawer, search, stored data shape (numbers, E.164, location, hidden fields dropped), drawer close |
| Record editing | Edit from drawer, pre-filled values, conditional reveal, saving (`modifiedAt` bumped, `createdAt` kept), list refresh, selection/fill/location/mobile hydration, validation on edit, Discard |
| Definitions & editing | list with counts, search, edit route, warning when records exist, renamed field keeps its id, new field, sections/conditions survive, records untouched |
| Options + files | all six option types created through the UI, `dataInput` run → linked struct's form opens and a record is saved from it, "Struct not found", `download` (upload in the builder, attach, run → real browser download, byte-for-byte; pick an earlier upload), `upload` run → fileId → download it back (same bytes), placeholder "not wired up yet" states, applicable-to blocks appear/disappear by condition and are stored/dropped correctly, edit/delete, deep link + `/embed/options/*` + components inside a host page (no router), API validation for options/files |
| Embedding | struct key resolution (API + URLs), key validation/409, `ref`/`meta`/user header, `?ref=` filter, `<StructForm>` / `<RecordList>` in the host demo (pre-fill, brand override, edit mode, `onSubmitted` payload), iframe embed (no chrome, `ready`/`resize`/`submitted` messages, ref from URL), ref-filtered records embed |
| Dropdown | themed options, no search for short lists, keyboard (arrows/Enter/Escape), selected marker, clear row, search for long lists |
| Conditions | all five operators live, numeric vs string equality, API-down selection → error + Retry, 404 screens |
| Phone layout (400 px) | struct list as home, records as cards, detail as bottom sheet |
| API | 400/404 cases for structs and records, `PUT` for both, list counts, server-side mobile/list/time validation |

### Writing new checks

Helpers at the top of the script: `tid(id)`, `vis(locator)`, `field(label)`, `inputOf(label)`, `comboOf(label)` and `choose(combo, optionName)` (open the custom dropdown and click the option), `rows()` (table rows), `wait(ms)`. Prefer test ids, roles and visible text; conditional fields animate out, so wait ~300–500 ms after a change before asserting they are gone.

## Manual smoke tests (curl)

```bash
API=localhost:4000
# create a struct
SID=$(curl -s -X POST $API/api/structs -H 'content-type: application/json' \
  -d '{"name":"Smoke","fields":[{"id":"a","label":"A","type":"text","required":true}]}' | jq -r .structId)
# required-field validation → 400
curl -s -X POST $API/api/structs/$SID/records -H 'content-type: application/json' -d '{"data":{}}'
# create → 201, then edit → 200
RID=$(curl -s -X POST $API/api/structs/$SID/records -H 'content-type: application/json' -d '{"data":{"a":"hi"}}' | jq -r .recordId)
curl -s -X PUT $API/api/structs/$SID/records/$RID -H 'content-type: application/json' -d '{"data":{"a":"changed"}}'
curl -s $API/api/structs/$SID/records
```

## Not covered

* `API_TOKEN` / `CORS_ORIGINS` enforcement (verified manually with curl against a second server instance; not part of the suite).
* Load/performance testing.
* Cross-browser testing (Chrome only).
