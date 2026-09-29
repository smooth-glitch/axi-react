import { useEffect, useState } from "react";
import { sandeshSocket } from "../../../../services/sandeshSocket.js";
import BarcodeInput from "../BarcodeScanner.jsx";
import OptionActionPanel from "./OptionActionPanel.jsx";
import { useLiveChanges } from "../../utils/useLiveChanges.js";
import {
  buildSubmission,
  displayValue,
  groupBySection,
  requiredErrors,
} from "../../utils/formEngine.js";

// A form from the admin-defined lite-tstruct catalogue (docs/LITE_TSTRUCT.md).
// `option` is one of the user's options.list entries (type data_input -> target = form name).
// Without an option it shows the user's available forms to pick from.

function SelectionField({ field, value, onChange }) {
  const [items, setItems] = useState(null); // null = loading, [] = none/failed
  useEffect(() => {
    let alive = true;
    if (!field.api) {
      setItems([]);
      return undefined;
    }
    fetch(field.api)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json) => {
        const arr = Array.isArray(json) ? json : json.items || json.data || json.results || [];
        const list = arr.map((it) =>
          typeof it === "object" && it !== null
            ? { value: String(it.id ?? it.value ?? it.name ?? it.label), label: String(it.label ?? it.name ?? it.id ?? it.value), raw: it }
            : { value: String(it), label: String(it), raw: it }
        );
        if (alive) setItems(list);
      })
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [field.api]);

  // If the data source can't be reached the user can still type the value.
  if (items && items.length === 0) {
    return <input type="text" value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder="Enter a value" />;
  }
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value, (items || []).find((it) => it.value === e.target.value)?.raw)}
      disabled={items === null}
    >
      <option value="">{items === null ? "Loading…" : "Select…"}</option>
      {(items || []).map((it) => (
        <option key={it.value} value={it.value}>{it.label}</option>
      ))}
    </select>
  );
}

function FieldInput({ field, value, onChange, readOnly }) {
  const id = `sd-f-${field.name}`;
  switch (field.type) {
    case "text":
      return field.multiline || field.rich ? (
        <textarea id={id} rows={3} value={value || ""} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} type="text" value={value || ""} onChange={(e) => onChange(e.target.value)} />
      );
    case "date":
    case "time":
      return <input id={id} type={field.type} min={field.min} max={field.max} value={value || ""} onChange={(e) => onChange(e.target.value)} />;
    case "wholenumber":
    case "number":
      return (
        <input
          id={id}
          type="number"
          step={field.type === "wholenumber" ? 1 : "any"}
          min={field.min}
          max={field.max}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "email":
      return <input id={id} type="email" value={value || ""} onChange={(e) => onChange(e.target.value)} />;
    case "url":
      return <input id={id} type="url" placeholder="https://" value={value || ""} onChange={(e) => onChange(e.target.value)} />;
    case "mobile":
      return (
        <input
          id={id}
          type="tel"
          placeholder={field.withCountryCode ? "+91 98860 00000" : "Mobile number"}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "location":
      return (
        <div style={{ display: "flex", gap: 8, width: "100%" }}>
          <input id={id} type="text" placeholder="lat,lng (e.g. 12.97,77.59)" value={value || ""} onChange={(e) => onChange(e.target.value)} />
          <button
            type="button"
            className="sandesh-btn-link"
            onClick={() =>
              navigator.geolocation?.getCurrentPosition((pos) =>
                onChange(`${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`)
              )
            }
          >
            Use my location
          </button>
        </div>
      );
    case "list":
      if (field.multi) {
        const chosen = Array.isArray(value) ? value : [];
        return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {(field.options || []).map((o) => (
              <label key={o} className="checkbox-label" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={chosen.includes(o)}
                  onChange={() => onChange(chosen.includes(o) ? chosen.filter((x) => x !== o) : [...chosen, o])}
                />
                <span>{o}</span>
              </label>
            ))}
          </div>
        );
      }
      return (
        <select id={id} value={value || ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {(field.options || []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
    case "selection":
      return <SelectionField field={field} value={value} onChange={onChange} />;
    case "barcode":
      return <BarcodeInput value={value} onChange={onChange} />;
    case "fill":
      // Auto Fill: read-only, copied from the chosen item of the selection field it names (fillFrom + sourceProp)
      return <input id={id} type="text" value={value || ""} readOnly placeholder="Filled in automatically" />;
    default:
      return <input id={id} type="text" value={value || ""} onChange={(e) => onChange(e.target.value)} readOnly={readOnly} />;
  }
}

function initialValues(tstruct, currentUser) {
  const values = {};
  for (const f of tstruct.fields || []) {
    // "fill" fields pre-populate from the signed-in user's profile when they name one of its keys.
    const isFieldRef = (tstruct.fields || []).some((x) => x.name === f.fillFrom);
    if (f.type === "fill" && f.fillFrom && !isFieldRef && currentUser && currentUser[f.fillFrom] != null) {
      values[f.name] = String(currentUser[f.fillFrom]);
    }
  }
  return values;
}

export default function SmartStructureModal({ prompt: option, options = [], currentUser, editing, onClose, onSubmit }) {
  const [current, setCurrent] = useState(option || null);
  const [tstruct, setTstruct] = useState(null);
  const [values, setValues] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // options made by users open user-made structures; admin options open admin-defined forms
  const userScope = current?.targetScope === "user";

  // Load the form definition for the chosen option.
  useEffect(() => {
    if (!current) return undefined;
    setTstruct(null);
    setLoadError("");
    setFieldErrors({});
    setSubmitError("");
    if (current.type !== "data_input") return undefined; // handled by OptionActionPanel
    let alive = true;
    setLoading(true);
    sandeshSocket.sd(userScope ? "tstruct.user.get" : "tstruct.get", { name: current.target }).then((res) => {
      if (!alive) return;
      setLoading(false);
      if (!res.ok) {
        setLoadError(
          res.error?.code === "not_found"
            ? "This form no longer exists. Its creator may have deleted it."
            : res.error?.code === "forbidden"
              ? "This form isn't available to you."
              : res.error?.message || "Couldn't load the form."
        );
        return;
      }
      setTstruct(res.data.tstruct);
      setValues(editing ? { ...initialValues(res.data.tstruct, currentUser), ...editing.values } : initialValues(res.data.tstruct, currentUser));
    });
    return () => {
      alive = false;
    };
  }, [current, currentUser, editing]);

  // The form's definition changed (or it was deleted) while it is open. Reloading it would throw away what the user
  // has typed, so say so instead.
  const [staleNote, setStaleNote] = useState("");
  useLiveChanges((c) => {
    if (c.event === "tstructs_changed" && current?.type === "data_input" && c.name === current.target) {
      setStaleNote(
        c.action === "deleted"
          ? "This form was deleted, so it can no longer be submitted."
          : "This form was just changed. Close and reopen it to use the latest version."
      );
    }
  });

  const setValue = (name, v, raw) => {
    setValues((prev) => {
      const next = { ...prev, [name]: v };
      // Auto Fill fields copy a property of the chosen item of the selection field they name
      for (const f of tstruct?.fields || []) {
        if (f.type === "fill" && f.fillFrom === name) {
          const picked = raw?.[f.sourceProp || "value"] ?? raw?.[f.sourceProp || "name"];
          next[f.name] = picked === undefined || picked === null ? "" : String(picked);
        }
      }
      return next;
    });
    setFieldErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError("");
    const missing = requiredErrors(tstruct, values);
    if (Object.keys(missing).length) {
      setFieldErrors(missing);
      return;
    }
    setSubmitting(true);
    const payload = buildSubmission(tstruct, values);
    const res = editing
      ? await sandeshSocket.sd("submissions.update", { id: editing.id, values: payload })
      : await sandeshSocket.sd(userScope ? "tstruct.user.submit" : "tstruct.submit", { name: tstruct.name, values: payload });
    setSubmitting(false);
    if (!res.ok) {
      if (res.error?.code === "invalid_values" && res.error.details?.fields) {
        setFieldErrors(res.error.details.fields);
        setSubmitError("Please fix the highlighted fields.");
      } else {
        setSubmitError(res.error?.message || "Submission failed. Nothing was saved.");
      }
      return;
    }
    const sub = res.data?.submission;
    const details = {};
    for (const f of tstruct.fields) {
      if (payload[f.name] !== undefined) details[f.caption || f.name] = displayValue(payload[f.name]);
    }
    onSubmit({
      kind: "card",
      title: `${tstruct.caption || tstruct.name} ${editing ? "updated" : "submitted"}`,
      actionStatus: sub?.id ? `Submission #${sub.id}` : "Submitted",
      details,
    });
  };

  const forms = options;

  return (
    <div className="sandesh-modal-card-3d">
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <span className="material-icons modal-header-icon">widgets</span>
          <div>
            <h3>{current?.caption || "Smart Prompts"}</h3>
            <span className="modal-subtitle">
              {tstruct?.description || "Forms set up for you by your organisation"}
            </span>
          </div>
        </div>
        <button type="button" className="close-btn-3d" onClick={onClose} aria-label="Close modal">
          ×
        </button>
      </div>

      {!current && (
        <div className="sandesh-modal-body">
          {forms.length === 0 ? (
            <p className="section-note">No forms have been set up for you yet. An administrator can add them under Admin Console → Options.</p>
          ) : (
            forms.map((o) => (
              <button key={o.id} type="button" className="sandesh-btn-secondary-3d" style={{ display: "block", width: "100%", marginBottom: 8 }} onClick={() => setCurrent(o)}>
                {o.caption}
              </button>
            ))
          )}
        </div>
      )}

      {current && current.type !== "data_input" && (
        <OptionActionPanel option={current} currentUser={currentUser} onClose={onClose} />
      )}

      {current && loading && <div className="sandesh-modal-body"><p className="section-note">Loading form…</p></div>}

      {current && loadError && (
        <div className="sandesh-modal-body">
          <div className="sandesh-alert sandesh-alert-danger">{loadError}</div>
          <div className="sandesh-modal-actions">
            <button type="button" className="sandesh-btn-secondary-3d" onClick={onClose}>Close</button>
          </div>
        </div>
      )}

      {current && tstruct && (
        <form onSubmit={handleSubmit} className="sandesh-modal-body" noValidate>
          {staleNote && <div className="sandesh-alert sandesh-alert-danger" role="status">{staleNote}</div>}
          {groupBySection(tstruct, values).map((group) => (
            <div key={group.name || "_"}>
              {group.caption && <h4 style={{ margin: "12px 0 6px" }}>{group.caption}</h4>}
              {group.fields.map((f) => (
                <div className="sandesh-input-group" key={f.name}>
                  <label htmlFor={`sd-f-${f.name}`}>
                    {f.caption || f.name}
                    {f.required && <span style={{ color: "#e53935" }}> *</span>}
                  </label>
                  <div className="sandesh-input-box-3d">
                    <FieldInput field={f} value={values[f.name]} onChange={(v, raw) => setValue(f.name, v, raw)} />
                  </div>
                  {fieldErrors[f.name] && (
                    <div style={{ color: "#e53935", fontSize: "0.78rem", marginTop: 3 }}>{fieldErrors[f.name]}</div>
                  )}
                </div>
              ))}
            </div>
          ))}

          {submitError && (
            <div style={{ color: "#e53935", fontSize: "0.82rem", padding: "6px 0 2px", lineHeight: 1.4 }}>{submitError}</div>
          )}

          <div className="sandesh-modal-actions">
            <button type="button" className="sandesh-btn-secondary-3d" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="sandesh-btn-primary-3d" disabled={submitting}>
              {submitting ? "Saving…" : editing ? "Save changes" : "Submit"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
