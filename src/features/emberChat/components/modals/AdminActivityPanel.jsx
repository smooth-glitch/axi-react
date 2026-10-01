import { useCallback, useEffect, useState } from "react";
import { sandeshSocket } from "../../../../services/sandeshSocket.js";

const ACTION_LABELS = {
  "user.update": "Updated details",
  "user.status": "Changed status",
  "host.change": "Changed host",
  "host.reassign": "Moved a host's people",
  "users.bulk_move": "Bulk move",
  "admin.add": "Made administrator",
  "admin.remove": "Removed as administrator",
};

const show = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  if (v === true) return "yes";
  if (v === false) return "no";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "object") return "(changed)";
  return String(v);
};

export function summarise(entry) {
  const d = entry.details || {};
  switch (entry.action) {
    case "user.update": {
      const parts = Object.entries(d.changes || {}).map(([k, c]) => `${k}: ${show(c.from)} → ${show(c.to)}`);
      return parts.length ? parts.join("; ") : "No visible change";
    }
    case "user.status":
      return `${d.active ? "Activated" : "Deactivated"}${d.movedUsers?.length ? `, moved ${d.movedUsers.length} people to a new host` : ""}${d.orphans ? `, ${d.orphans} people left without a host` : ""}`;
    case "host.change":
      return d.host ? `Host → @${d.host}${d.coversUser === false ? " (outside that host's scope)" : ""}` : "Host cleared";
    case "host.reassign":
      return `${(d.moved || []).length} people → @${d.to}`;
    case "users.bulk_move":
      return `${(d.moved || []).length} people → ${d.field} "${d.to}"${d.failed ? `, ${d.failed} failed` : ""}`;
    default:
      return "";
  }
}

const when = (ts) =>
  new Date(ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + " IST";

export default function AdminActivityPanel({ pushToast }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async (username) => {
    setLoading(true);
    setError("");
    const res = await sandeshSocket.sd("admin.audit.list", { limit: 100, ...(username ? { username } : {}) });
    setLoading(false);
    if (!res.ok) {
      setError(res.error?.message || "Couldn't load the activity log.");
      return;
    }
    setEntries(res.data?.entries || []);
  }, []);

  useEffect(() => {
    load("");
    return sandeshSocket.subscribe((event) => {
      if (event.type === "status_change" && event.status === "connected") load(q.trim());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  return (
    <div className="admin-table-container" data-testid="admin-activity">
      <div className="admin-section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h4>Admin activity ({entries.length})</h4>
        <form
          style={{ display: "flex", gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            load(q.trim());
          }}
        >
          <div className="admin-search-glass">
            <span className="material-icons" style={{ fontSize: 16 }}>search</span>
            <input type="text" placeholder="Filter by username…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button type="submit" className="admin-btn-action" disabled={loading}>
            <span className="material-icons" style={{ fontSize: 15 }}>refresh</span>
            <span>{loading ? "Loading…" : "Refresh"}</span>
          </button>
        </form>
      </div>
      {error && (
        <p className="section-note" style={{ padding: 12 }}>
          {error}{" "}
          <button type="button" className="sandesh-btn-link" onClick={() => load(q.trim())}>Retry</button>
        </p>
      )}
      {!error && !loading && entries.length === 0 && <p className="section-note" style={{ padding: 12 }}>No admin changes recorded yet.</p>}
      <div className="sandesh-glass-table">
        {entries.map((e, i) => (
          <div className="table-row" key={`${e.ts}-${i}`} style={{ gridTemplateColumns: "1.1fr 1.3fr 1fr 3fr" }}>
            <span className="cell-sub">{when(e.ts)}</span>
            <span><strong>@{e.actor}</strong> · {ACTION_LABELS[e.action] || e.action}</span>
            <span>{e.target && e.target !== "-" ? `@${e.target}` : "—"}</span>
            <span>{summarise(e)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
