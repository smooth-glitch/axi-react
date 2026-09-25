import { useState } from "react";
import Avatar from "../Avatar.jsx";

export default function GroupsDirectoryModal({
  chats = [],
  groupMembersByName = {},
  onSelectChat,
  onNewGroup,
  onClose,
}) {
  const [search, setSearch] = useState("");

  const groups = chats.filter((c) => c.isGroup && c.id !== "room-general");

  const filteredGroups = groups.filter((g) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      g.name.toLowerCase().includes(q) ||
      (g.topic && g.topic.toLowerCase().includes(q))
    );
  });

  return (
    <div className="sandesh-modal-card-3d sandesh-groups-modal">
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <div
            className="new-group-icon-badge"
            style={{
              background: "rgba(255, 122, 89, 0.15)",
              color: "var(--sandesh-coral-accent)",
            }}
          >
            <span className="material-icons">groups</span>
          </div>
          <div>
            <h3>Your Groups &amp; Channels</h3>
            <span className="modal-subtitle">
              Collaborative workspaces and team project rooms
            </span>
          </div>
        </div>
        <button
          type="button"
          className="close-btn-3d"
          onClick={onClose}
          aria-label="Close groups"
        >
          ×
        </button>
      </div>

      <div style={{ display: "flex", gap: "10px", padding: "14px 22px 4px 22px" }}>
        <div className="new-group-input-box" style={{ flex: 1 }}>
          <span className="material-icons field-icon">search</span>
          <input
            type="text"
            className="new-group-input"
            placeholder="Search joined groups or channels..."
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
        <button
          type="button"
          className="sandesh-btn-primary-3d"
          style={{ padding: "0 16px", fontSize: "12px", gap: "6px" }}
          onClick={() => {
            onClose?.();
            onNewGroup?.();
          }}
        >
          <span className="material-icons" style={{ fontSize: "16px" }}>add</span>
          <span>New Group</span>
        </button>
      </div>

      <div className="sandesh-modal-body" style={{ maxHeight: "420px", padding: "12px 22px" }}>
        {filteredGroups.length === 0 ? (
          <div className="commands-empty-state">
            <span className="material-icons empty-icon">forum</span>
            <h4>No groups found</h4>
            <p>You haven&apos;t joined any project group matching &ldquo;{search}&rdquo;</p>
            <button
              type="button"
              className="sandesh-btn-primary-3d"
              style={{ marginTop: "12px", fontSize: "12px" }}
              onClick={() => {
                onClose?.();
                onNewGroup?.();
              }}
            >
              + Create Your First Group
            </button>
          </div>
        ) : (
          <div className="directory-user-list">
            {filteredGroups.map((g) => {
              const members = groupMembersByName[g.name] || g.members || [];
              return (
                <div key={g.id} className="directory-user-card group-entry-card">
                  <div className="directory-user-avatar-wrap">
                    <Avatar initials={g.name.slice(0, 2).toUpperCase()} color="#ff7a59" />
                  </div>

                  <div className="directory-user-info">
                    <div className="directory-user-name-row">
                      <span className="directory-user-name">{g.name}</span>
                      <span className="group-members-count-badge">
                        <span className="material-icons" style={{ fontSize: "13px" }}>people</span>
                        {members.length} member{members.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="directory-user-sub">
                      {g.topic || "Team Collaboration Channel"}
                    </div>
                    {g.preview && (
                      <div className="group-preview-text">
                        Latest: {g.preview}
                      </div>
                    )}
                  </div>

                  <div className="directory-user-actions">
                    <button
                      type="button"
                      className="sandesh-btn-primary-3d"
                      style={{ fontSize: "12px", padding: "6px 14px", gap: "6px" }}
                      onClick={() => {
                        onSelectChat?.(g.id);
                        onClose?.();
                      }}
                    >
                      <span className="material-icons" style={{ fontSize: "16px" }}>chat</span>
                      <span>Open</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="sandesh-modal-actions" style={{ padding: "14px 22px" }}>
        <span style={{ fontSize: "12px", color: "var(--sandesh-text-muted)" }}>
          Command: <code style={{ color: "var(--sandesh-coral-accent)" }}>#groups</code> or <code style={{ color: "var(--sandesh-coral-accent)" }}>#creategroup &lt;name&gt;</code>
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
