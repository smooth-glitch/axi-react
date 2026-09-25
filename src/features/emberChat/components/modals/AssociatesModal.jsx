import { useState } from "react";
import Avatar from "../Avatar.jsx";

export default function AssociatesModal({
  associates = [],
  onSelectUser,
  onDisconnect,
  onOpenFind,
  onClose,
}) {
  const [search, setSearch] = useState("");

  const filtered = associates.filter((a) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (a.name && a.name.toLowerCase().includes(q)) ||
      (a.username && a.username.toLowerCase().includes(q)) ||
      (a.designation && a.designation.toLowerCase().includes(q)) ||
      (a.department && a.department.toLowerCase().includes(q))
    );
  });

  return (
    <div className="sandesh-modal-card-3d sandesh-associates-modal">
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <div
            className="new-group-icon-badge"
            style={{
              background: "rgba(52, 199, 89, 0.15)",
              color: "#34c759",
            }}
          >
            <span className="material-icons">contact_page</span>
          </div>
          <div>
            <h3>Sandesh Associates &amp; Contacts</h3>
            <span className="modal-subtitle">
              Verified enterprise colleagues and partner connections
            </span>
          </div>
        </div>
        <button
          type="button"
          className="close-btn-3d"
          onClick={onClose}
          aria-label="Close associates"
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
            placeholder="Search your connected associates..."
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
            onOpenFind?.();
          }}
        >
          <span className="material-icons" style={{ fontSize: "16px" }}>person_add</span>
          <span>Find &amp; Connect</span>
        </button>
      </div>

      <div className="sandesh-modal-body" style={{ maxHeight: "420px", padding: "12px 22px" }}>
        {filtered.length === 0 ? (
          <div className="commands-empty-state">
            <span className="material-icons empty-icon">person_search</span>
            <h4>No associates found</h4>
            <p>You haven&apos;t added any associates matching &ldquo;{search}&rdquo;</p>
            <button
              type="button"
              className="sandesh-btn-primary-3d"
              style={{ marginTop: "12px", fontSize: "12px" }}
              onClick={() => {
                onClose?.();
                onOpenFind?.();
              }}
            >
              + Find People to Connect
            </button>
          </div>
        ) : (
          <div className="directory-user-list">
            {filtered.map((a) => (
              <div key={a.username} className="directory-user-card">
                <div className="directory-user-avatar-wrap">
                  <Avatar initials={a.initials || a.name?.slice(0, 2).toUpperCase() || "AS"} color={a.color || "#34c759"} />
                  <span className="online-beacon-dot" />
                </div>

                <div className="directory-user-info">
                  <div className="directory-user-name-row">
                    <span className="directory-user-name">{a.name || a.username}</span>
                    <span className="directory-user-handle">@{a.username}</span>
                    <span className="connected-badge">Connected</span>
                  </div>
                  <div className="directory-user-sub">
                    {a.designation || "Enterprise Associate"}
                    {a.department && ` • ${a.department}`}
                  </div>
                </div>

                <div className="directory-user-actions">
                  <button
                    type="button"
                    className="dir-action-btn dir-dm-btn"
                    title="Send Direct Message"
                    onClick={() => {
                      onSelectUser?.(a);
                      onClose?.();
                    }}
                  >
                    <span className="material-icons">chat</span>
                    <span>Chat</span>
                  </button>
                  <button
                    type="button"
                    className="dir-action-btn dir-disconnect-btn"
                    title="Disconnect Associate"
                    onClick={() => {
                      if (window.confirm(`Disconnect associate @${a.username}?`)) {
                        onDisconnect?.(a.username);
                      }
                    }}
                  >
                    <span className="material-icons">person_remove</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sandesh-modal-actions" style={{ padding: "14px 22px" }}>
        <span style={{ fontSize: "12px", color: "var(--sandesh-text-muted)" }}>
          Command: <code style={{ color: "var(--sandesh-coral-accent)" }}>#associates</code> or <code style={{ color: "var(--sandesh-coral-accent)" }}>#contacts</code>
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
