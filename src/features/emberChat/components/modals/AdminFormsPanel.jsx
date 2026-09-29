import { useCallback, useEffect, useState } from "react";
import { sandeshSocket } from "../../../../services/sandeshSocket.js";
import { useLiveChanges } from "../../utils/useLiveChanges.js";

// Admin: lite-tstruct form definitions (admin.tstruct.*). See docs/LITE_TSTRUCT.md.

const FIELD_TYPES = [
  ["text", "Text"], ["date", "Date"], ["time", "Time"], ["wholenumber", "Whole number"], ["number", "Number"],
  ["email", "Email"], ["url", "URL"], ["mobile", "Mobile"], ["location", "Location"],
  ["list", "List (choose from options)"], ["selection", "Selection (from a data source)"], ["fill", "Fill (from profile)"],
];
const OPS = [
  ["eq", "equals"], ["ne", "does not equal"], ["gt", ">"], ["lt", "<"], ["gte", "≥"], ["lte", "≤"],
  ["in", "is one of (comma separated)"], ["notempty", "has a value"],
];

const blankField = () => ({
  name: "", caption: "", type: "text", required: false, section: "", condition: emptyCond(),
  multiline: false, min: "", max: "", options: "", multi: false, api: "", fillFrom: "", withCountryCode: false,
});
const blankSection = () => ({ name: "", caption: "", condition: emptyCond() });
const emptyCond = () => ({ mode: "none", rows: [{ field: "", op: "eq", value: "" }] });

// definition condition -> editor state
function condToEditor(c) {
  if (!c) return emptyCond();
  const toRow = (x) => ({ field: x.field, op: x.op, value: x.op === "in" ? (x.value || []).join(", ") : x.value ?? "" });
  if (Array.isArray(c.all)) return { mode: "all", rows: c.all.map(toRow) };
  if (Array.isArray(c.any)) return { mode: "any", rows: c.any.map(toRow) };
  return { mode: "single", rows: [toRow(c)] };
}

// editor state -> definition condition (null when unused)
function editorToCond(e) {
  if (e.mode === "none") return null;
  const rows = e.rows
    .filter((r) => r.field)
    .map((r) => (r.op === "notempty"
      ? { field: r.field, op: r.op }
      : { field: r.field, op: r.op, value: r.op === "in" ? r.value.split(",").map((x) => x.trim()).filter(Boolean) : r.value }));
  if (rows.length === 0) return null;
  if (e.mode === "all") return { all: rows };
  if (e.mode === "any") return { any: rows };
  return rows[0];
}

function ConditionEditor({ value, onChange, fieldNames }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const setRow = (i, patch) => set({ rows: value.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <div style={{ marginTop: 6 }}>
      <select value={value.mode} onChange={(e) => set({ mode: e.target.value })}>
        <option value="none">Always shown</option>
        <option value="single">Show only if…</option>
        <option value="all">Show only if ALL of…</option>
        <option value="any">Show only if ANY of…</option>
      </select>
      {value.mode !== "none" && (
        <div style={{ display: "grid", gap: 4, marginTop: 4 }}>
          {value.rows.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <select value={r.field} onChange={(e) => setRow(i, { field: e.target.value })}>
                <option value="">field…</option>
                {fieldNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <select value={r.op} onChange={(e) => setRow(i, { op: e.target.value })}>
                {OPS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              {r.op !== "notempty" && (
                <input type="text" value={r.value} placeholder="value" onChange={(e) => setRow(i, { value: e.target.value })} />
              )}
              {value.mode !== "single" && value.rows.length > 1 && (
                <button type="button" className="sandesh-btn-link" onClick={() => set({ rows: value.rows.filter((_, j) => j !== i) })}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {value.mode !== "single" && (
            <button type="button" className="sandesh-btn-link" onClick={() => set({ rows: [...value.rows, { field: "", op: "eq", value: "" }] })}>
              + add condition
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// server definition -> editor state
function toEditor(d) {
  return {
    isNew: false,
    name: d.name,
    caption: d.caption || "",
    description: d.description || "",
    sections: (d.sections || []).map((s) => ({ name: s.name, caption: s.caption || "", condition: condToEditor(s.condition) })),
    fields: (d.fields || []).map((f) => ({
      name: f.name, caption: f.caption || "", type: f.type, required: !!f.required, section: f.section || "",
      condition: condToEditor(f.condition),
      multiline: !!f.multiline, min: f.min ?? "", max: f.max ?? "", options: (f.options || []).join(", "),
      multi: !!f.multi, api: f.api || "", fillFrom: f.fillFrom || "", withCountryCode: !!f.withCountryCode,
    })),
  };
}

// editor state -> server payload
function toPayload(ed) {
  const num = (v) => (v === "" || v === undefined ? undefined : Number(v));
  return {
    name: ed.name.trim(),
    caption: ed.caption.trim() || undefined,
    description: ed.description.trim() || undefined,
    sections: ed.sections.map((s) => ({ name: s.name.trim(), caption: s.caption.trim() || undefined, condition: editorToCond(s.condition) })),
    fields: ed.fields.map((f) => {
      const out = {
        name: f.name.trim(), caption: f.caption.trim() || undefined, type: f.type, required: f.required,
        section: f.section || null, condition: editorToCond(f.condition),
      };
      if (f.type === "text") out.multiline = !!f.multiline;
      if (f.type === "date" || f.type === "time") { if (f.min) out.min = f.min; if (f.max) out.max = f.max; }
      if (f.type === "wholenumber" || f.type === "number") { out.min = num(f.min); out.max = num(f.max); }
      if (f.type === "list") { out.options = f.options.split(",").map((x) => x.trim()).filter(Boolean); out.multi = !!f.multi; }
      if (f.type === "selection") out.api = f.api || null;
      if (f.type === "fill") out.fillFrom = f.fillFrom || null;
      if (f.type === "mobile") out.withCountryCode = !!f.withCountryCode;
      return out;
    }),
  };
}

export default function AdminFormsPanel({ pushToast }) {
  const [list, setList] = useState(null);
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await sandeshSocket.sd("admin.tstruct.list");
    if (!res.ok) {
      setError(res.error?.message || "Couldn't load forms.");
      setList([]);
      return;
    }
    setError("");
    setList(res.data?.tstructs || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // another admin (or a user-made change) altered the forms: refresh the list; an open editor is left alone
  useLiveChanges((c) => {
    if (c.event === "tstructs_changed" || c.event === "resync") load();
  });

  const fail = (res) => pushToast({ type: "sd", ok: false, error: res.error });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const res = await sandeshSocket.sd("admin.tstruct.save", toPayload(editor));
    setBusy(false);
    if (!res.ok) return fail(res);
    pushToast(`Saved form ${editor.name}`);
    setEditor(null);
    load();
  };

  const remove = async (name) => {
    setBusy(true);
    const res = await sandeshSocket.sd("admin.tstruct.delete", { name });
    setBusy(false);
    if (!res.ok) return fail(res); // e.g. in_use: an option still points at it
    pushToast(`Deleted form ${name}`);
    load();
  };

  if (editor) {
    const set = (patch) => setEditor({ ...editor, ...patch });
    const setField = (i, patch) => set({ fields: editor.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
    const setSection = (i, patch) => set({ sections: editor.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
    const fieldNames = editor.fields.map((f) => f.name).filter(Boolean);
    return (
      <form onSubmit={save} className="invite-user-form">
        <h4>{editor.isNew ? "New form" : `Edit form: ${editor.name}`}</h4>
        <div className="sandesh-form-row">
          <div className="sandesh-input-group">
            <label>Name (letters, digits, underscore)</label>
            <div className="sandesh-input-box-3d">
              <input type="text" value={editor.name} disabled={!editor.isNew} required onChange={(e) => set({ name: e.target.value })} />
            </div>
          </div>
          <div className="sandesh-input-group">
            <label>Caption</label>
            <div className="sandesh-input-box-3d">
              <input type="text" value={editor.caption} onChange={(e) => set({ caption: e.target.value })} />
            </div>
          </div>
        </div>
        <div className="sandesh-input-group">
          <label>Description</label>
          <div className="sandesh-input-box-3d">
            <input type="text" value={editor.description} onChange={(e) => set({ description: e.target.value })} />
          </div>
        </div>

        <h5 style={{ marginTop: 14 }}>Sections (optional)</h5>
        {editor.sections.map((s, i) => (
          <div key={i} className="setup-card" style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input type="text" placeholder="name" value={s.name} onChange={(e) => setSection(i, { name: e.target.value })} />
              <input type="text" placeholder="caption" value={s.caption} onChange={(e) => setSection(i, { caption: e.target.value })} />
              <button type="button" className="sandesh-btn-link" onClick={() => set({ sections: editor.sections.filter((_, j) => j !== i) })}>Remove</button>
            </div>
            <ConditionEditor value={s.condition} fieldNames={fieldNames} onChange={(condition) => setSection(i, { condition })} />
          </div>
        ))}
        <button type="button" className="sandesh-btn-mini-primary" onClick={() => set({ sections: [...editor.sections, blankSection()] })}>+ Section</button>

        <h5 style={{ marginTop: 14 }}>Fields</h5>
        {editor.fields.map((f, i) => (
          <div key={i} className="setup-card" style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <input type="text" placeholder="name" value={f.name} required onChange={(e) => setField(i, { name: e.target.value })} />
              <input type="text" placeholder="caption" value={f.caption} onChange={(e) => setField(i, { caption: e.target.value })} />
              <select value={f.type} onChange={(e) => setField(i, { type: e.target.value })}>
                {FIELD_TYPES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              <label className="checkbox-label" style={{ display: "inline-flex", gap: 4 }}>
                <input type="checkbox" checked={f.required} onChange={(e) => setField(i, { required: e.target.checked })} /> required
              </label>
              {editor.sections.length > 0 && (
                <select value={f.section} onChange={(e) => setField(i, { section: e.target.value })}>
                  <option value="">no section</option>
                  {editor.sections.filter((s) => s.name).map((s) => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
                </select>
              )}
              <button type="button" className="sandesh-btn-link" onClick={() => set({ fields: editor.fields.filter((_, j) => j !== i) })}>Remove</button>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
              {f.type === "text" && (
                <label className="checkbox-label"><input type="checkbox" checked={f.multiline} onChange={(e) => setField(i, { multiline: e.target.checked })} /> multi-line</label>
              )}
              {(f.type === "date" || f.type === "time") && (
                <>
                  <input type={f.type} value={f.min} onChange={(e) => setField(i, { min: e.target.value })} title="min" />
                  <input type={f.type} value={f.max} onChange={(e) => setField(i, { max: e.target.value })} title="max" />
                </>
              )}
              {(f.type === "wholenumber" || f.type === "number") && (
                <>
                  <input type="number" placeholder="min" value={f.min} onChange={(e) => setField(i, { min: e.target.value })} />
                  <input type="number" placeholder="max" value={f.max} onChange={(e) => setField(i, { max: e.target.value })} />
                </>
              )}
              {f.type === "list" && (
                <>
                  <input type="text" placeholder="options, comma separated" value={f.options} onChange={(e) => setField(i, { options: e.target.value })} />
                  <label className="checkbox-label"><input type="checkbox" checked={f.multi} onChange={(e) => setField(i, { multi: e.target.checked })} /> allow several</label>
                </>
              )}
              {f.type === "selection" && (
                <input type="url" placeholder="data source URL returning a JSON list" value={f.api} onChange={(e) => setField(i, { api: e.target.value })} />
              )}
              {f.type === "fill" && (
                <input type="text" placeholder="profile key (e.g. name, email, mobile)" value={f.fillFrom} onChange={(e) => setField(i, { fillFrom: e.target.value })} />
              )}
              {f.type === "mobile" && (
                <label className="checkbox-label"><input type="checkbox" checked={f.withCountryCode} onChange={(e) => setField(i, { withCountryCode: e.target.checked })} /> require country code</label>
              )}
            </div>
            <ConditionEditor value={f.condition} fieldNames={fieldNames.filter((n) => n !== f.name)} onChange={(condition) => setField(i, { condition })} />
          </div>
        ))}
        <button type="button" className="sandesh-btn-mini-primary" onClick={() => set({ fields: [...editor.fields, blankField()] })}>+ Field</button>

        <div className="sandesh-modal-actions">
          <button type="button" className="sandesh-btn-secondary-3d" onClick={() => setEditor(null)}>Cancel</button>
          <button type="submit" className="sandesh-btn-primary-3d" disabled={busy || editor.fields.length === 0}>Save form</button>
        </div>
      </form>
    );
  }

  return (
    <div className="admin-table-container">
      <div className="admin-section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h4>Forms ({list?.length ?? 0})</h4>
        <button
          type="button"
          className="sandesh-btn-mini-primary"
          onClick={() => setEditor({ isNew: true, name: "", caption: "", description: "", sections: [], fields: [blankField()] })}
        >
          + New form
        </button>
      </div>
      <p className="section-note">
        A form only reaches users once an Option points at it (see the Options tab).
      </p>
      {error && <div className="sandesh-alert sandesh-alert-danger">{error}</div>}
      <div className="sandesh-glass-table">
        <div className="table-row table-head" style={{ gridTemplateColumns: "1.2fr 1.6fr 0.6fr 1fr" }}>
          <span>Name</span><span>Caption</span><span>Fields</span><span>Actions</span>
        </div>
        {(list || []).map((d) => (
          <div key={d.name} className="table-row" style={{ gridTemplateColumns: "1.2fr 1.6fr 0.6fr 1fr" }}>
            <span className="cell-name">{d.name}</span>
            <span>{d.caption}</span>
            <span>{(d.fields || []).length}</span>
            <span>
              <button type="button" className="sandesh-btn-link" onClick={() => setEditor(toEditor(d))}>Edit</button>{" "}
              <button type="button" className="sandesh-btn-link" disabled={busy} onClick={() => remove(d.name)}>Delete</button>
            </span>
          </div>
        ))}
        {list && list.length === 0 && <div className="table-row"><span className="section-note">No forms yet.</span></div>}
      </div>
    </div>
  );
}
