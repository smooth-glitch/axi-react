const { evaluateCondition } = require('./validate');

// "Applicable to" of an Option: WHO the option is meant for. Config only - nothing enforces it at run time yet
// (there is no user identity in the app). It reuses the same conditional show/hide mechanism as struct sections:
// a scope BLOCK is only relevant when its condition (evaluated with evaluateCondition) is true.
//
// {
//   userCategories: { scope: 'all' | 'selected', selected: ['affiliate', 'employee', ...] },
//   affiliate: { affiliates: Scope },                                   // only when userCategories contains "affiliate"
//   employee:  { departments: Scope, branches: Scope, designations: Scope }   // only when it contains "employee"
// }
// Scope = { scope: 'all' | 'selected', selected: string[] }
//
// The blocks/conditions below MUST stay in sync with web/src/core/options.js.
const KNOWN_CATEGORIES = ['affiliate', 'employee'];

const BLOCKS = [
  { id: 'affiliate', condition: { field: 'userCategories', operator: 'contains', value: 'affiliate' }, fields: ['affiliates'] },
  { id: 'employee', condition: { field: 'userCategories', operator: 'contains', value: 'employee' }, fields: ['departments', 'branches', 'designations'] },
];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// scope = all -> every known category counts as selected (so both blocks are relevant)
const effectiveCategories = (uc) => (uc.scope === 'all' ? KNOWN_CATEGORIES : uc.selected);

function normalizeScope(input, label) {
  if (input === undefined || input === null) return { value: { scope: 'all', selected: [] } };
  if (!isObj(input) || !['all', 'selected'].includes(input.scope)) return { error: `${label}.scope must be "all" or "selected"` };
  if (input.scope === 'all') return { value: { scope: 'all', selected: [] } };
  const sel = Array.isArray(input.selected) ? input.selected.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [];
  if (sel.length === 0) return { error: `${label}: choose at least one value, or use scope "all"` };
  return { value: { scope: 'selected', selected: [...new Set(sel)] } };
}

// Returns { applicableTo } (normalised: defaults filled, irrelevant blocks dropped) or { error }.
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

  // Same mechanism as struct sections: a block is only kept when its condition is true for the chosen categories.
  const formData = { userCategories: effectiveCategories(userCategories) };
  const out = { userCategories };
  for (const block of BLOCKS) {
    if (!evaluateCondition(block.condition, formData)) continue;
    const src = isObj(a[block.id]) ? a[block.id] : {};
    out[block.id] = {};
    for (const f of block.fields) {
      const n = normalizeScope(src[f], `applicableTo.${block.id}.${f}`);
      if (n.error) return { error: n.error };
      out[block.id][f] = n.value;
    }
  }
  return { applicableTo: out };
}

module.exports = { normalizeApplicable, KNOWN_CATEGORIES, BLOCKS, effectiveCategories };
