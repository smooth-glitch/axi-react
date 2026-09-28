import { useEffect, useMemo, useRef, useState } from "react";
import { sandeshSocket } from "../../../../services/sandeshSocket.js";

// Renders and submits a Sandesh "Lite TStruct" form: fetched live from the backend (tstruct.get) and validated by
// it (tstruct.submit) — see docs/SANDESH_API.md §5 and axi-chat-backend/docs/LITE_TSTRUCT.md. `prompt` is one entry
// from Composer's live `options.list` (`{ id, label, target }`); `target` is the TStruct's name.
//
// The server is the final authority on every rule (required, format, ranges, conditions) — this component only
// does light client-side checks for instant feedback and always defers to the `invalid_values` reply for the
// definitive per-field messages.

// ---------------------------------------------------------------------------------------------------------------
// Condition evaluation — a line-for-line port of the backend's `eval/2` / `cmp/2` (sd_config.erl), so a field or
// section shows/hides in exactly the same cases the server would drop or require it in.
function isEmptyValue(v) {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

function toNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v.trim()))) return Number(v.trim());
  return null;
}

// Numbers compare numerically, everything else as text (matches the backend's `cmp/2`).
function compare(a, b) {
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) return na < nb ? "lt" : na > nb ? "gt" : "eq";
  const sa = a === null || a === undefined ? "" : String(a);
  const sb = b === null || b === undefined ? "" : String(b);
  return sa < sb ? "lt" : sa > sb ? "gt" : "eq";
}

function evalCondition(condition, values) {
  if (!condition) return true;
  if (Array.isArray(condition.all)) return condition.all.every((c) => evalCondition(c, values));
  if (Array.isArray(condition.any)) return condition.any.some((c) => evalCondition(c, values));
  const { field, op, value } = condition;
  if (!field || !op) return true;
  const actual = values[field] ?? null;
  switch (op) {
    case "notempty":
      return !isEmptyValue(actual);
    case "eq":
      return compare(actual, value) === "eq";
    case "ne":
      return compare(actual, value) !== "eq";
    case "gt":
      return compare(actual, value) === "gt";
    case "lt":
      return compare(actual, value) === "lt";
    case "gte":
      return ["gt", "eq"].includes(compare(actual, value));
    case "lte":
      return ["lt", "eq"].includes(compare(actual, value));
    case "in":
      return Array.isArray(value) && value.some((w) => compare(actual, w) === "eq");
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// `selection` fields point at an external API (`field.api`) that returns the list of choices. There is no server
// proxy for this yet (docs/SANDESH_API.md §9 lists it under "not built"), so it is fetched directly from the
// browser, same approach as the standalone Lite Tstruct Builder project. Tolerant of failure: the field still
// works as a free-text box (the backend only checks it's a string ≤ 500 chars either way).
async function fetchSelectionItems(apiUrl) {
  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const arr = Array.isArray(json) ? json : json.items || json.data || json.results || [];
  return arr.map((it) =>
    typeof it === "object" && it !== null
      ? { value: String(it.id ?? it.value ?? it.name ?? it.label ?? it.title), label: String(it.label ?? it.name ?? it.title ?? it.id ?? it.value), raw: it }
      : { value: String(it), label: String(it), raw: it }
  );
}

// ---------------------------------------------------------------------------------------------------------------
function defaultValue(field) {
  if (field.type === "list" && field.multi) return [];
  if (field.type === "location") return { lat: "", lng: "" };
  return "";
}

function defaultValues(tstruct) {
  const v = {};
  for (const f of tstruct.fields) v[f.name] = defaultValue(f);
  return v;
}

// One light client-side check per visible+required field, plus a shape check for the ones with a fixed format.
// Anything this misses (or gets slightly wrong) is still caught by the server; this only exists so the person
// isn't surprised by a round-trip for an obviously empty required field.
function localFieldError(field, value) {
  if (field.required && isEmptyValue(value)) return "This field is required.";
  if (isEmptyValue(value)) return null;
  if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Enter a valid email address.";
  if (field.type === "url" && !/^https?:\/\/\S+$/.test(value)) return "Enter a valid http(s) URL.";
  if (field.type === "location" && (value.lat === "" || value.lng === "")) return "Enter both latitude and longitude.";
  return null;
}

function isFieldVisible(field, sectionVisible, values) {
  if (field.section && sectionVisible[field.section] === false) return false;
  return evalCondition(field.condition, values);
}

// Builds the in-chat message card shown after a successful submit — same "card" shape the rest of the chat UI
// (and the old hardcoded version of this modal) already renders.
function buildCard(tstruct, submission) {
  const byName = new Map((tstruct.fields || []).map((f) => [f.name, f]));
  const details = {};
  for (const [name, value] of Object.entries(submission.values || {})) {
    const field = byName.get(name);
    const label = field?.caption || name;
    details[label] = formatSubmittedValue(field, value);
  }
  return {
    kind: "card",
    title: `${tstruct.caption || tstruct.name} Submitted`,
    actionStatus: "Pending Host Approval",
    details,
  };
}

function formatSubmittedValue(field, value) {
  if (field?.type === "location" && value && typeof value === "object") return `${value.lat}, ${value.lng}`;
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export default function SmartStructureModal({ prompt, onClose, onSubmit }) {
  const [state, setState] = useState({ status: "loading" }); // loading | ready | error
  const [tstruct, setTstruct] = useState(null);
  const [values, setValues] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectionItems, setSelectionItems] = useState({}); // fieldName -> 'loading' | 'error' | [{value,label}]
  const submitEpoch = useRef(0);

  const load = () => {
    setState({ status: "loading" });
    sandeshSocket
      .sd("tstruct.get", { name: prompt.target })
      .then(({ tstruct: def }) => {
        setTstruct(def);
        setValues(defaultValues(def));
        setFieldErrors({});
        setFormError(null);
        setState({ status: "ready" });
      })
      .catch((err) => {
        const message =
          err?.code === "forbidden"
            ? "You don't have access to this form."
            : err?.code === "not_found"
            ? "This form is no longer available."
            : err?.message || "Could not load this form.";
        setState({ status: "error", message });
      });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [prompt?.target]);

  // Fetch each `selection` field's options once the form definition is known.
  useEffect(() => {
    if (!tstruct) return;
    for (const field of tstruct.fields) {
      if (field.type !== "selection" || !field.api) continue;
      setSelectionItems((s) => ({ ...s, [field.name]: "loading" }));
      fetchSelectionItems(field.api)
        .then((items) => setSelectionItems((s) => ({ ...s, [field.name]: items })))
        .catch(() => setSelectionItems((s) => ({ ...s, [field.name]: "error" })));
    }
  }, [tstruct]);

  const sectionVisible = useMemo(() => {
    if (!tstruct) return {};
    const out = {};
    for (const section of tstruct.sections || []) out[section.name] = evalCondition(section.condition, values);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tstruct, values]);

  const setValue = (name, value) => {
    setValues((v) => ({ ...v, [name]: value }));
    setFieldErrors((e) => (e[name] ? { ...e, [name]: undefined } : e));
  };

  // fillFrom: when the referenced `selection` field's chosen item changes, copy its label into this field (still
  // freely editable afterwards — the backend places no further restriction on a `fill` field beyond length).
  const fillFieldFrom = (fillField, sourceName, selectedValue) => {
    const items = selectionItems[sourceName];
    if (!Array.isArray(items)) return;
    const picked = items.find((it) => it.value === selectedValue);
    if (picked) setValue(fillField.name, picked.label);
  };

  const handleChange = (field, value) => {
    setValue(field.name, value);
    if (field.type === "selection") {
      for (const f of tstruct.fields) if (f.type === "fill" && f.fillFrom === field.name) fillFieldFrom(f, field.name, value);
    }
  };

  const visibleFields = useMemo(
    () => (tstruct ? tstruct.fields.filter((f) => isFieldVisible(f, sectionVisible, values)) : []),
    [tstruct, sectionVisible, values]
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    if (submitting) return;

    const errors = {};
    for (const field of visibleFields) {
      const msg = localFieldError(field, values[field.name]);
      if (msg) errors[field.name] = msg;
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const epoch = ++submitEpoch.current;
    setSubmitting(true);
    setFormError(null);
    sandeshSocket
      .sd("tstruct.submit", { name: prompt.target, values })
      .then(({ submission }) => {
        if (submitEpoch.current !== epoch) return; // modal moved on (closed/reopened) before the reply arrived
        onSubmit(buildCard(tstruct, submission));
      })
      .catch((err) => {
        if (submitEpoch.current !== epoch) return;
        if (err?.code === "invalid_values" && err.details?.fields) setFieldErrors(err.details.fields);
        else setFormError(err?.message || "Could not submit this form. Please try again.");
      })
      .finally(() => {
        if (submitEpoch.current === epoch) setSubmitting(false);
      });
  };

  return (
    <div className="sandesh-modal-card-3d">
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <span className="material-icons modal-header-icon">{prompt.icon || "description"}</span>
          <div>
            <h3>{tstruct?.caption || prompt.label}</h3>
            <span className="modal-subtitle">{tstruct?.description || "Sandesh Smart Structure • Single DC Lite Action"}</span>
          </div>
        </div>
        <button type="button" className="close-btn-3d" onClick={onClose} aria-label="Close modal">
          ×
        </button>
      </div>

      {state.status === "loading" && (
        <div className="sandesh-modal-body">
          <div className="tstruct-loading-state">
            <span className="material-icons">autorenew</span>
            <p>Loading form…</p>
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div className="sandesh-modal-body">
          <div className="tstruct-error-state">
            <span className="material-icons">error_outline</span>
            <p>{state.message}</p>
          </div>
          <div className="sandesh-modal-actions">
            <button type="button" className="sandesh-btn-secondary-3d" onClick={onClose}>
              Close
            </button>
            <button type="button" className="sandesh-btn-primary-3d" onClick={load}>
              Retry
            </button>
          </div>
        </div>
      )}

      {state.status === "ready" && tstruct && (
        <form onSubmit={handleSubmit} className="sandesh-modal-body">
          {formError && (
            <div className="tstruct-form-error">
              <span className="material-icons">error_outline</span>
              {formError}
            </div>
          )}

          {tstruct.fields.filter((f) => !f.section).map((field) => (
            <TstructField
              key={field.name}
              field={field}
              visible={isFieldVisible(field, sectionVisible, values)}
              value={values[field.name]}
              error={fieldErrors[field.name]}
              onChange={(v) => handleChange(field, v)}
              selectionItems={selectionItems[field.name]}
            />
          ))}

          {(tstruct.sections || [])
            .filter((section) => sectionVisible[section.name] !== false)
            .map((section) => {
              const fields = tstruct.fields.filter((f) => f.section === section.name);
              if (fields.length === 0) return null;
              return (
                <div className="tstruct-section" key={section.name}>
                  <h4 className="tstruct-section-heading">{section.caption || section.name}</h4>
                  {fields.map((field) => (
                    <TstructField
                      key={field.name}
                      field={field}
                      visible={isFieldVisible(field, sectionVisible, values)}
                      value={values[field.name]}
                      error={fieldErrors[field.name]}
                      onChange={(v) => handleChange(field, v)}
                      selectionItems={selectionItems[field.name]}
                    />
                  ))}
                </div>
              );
            })}

          <div className="sandesh-modal-actions">
            <button type="button" className="sandesh-btn-secondary-3d" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="sandesh-btn-primary-3d" disabled={submitting}>
              {submitting ? "Submitting…" : "Post to Host & Queue"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// One field, of one of the twelve backend types (docs/SANDESH_API.md §5 / LITE_TSTRUCT.md §5). Hidden fields
// render nothing (their value is kept in state as-is; the server silently drops it, so there's nothing to clear).
function TstructField({ field, visible, value, error, onChange, selectionItems }) {
  if (!visible) return null;

  const label = (
    <label>
      {field.caption}
      {field.required && <span className="tstruct-required-mark">*</span>}
    </label>
  );
  const errorNode = error ? <div className="tstruct-field-error">{error}</div> : null;

  switch (field.type) {
    case "text":
      return (
        <div className="sandesh-input-group">
          {label}
          <div className={`sandesh-input-box-3d ${field.multiline ? "textarea-box" : ""}`}>
            {field.multiline ? (
              <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.caption} />
            ) : (
              <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.caption} />
            )}
          </div>
          {errorNode}
        </div>
      );

    case "date":
      return (
        <div className="sandesh-input-group">
          {label}
          <div className="sandesh-input-box-3d">
            <input type="date" value={value} min={field.min} max={field.max} onChange={(e) => onChange(e.target.value)} />
          </div>
          {errorNode}
        </div>
      );

    case "time":
      return (
        <div className="sandesh-input-group">
          {label}
          <div className="sandesh-input-box-3d">
            <input type="time" value={value} min={field.min} max={field.max} onChange={(e) => onChange(e.target.value)} />
          </div>
          {errorNode}
        </div>
      );

    case "wholenumber":
    case "number":
      return (
        <div className="sandesh-input-group">
          {label}
          <div className="sandesh-input-box-3d">
            <input
              type="number"
              step={field.type === "wholenumber" ? 1 : "any"}
              value={value}
              min={field.min}
              max={field.max}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
          {errorNode}
        </div>
      );

    case "email":
      return (
        <div className="sandesh-input-group">
          {label}
          <div className="sandesh-input-box-3d">
            <input type="email" value={value} onChange={(e) => onChange(e.target.value)} placeholder="name@example.com" />
          </div>
          {errorNode}
        </div>
      );

    case "url":
      return (
        <div className="sandesh-input-group">
          {label}
          <div className="sandesh-input-box-3d">
            <input type="url" value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://…" />
          </div>
          {errorNode}
        </div>
      );

    case "mobile":
      return (
        <div className="sandesh-input-group">
          {label}
          <div className="sandesh-input-box-3d">
            <input
              type="tel"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={field.withCountryCode ? "+91 98765 43210" : "98765 43210"}
            />
          </div>
          {field.withCountryCode && !error && <div className="tstruct-field-hint">Include the country code, e.g. +91…</div>}
          {errorNode}
        </div>
      );

    case "location":
      return (
        <div className="sandesh-input-group">
          {label}
          <div className="tstruct-location-row">
            <div className="sandesh-input-group">
              <div className="sandesh-input-box-3d">
                <input
                  type="number"
                  step="any"
                  placeholder="Latitude"
                  value={value?.lat ?? ""}
                  onChange={(e) => onChange({ ...value, lat: e.target.value })}
                />
              </div>
            </div>
            <div className="sandesh-input-group">
              <div className="sandesh-input-box-3d">
                <input
                  type="number"
                  step="any"
                  placeholder="Longitude"
                  value={value?.lng ?? ""}
                  onChange={(e) => onChange({ ...value, lng: e.target.value })}
                />
              </div>
            </div>
          </div>
          {navigator.geolocation && (
            <button
              type="button"
              className="tstruct-locate-btn"
              onClick={() =>
                navigator.geolocation.getCurrentPosition(
                  (pos) => onChange({ lat: String(pos.coords.latitude), lng: String(pos.coords.longitude) }),
                  () => {}
                )
              }
            >
              <span className="material-icons" style={{ fontSize: 14 }}>
                my_location
              </span>
              Use my current location
            </button>
          )}
          {errorNode}
        </div>
      );

    case "list":
      if (field.multi) {
        return (
          <div className="sandesh-input-group">
            {label}
            <div className="tstruct-multi-select">
              {(field.options || []).map((opt) => (
                <label className="checkbox-label" key={opt}>
                  <input
                    type="checkbox"
                    checked={(value || []).includes(opt)}
                    onChange={(e) => {
                      const next = e.target.checked ? [...(value || []), opt] : (value || []).filter((v) => v !== opt);
                      onChange(next);
                    }}
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
            {errorNode}
          </div>
        );
      }
      return (
        <div className="sandesh-input-group">
          {label}
          <div className="sandesh-input-box-3d select-box">
            <select value={value} onChange={(e) => onChange(e.target.value)}>
              <option value="" disabled>
                Choose…
              </option>
              {(field.options || []).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          {errorNode}
        </div>
      );

    case "selection": {
      const loading = selectionItems === "loading";
      const failed = selectionItems === "error";
      const items = Array.isArray(selectionItems) ? selectionItems : [];
      // No source configured, or the source could not be reached: fall back to a plain text box so the field is
      // still usable (the backend accepts any string up to 500 characters either way).
      if (!field.api || failed) {
        return (
          <div className="sandesh-input-group">
            {label}
            <div className="sandesh-input-box-3d">
              <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.caption} />
            </div>
            {failed && <div className="tstruct-field-hint">Couldn't load choices — you can still type a value.</div>}
            {errorNode}
          </div>
        );
      }
      return (
        <div className="sandesh-input-group">
          {label}
          <div className="sandesh-input-box-3d select-box">
            <select value={value} onChange={(e) => onChange(e.target.value)} disabled={loading}>
              <option value="">{loading ? "Loading…" : "Choose…"}</option>
              {items.map((it) => (
                <option key={it.value} value={it.value}>
                  {it.label}
                </option>
              ))}
            </select>
          </div>
          {errorNode}
        </div>
      );
    }

    case "fill":
      return (
        <div className="sandesh-input-group">
          {label}
          <div className="sandesh-input-box-3d">
            <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Auto-filled from your selection above" />
          </div>
          {errorNode}
        </div>
      );

    default:
      return (
        <div className="sandesh-input-group">
          {label}
          <div className="sandesh-input-box-3d">
            <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
          </div>
          {errorNode}
        </div>
      );
  }
}
