// Converts builder drafts (form-friendly strings) to the struct definition sent to the API.
// Draft conditions reference fields by draft key: { fieldKey, operator, value }; they become { field: <fieldId>, operator, value } on save.

let counter = 0;
export const newKey = () => `k${Date.now().toString(36)}${counter++}`;

export const newField = (type = 'text', preset = {}) => ({ key: newKey(), label: '', type, required: false, ...preset });
export const newSection = () => ({ key: newKey(), label: '' });

const slug = (label) => {
  const words = label.trim().replace(/[^a-zA-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return 'field';
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
};

const uniqueId = (base, used) => {
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}${n++}`;
  used.add(id);
  return id;
};

const isNumeric = (v) => v !== '' && v !== null && v !== undefined && !Number.isNaN(Number(v));
const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
const NUMERIC_TYPES = ['wholeNumber', 'number'];

function resolveCondition(c, fieldDrafts, idByKey, what) {
  if (!c) return { value: undefined };
  const src = fieldDrafts.find((f) => f.key === c.fieldKey);
  if (!src || !idByKey[src.key]) return { error: `${what}: choose which field its condition depends on.` };
  if (c.value === undefined || c.value === '') return { error: `${what}: enter a value for its condition.` };
  const numeric = NUMERIC_TYPES.includes(src.type) || c.operator === 'gt' || c.operator === 'lt';
  const value = numeric && isNumeric(c.value) ? Number(c.value) : c.value;
  return { value: { field: idByKey[src.key], operator: c.operator || 'equals', value } };
}

export const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export function buildStructPayload(name, fieldDrafts, sectionDrafts, structKey = "") {
  if (!name.trim()) return { error: 'Give the struct a name.' };
  const key = (structKey || '').trim();
  if (key && !KEY_PATTERN.test(key)) return { error: 'The key must start with a letter and use only letters, digits, _ or - (max 64 characters).' };
  if (!fieldDrafts.length) return { error: 'Add at least one field.' };

  // Fields that already exist (editing) keep their id so saved records stay valid; new fields get an id from their name.
  const usedF = new Set(fieldDrafts.filter((fd) => fd.id).map((fd) => fd.id));
  const idByKey = {};
  for (const fd of fieldDrafts) {
    if (!fd.label.trim()) return { error: 'Every field needs a name.' };
    idByKey[fd.key] = fd.id || uniqueId(slug(fd.label), usedF);
  }

  const usedSec = new Set(sectionDrafts.filter((sd) => sd.id).map((sd) => sd.id));
  const sectionIdByKey = {};
  const sections = [];
  for (const sd of sectionDrafts) {
    if (!sd.label.trim()) return { error: 'Every section needs a name (or remove it).' };
    const id = sd.id || uniqueId(slug(sd.label) + 'Sec', usedSec);
    sectionIdByKey[sd.key] = id;
    const c = resolveCondition(sd.condition, fieldDrafts, idByKey, `Section "${sd.label}"`);
    if (c.error) return { error: c.error };
    sections.push({ id, label: sd.label.trim(), ...(c.value ? { condition: c.value } : {}) });
  }

  const fields = [];
  for (const fd of fieldDrafts) {
    const label = fd.label.trim();
    const f = { id: idByKey[fd.key], label, type: fd.type };
    if (fd.required && fd.type !== 'fill') f.required = true;
    const c = resolveCondition(fd.condition, fieldDrafts, idByKey, `Field "${label}"`);
    if (c.error) return { error: c.error };
    if (c.value) f.condition = c.value;
    if (fd.sectionKey && sectionIdByKey[fd.sectionKey]) f.sectionId = sectionIdByKey[fd.sectionKey];

    switch (fd.type) {
      case 'text':
        if (fd.multiline) f.multiline = true;
        break;
      case 'wholeNumber':
      case 'number':
        if (num(fd.min) !== undefined) f.min = num(fd.min);
        if (num(fd.max) !== undefined) f.max = num(fd.max);
        break;
      case 'date':
      case 'time':
        if (fd.min) f.min = fd.min;
        if (fd.max) f.max = fd.max;
        break;
      case 'mobile':
        if (fd.countryPicker) f.countryPicker = true;
        if (fd.defaultCountry) f.defaultCountry = fd.defaultCountry;
        break;
      case 'list': {
        const options = (fd.options || '').split(',').map((o) => o.trim()).filter(Boolean);
        if (!options.length) return { error: `Field "${label}": add at least one option (comma separated).` };
        f.options = options;
        break;
      }
      case 'selection':
        if (!fd.apiUrl || !/^https?:\/\//i.test(fd.apiUrl)) return { error: `Field "${label}": enter a valid API URL (http:// or https://).` };
        f.apiUrl = fd.apiUrl.trim();
        break;
      case 'fill': {
        const src = fieldDrafts.find((x) => x.key === fd.sourceKey && x.type === 'selection');
        if (!src) return { error: `Field "${label}": pick the selection field it fills from.` };
        f.sourceField = idByKey[src.key];
        if (fd.sourceProp) f.sourceProp = fd.sourceProp.trim();
        break;
      }
      default:
        break;
    }
    fields.push(f);
  }
  return { payload: { name: name.trim(), key: key || null, fields, sections } };
}

// Draft options as an array (for previews and condition value pickers).
export const optionList = (d) => (d.options || '').split(',').map((o) => o.trim()).filter(Boolean);

// Inverse of buildStructPayload: turn a saved struct definition into editable builder drafts.
// Drafts of existing items reuse the stored id as their key (and remember it in `id`).
export function structToDrafts(struct) {
  const cond = (c) => (c ? { fieldKey: c.field, operator: c.operator, value: c.value === undefined ? '' : String(c.value) } : undefined);
  const sections = (struct.sections || []).map((s) => ({ key: s.id, id: s.id, label: s.label, condition: cond(s.condition) }));
  const fields = struct.fields.map((f) => ({
    key: f.id,
    id: f.id,
    label: f.label,
    type: f.type,
    required: !!f.required,
    multiline: !!f.multiline,
    min: f.min === undefined ? '' : String(f.min),
    max: f.max === undefined ? '' : String(f.max),
    options: Array.isArray(f.options) ? f.options.join(', ') : '',
    apiUrl: f.apiUrl || '',
    sourceKey: f.sourceField,
    sourceProp: f.sourceProp || '',
    countryPicker: !!f.countryPicker,
    defaultCountry: f.defaultCountry,
    sectionKey: f.sectionId,
    condition: cond(f.condition),
  }));
  return { name: struct.name, key: struct.key || '', fields, sections };
}
