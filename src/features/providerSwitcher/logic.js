// Ported from script.js's AXIProviderSwitcher IIFE (~lines 10683-10964).
// This is the single most depended-upon coupling point in the app —
// window.axiSwitchProviderUpdateBtn is called from axi-databin-core.js,
// axi-databin-extras.js, and axi-admin-services.js — so mount.jsx re-exposes
// it (wired to React state) with the exact same name and signature.
//
// Reads/writes several script.js globals directly, matching the original
// exactly: _AXI_RUNTIME_KEY/_PROVIDER/_MODEL, window._AXI_PROVIDER_KEY_CACHE,
// window._AXI_PROVIDER_KEYS, window.AXI_DEFAULT_MODELS/AXI_RETIRED_MODELS
// (the last two required a small additive fix in script.js — they were
// `const`, which never attaches to `window`, so this bundle couldn't reach
// them until script.js explicitly exposed them). _updateModelBadge similarly
// required a fix in axi-databin-core.js — it was closure-scoped and had
// never actually been reachable by any of its `typeof` guards, including
// this feature's own.
export const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', desc: 'GPT-4o, GPT-4o mini', color: '#10a37f', bg: '#f0fdf4', border: '#a7f3d0' },
  { id: 'gemini', name: 'Google Gemini', desc: 'Gemini 2.5 Flash, Pro', color: '#4285f4', bg: '#f0f4ff', border: '#bfdbfe' },
  { id: 'openrouter', name: 'OpenRouter', desc: 'Multi-model gateway', color: '#6d28d9', bg: '#faf5ff', border: '#ddd6fe' },
];

export function getActiveProvider() {
  try {
    return (window._AXI_RUNTIME_PROVIDER)
      ? window._AXI_RUNTIME_PROVIDER.toLowerCase()
      : (localStorage.getItem('axi_provider') || 'openai').toLowerCase();
  } catch { return 'openai'; }
}

export function hasKeyForProvider(id) {
  try {
    if (window._AXI_RUNTIME_KEY) {
      const rp = (window._AXI_RUNTIME_PROVIDER || '').toLowerCase();
      if (rp === id) return true;
    }
    if (window._AXI_PROVIDER_KEYS && window._AXI_PROVIDER_KEYS[id]) return true;
    return false;
  } catch { return false; }
}

function toast(msg, type, duration) {
  try { window.axiToast?.(msg, type, duration); } catch { /* toast not ready */ }
}

// Returns the new active provider id on success, or null if a key-connect
// modal was opened instead (caller doesn't need to do anything further).
export async function switchToProvider(id, onUpdateBtn) {
  const providerMeta = PROVIDERS.find((p) => p.id === id);
  if (!providerMeta) return null;

  if (getActiveProvider() === id && window._AXI_RUNTIME_KEY) {
    toast(`Already using ${providerMeta.name}`, 'info', 2000);
    return null;
  }

  try {
    if (typeof window.fetchADSData !== 'function') throw new Error('fetchADSData not available');

    window.showLoader?.(`Checking ${providerMeta.name} key…`);
    const rows = await window.fetchADSData('axi_ai_keys');
    // Clear immediately — keys must never reach AI context.
    window.pendingDatabaseData = null;
    window.CURRENTADSDATA = null;
    window.CURRENTADSNAME = null;
    window.hideLoader?.();

    const currentUsername = (typeof parent !== 'undefined' && parent.mainUserName)
      ? parent.mainUserName
      : (typeof window.mainUserName !== 'undefined' ? window.mainUserName : '');

    const userRows = currentUsername
      ? (rows || []).filter((r) => (r.username || r.USERNAME || '').trim() === currentUsername.trim())
      : (rows || []);

    userRows.forEach((r) => {
      const prov = (r.provider || r.PROVIDER || '').trim().toLowerCase();
      const k = (r.api_key || r.apikey || r.key || r.API_KEY || '').trim();
      if (prov && k && window._AXI_PROVIDER_KEY_CACHE) window._AXI_PROVIDER_KEY_CACHE[prov] = true;
    });

    const providerRows = userRows.filter((r) =>
      (r.provider || r.PROVIDER || '').trim().toLowerCase() === id &&
      (r.api_key || r.apikey || r.key || r.API_KEY || '').trim()
    );

    const defaultModels = window.AXI_DEFAULT_MODELS || {};
    const retiredModels = window.AXI_RETIRED_MODELS || new Set();

    if (providerRows.length > 0) {
      const sorted = providerRows
        .map((r, i) => ({ r, i }))
        .sort(window._axiCompareRecency)
        .map((x) => x.r);
      const row = sorted[0];
      window._AXI_RUNTIME_KEY = (row.api_key || row.apikey || row.key || '').trim();
      if (window._AXI_PROVIDER_KEYS && window._AXI_RUNTIME_KEY) window._AXI_PROVIDER_KEYS[id] = window._AXI_RUNTIME_KEY;
      window._AXI_RUNTIME_PROVIDER = id;
      window._AXI_RUNTIME_MODEL = (row.model || row.MODEL || defaultModels[id] || '').trim();
      if (window._AXI_RUNTIME_MODEL && retiredModels.has(window._AXI_RUNTIME_MODEL)) {
        console.info(`[AXI] Migrating retired model "${window._AXI_RUNTIME_MODEL}" → "${defaultModels[id] || ''}"`);
        window._AXI_RUNTIME_MODEL = defaultModels[id] || '';
      }
      onUpdateBtn(id);
      window._updateModelBadge?.();
      toast(`Switched to ${providerMeta.name}`, 'success', 2500);
      return id;
    }

    if (window._AXI_PROVIDER_KEYS && window._AXI_PROVIDER_KEYS[id]) {
      window._AXI_RUNTIME_KEY = window._AXI_PROVIDER_KEYS[id];
      window._AXI_RUNTIME_PROVIDER = id;
      window._AXI_RUNTIME_MODEL = defaultModels[id] || '';
      onUpdateBtn(id);
      window._updateModelBadge?.();
      toast(`Switched to ${providerMeta.name}`, 'success', 2500);
      return id;
    }

    window.axiOpenProviderKeyModal?.(id);
    toast(`No ${providerMeta.name} key found — enter your key to connect`, 'info', 4000);
    return null;
  } catch (err) {
    window.hideLoader?.();
    console.error('[AXI switchToProvider]', err);
    toast(`Failed to switch provider: ${err.message}`, 'error', 4000);
    return null;
  }
}
