// Vector search / embeddings (RAG) — ported from script.js:7893-8225.
// Structural move, verbatim logic. Narrows a large dataset to the ~40 most
// relevant rows (by embedding cosine similarity) before sending it to the
// AI, instead of sending every row every time.
//
// Call sites already exist and are already wired, from earlier ports:
//   - axi-databin-core.js:3033 calls window.buildVectorIndexForDataset(rows)
//     (guarded by typeof-check) whenever a dataset finishes loading.
//   - src/services/transport.js's callOpenAI calls
//     window.searchVectorDB(lastUserMessage, 40) (guarded by
//     window.VectorStore.length > 0) and already writes the
//     'axi_vector_token_stats' localStorage key used below.
// Both functions were previously undefined, so both call sites were silent
// no-ops — this file makes them real.
//
// BUG FIX (preserved as a fix, not silently): script.js's updateTokenBadge
// read localStorage key 'axivectortokenstats' (no underscores) while every
// writer (including transport.js's already-ported copy) uses
// 'axi_vector_token_stats' (with underscores) — a typo that meant the
// token-savings badge could never show real data in the original app
// either. Fixed to use the consistent, correct key.

import { getAxiConfig, _axiFetchSafe } from './transport.js';

// 1. Cosine similarity between two vectors.
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getEmbeddings(texts) {
  const cfg = getAxiConfig();

  // Direct browser route (OpenAI / OpenRouter only)
  const provider = cfg.provider;
  if (provider === 'openai' || provider === 'openrouter') {
    const baseUrl = provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1'
      : 'https://api.openai.com/v1';
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` };
    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = window.location.origin;
      headers['X-Title'] = 'Axpert AXI';
    }
    const res = await _axiFetchSafe(`${baseUrl}/embeddings`, {
      method: 'POST', headers,
      body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
    }, provider);
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        detail = errBody?.error?.message || errBody?.error || detail;
      } catch (_) { /* ignore */ }
      throw new Error(`Embeddings request failed (${res.status}): ${detail}`);
    }
    const data = await res.json();
    return data.data.map((d) => d.embedding);
  }

  // Gemini / Anthropic without MCP — skip gracefully, do not throw
  console.info(`[VectorCache] Embeddings not supported for "${provider}" without MCP — vector search disabled.`);
  return [];
}

// Keep the old name as an alias so any external callers don't break
const getOpenAIEmbeddings = getEmbeddings;

// Global store for our In-Memory Vector DB
window.VectorStore = [];

// ── IndexedDB Cache for VectorStore ──────────────────────────
// Persists embeddings across page refreshes so we never re-pay for the same
// dataset. Keyed by a hash of the row data. Max 3 datasets are kept; the
// oldest is evicted when full.
const _VEC_DB_NAME = 'axi_vector_cache';
const _VEC_STORE_NAME = 'stores';
const _VEC_MAX_CACHED = 3;

function _vecDBOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_VEC_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(_VEC_STORE_NAME)) {
        db.createObjectStore(_VEC_STORE_NAME, { keyPath: 'hash' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function _vecCacheGet(hash) {
  try {
    const db = await _vecDBOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(_VEC_STORE_NAME, 'readonly');
      const req = tx.objectStore(_VEC_STORE_NAME).get(hash);
      req.onsuccess = (e) => resolve(e.target.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.warn('[VectorCache] Read failed — will re-embed:', err);
    return null;
  }
}

async function _vecCacheSet(hash, storeEntries) {
  try {
    const db = await _vecDBOpen();

    const allEntries = await new Promise((resolve, reject) => {
      const tx = db.transaction(_VEC_STORE_NAME, 'readonly');
      const req = tx.objectStore(_VEC_STORE_NAME).getAll();
      req.onsuccess = (e) => resolve(e.target.result || []);
      req.onerror = (e) => reject(e.target.error);
    });

    const toEvict = allEntries
      .filter((e) => e.hash !== hash)
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, Math.max(0, allEntries.length - _VEC_MAX_CACHED + 1));

    await new Promise((resolve, reject) => {
      const tx = db.transaction(_VEC_STORE_NAME, 'readwrite');
      const store = tx.objectStore(_VEC_STORE_NAME);
      toEvict.forEach((e) => store.delete(e.hash));
      store.put({ hash, timestamp: Date.now(), entries: storeEntries });
      tx.oncomplete = resolve;
      tx.onerror = (e) => reject(e.target.error);
    });

    console.log(`[VectorCache] Saved ${storeEntries.length} vectors under key "${hash.slice(0, 12)}…"`);
  } catch (err) {
    console.warn('[VectorCache] Write failed (non-fatal):', err);
  }
}

function _datasetHash(rows) {
  if (!rows || rows.length === 0) return 'empty';
  const sample = [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]]
    .map((r) => JSON.stringify(r)).join('|');
  const totalChars = rows.reduce((acc, r) => acc + JSON.stringify(r).length, 0);
  let h = 5381;
  const str = `${rows.length}::${totalChars}::${sample}`;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return `v1_${rows.length}_${h.toString(16)}`;
}

// ── Main build function (cache-aware) ─────────────────────────
export async function buildVectorIndexForDataset(rows) {
  window.VectorStore = [];
  if (!rows || rows.length === 0) return;

  const hash = _datasetHash(rows);

  const cached = await _vecCacheGet(hash);
  if (cached && Array.isArray(cached.entries) && cached.entries.length > 0) {
    window.VectorStore = cached.entries;
    console.log(`[VectorCache] Loaded ${window.VectorStore.length} vectors from cache (key: "${hash.slice(0, 12)}…"). No API call needed.`);
    return;
  }

  console.log(`[VectorCache] No cache found — embedding ${rows.length} rows…`);
  const provider = getAxiConfig().provider;
  if (provider !== 'openai' && provider !== 'openrouter') {
    console.info(`[VectorCache] Skipping — embeddings not supported for "${provider}" without MCP. Vector search disabled.`);
    return;
  }
  const batchSize = 500;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    const allTexts = batch.map((row) => Object.entries(row)
      .filter(([, v]) => v !== null && v !== '')
      .map(([k, v]) => `${k}: ${v}`)
      .join(', '));

    const validPairs = batch
      .map((row, idx) => ({ row, text: allTexts[idx] }))
      .filter((pair) => pair.text.trim() !== '');

    if (validPairs.length === 0) continue;

    const texts = validPairs.map((p) => p.text);
    const embeddings = await getOpenAIEmbeddings(texts);

    validPairs.forEach(({ row, text }, idx) => {
      window.VectorStore.push({ originalRow: row, textString: text, vector: embeddings[idx] });
    });
  }

  console.log(`Vector DB Indexed ${window.VectorStore.length} rows successfully.`);
  await _vecCacheSet(hash, window.VectorStore);
}
window.buildVectorIndexForDataset = buildVectorIndexForDataset;

window.getVectorTokenStats = function getVectorTokenStats() {
  const s = JSON.parse(localStorage.getItem('axi_vector_token_stats') || 'null');
  if (!s || s.queriesFiltered === 0) {
    console.log('[VectorDB] No filtered queries yet.');
    return;
  }
  const avgSaving = Math.round(s.totalSaved / s.queriesFiltered);
  const pct = s.totalFull > 0 ? Math.round((s.totalSaved / s.totalFull) * 100) : 0;
  console.table({
    'Queries filtered by vector search': s.queriesFiltered,
    'Total tokens WITHOUT vectorization': s.totalFull.toLocaleString(),
    'Total tokens WITH vectorization': s.totalFiltered.toLocaleString(),
    'Total tokens saved': s.totalSaved.toLocaleString(),
    'Average saving per query': avgSaving.toLocaleString() + ' tokens',
    'Overall reduction': pct + '%',
  });
  if (s.lastQuery) console.log('Last query detail:', s.lastQuery);
};

export async function searchVectorDB(userQuery, topK = 40) {
  if (!window.VectorStore || window.VectorStore.length === 0) {
    return null;
  }

  const [queryVector] = await getOpenAIEmbeddings([userQuery]);

  const scoredRows = window.VectorStore.map((item) => ({
    row: item.originalRow,
    score: cosineSimilarity(queryVector, item.vector),
  }));

  // 'text-embedding-3-small' usually scores 0.2 (unrelated) to 0.8 (perfect match).
  const SIMILARITY_THRESHOLD = 0.40;
  const relevantRows = scoredRows.filter((item) => item.score >= SIMILARITY_THRESHOLD);
  relevantRows.sort((a, b) => b.score - a.score);
  return relevantRows.slice(0, topK).map((item) => item.row);
}
window.searchVectorDB = searchVectorDB;

// ─── TOKEN SAVINGS BADGE ──────────────────────────────────────
function formatTokenCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function updateTokenBadge() {
  const badge = document.getElementById('axiTokenBadge');
  const badgeTxt = document.getElementById('axiTokenBadgeText');
  if (!badge || !badgeTxt) return;

  try {
    // FIXED (see file header): original read 'axivectortokenstats' (typo,
    // no underscores) — every writer uses 'axi_vector_token_stats'.
    const stats = JSON.parse(
      localStorage.getItem('axi_vector_token_stats') ||
      '{"queriesFiltered":0,"totalSaved":0}'
    );
    const saved = stats.totalSaved ?? 0;
    const queries = stats.queriesFiltered ?? 0;

    if (saved <= 0) {
      badge.style.display = 'none';
      return;
    }

    badge.style.display = 'flex';
    badgeTxt.textContent = `⚡ ${formatTokenCount(saved)} tokens saved (${queries} queries)`;

    badge.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }],
      { duration: 350, easing: 'ease-out' }
    );
  } catch (e) {
    badge.style.display = 'none';
  }
}

// Patch: call updateTokenBadge every time vector search saves tokens. Hooks
// into the existing localStorage write inside transport.js's callOpenAI
// vector block.
const _origSetItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = function (key, value) {
  _origSetItem(key, value);
  if (key === 'axi_vector_token_stats') updateTokenBadge();
};

// Show on load if there are already saved stats from a previous session.
// This module is imported after the DOM exists (see main.jsx), so no need
// to wait for DOMContentLoaded like the original did.
updateTokenBadge();
