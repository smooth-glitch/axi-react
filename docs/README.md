# Lite Tstruct Builder — Documentation

Lite Tstruct Builder is a small web app (and an embeddable component library) for defining **structs** (a unique name plus a list of typed fields, optionally grouped in sections, with conditional visibility) and collecting **records** against them through a dynamically rendered form.

| Layer | Technology |
|---|---|
| Backend | Node.js, Express 5, ioredis, pino |
| Datastore | Redis (only datastore — no SQL, no ORM, no RedisJSON) |
| Frontend | React 19 + Vite (studio app **and** embeddable component library `@tstruct/react`), styled-components, framer-motion |
| Auth | None in this version |

## Read this first

| Doc | What it covers |
|---|---|
| [Getting started](getting-started.md) | Prerequisites, install, run, environment variables, troubleshooting |
| [Architecture](architecture.md) | How the pieces fit together; the main flows end to end |
| [Backend](backend.md) | Express server structure, middleware, validation, logging |
| [Redis](redis.md) | Key layout, JSON shapes, which command each API call runs, operations tips |
| [API reference](api.md) | Every endpoint with request/response examples and error formats |
| [Options](options.md) | The standalone "Configuring Options" feature: the six option types, "applicable to", file upload/download, integration paths |
| [Field types & conditions](field-types-and-conditions.md) | The struct definition schema, all field types, validation rules, conditional logic |
| [Frontend](frontend.md) | React + Vite app: routes, components, design system, state, form engine, builds |
| [Testing](testing.md) | The Playwright end-to-end suite and manual smoke tests |
| [Embedding in another app](embedding.md) | Using a struct's form / records inside a host app: components, iframe + postMessage, keys, refs, auth |
| [React + Vite migration](vite-migration.md) | Record of the move from React Native Web (Expo) to React + Vite |

## Repository layout

```
lite-tstruct-builder/
├── server/            Express + ioredis API (port 4000)
│   └── src/
│       ├── index.js           app setup, CORS/auth/user middleware, request logging, routers, error handler
│       ├── lib/               logger.js, redis.js (logged helpers), validate.js, structRef.js, applicableTo.js
│       ├── routes/            structs.js, records.js, options.js, files.js
│       └── (uploads/)         uploaded files (git-ignored, created at runtime; server/uploads)
├── web/               React + Vite app (port 8081 in dev) and the @tstruct/react library
│   ├── index.html, host-demo.html
│   └── src/
│       ├── core/              framework-free logic: api client, conditions, validation, builder model, tokens…
│       ├── ui/                reusable components (kit, form engine, builder, records) — exported for hosts
│       ├── studio/            the standalone app: shell, sidebar, pages
│       └── embed/index.js     public API of the library
├── e2e/               Playwright end-to-end test (drives the real UI in Chrome)
├── docs/              this documentation
└── PROGRESS.md        living build log: what was built, decisions and deviations
```

## Concepts in one minute

* **Struct** — a definition: `{ id, key?, name, fields[], sections[], createdBy, createdAt, modifiedAt? }`. The optional `key` is a stable, readable alias usable wherever an id is. Stored in Redis as one JSON string.
* **Field** — one typed input (`text`, `date`, `time`, `wholeNumber`, `number`, `email`, `url`, `mobile`, `location`, `list`, `selection`, `fill`) with options such as `required`, `min`/`max`, `options`, `apiUrl`, `sectionId`, `condition`.
* **Section** — a named, collapsible group of fields; can carry a `condition`.
* **Condition** — `{ field, operator, value }` with operator `equals | notEquals | gt | lt | contains`. A field or section is shown only when its condition is true; the same evaluator logic runs on the client (live) and the server (validation).
* **Option** — a standalone, configurable action (`dataInput`, `download`, `upload` work; `apiDisplay`, `pay`, `axpertOption` are config-only), unrelated to any struct, with an "applicable to" audience rule (stored, not enforced). Uploaded files are kept on the server's disk. See [options.md](options.md).
* **Record** — one filled-in form: `{ id, structId, data, ref?, meta?, createdBy, createdAt, modifiedBy, modifiedAt }` (`ref`/`meta` let a host application link records to its own data). Records can be created and edited; struct definitions can also be edited.

For the living history of what was built and why, see [`../PROGRESS.md`](../PROGRESS.md).
