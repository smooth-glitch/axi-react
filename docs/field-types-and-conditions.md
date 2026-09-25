# Field types, sections & conditions

The struct definition is plain JSON. This is its full schema.

## Struct

```jsonc
{
  "id": "…",                 // server-generated UUID
  "key": "leave-request",    // optional stable alias, unique; usable instead of the id
  "name": "Leave Request",   // required, shown in menus and headers
  "fields": [ /* Field */ ], // required, non-empty; order = display order
  "sections": [ /* Section */ ],
  "createdBy": "anonymous", "createdAt": "…",
  "modifiedBy": "anonymous", "modifiedAt": "…"   // after an edit
}
```

## Field

Common properties:

| Property | Type | Meaning |
|---|---|---|
| `id` | string | Unique within the struct. Key in `record.data`. Generated from the label in camelCase by the builder (`Employment type` → `employmentType`) and **never changed afterwards** |
| `label` | string | Text shown to users (safe to rename) |
| `type` | string | One of the types below |
| `required` | boolean | Optional. Must have a value when visible |
| `sectionId` | string | Optional. Id of the section that contains the field |
| `condition` | Condition | Optional. Field is hidden (and skipped in validation, and not saved) when false |

### Types

| Type | Extra properties | Input | Validation (client and server) |
|---|---|---|---|
| `text` | `multiline` (bool) | Single-line input, or a taller multi-line box | required only |
| `date` | `min`, `max` (`YYYY-MM-DD`) | Date input (`<input type="date">`) | valid date; within `min`/`max` |
| `time` | `min`, `max` (`HH:MM`) | Time input (`<input type="time">`) | `HH:MM` 24h; within range |
| `wholeNumber` | `min`, `max` | Numeric keypad input | integer; within range |
| `number` | `min`, `max` | Decimal input | numeric; within range |
| `email` | — | Email input | `name@domain.tld` pattern |
| `url` | — | URL input | must start with `http://` / `https://` |
| `mobile` | `countryPicker` (bool), `defaultCountry` (ISO-2, default `US`) | Phone input, optional country dropdown | valid for the country (libphonenumber-js). Saved in E.164 |
| `location` | — | "Capture" button using the browser Geolocation API | `{lat, lng}` numbers |
| `list` | `options: string[]` | Dropdown from the static options | value must be one of `options` (server) |
| `selection` | `apiUrl` | Dropdown whose options are fetched from `apiUrl` when the form opens | value must be a string |
| `fill` | `sourceField`, `sourceProp` | Read-only; auto-filled from the item chosen in the `selection` field `sourceField` (`item[sourceProp]`, or the item's label if `sourceProp` is empty) | not validated |

Notes:
* `min`/`max` for numbers are numbers; for date/time they are strings.
* `selection` and `fill` are a pair: `fill.sourceField` must be the `id` of a `selection` field. When a record is **edited**, the selected item is re-hydrated from the API once options load, and the stored fill value is shown meanwhile.
* Values you can rely on when reading records: see [api.md → Data conventions](api.md#data-conventions-for-recorddata).

## Section

```json
{ "id": "employerDetailsSec", "label": "Employer details",
  "condition": { "field": "employmentType", "operator": "equals", "value": "Full-time" } }
```
| Property | Meaning |
|---|---|
| `id` | Unique; referenced by `field.sectionId` |
| `label` | Card title in the form |
| `condition` | Optional. When false the whole section (all its fields) is hidden and skipped in validation |

In the form, unsectioned fields render first, then each section that has at least one visible field, as a collapsible group (collapsed state does not lose values).

## Condition

```json
{ "field": "days", "operator": "gt", "value": 10 }
```

| Property | Meaning |
|---|---|
| `field` | `id` of **another field** whose current value is tested |
| `operator` | `equals`, `notEquals`, `gt`, `lt`, `contains` |
| `value` | Comparison value (string or number) |

Semantics of `evaluateCondition(condition, formData)` (client: [`web/src/core/conditions.js`](../web/src/core/conditions.js), server: [`server/src/lib/validate.js`](../server/src/lib/validate.js)):

| Operator | True when |
|---|---|
| `equals` | values are equal — **numbers compare numerically** (`"7"` equals `7`), otherwise strict equality |
| `notEquals` | not `equals` (so it is true while the source field is still empty) |
| `gt` / `lt` | source value is numeric and `>` / `<` the condition value (false for empty/non-numeric) |
| `contains` | source is a string containing `value`, or an array including it |
| *(no condition)* | always true |
| *(unknown operator)* | treated as true (a warning is logged on the client) |

Visibility of a field = **section condition AND field condition**. Conditions are re-evaluated on every value change; each evaluation is logged in the browser console under the `conditions` scope, e.g.
`field "Contract end": days gt 10 (actual "12") => true`.

A condition sees the *effective* values of the form, including auto-filled `fill` values. Fields that are hidden do not keep contributing: hidden fields are excluded from the submitted data.

### How the builder writes conditions

The builder edits conditions in plain language ("Show only when *Days* *is greater than* *10*"). While editing, a draft condition references the other field by its draft key; on save it is converted to `{ field: <fieldId>, operator, value }`. The value is stored as a **number** when the source field is numeric or the operator is `gt`/`lt`, otherwise as a string. For `list` source fields the value is picked from that field's options.

Hand-written JSON also works (via the API) — there is just no free-form JSON editor in the UI.

## Example — the Leave Request definition

```json
{
  "name": "Leave Request",
  "fields": [
    { "id": "empType", "label": "Employment type", "type": "list", "options": ["Full-time", "Contract"], "required": true },
    { "id": "companyName", "label": "Company name", "type": "text", "sectionId": "sec1" },
    { "id": "days", "label": "Days", "type": "wholeNumber", "min": 1, "max": 30, "required": true },
    { "id": "startDate", "label": "Start date", "type": "date", "required": true }
  ],
  "sections": [
    { "id": "sec1", "label": "Employer details",
      "condition": { "field": "empType", "operator": "equals", "value": "Full-time" } }
  ]
}
```
`Company name` (and its whole section) only appears when *Employment type* is *Full-time*.
