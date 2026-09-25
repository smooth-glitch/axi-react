import { createLogger } from './logger';

const log = createLogger('api');

// Runtime configuration. The standalone app uses the defaults (VITE_API_URL or http://localhost:4000);
// a host application calls configure({ apiUrl, getAuthToken, user, headers }) once at startup.
let config = {
  apiUrl: (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || 'http://localhost:4000',
  getAuthToken: null, // () => string | Promise<string>  -> sent as "Authorization: Bearer <token>"
  user: null, // string -> sent as "X-Tstruct-User" (becomes createdBy / modifiedBy on the server)
  headers: {}, // extra headers for every API call
};

export function configure(next = {}) {
  config = { ...config, ...next, headers: { ...config.headers, ...(next.headers || {}) } };
  return config;
}
export const getConfig = () => config;

const enc = encodeURIComponent;

async function request(method, path, body) {
  const url = `${config.apiUrl.replace(/\/$/, '')}${path}`;
  log.info(`-> ${method} ${url}`, body);
  const started = Date.now();

  const headers = { ...config.headers };
  if (body) headers['Content-Type'] = 'application/json';
  if (config.user) headers['X-Tstruct-User'] = config.user;
  if (config.getAuthToken) {
    const token = await config.getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    log.error(`xx ${method} ${url} network error`, { message: e.message });
    throw new Error(`Cannot reach server at ${config.apiUrl}. Is it running?`);
  }
  const json = await res.json().catch(() => ({}));
  const ms = Date.now() - started;
  if (!res.ok) {
    log.error(`xx ${method} ${url} ${res.status} (${ms}ms)`, json);
    const err = new Error(json.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.details = json.errors;
    throw err;
  }
  log.info(`<- ${method} ${url} ${res.status} (${ms}ms)`, json);
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
const authHeaders = async () => {
  const h = { ...config.headers };
  if (config.user) h['X-Tstruct-User'] = config.user;
  if (config.getAuthToken) {
    const token = await config.getAuthToken();
    if (token) h.Authorization = `Bearer ${token}`;
  }
  return h;
};
const base = () => config.apiUrl.replace(/\/$/, '');

// Options (standalone configurable actions)
export const listOptions = () => request('GET', '/api/options').then((r) => r.options);
export const getOption = (optionId) => request('GET', `/api/options/${enc(optionId)}`).then((r) => r.option);
export const createOption = (payload) => request('POST', '/api/options', payload);
export const updateOption = (optionId, payload) => request('PUT', `/api/options/${enc(optionId)}`, payload);
export const deleteOption = (optionId) => request('DELETE', `/api/options/${enc(optionId)}`);

// Files
export const listFiles = () => request('GET', '/api/files').then((r) => r.files);

// multipart upload (form field "file"); resolves { fileId, file }
export async function uploadFile(file) {
  const url = `${base()}/api/files`;
  log.info(`-> POST ${url} (upload "${file.name}", ${file.size} bytes)`);
  const fd = new FormData();
  fd.append('file', file, file.name);
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: await authHeaders(), body: fd }); // browser sets the multipart boundary
  } catch (e) {
    log.error('xx upload network error', { message: e.message });
    throw new Error(`Cannot reach server at ${config.apiUrl}. Is it running?`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    log.error(`xx POST ${url} ${res.status}`, json);
    const err = new Error(json.error || `Upload failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  log.info(`<- POST ${url} ${res.status}`, json);
  return json;
}

// Downloads a stored file to the user's device (fetch + blob so the auth headers are sent, then a temporary <a download>).
// Resolves { name, size }.
export async function downloadFile(fileId) {
  const url = `${base()}/api/files/${enc(fileId)}`;
  log.info(`-> GET ${url} (download)`);
  let res;
  try {
    res = await fetch(url, { headers: await authHeaders() });
  } catch (e) {
    log.error('xx download network error', { message: e.message });
    throw new Error(`Cannot reach server at ${config.apiUrl}. Is it running?`);
  }
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    log.error(`xx GET ${url} ${res.status}`, json);
    throw new Error(json.error || `Download failed (${res.status})`);
  }
  const disp = res.headers.get('Content-Disposition') || '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disp);
  const plain = /filename="([^"]+)"/i.exec(disp);
  const name = star ? decodeURIComponent(star[1]) : plain ? plain[1] : 'download';
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10000);
  log.info(`<- GET ${url} 200 (saved as "${name}", ${blob.size} bytes)`);
  return { name, size: blob.size };
}
