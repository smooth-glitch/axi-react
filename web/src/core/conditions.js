import { createLogger } from './logger';

const log = createLogger('conditions');

const isNumeric = (v) => v !== '' && v !== null && v !== undefined && !Number.isNaN(Number(v));
const looseEquals = (a, b) => (isNumeric(a) && isNumeric(b) ? Number(a) === Number(b) : a === b);

/**
 * condition: { field, operator: equals|notEquals|gt|lt|contains, value }
 * Returns true when there is no condition. `label` is only used for logging.
 */
export function evaluateCondition(condition, formData, label) {
  if (!condition) return true;
  const { field, operator, value } = condition;
  const actual = formData ? formData[field] : undefined;
  let result;
  switch (operator) {
    case 'equals':
      result = looseEquals(actual, value);
      break;
    case 'notEquals':
      result = !looseEquals(actual, value);
      break;
    case 'gt':
      result = isNumeric(actual) && Number(actual) > Number(value);
      break;
    case 'lt':
      result = isNumeric(actual) && Number(actual) < Number(value);
      break;
    case 'contains':
      result = Array.isArray(actual) ? actual.includes(value) : typeof actual === 'string' && actual.includes(value);
      break;
    default:
      log.warn(`unknown operator "${operator}" - treating as true`, { label, condition });
      result = true;
  }
  log.debug(
    `${label || 'condition'}: ${field} ${operator} ${JSON.stringify(value)} (actual ${JSON.stringify(actual)}) => ${result}`
  );
  return result;
}

// Is a field visible given its own condition and its section's condition?
export function isFieldVisible(field, struct, formData) {
  if (field.sectionId) {
    const section = (struct.sections || []).find((s) => s.id === field.sectionId);
    if (section && !evaluateCondition(section.condition, formData, `section "${section.label}"`)) return false;
  }
  return evaluateCondition(field.condition, formData, `field "${field.label}"`);
}
