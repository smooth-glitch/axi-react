import { useCallback, useEffect, useState } from "react";
import { sandeshSocket } from "../../../../services/sandeshSocket.js";
import { useLiveChanges } from "../../utils/useLiveChanges.js";

// Admin: options (the buttons above the chat) and who they apply to (admin.option.*).
// A form is only offered to a user when an option pointing at it applies to them.

const TYPE_LABELS = {
  data_input: "Data input (opens a form)",
  get_data: "Get data & display",
  download: "Download",
  upload: "Upload",
  pay: "Pay",
  axpert_tstruct: "Axpert tstruct",
  axpert_smartview: "Axpert smart view",
  axpert_iview: "Axpert iview",
  axpert_page: "Axpert page",
};
const EXECUTABLE = new Set(["data_input"]);
const APPLICABLE_KEYS = [
  ["categories", "User categories"],
  ["affiliates", "Affiliates"],
  ["departments", "Departments"],
  ["branches", "Branches"],
  ["designations", "Designations"],
];

const blankOption = () => ({
  isNew: true, id: "", caption: "", type: "data_input", target: "", display: "table", order: 0, active: true,
  applicable: {},
});

export default function AdminOptionsPanel({ pushToast }) {
  const [options, setOptions] = useState(null);
  const [forms, setForms] = useState([]);
  const [userForms, setUserForms] = useState([]);
  const [choices, setChoices] = useState({});
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [opts, tstructs, cats, affs, deps, brs, des, ustructs] = await Promise.all([
      sandeshSocket.sd("admin.option.list"),
      sandeshSocket.sd("admin.tstruct.list"),
      sandeshSocket.sd("admin.cfg.list", { kind: "categories" }),
      sandeshSocket.sd("admin.cfg.list", { kind: "affiliates" }),
      sandeshSocket.sd("admin.cfg.list", { kind: "departments" }),
      sandeshSocket.sd("admin.cfg.list", { kind: "branches" }),
      sandeshSocket.sd("admin.cfg.list", { kind: "designations" }),
      sandeshSocket.sd("tstruct.user.list"),
    ]);
    const bad = [opts, tstructs, cats, affs, deps, brs, des, ustructs].find((r) => !r.ok);
    if (bad) {
      setError(bad.error?.message || "Couldn't load options.");
      setOptions([]);
      return;
    }
    setError("");
    setOptions(opts.data?.options || []);
    setForms(tstructs.data?.tstructs || []);
    setUserForms(ustructs.data?.tstructs || []);
    const names = (r) => (r.data?.items || []).map((i) => i.name);
    setChoices({
      categories: ["Employee", "Affiliate", ...names(cats)],
      affiliates: names(affs),
      departments: names(deps),
      branches: names(brs),
      designations: names(des),
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // options (anyone's) and the forms they can point at change live; an open editor keeps what was typed
  useLiveChanges((c) => {
    if (c.event === "options_changed" || c.event === "tstructs_changed" || c.event === "resync") load();
  });

  const fail = (res) => pushToast({ type: "sd", ok: false, error: res.error });

  const save = async (e) => {
    e.preventDefault();
    const o = editor;
    setBusy(true);
    const res = await sandeshSocket.sd("admin.option.save", {
      id: o.id.trim(),
      caption: o.caption.trim(),
      type: o.type,
      target: o.target || undefined,
      display: o.type === "get_data" ? o.display : undefined,
      order: Number.parseInt(o.order, 10) || 0,
      active: o.active,
      applicable: o.applicable,
    });
    setBusy(false);
    if (!res.ok) return fail(res);
    pushToast(`Saved option ${o.caption}`);
    setEditor(null);
    load();
  };

  const remove = async (id) => {
    setBusy(true);
    const res = await sandeshSocket.sd("admin.option.delete", { id });
    setBusy(false);
    if (!res.ok) return fail(res);
    pushToast(`Deleted option ${id}`);
    load();
  };

  const summarize = (ap) => {
    const parts = APPLICABLE_KEYS.filter(([k]) => Array.isArray(ap?.[k])).map(([k, label]) => `${label}: ${ap[k].join(", ")}`);
    return parts.length ? parts.join(" • ") : "Everyone";
  };

  if (editor) {
    const set = (patch) => setEditor({ ...editor, ...patch });
    const setAp = (key, val) => {
      const next = { ...editor.applicable };
      if (val === "all") delete next[key];
      else next[key] = val;
      set({ applicable: next });
    };
    return (
      <form onSubmit={save} className="invite-user-form">
        <h4>{editor.isNew ? "New option" : `Edit option: ${editor.id}`}</h4>
        <div className="sandesh-form-row">
          <div className="sandesh-input-group">
            <label>Id (letters, digits, _ -)</label>
            <div className="sandesh-input-box-3d">
              <input type="text" value={editor.id} disabled={!editor.isNew} required onChange={(e) => set({ id: e.target.value })} />
            </div>
          </div>
          <div className="sandesh-input-group">
            <label>Button caption</label>
            <div className="sandesh-input-box-3d">
              <input type="text" value={editor.caption} required onChange={(e) => set({ caption: e.target.value })} />
            </div>
          </div>
        </div>
        <div className="sandesh-form-row">
          <div className="sandesh-input-group">
            <label>Type</label>
            <div className="sandesh-input-box-3d select-box">
              <select value={editor.type} onChange={(e) => set({ type: e.target.value, target: "" })}>
                {Object.entries(TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="sandesh-input-group">
            <label>{editor.type === "data_input" ? "Form" : "Target (API / page name)"}</label>
            <div className="sandesh-input-box-3d select-box">
              {editor.type === "data_input" ? (
                <select value={editor.target} required onChange={(e) => set({ target: e.target.value })}>
                  <option value="">{forms.length + userForms.length ? "Select a form…" : "Create a form first"}</option>
                  {forms.length > 0 && (
                    <optgroup label="Admin-managed forms">
                      {forms.map((f) => (
                        <option key={f.name} value={f.name}>{f.caption || f.name}</option>
                      ))}
                    </optgroup>
                  )}
                  {userForms.length > 0 && (
                    <optgroup label="User-made structures">
                      {userForms.map((f) => (
                        <option key={`u-${f.name}`} value={f.name}>{f.caption || f.name}{f.owner ? ` (by @${f.owner})` : ""}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              ) : (
                <input type="text" value={editor.target} onChange={(e) => set({ target: e.target.value })} />
              )}
            </div>
          </div>
        </div>
        {!EXECUTABLE.has(editor.type) && (
          <p className="section-note">
            The server stores and filters this type but can&apos;t run it yet (its external-system contract isn&apos;t fixed), so users will see a &quot;not available yet&quot; message.
          </p>
        )}
        <div className="sandesh-form-row">
          <div className="sandesh-input-group">
            <label>Order</label>
            <div className="sandesh-input-box-3d"><input type="number" value={editor.order} onChange={(e) => set({ order: e.target.value })} /></div>
          </div>
          <label className="checkbox-label" style={{ alignSelf: "end", display: "inline-flex", gap: 6 }}>
            <input type="checkbox" checked={editor.active} onChange={(e) => set({ active: e.target.checked })} /> Active
          </label>
        </div>

        <h5 style={{ marginTop: 12 }}>Applicable to</h5>
        <p className="section-note">
          Leave a group on &quot;All&quot; to not restrict by it. Department, branch and designation only restrict employees; affiliates only restrict affiliate members.
        </p>
        {APPLICABLE_KEYS.map(([key, label]) => {
          const cur = editor.applicable[key];
          const isAll = !Array.isArray(cur);
          return (
            <div key={key} style={{ marginBottom: 8 }}>
              <label style={{ fontWeight: 600, fontSize: 12 }}>{label}</label>
              <div>
                <label className="checkbox-label" style={{ display: "inline-flex", gap: 4, marginRight: 10 }}>
                  <input type="checkbox" checked={isAll} onChange={() => setAp(key, isAll ? [] : "all")} /> All
                </label>
                {!isAll &&
                  (choices[key] || []).map((c) => (
                    <label key={c} className="checkbox-label" style={{ display: "inline-flex", gap: 4, marginRight: 10 }}>
                      <input
                        type="checkbox"
                        checked={cur.includes(c)}
                        onChange={() => setAp(key, cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c])}
                      />
                      {c}
                    </label>
                  ))}
                {!isAll && (choices[key] || []).length === 0 && <span className="section-note">None configured yet.</span>}
              </div>
            </div>
          );
        })}

        <div className="sandesh-modal-actions">
          <button type="button" className="sandesh-btn-secondary-3d" onClick={() => setEditor(null)}>Cancel</button>
          <button type="submit" className="sandesh-btn-primary-3d" disabled={busy}>Save option</button>
        </div>
      </form>
    );
  }

  return (
    <div className="admin-table-container">
      <div className="admin-section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h4>Options ({options?.length ?? 0})</h4>
        <button type="button" className="sandesh-btn-mini-primary" onClick={() => setEditor(blankOption())}>+ New option</button>
      </div>
      <p className="section-note">Options are the buttons users see above the chat. Each one decides who gets it.</p>
      {error && <div className="sandesh-alert sandesh-alert-danger">{error}</div>}
      <div className="sandesh-glass-table">
        <div className="table-row table-head" style={{ gridTemplateColumns: "1.3fr 1fr 1.6fr 0.6fr 1fr" }}>
          <span>Caption</span><span>Type</span><span>Applicable to</span><span>Status</span><span>Actions</span>
        </div>
        {(options || []).map((o) => (
          <div key={o.id} className="table-row" style={{ gridTemplateColumns: "1.3fr 1fr 1.6fr 0.6fr 1fr" }}>
            <div className="cell-user">
              <span className="cell-name">{o.caption}</span>
              <span className="cell-sub">{o.id}{o.target ? ` → ${o.target}` : ""}{o.owner ? ` • by @${o.owner}` : ""}</span>
            </div>
            <span>{o.type}</span>
            <span className="cell-sub">{summarize(o.applicable)}</span>
            <span>{o.active === false ? "Off" : "On"}</span>
            <span>
              <button
                type="button"
                className="sandesh-btn-link"
                onClick={() => setEditor({ ...blankOption(), ...o, isNew: false, order: o.order ?? 0, target: o.target || "", display: o.display || "table", applicable: o.applicable || {} })}
              >
                Edit
              </button>{" "}
              <button type="button" className="sandesh-btn-link" disabled={busy} onClick={() => remove(o.id)}>Delete</button>
            </span>
          </div>
        ))}
        {options && options.length === 0 && <div className="table-row"><span className="section-note">No options yet.</span></div>}
      </div>
    </div>
  );
}
