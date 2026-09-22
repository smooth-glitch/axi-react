// AI provider transport layer — ported verbatim from script.js (lines ~86-767,
// 2220-2223, 2351-2827). Structural move only (global functions → ES module
// exports); no logic was changed. See chatFlow.js for handleSend, which is
// the primary caller of everything here.
//
// callOpenAI (below, script.js:2351-2827) still reads window.VectorStore /
// calls window.searchVectorDB — vector search/embeddings is explicitly out
// of scope for this pass (not on handleSend's critical path per the
// migration plan) and stays defined in script.js's remaining shell.
//
// FIXED (both were pre-existing bugs in script.js, carried into the initial
// port, now corrected):
//
// 1. Runtime API key state used to be module-scoped (`let _AXI_RUNTIME_KEY`
//    etc., matching script.js's original module-scoped `var`s) — a different
//    storage location from `window._AXI_RUNTIME_KEY` etc., which
//    axi-admin-services.js and axi-provider-switcher-react.js read and write
//    directly (bypassing `window.setAxiRuntimeKey`, the intended bridge
//    function). That meant switching providers via the Provider Switcher UI,
//    or the RBAC key-load in axi-admin-services.js, updated `window.*` but
//    not what `getAxiConfig()` actually read — the next chat message could
//    still go out with the old provider/key. Fixed by making `window.*` the
//    single source of truth below (same aliasing pattern already used for
//    `_AXI_PROVIDER_KEY_CACHE`/`_AXI_PROVIDER_KEYS`/`_AXI_PERSONAL_PROVIDERS`
//    just below) instead of separate module-scoped variables.
//
// 2. `window._axiCompareRecency` is read by axi-provider-switcher-react.js's
//    minified bundle as a sort comparator, but `_axiCompareRecency` (below)
//    was never assigned to `window` in script.js — so that sort silently
//    fell back to JS's default (lexicographic) ordering instead of "most
//    recently used key row first." Fixed by exposing it on window.

import { buildProfile, buildAggregates, buildLLMPayload, jsonToToon, splitToonForAi, findBestMatchingRow, generateLocalReportMarkdown } from './datasetContext.js';

const LS_KEY_PROVIDER = 'axi_provider';
const LS_KEY_API = 'axi_api_key';
const LS_KEY_MODEL = 'axi_model';
const AXI_KEYS_TSTRUCT = 'a__xk'; // adjust if your tstruct name differs

// No local aliases for these three — every read/write below goes straight
// through `window.*` (see the FIXED note above), since primitives can't be
// aliased by a `let` the way the two object caches below are.
const _AXI_PROVIDER_KEY_CACHE = (window._AXI_PROVIDER_KEY_CACHE = window._AXI_PROVIDER_KEY_CACHE || {});
const _AXI_PROVIDER_KEYS = (window._AXI_PROVIDER_KEYS = window._AXI_PROVIDER_KEYS || {});
const _AXI_PERSONAL_PROVIDERS = (window._AXI_PERSONAL_PROVIDERS = window._AXI_PERSONAL_PROVIDERS || new Set());

const AXI_DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-20241022',
  gemini: 'gemini-2.5-flash',
  openrouter: 'openai/gpt-4o-mini',
};

const AXI_RETIRED_MODELS = new Set([
  'gemini-1.5-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-flash-001', 'gemini-1.5-flash-002',
  'gemini-1.5-pro', 'gemini-1.5-pro-latest', 'gemini-1.5-pro-001', 'gemini-1.5-pro-002',
  'gemini-1.0-pro', 'gemini-1.0-pro-latest', 'gemini-pro', 'gemini-pro-vision',
]);

window.AXI_DEFAULT_MODELS = AXI_DEFAULT_MODELS;
window.AXI_RETIRED_MODELS = AXI_RETIRED_MODELS;

// ── Native fetch bypass ───────────────────────────────────────────────────
// Whatever intercepts window.fetch only patches the MAIN window. A fresh
// iframe gets its own untouched window, so iframe.contentWindow.fetch is the
// real, unproxied browser fetch — borrowed once at module load for every AI
// API call.
export const _axiFetch = (function () {
  try {
    const ifr = document.createElement('iframe');
    ifr.style.cssText = 'display:none!important;width:0;height:0;border:0;position:absolute;left:-99999px;top:-99999px';
    ifr.setAttribute('aria-hidden', 'true');
    (document.body || document.documentElement).appendChild(ifr);
    const nativeFetch = ifr.contentWindow.fetch.bind(ifr.contentWindow);
    ifr.style.display = 'none';
    return nativeFetch;
  } catch (e) {
    console.warn('[transport] iframe fetch borrow failed, falling back to window.fetch', e);
    return window.fetch.bind(window);
  }
})();

// A cross-origin call that gets rejected (bad/revoked key, expired org, etc.)
// often comes back WITHOUT an Access-Control-Allow-Origin header, so the
// browser refuses to let JS read the response and fetch() itself rejects with
// a bare "TypeError: Failed to fetch" — the real error is invisible to our
// own error handling. This wrapper reports something actionable instead.
export async function _axiFetchSafe(url, opts, providerLabel) {
  try {
    return await _axiFetch(url, opts);
  } catch (err) {
    throw new Error(
      `Could not reach ${providerLabel || 'the AI provider'}. This almost always means ` +
      `the connected API key is invalid, expired, or was revoked (the browser can't show ` +
      `the exact reason because the error response is blocked by CORS). ` +
      `Type "AXI CONNECT" to reconnect with a fresh key — if that doesn't fix it, check your internet connection.`
    );
  }
}

// ── Row recency (for picking the newest axi_ai_keys row) ─────────────────
function _axiRowDate(r) {
  const raw = (r.modifiedon || r.MODIFIEDON || r.createdon || r.CREATEDON || '').toString().trim();
  if (!raw) return 0;
  if (/^\d{4}-\d{2}-\d{2}[ T]/.test(raw)) {
    const t = new Date(raw.replace(' ', 'T')).getTime();
    if (!isNaN(t)) return t;
  }
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(AM|PM)?$/i);
  if (!m) return 0;
  let h = parseInt(m[4] || 0, 10);
  const ap = (m[7] || '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return new Date(+m[3], +m[2] - 1, +m[1], h, +(m[5] || 0), +(m[6] || 0)).getTime() || 0;
}

function _axiCompareRecency(a, b) {
  return (_axiRowDate(b.r) - _axiRowDate(a.r)) || (a.i - b.i);
}
window._axiCompareRecency = _axiCompareRecency;

// Bootstrap the runtime API key from the axi_ai_keys datasource.
window.initAxiKeyFromDatasource = async function initAxiKeyFromDatasource() {
  if (!window.fetchADSData) {
    throw new Error('fetchADSData is not available yet.');
  }

  const rows = await window.fetchADSData('axi_ai_keys');

  window.pendingDatabaseData = null;
  window.CURRENTADSDATA = null;
  window.CURRENTADSNAME = null;

  if (!Array.isArray(rows) || rows.length === 0) {
    return { found: false };
  }

  const currentUsername = (typeof parent !== 'undefined' && parent.mainUserName)
    ? parent.mainUserName
    : (window.mainUserName || '');

  let userRows = currentUsername
    ? rows.filter((r) => (r.username || r.USERNAME || '').trim() === currentUsername.trim())
    : rows;

  if (!userRows.length && currentUsername) {
    userRows = rows.filter((r) => !(r.username || r.USERNAME || '').trim());
  }

  if (!userRows.length) {
    return { found: false };
  }

  userRows.forEach((r) => {
    const prov = (r.provider || r.PROVIDER || '').trim().toLowerCase();
    const k = (r.api_key || r.apikey || r.key || r.API_KEY || '').trim();
    if (prov && k) {
      _AXI_PROVIDER_KEYS[prov] = k;
      _AXI_PROVIDER_KEY_CACHE[prov] = true;
      _AXI_PERSONAL_PROVIDERS.add(prov);
    }
  });

  const sorted = userRows.map((r, i) => ({ r, i })).sort(_axiCompareRecency).map((x) => x.r);
  const row = sorted[0];

  const key = (row.api_key || row.apikey || row.key || row.API_KEY || '').trim();
  if (!key) return { found: false };

  window._AXI_RUNTIME_KEY = key;
  window._AXI_RUNTIME_PROVIDER = (row.provider || row.PROVIDER || 'openai').trim().toLowerCase();
  window._AXI_RUNTIME_MODEL = (row.model || row.MODEL || '').trim();
  if (window._AXI_RUNTIME_MODEL && AXI_RETIRED_MODELS.has(window._AXI_RUNTIME_MODEL)) {
    console.info('[AXI] Migrating retired model "' + window._AXI_RUNTIME_MODEL + '" -> "' + (AXI_DEFAULT_MODELS[window._AXI_RUNTIME_PROVIDER] || '') + '"');
    window._AXI_RUNTIME_MODEL = AXI_DEFAULT_MODELS[window._AXI_RUNTIME_PROVIDER] || '';
  }

  return { found: true };
};

window.saveAxiKeyToTable = function saveAxiKeyToTable(apiKey, recordId, provider, model) {
  recordId = recordId || '0';
  provider = (provider || 'openai').toLowerCase();
  model = model || AXI_DEFAULT_MODELS[provider] || 'gpt-4o-mini';

  function _pickAxFn(name) {
    try { if (typeof parent !== 'undefined' && typeof parent[name] === 'function') return parent[name]; } catch (e) { /* cross-origin */ }
    if (typeof window[name] === 'function') return window[name];
    return null;
  }
  const setterFn = _pickAxFn('AxSetValue');
  const submitFn = _pickAxFn('AxSubmitData');

  if (!setterFn || !submitFn) {
    throw new Error('AxSetValue or AxSubmitData not available. This page must run inside Axpert.');
  }

  const currentUsername = (typeof parent !== 'undefined' && parent.mainUserName)
    ? parent.mainUserName
    : (window.mainUserName || '');

  setterFn(AXI_KEYS_TSTRUCT, 'api_key', '1', 0, apiKey.trim());
  setterFn(AXI_KEYS_TSTRUCT, 'provider', '1', 0, provider);
  setterFn(AXI_KEYS_TSTRUCT, 'model', '1', 0, model);
  setterFn(AXI_KEYS_TSTRUCT, 'is_active', '1', 0, '1');
  if (currentUsername) setterFn(AXI_KEYS_TSTRUCT, 'username', '1', 0, currentUsername);
  submitFn(AXI_KEYS_TSTRUCT, recordId);

  window._AXI_RUNTIME_KEY = apiKey.trim();
  window._AXI_RUNTIME_PROVIDER = provider;
  window._AXI_RUNTIME_MODEL = model;
  _AXI_PROVIDER_KEY_CACHE[provider] = true;
  _AXI_PROVIDER_KEYS[provider] = (apiKey || '').trim();
  try {
    localStorage.setItem(LS_KEY_API, apiKey.trim());
    localStorage.setItem(LS_KEY_PROVIDER, provider);
    if (model) localStorage.setItem(LS_KEY_MODEL, model);
  } catch (_) { /* storage quota / private-mode — ignore */ }

  console.info(`[AXI] Key saved for provider: ${provider}`);
};

window.setAxiRuntimeKey = function setAxiRuntimeKey(apiKey, provider, model) {
  if (!apiKey) return;
  provider = (provider || 'openai').toLowerCase();
  model = model || AXI_DEFAULT_MODELS[provider] || 'gpt-4o-mini';
  window._AXI_RUNTIME_KEY = apiKey.trim();
  window._AXI_RUNTIME_PROVIDER = provider;
  window._AXI_RUNTIME_MODEL = model;
  _AXI_PROVIDER_KEY_CACHE[provider] = true;
  _AXI_PROVIDER_KEYS[provider] = (apiKey || '').trim();
  console.info('[AXI] Runtime key injected for provider:', provider);
};

export function hasRuntimeKey() {
  return !!window._AXI_RUNTIME_KEY;
}
window.hasRuntimeKey = hasRuntimeKey;

export function _resolveModelOrDefault(provider, savedModel) {
  const m = (savedModel || '').trim();
  if (m && AXI_RETIRED_MODELS.has(m)) {
    return AXI_DEFAULT_MODELS[provider] || '';
  }
  return m;
}

export function getAxiConfig() {
  if (window._AXI_RUNTIME_KEY) {
    const model = window._AXI_RUNTIME_MODEL || (localStorage.getItem(LS_KEY_MODEL) || '').trim() || 'gpt-4o-mini';
    return { provider: window._AXI_RUNTIME_PROVIDER || 'openai', apiKey: window._AXI_RUNTIME_KEY, model };
  }

  const provider = (localStorage.getItem(LS_KEY_PROVIDER) || 'openai').trim().toLowerCase();
  const apiKey = (localStorage.getItem(LS_KEY_API) || '').trim();
  const modelFromLs = (localStorage.getItem(LS_KEY_MODEL) || '').trim();

  if (!apiKey) {
    throw new Error("No API key found. Type 'AXI CONNECT' and connect your provider key.");
  }

  let model = _resolveModelOrDefault(provider, modelFromLs);
  if (!model) {
    if (provider === 'openai') model = 'gpt-4o-mini';
    else if (provider === 'openrouter') model = 'openai/gpt-4o-mini';
    else if (provider === 'gemini') model = 'gemini-2.5-flash';
    else if (provider === 'anthropic') model = 'claude-sonnet-4-6';
    else model = 'gpt-4o-mini';
  }

  return { provider, apiKey, model };
}

export function handleAuthFailure(provider, resStatus) {
  if (resStatus === 401 || resStatus === 403) {
    window._AXI_RUNTIME_KEY = null;
    window._AXI_RUNTIME_PROVIDER = null;
    window._AXI_RUNTIME_MODEL = null;
    localStorage.removeItem(LS_KEY_API);
    throw new Error(
      `Authentication failed — the API key may have been rotated. ` +
      `Please refresh the page to fetch the latest key.`
    );
  }
}

export function messagesToPlainText(messages) {
  return (messages || [])
    .map((m) => `${(m.role || 'user').toUpperCase()}: ${m.content || ''}`)
    .join('\n\n');
}

// ── Retry helper ───────────────────────────────────────────────────────────
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function showRetryNotice(attempt, waitSec) {
  const typing = document.getElementById('typing');
  if (!typing) return;
  typing.classList.remove('typing--hidden');
  typing.className = 'typing typing--pulse';
  typing.innerHTML = `<div class="pulse-bar"></div>
    <span style="font-size:12px;color:#6B7280;margin-left:8px;">
      Rate limited — retrying in ${waitSec}s (attempt ${attempt}/3)…
    </span>`;
}

function hideRetryNotice() {
  const typing = document.getElementById('typing');
  if (!typing) return;
  typing.classList.add('typing--hidden');
  typing.innerHTML = '';
}

export async function withRetry(fn, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = err?.status ?? err?.statusCode ?? 0;
      const isRetryable = RETRYABLE_STATUSES.has(status)
        || /rate.?limit|too many|overload|service.?unavailable|high.?demand|try again later|529/i.test(err?.message ?? '');

      if (!isRetryable || attempt === maxAttempts) throw err;

      const retryAfter = err?.retryAfter ?? 0;
      const backoff = retryAfter > 0 ? retryAfter : Math.min(2 ** attempt, 16);

      console.warn(`AXI Retry ${attempt}/${maxAttempts} — waiting ${backoff}s`, err.message);
      showRetryNotice(attempt, backoff);
      await new Promise((r) => setTimeout(r, backoff * 1000));
      hideRetryNotice();
    }
  }
  throw lastError;
}

export function isContextLimitError(err) {
  const msg = String(err?.message || err || '');
  return msg.includes('maximum context length') || msg.includes('context length');
}

// ── Completions ────────────────────────────────────────────────────────────
export async function axiChatCompletion(input = {}) {
  let messages, temperature, max_tokens, model;

  if (Array.isArray(input)) {
    messages = input; temperature = 0; max_tokens = 4000; model = undefined;
  } else {
    ({ messages, temperature = 0, max_tokens = 4000, model } = input || {});
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("Missing required parameter: 'messages'.");
  }

  const cfg = getAxiConfig();
  const provider = cfg.provider;
  const apiKey = cfg.apiKey;
  const useModel = model || cfg.model;

  if (provider === 'anthropic') {
    throw new Error('Anthropic/Claude is not supported in the browser due to CORS. Use OpenAI, OpenRouter, or Gemini.');
  }

  if (provider === 'gemini') {
    const sysMsgs = messages.filter((m) => m.role === 'system');
    const chatMsgs = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content || '' }] }));
    const body = { contents: chatMsgs, generationConfig: { temperature, maxOutputTokens: max_tokens } };
    if (sysMsgs.length > 0) body.system_instruction = { parts: [{ text: sysMsgs.map((m) => m.content).join('\n\n') }] };
    const res = await _axiFetchSafe(
      `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${encodeURIComponent(apiKey)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      'Gemini'
    );
    handleAuthFailure(provider, res.status);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Gemini API error');
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  const baseUrl = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = window.location.origin;
    headers['X-Title'] = 'Axpert AXI';
  }
  const res = await _axiFetchSafe(`${baseUrl}/chat/completions`, {
    method: 'POST', headers,
    body: JSON.stringify({ model: useModel, messages, temperature, max_tokens }),
  }, provider);
  handleAuthFailure(provider, res.status);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `${provider} API error`);
  return data.choices?.[0]?.message?.content || '';
}

export async function axiChatCompletionStream({ messages, temperature = 0, maxtokens = 4000, model, onChunk, onThinking }) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('Missing required parameter: messages.');
  }

  const cfg = getAxiConfig();
  const provider = cfg.provider;
  const apiKey = cfg.apiKey;
  const useModel = model || cfg.model;

  if (provider === 'anthropic') {
    throw new Error('Anthropic/Claude is not supported in the browser due to CORS. Use OpenAI, OpenRouter, or Gemini.');
  }

  let fullText = '';

  const emitChunk = (chunk) => {
    if (!chunk) return;
    fullText += chunk;
    onChunk?.(chunk, fullText);
  };

  const readSSE = async (res, onParsed) => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const processEvent = (rawEvent) => {
      const dataLines = [];
      for (const line of rawEvent.split(/\r?\n/)) {
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      const payload = dataLines.join('\n').trim();
      if (!payload) return false;
      if (payload === '[DONE]') return true;
      try {
        onParsed(JSON.parse(payload));
      } catch (err) {
        console.warn('SSE parse skipped:', payload, err);
      }
      return false;
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

      let match;
      while ((match = buffer.match(/\r?\n\r?\n/))) {
        const boundary = match.index;
        const sepLen = match[0].length;
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + sepLen);

        const shouldStop = processEvent(rawEvent);
        if (shouldStop) return;
      }

      if (done) break;
    }

    if (buffer.trim()) {
      processEvent(buffer);
    }
  };

  if (provider === 'gemini') {
    const sysMsgs = messages.filter((m) => m.role === 'system');
    const chatMsgs = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

    const body = { contents: chatMsgs, generationConfig: { temperature, maxOutputTokens: maxtokens } };
    if (sysMsgs.length > 0) {
      body.systemInstruction = { parts: [{ text: sysMsgs.map((m) => m.content).join('\n\n') }] };
    }

    const res = await _axiFetchSafe(
      `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:streamGenerateContent?key=${encodeURIComponent(apiKey)}&alt=sse`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      'Gemini'
    );

    handleAuthFailure(provider, res.status);

    if (!res.ok) {
      const d = await res.json();
      throw new Error(d?.error?.message || 'Gemini API error');
    }

    await readSSE(res, (parsed) => {
      const parts = parsed?.candidates?.[0]?.content?.parts || [];
      const chunk = parts.map((p) => p?.text || '').join('');
      emitChunk(chunk);
    });

    return fullText;
  }

  const baseUrl = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = window.location.origin;
    headers['X-Title'] = 'Axpert AXI';
  }

  const res = await _axiFetchSafe(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: useModel, messages, temperature, max_tokens: maxtokens, stream: true }),
  }, provider);

  handleAuthFailure(provider, res.status);

  if (!res.ok) {
    const d = await res.json();
    throw new Error(d?.error?.message || `${provider} API error`);
  }

  await readSSE(res, (parsed) => {
    const delta = parsed?.choices?.[0]?.delta || {};
    const thinkChunk = delta.thinking || delta.reasoning || delta.reasoning_content || '';
    if (thinkChunk) onThinking?.(thinkChunk);
    const chunk = typeof delta.content === 'string'
      ? delta.content
      : Array.isArray(delta.content) ? delta.content.map((p) => p?.text || '').join('') : '';
    emitChunk(chunk);
  });

  return fullText;
}

// ── General (non-Data-Bin) AI dispatch path ───────────────────────────────
// Called from handleSend's `else` branch (chatFlow.js) when no active Data
// Bin payload is in play. Rebuilds its own message pipeline from
// window.pendingDatabaseData / window.CURRENTADSDATA — ignores Data Bin
// context entirely (handleSend already knows this and bypasses this
// function when a Data Bin is active — see chatFlow.js's usingActiveDataBin
// branch).
export async function callOpenAI(messages, datasetContext, _streamCallbacks) {
  const streamCallbacks = _streamCallbacks;
  let enhancedDatasetContext = datasetContext;
  let actualDataRows = null;
  let isRagFiltered = false;

  const incomingMessages = Array.isArray(messages)
    ? messages
      .filter(Boolean)
      .map((m) => ({
        role: m?.role,
        content: typeof m?.content === 'string' ? m.content : String(m?.content ?? ''),
      }))
    : [];

  const nonSystemMessages = incomingMessages.filter((m) => m.role !== 'system');

  const lastUserMessage =
    [...nonSystemMessages].reverse().find((m) => m.role === 'user' && typeof m.content === 'string')?.content
    || incomingMessages[incomingMessages.length - 1]?.content
    || 'Analyze';

  const cleanUserMsg = String(lastUserMessage).trim();

  const isDbIntent =
    /^analy[zs]e/i.test(cleanUserMsg) ||
    !!window.pendingDatabaseData ||
    (enhancedDatasetContext && enhancedDatasetContext.source === 'database');

  const isInitialAnalysis =
    !!window.pendingDatabaseData ||
    /^analy[zs]e\b/i.test(cleanUserMsg) ||
    /^(give me|provide|generate|create|i want|can you give|can you provide).*?\b(overview|analy[zs]is|summary|report)\b/i.test(cleanUserMsg) ||
    /^summarize\b/i.test(cleanUserMsg) ||
    /^(overview|analysis|summary)$/i.test(cleanUserMsg);

  const isConversationalFollowUp =
    /explain|what does|why is|why are|how come|tell me more|elaborate|can you explain|help me understand|clarify|summarize the chart|what do (these|the|those) charts?|break(ing)? (it|this|that|them) down|interpret|what('s| is) (this|that|the)|describe/i.test(cleanUserMsg) ||
    /these charts?|this chart|the previous|above data|from (the )?(chart|graph|data|report|above)/i.test(cleanUserMsg) ||
    /give me charts? for this/i.test(cleanUserMsg) ||
    (cleanUserMsg.split(/\s+/).length <= 8 && /chart|graph|that|this|it|mean|show|say/i.test(cleanUserMsg));

  if (window.pendingDatabaseData) {
    const dbInfo = window.pendingDatabaseData || {};
    const rows = Array.isArray(dbInfo.data) ? dbInfo.data : [];
    enhancedDatasetContext = { source: 'database', name: dbInfo.name, recordCount: rows.length, dataSummary: 'Full data provided' };
    actualDataRows = rows;
  }

  if (isDbIntent && (!Array.isArray(actualDataRows) || actualDataRows.length === 0)) {
    const fallbackRows =
      (Array.isArray(window.CURRENTADSDATA) && window.CURRENTADSDATA.length ? window.CURRENTADSDATA : null) ||
      (Array.isArray(window.CURRENT_ADS_DATA) && window.CURRENT_ADS_DATA.length ? window.CURRENT_ADS_DATA : null);

    if (fallbackRows) actualDataRows = fallbackRows;
  }

  const isAggregateQuery =
    /\b(how many|count|total|sum|average|avg|max|min|minimum|maximum|breakdown|distribution|percentage|ratio|all\s+row|entire|every\s+row)\b/i.test(cleanUserMsg);

  if (!isInitialAnalysis && !isConversationalFollowUp && !isAggregateQuery && window.VectorStore && window.VectorStore.length > 0 && lastUserMessage) {
    try {
      console.log('Performing Vector Search for targeted query:', lastUserMessage);
      const relevantRows = await window.searchVectorDB(lastUserMessage, 40);

      if (relevantRows && relevantRows.length > 0) {
        const fullTokens = Math.round(JSON.stringify(actualDataRows || []).length / 4);
        const filteredTokens = Math.round(JSON.stringify(relevantRows).length / 4);
        const savedThisQuery = Math.max(0, fullTokens - filteredTokens);

        const stats = JSON.parse(
          localStorage.getItem('axi_vector_token_stats') ||
          '{"queriesFiltered":0,"totalSaved":0,"totalFull":0,"totalFiltered":0}'
        );

        stats.queriesFiltered++;
        stats.totalSaved += savedThisQuery;
        stats.totalFull += fullTokens;
        stats.totalFiltered += filteredTokens;
        stats.lastQuery = {
          fullRows: (actualDataRows || []).length,
          filteredRows: relevantRows.length,
          fullTokens,
          filteredTokens,
          savedThisQuery,
        };

        localStorage.setItem('axi_vector_token_stats', JSON.stringify(stats));

        console.log(
          `[VectorDB] Filtered ${(actualDataRows || []).length} -> ${relevantRows.length} rows | ` +
          `~${savedThisQuery.toLocaleString()} tokens saved this query | ` +
          `~${stats.totalSaved.toLocaleString()} saved total`
        );

        actualDataRows = relevantRows;
        isRagFiltered = true;
      }
    } catch (err) {
      console.error('Vector search failed, falling back:', err);
    }
  } else if (isInitialAnalysis) {
    console.log('Overview intent detected. Skipping Vector DB.');
  } else if (isConversationalFollowUp) {
    console.log('Conversational follow-up detected. Skipping Vector DB to use chat history.');
  }

  async function callLLM(finalMessagesArray) {
    if (typeof streamCallbacks?.onChunk === 'function') {
      return await axiChatCompletionStream({
        messages: finalMessagesArray,
        temperature: 0.3,
        maxtokens: 4000,
        model: undefined,
        onChunk: (chunk, fullText) => streamCallbacks.onChunk(chunk, fullText),
        onThinking: typeof streamCallbacks?.onThinking === 'function' ? streamCallbacks.onThinking : undefined,
      });
    }

    return await axiChatCompletion({ messages: finalMessagesArray, temperature: 0.3, maxtokens: 4000, model: undefined });
  }

  const BASE_SYSTEM_PROMPT = `
You are AXI, an expert Data Analyst.
Answer the user's questions intelligently based on the provided data and conversation history.

### CHART PROTOCOL — MANDATORY
When any chart, graph, or visualization is needed or requested, you MUST output it as a JSON code block ONLY.
NEVER use ASCII art, text bars (████), unicode characters, or plain-text tables to represent charts.
NEVER draw charts in text. ONLY use the JSON format below — the UI will render it as a real interactive chart.

Single chart:
\`\`\`json
{
  "chart": {
    "type": "column",
    "title": "Title Here",
    "xAxis": { "categories": ["A", "B", "C"] },
    "series": [{ "name": "Series Name", "data": [10, 20, 30] }]
  }
}
\`\`\`

Multiple charts:
\`\`\`json
{
  "charts": [
    {
      "chart": {
        "type": "bar",
        "title": "Chart One",
        "xAxis": { "categories": ["X", "Y"] },
        "series": [{ "name": "Val", "data": [5, 15] }]
      }
    },
    {
      "chart": {
        "type": "pie",
        "title": "Chart Two",
        "series": [{ "name": "Share", "data": [{ "name": "A", "y": 60 }, { "name": "B", "y": 40 }] }]
      }
    }
  ]
}
\`\`\`

Supported chart types: column, bar, line, pie, area, scatter.
For pie charts always use: "data": [{ "name": "Label", "y": value }, ...]

### OUTPUT FORMAT — MANDATORY
NEVER output raw HTML tags (<div>, <table>, <span>, <p>, <html>, etc.) in your responses.
Use Markdown for text formatting and the JSON code block format above for all charts.
If you are tempted to write an HTML chart or HTML table, use the JSON chart format instead.
`.trim();

  const STRICT_DATA_RULES = `
IMPORTANT RULES FOR RAW DATA:
- Never make up data.
- If a specific data point or value is missing from the rows provided below, you MUST say "Not available in the provided data."
`.trim();

  const REPORT_PROTOCOL = `
### OUTPUT FORMAT RULES (MANDATORY)

Use the EXACT section headings and structure the user requests.

Rule 1 — MARKDOWN ONLY for all text:
  BAD:  Executive Overview: {"summary":"The dataset shows..."}
  GOOD: ## Executive Overview\nThe dataset shows...
Never wrap prose or bullet points inside JSON objects.

Rule 2 — CHARTS use JSON code blocks only:
\`\`\`json
{"chart":{"type":"column","title":"Title","xAxis":{"categories":["A","B"]},"series":[{"name":"Label","data":[10,20]}]}}
\`\`\`

Rule 3 — NEVER output a bare "Charts: [...]" list, "Report\\nDASHBOARD", or any JSON object as the main response body.
Rule 4 — Do NOT repeat section names or add a "Report" title before your sections.
`.trim();

  if (actualDataRows && actualDataRows.length > 0) {
    const matchedRow = findBestMatchingRow(actualDataRows, lastUserMessage);
    if (matchedRow) {
      const matchMessages = [
        { role: 'system', content: `${BASE_SYSTEM_PROMPT}\n\n${STRICT_DATA_RULES}` },
        { role: 'user', content: `MATCHED RECORD:\n${JSON.stringify(matchedRow)}\n\nQuestion:\n${lastUserMessage}` },
      ];

      const response = await callLLM(matchMessages);
      return typeof response === 'object' ? (response.text ?? response) : response;
    }

    if (isRagFiltered) {
      const ragMessages = [
        { role: 'system', content: `${BASE_SYSTEM_PROMPT}\n\n${STRICT_DATA_RULES}` },
        ...nonSystemMessages.slice(0, -1),
        { role: 'system', content: `Context Update: A Vector Database has retrieved the ${actualDataRows.length} most relevant rows to answer the user's new question.` },
        { role: 'user', content: `FILTERED DATA ROWS:\n${JSON.stringify(actualDataRows)}\n\nQuestion:\n${lastUserMessage}\n\nPlease answer directly based ONLY on the filtered rows above.` },
      ];

      try {
        const response = await callLLM(ragMessages);
        return typeof response === 'object' ? (response.text ?? response) : response;
      } catch (err) {
        if (!isContextLimitError(err)) throw err;
      }
    } else if (isInitialAnalysis) {
      const ROW_COUNT = actualDataRows.length;
      const dsName = enhancedDatasetContext?.name || 'dataset';
      const columns = Object.keys(actualDataRows[0] || {}).filter((k) => !k.startsWith('__'));

      const profile = buildProfile(actualDataRows);
      const aggregates = buildAggregates(actualDataRows);
      const payload = buildLLMPayload(dsName, actualDataRows, profile, aggregates);

      const groundTruthMsg = {
        role: 'system',
        content:
          `DATA GROUND TRUTH — FOLLOW THESE FACTS EXACTLY:\n` +
          `• This dataset contains EXACTLY ${ROW_COUNT} rows.\n` +
          `• Columns (${columns.length}): ${columns.join(', ')}\n` +
          `• Report the row count as ${ROW_COUNT} — never round, estimate, or say "approximately".\n` +
          `• Every aggregation (sum, count, percentage, average) must cover ALL ${ROW_COUNT} rows.\n` +
          `• Pre-computed statistics below are derived from all ${ROW_COUNT} rows — treat them as authoritative.\n` +
          `• If the data does not support a specific claim, say "Not available in the provided data".`,
      };

      const statsMsg = {
        role: 'system',
        content: `COMPREHENSIVE STATISTICS FOR "${dsName}" (computed from all ${ROW_COUNT} rows):\n` + JSON.stringify(payload),
      };

      const toonStr = jsonToToon(actualDataRows);
      const toonChunks = splitToonForAi(toonStr, 12000);
      const totalChunks = toonChunks.length;

      const toonMessages = toonChunks.map((chunk, idx) => ({
        role: 'system',
        content: `RAW DATA "${dsName}" — chunk ${idx + 1}/${totalChunks} (dataset has ${ROW_COUNT} total rows):\n` + chunk,
      }));

      try {
        const fullMessages = [
          groundTruthMsg,
          statsMsg,
          ...toonMessages,
          { role: 'system', content: `${BASE_SYSTEM_PROMPT}\n\n${STRICT_DATA_RULES}\n\n${REPORT_PROTOCOL}` },
          {
            role: 'user',
            content:
              `Dataset: ${dsName} — ${ROW_COUNT} rows across ${columns.length} columns.\n\n` +
              `Question:\n${lastUserMessage}\n\n` +
              `All ${ROW_COUNT} rows have been provided above in chunks. ` +
              `Follow the output format rules above. Write your response in clean Markdown — do NOT wrap any text section in a JSON object.`,
          },
        ];

        const response = await callLLM(fullMessages);
        return typeof response === 'object' ? (response.text ?? response) : response;
      } catch (err) {
        if (!isContextLimitError(err)) throw err;
      }

      try {
        const attempt2Messages = [
          groundTruthMsg,
          { role: 'system', content: `${BASE_SYSTEM_PROMPT}\n\n${STRICT_DATA_RULES}\n\n${REPORT_PROTOCOL}` },
          {
            role: 'user',
            content:
              `Dataset: ${dsName} — ${ROW_COUNT} rows\n\n` +
              `COMPREHENSIVE STATISTICS (computed from all ${ROW_COUNT} rows):\n` +
              `${JSON.stringify(payload)}\n\n` +
              `Question:\n${lastUserMessage}\n\n` +
              `Write your response in clean Markdown — do NOT wrap any text section in a JSON object.`,
          },
        ];

        const response = await callLLM(attempt2Messages);
        return typeof response === 'object' ? (response.text ?? response) : response;
      } catch (err) {
        if (!isContextLimitError(err)) throw err;
      }
    } else {
      try {
        const profile = buildProfile(actualDataRows);
        const rawAggregates = buildAggregates(actualDataRows);

        const smartAggregates = {};
        Object.keys(rawAggregates).forEach((col) => {
          const aggData = rawAggregates[col];
          if (!aggData || typeof aggData !== 'object') return;

          const colSummary = { type: aggData.type };

          if (aggData.type === 'numeric') {
            colSummary.sum = aggData.sum;
            colSummary.avg = aggData.avg;
            colSummary.min = aggData.min;
            colSummary.max = aggData.max;
            colSummary.count = aggData.count;
          }

          if (aggData.counts) {
            const uniqueCount = Object.keys(aggData.counts).length;
            colSummary.uniqueCount = uniqueCount;
            if (uniqueCount <= 100) {
              colSummary.counts = aggData.counts;
            } else {
              colSummary.highlyUnique = true;
              colSummary.note = `Too many unique values (${uniqueCount}) to chart individually.`;
            }
          }

          smartAggregates[col] = colSummary;
        });

        const microPayload = { totalRecords: actualDataRows.length, schema: profile, aggregates: smartAggregates };

        const followUpGroundTruth = {
          role: 'system',
          content:
            `DATA GROUND TRUTH: This dataset has EXACTLY ${actualDataRows.length} rows. ` +
            `All aggregates in the payload below were computed from all ${actualDataRows.length} rows. ` +
            `Always cite ${actualDataRows.length} as the row count — never estimate or approximate.`,
        };

        const isExplainMode =
          /explain|what does|why (is|are)|interpret|describe|what do (these|the)|what('s| is) (this|that)|break.{0,10}down|mean|tell me more|elaborate/i.test(cleanUserMsg);

        const FOLLOW_UP_PROMPT = `
You are a helpful Data Analyst having a conversation.
The user is asking a conversational follow-up question.

CRITICAL INSTRUCTIONS:
1. You MUST read the full conversation history carefully.
2. If the user asks you to explain charts — look at the JSON blocks in previous responses and translate those numbers into plain English: highest, lowest, trends, key takeaways.
3. Be specific — use the actual values from those chart JSON blocks.
4. DO NOT say "Not available in the data". You are free to reference anything from chat history.

${isExplainMode ? `
⚠ EXPLAIN MODE — ACTIVE:
- The user wants an EXPLANATION of existing charts/data — NOT new charts.
- DO NOT generate any JSON chart blocks.
- DO NOT output any \`\`\`json ... \`\`\` blocks under any circumstances.
- Respond ONLY in plain markdown (paragraphs, bullet points, bold highlights).
- Reference the actual numbers and labels already shown in the conversation above.
` : `
CHART MODE — Only if a new chart is explicitly requested:
Output it as a JSON code block using this format:
\`\`\`json
{ "chart": { "type": "column", "title": "Title", "xAxis": { "categories": ["A","B"] }, "series": [{ "name": "Label", "data": [10, 20] }] } }
\`\`\`
Supported types: column, bar, line, pie, area, scatter.
`}`.trim();

        const followUpMessages = [
          { role: 'system', content: FOLLOW_UP_PROMPT },
          followUpGroundTruth,
          ...nonSystemMessages.slice(0, -1),
          {
            role: 'user',
            content: `DATASET AGGREGATES (For reference if needed):\n${JSON.stringify(microPayload)}\n\nUser Question:\n${lastUserMessage}\n\nPlease respond naturally and explain any past charts using the conversation history.`,
          },
        ];

        const response = await callLLM(followUpMessages);
        return typeof response === 'object' ? (response.text ?? response) : response;
      } catch (err) {
        if (!isContextLimitError(err)) throw err;
      }
    }

    return generateLocalReportMarkdown(enhancedDatasetContext?.name, actualDataRows);
  }

  const uniqueSystemMessages = [];
  const seenSystemTexts = new Set();

  incomingMessages.forEach((m) => {
    if (m && m.role === 'system') {
      const content = String(m.content).trim();
      if (!content) return;
      if (content.startsWith('DATA CONTEXT:')) return;
      if (content.startsWith('Context Update:')) return;

      if (!seenSystemTexts.has(content)) {
        seenSystemTexts.add(content);
        uniqueSystemMessages.push({ role: 'system', content });
      }
    }
  });

  const generalMessages = [
    { role: 'system', content: 'You are AXI, a helpful AI assistant.' },
    ...uniqueSystemMessages,
    { role: 'system', content: REPORT_PROTOCOL },
    ...nonSystemMessages,
  ];

  const response = await callLLM(generalMessages);
  return typeof response === 'object' ? (response.text ?? response) : response;
}
