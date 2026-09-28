import { createLogger } from './logger';
import { handle } from './localApi';
import { setStorageName } from './localDb';
import { setMaxUploadMb } from './localApi';

const log = createLogger('api');

// ─── Configuration ────────────────────────────────────────────────────────────
// configure({ user, storageName, maxUploadMb }) may be called by a host application at startup.
// apiUrl / getAuthToken / headers are still accepted for backwards-compat but are no longer used.
let config = {
  user: null,
  storageName: 'tstruct',
  maxUploadMb: 25,
};

export function configure(next = {}) {
  config = { ...config, ...next, headers: { ...config.headers, ...(next.headers || {}) } };
  setStorageName(config.storageName);
  setMaxUploadMb(config.maxUploadMb);
  if (next.user) _client.setUser(next.user);
  // Accept a pre-authenticated shared socket (e.g. the main sandeshSocket instance)
  // so the tstruct studio never opens a second WebSocket connection.
  if (next.socket) _client.useShared(next.socket);
  return config;
}
export const getConfig = () => config;

// ─── Minimal Sandesh WebSocket client ─────────────────────────────────────────
// Used only when no shared socket has been injected (standalone mode).

const getWsUrl = () => {
  if (typeof window === 'undefined') return null;
  const isDev =
    ['5173', '3000', '5174'].includes(window.location.port) ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
  if (window.location.protocol === 'https:') return `wss://${window.location.host}/ws`;
  return isDev ? `ws://${window.location.hostname}:8080` : `ws://${window.location.host}/ws`;
};

class SandeshClient {
  constructor() {
    this._ws = null;
    this._status = 'idle';
    this._pending = new Map();
    this._seq = 0;
    this._connectPromise = null;
    this._user = null;
    this._epoch = 0;
    this._shared = null; // shared sandeshSocket instance from the host app
  }

  // Use an already-authenticated socket from the host app instead of opening a new one.
  // This avoids a second WebSocket connection and all the URL/auth headaches that come with it.
  useShared(socket) {
    this._shared = socket;
  }

  setUser(user) {
    this._user = user;
    if (this._status !== 'idle') {
      this._reset();
      this._connectPromise = null;
    }
  }

  _resolveUser() {
    if (this._user) return this._user;
    // Fall back to the Sandesh chat app's stored session (same browser origin)
    try {
      const stored = localStorage.getItem('sandesh_session_user');
      if (stored) return JSON.parse(stored);
    } catch {}
    return null;
  }

  _reset() {
    this._epoch++;
    this._status = 'idle';
    if (this._ws) {
      try {
        this._ws.onopen = null;
        this._ws.onmessage = null;
        this._ws.onerror = null;
        this._ws.onclose = null;
        this._ws.close();
      } catch {}
      this._ws = null;
    }
    for (const { reject: rej } of this._pending.values()) {
      rej({ code: 'disconnected', message: 'Connection reset' });
    }
    this._pending.clear();
  }

  connect() {
    if (this._status === 'connected') return Promise.resolve();
    if (this._connectPromise) return this._connectPromise;

    const user = this._resolveUser();
    if (!user) {
      const e = new Error('Not signed in to Sandesh. Open the chat first.');
      e.status = 401;
      return Promise.reject(e);
    }

    const epoch = ++this._epoch;
    this._status = 'connecting';

    const raw = new Promise((resolve, reject) => {
      const url = getWsUrl();
      if (!url) { reject(new Error('WebSocket not available')); return; }

      const ws = new WebSocket(url);
      this._ws = ws;

      const timeout = setTimeout(() => {
        const e = new Error('Connection to Sandesh timed out');
        e.status = 503;
        reject(e);
        try { ws.close(); } catch {}
      }, 8000);

      ws.onopen = () => {
        if (this._epoch !== epoch) { try { ws.close(); } catch {}; return; }
        const username = (user.username || user.name || 'user').toLowerCase().replace(/\s+/g, '_').slice(0, 24);
        ws.send(JSON.stringify({
          username,
          token: user.token || 'web-' + Date.now(),
          armSessionId: user.armSessionId || 'sess-' + Date.now(),
        }));
      };

      ws.onmessage = (e) => {
        if (this._epoch !== epoch) return;
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }

        if (msg.type === 'welcome') {
          clearTimeout(timeout);
          this._status = 'connected';
          resolve();
          return;
        }

        if (msg.type === 'sd' && msg.reqId !== undefined) {
          const p = this._pending.get(msg.reqId);
          if (p) {
            this._pending.delete(msg.reqId);
            if (msg.ok) p.resolve(msg.data ?? {});
            else p.reject(msg.error ?? { code: 'error' });
          }
          return;
        }

        // auth rejection before welcome
        if (msg.type === 'error' && this._status === 'connecting') {
          clearTimeout(timeout);
          reject(Object.assign(new Error(msg.message || 'Handshake rejected'), { status: 401 }));
        }
      };

      ws.onerror = () => {
        if (this._epoch !== epoch) return;
        clearTimeout(timeout);
        reject(Object.assign(new Error('Cannot connect to Sandesh backend'), { status: 503 }));
      };

      ws.onclose = () => {
        if (this._epoch !== epoch) return;
        clearTimeout(timeout);
        this._connectPromise = null;
        this._status = 'idle';
        for (const { reject: rej } of this._pending.values()) {
          rej({ code: 'disconnected', message: 'Connection closed' });
        }
        this._pending.clear();
        reject(Object.assign(new Error('Connection closed before handshake'), { status: 503 }));
      };
    });

    this._connectPromise = raw.catch((e) => {
      this._connectPromise = null;
      this._status = 'idle';
      throw e;
    });

    return this._connectPromise;
  }

  sd(action, args = {}) {
    log.info(`[sd] -> ${action}`, args);
    // Delegate to the host app's shared socket when available — avoids a second connection.
    if (this._shared) return this._shared.sd(action, args);
    return this.connect().then(
      () =>
        new Promise((resolve, reject) => {
          if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
            reject({ code: 'not_connected', message: 'Not connected' });
            return;
          }
          const reqId = `r${++this._seq}`;
          const timer = setTimeout(() => {
            if (this._pending.has(reqId)) {
              this._pending.delete(reqId);
              reject({ code: 'timeout', message: 'Request timed out' });
            }
          }, 10000);
          this._pending.set(reqId, {
            resolve: (d) => { clearTimeout(timer); log.info(`[sd] <- ${action} ok`); resolve(d); },
            reject: (err) => { clearTimeout(timer); log.warn(`[sd] xx ${action}`, err); reject(err); },
          });
          this._ws.send(`/sd ${action} ${JSON.stringify({ ...args, reqId })}`);
        })
    );
  }
}

const _client = new SandeshClient();

// ─── Data model mapping ────────────────────────────────────────────────────────
// Web field type names ↔ Sandesh field type names (only difference is wholeNumber)
const TYPE_TO_SD = { wholeNumber: 'wholenumber' };
const TYPE_FROM_SD = { wholenumber: 'wholeNumber' };

const slugify = (str) =>
  (str || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || 'struct';

function webFieldToSandesh(f) {
  return { name: f.id, type: TYPE_TO_SD[f.type] || f.type, caption: f.label, required: !!f.required };
}

function sandeshFieldToWeb(f) {
  return { id: f.name, label: f.caption || f.name, type: TYPE_FROM_SD[f.type] || f.type, required: !!f.required };
}

// payload from buildStructPayload: { name (display), key (stable key), fields, sections }
function webStructToSandesh(payload) {
  const sdName = (payload.key || '').trim() || slugify(payload.name);
  return {
    name: sdName,
    caption: payload.name,
    fields: (payload.fields || []).map(webFieldToSandesh),
  };
}

// Sandesh tstruct → web struct shape expected by the UI
function sandeshStructToWeb(s) {
  const fields = (s.fields || []).map(sandeshFieldToWeb);
  return {
    id: s.name,           // Sandesh name is used as the web id (stable, URL-safe)
    name: s.caption || s.name,
    key: s.name,
    fields,
    sections: [],
    fieldCount: fields.length,
    sectionCount: 0,
    createdBy: s.owner || null,
    createdAt: s.createdAt || null,
    modifiedAt: s.modifiedAt || null,
  };
}

// Sandesh submission → web record shape
function sandeshSubToWeb(sub) {
  return {
    id: sub.id,
    structId: sub.tstruct,
    data: sub.values || {},
    createdBy: sub.submittedBy || null,
    createdAt: sub.submittedAt || null,
  };
}

function toApiError(err) {
  if (err instanceof Error) return err;
  const msg = err?.message || err?.code || 'Request failed';
  const e = new Error(msg);
  const code = err?.code;
  e.status =
    code === 'not_found' ? 404 :
    code === 'forbidden' ? 403 :
    code === 'duplicate' ? 409 :
    (code === 'not_connected' || code === 'timeout') ? 503 : 500;
  return e;
}

// ─── Structs API ──────────────────────────────────────────────────────────────
export const listStructs = () =>
  _client.sd('tstruct.user.list')
    .then((r) => (r.tstructs || []).map(sandeshStructToWeb))
    .catch((e) => { throw toApiError(e); });

export const getStruct = (structRef) =>
  _client.sd('tstruct.user.get', { name: structRef })
    .then((r) => sandeshStructToWeb(r.tstruct))
    .catch((e) => { throw toApiError(e); });

export const createStruct = (payload) => {
  const sdPayload = webStructToSandesh(payload);
  return _client.sd('tstruct.user.save', sdPayload)
    .then(() => ({ structId: sdPayload.name }))
    .catch((e) => { throw toApiError(e); });
};

// Sandesh org structs are immutable after creation — deleting + recreating would lose all records.
export const updateStruct = (_structRef, _payload) =>
  Promise.reject(
    Object.assign(
      new Error('Org-wide struct definitions cannot be edited after creation. Delete and recreate to change fields.'),
      { status: 400 }
    )
  );

// ─── Records API (Sandesh submissions) ────────────────────────────────────────
export const listRecords = (structRef, opts = {}) =>
  _client.sd('submissions.list', {
    tstruct: structRef,
    ...(opts.ref ? { ref: opts.ref } : {}),
  })
    .then((r) => (r.submissions || []).map(sandeshSubToWeb))
    .catch((e) => { throw toApiError(e); });

export const getRecord = (structRef, recordId) =>
  _client.sd('submissions.list', { tstruct: structRef })
    .then((r) => {
      const sub = (r.submissions || []).find((s) => s.id === recordId);
      if (!sub) {
        const e = new Error('Record not found');
        e.status = 404;
        throw e;
      }
      return sandeshSubToWeb(sub);
    })
    .catch((e) => { throw toApiError(e); });

export const createRecord = (structRef, data, extra = {}) =>
  _client.sd('tstruct.user.submit', {
    name: structRef,
    values: data,
    ...(extra.ref !== undefined ? { ref: extra.ref } : {}),
    ...(extra.meta !== undefined ? { meta: extra.meta } : {}),
  })
    .then((r) => ({ record: sandeshSubToWeb(r.submission) }))
    .catch((e) => { throw toApiError(e); });

export const updateRecord = (_structRef, recordId, data, extra = {}) =>
  _client.sd('submissions.update', {
    id: recordId,
    values: data,
    ...(extra.meta !== undefined ? { meta: extra.meta } : {}),
  })
    .then((r) => ({
      record: sandeshSubToWeb(
        r.submission || { id: recordId, tstruct: _structRef, values: data, submittedAt: null }
      ),
    }))
    .catch((e) => { throw toApiError(e); });

// ─── Selection field helper ────────────────────────────────────────────────────
export async function fetchSelectionItems(apiUrl) {
  log.info(`-> GET (selection) ${apiUrl}`);
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const arr = Array.isArray(json) ? json : json.items || json.data || json.results || [];
    const items = arr.map((it) =>
      typeof it === 'object' && it !== null
        ? {
            value: String(it.id ?? it.value ?? it.name ?? it.label ?? it.title),
            label: String(it.label ?? it.name ?? it.title ?? it.id ?? it.value),
            raw: it,
          }
        : { value: String(it), label: String(it), raw: it }
    );
    log.info(`<- (selection) ${apiUrl}: ${items.length} items`);
    return items;
  } catch (e) {
    log.error(`xx (selection) ${apiUrl}`, { message: e.message });
    throw e;
  }
}

// ─── Options + Files: kept in local browser storage ───────────────────────────
// There is no Sandesh backend action for options or files; they stay in IndexedDB.
const enc = encodeURIComponent;

async function localRequest(method, path, body) {
  const { status, body: json } = await handle(method, path, body, { user: config.user });
  if (status >= 400) {
    const err = new Error(json.error || `Request failed (${status})`);
    err.status = status;
    err.details = json.errors;
    throw err;
  }
  return json;
}

export const listOptions = () => localRequest('GET', '/api/options').then((r) => r.options);
export const getOption = (optionId) => localRequest('GET', `/api/options/${enc(optionId)}`).then((r) => r.option);
export const createOption = (payload) => localRequest('POST', '/api/options', payload);
export const updateOption = (optionId, payload) => localRequest('PUT', `/api/options/${enc(optionId)}`, payload);
export const deleteOption = (optionId) => localRequest('DELETE', `/api/options/${enc(optionId)}`);

export const listFiles = () => localRequest('GET', '/api/files').then((r) => r.files);
export const uploadFile = (file) => localRequest('POST', '/api/files', { file });

export async function downloadFile(fileId) {
  const { file, blob } = await localRequest('GET', `/api/files/${enc(fileId)}`);
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = file.originalName || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10000);
  log.info(`saved "${file.originalName}" (${blob.size} bytes)`);
  return { name: file.originalName, size: blob.size };
}
