import { useState } from "react";
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

  const handleAdd = () => {
    if (!selectedUser) return;
    onAdd?.(selectedUser);
  };

  return (
    <div id="ember-members-modal" className="modal">
      <div className="modal-header" id="ember-members-modal-title">
        {title} ({members.length} members)
      </div>
      <div className="modal-body">
        <div className="section-label" style={{ paddingLeft: 0 }}>
          Current Group Members
        </div>
        <ul id="ember-members-list" style={{ maxHeight: "160px", overflowY: "auto", margin: "8px 0 16px 0", padding: 0 }}>
          {members.map((m) => {
            const name = typeof m === "string" ? m : m.name || m.username || "Member";
            const initials = typeof m === "string" ? m.slice(0, 2).toUpperCase() : m.initials || name.slice(0, 2).toUpperCase();
            const color = typeof m === "string" ? "#34c759" : m.color || "#34c759";
            return (
              <li className="member-row" key={typeof m === "string" ? m : m.id || name} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 0" }}>
                <Avatar initials={initials} color={color} />
                <span className="name" style={{ fontWeight: 500 }}>{name}</span>
              </li>
            );
          })}
        </ul>

        {addableUsers.length > 0 ? (
          <div className="add-member-row" style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "12px" }}>
            <select
              id="ember-add-member-select"
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              style={{ flex: 1, padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--sandesh-glass-border)", background: "rgba(255,255,255,0.8)" }}
            >
              <option value="" disabled>Select an online associate to add</option>
              {addableUsers.map((u) => {
                const uId = u.username || u.id;
                return (
                  <option key={uId} value={uId}>
                    {u.name} (@{uId})
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              className="btn btn-primary"
              id="ember-add-member-btn"
              onClick={handleAdd}
              disabled={!selectedUser}
            >
              Add
            </button>
          </div>
        ) : (
          <div style={{ fontSize: "13px", color: "var(--sandesh-text-muted)", marginTop: "8px" }}>
            No other online associates available to add.
          </div>
        )}
      </div>
      <div className="modal-footer" style={{ display: "flex", justifyContent: "space-between", marginTop: "16px" }}>
        <button type="button" className="btn btn-danger" id="ember-leave-group-btn" onClick={onLeave}>
          Leave group
        </button>
        <button type="button" className="btn btn-secondary" id="ember-members-close-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
