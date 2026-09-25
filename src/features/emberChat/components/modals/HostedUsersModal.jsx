import { useState } from "react";
import Avatar from "../Avatar.jsx";

export default function HostedUsersModal({
  hostedUsers = [],
  availableHosts = ["sabarish", "nageshwari", "hr", "finance"],
  onTransferUser,
  onClose,
}) {
  const [selectedUser, setSelectedUser] = useState(null);
  const [targetHost, setTargetHost] = useState(availableHosts[0] || "");

  const handleTransferSubmit = (e) => {
    e.preventDefault();
    if (!selectedUser || !targetHost) return;
    onTransferUser?.(selectedUser.username, targetHost);
    setSelectedUser(null);
  };

  return (
    <div className="sandesh-modal-card-3d sandesh-hosted-users-modal">
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <div
            className="new-group-icon-badge"
            style={{
              background: "rgba(175, 82, 222, 0.15)",
              color: "#af52de",
            }}
          >
            <span className="material-icons">supervisor_account</span>
          </div>
          <div>
            <h3>Hosted Users SPOC Management</h3>
            <span className="modal-subtitle">
              Colleagues under your host responsibility • Transfer mentorship
            </span>
          </div>
        </div>
        <button
          type="button"
          className="close-btn-3d"
          onClick={onClose}
          aria-label="Close hosted users"
        >
          ×
        </button>
      </div>

      <div className="sandesh-modal-body" style={{ maxHeight: "440px", padding: "18px 22px" }}>
        {hostedUsers.length === 0 ? (
          <div className="commands-empty-state">
            <span className="material-icons empty-icon">assignment_ind</span>
            <h4>No hosted users assigned</h4>
            <p>You currently do not have any colleagues assigned under your host account.</p>
          </div>
        ) : (
          <div className="directory-user-list">
            {hostedUsers.map((u) => (
              <div key={u.username} className="directory-user-card">
                <div className="directory-user-avatar-wrap">
                  <Avatar initials={u.initials || u.name?.slice(0, 2).toUpperCase() || "HU"} color={u.color || "#af52de"} />
                </div>

                <div className="directory-user-info">
                  <div className="directory-user-name-row">
                    <span className="directory-user-name">{u.name}</span>
                    <span className="directory-user-handle">@{u.username}</span>
                  </div>
                  <div className="directory-user-sub">
                    {u.designation || "Employee"} • {u.department || "Bangalore HQ"}
                  </div>
                </div>

                <div className="directory-user-actions">
                  <button
                    type="button"
                    className="sandesh-btn-secondary-3d"
                    style={{ fontSize: "12px", padding: "6px 12px", gap: "4px" }}
                    onClick={() => setSelectedUser(u)}
                  >
                    <span className="material-icons" style={{ fontSize: "16px" }}>swap_horiz</span>
                    <span>Transfer Host</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Transfer Modal / Form dialog */}
        {selectedUser && (
          <form onSubmit={handleTransferSubmit} className="transfer-host-form-overlay">
            <h4>Transfer SPOC Host for @{selectedUser.username}</h4>
            <p style={{ fontSize: "12px", color: "var(--sandesh-text-muted)" }}>
              Select an available department host to take over responsibility for this colleague:
            </p>
            <div className="new-group-input-box" style={{ marginTop: "8px" }}>
              <span className="material-icons field-icon">domain</span>
              <select
                className="new-group-input"
                style={{ background: "transparent", border: "none", outline: "none", width: "100%" }}
                value={targetHost}
                onChange={(e) => setTargetHost(e.target.value)}
              >
                {availableHosts.map((h) => (
                  <option key={h} value={h}>
                    Host: @{h}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "12px" }}>
              <button
                type="button"
                className="sandesh-btn-secondary-3d"
                onClick={() => setSelectedUser(null)}
              >
                Cancel
              </button>
              <button type="submit" className="sandesh-btn-primary-3d">
                Confirm Transfer
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="sandesh-modal-actions" style={{ padding: "14px 22px" }}>
        <span style={{ fontSize: "12px", color: "var(--sandesh-text-muted)" }}>
          Command: <code style={{ color: "var(--sandesh-coral-accent)" }}>#myusers</code> or <code style={{ color: "var(--sandesh-coral-accent)" }}>#transfer &lt;user&gt; &lt;toHost&gt;</code>
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
