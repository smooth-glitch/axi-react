import { createLogger } from './logger';
import { handle } from './localApi';
import { setStorageName } from './localDb';
import { setMaxUploadMb } from './localApi';

const log = createLogger('api');

// There is no backend any more: structs, records, options and uploaded files are stored in the browser (IndexedDB,
// see localDb.js / localApi.js). This module keeps the same functions and return values the UI and host apps
// already use, so nothing that imports it had to change.
//
// Runtime configuration - a host application may call configure({ user, storageName, maxUploadMb }) once at startup:
//   user          -> becomes createdBy / modifiedBy when a save does not name one
//   storageName   -> name of the IndexedDB database (default "tstruct"); use it to keep a host's data separate
//   maxUploadMb   -> largest file accepted by uploadFile (default 25)
// apiUrl, getAuthToken and headers are still accepted so existing host code keeps working, but they are ignored.
let config = {
  user: null,
  storageName: 'tstruct',
  maxUploadMb: 25,
  apiUrl: null, // ignored (no server)
  getAuthToken: null, // ignored
  headers: {}, // ignored
};

export function configure(next = {}) {
  config = { ...config, ...next, headers: { ...config.headers, ...(next.headers || {}) } };
  setStorageName(config.storageName);
  setMaxUploadMb(config.maxUploadMb);
  return config;
}
export const getConfig = () => config;

const enc = encodeURIComponent;

// Runs one call against the local store; returns the response body, or throws an Error carrying .status / .details.
async function request(method, path, body) {
  log.info(`-> ${method} ${path}`, body && body.file ? { file: body.file.name } : body);
  const started = Date.now();
  const { status, body: json } = await handle(method, path, body, { user: config.user });
  const ms = Date.now() - started;
  if (status >= 400) {
    log.error(`xx ${method} ${path} ${status} (${ms}ms)`, json);
    const err = new Error(json.error || `Request failed (${status})`);
    err.status = status;
    err.details = json.errors;
    throw err;
  }
  log.info(`<- ${method} ${path} ${status} (${ms}ms)`);
  return json;
}

// Anywhere a struct is referenced, `structRef` may be its id (uuid) or its stable key (e.g. "leave-request").
export const listStructs = () => request('GET', '/api/structs').then((r) => r.structs);
export const getStruct = (structRef) => request('GET', `/api/structs/${enc(structRef)}`).then((r) => r.struct);
export const createStruct = (payload) => request('POST', '/api/structs', payload);
export const updateStruct = (structRef, payload) => request('PUT', `/api/structs/${enc(structRef)}`, payload);

// opts.ref: only records linked to that host reference
export const listRecords = (structRef, opts = {}) =>
  request('GET', `/api/structs/${enc(structRef)}/records${opts.ref ? `?ref=${enc(opts.ref)}` : ''}`).then((r) => r.records);
export const getRecord = (structRef, recordId) => request('GET', `/api/structs/${enc(structRef)}/records/${enc(recordId)}`).then((r) => r.record);
// extra: { ref, meta } - optional host linking fields
export const createRecord = (structRef, data, extra = {}) => request('POST', `/api/structs/${enc(structRef)}/records`, { data, ...extra });
export const updateRecord = (structRef, recordId, data, extra = {}) =>
  request('PUT', `/api/structs/${enc(structRef)}/records/${enc(recordId)}`, { data, ...extra });

// Runtime fetch for `selection` fields. Accepts an array (or {items|data|results: []}) of strings or objects.
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

/* ------------------------------------------------------------------ options + files */
// Options (standalone configurable actions)
export const listOptions = () => request('GET', '/api/options').then((r) => r.options);
export const getOption = (optionId) => request('GET', `/api/options/${enc(optionId)}`).then((r) => r.option);
export const createOption = (payload) => request('POST', '/api/options', payload);
export const updateOption = (optionId, payload) => request('PUT', `/api/options/${enc(optionId)}`, payload);
export const deleteOption = (optionId) => request('DELETE', `/api/options/${enc(optionId)}`);

// Files (kept in the browser's IndexedDB)
export const listFiles = () => request('GET', '/api/files').then((r) => r.files);

// Stores a File / Blob; resolves { fileId, file }
export const uploadFile = (file) => request('POST', '/api/files', { file });

// Saves a stored file to the user's device (temporary <a download>). Resolves { name, size }.
export async function downloadFile(fileId) {
  const { file, blob } = await request('GET', `/api/files/${enc(fileId)}`);
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
