# Data Bin Wizard — UI Extraction Notes

Working reference for writing the React version. Covers the UI-rendering pieces of
`axi-databin-core.js` / `axi-databin-extras.js` (the vanilla-JS Data Bin creation wizard).
The backend/persistence layer (DataBinStore, `_axiGetAdsRows`, `_resolveAxFns`,
`_saveDataBinRemote`, `_deleteDataBinRemote`, `ensureDataPinState`, `_probeADSParams`,
`buildActiveDataBinContext`, `applyPin`, `loadSavedPins`, `setActiveDataBin`/
`getActiveDataBinId`) has already been extracted **verbatim** into
`axi-databin-services.js` (in the `smooth-glitch/axibot` repo this project was
split out from) — call those `window.*` functions from React rather than
re-reading this file for them.

**Biggest finding, read this first:** `axi-databin-core.js` contains TWO parallel,
independent UI implementations for the datasource/file pickers:

1. **The live one** — a full-page wizard bound to the actual index.html markup
   (`#dataBinDatasourceGrid`, `#dataBinPanelFiles`, `#dataPinSourceList`,
   `#dataPinFileList`, etc.). This is what users actually see and is the one to port.
2. **A dead one** — an older custom-dropdown-modal implementation
   (`#dataPinDatasourceWrapper`, `#dataPinFileWrapper`, `#customOptionsList`,
   `#dataPinDatasourceList`, `#optionSearch`, `#dataPinDatasourceSearch`,
   `#dataPinModal`, `#selectedValue`, `#dataPinDatasourceValue`) whose target
   elements **do not exist anywhere in the current index.html**. Functions:
   `renderDataBinFileOptions` (core.js:1249 AND a byte-identical redeclaration at
   core.js:1501 — later one wins), `renderDatasourceOptions` (core.js:1391 and
   again at core.js:1465), `updateDataPinDatasourceValue`/`updateDataPinFileValue`
   (each declared twice: core.js:1155/1353/1427 and 1175/1372/1446),
   `initDataBinFileDropdown` (core.js:1538), `initDataBinDatasourceDropdown`
   (core.js:1616), `window.addSourceToPin`/`window.addFileToPin` (core.js:1309/1333),
   a local (non-window) `dataPinState`/`resetDataPinState` pair (core.js:2193/2244,
   never called anywhere), and `addStagedSourcesToDataPin` (core.js:2544).
   **None of this needs porting to React** — it has no HTML to attach to and is
   inert. Do not be confused by it while reading the file; it's noise, not signal.

Where a function name was declared twice, JavaScript keeps the **later** declaration
(function declarations in the same scope overwrite earlier ones) — I've noted which
copy is actually live in each case below.

---

## 1–2. `renderDatasourceCards` + search wiring (Step 1) — LIVE, full body below

`core.js:1033-1105`. Renders into `#dataBinDatasourceGrid`. Reads options from
`getDatasourceOptions()` (core.js:1142, maps `window.DBLIST` → `{value, label}`),
filters by `filterText`, and for each option renders a card button showing
selected/unselected state (`.dataBinDatasourceCard.is-selected`). Click/Enter on
a card calls `toggleDatasourceSelection(item.value, item.label)`.

```js
function renderDatasourceCards(filterText = "") {
    if (!dataBinDatasourceGrid) return;
    const q = String(filterText || "").trim().toLowerCase();
    const allOptions = getDatasourceOptions();
    const options = allOptions.filter(item =>
        String(item.label || "").toLowerCase().includes(q) ||
        String(item.value || "").toLowerCase().includes(q)
    );
    if (!options.length) { /* renders .dataBinEmptyState "No datasources found" */ updateDatasourceSelectionCount(); return; }
    dataBinDatasourceGrid.innerHTML = "";
    options.forEach(item => {
        const isSelected = !!window.ensureDataPinState().sources.some(src => src.name === item.value);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `dataBinDatasourceCard${isSelected ? " is-selected" : ""}`;
        btn.dataset.value = item.value;
        btn.dataset.label = item.label || item.value;
        btn.setAttribute("aria-pressed", isSelected ? "true" : "false");
        btn.innerHTML = /* icon + label + name + "Selected"/"Click to add" meta row — see core.js:1071-1086 for exact markup */ '';
        btn.addEventListener("click", async (e) => { e.preventDefault(); e.stopPropagation(); await toggleDatasourceSelection(item.value, item.label || item.value); });
        btn.addEventListener("keydown", async (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); await toggleDatasourceSelection(item.value, item.label || item.value); } });
        dataBinDatasourceGrid.appendChild(btn);
    });
    updateDatasourceSelectionCount();
}
```
Search wiring: `dataBinDatasourcePageSearch?.addEventListener("input", function () { renderDatasourceCards(this.value); })` (core.js:1126).

**`toggleDatasourceSelection(value, label)`** (core.js:964-1031) is the real selection
logic — a React port should model this as the click handler, not `renderDatasourceCards`:
- Deselecting: splice out of `state.sources`, remap `_axiExpandedParamChips` indices, re-render.
- Selecting: guard against >5 sources ("Maximum 5 datasources per Data Bin"), guard
  re-entrant probes via `window._axiProbingADS`, optimistically push with
  `_probeStatus: 'probing'`, call `_probeADSParams(value)` (now in the services
  file), then set `_probeStatus`/`_detectedParams`/`sqlParams` from the probe result
  and auto-expand the param editor (`window._axiExpandedParamChips.add(srcIdx)`) if parameterized.

`updateDatasourceSelectionCount()` (core.js:861-895, the LIVE one — no duplicate) updates
three things: `#dataBinDatasourceCount` ("N selected"), `#dataBinDatasourceAvailableCount`
("N total"), and `#dataBinSelectionPreview` (first 3 selected captions + "+N more").

---

## 3. Count/selection-preview updaters — which are live

- `updateDatasourceSelectionCount` — **core.js:861** — LIVE, single declaration, described above.
- `updateDataPinDatasourceValue` / `updateDataPinFileValue` (core.js:1155/1175,
  1353/1372, 1427/1446) — **all belong to the dead modal UI** (`#dataPinDatasourceValue`,
  `#selectedValue` don't exist in current markup as targets for these — `#selectedValue`
  IS a real element but it's the *upload modal's* selected-file label, not the wizard's).
  Skip all three declarations.

---

## 4–5. File upload: `handleFiles` + dropzone wiring (Step 2)

**⚠️ Behavior gap to know about before porting:** `#dataBinDropzone` and
`#dataBinPicker` (the actual Step-2 markup IDs) are **never referenced by any JS file**
(confirmed via grep across the whole project — zero hits outside index.html's own
markup). The wizard's Step 2 "Browse files" button and click-to-open behavior are
dead. What *does* work today: the whole `#dataBinPanelFiles` container (not the
inner dropzone div) is wired as a drag-and-drop target by a block appended after the
original upload-modal's dropzone setup (core.js:3905-3939), reusing the *original*
upload modal's `dropzone`/`picker` variables (`#dropzone`/`#picker`, defined
core.js:80-81) for `setDrag`/`handleFiles`. So: **drag-and-drop onto the Step 2 panel
works; clicking anywhere in it does not open a file picker.** Decide deliberately
whether the React version preserves this gap or fixes it (fixing it — wiring click →
open native file picker — is almost certainly the right call and is a trivial add).

```js
const setDrag = (on) => dropzone.classList.toggle('isDrag', !!on); // dropzone = #dropzone (upload modal), not #dataBinDropzone
['dragenter','dragover'].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); setDrag(true); }));
['dragleave','dragend','drop'].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); setDrag(false); }));
dropzone.addEventListener('click', () => picker.click());
picker.addEventListener('change', () => { if (picker.files.length) handleFiles(picker.files); picker.value = ''; });
dropzone.addEventListener('drop', e => { const dt = e.dataTransfer; if (dt && dt.files.length) handleFiles(dt.files); });

(function () {
    const _parents = [document.getElementById('dataBinPanelFiles'), document.getElementById('uploadModal')].filter(Boolean);
    _parents.forEach(container => {
        container.addEventListener('dragenter', e => { if (!Array.from(e.dataTransfer?.types||[]).includes('Files')) return; e.preventDefault(); setDrag(true); });
        container.addEventListener('dragover', e => { if (!Array.from(e.dataTransfer?.types||[]).includes('Files')) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
        container.addEventListener('dragleave', e => { if (!container.contains(e.relatedTarget)) setDrag(false); });
        container.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); setDrag(false); const dt = e.dataTransfer; if (dt && dt.files.length) handleFiles(dt.files); });
    });
})();
```

`handleFiles(fileList)` — **core.js:3941-4042**, full body, LIVE, single declaration:
- Filters to accepted extensions (`.csv .xlsx .xls .txt .pdf .docx .json`); if none
  valid, shows an error in `#dataPinStatus` and returns.
- Enforces 5-file cap against `window.dataPinState.files.length`; silently
  truncates extra files (`_skipped` count shown in the success message).
- For each accepted file, calls `AxiLibrary.save(file)` (from `axi-foundation.js`,
  IndexedDB-backed) if available, else keeps the file in-memory only.
- Merges into `window.dataPinState.files` via `dedupeBy` keyed on
  `[name, size, lastModified].join("::")`, then calls `renderDataPinFiles()`.
- Writes a success/error/partial message into `#dataPinStatus` (exact copy strings
  worth preserving — see core.js:4015-4033).
- Calls `window.AXI.refreshFileSelect(false)` or `refreshFileSelect(false)` if present.
- Resets `picker.value = ""`.

`renderDataPinFiles()` — **which copy is live:** declared at core.js:1195 (targets
`dataPinFileList`, dead-UI-adjacent but same element id as the live one — confusing)
AND again at core.js:2505 (the live one, reads from `window.ensureDataPinState()`,
renders `.attachmentChip` rows into `#dataPinFileList` — this is the selection rail's
file list, item 9 below). **core.js:2505's version wins** since it's declared later.
Both target the same `#dataPinFileList` id so functionally it doesn't matter much,
but use the 2505 body as your reference (it's the one actually consistent with
`ensureDataPinState()`).

---

## 6. SQL param editor (per-datasource, Step 1 rail)

Lives **inside** `renderDataPinSourceChips()` (core.js:2338-2502, see item 9) —
it's not a separate function. Also see `_probeADSParams` (now in
`axi-databin-services.js`) for how `_detectedParams`/`_probeStatus` get set, and
`toggleDatasourceSelection` (core.js:964, see item 1-2) for when probing kicks off.

Key UI bits inside `renderDataPinSourceChips`:
- A "Params" button (`.axParamConfigBtn`) appears on a chip only when
  `isAdmin && !isProbing && !isClean`; shows a badge with the param count if any
  are configured.
- Clicking it toggles `window._axiExpandedParamChips` (a `Set` of chip indices)
  and re-renders.
- The expanded editor (`.axParamEditor`) renders one `.axParamRow` per detected
  param (name label + type badge + text input bound to `src.sqlParams[key]`).
  Input `input` events write directly into `state.sources[idx].sqlParams[key]`
  (no debounce, no local component state in the original — every keystroke
  mutates global state directly).
- There's also dead-code support for *manual* (non-detected) param rows
  (`.axParamRow:not([data-detected])` with editable key + remove button,
  core.js:2467-2498) but nothing in the render path ever creates such a row —
  `editorRows` only builds `data-detected="true"` rows from `detected.forEach`.
  Likely vestigial from an earlier "manually add a param" feature; confirm with
  the user before deciding whether to port it.

CSS comment marker in styles.css confirming this is a deliberate distinct concern:
grep for `"PARAM EDITOR"` (mentioned in index.html's cascade-order comments too).

---

## 7. `openDataBinPage`, `closeDataBinPage`, `openExistingDataBin`, `startNewDataBin`

**⚠️ `openDataBinPage` and `closeDataBinPage` are each declared TWICE**, once in
`axi-databin-core.js` (below) and — for `closeDataBinPage` — monkey-patched again
in `axi-admin-dashboard.js:2082` (wraps the original to add post-close behavior for
the admin flow; preserve that wrapping pattern if you keep two files, or fold it
into one place in React). `openDataBinPage` also has a second caller convention:
`axi-databin-extras.js:280` calls `window.openDataBinPage("datasources")` (a
*string*), while core.js's own definition expects a *number* (`step = 1`) — passing
`"datasources"` as `step` flows into `renderDataBinStep("datasources")` where all
the `step === 1/2/3` comparisons fail, so that particular call effectively opens
with everything in its default (step-1-ish, via `dataBinPrevStepBtn`/`saveDataPinBtn`
visibility falling through the `else` implicitly) — worth a deliberate decision in
the rewrite rather than silently reproducing.

```js
// core.js:744
window.openDataBinPage = function (step = 1) {
    if (!dataBinPage) return;
    dataBinPage.hidden = false;
    document.body.style.overflow = "hidden";
    renderDataBinStep(step);
    if (typeof window.renderDataPinModal === "function") window.renderDataPinModal();
};

// core.js:798
window.closeDataBinPage = function () {
    if (!dataBinPage) return;
    dataBinPage.hidden = true;
    document.body.style.overflow = "";
};
```

`renderDataBinStep(step)` (core.js:821-858) is what actually drives step
navigation: sets `window.currentDataBinStep`, toggles `.is-active` on the three
tab buttons and three panels, toggles `hidden` on the panels, shows/hides
Prev/Next/Save buttons (`display: inline-flex`/`none` inline styles — not
classes), and on entering step 1 calls `loadDataSources()` +
`renderDatasourceCards(...)`, on step 2 calls `renderDataPinFiles()`, on step 3
seeds the name input if empty.

**Note:** `validateDataBinStep` (core.js:752) is defined then **immediately
overridden** later in the same boot function by
`window.validateDataBinStep = validateOptionalDataBinStep` (core.js:4277) — the
original required at least one source/file/name per step; the override
(`validateOptionalDataBinStep`, core.js:4077-4095) makes steps 1 and 2 fully
optional and only step 3 (name) still validates. **The override is what's live.**
Similarly `dataBinNextStepBtn`/`dataBinPrevStepBtn`/tab click handlers are bound
TWICE — once plainly (core.js:775-797, 2220-2230) and once via
`bindDataBinOverrideClick` with `stopImmediatePropagation` in the capture phase
(core.js:4281-4301), which is what actually fires in practice since it runs in
the capture phase and stops the earlier bubble-phase listeners. **Port the
override behavior** (steps 1/2 optional, capture-phase nav), not the original.

```js
// core.js:1803 — full body
async function openExistingDataBin(id) {
    try {
        if (!window.DataBinStore) throw new Error("DataBinStore is not available");
        const pin = await window.DataBinStore.getById(id);
        if (!pin) return;
        const state = window.ensureDataPinState();
        state.id = pin.id || null;
        state.recordid = pin.recordid || '';
        state.createdAt = pin.createdAt || Date.now();
        state.name = pin.name || "My Data Bin";
        state._originalName = state.name;
        state.sources = (pin.datasources || []).map(s => ({
            name: s.name, caption: s.caption || s.name, type: "database",
            sqlParams: (s.sqlParams && typeof s.sqlParams === 'object') ? s.sqlParams : {},
            _probeStatus: 'probing'
        }));
        state.files = (pin.files || []).map(f => ({
            name: f?.name, type: f?.type || "application/octet-stream", size: f?.size || 0,
            lastModified: f?.lastModified || Date.now(), data: f?.data || null
        })).filter(f => f.name);
        if (typeof setActiveDataBin === "function") setActiveDataBin(pin.id, pin.name);
        var _st = document.getElementById('dataPinStatus');
        if (_st) { _st.style.display = 'none'; _st.className = 'status'; _st.innerHTML = ''; }
        window.renderDataPinModal?.();
        window.openDataBinPage?.(1);
        // Re-probe each loaded source to restore _probeStatus (not persisted) — never overwrites saved sqlParams
        state.sources.forEach(async function (src) {
            const srcName = src.name;
            try {
                const probe = await _probeADSParams(srcName);
                const srcIdx = state.sources.findIndex(s => s.name === srcName);
                if (srcIdx < 0) return;
                state.sources[srcIdx]._probeStatus = probe.status;
                if (probe.status === 'parameterized' && probe.params.length > 0) state.sources[srcIdx]._detectedParams = probe.params;
            } catch (_) {
                const srcIdx = state.sources.findIndex(s => s.name === srcName);
                if (srcIdx >= 0) state.sources[srcIdx]._probeStatus = 'unknown';
            }
            renderDataPinSourceChips();
        });
    } catch (err) { console.error("Failed to open existing Data Bin", err); }
}
window.openExistingDataBin = openExistingDataBin;

// core.js:1861 — full body
async function startNewDataBin() {
    const nextName = await getNextDefaultDataBinName(); // extras.js:258 — "My Data Bin N", scans SAVED_PINS_CACHE/DataBinStore for next free N
    window.dataPinState = { id: null, recordid: '', createdAt: null, sources: [], files: [], name: nextName };
    if (dataBinNameInput) dataBinNameInput.value = nextName;
    var _st = document.getElementById('dataPinStatus');
    if (_st) { _st.style.display = 'none'; _st.className = 'status'; _st.innerHTML = ''; }
    window.renderDataPinModal?.();
    window.openDataBinPage?.(1);
}
window.startNewDataBin = startNewDataBin;
```
Note: `startNewDataBin` is ALSO declared in `axi-databin-extras.js:263-281` with an
identical body except it calls `window.openDataBinPage("datasources")` (the string
bug mentioned above) instead of `window.openDataBinPage(1)`. Since extras.js loads
*after* core.js, **extras.js's version is the one that ends up on `window`** (this
is explicitly called out in extras.js's own file-header comment). So the string-arg
variant is what actually runs today — factor that into the `openDataBinPage`
decision above.

Entry points: `#axiEsCreateBin`/`#axiCtrlCreateBin` click → `openDataPinBtn` listener
(core.js:1118) → `startNewDataBin()`. Admin dashboard edit action →
`window.openExistingDataBin(id)`. Close: `#closeDataBinPage` click
(core.js:1122) → `window.closeDataBinPage()`.

---

## 8. `saveCurrentDataBinOptional` — full body

**core.js:4102-4256.** This is the Save button's handler
(`window.saveCurrentDataBin = saveCurrentDataBinOptional`, bound to `#saveDataPin`
via `bindDataBinOverrideClick` at core.js:4303).

Flow: re-entrancy guard (`_inFlight` flag) → require at least one source or file
(`dataBinHasAnyInput`) → validate all parameterized sources have every detected
param filled in (jumps back to step 1 with an error listing missing params by
name) → require a non-empty name (jumps to step 3) → **client-side duplicate-name
check** against `DataBinStore.getAll()` (case-insensitive, excludes self by id) →
build the `record` object (id = existing or new UUID/timestamp fallback, files
re-encoded to base64 via `file.arrayBuffer()` chunked through `String.fromCharCode`
+ `btoa`, also re-saved to `AxiLibrary`) → `DataBinStore.save(record)` → on
success: update `state.id/recordid/createdAt/name`, cascade a rename via
`window._axiSyncBinRename` if the name changed, `setActiveDataBin`,
`loadSavedPins()`, success message, then `closeDataBinPage()` after a 180ms
timeout → on failure: if this was a brand-new bin, roll back by deleting the
half-created record, show an error → `finally`: `hideLoader()` + clear the
in-flight flag. Uses `window.showLoader('Saving Data Bin...')`/`hideLoader()`
around the whole thing. Full body already read verbatim in this session — see
core.js:4102-4256 directly rather than re-transcribing here (it's long and every
line is meaningful; skim it in the source when porting rather than trusting a
paraphrase).

---

## 9. Selection rail (`#dataPinSourceList` / `#dataPinFileList`) + expand/collapse

**Rendering** — `renderDataPinSourceChips()` (core.js:2338-2502, LIVE — full body
quoted under item 6) and `renderDataPinFiles()` (core.js:2505-2543, LIVE — quoted
under item 4-5). Both render `.attachmentChip` rows with a remove button
(`.attachmentChipremove`) that splices the item out of
`window.ensureDataPinState()` and re-renders.

**Expand/collapse — NOT in the databin files at all.** It's implemented in
`axi-ui-polish.js` around line 46-49 (`axiRailCollapseBtn`/`axiRailExpandBtn`/
`axiRailCloseExpand`/`axiRailCollapsedTab`). Read that file directly for the
toggle logic (adds/removes a class on `.dataBinSelectionRail`, likely
`.is-expanded`/`.is-collapsed` — check the exact class names in
axi-ui-polish.js before porting since I haven't transcribed that file here).
`#axiRailCollapsedCount` shows a running total (sources + files count, exact
formula not yet confirmed — check axi-ui-polish.js).

---

## 10. Step/tab navigation

Covered under item 7 — see the `renderDataBinStep` description and the note
about the capture-phase override (`bindDataBinOverrideClick`,
core.js:4257-4301) being what's actually live, not the original bubble-phase
listeners (core.js:775-797, 2220-2230, both dead-by-override but still
attached — harmless since `stopImmediatePropagation` in the capture phase
prevents them from ever running, but worth not reproducing the redundant
double-binding in React).

---

## 11. `renderDataPinModal` — distinct, tiny, LIVE

```js
// core.js:1237
window.renderDataPinModal = function () {
    const state = window.ensureDataPinState();
    if (dataBinNameInput) dataBinNameInput.value = state.name || "My Data Bin 1";
    renderDataPinSourceChips();
    renderDataPinFiles();
    renderDatasourceCards(dataBinDatasourcePageSearch?.value || "");
    updateDatasourceSelectionCount?.();
};
```
This is just an "re-render everything" convenience function called after any
state mutation from outside the normal UI flow (e.g. by `applyPin`,
`openExistingDataBin`, `startNewDataBin`). In React this collapses to "the
whole wizard re-renders when its state changes" — you likely won't need a
direct equivalent, just make sure whatever state store you use triggers a
re-render on the same events this is called from (grep `renderDataPinModal` in
axi-databin-services.js and axi-databin-extras.js for the call sites to replicate).

---

## Quick index: DOM ids the React wizard must produce/consume

Already inventoried in the earlier architecture report; unchanged. The
important thing this file adds is which of the *handlers* for those ids are
live vs. dead, and the three behavior quirks flagged with ⚠️ above
(Step-2 click-to-browse being dead, the `openDataBinPage` string-vs-number
argument mismatch, and the double-declared `closeDataBinPage`/`startNewDataBin`
functions where the later file's copy wins).
