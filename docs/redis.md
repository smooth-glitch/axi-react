# Redis

Redis is the **only** datastore. The app uses three data types:

* **Strings** holding `JSON.stringify(...)` values (read with `GET` + `JSON.parse`). The RedisJSON module is **not** used.
* **Sets** that act as indexes (members are ids).
* One **hash** (`structs:keys`) mapping a struct's optional readable `key` to its id.

Connection: `REDIS_HOST` (default `127.0.0.1`), `REDIS_PORT` (default `6379`), no password / DB index configured (database 0). See [`server/src/lib/redis.js`](../server/src/lib/redis.js).

## Key layout

| Key | Type | Value |
|---|---|---|
| `struct:<structId>` | string | JSON struct definition |
| `structs:index` | set | all `structId`s |
| `record:<structId>:<recordId>` | string | JSON record |
| `records:<structId>:index` | set | all `recordId`s of that struct |
| `structs:keys` | hash | `key` → `structId` for structs that have a key (e.g. `leave-request` → `5b0c…`) |
| `option:<optionId>` | string | JSON option (standalone configurable action) |
| `options:index` | set | all `optionId`s |
| `file:<fileId>` | string | JSON metadata of an uploaded file (the bytes are on the API server's disk, not in Redis) |
| `files:index` | set | all `fileId`s |

Ids are UUID v4 (`uuid` package).

```
structs:index                      → { s1, s2, ... }
struct:s1                          → {"id":"s1","name":"Leave Request", ...}
records:s1:index                   → { r1, r2, ... }
record:s1:r1                       → {"id":"r1","structId":"s1","data":{...}, ...}
```

## JSON shapes

### Struct — `struct:<structId>`
```json
{
  "id": "5b0c…",
  "key": "leave-request",
  "name": "Leave Request",
  "fields": [
    { "id": "employmentType", "label": "Employment type", "type": "list",
      "options": ["Full-time", "Contract"], "required": true },
    { "id": "companyName", "label": "Company name", "type": "text", "sectionId": "employerDetailsSec" },
    { "id": "days", "label": "Days", "type": "wholeNumber", "min": 1, "max": 30, "required": true,
      "condition": { "field": "employmentType", "operator": "equals", "value": "Full-time" } }
  ],
  "sections": [
    { "id": "employerDetailsSec", "label": "Employer details",
      "condition": { "field": "employmentType", "operator": "equals", "value": "Full-time" } }
  ],
  "createdBy": "anonymous",
  "createdAt": "2026-09-24T15:16:27.593Z",
  "modifiedBy": "anonymous",
  "modifiedAt": "2026-09-24T17:46:34.441Z"
}
```
`key` is optional; `modifiedBy` / `modifiedAt` exist only after the first edit. Field and section schemas: [field-types-and-conditions.md](field-types-and-conditions.md).

### Record — `record:<structId>:<recordId>`
```json
{
  "id": "0d7e…",
  "structId": "5b0c…",
  "data": {
    "employmentType": "Full-time",
    "days": 12,
    "startDate": "2026-10-01",
    "phone": "+919876543210",
    "siteLocation": { "lat": 12.9716, "lng": 77.5946 },
    "vendor": "v2",
    "vendorEmail": "globex@x.com"
  },
  "ref": "order-42",
  "meta": { "source": "crm" },
  "createdBy": "anonymous",
  "createdAt": "2026-09-24T15:35:00.000Z",
  "modifiedBy": "anonymous",
  "modifiedAt": "2026-09-24T15:35:00.000Z"
}
```
`ref` and `meta` are optional (set by a host application). Data conventions: numbers are stored as JSON numbers; dates as `YYYY-MM-DD`; times as `HH:MM`; mobile numbers in E.164; `location` as `{lat, lng}`; only fields visible at submit time are present.

### Option — `option:<optionId>`
```json
{ "id": "e82a…", "caption": "Apply for leave", "type": "dataInput", "config": { "structName": "Leave Request" },
  "applicableTo": { "userCategories": { "scope": "all", "selected": [] }, "affiliate": { "affiliates": { "scope": "all", "selected": [] } },
                    "employee": { "departments": { "scope": "all", "selected": [] }, "branches": { "scope": "all", "selected": [] }, "designations": { "scope": "all", "selected": [] } } },
  "createdBy": "anonymous", "createdAt": "…", "modifiedBy": "…", "modifiedAt": "…" }
```
`config` depends on `type` (see [options.md](options.md)); `modified*` only after an edit.

### File metadata — `file:<fileId>`
```json
{ "id": "c3a7…", "originalName": "policy.pdf", "mimeType": "application/pdf", "size": 300000,
  "storedPath": "<server>/uploads/c3a7…-policy.pdf", "uploadedAt": "…", "uploadedBy": "anonymous" }
```
`storedPath` is internal and is never sent to clients.

## Commands per API call

| Endpoint | Redis commands |
|---|---|
| `POST /api/structs` | `SET struct:<id>` → `SADD structs:index <id>` (with `key`: `HGET`/`GET` for the uniqueness check, then `HSET structs:keys <key> <id>`) |
| `GET /api/structs` | `SMEMBERS structs:index` → for each id: `GET struct:<id>` + `SCARD records:<id>:index` |
| `GET /api/structs/:idOrKey` | `GET struct:<ref>`; if missing → `HGET structs:keys <ref>` → `GET struct:<id>` |
| `PUT /api/structs/:idOrKey` | resolve (as above) → `GET struct:<id>` → `SET struct:<id>` (key changed: `HDEL` old, `HSET` new) |
| `POST /api/structs/:id/records` | `GET struct:<id>` → `SET record:<id>:<rid>` → `SADD records:<id>:index <rid>` |
| `GET /api/structs/:id/records` | `SMEMBERS records:<id>:index` → `GET record:<id>:<rid>` per member |
| `GET /api/structs/:id/records/:rid` | `GET record:<id>:<rid>` |
| `POST /api/options` | (`download`: `GET file:<id>` to check the file exists) → `SET option:<id>` → `SADD options:index <id>` |
| `GET /api/options` | `SMEMBERS options:index` → `GET option:<id>` per member |
| `GET /api/options/:id` | `GET option:<id>` |
| `PUT /api/options/:id` | `GET option:<id>` → `SET option:<id>` |
| `DELETE /api/options/:id` | `GET option:<id>` → `DEL option:<id>` → `SREM options:index <id>` |
| `POST /api/files` | file written to disk → `SET file:<id>` → `SADD files:index <id>` |
| `GET /api/files` | `SMEMBERS files:index` → `GET file:<id>` per member |
| `GET /api/files/:id` | `GET file:<id>` (then the file is streamed from disk) |
| `PUT /api/structs/:id/records/:rid` | `GET struct:<id>` → `GET record:<id>:<rid>` → `SET record:<id>:<rid>` |

Every call is logged by the server (`redis.get`, `redis.set`, `redis.sadd`, `redis.smembers`, `redis.scard`).

## Behavioural notes

* **Ordering**: sets are unordered. The API sorts lists **newest first by `createdAt`** in Node after loading them.
* **Editing** overwrites the JSON string; the id sets are untouched (ids never change).
* **Definition changes do not touch records.** Records keep whatever `data` they were saved with; the UI shows current field labels against old values by field id.
* **No deletes** are exposed by the API, so nothing is ever removed from the sets by the app. (Only the `structs:keys` hash changes when a key is renamed/removed.)
* **Atomicity**: `SET` + `SADD` are two separate commands (no `MULTI`). Practically safe for this scale; wrap them in `redis.multi()` if you need strict consistency.
* **Concurrency**: last write wins.

## Inspecting data

```bash
redis-cli smembers structs:index
redis-cli get struct:<structId> | jq
redis-cli smembers records:<structId>:index
redis-cli get record:<structId>:<recordId> | jq
redis-cli scard records:<structId>:index          # record count
redis-cli --scan --pattern 'record:<structId>:*'  # every record key of one struct
redis-cli monitor                                  # watch the API's commands live
```

## Cleanup / reset

> Uploaded **files live on disk** (`server/uploads/`), not in Redis. Removing `file:*` keys does not delete the bytes: also delete the file at `storedPath`. Redis and `server/uploads/` should be backed up together.

Remove one struct and its records (Node, from the repo root):
```js
const Redis = require('./server/node_modules/ioredis');
const r = new Redis();
const id = '<structId>';
for (const rid of await r.smembers(`records:${id}:index`)) await r.del(`record:${id}:${rid}`);
await r.del(`records:${id}:index`, `struct:${id}`);
await r.srem('structs:index', id);
if (struct.key) await r.hdel('structs:keys', struct.key); // struct = the parsed struct JSON, read before deleting it
```
Everything: see [Getting started → Resetting data](getting-started.md#resetting-data). The end-to-end suite performs exactly this cleanup for the structs it creates.

## Scaling notes

* List endpoints do N+1 reads. If record volume grows, switch to `MGET` (one round trip) or pipeline the `GET`s, and add pagination (e.g. a sorted set `records:<structId>:by-created` scored by timestamp, read with `ZREVRANGE`).
* Search is done in the browser over the loaded list. For large data, add server-side filtering or a secondary index.
* If several API instances are run, they can share the same Redis without changes (the server is stateless).
* For durability enable Redis persistence (AOF or RDB) — the app relies entirely on it.
