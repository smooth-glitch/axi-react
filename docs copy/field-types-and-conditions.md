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

| Type | Extra properties | Input | Validation (form and data layer) |
|---|---|---|---|
| `text` | `multiline` (bool) | Single-line input, or a taller multi-line box | required only |
| `date` | `min`, `max` (`YYYY-MM-DD`) | Date input (`<input type="date">`) | valid date; within `min`/`max` |
| `time` | `min`, `max` (`HH:MM`) | Time input (`<input type="time">`) | `HH:MM` 24h; within range |
| `wholeNumber` | `min`, `max` | Numeric keypad input | integer; within range |
| `number` | `min`, `max` | Decimal input | numeric; within range |
| `email` | — | Email input | `name@domain.tld` pattern |
| `url` | — | URL input | must start with `http://` / `https://` |
| `mobile` | `countryPicker` (bool), `defaultCountry` (ISO-2, default `US`) | Phone input, optional country dropdown | valid for the country (libphonenumber-js). Saved in E.164 |
| `location` | — | **Capture** (browser GPS) and **Pick on map** (map pin picker, see below) | `{lat, lng}` numbers, plus an optional `address` string when picked on the map |
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

Semantics of `evaluateCondition(condition, formData)` (client: [`web/src/core/conditions.js`](../web/src/core/conditions.js), record validation: [`web/src/core/localApi.js`](../web/src/core/localApi.js)):

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

## Location picker (map)

The `location` field has two ways to set a value:

* **Capture** — one tap, uses the device GPS (`navigator.geolocation`); stores `{ lat, lng }`.
* **Pick on map** — a Blinkit-style dialog (`web/src/ui/MapPicker.jsx`): the pin stays in the middle and the user drags the map under it; a search box finds an address / landmark; **Use my current location** flies the map to the GPS position; the address of the pin is shown as it moves. **Confirm location** stores `{ lat, lng, address? }` (6 decimals; `address` only when it could be looked up). Reopening the picker starts at the stored spot; Esc / X / Cancel leave the value unchanged.

How it works and what it needs:

* Map: [Leaflet](https://leafletjs.com) with OpenStreetMap tiles — no API key or account. Leaflet is downloaded only when the picker is first opened, and its stylesheet is injected by the component, so hosts import nothing extra.
* Address lookup and search: OpenStreetMap's public **Nominatim** service. It is best effort: if it (or the tiles) cannot be reached the pin and coordinates still work, only the address line is missing / a hint says the map images did not load.
* **Network and privacy:** opening the picker makes requests from the user's browser to `tile.openstreetmap.org`, and moving the pin / searching sends the coordinates / search text to `nominatim.openstreetmap.org`. These are public, free services with usage policies (light interactive use is fine; for heavy production traffic host your own tile / geocoding service or switch `TILES` / `NOMINATIM` in `MapPicker.jsx` to a provider you have a contract with). If your site has a Content-Security-Policy, allow those two origins (`img-src` and `connect-src`).
* The GPS button needs `https` or `localhost` and the user's permission.
