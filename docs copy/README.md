# Lite Tstruct Builder — Documentation

Lite Tstruct Builder is a small web app (and an embeddable component library) for defining **structs** (a unique name plus a list of typed fields, optionally grouped in sections, with conditional visibility) and collecting **records** against them through a dynamically rendered form.

| Layer | Technology |
|---|---|
| Backend | **None.** All data is stored in the browser (IndexedDB), see [local-storage.md](local-storage.md) |
| Datastore | The browser's IndexedDB (structs, records, options, files) |
| Frontend | React 18.3.1 + Vite 8.3.0 (studio app **and** embeddable component library `@tstruct/react`), styled-components, framer-motion |
| Auth | None in this version |

## Read this first

| Doc | What it covers |
|---|---|
| [Getting started](getting-started.md) | Prerequisites, install, run, builds, troubleshooting |
| [Local storage](local-storage.md) | How data is stored in the browser, what that means for hosts, how to go back to a server |
| [Architecture](architecture.md) | How the pieces fit together; the main flows end to end |
| [API reference](api.md) | The REST-shaped contract `core/api.js` follows internally (served by the in-browser store): calls, examples, errors |
| [Options](options.md) | The standalone "Configuring Options" feature: the six option types, "applicable to", file upload/download, integration paths |
| [Field types & conditions](field-types-and-conditions.md) | The struct definition schema, all field types, validation rules, conditional logic |
| [Frontend](frontend.md) | React + Vite app: routes, components, design system, state, form engine, builds |
| [Testing](testing.md) | The Playwright end-to-end suite and manual smoke tests |
| [Embedding in another app](embedding.md) | Using a struct's form / records inside a host app: components, iframe + postMessage, keys, refs, auth |
| [React + Vite migration](vite-migration.md) | Record of the move from React Native Web (Expo) to React + Vite |

## Repository layout

```
lite-tstruct-builder/
├── web/               React + Vite app (port 8081 in dev) and the @tstruct/react library
│   ├── index.html, host-demo.html
│   └── src/
│       ├── core/              framework-free logic: api.js (+ localApi.js / localDb.js, the in-browser data layer), conditions, validation, builder model, tokens…
│       ├── ui/                reusable components (kit, form engine, builder, records) — exported for hosts
│       ├── studio/            the standalone app: shell, sidebar, pages
│       └── embed/index.js     public API of the library
├── e2e/               Playwright end-to-end test (drives the real UI in Chrome)
├── docs/              this documentation
└── PROGRESS.md        living build log: what was built, decisions and deviations
```

## Concepts in one minute

* **Struct** — a definition: `{ id, key?, name, fields[], sections[], createdBy, createdAt, modifiedAt? }`. The optional `key` is a stable, readable alias usable wherever an id is. Stored in the browser (IndexedDB) as one JSON object.
* **Field** — one typed input (`text`, `date`, `time`, `wholeNumber`, `number`, `email`, `url`, `mobile`, `location`, `list`, `selection`, `fill`) with options such as `required`, `min`/`max`, `options`, `apiUrl`, `sectionId`, `condition`.
* **Section** — a named, collapsible group of fields; can carry a `condition`.
* **Condition** — `{ field, operator, value }` with operator `equals | notEquals | gt | lt | contains`. A field or section is shown only when its condition is true; the same evaluator logic runs on the client (live) and the server (validation).
* **Option** — a standalone, configurable action (`dataInput`, `download`, `upload` work; `apiDisplay`, `pay`, `axpertOption` are config-only), unrelated to any struct, with an "applicable to" audience rule (stored, not enforced). Uploaded files are kept on the server's disk. See [options.md](options.md).
* **Record** — one filled-in form: `{ id, structId, data, ref?, meta?, createdBy, createdAt, modifiedBy, modifiedAt }` (`ref`/`meta` let a host application link records to its own data). Records can be created and edited; struct definitions can also be edited.

For the living history of what was built and why, see [`../PROGRESS.md`](../PROGRESS.md).
