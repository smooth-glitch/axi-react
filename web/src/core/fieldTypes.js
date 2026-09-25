// Field-type catalogue used by the type picker, builder rows and form inputs.
// `preset` lets one picker entry map onto a type plus defaults (e.g. "Large Text" = text + multiline).
// `tone` is a theme colour key; `icon` is a lucide icon name resolved in ui/icons.js (keeps this file UI-free).
export const CATEGORIES = ['Basic fields', 'Components', 'Special fields'];

export const FIELD_CATALOG = [
  { category: 'Basic fields', type: 'text', label: 'Short Text', icon: 'Type', tone: 'success', hint: 'One line of free text' },
  { category: 'Basic fields', type: 'text', preset: { multiline: true }, label: 'Large Text', icon: 'TextAlignStart', tone: 'success', hint: 'Multi-line notes' },
  { category: 'Basic fields', type: 'wholeNumber', label: 'Whole Number', icon: 'Hash', tone: 'primary', hint: 'Integers, optional min / max' },
  { category: 'Basic fields', type: 'number', label: 'Decimal Number', icon: 'Calculator', tone: 'primary', hint: 'Numbers with decimals' },
  { category: 'Basic fields', type: 'date', label: 'Date', icon: 'CalendarDays', tone: 'warning', hint: 'Date picker with range' },
  { category: 'Basic fields', type: 'time', label: 'Time', icon: 'Clock3', tone: 'warning', hint: 'Time picker' },
  { category: 'Components', type: 'list', label: 'Drop Down', icon: 'ListFilter', tone: 'success', hint: 'Pick one from your own options' },
  { category: 'Components', type: 'selection', label: 'Select from API', icon: 'CloudDownload', tone: 'primary', hint: 'Options fetched from a URL' },
  { category: 'Components', type: 'fill', label: 'Auto Fill', icon: 'WandSparkles', tone: 'warning', hint: 'Read-only, filled from a selection' },
  { category: 'Special fields', type: 'mobile', label: 'Mobile Number', icon: 'Smartphone', tone: 'success', hint: 'Validated phone number' },
  { category: 'Special fields', type: 'email', label: 'Email', icon: 'Mail', tone: 'primary', hint: 'Email address' },
  { category: 'Special fields', type: 'url', label: 'URL', icon: 'Link2', tone: 'primary', hint: 'Web address' },
  { category: 'Special fields', type: 'location', label: 'Location', icon: 'MapPin', tone: 'danger', hint: 'Capture GPS coordinates' },
];

// Lookup for a draft/field (multiline text gets the Large Text look).
export function metaFor(fieldOrType) {
  const type = typeof fieldOrType === 'string' ? fieldOrType : fieldOrType.type;
  const multiline = typeof fieldOrType === 'object' && fieldOrType.multiline;
  return (
    FIELD_CATALOG.find((c) => c.type === type && !!c.preset?.multiline === !!multiline) ||
    FIELD_CATALOG.find((c) => c.type === type) ||
    FIELD_CATALOG[0]
  );
}
