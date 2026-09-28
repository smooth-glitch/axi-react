import { parsePhoneNumberFromString } from 'libphonenumber-js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s$.?#][^\s]*$/i;

export const COUNTRIES = ['US', 'IN', 'GB', 'CA', 'AU', 'DE', 'FR', 'SG', 'AE'];

export const isEmpty = (v) => v === undefined || v === null || v === '';

// Returns an error message or null. formData may hold `<fieldId>__country` for mobile fields.
export function validateField(field, value, formData) {
  const label = field.label || field.id;
  if (isEmpty(value)) return field.required ? `${label} is required` : null;

  switch (field.type) {
    case 'wholeNumber':
    case 'number': {
      const n = Number(value);
      if (Number.isNaN(n)) return `${label} must be a number`;
      if (field.type === 'wholeNumber' && !Number.isInteger(n)) return `${label} must be a whole number`;
      if (!isEmpty(field.min) && n < Number(field.min)) return `${label} must be at least ${field.min}`;
      if (!isEmpty(field.max) && n > Number(field.max)) return `${label} must be at most ${field.max}`;
      return null;
    }
    case 'email':
      return EMAIL_RE.test(value) ? null : `${label} must be a valid email`;
    case 'url':
      return URL_RE.test(value) ? null : `${label} must be a valid URL (http:// or https://)`;
    case 'mobile': {
      const country = formData?.[`${field.id}__country`] || field.defaultCountry || 'US';
      const p = parsePhoneNumberFromString(String(value), country);
      return p && p.isValid() ? null : `${label} must be a valid phone number`;
    }
    case 'date':
    case 'time':
      if (field.min && value < field.min) return `${label} must be on or after ${field.min}`;
      if (field.max && value > field.max) return `${label} must be on or before ${field.max}`;
      return null;
    case 'location':
      return typeof value === 'object' && value.lat !== undefined ? null : `${label} must be a location`;
    default:
      return null;
  }
}
