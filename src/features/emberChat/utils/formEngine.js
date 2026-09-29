// Client-side mirror of the lite-tstruct rules in sd_config.erl (docs/LITE_TSTRUCT.md §5).
// The server has the final say; this only decides what to show and what to send.

const isEmpty = (v) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

const toNum = (v) => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
};

// Numbers compare numerically when both sides are numbers, otherwise as text (same as the server).
function cmp(a, b) {
  const x = toNum(a);
  const y = toNum(b);
  if (x !== null && y !== null) return x < y ? -1 : x > y ? 1 : 0;
  const sa = String(a ?? "");
  const sb = String(b ?? "");
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

export function evalCondition(cond, values) {
  if (!cond) return true;
  if (Array.isArray(cond.all)) return cond.all.every((c) => evalCondition(c, values));
  if (Array.isArray(cond.any)) return cond.any.some((c) => evalCondition(c, values));
  const v = values[cond.field];
  switch (cond.op) {
    case "eq":
      return Array.isArray(v) ? v.includes(cond.value) : cmp(v, cond.value) === 0 && !isEmpty(v);
    case "ne":
      return Array.isArray(v) ? !v.includes(cond.value) : cmp(v, cond.value) !== 0;
    case "gt":
      return !isEmpty(v) && cmp(v, cond.value) > 0;
    case "lt":
      return !isEmpty(v) && cmp(v, cond.value) < 0;
    case "gte":
      return !isEmpty(v) && cmp(v, cond.value) >= 0;
    case "lte":
      return !isEmpty(v) && cmp(v, cond.value) <= 0;
    case "in":
      return Array.isArray(cond.value) && (Array.isArray(v) ? v.some((x) => cond.value.includes(x)) : cond.value.includes(v));
    case "notempty":
      return !isEmpty(v);
    default:
      return true;
  }
}

// A field is shown when its own condition AND its section's condition hold.
export function isFieldVisible(field, sections, values) {
  if (!evalCondition(field.condition, values)) return false;
  if (field.section) {
    const sec = (sections || []).find((s) => s.name === field.section);
    if (sec && !evalCondition(sec.condition, values)) return false;
  }
  return true;
}

// What to send: only visible fields, no empty values, numbers as numbers.
export function buildSubmission(tstruct, values) {
  const out = {};
  for (const f of tstruct.fields || []) {
    if (!isFieldVisible(f, tstruct.sections, values)) continue;
    const v = values[f.name];
    if (isEmpty(v)) continue;
    if (f.type === "wholenumber") out[f.name] = Number.parseInt(v, 10);
    else if (f.type === "number") out[f.name] = Number(v);
    else out[f.name] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

// Client-side required check so the obvious mistakes never need a round trip.
export function requiredErrors(tstruct, values) {
  const errors = {};
  for (const f of tstruct.fields || []) {
    if (f.required && isFieldVisible(f, tstruct.sections, values) && isEmpty(values[f.name])) {
      errors[f.name] = "This field is required.";
    }
  }
  return errors;
}

// Groups visible fields by section, keeping the definition's order.
export function groupBySection(tstruct, values) {
  const groups = [];
  const seen = new Map();
  for (const f of tstruct.fields || []) {
    if (!isFieldVisible(f, tstruct.sections, values)) continue;
    const key = f.section || "";
    if (!seen.has(key)) {
      const sec = (tstruct.sections || []).find((s) => s.name === key);
      const g = { name: key, caption: sec ? sec.caption : "", fields: [] };
      seen.set(key, g);
      groups.push(g);
    }
    seen.get(key).fields.push(f);
  }
  return groups;
}

export function displayValue(v) {
  if (Array.isArray(v)) return v.join(", ");
  if (v && typeof v === "object" && "lat" in v) return `${v.lat}, ${v.lng}`;
  return String(v ?? "");
}
