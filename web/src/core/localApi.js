// The "server" that now runs inside the browser. It keeps the exact REST-shaped contract the app was written against
// (same paths, same response bodies, same status codes and error messages), but stores everything in IndexedDB
// (localDb.js) instead of calling a backend:
//
//   handle('POST', '/api/structs', body, { user })  ->  { status: 201, body: { structId, struct } }
//
// core/api.js turns those responses back into return values / thrown errors, so no screen had to change.
// Business rules (definition checks, record validation, "applicable to" normalisation, option configs) are a
// straight port of what the Express server enforced.
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { db } from './localDb';
import { evaluateCondition } from './conditions';
import { BLOCKS, KNOWN_CATEGORIES } from './options';
import { createLogger } from './logger';

const log = createLogger('local');

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
const fail = (status, message, details) => {
  throw new ApiError(status, message, details);
};

/* ------------------------------------------------------------------ small helpers */
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const nowIso = () => new Date().toISOString();
const newestFirst = (field) => (a, b) => (a[field] < b[field] ? 1 : -1);

export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); // insecure-context fallback (plain http on a non-localhost host)
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
}

// 25 MB by default, like the server's MAX_UPLOAD_MB; configure({ maxUploadMb }) changes it.
let maxUploadMb = 25;
export const setMaxUploadMb = (n) => {
  if (Number(n) > 0) maxUploadMb = Number(n);
};

/* ------------------------------------------------------------------ structs */
const FIELD_TYPES = ['text', 'date', 'time', 'wholeNumber', 'number', 'email', 'url', 'mobile', 'location', 'list', 'selection', 'fill'];
const KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

// Returns an error message, or null when the definition is acceptable.
function definitionError({ name, fields }) {
  if (!name || typeof name !== 'string' || !name.trim()) return 'name is required';
  if (!Array.isArray(fields) || fields.length === 0) return 'fields must be a non-empty array';
  const seen = new Set();
  for (const f of fields) {
    if (!f || !f.id || !f.label || !FIELD_TYPES.includes(f.type)) return 'every field needs an id, a label and a valid type';
    if (seen.has(f.id)) return `duplicate field id "${f.id}"`;
    seen.add(f.id);
  }
  return null;
}

// Keys must not look like uuids so ids and keys can never collide.
const keyError = (key) =>
  typeof key !== 'string' || !KEY_RE.test(key) || UUID_LIKE.test(key)
    ? 'key must be 1-64 characters (letters, digits, _ or -), start with a letter and not look like a uuid'
    : null;

// Accepts either a struct id or a struct key; returns the struct id, or null when nothing matches.
async function resolveStructId(ref) {
  if (!ref) return null;
  if (await db.get('structs', ref)) return ref;
  const owner = (await db.all('structs')).find((s) => s.key === ref);
  return owner ? owner.id : null;
}
const keyOwner = async (key) => (await db.all('structs')).find((s) => s.key === key);

async function createStruct(body, ctx) {
  const { name, fields, sections, key } = body;
  const bad = definitionError({ name, fields });
  if (bad) fail(400, bad);
  if (key !== undefined && key !== null && key !== '') {
    const kerr = keyError(key);
    if (kerr) fail(400, kerr);
    if ((await keyOwner(key)) || (await db.get('structs', key))) fail(409, `key "${key}" is already in use`);
  }
  const id = uuid();
  const struct = {
    id,
    ...(key ? { key } : {}),
    name: name.trim(),
    fields,
    sections: Array.isArray(sections) ? sections : [],
    createdBy: body.createdBy || ctx.user || 'anonymous',
    createdAt: nowIso(),
  };
  await db.put('structs', id, struct);
  log.info('structs.create', { structId: id, key, name: struct.name });
  return { status: 201, body: { structId: id, struct } };
}

async function listStructs() {
  const all = await db.all('structs');
  const structs = [];
  for (const s of all) {
    structs.push({
      id: s.id,
      key: s.key,
      name: s.name,
      createdAt: s.createdAt,
      modifiedAt: s.modifiedAt,
      fieldCount: s.fields.length,
      sectionCount: (s.sections || []).length,
      recordCount: await db.count('records', `${s.id}:`),
    });
  }
  structs.sort(newestFirst('createdAt'));
  return { status: 200, body: { structs } };
}

async function getStruct(ref) {
  const id = await resolveStructId(ref);
  const struct = id ? await db.get('structs', id) : null;
  if (!struct) fail(404, 'Struct not found');
  return { status: 200, body: { struct } };
}

// Replaces the definition (id, createdBy and createdAt are kept).
// `key`: omit to keep the current one, send a string to set/change it, or null/"" to remove it.
// Existing records are not migrated: they keep whatever values they were saved with.
async function updateStruct(ref, body, ctx) {
  const structId = await resolveStructId(ref);
  const existing = structId ? await db.get('structs', structId) : null;
  if (!existing) fail(404, 'Struct not found');
  const { name, fields, sections, modifiedBy, key } = body;
  const bad = definitionError({ name, fields });
  if (bad) fail(400, bad);

  let nextKey = existing.key;
  if (key !== undefined) {
    nextKey = key === null || key === '' ? undefined : key;
    if (nextKey) {
      const kerr = keyError(nextKey);
      if (kerr) fail(400, kerr);
      const owner = await keyOwner(nextKey);
      if ((owner && owner.id !== structId) || ((await db.get('structs', nextKey)) && nextKey !== structId)) fail(409, `key "${nextKey}" is already in use`);
    }
  }
  const struct = {
    ...existing,
    name: name.trim(),
    fields,
    sections: Array.isArray(sections) ? sections : [],
    modifiedBy: modifiedBy || ctx.user || 'anonymous',
    modifiedAt: nowIso(),
  };
  if (nextKey) struct.key = nextKey;
  else delete struct.key;
  await db.put('structs', structId, struct);
  log.info('structs.update', { structId, key: nextKey, name: struct.name });
  return { status: 200, body: { structId, struct } };
}

/* ------------------------------------------------------------------ record validation */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const URL_RE = /^(https?:\/\/)[^\s$.?#].[^\s]*$/i;

// Returns [{ fieldId, message }] for a submitted record against its struct definition.
function validateRecord(struct, data) {
  const errors = [];
  for (const field of struct.fields || []) {
    // fields hidden by their own condition or their section's condition are not validated
    if (field.condition && !evaluateCondition(field.condition, data)) continue;
    if (field.sectionId) {
      const section = (struct.sections || []).find((s) => s.id === field.sectionId);
      if (section && section.condition && !evaluateCondition(section.condition, data)) continue;
    }
    const val = data ? data[field.id] : undefined;
    const isEmpty = val === undefined || val === null || val === '';
    const add = (message) => errors.push({ fieldId: field.id, message });
    if (field.required && isEmpty) {
      add(`${field.label || field.id} is required`);
      continue;
    }
    if (isEmpty) continue;

    switch (field.type) {
      case 'wholeNumber': {
        const n = Number(val);
        if (!Number.isInteger(n)) add(`${field.label} must be a whole number`);
        else if (field.min !== undefined && n < field.min) add(`${field.label} must be >= ${field.min}`);
        else if (field.max !== undefined && n > field.max) add(`${field.label} must be <= ${field.max}`);
        break;
      }
      case 'number': {
        const n = Number(val);
        if (Number.isNaN(n)) add(`${field.label} must be a number`);
        else if (field.min !== undefined && n < field.min) add(`${field.label} must be >= ${field.min}`);
        else if (field.max !== undefined && n > field.max) add(`${field.label} must be <= ${field.max}`);
        break;
      }
      case 'email':
        if (!EMAIL_RE.test(val)) add(`${field.label} must be a valid email`);
        break;
      case 'url':
        if (!URL_RE.test(val)) add(`${field.label} must be a valid URL`);
        break;
      case 'date':
        if (typeof val !== 'string' || !DATE_RE.test(val) || Number.isNaN(Date.parse(val))) add(`${field.label} must be a valid date (YYYY-MM-DD)`);
        else if (field.min && val < field.min) add(`${field.label} must be on/after ${field.min}`);
        else if (field.max && val > field.max) add(`${field.label} must be on/before ${field.max}`);
        break;
      case 'time':
        if (typeof val !== 'string' || !TIME_RE.test(val)) add(`${field.label} must be a valid time (HH:MM)`);
        else if (field.min && val < field.min) add(`${field.label} must be at/after ${field.min}`);
        else if (field.max && val > field.max) add(`${field.label} must be at/before ${field.max}`);
        break;
      case 'mobile': {
        const p = parsePhoneNumberFromString(String(val), field.defaultCountry || 'US');
        if (!p || !p.isValid()) add(`${field.label} must be a valid phone number`);
        break;
      }
      case 'location':
        if (typeof val !== 'object' || typeof val.lat !== 'number' || typeof val.lng !== 'number' || Math.abs(val.lat) > 90 || Math.abs(val.lng) > 180) add(`${field.label} must be a valid location {lat, lng}`);
        break;
      case 'list':
        if (Array.isArray(field.options) && !field.options.includes(val)) add(`${field.label} must be one of: ${field.options.join(', ')}`);
        break;
      case 'selection':
        // options come from field.apiUrl at runtime, so only the type is checked here
        if (typeof val !== 'string') add(`${field.label} must be a string`);
        break;
      default:
        break;
    }
  }
  return errors;
}

/* ------------------------------------------------------------------ records */
// Optional linking fields a host application can attach to a record.
//   ref  - string (<= 200 chars), e.g. the host's own entity id ("order-123"); filterable with ?ref=
//   meta - plain JSON object with anything else the host wants to store alongside
function linkError({ ref, meta }) {
  if (ref !== undefined && ref !== null && (typeof ref !== 'string' || ref.length > 200)) return 'ref must be a string of at most 200 characters';
  if (meta !== undefined && meta !== null && (typeof meta !== 'object' || Array.isArray(meta))) return 'meta must be a JSON object';
  return null;
}
const recordKey = (structId, recordId) => `${structId}:${recordId}`;

// `data || {}`, but anything that is not an object is rejected
const dataOf = (data) => {
  if (data === undefined || data === null || data === '') return {};
  if (!isObj(data)) fail(400, 'data must be an object');
  return data;
};

function checkRecord(struct, data) {
  const errors = validateRecord(struct, data);
  if (errors.length) {
    log.warn('record failed validation', { structId: struct.id, errors });
    fail(400, 'Validation failed', errors);
  }
}

async function createRecord(structRef, body, ctx) {
  const structId = (await resolveStructId(structRef)) || structRef;
  const { createdBy, ref, meta } = body;
  const struct = await db.get('structs', structId);
  if (!struct) fail(404, 'Struct not found');
  const badLink = linkError({ ref, meta });
  if (badLink) fail(400, badLink);
  const data = dataOf(body.data);
  checkRecord(struct, data);

  const id = uuid();
  const now = nowIso();
  const by = createdBy || ctx.user || 'anonymous';
  const record = {
    id,
    structId,
    data,
    ...(ref ? { ref } : {}),
    ...(meta ? { meta } : {}),
    createdBy: by,
    createdAt: now,
    modifiedBy: by,
    modifiedAt: now,
  };
  await db.put('records', recordKey(structId, id), record);
  log.info('records.create', { structId, recordId: id, ref });
  return { status: 201, body: { recordId: id, record } };
}

async function listRecords(structRef, query) {
  const structId = (await resolveStructId(structRef)) || structRef;
  let records = await db.all('records', `${structId}:`);
  if (query.ref) records = records.filter((r) => r.ref === query.ref);
  records.sort(newestFirst('createdAt'));
  return { status: 200, body: { records } };
}

async function getRecord(structRef, recordId) {
  const structId = (await resolveStructId(structRef)) || structRef;
  const record = await db.get('records', recordKey(structId, recordId));
  if (!record) fail(404, 'Record not found');
  return { status: 200, body: { record } };
}

// Replaces a record's data (validated against the current definition). id, structId, createdBy and createdAt are
// kept; modifiedBy / modifiedAt are updated. `ref` / `meta`: omit to keep, send a value to replace, or null to remove.
async function updateRecord(structRef, recordId, body, ctx) {
  const structId = (await resolveStructId(structRef)) || structRef;
  const { modifiedBy, ref, meta } = body;
  const struct = await db.get('structs', structId);
  if (!struct) fail(404, 'Struct not found');
  const existing = await db.get('records', recordKey(structId, recordId));
  if (!existing) fail(404, 'Record not found');
  const badLink = linkError({ ref, meta });
  if (badLink) fail(400, badLink);
  const data = dataOf(body.data);
  checkRecord(struct, data);

  const record = { ...existing, data, modifiedBy: modifiedBy || ctx.user || 'anonymous', modifiedAt: nowIso() };
  if (ref !== undefined) (ref ? (record.ref = ref) : delete record.ref);
  if (meta !== undefined) (meta ? (record.meta = meta) : delete record.meta);
  await db.put('records', recordKey(structId, recordId), record);
  log.info('records.update', { structId, recordId });
  return { status: 200, body: { recordId, record } };
}

/* ------------------------------------------------------------------ "applicable to" (see options.js / docs/options.md) */
const effectiveCategories = (uc) => (uc.scope === 'all' ? KNOWN_CATEGORIES : uc.selected);

function normalizeScope(input, label) {
  if (input === undefined || input === null) return { value: { scope: 'all', selected: [] } };
  if (!isObj(input) || !['all', 'selected'].includes(input.scope)) return { error: `${label}.scope must be "all" or "selected"` };
  if (input.scope === 'all') return { value: { scope: 'all', selected: [] } };
  const sel = Array.isArray(input.selected) ? input.selected.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [];
  if (sel.length === 0) return { error: `${label}: choose at least one value, or use scope "all"` };
  return { value: { scope: 'selected', selected: [...new Set(sel)] } };
}

// Returns { applicableTo } (defaults filled, irrelevant blocks dropped) or { error }.
function normalizeApplicable(input) {
  if (input !== undefined && input !== null && !isObj(input)) return { error: 'applicableTo must be an object' };
  const a = input || {};
  const ucIn = a.userCategories === undefined ? { scope: 'all' } : a.userCategories;
  if (!isObj(ucIn) || !['all', 'selected'].includes(ucIn.scope)) return { error: 'applicableTo.userCategories.scope must be "all" or "selected"' };
  let userCategories;
  if (ucIn.scope === 'all') userCategories = { scope: 'all', selected: [] };
  else {
    const sel = Array.isArray(ucIn.selected) ? ucIn.selected.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().toLowerCase()) : [];
    if (sel.length === 0) return { error: 'applicableTo.userCategories: choose at least one category, or use scope "all"' };
    userCategories = { scope: 'selected', selected: [...new Set(sel)] };
  }
  const formData = { userCategories: effectiveCategories(userCategories) };
  const out = { userCategories };
  for (const block of BLOCKS) {
    if (!evaluateCondition(block.condition, formData)) continue;
    const src = isObj(a[block.id]) ? a[block.id] : {};
    out[block.id] = {};
    for (const f of block.fields) {
      const n = normalizeScope(src[f.id], `applicableTo.${block.id}.${f.id}`);
      if (n.error) return { error: n.error };
      out[block.id][f.id] = n.value;
    }
  }
  return { applicableTo: out };
}

/* ------------------------------------------------------------------ options */
const OPTION_TYPES = ['dataInput', 'download', 'upload', 'apiDisplay', 'pay', 'axpertOption'];
const DISPLAY_AS = ['table', 'nameValuePair', 'text'];
const SUBTYPES = ['tstruct', 'smartView', 'iview', 'customPage'];

// Returns { config } (normalised) or { error }.
async function normalizeConfig(type, config) {
  const c = isObj(config) ? config : {};
  switch (type) {
    case 'dataInput': {
      const structName = isStr(c.structName) ? c.structName.trim() : '';
      if (!structName) return { error: 'dataInput needs config.structName (the name of the struct to fill in)' };
      return { config: { structName } };
    }
    case 'download': {
      if (!isStr(c.fileId) || !c.fileId) return { error: 'download needs config.fileId (upload a file first)' };
      if (!(await db.get('files', c.fileId))) return { error: `file "${c.fileId}" does not exist` };
      return { config: { fileId: c.fileId } };
    }
    case 'upload':
      return { config: {} };
    case 'apiDisplay':
      if (!DISPLAY_AS.includes(c.displayAs)) return { error: `apiDisplay needs config.displayAs: one of ${DISPLAY_AS.join(', ')}` };
      return { config: { apiName: isStr(c.apiName) ? c.apiName.trim() : '', displayAs: c.displayAs } };
    case 'pay':
      return { config: { paymentConfig: isStr(c.paymentConfig) ? c.paymentConfig : '' } };
    case 'axpertOption':
      if (!SUBTYPES.includes(c.subtype)) return { error: `axpertOption needs config.subtype: one of ${SUBTYPES.join(', ')}` };
      return { config: { subtype: c.subtype, target: isStr(c.target) ? c.target.trim() : '' } };
    default:
      return { error: 'unknown type' };
  }
}

// Shared validation for create and update. Returns { caption, type, config, applicableTo }; throws a 400 otherwise.
async function validateOption(body) {
  const { caption, type } = body;
  if (!isStr(caption) || !caption.trim()) fail(400, 'caption is required');
  if (!OPTION_TYPES.includes(type)) fail(400, `type must be one of ${OPTION_TYPES.join(', ')}`);
  const cfg = await normalizeConfig(type, body.config);
  if (cfg.error) fail(400, cfg.error);
  const app = normalizeApplicable(body.applicableTo);
  if (app.error) fail(400, app.error);
  return { caption: caption.trim(), type, config: cfg.config, applicableTo: app.applicableTo };
}

async function createOption(body, ctx) {
  const v = await validateOption(body);
  const id = uuid();
  const option = { id, ...v, createdBy: body.createdBy || ctx.user || 'anonymous', createdAt: nowIso() };
  await db.put('options', id, option);
  log.info('options.create', { optionId: id, type: option.type });
  return { status: 201, body: { optionId: id, option } };
}

async function listOptions() {
  const options = await db.all('options');
  options.sort(newestFirst('createdAt'));
  return { status: 200, body: { options } };
}

async function getOption(id) {
  const option = await db.get('options', id);
  if (!option) fail(404, 'Option not found');
  return { status: 200, body: { option } };
}

async function updateOption(id, body, ctx) {
  const existing = await db.get('options', id);
  if (!existing) fail(404, 'Option not found');
  const v = await validateOption(body);
  const option = { ...existing, ...v, modifiedBy: body.modifiedBy || ctx.user || 'anonymous', modifiedAt: nowIso() };
  await db.put('options', id, option);
  log.info('options.update', { optionId: id, type: option.type });
  return { status: 200, body: { optionId: id, option } };
}

// Removes the option (a file it referenced stays in the file list)
async function deleteOption(id) {
  if (!(await db.get('options', id))) fail(404, 'Option not found');
  await db.del('options', id);
  log.info('options.delete', { optionId: id });
  return { status: 200, body: { optionId: id, deleted: true } };
}

/* ------------------------------------------------------------------ files */
async function uploadFile(file, ctx) {
  if (!file || typeof file.size !== 'number' || typeof file.slice !== 'function') fail(400, 'No file received. Choose a file to upload.');
  if (file.size > maxUploadMb * 1024 * 1024) fail(413, `File is too large (max ${maxUploadMb} MB)`);
  const meta = {
    id: uuid(),
    originalName: file.name || 'file',
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    uploadedAt: nowIso(),
    uploadedBy: ctx.user || 'anonymous',
  };
  await db.put('blobs', meta.id, file);
  await db.put('files', meta.id, meta);
  log.info('files.upload', { fileId: meta.id, name: meta.originalName, size: meta.size });
  return { status: 201, body: { fileId: meta.id, file: meta } };
}

async function listFiles() {
  const files = await db.all('files');
  files.sort(newestFirst('uploadedAt'));
  return { status: 200, body: { files } };
}

// body: { file: <metadata>, blob: <Blob> }  (core/api.js saves it to the user's device)
async function downloadFile(fileId) {
  const meta = await db.get('files', fileId);
  const blob = meta ? await db.get('blobs', fileId) : null;
  if (!meta || !blob) fail(404, 'File not found');
  return { status: 200, body: { file: meta, blob } };
}

/* ------------------------------------------------------------------ router */
const ROUTES = [
  ['POST', /^\/api\/structs$/, (m, q, b, c) => createStruct(b, c)],
  ['GET', /^\/api\/structs$/, () => listStructs()],
  ['GET', /^\/api\/structs\/([^/]+)$/, (m) => getStruct(m[1])],
  ['PUT', /^\/api\/structs\/([^/]+)$/, (m, q, b, c) => updateStruct(m[1], b, c)],
  ['POST', /^\/api\/structs\/([^/]+)\/records$/, (m, q, b, c) => createRecord(m[1], b, c)],
  ['GET', /^\/api\/structs\/([^/]+)\/records$/, (m, q) => listRecords(m[1], q)],
  ['GET', /^\/api\/structs\/([^/]+)\/records\/([^/]+)$/, (m) => getRecord(m[1], m[2])],
  ['PUT', /^\/api\/structs\/([^/]+)\/records\/([^/]+)$/, (m, q, b, c) => updateRecord(m[1], m[2], b, c)],
  ['POST', /^\/api\/options$/, (m, q, b, c) => createOption(b, c)],
  ['GET', /^\/api\/options$/, () => listOptions()],
  ['GET', /^\/api\/options\/([^/]+)$/, (m) => getOption(m[1])],
  ['PUT', /^\/api\/options\/([^/]+)$/, (m, q, b, c) => updateOption(m[1], b, c)],
  ['DELETE', /^\/api\/options\/([^/]+)$/, (m) => deleteOption(m[1])],
  ['POST', /^\/api\/files$/, (m, q, b, c) => uploadFile(b && b.file, c)],
  ['GET', /^\/api\/files$/, () => listFiles()],
  ['GET', /^\/api\/files\/([^/]+)$/, (m) => downloadFile(m[1])],
];

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return s;
  }
};

/**
 * Runs one request against the local store. Never throws: failures come back as { status, body: { error, errors? } }.
 * `body` is a plain object (for uploads: { file: File }); ctx = { user } becomes createdBy / modifiedBy when the body has none.
 */
export async function handle(method, fullPath, body, ctx = {}) {
  const [path, qs = ''] = fullPath.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  const b = isObj(body) ? body : {};
  for (const [m, re, fn] of ROUTES) {
    if (m !== method) continue;
    const hit = re.exec(path);
    if (!hit) continue;
    hit.forEach((v, i) => {
      hit[i] = i ? safeDecode(v) : v;
    });
    try {
      return await fn(hit, query, b, ctx);
    } catch (e) {
      if (e instanceof ApiError) return { status: e.status, body: { error: e.message, ...(e.details ? { errors: e.details } : {}) } };
      log.error('unexpected error', { path, message: e && e.message });
      return { status: 500, body: { error: 'Something went wrong while saving your data in the browser.' } };
    }
  }
  return { status: 404, body: { error: 'Not found' } };
}
