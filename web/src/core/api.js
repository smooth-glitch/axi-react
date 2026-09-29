import { createLogger } from './logger';

const log = createLogger('api');

// ─── Configuration ────────────────────────────────────────────────────────────
// configure({ user, storageName, maxUploadMb }) may be called by a host application at startup.
// apiUrl / getAuthToken / headers are still accepted for backwards-compat but are no longer used.
let config = {
  user: null,
  storageName: 'tstruct',
  maxUploadMb: 10,
};

export function configure(next = {}) {
  config = { ...config, ...next, headers: { ...config.headers, ...(next.headers || {}) } };
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
    // The host's sd() resolves with the raw {ok, data, error} envelope and never
    // rejects; this client's callers expect plain data or a rejection.
    if (this._shared) {
      return this._shared.sd(action, args).then((res) => {
        if (res && res.ok) return res.data ?? {};
        const err = (res && res.error) || { code: 'error', message: 'Request failed' };
        log.warn(`[sd] xx ${action}`, err);
        throw err;
      });
    }
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
// The studio's struct model <-> Sandesh's lite-tstruct definition. The mapping is lossless for everything the
// builder can express (list options, ranges, sections, conditions, mobile/fill settings) so a saved struct can be
// opened again and edited without losing anything.
const TYPE_TO_SD = { wholeNumber: 'wholenumber' };
const TYPE_FROM_SD = { wholenumber: 'wholeNumber' };

// studio operator <-> Sandesh op. "contains" has no exact server equivalent; equality on a multi-value is the closest.
const OP_TO_SD = { equals: 'eq', notEquals: 'ne', gt: 'gt', lt: 'lt', contains: 'eq' };
const OP_FROM_SD = { eq: 'equals', ne: 'notEquals', gt: 'gt', lt: 'lt', gte: 'gt', lte: 'lt' };

const slugify = (str) =>
  (str || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || 'struct';

function conditionToSd(c) {
  if (!c || !c.field) return null;
  return { field: c.field, op: OP_TO_SD[c.operator] || 'eq', value: c.value };
}
function conditionFromSd(c) {
  if (!c) return undefined;
  // all/any groups can't be edited in the studio; show the first clause so nothing crashes
  const first = Array.isArray(c.all) ? c.all[0] : Array.isArray(c.any) ? c.any[0] : c;
  if (!first || !first.field) return undefined;
  return { field: first.field, operator: OP_FROM_SD[first.op] || 'equals', value: first.value === undefined ? '' : first.value };
}

function webFieldToSandesh(f) {
  const out = {
    name: f.id,
    type: TYPE_TO_SD[f.type] || f.type,
    caption: f.label,
    required: !!f.required,
    section: f.sectionId || null,
    condition: conditionToSd(f.condition),
  };
  switch (f.type) {
    case 'text':
      out.multiline = !!f.multiline;
      break;
    case 'wholeNumber':
    case 'number':
    case 'date':
    case 'time':
      if (f.min !== undefined && f.min !== '') out.min = f.min;
      if (f.max !== undefined && f.max !== '') out.max = f.max;
      break;
    case 'list':
      out.options = f.options || [];
      break;
    case 'selection':
      out.api = f.apiUrl || null;
      break;
    case 'fill':
      out.fillFrom = f.sourceField || null;
      out.sourceProp = f.sourceProp || null;
      break;
    case 'mobile':
      out.withCountryCode = !!f.countryPicker;
      out.countryPicker = !!f.countryPicker;
      if (f.defaultCountry) out.defaultCountry = f.defaultCountry;
      break;
    default:
      break;
  }
  return out;
}

function sandeshFieldToWeb(f) {
  const out = {
    id: f.name,
    label: f.caption || f.name,
    type: TYPE_FROM_SD[f.type] || f.type,
    required: !!f.required,
  };
  if (f.section) out.sectionId = f.section;
  const cond = conditionFromSd(f.condition);
  if (cond) out.condition = cond;
  if (f.multiline) out.multiline = true;
  if (f.min !== undefined && f.min !== null) out.min = f.min;
  if (f.max !== undefined && f.max !== null) out.max = f.max;
  if (Array.isArray(f.options)) out.options = f.options;
  if (f.api) out.apiUrl = f.api;
  if (f.fillFrom) out.sourceField = f.fillFrom;
  if (f.sourceProp) out.sourceProp = f.sourceProp;
  if (f.countryPicker) out.countryPicker = true;
  if (f.defaultCountry) out.defaultCountry = f.defaultCountry;
  return out;
}

const sectionToSandesh = (sec) => ({ name: sec.id, caption: sec.label, condition: conditionToSd(sec.condition) });
const sectionFromSandesh = (sec) => {
  const out = { id: sec.name, label: sec.caption || sec.name };
  const cond = conditionFromSd(sec.condition);
  if (cond) out.condition = cond;
  return out;
};

// payload from buildStructPayload: { name (display), key (stable key), fields, sections }
function webStructToSandesh(payload) {
  const sdName = (payload.key || '').trim() || slugify(payload.name);
  return {
    name: sdName,
    caption: payload.name,
    fields: (payload.fields || []).map(webFieldToSandesh),
    sections: (payload.sections || []).map(sectionToSandesh),
  };
}

// Sandesh tstruct → web struct shape expected by the UI
function sandeshStructToWeb(s) {
  const fields = (s.fields || []).map(sandeshFieldToWeb);
  const sections = (s.sections || []).map(sectionFromSandesh);
  return {
    id: s.name,           // Sandesh name is used as the web id (stable, URL-safe)
    name: s.caption || s.name,
    key: s.name,
    fields,
    sections,
    fieldCount: fields.length,
    sectionCount: sections.length,
    createdBy: s.owner || null,
    createdAt: s.createdTs || null,
    modifiedAt: s.modifiedTs || null,
  };
}

// Sandesh submission → web record shape (backend fields: id, by, ts, editedTs, values)
function sandeshSubToWeb(sub) {
  return {
    id: sub.id,
    structId: sub.tstruct,
    data: sub.values || {},
    createdBy: sub.by || null,
    createdAt: sub.ts || null,
    modifiedAt: sub.editedTs || sub.ts || null,
  };
}

// The signed-in user's username, used to decide who may delete a struct / edit or delete a record
// (the server enforces the same rules; this only decides which buttons to show).
export function currentUsername() {
  const u = config.user || _client._resolveUser();
  return u?.username ? String(u.username).toLowerCase() : null;
}
export const isMine = (owner) => !!owner && !!currentUsername() && String(owner).toLowerCase() === currentUsername();

// Route params are strings; the backend's ids are numbers.
const numId = (id) => (typeof id === 'number' ? id : Number.parseInt(id, 10));

function toApiError(err) {
  if (err instanceof Error) return err;
  const msg = err?.message || err?.code || 'Request failed';
  const e = new Error(msg);
  const code = err?.code;
  // Server field errors {fields:{name:message}} -> the form's [{fieldId, message}]
  if (err?.details?.fields && typeof err.details.fields === 'object') {
    e.details = Object.entries(err.details.fields).map(([fieldId, message]) => ({ fieldId, message }));
  }
  e.status =
    code === 'invalid_values' ? 422 :
    code === 'not_found' ? 404 :
    code === 'forbidden' ? 403 :
    code === 'duplicate' ? 409 :
    (code === 'not_connected' || code === 'timeout') ? 503 : 500;
  return e;
}

// ─── Live changes ─────────────────────────────────────────────────────────────
// The server pushes small "something changed" events over the shared socket (tstructs_changed, options_changed,
// submissions_changed). Screens re-read what they show when one arrives, so a change made anywhere -- the chat, the
// admin console, another user -- appears everywhere at once. `resync` is delivered after a reconnect, since events
// sent while offline are lost.
const LIVE_EVENTS = new Set(['tstructs_changed', 'options_changed', 'submissions_changed']);

export function subscribeChanges(handler) {
  const shared = _client._shared;
  if (!shared || typeof shared.subscribe !== 'function') return () => {};
  return shared.subscribe((ev) => {
    if (ev?.type === 'sd_event' && LIVE_EVENTS.has(ev.event)) handler({ event: ev.event, ...(ev.data || {}) });
    else if (ev?.type === 'status_change' && ev.status === 'connected') handler({ event: 'resync' });
  });
}

// ─── Structs API ──────────────────────────────────────────────────────────────
// Two kinds of form can be opened: structures users created (tstruct.user.*, open to everyone) and forms an
// administrator defined (tstruct.get / tstruct.submit, only for users an option offers them to). `scopeByName`
// remembers which is which so records are saved through the right action.
const scopeByName = new Map();

// Org config lookups (branches / departments / designations / categories / affiliates) for the Option
// Builder's "Applicable to" dropdowns. User-level, names only.
export const listCfgLookups = () =>
  _client.sd('cfg.lookups')
    .then((r) => ({
      branches: r.branches || [],
      departments: r.departments || [],
      designations: r.designations || [],
      categories: r.categories || [],
      affiliates: (r.affiliates || []).map((a) => a.name),
    }))
    .catch((e) => { throw toApiError(e); });

export const listStructs = () =>
  _client.sd('tstruct.user.list')
    .then(async (r) => {
      const structs = (r.tstructs || []).map(sandeshStructToWeb);
      structs.forEach((x) => scopeByName.set(x.id.toLowerCase(), 'user'));
      // tstruct.user.list doesn't include how many records each struct has, so fetch it
      // per struct. Best-effort: a struct whose count fails to load just shows 0.
      const counts = await Promise.all(
        structs.map((s) =>
          _client.sd('submissions.list', { tstruct: s.id })
            .then((res) => (res.submissions || []).length)
            .catch(() => 0)
        )
      );
      structs.forEach((s, i) => { s.recordCount = counts[i]; });
      return structs;
    })
    .catch((e) => { throw toApiError(e); });

export const getStruct = (structRef) =>
  _client.sd('tstruct.user.get', { name: structRef })
    .then((r) => {
      scopeByName.set(String(structRef).toLowerCase(), 'user');
      return sandeshStructToWeb(r.tstruct);
    })
    .catch((e) => {
      if (e?.code !== 'not_found') throw toApiError(e);
      // not a user-made structure: try an administrator-defined form this user has been offered
      return _client.sd('tstruct.get', { name: structRef })
        .then((r) => {
          scopeByName.set(String(structRef).toLowerCase(), 'admin');
          return sandeshStructToWeb(r.tstruct);
        })
        .catch((e2) => { throw toApiError(e2?.code === 'forbidden' ? { code: 'not_found', message: "That form isn't available to you." } : e2); });
    });

export const createStruct = (payload) => {
  const sdPayload = webStructToSandesh(payload);
  return _client.sd('tstruct.user.save', sdPayload)
    .then(() => ({ structId: sdPayload.name }))
    .catch((e) => { throw toApiError(e); });
};

// Only the creator may change a struct (the server enforces it). The name/key is its identity and never changes;
// caption, fields and sections are replaced. Records already saved are re-checked against the new definition when
// they are next edited.
export const updateStruct = (structRef, payload) => {
  const sd = webStructToSandesh(payload);
  return _client.sd('tstruct.user.update', { name: structRef, caption: sd.caption, fields: sd.fields, sections: sd.sections })
    .then(() => ({ structId: structRef }))
    .catch((e) => { throw toApiError(e); });
};

// Only the creator may delete a struct (server rule). Records already submitted against it are kept by the
// server but can no longer be edited.
export const deleteStruct = (structRef) =>
  _client.sd('tstruct.user.delete', { name: structRef })
    .then(() => ({ deleted: true }))
    .catch((e) => { throw toApiError(e); });

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
      const sub = (r.submissions || []).find((s) => String(s.id) === String(recordId));
      if (!sub) {
        const e = new Error('Record not found');
        e.status = 404;
        throw e;
      }
      return sandeshSubToWeb(sub);
    })
    .catch((e) => { throw toApiError(e); });

export const createRecord = (structRef, data, extra = {}) =>
  _client.sd(scopeByName.get(String(structRef).toLowerCase()) === 'admin' ? 'tstruct.submit' : 'tstruct.user.submit', {
    name: structRef,
    values: data,
    ...(extra.ref !== undefined ? { ref: extra.ref } : {}),
    ...(extra.meta !== undefined ? { meta: extra.meta } : {}),
  })
    .then((r) => ({ record: sandeshSubToWeb(r.submission) }))
    .catch((e) => { throw toApiError(e); });

export const deleteRecord = (_structRef, recordId) =>
  _client.sd('submissions.delete', { id: numId(recordId) })
    .then(() => ({ deleted: true }))
    .catch((e) => { throw toApiError(e); });

export const updateRecord = (_structRef, recordId, data, extra = {}) =>
  _client.sd('submissions.update', {
    id: numId(recordId),
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

// ─── Options (stored on the server) ───────────────────────────────────────────
// Any signed-in user may make options of their own; the server decides who sees which option ("applicable to")
// and only lets an option's creator (or an administrator) change or delete it.

const httpBase = () => {
  if (config.apiBase) return String(config.apiBase).replace(/\/+$/, '');
  if (typeof window === 'undefined') return '/api/sd';
  const isDev = ['5173', '3000', '5174'].includes(window.location.port) || ['localhost', '127.0.0.1'].includes(window.location.hostname);
  return isDev ? `http://${window.location.hostname}:8080/api/sd` : '/api/sd';
};
const authToken = () => (typeof config.getToken === 'function' ? config.getToken() : (config.user || _client._resolveUser())?.token);

// org user categories (for translating "applicable to" category names), fetched once per session
let categoriesPromise = null;
const orgCategories = () => {
  if (!categoriesPromise) {
    categoriesPromise = fetch(`${httpBase()}/public`)
      .then((r) => r.json())
      .then((j) => (j?.data?.categories || []))
      .catch(() => { categoriesPromise = null; return []; });
  }
  return categoriesPromise;
};

const scopeOf = (v) => (Array.isArray(v) ? { scope: 'selected', selected: v } : { scope: 'all', selected: [] });

// studio "applicable to" -> server `applicable`: {categories, affiliates, departments, branches, designations},
// each "all" (left out) or a list.
async function applicableToSd(a) {
  const out = {};
  if (!a) return out;
  const cats = await orgCategories();
  const canon = (c) => {
    const lc = String(c).toLowerCase();
    if (lc === 'employee') return 'Employee';
    if (lc === 'affiliate') return 'Affiliate';
    return cats.find((x) => x.toLowerCase() === lc) || c; // unknown -> the server rejects it with a clear message
  };
  if (a.userCategories?.scope === 'selected') out.categories = a.userCategories.selected.map(canon);
  const pick = (block, key, into) => {
    const sc = a[block]?.[key];
    if (sc?.scope === 'selected') out[into] = sc.selected;
  };
  pick('affiliate', 'affiliates', 'affiliates');
  pick('employee', 'departments', 'departments');
  pick('employee', 'branches', 'branches');
  pick('employee', 'designations', 'designations');
  return out;
}

const applicableToWeb = (ap) => {
  if (!ap) return undefined; // the run list doesn't carry it: unknown, not "everyone"
  return {
    userCategories: Array.isArray(ap.categories) ? { scope: 'selected', selected: ap.categories.map((c) => c.toLowerCase()) } : scopeOf(undefined),
    affiliate: { affiliates: scopeOf(ap.affiliates) },
    employee: { departments: scopeOf(ap.departments), branches: scopeOf(ap.branches), designations: scopeOf(ap.designations) },
  };
};

const DISPLAY_TO_SD = { table: 'table', nameValuePair: 'name_value', text: 'text' };
const DISPLAY_FROM_SD = { table: 'table', name_value: 'nameValuePair', text: 'text' };
const AXPERT_TO_SD = { tstruct: 'axpert_tstruct', smartView: 'axpert_smartview', iview: 'axpert_iview', customPage: 'axpert_page' };
const AXPERT_FROM_SD = { axpert_tstruct: 'tstruct', axpert_smartview: 'smartView', axpert_iview: 'iview', axpert_page: 'customPage' };

// The option opens a struct by name; prefer a struct the user can see (its key is what the server needs).
async function resolveStructName(structName) {
  const n = String(structName || '').trim();
  try {
    const structs = await listStructs();
    const lc = n.toLowerCase();
    const hit = structs.find((x) => x.name.trim().toLowerCase() === lc) || structs.find((x) => x.key && x.key.toLowerCase() === lc);
    if (hit) return hit.key || hit.id;
  } catch { /* fall through: the server validates the name */ }
  return n;
}

async function optionToSd(payload, id) {
  const c = payload.config || {};
  const out = { caption: payload.caption, applicable: await applicableToSd(payload.applicableTo) };
  if (id) out.id = id;
  switch (payload.type) {
    case 'dataInput': return { ...out, type: 'data_input', target: await resolveStructName(c.structName) };
    case 'download': return { ...out, type: 'download', target: c.fileId || '' };
    case 'upload': return { ...out, type: 'upload' };
    case 'apiDisplay': return { ...out, type: 'get_data', target: c.apiName || '', display: DISPLAY_TO_SD[c.displayAs] || 'table' };
    case 'pay': return { ...out, type: 'pay', target: c.paymentConfig || '' };
    case 'axpertOption': return { ...out, type: AXPERT_TO_SD[c.subtype] || 'axpert_tstruct', target: c.target || '' };
    default: throw Object.assign(new Error('Unknown option type.'), { status: 400 });
  }
}

function optionFromSd(o, canManage) {
  let type;
  let config = {};
  switch (o.type) {
    case 'data_input': type = 'dataInput'; config = { structName: o.target || '' }; break;
    case 'download': type = 'download'; config = { fileId: o.target || '' }; break;
    case 'upload': type = 'upload'; break;
    case 'get_data': type = 'apiDisplay'; config = { apiName: o.target || '', displayAs: DISPLAY_FROM_SD[o.display] || 'table' }; break;
    case 'pay': type = 'pay'; config = { paymentConfig: o.target || '' }; break;
    default: type = 'axpertOption'; config = { subtype: AXPERT_FROM_SD[o.type] || 'tstruct', target: o.target || '' };
  }
  return {
    id: o.id,
    caption: o.caption,
    type,
    config,
    applicableTo: applicableToWeb(o.applicable),
    targetScope: o.targetScope || null,
    createdBy: o.owner || null,
    createdAt: o.createdTs || null,
    modifiedAt: o.modifiedTs || null,
    active: o.active !== false,
    canManage: !!canManage,
  };
}

// Everything this user can run (options.list: the server applies "applicable to") plus everything they can manage
// (their own; an administrator's is all). Managed ones carry the full definition.
export async function listOptions() {
  const [runnable, mine] = await Promise.all([
    _client.sd('options.list').catch((e) => { throw toApiError(e); }),
    _client.sd('option.user.list').catch((e) => { throw toApiError(e); }),
  ]);
  const byId = new Map();
  for (const o of runnable.options || []) byId.set(o.id, optionFromSd(o, false));
  for (const o of mine.options || []) byId.set(o.id, optionFromSd(o, true));
  return [...byId.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export const getOption = async (optionId) => {
  const all = await listOptions();
  const hit = all.find((o) => o.id === optionId);
  if (!hit) throw Object.assign(new Error('Option not found'), { status: 404 });
  return hit;
};

export async function createOption(payload) {
  const sd = await optionToSd(payload);
  return _client.sd('option.user.save', sd)
    .then((r) => ({ optionId: r.option.id, option: optionFromSd(r.option, true) }))
    .catch((e) => { throw toApiError(e); });
}

export async function updateOption(optionId, payload) {
  const sd = await optionToSd(payload, optionId);
  return _client.sd('option.user.save', sd)
    .then((r) => ({ option: optionFromSd(r.option, true) }))
    .catch((e) => { throw toApiError(e); });
}

export const deleteOption = (optionId) =>
  _client.sd('option.user.delete', { id: optionId })
    .then(() => ({ deleted: true }))
    .catch((e) => { throw toApiError(e); });

// ─── Files (stored on the server) ─────────────────────────────────────────────
// Upload = POST /files?name= (raw bytes); download = GET /files/:id. Both need the session token. A file can be read
// by its uploader, an administrator, or anyone a download option pointing at it applies to.
const fileToWeb = (f) => ({ id: f.id, originalName: f.name, mimeType: f.mime, size: f.size, uploadedAt: f.ts, uploadedBy: f.by });

async function fileRequest(path, init = {}) {
  const token = authToken();
  if (!token) throw Object.assign(new Error('Sign in to Sandesh first.'), { status: 401 });
  let res;
  try {
    res = await fetch(`${httpBase()}${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
  } catch {
    throw Object.assign(new Error('Unable to reach the Sandesh server.'), { status: 503 });
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json())?.error?.message || msg; } catch { /* not JSON */ }
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return res;
}

export const listFiles = () => fileRequest('/files').then((r) => r.json()).then((j) => (j.data?.files || []).map(fileToWeb));

export async function uploadFile(file) {
  const max = config.maxUploadMb || 10; // keep in step with SANDESH_MAX_FILE_MB and nginx client_max_body_size
  if (file.size > max * 1024 * 1024) throw Object.assign(new Error(`File too large (max ${max} MB).`), { status: 413 });
  if (file.size === 0) throw Object.assign(new Error('That file is empty.'), { status: 400 });
  const res = await fileRequest(`/files?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  const meta = fileToWeb((await res.json()).data.file);
  return { fileId: meta.id, file: meta };
}

export async function downloadFile(fileId) {
  const res = await fileRequest(`/files/${encodeURIComponent(fileId)}`);
  const blob = await res.blob();
  let name = 'download';
  try { name = decodeURIComponent(res.headers.get('x-file-name') || '') || name; } catch { /* keep default */ }
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10000);
  log.info(`saved "${name}" (${blob.size} bytes)`);
  return { name, size: blob.size };
}
