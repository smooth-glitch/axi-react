# Embedding in another application

A host application (typically another React + Vite app) can show **a particular struct's form — in new-record or edit mode —**, list its records, and be told when something was saved. Three integration styles are built in and covered by the end-to-end suite (`host-demo.html`, [testing.md](testing.md)).

| Style | Best for | Where |
|---|---|---|
| **React components** (`@tstruct/react`) | React hosts (recommended) | `<StructForm />`, `<RecordList />`, `<TstructProvider />` |
| **iframe** | Any host / non-React | `/embed/:struct/form`, `/embed/:struct/records` + `postMessage` events |
| **Plain link** | Quick jump into the studio | `/structs/:struct/form` |

`:struct` / `struct=` is the struct's **id or its stable key** (e.g. `leave-request`) everywhere.

---

## 1. Stable struct key

Struct ids are UUIDs. Give a struct a readable **key** (builder → *Details → Key*, or the `key` property of `createStruct` / `updateStruct`) and use it in the host instead:

* Pattern: letter first, then letters/digits/`_`/`-`, max 64 chars, must not look like a UUID. Unique (409 if taken).
* Resolves everywhere a struct is referenced: `getStruct('leave-request')`, `createRecord('leave-request', …)`, `<StructForm struct="leave-request">`, `/structs/leave-request/form`.
* Stored on the struct itself; changing or removing a key takes effect immediately ([local-storage.md](local-storage.md)).

## 2. React components

Build the package and consume it (see *Packaging* below), then:

```jsx
import { configure, TstructProvider, StructForm, RecordList } from '@tstruct/react';

// once, at startup (or use <TstructProvider> props)
configure({
  user: 'alice@example.com',    // becomes createdBy / modifiedBy
  storageName: 'crm-tstruct',   // optional: IndexedDB database name (default 'tstruct')
});
// There is no backend: data is stored in the browser. apiUrl / getAuthToken / headers are still accepted but ignored.

function LeaveRequestPanel({ orderId }) {
  return (
    <TstructProvider theme={{ primary: '#0a7d5a', gradient: ['#4fd1a5', '#0a7d5a'] }} colorMode="light">
      <StructForm
        struct="leave-request"            // id or key
        mode="new"                        // or "edit" + recordId="…"
        initialValues={{ days: 3 }}       // pre-fill (new records)
        recordRef={`order-${orderId}`}    // links the saved record to your entity
        meta={{ source: 'crm' }}          // free-form JSON stored with the record
        onSubmitted={(record, { mode }) => console.log('saved', record.id)}
        onCancel={() => history.back()}
      />
      <RecordList struct="leave-request" recordRef={`order-${orderId}`}
                  onEditRecord={(record) => openEditor(record.id)} />
    </TstructProvider>
  );
}
```

### `<StructForm />`
| Prop | Meaning |
|---|---|
| `struct` *(required)* | struct id or key |
| `mode` | `'new'` (default) or `'edit'` |
| `recordId` | record to edit (`mode="edit"`) |
| `initialValues` | `{ fieldId: value }` pre-fill for a new record |
| `recordRef` | string saved as the record's `ref` (link to a host entity) |
| `meta` | object saved as the record's `meta` |
| `onSubmitted(record, { mode, struct })` | after a successful save |
| `onCancel()` | shows a **Discard** button |
| `onError(error)`, `onLoaded({ struct, record })` | lifecycle callbacks |
| `submitLabel`, `intro`, `hideHeader` | texts / hide the name header |
| `user`, `theme`, `colorMode` (and the ignored `apiUrl`, `getAuthToken`) | only used when **not** inside a `<TstructProvider>` |

The form fills the width of its container and lays fields out in 1/2/3 columns by the space it gets. Validation (form and store), conditions, sections, selection/fill fields all behave exactly as in the studio.

### `<RecordList />`
`struct`, `recordRef` (show only records with that `ref`), `onEditRecord(record)` (adds an **Edit record** button to the detail drawer), `onAdd()` (empty-state button), `refreshKey` (change it to reload).

### `<TstructProvider />`
`user`, `theme` (palette overrides — see `buildTheme` in `core/tokens.js`; flat keys apply to both modes, or `{ light: {...}, dark: {...} }`), `colorMode` (`'light' | 'dark'`; default follows the OS). All exported components work **without** a provider too (they create a default theme).

Also exported: `DynamicForm` (bring your own data loading), the API functions (`getStruct`, `createRecord`, …), `evaluateCondition`, `isFieldVisible`, `validateField`, `buildTheme`.

Styling is scoped: nothing global is injected into the host page (`TstructRoot` only affects its own subtree).

## 3. iframe + postMessage

```html
<iframe id="ts" style="width:100%;border:0"
  src="https://tstruct.example.com/embed/leave-request/form?ref=order-42&origin=https%3A%2F%2Fcrm.example.com"></iframe>
<script>
  window.addEventListener('message', (e) => {
    if (e.origin !== 'https://tstruct.example.com' || e.data?.source !== 'tstruct') return;
    if (e.data.type === 'tstruct:submitted') console.log('saved', e.data.record);
    if (e.data.type === 'tstruct:resize') document.getElementById('ts').style.height = e.data.height + 'px';
  });
</script>
```

**Form page** `/embed/:struct/form` — query parameters:

| Param | Meaning |
|---|---|
| `recordId` | edit that record instead of creating one |
| `values` | URL-encoded JSON of pre-filled values (new record) |
| `ref`, `meta` | stored on the record (`meta` is URL-encoded JSON) |
| `theme` | `light` or `dark` |
| `hideHeader=1` | hide the struct header |
| `submitLabel` | text of the submit button |
| `origin` | the host's origin — used as the `postMessage` target (default `*`; **set it in production**) |
| `apiUrl` | ignored (kept for compatibility — there is no API) |

**Records page** `/embed/:struct/records?ref=order-42` — the (optionally ref-filtered) list.

Messages the embed sends to `window.parent` (all `{ source: 'tstruct', type, ... }`):

| `type` | Payload |
|---|---|
| `tstruct:ready` | `{ structId }` — form loaded |
| `tstruct:submitted` | `{ structId, mode: 'new'|'edit', record }` |
| `tstruct:cancelled` | — |
| `tstruct:error` | `{ message }` |
| `tstruct:resize` | `{ height }` — for auto-sizing the iframe |

The embed page has no sidebar/header and a transparent background.

## 3b. Options in a host app

The standalone **Options** feature ([options.md](options.md)) can be used both ways:

* **Components** — `OptionsList`, `OptionBuilder`, `OptionRun` (self-contained, no router). Example:
  ```jsx
  <OptionsList onRun={(o) => setRunning(o)} onEdit={(o) => openBuilder(o.id)} />
  {running && <OptionRun option={running} onOpenStruct={(struct) => showFormFor(struct)} />}
  ```
  `onOpenStruct` is how a `dataInput` option asks the host to open a struct's form; without it the form is rendered inline. `download` / `upload` options work on their own. API helpers: `listOptions`, `createOption`, `uploadFile`, `downloadFile`, … (`downloadFile` sends the configured auth headers).
* **iframe** — `/embed/options` (list), `/embed/options/new`, `/embed/options/:id/edit`, `/embed/options/:id/run`; same query parameters as the form embed (`theme`, `origin`, `apiUrl`). Messages: `tstruct:option-saved { option, isNew }`, `tstruct:option-deleted { option }`, `tstruct:option-run { optionId, type }`, `tstruct:resize`. Inside the iframe, running a `dataInput` option navigates to `/embed/:struct/form`.
* **Plain link** — `/options` (the full studio).

`host-demo.html?options=1` shows the components in a fake host page.

## 4. Linking records to the host: `ref` and `meta`

Records may carry two optional fields set by the host:

* `ref` — string ≤ 200 chars, typically the host's own id (`"order-42"`). Filter with `listRecords(struct, { ref: 'order-42' })`.
* `meta` — a JSON object for anything else.

On update, omit them to keep, send a value to replace, or `null` to remove. Both are set automatically by `<StructForm recordRef meta>` / the iframe's `ref` and `meta` parameters. Details: [api.md](api.md) (the legacy contract, still what `core/api.js` follows).

## 5. Storage settings for hosts

There is no server, so no token, CORS or proxy setup. What a host controls:

| Setting | Effect |
|---|---|
| `configure({ user })` / `<TstructProvider user>` | becomes `createdBy` / `modifiedBy` when a save doesn't set one (default `"anonymous"`) |
| `configure({ storageName })` | the IndexedDB database used (default `"tstruct"`) — keeps a host's data apart from the studio's |
| `configure({ maxUploadMb })` | largest accepted upload (default 25) |

**Data is per browser and per origin.** Components rendered inside the host page store data under the host's origin; the `/embed/...` iframes store it under the origin that serves this app — so mixing both styles gives two separate data sets. Details and limits: [local-storage.md](local-storage.md).

## Packaging & consuming

```bash
cd web
npm run build:lib        # -> web/dist-lib/tstruct-react.js  (ES module, ~105 kB gzipped)
```
`react`, `react-dom` and `styled-components` are **externals** — the host must provide them (React 18.3.1 is what this library is built and tested with, styled-components 6) so there is a single copy.

Ways to consume it from another Vite project:
* **Monorepo/workspace or `file:` dependency**: `"@tstruct/react": "file:../lite-tstruct-builder/web"` (package `main`/`exports` point at `dist-lib`).
* **Publish** `web/` to your private npm registry (`npm publish` after `build:lib`) and install normally.
* **Source alias** (no build): in the host's `vite.config.js` alias `@tstruct/react` to `web/src/embed/index.js` — exactly what `host-demo.html` does in this repo.

Peer deps used at runtime by the bundle itself: `framer-motion`, `lucide-react`, `libphonenumber-js` are bundled into `dist-lib`; nothing else is needed.

### Try it

1. Start the web app (`npm run dev`, [getting-started.md](getting-started.md)).
2. Create a struct with a key (e.g. `leave-request`).
3. Open `http://localhost:8081/host-demo.html?struct=leave-request&ref=order-42` — the component variant (add `&brand=green` to see re-branding, `&values={"days":3}` for pre-fill, `&mode=edit&recordId=…` for edit mode).
4. Add `&iframe=1` for the iframe variant; the "Host event log" shows the messages received.

## Limitations / next steps
* Data lives in the visitor's browser: it is not shared between users or devices, and there is no per-user authorization ([local-storage.md](local-storage.md)).
* `postMessage` target defaults to `*` unless `origin` is passed.
* The library is not yet published to a registry, and has no TypeScript types.
