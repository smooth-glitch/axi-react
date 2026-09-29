import { useState } from "react";
import Avatar from "../Avatar.jsx";

export default function ApprovalsModal({
  initialStatus = "pending",
  requests = [],
  onAccept,
  onReject,
  onIgnore,
  onClose,
  onStartChatWithUser,
  onAddDemoApplicant,
}) {
  const [statusFilter, setStatusFilter] = useState(initialStatus);

  const pendingCount = requests.filter((r) => r.status === "pending").length;
  const acceptedCount = requests.filter((r) => r.status === "accepted").length;
  const rejectedCount = requests.filter((r) => r.status === "rejected").length;
  const totalCount = requests.length;

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
              background: "rgba(255, 122, 89, 0.15)",
              color: "var(--sandesh-coral-accent)",
            }}
          >
            <span className="material-icons">how_to_reg</span>
          </div>
          <div>
            <h3>User Access &amp; Registration Approvals</h3>
            <span className="modal-subtitle">
              Verify applicant details and authorize user entry into the Sandesh Chat Interface
            </span>
          </div>
        </div>
        <button
          type="button"
          className="close-btn-3d"
          onClick={onClose}
          aria-label="Close user approvals"
        >
          ×
        </button>
      </div>

      {/* Tabs with live count badges */}
      <div className="sandesh-tab-pills-3d" style={{ margin: "14px 22px 6px 22px" }}>
        {[
          { key: "pending", label: "Pending", count: pendingCount, highlight: pendingCount > 0 },
          { key: "accepted", label: "Approved", count: acceptedCount },
          { key: "rejected", label: "Rejected", count: rejectedCount },
          { key: "all", label: "All Requests", count: totalCount },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`sandesh-tab-pill ${statusFilter === tab.key ? "active" : ""}`}
            onClick={() => setStatusFilter(tab.key)}
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <span>{tab.label}</span>
            <span
              className="tab-count-pill"
              style={{
                fontSize: "11px",
                fontWeight: 700,
                padding: "1px 6px",
                borderRadius: "999px",
                background: tab.highlight
                  ? "var(--sandesh-coral-accent)"
                  : "rgba(0, 0, 0, 0.08)",
                color: tab.highlight ? "#ffffff" : "inherit",
              }}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      <div className="sandesh-modal-body" style={{ maxHeight: "450px", padding: "14px 22px" }}>
        {filtered.length === 0 ? (
          <div className="commands-empty-state" style={{ padding: "30px 10px", textAlign: "center" }}>
            <span className="material-icons empty-icon" style={{ fontSize: "42px", color: "rgba(0,0,0,0.25)" }}>
              how_to_reg
            </span>
            <h4 style={{ margin: "10px 0 4px 0", fontSize: "16px" }}>
              No {statusFilter !== "all" ? statusFilter : ""} user requests
            </h4>
            <p style={{ fontSize: "13px", color: "var(--sandesh-text-muted)", maxWidth: 360, margin: "0 auto 16px auto" }}>
              {statusFilter === "pending"
                ? "All caught up! There are no pending applicants waiting for entry clearance."
                : `No user applications found in the ${statusFilter} category.`}
            </p>

            {onAddDemoApplicant && (
              <button
                type="button"
                className="sandesh-btn-secondary-3d"
                onClick={onAddDemoApplicant}
                style={{ fontSize: "12px", padding: "8px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}
                title="Create a sample self-registered user to test the approval and rejection workflow"
              >
                <span className="material-icons" style={{ fontSize: 16 }}>person_add</span>
                <span>Simulate Registration Request (Test)</span>
              </button>
            )}
          </div>
        ) : (
          <div className="requests-cards-stack">
            {filtered.map((req) => {
              const uName = req.username || req.fromUser || req.name || "applicant";
              const displayName = req.name || uName;
              const category = req.category || "Employee";
              const isPending = req.status === "pending";
              const isAccepted = req.status === "accepted";
              const isRejected = req.status === "rejected";

              return (
                <div key={req.id} className="approval-request-card applicant-approval-card">
                  {/* Card Header */}
                  <div className="approval-card-header">
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <Avatar
                        initials={displayName.slice(0, 2).toUpperCase()}
                        color={isPending ? "#ff7a59" : isAccepted ? "#34c759" : "#8e8e93"}
                        size={38}
                      />
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--sandesh-text-main)" }}>
                            {displayName}
                          </span>
                          <span style={{ fontSize: "12px", color: "var(--sandesh-text-muted)" }}>
                            @{uName}
                          </span>
                          <span className="applicant-category-pill">{category}</span>
                        </div>
                        <span style={{ fontSize: "11px", color: "var(--sandesh-text-muted)" }}>
                          Request ID: #{req.id} • {req.time || "Recently"}
                        </span>
                      </div>
                    </div>

                    <span className={`approval-status-pill status-${req.status}`}>
                      {isPending ? "AWAITING ENTRY" : req.status.toUpperCase()}
                    </span>
                  </div>

                  {/* Applicant Details Grid */}
                  <div className="applicant-details-grid">
                    {req.email && (
                      <div className="applicant-info-item">
                        <span className="material-icons item-icon">email</span>
                        <div className="item-text">
                          <span className="item-label">Email</span>
                          <span className="item-value" title={req.email}>{req.email}</span>
                        </div>
                      </div>
                    )}
                    {req.mobile && (
                      <div className="applicant-info-item">
                        <span className="material-icons item-icon">phone</span>
                        <div className="item-text">
                          <span className="item-label">Mobile</span>
                          <span className="item-value">{req.mobile}</span>
                        </div>
                      </div>
                    )}
                    {req.department && (
                      <div className="applicant-info-item">
                        <span className="material-icons item-icon">domain</span>
                        <div className="item-text">
                          <span className="item-label">Department</span>
                          <span className="item-value">{req.department}</span>
                        </div>
                      </div>
                    )}
                    {req.designation && (
                      <div className="applicant-info-item">
                        <span className="material-icons item-icon">badge</span>
                        <div className="item-text">
                          <span className="item-label">Designation</span>
                          <span className="item-value">{req.designation}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Summary / Reason */}
                  {req.details && (
                    <div className="approval-desc-box">
                      <span className="material-icons" style={{ fontSize: 15, color: "var(--sandesh-text-muted)" }}>info</span>
                      <span>{req.details}</span>
                    </div>
                  )}

                  {/* Action Bar */}
                  {isPending && (
                    <div className="approval-card-actions applicant-action-bar">
                      <button
                        type="button"
                        className="sandesh-btn-mini-primary sandesh-btn-allow-entry"
                        onClick={() => onAccept?.(req.id, req)}
                      >
                        <span className="material-icons">check_circle</span>
                        <span>Allow Entry to Chat</span>
                      </button>
                      <button
                        type="button"
                        className="sandesh-btn-mini-danger sandesh-btn-deny-entry"
                        onClick={() => onReject?.(req.id, req)}
                      >
                        <span className="material-icons">cancel</span>
                        <span>Reject Access</span>
                      </button>
                      <button
                        type="button"
                        className="sandesh-btn-mini-ghost"
                        onClick={() => onIgnore?.(req.id, req)}
                        title="Dismiss notification from queue"
                      >
                        <span>Dismiss</span>
                      </button>
                    </div>
                  )}

                  {isAccepted && (
                    <div className="approval-granted-bar">
                      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#34c759", fontSize: "12px", fontWeight: 600 }}>
                        <span className="material-icons" style={{ fontSize: 16 }}>verified</span>
                        <span>Entry Authorized — Account Active in Chat</span>
                      </div>
                      {onStartChatWithUser && (
                        <button
                          type="button"
                          className="sandesh-btn-mini-primary"
                          style={{ fontSize: "11px", padding: "4px 10px" }}
                          onClick={() => {
                            onStartChatWithUser?.(req);
                            onClose?.();
                          }}
                        >
                          <span className="material-icons" style={{ fontSize: 14 }}>chat</span>
                          <span>Message User</span>
                        </button>
                      )}
                    </div>
                  )}

                  {isRejected && (
                    <div className="approval-rejected-bar">
                      <span className="material-icons" style={{ fontSize: 16, color: "#ff3b30" }}>block</span>
                      <span style={{ fontSize: "12px", color: "#ff3b30", fontWeight: 600 }}>Access Denied by Administrator</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="sandesh-modal-actions" style={{ padding: "14px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "12px", color: "var(--sandesh-text-muted)" }}>
          Real-time commands: <code style={{ color: "var(--sandesh-coral-accent)" }}>#accept &lt;id&gt;</code> or <code style={{ color: "var(--sandesh-coral-accent)" }}>#reject &lt;id&gt;</code>
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
