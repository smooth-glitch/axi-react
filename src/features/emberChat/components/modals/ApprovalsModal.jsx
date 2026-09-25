import { useState } from "react";

export default function ApprovalsModal({
  initialStatus = "all",
  requests = [],
  onAccept,
  onReject,
  onIgnore,
  onClose,
}) {
  const [statusFilter, setStatusFilter] = useState(initialStatus);

  const filtered = requests.filter((r) => {
    if (statusFilter === "all") return true;
    return r.status === statusFilter;
  });

  return (
    <div className="sandesh-modal-card-3d sandesh-approvals-modal">
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <div
            className="new-group-icon-badge"
            style={{
              background: "rgba(255, 159, 10, 0.15)",
              color: "#ff9f0a",
            }}
          >
            <span className="material-icons">task_alt</span>
          </div>
          <div>
            <h3>Approvals &amp; Invitations</h3>
            <span className="modal-subtitle">
              Pending associate requests, departmental permissions and transfers
            </span>
          </div>
        </div>
        <button
          type="button"
          className="close-btn-3d"
          onClick={onClose}
          aria-label="Close approvals"
        >
          ×
        </button>
      </div>

      {/* Tabs */}
      <div className="sandesh-tab-pills-3d" style={{ margin: "14px 22px 4px 22px" }}>
        {["all", "pending", "accepted", "rejected"].map((tab) => (
          <button
            key={tab}
            type="button"
            className={`sandesh-tab-pill ${statusFilter === tab ? "active" : ""}`}
            onClick={() => setStatusFilter(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="sandesh-modal-body" style={{ maxHeight: "420px", padding: "14px 22px" }}>
        {filtered.length === 0 ? (
          <div className="commands-empty-state">
            <span className="material-icons empty-icon">assignment_turned_in</span>
            <h4>No {statusFilter !== "all" ? statusFilter : ""} requests</h4>
            <p>You have no approval requests in this category.</p>
          </div>
        ) : (
          <div className="requests-cards-stack">
            {filtered.map((req) => (
              <div key={req.id} className="approval-request-card">
                <div className="approval-card-header">
                  <div className="approval-type-tag">
                    <span className="material-icons req-icon">
                      {req.type === "transfer" ? "swap_horiz" : "person_add"}
                    </span>
                    <span>{req.title || "Associate Invitation"}</span>
                  </div>
                  <span className={`approval-status-pill status-${req.status}`}>
                    {req.status.toUpperCase()}
                  </span>
                </div>

                <div className="approval-card-body">
                  <p className="approval-desc">{req.description || req.details}</p>
                  <div className="approval-meta">
                    <span>From: <strong>@{req.fromUser || req.from}</strong></span>
                    {req.time && <span> • {req.time}</span>}
                    <span className="req-id-badge">ID: #{req.id}</span>
                  </div>
                </div>

                {req.status === "pending" && (
                  <div className="approval-card-actions">
                    <button
                      type="button"
                      className="sandesh-btn-mini-primary"
                      onClick={() => onAccept?.(req.id)}
                    >
                      <span className="material-icons">check</span>
                      <span>Accept</span>
                    </button>
                    <button
                      type="button"
                      className="sandesh-btn-mini-danger"
                      onClick={() => onReject?.(req.id)}
                    >
                      <span className="material-icons">close</span>
                      <span>Reject</span>
                    </button>
                    <button
                      type="button"
                      className="sandesh-btn-mini-ghost"
                      onClick={() => onIgnore?.(req.id)}
                    >
                      <span>Ignore</span>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sandesh-modal-actions" style={{ padding: "14px 22px" }}>
        <span style={{ fontSize: "12px", color: "var(--sandesh-text-muted)" }}>
          Command: <code style={{ color: "var(--sandesh-coral-accent)" }}>#requests [status]</code> or <code style={{ color: "var(--sandesh-coral-accent)" }}>#accept &lt;id&gt;</code>
        </span>
        <button
          type="button"
          className="sandesh-btn-secondary-3d"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
