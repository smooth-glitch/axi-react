import { useState } from "react";
import Avatar from "../Avatar.jsx";

export default function InboxModal({
  chats = [],
  onSelectChat,
  onClose,
}) {
  const [search, setSearch] = useState("");

  const directChats = chats.filter((c) => !c.isGroup && !c.isHost && c.id.startsWith("user-"));

  const filteredChats = directChats.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.preview && c.preview.toLowerCase().includes(q))
    );
  });

  return (
    <div className="sandesh-modal-card-3d sandesh-inbox-modal">
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <div
            className="new-group-icon-badge"
            style={{
              background: "rgba(255, 122, 89, 0.15)",
              color: "var(--sandesh-coral-accent)",
            }}
          >
            <span className="material-icons">inbox</span>
          </div>
          <div>
            <h3>Your Inbox Conversations</h3>
            <span className="modal-subtitle">
              Direct message threads, newest communications first
            </span>
          </div>
        </div>
        <button
          type="button"
          className="close-btn-3d"
          onClick={onClose}
          aria-label="Close inbox"
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
            placeholder="Search conversations by colleague name or message preview..."
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
        {filteredChats.length === 0 ? (
          <div className="commands-empty-state">
            <span className="material-icons empty-icon">chat_bubble_outline</span>
            <h4>No conversations found</h4>
            <p>You have no active direct messages matching &ldquo;{search}&rdquo;</p>
          </div>
        ) : (
          <div className="directory-user-list">
            {filteredChats.map((c) => (
              <div
                key={c.id}
                className="directory-user-card inbox-thread-card"
                onClick={() => {
                  onSelectChat?.(c.id);
                  onClose?.();
                }}
              >
                <div className="directory-user-avatar-wrap">
                  <Avatar initials={c.initials || c.name.slice(0, 2).toUpperCase()} color={c.color || "#34c759"} />
                  {c.unread > 0 && <span className="unread-dot-badge" />}
                </div>

                <div className="directory-user-info">
                  <div className="directory-user-name-row">
                    <span className="directory-user-name">{c.name}</span>
                    <span className="inbox-time-tag">{c.time || "recently"}</span>
                  </div>
                  <div className="directory-user-sub">
                    {c.designation || "Enterprise Associate"}
                  </div>
                  <div className="inbox-preview-text">
                    {c.preview || "No message preview"}
                  </div>
                </div>

                <div className="directory-user-actions">
                  {c.unread > 0 ? (
                    <span className="inbox-unread-count-pill">
                      {c.unread} new
                    </span>
                  ) : (
                    <span className="material-icons chevron-icon">chevron_right</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sandesh-modal-actions" style={{ padding: "14px 22px" }}>
        <span style={{ fontSize: "12px", color: "var(--sandesh-text-muted)" }}>
          Command: <code style={{ color: "var(--sandesh-coral-accent)" }}>#inbox</code> or <code style={{ color: "var(--sandesh-coral-accent)" }}>#conversations</code>
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
