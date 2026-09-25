# Backend

Node.js + Express 5 + ioredis. Plain CommonJS, no build step. Source in [`server/`](../server).

## Dependencies

| Package | Use |
|---|---|
| `express` 5 | HTTP server and routing (async handlers may throw; rejected promises reach the error handler) |
| `cors` | CORS: open by default, allow-list via `CORS_ORIGINS` |
| `ioredis` | Redis client |
| `uuid` | `v4` ids for structs and records |
| `pino` + `pino-pretty` | Structured, pretty-printed logging |
| `libphonenumber-js` | Server-side phone validation |
| `multer` | `multipart/form-data` uploads for `/api/files` (disk storage) |
| `nodemon` (dev) | `npm run dev` |

(`pino-http` is listed in `package.json` but unused — request logging is done by a small middleware; it can be removed.)

## Structure

```
server/src/
├── index.js            create app, cors + json body, request logging, mount routers, error handler, listen
├── lib/
│   ├── logger.js       pino instance (level from LOG_LEVEL, pretty transport, ISO timestamps)
│   ├── redis.js        ioredis client + logged helpers: getJSON / setJSON / sadd / smembers / scard
│   ├── applicableTo.js  normalizeApplicable() for options ("applicable to" blocks, reuses evaluateCondition)
│   ├── structRef.js    keyError() and resolveStructId(idOrKey) — struct key ⇄ id lookup (hash `structs:keys`)
│   └── validate.js     evaluateCondition() and validateRecord(struct, data)
└── routes/
    ├── options.js      /api/options            (create, list, get, update, delete; per-type config validation)
    ├── files.js        /api/files              (multipart upload, list, download stream)
    ├── structs.js      /api/structs            (create, list, get, update)
    └── records.js      /api/structs/:structId/records   (create, list, get, update)
```

### `index.js`
* CORS: `cors()` (any origin) or, when `CORS_ORIGINS` is set, only those origins. `express.json()` body parsing.
* Request logging middleware: logs `req.in` (method, path) and, on `finish`, `req.out` (status, ms).
* `GET /health` → `{ ok: true }` (never requires auth).
* `/api` guard: if `API_TOKEN` is set, requests without `Authorization: Bearer <token>` get `401 { error: "Unauthorized" }` (`auth.denied` is logged). The `X-Tstruct-User` header (max 200 chars) sets `req.user`, used as `createdBy`/`modifiedBy` when the body doesn't provide one.
* Routers: `app.use('/api/structs', structsRouter)` and `app.use('/api/structs/:structId/records', recordsRouter)` (the records router uses `express.Router({ mergeParams: true })` to read `:structId`).
* Error handler: logs `error` (message + stack) and responds `500 { error: "Internal server error" }`.
* Listens on `PORT` (default 4000).

### `lib/redis.js`
Thin wrapper so **every Redis read/write is logged** (`redis.get`, `redis.set`, `redis.sadd`, `redis.smembers`, `redis.scard`) with key and outcome:

| Helper | Redis command | Notes |
|---|---|---|
| `getJSON(key)` | `GET` | returns `JSON.parse(value)` or `null` |
| `setJSON(key, value)` | `SET` | stores `JSON.stringify(value)` — plain strings, **no RedisJSON module** |
| `sadd(setKey, member)` | `SADD` | |
| `smembers(setKey)` | `SMEMBERS` | |
| `scard(setKey)` | `SCARD` | used for record counts in the struct list |
| `hget` / `hset` / `hdel` | `HGET` / `HSET` / `HDEL` | the `structs:keys` hash (struct key → id) |

The exported `redis` instance is also available for ad-hoc use. Connection events (`connect`, `error`) are logged.

### `lib/validate.js`
* `evaluateCondition(condition, formData)` — mirrors `app/lib/conditions.js` (numbers compare loosely: `3` equals `"3"`).
* `validateRecord(struct, data)` → `{ valid, errors: [{ fieldId, message }] }`. See the rule table below.

### `routes/structs.js`
* `definitionError({ name, fields, sections })` — shared by POST and PUT.
* `POST /` create (optional `key`) · `GET /` list (id, key, name, createdAt, modifiedAt, fieldCount, sectionCount, recordCount) · `GET /:structRef` · `PUT /:structRef` replace (may set/change/remove `key`). `:structRef` is an id **or** a key.

### `routes/options.js`
Standalone **Options** (guide: [options.md](options.md)). `validateBody` checks the caption, the `type` (`dataInput`, `download`, `upload`, `apiDisplay`, `pay`, `axpertOption`), the per-type `config` (a `download` option's `fileId` must exist) and `applicableTo` (via `lib/applicableTo.js`). `POST`, `GET`, `GET /:id`, `PUT /:id`, `DELETE /:id` (the referenced file is kept).

### `lib/applicableTo.js`
Normalises the "applicable to" rule: fills defaults, lower-cases categories, requires values for `selected` scopes and **drops blocks whose condition is false** — each block (`affiliate`, `employee`) has a condition `{ field: 'userCategories', operator: 'contains', value }` evaluated with the same `evaluateCondition` as struct sections. Stored only; nothing enforces it. Keep in sync with `web/src/core/options.js`.

### `routes/files.js`
* `POST /` — multer disk storage into `UPLOAD_DIR` (default `server/uploads`), name `<uuid>-<sanitised original name>`, max `MAX_UPLOAD_MB` (default 25 → `413`), one file, field `file`. UTF-8 file names are decoded correctly (falls back to the raw name for clients that don't send UTF-8). Metadata → `file:<id>` + `files:index`.
* `GET /` — metadata list (no server paths).
* `GET /:fileId` — streams the file: `res.attachment(originalName)`, stored `Content-Type`, `Content-Length`, `X-Content-Type-Options: nosniff`. The stored path must resolve **inside** `UPLOAD_DIR` (defence in depth) or it is a `404`.
* CORS exposes `Content-Disposition` so browser code can read the file name.

### `routes/records.js`
* A router-level middleware resolves `:structId` (id or key) to the real id (`req.structId`).
* `POST /` create (validates; optional `ref`, `meta`) · `GET /[?ref=]` list newest first, optionally only records with that `ref` · `GET /:recordId` · `PUT /:recordId` replace `data` (validates; `ref`/`meta`: omit = keep, value = replace, `null` = remove).

Full request/response detail: [api.md](api.md).

## Validation rules

### Struct definition (`POST` / `PUT /api/structs`)
| Rule | Error |
|---|---|
| `name` is a non-empty string | `name is required` |
| `fields` is a non-empty array | `fields must be a non-empty array` |
| every field has `id`, `label`, and a `type` from the allowed list | `every field needs an id, a label and a valid type` |
| field ids are unique | `duplicate field id "<id>"` |
| `key` (optional) matches `^[A-Za-z][A-Za-z0-9_-]{0,63}$`, does not look like a UUID | `key must be 1-64 characters …` (400) |
| `key` is not already used | `key "<key>" is already in use` (409) |

Allowed types: `text date time wholeNumber number email url mobile location list selection fill`. `sections` defaults to `[]`. Conditions, `sectionId` references etc. are stored as sent (not cross-checked).

### Record links (`ref`, `meta`)
`ref` must be a string of at most 200 characters, `meta` a JSON object (not an array) — otherwise `400`.

### Record (`POST` / `PUT …/records`)
Applied per field of the struct, **skipping fields hidden by their own condition or their section's condition** (evaluated against the submitted `data`):

| Type | Server checks |
|---|---|
| any | `required` → value must not be `undefined`/`null`/`""` (`<label> is required`); empty optional values are skipped |
| `wholeNumber` | integer; `min`/`max` |
| `number` | numeric; `min`/`max` |
| `email` | `^[^\s@]+@[^\s@]+\.[^\s@]+$` |
| `url` | must start with `http://` or `https://` |
| `date` | `YYYY-MM-DD` and a real date; `min`/`max` (string comparison) |
| `time` | `HH:MM` 24h; `min`/`max` |
| `mobile` | valid number for `defaultCountry` (default `US`); E.164 input like `+919876543210` also works |
| `location` | object with numeric `lat` (±90) and `lng` (±180) |
| `list` | value must be one of `field.options` |
| `selection` | must be a string (options come from an external API, so membership is not checked) |
| `fill` | not validated (derived value) |

Failure response: `400 { "error": "Validation failed", "errors": [{ "fieldId": "days", "message": "Days must be <= 30" }] }`.

## Logging

pino with `pino-pretty` (colourised, `HH:MM:ss`). Events you will see:

`server.start`, `req.in`, `req.out`, `redis.connect`, `redis.error`, `redis.get`, `redis.set`, `redis.sadd`, `redis.smembers`, `redis.scard`, `options.create|list|get.notfound|update|update.notfound|delete|delete.notfound`, `files.upload|upload.rejected|list|download|get.notfound|stream.error`, `structs.create|list|get.notfound|update|update.notfound`, `auth.denied`, `redis.hget|hset|hdel`, `records.create|list|get.notfound|create.invalid|create.structNotFound|update|update.invalid|update.notfound|update.structNotFound`, `validate.record`, `error`.

Set `LOG_LEVEL=info` to hide the per-Redis-call debug lines. Note: the pretty transport is configured unconditionally (fine for development); for production switch `logger.js` to plain JSON output by removing the `transport` block.

## Extending

* **New field type**: add it to `FIELD_TYPES` in `routes/structs.js`, add a `case` in `validateRecord`, then follow the frontend checklist in [frontend.md](frontend.md#adding-a-new-field-type).
* **New endpoint**: add a route file, mount it in `index.js`, use the `lib/redis.js` helpers so it is logged, and document it in [api.md](api.md).
* **Real auth**: the shared-secret `API_TOKEN` gate is intentionally simple. For per-user auth, replace that middleware in `index.js` with your own (JWT/session) and set `req.user` from it.

## Known limitations

* No delete endpoints for structs, records or files (options can be deleted; an option's file stays).
* Uploaded files live on one server's disk (`server/uploads/`): multiple API instances would need shared storage; there is no virus scanning or per-file access control.
* Listing does one `GET` per id (N+1) — fine for hundreds, not for very large sets. See [redis.md](redis.md#scaling-notes).
* Writes are not atomic across the JSON value and its index set (no `MULTI`); a crash between the two commands could leave an unindexed record.
* Concurrent edits are last-write-wins (no version check).
