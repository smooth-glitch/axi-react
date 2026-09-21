// React-facing action layer for the Admin Dashboard. Backend/persistence
// calls (AxSetValue/AxSubmitData/AxCallScriptAPIAsync, ADS reads) live in
// AXIBOT/axi-admin-services.js and are called here as window.AxiAdminService.*
// — not reimplemented. Pure ported logic (filter/sort/color-hash/provider
// metadata) that doesn't touch the backend lives here since it's presentation
// support, not persistence.
//
// Ported from axi-admin-dashboard.js — see EXTRACTION_NOTES equivalent
// (the research report in this conversation) for line references.

export const PROVS = ['openai', 'gemini', 'openrouter']; // anthropic hidden until MCP server is available
export const PM = {
  openai: { label: 'OpenAI', ph: 'sk-…' },
  anthropic: { label: 'Claude (Anthropic)', ph: 'sk-ant-…' },
  gemini: { label: 'Google Gemini', ph: 'AIza…' },
  openrouter: { label: 'OpenRouter', ph: 'sk-or-…' },
};

function fld(r, ...keys) {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null) return r[k];
  return '';
}
function rowId(r) { return r.a__xr1id || r.A__XR1ID || r.recordid || r.RECORDID || ''; }

export function rowGroup(r) { return fld(r, 'axusergroups', 'AXUSERGROUPS', 'groupname', 'GROUPNAME', 'group_name', 'GROUP_NAME', 'usergroup', 'USERGROUP'); }
export function rowUsername(r) { return fld(r, 'username', 'USERNAME'); }
export function rowBin(r) { return fld(r, 'binname', 'BINNAME', 'bin_name'); }
export function rowProvider(r) { return (fld(r, 'provider', 'PROVIDER') || '').toLowerCase(); }
export function rowKey(r) { return fld(r, 'providerkey', 'PROVIDERKEY', 'provider_key', 'PROVIDER_KEY'); }
export { rowId };

// ── Color-hash helpers (core.js:482-491 _grpColor/_binColor) ──────────────
const GRP_COLORS = [{ bg: '#EDE9FE', c: '#5B21B6' }, { bg: '#DCFCE7', c: '#166534' }, { bg: '#FEF3C7', c: '#92400E' }, { bg: '#FEE2E2', c: '#991B1B' }, { bg: '#DBEAFE', c: '#1D4ED8' }, { bg: '#FCE7F3', c: '#9D174D' }, { bg: '#D1FAE5', c: '#065F46' }, { bg: '#FEF9C3', c: '#713F12' }];
const BIN_COLORS = [{ bg: '#EDE9FE', c: '#5B21B6' }, { bg: '#DCFCE7', c: '#166534' }, { bg: '#FEF3C7', c: '#92400E' }, { bg: '#FEE2E2', c: '#991B1B' }, { bg: '#DBEAFE', c: '#1D4ED8' }, { bg: '#FCE7F3', c: '#9D174D' }, { bg: '#CCFBF1', c: '#134E4A' }, { bg: '#FFF7ED', c: '#9A3412' }];
function hash(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xFFFF;
  return h;
}
export function grpColor(name) { return GRP_COLORS[hash(name) % GRP_COLORS.length]; }
export function binColor(name) { return BIN_COLORS[hash(name) % BIN_COLORS.length]; }

// ── Assignment filter/sort (renderAssignments, core.js:528-598) ──────────
export function filterAssignments(rows, { search, providerFilter }) {
  const q = (search || '').toLowerCase().trim();
  const pf = (providerFilter || '').toLowerCase().trim();
  return rows.filter((r) => {
    if (pf && rowProvider(r) !== pf) return false;
    if (q) {
      const hit = rowGroup(r).toLowerCase().includes(q) || rowBin(r).toLowerCase().includes(q) || rowUsername(r).toLowerCase().includes(q);
      if (!hit) return false;
    }
    return true;
  });
}

export function sortAssignments(rows, sort) {
  const sorted = rows.slice();
  if (sort === 'az' || sort === 'za') {
    sorted.sort((a, b) => {
      const cmp = rowGroup(a).toLowerCase().localeCompare(rowGroup(b).toLowerCase());
      return sort === 'az' ? cmp : -cmp;
    });
  } else if (sort === 'provider') {
    sorted.sort((a, b) => rowProvider(a).localeCompare(rowProvider(b)));
  }
  return sorted; // 'latest' = as-loaded order, matches original
}

// ── Bin filter/sort (renderBins, core.js:656-679) ─────────────────────────
function binAssignedRows(bin, rows) {
  return rows.filter((r) => {
    const bf = rowBin(r);
    return bf === bin.name || (bf && bf.split(',').map((s) => s.trim()).includes(bin.name));
  });
}
export { binAssignedRows };

export function filterBins(bins, rows, { search, filter }) {
  const q = (search || '').toLowerCase();
  return bins.filter((b) => {
    if (q && !b.name.toLowerCase().includes(q)) return false;
    if (filter === 'assigned') return binAssignedRows(b, rows).length > 0;
    if (filter === 'unassigned') return binAssignedRows(b, rows).length === 0;
    return true;
  });
}

export function sortBins(bins, rows, sort) {
  const sorted = bins.slice();
  if (sort === 'az') sorted.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'za') sorted.sort((a, b) => b.name.localeCompare(a.name));
  else if (sort === 'assigned') sorted.sort((a, b) => binAssignedRows(b, rows).length - binAssignedRows(a, rows).length);
  return sorted; // 'latest' = already sorted by updatedAt from DataBinStore.getAll()
}

// ── Pagination (generic — replaces the string-templated _pagerHtml) ──────
export function paginate(items, page, perPage) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(1, page), pages);
  const start = (safePage - 1) * perPage;
  return { pageItems: items.slice(start, start + perPage), total, pages, page: safePage };
}

// ── Modal save flow (handleSave, core.js:1093-1165, minus DOM manipulation) ──
// Returns { ok: true } or { ok: false, message }.
export async function saveAssignment({ editRid, groupname, username, binname, provider, key, rows }) {
  if (!binname) return { ok: false, message: 'Please select at least one data bin.' };
  if (!provider) return { ok: false, message: 'Please select an AI provider.' };
  if (!key) return { ok: false, message: 'Please enter an API key.' };
  if (!groupname && !username) return { ok: false, message: 'Please select a user group or enter a username.' };

  const dup = rows.some((r) => {
    if (editRid && String(rowId(r)) === String(editRid)) return false;
    return rowGroup(r).trim() === (groupname || '').trim()
      && rowUsername(r).trim() === (username || '').trim()
      && rowBin(r).trim() === (binname || '').trim()
      && rowProvider(r) === provider.toLowerCase();
  });
  if (dup) return { ok: false, message: 'An identical assignment already exists (same user group, data bin and provider). Please modify at least one field.' };

  const selBins = binname.split(',').map((b) => b.trim()).filter(Boolean);
  const selGrps = groupname ? groupname.split(',').map((g) => g.trim()).filter(Boolean) : [];
  const conflicts = [];
  rows.forEach((r) => {
    if (editRid && String(rowId(r)) === String(editRid)) return;
    const rProv = rowProvider(r);
    if (rProv === provider.toLowerCase()) return;
    const rGrpList = rowGroup(r).split(',').map((g) => g.trim()).filter(Boolean);
    const rBinList = rowBin(r).split(',').map((b) => b.trim()).filter(Boolean);
    const grpMatch = selGrps.some((g) => rGrpList.includes(g)) || (username && username === rowUsername(r).trim());
    if (!grpMatch) return;
    selBins.forEach((b) => {
      if (rBinList.includes(b)) conflicts.push(`"${b}" is already assigned to this group via ${PM[rProv]?.label || rProv}`);
    });
  });
  if (conflicts.length) {
    const unique = [...new Set(conflicts)];
    return { ok: false, message: `Provider conflict:\n\n${unique.join('\n')}\n\nA data bin can only be assigned to a group under one provider.` };
  }

  try {
    await window.AxiAdminService.validateKey(provider, key);
  } catch (e) {
    return { ok: false, message: `API key validation failed: ${e.message || 'Invalid key'}` };
  }

  try {
    await window.AxiAdminService.saveRow({ rid: editRid, groupname, username, binname, provider, providerkey: key });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e && e.message) ? `Save failed: ${e.message}` : 'Save failed' };
  }
}

// ── Bin create/edit/delete orchestration (handleCreateBin/handleEditBin/
// handleDelBin, core.js:868-971) — hides the admin shell, opens the (already-
// React) Data Bin wizard, and restores the shell via the same
// window._axiAdmOnClose one-shot-callback contract the vanilla version used,
// since axi-admin-dashboard.js's boot() patches window.closeDataBinPage to
// invoke it on any close path. ──
export function handleCreateBin({ onHide, onShow }) {
  onHide();
  window.showLoader?.('Opening Data Bin wizard…');
  window.dataPinState = { id: null, createdAt: null, sources: [], files: [], name: 'My Data Bin' };

  if (typeof window.openDataBinPage === 'function') {
    window.openDataBinPage(1);
    window.hideLoader?.();
    window._axiAdmOnClose = function () {
      window.showLoader?.('Returning to dashboard…');
      setTimeout(async () => {
        onShow();
        await window.AxiAdminService.loadBins();
        window.hideLoader?.();
      }, 500);
    };
  } else {
    window.hideLoader?.();
    onShow();
    throw new Error('DataBin wizard not available');
  }
}

export async function handleEditBin(id, { onHide, onShow }) {
  onHide();
  window.showLoader?.('Opening bin editor…');
  if (typeof window.openExistingDataBin !== 'function') {
    window.hideLoader?.();
    onShow();
    throw new Error('DataBin wizard not available');
  }
  try {
    await window.openExistingDataBin(id);
  } catch (e) {
    console.warn('[AXI Admin] handleEditBin failed to load bin:', e);
  }
  window.hideLoader?.();
  window._axiAdmOnClose = function () {
    window.showLoader?.('Returning to dashboard…');
    setTimeout(async () => {
      onShow();
      await Promise.all([window.AxiAdminService.loadBins(), window.AxiAdminService.loadRows()]);
      window.AxiAdminService.buildKeyCache();
      window.hideLoader?.();
    }, 500);
  };
}

export async function handleDelBin(id, name) {
  window.showLoader?.('Deleting data bin…');
  await new Promise((r) => setTimeout(r, 50)); // flush paint before async work
  try {
    if (window.deleteDataBin) await window.deleteDataBin(id);
    else if (window.DataBinStore) await window.DataBinStore.delete(id);
    if (typeof window._axiSyncBinDelete === 'function') await window._axiSyncBinDelete(name);
    await Promise.all([window.AxiAdminService.loadBins(), window.AxiAdminService.loadRows()]);
    window.AxiAdminService.buildKeyCache();
  } finally {
    window.hideLoader?.();
  }
}
