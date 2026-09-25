import { useState } from "react";
import Avatar from "../Avatar.jsx";

export default function OnlineUsersModal({
  onlineUsers = [],
  availableUsers = [],
  currentUsername = "",
  onSelectUser,
  onViewProfile,
  onClose,
}) {
  const [search, setSearch] = useState("");

  const myClean = (currentUsername || "").toLowerCase().trim();

  // Combine online users and known personnel, marking who is currently connected
  const allUsersMap = new Map();

  availableUsers.forEach((u) => {
    const uName = (u.username || u.name || u.id || "").toLowerCase().trim();
    if (uName && uName !== myClean) {
      allUsersMap.set(uName, {
        ...u,
        username: uName,
        isOnline: false,
      });
    }
  });

  onlineUsers.forEach((u) => {
    const uName = (u.username || u.name || u.id || "").toLowerCase().trim();
    if (uName && uName !== myClean) {
      const existing = allUsersMap.get(uName) || {};
      allUsersMap.set(uName, {
        ...existing,
        ...u,
        username: uName,
        isOnline: true,
      });
    }
  });

  const usersList = Array.from(allUsersMap.values()).sort((a, b) => {
    if (a.isOnline && !b.isOnline) return -1;
    if (!a.isOnline && b.isOnline) return 1;
    return (a.name || a.username).localeCompare(b.name || b.username);
  });

  const filteredUsers = usersList.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.username && u.username.toLowerCase().includes(q)) ||
      (u.designation && u.designation.toLowerCase().includes(q)) ||
      (u.department && u.department.toLowerCase().includes(q))
    );
  });

  const onlineCount = usersList.filter((u) => u.isOnline).length;

  return (
    <div className="sandesh-modal-card-3d sandesh-users-modal">
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <div
            className="new-group-icon-badge"
            style={{
              background: "rgba(52, 199, 89, 0.15)",
              color: "#34c759",
            }}
          >
            <span className="material-icons">people</span>
          </div>
          <div>
            <h3>Sandesh Active Directory</h3>
            <span className="modal-subtitle">
              {onlineCount} user{onlineCount === 1 ? "" : "s"} online now • {usersList.length} colleagues available
            </span>
          </div>
        </div>
        <button
          type="button"
          className="close-btn-3d"
          onClick={onClose}
          aria-label="Close directory"
        >
          ×
        </button>
      </div>

      <div style={{ padding: "14px 22px 4px 22px" }}>
        <div className="new-group-input-box">
          <span className="material-icons field-icon">search</span>
          <input
            type="text"
            className="new-group-input"
            placeholder="Search online users by name, username or department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {search && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setSearch("")}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="sandesh-modal-body" style={{ maxHeight: "420px", padding: "12px 22px" }}>
        {filteredUsers.length === 0 ? (
          <div className="commands-empty-state">
            <span className="material-icons empty-icon">person_off</span>
            <h4>No users found</h4>
            <p>No active user matches &ldquo;{search}&rdquo;</p>
          </div>
        ) : (
          <div className="directory-user-list">
            {filteredUsers.map((u) => (
              <div key={u.username} className="directory-user-card">
                <div className="directory-user-avatar-wrap">
                  <Avatar initials={u.initials || u.name?.slice(0, 2).toUpperCase() || "US"} color={u.color || "#34c759"} />
                  {u.isOnline && <span className="online-beacon-dot" title="Online now" />}
                </div>

                <div className="directory-user-info">
                  <div className="directory-user-name-row">
                    <span className="directory-user-name">{u.name || u.username}</span>
                    <span className="directory-user-handle">@{u.username}</span>
                    {u.isHost && <span className="host-badge">HOST</span>}
                    {u.isAdmin && <span className="admin-badge">ADMIN</span>}
                  </div>
                  <div className="directory-user-sub">
                    {u.designation || u.role || "Enterprise Associate"}
                    {u.department && ` • ${u.department}`}
                  </div>
                </div>

                <div className="directory-user-actions">
                  <button
                    type="button"
                    className="dir-action-btn dir-profile-btn"
                    title="View Profile"
                    onClick={() => {
                      onViewProfile?.(u);
                    }}
                  >
                    <span className="material-icons">badge</span>
                  </button>
                  <button
                    type="button"
                    className="dir-action-btn dir-dm-btn"
                    title="Send Direct Message"
                    onClick={() => {
                      onSelectUser?.(u);
                      onClose?.();
                    }}
                  >
                    <span className="material-icons">chat</span>
                    <span>Message</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sandesh-modal-actions" style={{ padding: "14px 22px" }}>
        <span style={{ fontSize: "12px", color: "var(--sandesh-text-muted)" }}>
          Command: <code style={{ color: "var(--sandesh-coral-accent)" }}>#users</code> or <code style={{ color: "var(--sandesh-coral-accent)" }}>#online</code>
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
