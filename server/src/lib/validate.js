const { parsePhoneNumberFromString } = require('libphonenumber-js');
const logger = require('./logger');

// Mirrors the condition evaluator used on the frontend (app/lib/conditions.js).
// Kept independent (no shared package) since this is a small monorepo — see PROGRESS.md.
const isNumeric = (v) => v !== '' && v !== null && v !== undefined && !Number.isNaN(Number(v));
const looseEquals = (a, b) => (isNumeric(a) && isNumeric(b) ? Number(a) === Number(b) : a === b);

function evaluateCondition(condition, formData) {
  if (!condition) return true;
  const { field, operator, value } = condition;
  const actual = formData ? formData[field] : undefined;
  switch (operator) {
    case 'equals':
      return looseEquals(actual, value);
    case 'notEquals':
      return !looseEquals(actual, value);
    case 'gt':
      return Number(actual) > Number(value);
    case 'lt':
      return Number(actual) < Number(value);
    case 'contains':
      if (Array.isArray(actual)) return actual.includes(value);
      return typeof actual === 'string' && actual.includes(value);
    default:
      return true;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const URL_RE = /^(https?:\/\/)[^\s$.?#].[^\s]*$/i;

// Server-side validation of a submitted record against its struct definition.
// Returns { valid, errors: [{ fieldId, message }] }
function validateRecord(struct, data) {
  const errors = [];
  const fields = struct.fields || [];

  for (const field of fields) {
    // Skip validation for fields hidden by their own condition or their section's condition
    if (field.condition && !evaluateCondition(field.condition, data)) continue;
    if (field.sectionId) {
      const section = (struct.sections || []).find((s) => s.id === field.sectionId);
      if (section && section.condition && !evaluateCondition(section.condition, data)) continue;
    }

    const val = data ? data[field.id] : undefined;
    const isEmpty = val === undefined || val === null || val === '';

    if (field.required && isEmpty) {
      errors.push({ fieldId: field.id, message: `${field.label || field.id} is required` });
      continue;
    }
    if (isEmpty) continue;

    switch (field.type) {
      case 'wholeNumber': {
        const n = Number(val);
        if (!Number.isInteger(n)) errors.push({ fieldId: field.id, message: `${field.label} must be a whole number` });
        else if (field.min !== undefined && n < field.min) errors.push({ fieldId: field.id, message: `${field.label} must be >= ${field.min}` });
        else if (field.max !== undefined && n > field.max) errors.push({ fieldId: field.id, message: `${field.label} must be <= ${field.max}` });
        break;
      }
      case 'number': {
        const n = Number(val);
        if (Number.isNaN(n)) errors.push({ fieldId: field.id, message: `${field.label} must be a number` });
        else if (field.min !== undefined && n < field.min) errors.push({ fieldId: field.id, message: `${field.label} must be >= ${field.min}` });
        else if (field.max !== undefined && n > field.max) errors.push({ fieldId: field.id, message: `${field.label} must be <= ${field.max}` });
        break;
      }
      case 'email':
        if (!EMAIL_RE.test(val)) errors.push({ fieldId: field.id, message: `${field.label} must be a valid email` });
        break;
      case 'url':
        if (!URL_RE.test(val)) errors.push({ fieldId: field.id, message: `${field.label} must be a valid URL` });
        break;
      case 'date':
        if (typeof val !== 'string' || !DATE_RE.test(val) || Number.isNaN(Date.parse(val))) errors.push({ fieldId: field.id, message: `${field.label} must be a valid date (YYYY-MM-DD)` });
        else if (field.min && val < field.min) errors.push({ fieldId: field.id, message: `${field.label} must be on/after ${field.min}` });
        else if (field.max && val > field.max) errors.push({ fieldId: field.id, message: `${field.label} must be on/before ${field.max}` });
        break;
      case 'time':
        if (typeof val !== 'string' || !TIME_RE.test(val)) errors.push({ fieldId: field.id, message: `${field.label} must be a valid time (HH:MM)` });
        else if (field.min && val < field.min) errors.push({ fieldId: field.id, message: `${field.label} must be at/after ${field.min}` });
        else if (field.max && val > field.max) errors.push({ fieldId: field.id, message: `${field.label} must be at/before ${field.max}` });
        break;
      case 'mobile': {
        const p = parsePhoneNumberFromString(String(val), field.defaultCountry || 'US');
        if (!p || !p.isValid()) errors.push({ fieldId: field.id, message: `${field.label} must be a valid phone number` });
        break;
      }
      case 'location':
        if (typeof val !== 'object' || typeof val.lat !== 'number' || typeof val.lng !== 'number' || Math.abs(val.lat) > 90 || Math.abs(val.lng) > 180)
          errors.push({ fieldId: field.id, message: `${field.label} must be a valid location {lat, lng}` });
        break;
      case 'list':
        if (Array.isArray(field.options) && !field.options.includes(val)) errors.push({ fieldId: field.id, message: `${field.label} must be one of: ${field.options.join(', ')}` });
        break;
      case 'selection':
        // options come from field.apiUrl at runtime on the client, so only the type is checked here.
        if (typeof val !== 'string') errors.push({ fieldId: field.id, message: `${field.label} must be a string` });
        break;
      default:
        break;
    }
  }

  logger.debug({ event: 'validate.record', structId: struct.id, errorCount: errors.length }, 'Validated record');
  return { valid: errors.length === 0, errors };
}

module.exports = { evaluateCondition, validateRecord };
