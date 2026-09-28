# Options ("Configuring Options")

An **Option** is a standalone, configurable action or item. It is **not tied to any struct** (it can *point at* a struct, but it is its own entity with its own storage, API, screens and navigation entry). An option has a **caption**, a **type** (what happens when it is run), a type-specific **config**, and an **"applicable to"** audience rule.

Three of the six types are **functional** (they really do something when run); the other three are **configuration-only placeholders** that can be stored and listed but only show "not wired up yet" when run.

| Type | Status | `config` | What running it does |
|---|---|---|---|
| `dataInput` | **works** | `{ structName }` | Looks the struct up **by name** (case-insensitive; a struct `key` also matches) with `listStructs`, then opens that struct's form. "Struct not found" is shown if there is no match |
| `download` | **works** | `{ fileId }` | Calls `downloadFile(fileId)` and saves the file to the user's device (a real browser download, original file name) |
| `upload` | **works** | `{}` | Opens a file picker (or drag & drop), `uploadFile`, and shows the resulting `fileId`; the uploaded file can be downloaded straight back |
| `apiDisplay` | config only | `{ apiName, displayAs: 'table' \| 'nameValuePair' \| 'text' }` | "This option type isn't wired up yet" (+ the saved configuration) |
| `pay` | config only | `{ paymentConfig }` (plain string) | same |
| `axpertOption` | config only | `{ subtype: 'tstruct' \| 'smartView' \| 'iview' \| 'customPage', target }` | same |

Out of scope in this version: calling a real API for `apiDisplay`, a payment gateway for `pay`, linking to real Axpert modules, and **enforcing "applicable to"** at run time (there is no user identity yet).

## Where it lives

| | Route | Component (self-contained, no router) |
|---|---|---|
| List | `/options` | `<OptionsList onNew onRun onEdit onDeleted />` |
| Build / edit | `/options/new`, `/options/:optionId/edit` | `<OptionBuilder optionId onSaved onCancel />` |
| Run | `/options/:optionId/run` | `<OptionRun optionId onOpenStruct onEdit />` |

The sidebar has its own **Options** entry, separate from the struct flow. The three screens are self-contained components in `web/src/ui/options/` that use no router and no app navigation state; the studio pages (`studio/pages/OptionPages.jsx`) are thin wrappers that connect them to routes. See [Integration paths](#integration-paths).

### Screens
* **Options list** — caption, type badge ("Config only" for the placeholder types), an "applicable to" summary, created/edited time; **Run**, **Edit** (pencil) and **Delete** (with a confirmation drawer). Search box. Empty state "No options yet — create one".
* **Option builder** — *Option ID* (read-only; "Assigned when you save", then the uuid), *Caption*, *Option type* dropdown (all six), the per-type *Configuration* fields, and the *Applicable to* section.
  * `dataInput`: struct name (suggestions come from the existing struct names; any text is accepted and only looked up when the option is run).
  * `download`: **Upload a file** (stored in the browser via `uploadFile`) or **pick a previously uploaded file** from a dropdown; the attached file's name/size is shown.
  * `upload`: nothing to configure.
  * `apiDisplay`: API name + *Display as* (Table / Name-value pairs / Plain text). `pay`: payment configuration text. `axpertOption`: subtype + target.
* **Run screen** — see the table above. `dataInput` in the studio navigates to `/structs/:id/form`; in a host app without an `onOpenStruct` callback the form is rendered inline.

## "Applicable to"

Config only: it is stored with the option but **nothing enforces it** (no user identity exists). It reuses the **same conditional show/hide mechanism as struct sections** (`evaluateCondition`):

```jsonc
"applicableTo": {
  "userCategories": { "scope": "all" | "selected", "selected": ["affiliate", "employee", "guest"] },
  "affiliate": { "affiliates": { "scope": "all" | "selected", "selected": ["Acme"] } },
  "employee":  {
    "departments":  { "scope": "selected", "selected": ["HR", "Finance"] },
    "branches":     { "scope": "all", "selected": [] },
    "designations": { "scope": "all", "selected": [] }
  }
}
```

* **User categories** — a multi-select with scope *All* or *Selected*. `affiliate` and `employee` are the known categories (toggle buttons); others can be typed in (stored lower-case).
* **Affiliate scope** block — shown only when `{ field: "userCategories", operator: "contains", value: "affiliate" }` is true; contains *Affiliates* (all or selected).
* **Employee scope** block — shown only when `{ field: "userCategories", operator: "contains", value: "employee" }` is true; contains *Departments*, *Branches*, *Designations*, each all-or-selected.
* With scope **All**, every known category counts as selected, so both blocks are shown.
* The blocks are evaluated with the existing `evaluateCondition` against `{ userCategories: [...] }`. Its `contains` operator already supports "is this value in the multi-select array" (`web/src/core/conditions.js`), so **no extension was needed**.
* Like hidden fields in records, a block whose condition is false is **not saved**: the store drops it (`web/src/core/localApi.js`), and the builder only sends visible blocks.
* Validation: *Selected* needs at least one value (category, affiliate, department, …) — otherwise `400` / an inline error.
* The block definitions live in two places that must stay in sync: `web/src/core/options.js` (UI), which `web/src/core/localApi.js` (validation) imports — a single source now.

> Assumption: the exact "applicable to" shape was specified in a previous brief that was not available when this was built; the shape above follows the field/block/condition description given for this feature. If your original shape differs, only `core/options.js`, `core/localApi.js` (`normalizeApplicable`) and `ui/options/ApplicableTo.jsx` need to change.

## File storage

* `uploadFile(file)` stores the file itself (a `Blob`) and its metadata (`id`, `originalName`, `mimeType`, `size`, `uploadedAt`, `uploadedBy`) in the browser's IndexedDB (`blobs` / `files` stores) and resolves `{ fileId, file }`.
* `downloadFile(fileId)` reads it back and saves it to the user's device through a temporary `<a download>` on a blob URL, with the original file name (UTF-8 names preserved).
* `listFiles()` returns the metadata (so the builder can pick an earlier upload).
* Max size 25 MB (`configure({ maxUploadMb })`) -> a `413`-style error above it. There is no file delete; deleting an option leaves its file in place.
* Files live in this browser only, like everything else: clearing site data removes them. See [local-storage.md](local-storage.md).


## Integration paths

The feature was designed for **both** ways a host application can use it, with no changes needed here:

1. **Route / iframe (no code in the host)** — link or iframe the standalone route `/options` (studio chrome included) or the chrome-less embed routes `/embed/options`, `/embed/options/new`, `/embed/options/:id/edit`, `/embed/options/:id/run` (no sidebar; `theme`, `origin`, `apiUrl` query params; `postMessage` events `tstruct:option-saved`, `tstruct:option-deleted`, `tstruct:option-run`, `tstruct:resize`). Inside the iframe a `dataInput` option navigates to `/embed/:struct/form`.
2. **Import the components (React hosts)** — `import { OptionsList, OptionBuilder, OptionRun } from '@tstruct/react'` (plus `listOptions`, `createOption`, `uploadFile`, `downloadFile`, …). They need no router or global app state; the host decides what "open this struct" means via `OptionRun`'s `onOpenStruct(struct)` callback (without it the form renders inline). `host-demo.html?options=1` is a working example.

See [embedding.md](embedding.md).

## Tests

The end-to-end suite covers creating each type through the UI, running a `dataInput` option and landing on the linked struct's form (and saving a record from it), uploading a file in the builder and downloading it via a `download` option (byte-for-byte), running an `upload` option and downloading the same file back, the placeholder states, the applicable-to blocks, edit/delete, and the iframe/host-page reachability. See [testing.md](testing.md).
