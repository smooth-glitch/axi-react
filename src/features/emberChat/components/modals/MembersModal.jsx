import { useState, useEffect } from "react";
import Avatar from "../Avatar.jsx";

export default function MembersModal({
  title = "Members",
  members = [],
  addableUsers = [],
  onAdd,
  onLeave,
  onClose,
}) {
  const [selectedUser, setSelectedUser] = useState(
    addableUsers[0]?.username || addableUsers[0]?.id || ""
  );

  useEffect(() => {
    if (addableUsers.length > 0 && !selectedUser) {
      setSelectedUser(addableUsers[0].username || addableUsers[0].id || "");
    }
  }, [addableUsers, selectedUser]);

  const handleAdd = () => {
    if (!selectedUser) return;
    onAdd?.(selectedUser);
  };

  return (
    <div id="ember-members-modal" className="sandesh-modal-card-3d" style={{ maxWidth: "500px", width: "100%" }}>
      {/* 1. Modal Header */}
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <div className="new-group-icon-badge" style={{ background: "rgba(16, 185, 129, 0.15)", borderColor: "rgba(16, 185, 129, 0.3)", color: "#059669" }}>
            <span className="material-icons">groups</span>
          </div>
          <div>
            <h3>{title}</h3>
            <span className="modal-subtitle">{members.length} team members in channel</span>
          </div>
        </div>
        <button type="button" className="close-btn-3d" onClick={onClose} aria-label="Close modal">
          ×
        </button>
      </div>

      {/* 2. Modal Body */}
      <div className="sandesh-modal-body" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
        {/* Current Members Section */}
        <div>
          <div className="new-group-section-header">
            <div className="section-title-wrap">
              <span className="section-title">Current Participants</span>
              <span className="selected-pill">{members.length}</span>
            </div>
          </div>

          <div className="new-group-members-list" style={{ maxHeight: "200px" }}>
            {members.map((m) => {
              const name = typeof m === "string" ? m : m.name || m.username || "Member";
              const initials = typeof m === "string" ? m.slice(0, 2).toUpperCase() : m.initials || name.slice(0, 2).toUpperCase();
              const color = typeof m === "string" ? "#ff7a59" : m.color || "#ff7a59";
              const designation = typeof m === "object" ? m.designation || m.role : "Active Channel Member";
              const role = typeof m === "object" ? m.role : null;

              return (
                <div
                  className="participant-card"
                  key={typeof m === "string" ? m : m.id || m.username || name}
                  style={{ cursor: "default", justifyContent: "space-between" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0, flex: 1 }}>
                    <Avatar size={40} initials={initials} color={color} />
                    <div className="participant-info">
                      <div className="participant-name-row">
                        <span className="participant-name">{name}</span>
                        {role === "Enterprise Administrator" && (
                          <span className="role-tag admin">Admin</span>
                        )}
                        {role === "HR Operations Host" && (
                          <span className="role-tag hr">HR</span>
                        )}
                      </div>
                      <span className="participant-role">{designation}</span>
                    </div>
                  </div>
                  <span className="material-icons" style={{ fontSize: "18px", color: "#10b981", marginRight: "4px" }} title="In Channel">
                    check_circle
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Add Member Section */}
        <div style={{ borderTop: "1px solid rgba(0, 0, 0, 0.06)", paddingTop: "14px" }}>
          <div className="section-title-wrap" style={{ marginBottom: "10px" }}>
            <span className="section-title">Add New Member</span>
          </div>

          {addableUsers.length > 0 ? (
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <div className="new-group-input-box" style={{ flex: 1, padding: "8px 12px" }}>
                <span className="material-icons field-icon">person_add</span>
                <select
                  id="ember-add-member-select"
                  value={selectedUser}
                  onChange={(e) => setSelectedUser(e.target.value)}
                  style={{
                    flex: 1,
                    border: "none",
                    background: "transparent",
                    outline: "none",
                    fontSize: "13px",
                    fontWeight: "600",
                    color: "var(--sandesh-text-main)",
                    cursor: "pointer",
                  }}
                >
                  {addableUsers.map((u) => {
                    const uId = u.username || u.id;
                    return (
                      <option key={uId} value={uId}>
                        {u.name} ({u.designation || u.role})
                      </option>
                    );
                  })}
                </select>
              </div>
              <button
                type="button"
                className="sandesh-btn-mini-primary"
                id="ember-add-member-btn"
                onClick={handleAdd}
                disabled={!selectedUser}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  height: "40px",
                  padding: "0 18px",
                  borderRadius: "12px",
                  fontSize: "13px",
                  fontWeight: "700",
                  flexShrink: 0,
                }}
              >
                <span className="material-icons" style={{ fontSize: "17px" }}>person_add</span>
                <span>Add Member</span>
              </button>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "12.5px",
                color: "var(--sandesh-text-muted)",
                background: "rgba(255, 255, 255, 0.7)",
                border: "1px solid var(--sandesh-glass-border)",
                padding: "10px 14px",
                borderRadius: "12px",
              }}
            >
              <span className="material-icons" style={{ fontSize: "18px", color: "#10b981" }}>verified</span>
              <span>All available team colleagues are already members of this group.</span>
            </div>
          )}
        </div>
      </div>

      {/* 3. Footer Action Buttons */}
      <div className="sandesh-modal-actions new-group-footer" style={{ justifyContent: "space-between" }}>
        <button
          type="button"
          className="sandesh-btn-danger-3d"
          id="ember-leave-group-btn"
          onClick={() => {
            if (window.confirm(`Are you sure you want to leave the group "${title}"?`)) {
              onLeave?.();
            }
          }}
        >
          <span className="material-icons">logout</span>
          <span>Leave Group</span>
        </button>

        <button
          type="button"
          className="sandesh-btn-secondary-3d"
          id="ember-members-close-btn"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
