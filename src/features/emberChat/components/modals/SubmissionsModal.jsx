import { useCallback, useEffect, useState } from "react";
import { sandeshSocket } from "../../../../services/sandeshSocket.js";
import { displayValue } from "../../utils/formEngine.js";

// submissions.list: the user's own submissions plus those from people they host.
// Only the author can edit or delete a submission (server-enforced).
export default function SubmissionsModal({ currentUser, onClose, onEdit }) {
  const [subs, setSubs] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const res = await sandeshSocket.sd("submissions.list");
    if (!res.ok) {
      setError(res.error?.message || "Couldn't load submissions.");
      setSubs([]);
      return;
    }
    setError("");
    setSubs(res.data?.submissions || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (sub) => {
    setBusyId(sub.id);
    const res = await sandeshSocket.sd("submissions.delete", { id: sub.id });
    setBusyId(null);
    if (!res.ok) {
      setError(res.error?.message || "Couldn't delete that submission.");
      return;
    }
    load();
  };

  const me = (currentUser?.username || "").toLowerCase();

  return (
    <div className="sandesh-modal-card-3d">
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <span className="material-icons modal-header-icon">history</span>
          <div>
            <h3>My Submissions</h3>
            <span className="modal-subtitle">Yours, and those from users you host</span>
          </div>
        </div>
        <button type="button" className="close-btn-3d" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="sandesh-modal-body">
        {error && <div className="sandesh-alert sandesh-alert-danger">{error}</div>}
        {subs === null && <p className="section-note">Loading…</p>}
        {subs && subs.length === 0 && !error && <p className="section-note">Nothing submitted yet.</p>}
        {(subs || []).map((s) => {
          const mine = String(s.by || "").toLowerCase() === me;
          return (
            <div key={s.id} className="approval-request-card" style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong>{s.tstruct} #{s.id}</strong>
                <span className="section-note">
                  {mine ? "You" : `@${s.by}`} • {s.ts ? new Date(s.ts).toLocaleString() : ""}
                </span>
              </div>
              <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5 }}>
                {Object.entries(s.values || {}).map(([k, v]) => (
                  <div key={k}>
                    <span className="section-note">{k}: </span>
                    {displayValue(v)}
                  </div>
                ))}
              </div>
              {mine && (
                <div style={{ marginTop: 8, display: "flex", gap: 12 }}>
                  <button type="button" className="sandesh-btn-link" onClick={() => onEdit?.(s)}>Edit</button>
                  <button type="button" className="sandesh-btn-link" disabled={busyId === s.id} onClick={() => remove(s)}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
