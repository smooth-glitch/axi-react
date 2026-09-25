// Options: standalone, configurable actions (unrelated to any struct). See docs/options.md.
import { evaluateCondition } from './conditions';

// type catalogue (order = order in the dropdown). `functional` types really do something when run.
export const OPTION_TYPES = [
  { value: 'dataInput', label: 'Data input', hint: 'Opens the form of a struct so the user can fill it in', functional: true, icon: 'ClipboardList' },
  { value: 'download', label: 'Download', hint: 'Downloads a file you upload here', functional: true, icon: 'Download' },
  { value: 'upload', label: 'Upload', hint: 'Lets the user pick a file and upload it', functional: true, icon: 'Upload' },
  { value: 'apiDisplay', label: 'API display', hint: 'Shows data from an API (not available yet)', functional: false, icon: 'Globe' },
  { value: 'pay', label: 'Pay', hint: 'Payment (not available yet)', functional: false, icon: 'CreditCard' },
  { value: 'axpertOption', label: 'Axpert option', hint: 'Links to an Axpert tstruct, smart view, iview or page (not available yet)', functional: false, icon: 'Boxes' },
];
export const optionType = (value) => OPTION_TYPES.find((t) => t.value === value) || OPTION_TYPES[0];

export const DISPLAY_AS = [
  { value: 'table', label: 'Table' },
  { value: 'nameValuePair', label: 'Name / value pairs' },
  { value: 'text', label: 'Plain text' },
];
export const AXPERT_SUBTYPES = [
  { value: 'tstruct', label: 'Tstruct' },
  { value: 'smartView', label: 'Smart view' },
  { value: 'iview', label: 'Iview' },
  { value: 'customPage', label: 'Custom page' },
];

/* ------------------------------------------------------------------ "Applicable to"
 * WHO an option is for. Config only: nothing enforces it at run time (the app has no user identity yet).
 * It reuses the struct-section mechanism: a scope BLOCK is only relevant when its condition is true, evaluated
 * with evaluateCondition() against { userCategories: [...] } - `contains` checks membership in that multi-select.
 *
 *   {
 *     userCategories: { scope: 'all' | 'selected', selected: ['affiliate', 'employee', ...] },
 *     affiliate: { affiliates: Scope },                                        // shown when userCategories contains "affiliate"
 *     employee:  { departments: Scope, branches: Scope, designations: Scope }  // shown when it contains "employee"
 *   }
 *   Scope = { scope: 'all' | 'selected', selected: string[] }
 *
 * Keep BLOCKS / KNOWN_CATEGORIES in sync with server/src/lib/applicableTo.js.
 */
export const KNOWN_CATEGORIES = ['affiliate', 'employee'];

export const BLOCKS = [
  {
    id: 'affiliate',
    label: 'Affiliate scope',
    condition: { field: 'userCategories', operator: 'contains', value: 'affiliate' },
    fields: [{ id: 'affiliates', label: 'Affiliates', placeholder: 'Add an affiliate and press Enter' }],
  },
  {
    id: 'employee',
    label: 'Employee scope',
    condition: { field: 'userCategories', operator: 'contains', value: 'employee' },
    fields: [
      { id: 'departments', label: 'Departments', placeholder: 'Add a department and press Enter' },
      { id: 'branches', label: 'Branches', placeholder: 'Add a branch and press Enter' },
      { id: 'designations', label: 'Designations', placeholder: 'Add a designation and press Enter' },
    ],
  },
];

const allScope = () => ({ scope: 'all', selected: [] });

export const defaultApplicableTo = () => ({
  userCategories: { scope: 'all', selected: [] },
  affiliate: { affiliates: allScope() },
  employee: { departments: allScope(), branches: allScope(), designations: allScope() },
});

// scope = all -> every known category counts as selected (so both blocks are relevant)
export const effectiveCategories = (uc) => (uc.scope === 'all' ? KNOWN_CATEGORIES : uc.selected.map((c) => c.toLowerCase()));

// Which blocks apply for the chosen categories - same evaluateCondition as struct sections.
export const visibleBlocks = (applicableTo) => {
  const formData = { userCategories: effectiveCategories(applicableTo.userCategories) };
  return BLOCKS.filter((b) => evaluateCondition(b.condition, formData, `block "${b.label}"`));
};

// Validation for the builder (mirrors the server). Returns a message or null.
export function applicableToError(applicableTo) {
  if (applicableTo.userCategories.scope === 'selected' && applicableTo.userCategories.selected.length === 0) return 'User categories: choose at least one category, or use "All".';
  for (const b of visibleBlocks(applicableTo)) {
    for (const f of b.fields) {
      const s = applicableTo[b.id]?.[f.id];
      if (s?.scope === 'selected' && s.selected.length === 0) return `${b.label} → ${f.label}: add at least one value, or use "All".`;
    }
  }
  return null;
}

// Payload to send: hidden blocks are dropped (like hidden fields are not saved in records).
export function applicableToPayload(applicableTo) {
  const out = { userCategories: applicableTo.userCategories };
  for (const b of visibleBlocks(applicableTo)) out[b.id] = applicableTo[b.id];
  return out;
}

// API response -> editable state (fills in defaults for blocks that were not stored).
export function applicableToDraft(stored) {
  const d = defaultApplicableTo();
  if (!stored) return d;
  return {
    userCategories: stored.userCategories || d.userCategories,
    affiliate: { ...d.affiliate, ...(stored.affiliate || {}) },
    employee: { ...d.employee, ...(stored.employee || {}) },
  };
}

// One-line summary for lists, e.g. "Everyone", "Employee · departments: HR, Finance".
export function applicableSummary(a) {
  if (!a || !a.userCategories) return 'Everyone';
  const uc = a.userCategories;
  if (uc.scope === 'all') return 'All user categories';
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  return uc.selected.map(cap).join(', ');
}
