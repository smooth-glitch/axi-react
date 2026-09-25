# Getting started

## Prerequisites

| Tool | Notes |
|---|---|
| Node.js 20+ | Developed on Node 22 |
| A modern browser | Chrome/Edge/Firefox/Safari (IndexedDB is used for storage) |

That is all: there is **no backend, no Redis and no database** to set up. Data is stored in the browser — see [local-storage.md](local-storage.md).

## Install

```bash
cd web && npm install
# optional: end-to-end tests
cd ../e2e && npm install
```

## Run — one command

From the repository root:

```bash
npm run dev
```

`scripts/dev.js` installs `web/` dependencies if `node_modules` is missing, starts the Vite dev server on **:8081** (reusing one that is already running) and prints `Ready -> http://localhost:8081`. **Ctrl+C** stops it.

Manually: `cd web && npm run dev` (or `npm run dev:web` from the root).

Open <http://localhost:8081>. The host-application demo is at <http://localhost:8081/host-demo.html> (see [embedding.md](embedding.md)).

## Configuration

There are no environment variables. A host application can call `configure({ user, storageName, maxUploadMb })` once at startup — see [local-storage.md](local-storage.md#hosts-and-embedding) and [embedding.md](embedding.md).

## Production builds

```bash
cd web
npm run build        # static site -> web/dist
npm run build:lib    # embeddable library -> web/dist-lib/tstruct-react.js
npm run preview      # serve web/dist locally
```

Serve `web/dist` from any static host **with an SPA fallback** (unknown paths → `index.html`, because routes like `/structs/...` are client-side). `host-demo.html` is built too and can be dropped if unwanted. Data is per origin, so changing the domain the site is served from starts with an empty app.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Vite says port 8081 is in use | Another dev server is running there (the port is strict, e2e expects 8081) |
| The app is empty after opening it somewhere else | Data is stored per browser profile and per origin ([local-storage.md](local-storage.md)) |
| Data disappeared | The user cleared site data / cookies, or used a private window (in-memory fallback) |
| "Something went wrong while saving your data in the browser." | The browser refused the write (storage full or blocked); free space or allow site storage |
| Selection field shows "Could not load options from …" | The field's `apiUrl` is unreachable, returns non-JSON, or blocks cross-origin requests. Use **Retry** once fixed, or edit the definition |
| Location capture does nothing | The browser blocked geolocation. Allow the permission (needs `https` or `localhost`) |

## Resetting data

In the browser: DevTools → Application → Storage → **Clear site data** (or delete the `tstruct` IndexedDB database). From code: `indexedDB.deleteDatabase('tstruct')` (or your `storageName`), then reload.
