// Ported (behavior-preserving) from axi-databin-core.js / axi-databin-extras.js.
// See ../../../EXTRACTION_NOTES.md for line references and the vanilla originals.
// Persistence/backend calls (DataBinStore, _probeADSParams, buildActiveDataBinContext,
// applyPin, setActiveDataBin, ensureDataPinState) live in AXIBOT/axi-databin-services.js
// and are called here as window.* globals, not reimplemented.
import { ensureDataPinState, notify } from './store';

export const ACCEPTED_FILE_EXTENSIONS = ['.csv', '.xlsx', '.xls', '.txt', '.pdf', '.docx', '.json'];
export const MAX_SOURCES = 5;
export const MAX_FILES = 5;

export function dedupeBy(arr, keyFn) {
  const map = new Map();
  (arr || []).forEach((item) => {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, item);
  });
  return Array.from(map.values());
}

export function getDatasourceOptions() {
  if (!Array.isArray(window.DBLIST)) return [];
  return window.DBLIST
    .map((item) => ({ value: item?.name, label: item?.caption || item?.name }))
    .filter((item) => item.value && item.label);
}

// ── Step 1: datasource selection + SQL param probing ──────────────────────
// Mirrors core.js:964-1031 toggleDatasourceSelection exactly, including the
// 5-source cap, re-entrant-probe guard, and auto-expand-on-parameterized
// behavior (the auto-expand is now returned so the caller/component can track
// "expanded" state locally instead of via the old global Set).
export async function toggleDatasourceSelection(value, label, { onAutoExpand } = {}) {
  if (!value) return;
  const state = ensureDataPinState();
  const idx = state.sources.findIndex((src) => src.name === value);

  if (idx >= 0) {
    state.sources.splice(idx, 1);
    notify();
    return;
  }

  window._axiProbingADS = window._axiProbingADS || new Set();
  if (window._axiProbingADS.has(value)) return;
  if (state.sources.length >= MAX_SOURCES) {
    return { error: `Maximum ${MAX_SOURCES} datasources per Data Bin. Remove one before adding another.` };
  }
  window._axiProbingADS.add(value);

  state.sources.push({ name: value, caption: label || value, type: 'database', sqlParams: {}, _probeStatus: 'probing' });
  notify();

  try {
    const probe = await window._probeADSParams(value);
    const srcIdx = state.sources.findIndex((s) => s.name === value);
    if (srcIdx < 0) return; // removed while probing

    state.sources[srcIdx]._probeStatus = probe.status;

    if (probe.status === 'parameterized' && probe.params.length > 0) {
      const sp = {};
      probe.params.forEach((p) => { sp[p.name] = ''; });
      state.sources[srcIdx].sqlParams = sp;
      state.sources[srcIdx]._detectedParams = probe.params;
      onAutoExpand?.(srcIdx);
    }
  } catch (_e) {
    const srcIdx = state.sources.findIndex((s) => s.name === value);
    if (srcIdx >= 0) state.sources[srcIdx]._probeStatus = 'unknown';
  } finally {
    window._axiProbingADS.delete(value);
  }

  state.sources = dedupeBy(state.sources, (x) => x.name);
  notify();
}

export function removeSource(idx) {
  const state = ensureDataPinState();
  state.sources.splice(idx, 1);
  notify();
}

export function setSourceParam(idx, key, value) {
  const state = ensureDataPinState();
  if (state.sources[idx] && state.sources[idx].sqlParams) {
    state.sources[idx].sqlParams[key] = value;
    // No notify() here on purpose — mirrors the original's direct-mutation,
    // no-re-render-per-keystroke behavior for param inputs (core.js:2459-2462).
    // The input is uncontrolled-ish via defaultValue; see DatasourceChip.jsx.
  }
}

// ── Step 2: file upload ─────────────────────────────────────────────────
// Mirrors core.js:3941-4042 handleFiles. Returns a status object for the
// caller to render into the panel (replaces writing into #dataPinStatus directly).
export async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return null;

  const validFiles = files.filter((file) => {
    const lower = String(file.name || '').toLowerCase();
    return ACCEPTED_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
  });

  if (!validFiles.length) {
    return { type: 'error', message: 'No supported files were selected.' };
  }

  const state = ensureDataPinState();
  const currentCount = (state.files || []).length;
  const slotsLeft = MAX_FILES - currentCount;
  if (slotsLeft <= 0) {
    return { type: 'error', message: `Maximum ${MAX_FILES} files per Data Bin. Remove a file before adding more.` };
  }

  const filesToProcess = validFiles.slice(0, slotsLeft);
  const skipped = validFiles.length - filesToProcess.length;

  const savedFiles = [];
  const failedFiles = [];

  for (const file of filesToProcess) {
    if (window.AxiLibrary && typeof window.AxiLibrary.save === 'function') {
      try {
        const ok = await window.AxiLibrary.save(file);
        if (ok) savedFiles.push(file); else failedFiles.push(file.name);
      } catch (_e) {
        failedFiles.push(file.name);
      }
    } else {
      savedFiles.push(file);
    }
  }

  if (savedFiles.length) {
    state.files = dedupeBy(
      [...(state.files || []), ...savedFiles],
      (f) => [f.name, f.size, f.lastModified].join('::')
    );
    notify();
  }

  if (typeof window.AXI !== 'undefined' && typeof window.AXI.refreshFileSelect === 'function') {
    window.AXI.refreshFileSelect(false);
  } else if (typeof window.refreshFileSelect === 'function') {
    window.refreshFileSelect(false);
  }

  if (failedFiles.length && !savedFiles.length) {
    return { type: 'error', message: `Failed to upload: ${failedFiles.join(', ')}. File may be too large (>5 MB).` };
  }
  if (failedFiles.length) {
    return { type: 'error', message: `${savedFiles.length} file(s) added. Failed: ${failedFiles.join(', ')} (too large).` };
  }
  const totalFiles = (state.files || []).length;
  const addedNow = savedFiles.length;
  let message = `${addedNow === 1 ? '1 file' : `${addedNow} files`} added — ${totalFiles} file${totalFiles !== 1 ? 's' : ''} total in this Data Bin.`;
  if (skipped > 0) message += ` (${skipped} file${skipped > 1 ? 's' : ''} skipped — limit reached)`;
  return { type: 'success', message };
}

export function removeFile(idx) {
  const state = ensureDataPinState();
  state.files.splice(idx, 1);
  notify();
}

// ── Step 3 / save flow ──────────────────────────────────────────────────
export function dataBinHasAnyInput() {
  const state = ensureDataPinState();
  return (state.sources?.length || 0) > 0 || (state.files?.length || 0) > 0;
}

async function getNextDataBinNumber() {
  const pins = await window.DataBinStore.getAll();
  const nums = pins
    .map((pin) => {
      const match = String(pin.name || '').match(/^My Data Bin\s+(\d+)$/i);
      return match ? Number(match[1]) : 0;
    })
    .filter(Boolean);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

export async function getNextDefaultDataBinName() {
  const nextNum = await getNextDataBinNumber();
  return `My Data Bin ${nextNum}`;
}

// Mirrors core.js:4102-4256 saveCurrentDataBinOptional, minus the DOM status
// writes (returns a result object instead) and minus the setTimeout-then-close
// (the caller closes the wizard on success).
let saveInFlight = false;

export async function saveCurrentDataBin(finalName) {
  if (saveInFlight) return { type: 'error', message: 'Save already in progress.' };
  saveInFlight = true;
  const state = ensureDataPinState();

  try {
    if (!dataBinHasAnyInput()) {
      return { type: 'error', message: 'Add at least one datasource or one file before saving this Data Bin.' };
    }

    const missingParams = [];
    (state.sources || []).forEach((src) => {
      if (src._probeStatus !== 'parameterized') return;
      (Array.isArray(src._detectedParams) ? src._detectedParams : []).forEach((p) => {
        if (!String((src.sqlParams || {})[p.name] || '').trim()) {
          missingParams.push(`"${p.name}" in ${src.caption || src.name}`);
        }
      });
    });
    if (missingParams.length > 0) {
      return { type: 'error', step: 1, message: `Fill in all required parameters before saving: ${missingParams.join(', ')}` };
    }

    const name = String(finalName || state.name || '').trim();
    if (!name) {
      return { type: 'error', step: 3, message: 'Enter a name for this Data Bin.' };
    }

    if (window.DataBinStore && typeof window.DataBinStore.getAll === 'function') {
      try {
        const existingBins = await window.DataBinStore.getAll();
        const currentId = state.id;
        const duplicate = (existingBins || []).find(
          (b) => b.name && b.name.trim().toLowerCase() === name.trim().toLowerCase() && b.id !== currentId
        );
        if (duplicate) {
          return { type: 'error', step: 3, message: `A Data Bin named "${name}" already exists. Choose a different name.` };
        }
      } catch (_e) { /* non-fatal — proceed */ }
    }

    const oldBinName = state._originalName || state.name || '';
    const isNewBin = !state.id;
    let savedRecord = null;
    const now = Date.now();

    try {
      window.showLoader?.('Saving Data Bin...');

      const record = {
        id: state.id || window.crypto?.randomUUID?.() || `dp-${now}`,
        recordid: state.recordid || '',
        userKey: localStorage.getItem('axi_user_id') || localStorage.getItem('axi_api_key') || localStorage.getItem('axi_provider') || 'anonymous',
        name,
        createdAt: state.createdAt || now,
        updatedAt: now,
        datasources: Array.isArray(state.sources)
          ? state.sources.map((src) => ({
              name: src.name,
              caption: src.caption || src.name,
              type: 'database',
              sqlParams: (src.sqlParams && typeof src.sqlParams === 'object') ? src.sqlParams : {},
            }))
          : [],
        files: await Promise.all(
          (Array.isArray(state.files) ? state.files : []).map(async (file) => {
            let b64 = null;
            try {
              if (typeof file.arrayBuffer === 'function') {
                const ab = await file.arrayBuffer();
                const bytes = new Uint8Array(ab);
                let str = '';
                const chunk = 8192;
                for (let i = 0; i < bytes.length; i += chunk) {
                  str += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                }
                b64 = btoa(str);
              }
            } catch (_e) { /* fall through to metadata-only */ }
            if (!b64 && file.data) b64 = file.data;
            if (window.AxiLibrary && typeof window.AxiLibrary.save === 'function' && typeof file.arrayBuffer === 'function') {
              try { await window.AxiLibrary.save(file); } catch (_e) { /* non-fatal */ }
            }
            return {
              name: file.name,
              type: file.type || 'application/octet-stream',
              size: file.size || 0,
              lastModified: file.lastModified || now,
              data: b64,
            };
          })
        ),
      };

      if (!window.DataBinStore) throw new Error('DataBinStore is not available');
      const saved = await window.DataBinStore.save(record);
      savedRecord = record;
      state.id = record.id;
      state.recordid = (saved && saved.recordid) || record.recordid || state.recordid || '';
      state.createdAt = record.createdAt;
      state.name = record.name;

      if (oldBinName && oldBinName !== record.name && typeof window._axiSyncBinRename === 'function') {
        await window._axiSyncBinRename(oldBinName, record.name);
      }
      state._originalName = null;

      if (typeof window.setActiveDataBin === 'function') {
        window.setActiveDataBin(record.id, record.name);
      }

      await window.loadSavedPins?.();
      notify();

      return { type: 'success', message: 'Data Bin saved! It will be ready for analysis when assigned users activate it.' };
    } catch (error) {
      if (isNewBin && savedRecord && window.DataBinStore) {
        try {
          await window.DataBinStore.delete(savedRecord.id);
          state.id = null;
          state.recordid = '';
          await window.loadSavedPins?.();
        } catch (_e) { /* rollback best-effort */ }
      }
      return { type: 'error', message: 'Failed to save Data Bin. Check that all datasource parameters are satisfied.' };
    } finally {
      window.hideLoader?.();
    }
  } finally {
    saveInFlight = false;
  }
}

// ── Load / create / edit entry points ──────────────────────────────────
export async function loadExistingDataBin(id) {
  if (!window.DataBinStore) throw new Error('DataBinStore is not available');
  const pin = await window.DataBinStore.getById(id);
  if (!pin) return;

  const state = ensureDataPinState();
  state.id = pin.id || null;
  state.recordid = pin.recordid || '';
  state.createdAt = pin.createdAt || Date.now();
  state.name = pin.name || 'My Data Bin';
  state._originalName = state.name;
  state.sources = (pin.datasources || []).map((s) => ({
    name: s.name,
    caption: s.caption || s.name,
    type: 'database',
    sqlParams: (s.sqlParams && typeof s.sqlParams === 'object') ? s.sqlParams : {},
    _probeStatus: 'probing',
  }));
  state.files = (pin.files || []).map((f) => ({
    name: f?.name,
    type: f?.type || 'application/octet-stream',
    size: f?.size || 0,
    lastModified: f?.lastModified || Date.now(),
    data: f?.data || null,
  })).filter((f) => f.name);

  window.setActiveDataBin?.(pin.id, pin.name);
  notify();

  // Re-probe each loaded source to restore _probeStatus (not persisted) —
  // never overwrites saved sqlParams values.
  state.sources.forEach(async (src) => {
    const srcName = src.name;
    try {
      const probe = await window._probeADSParams(srcName);
      const srcIdx = state.sources.findIndex((s) => s.name === srcName);
      if (srcIdx < 0) return;
      state.sources[srcIdx]._probeStatus = probe.status;
      if (probe.status === 'parameterized' && probe.params.length > 0) {
        state.sources[srcIdx]._detectedParams = probe.params;
      }
    } catch (_e) {
      const srcIdx = state.sources.findIndex((s) => s.name === srcName);
      if (srcIdx >= 0) state.sources[srcIdx]._probeStatus = 'unknown';
    }
    notify();
  });
}

export async function startNewDataBin() {
  const nextName = await getNextDefaultDataBinName();
  window.dataPinState = { id: null, recordid: '', createdAt: null, sources: [], files: [], name: nextName };
  notify();
}
