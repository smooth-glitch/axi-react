import { useState } from "react";
import Avatar from "../Avatar.jsx";

export default function FindPeopleModal({
  initialQuery = "",
  availableUsers = [],
  currentUsername = "",
  associates = [],
  onConnect,
  onSelectUser,
  onClose,
}) {
  const [query, setQuery] = useState(initialQuery);

  const myClean = (currentUsername || "").toLowerCase().trim();
  const qClean = query.trim().toLowerCase();

  const isAssociate = (username) => {
    const clean = (username || "").toLowerCase().trim();
    return associates.some((a) => (a.username || "").toLowerCase().trim() === clean);
  };

  const results = availableUsers.filter((u) => {
    const uName = (u.username || u.name || "").toLowerCase().trim();
    if (uName === myClean) return false;
    if (!qClean) return true;
    return (
      (u.name && u.name.toLowerCase().includes(qClean)) ||
      (u.username && u.username.toLowerCase().includes(qClean)) ||
      (u.email && u.email.toLowerCase().includes(qClean)) ||
      (u.mobile && u.mobile.includes(qClean)) ||
      (u.department && u.department.toLowerCase().includes(qClean))
    );
  });

  return (
    <div className="sandesh-modal-card-3d sandesh-find-modal">
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <div
            className="new-group-icon-badge"
            style={{
              background: "rgba(0, 122, 255, 0.15)",
              color: "#007aff",
            }}
          >
            <span className="material-icons">person_search</span>
          </div>
          <div>
            <h3>Find People &amp; Associates</h3>
            <span className="modal-subtitle">
              Search by colleague name, username, email or mobile number
            </span>
          </div>
        </div>
        <button
          type="button"
          className="close-btn-3d"
          onClick={onClose}
          aria-label="Close find people"
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
            placeholder="Type username, email, phone or name to find..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {query && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setQuery("")}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="sandesh-modal-body" style={{ maxHeight: "420px", padding: "12px 22px" }}>
        {results.length === 0 ? (
          <div className="commands-empty-state">
            <span className="material-icons empty-icon">search_off</span>
            <h4>No one found</h4>
            <p>No user matches search query &ldquo;{query}&rdquo;</p>
          </div>
        ) : (
          <div className="directory-user-list">
            {results.map((u) => {
              const alreadyConnected = isAssociate(u.username);
              return (
                <div key={u.username} className="directory-user-card">
                  <div className="directory-user-avatar-wrap">
                    <Avatar initials={u.initials || u.name?.slice(0, 2).toUpperCase() || "US"} color={u.color || "#007aff"} />
                  </div>

                  <div className="directory-user-info">
                    <div className="directory-user-name-row">
                      <span className="directory-user-name">{u.name}</span>
                      <span className="directory-user-handle">@{u.username}</span>
                      {alreadyConnected && <span className="connected-badge">Connected</span>}
                    </div>
                    <div className="directory-user-sub">
                      {u.designation || "Enterprise Associate"} • {u.department || "Bangalore HQ"}
                    </div>
                    {(u.email || u.mobile) && (
                      <div className="find-user-coordinates">
                        {u.email && <span>{u.email}</span>}
                        {u.mobile && <span>{u.mobile}</span>}
                      </div>
                    )}
                  </div>

                  <div className="directory-user-actions">
                    {alreadyConnected ? (
                      <button
                        type="button"
                        className="sandesh-btn-secondary-3d"
                        style={{ fontSize: "12px", padding: "6px 14px", gap: "6px" }}
                        onClick={() => {
                          onSelectUser?.(u);
                          onClose?.();
                        }}
                      >
                        <span className="material-icons" style={{ fontSize: "16px" }}>chat</span>
                        <span>Chat</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="sandesh-btn-primary-3d"
                        style={{ fontSize: "12px", padding: "6px 14px", gap: "6px" }}
                        onClick={() => {
                          onConnect?.(u.username);
                        }}
                      >
                        <span className="material-icons" style={{ fontSize: "16px" }}>person_add</span>
                        <span>Connect</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="sandesh-modal-actions" style={{ padding: "14px 22px" }}>
        <span style={{ fontSize: "12px", color: "var(--sandesh-text-muted)" }}>
          Command: <code style={{ color: "var(--sandesh-coral-accent)" }}>#find &lt;query&gt;</code> or <code style={{ color: "var(--sandesh-coral-accent)" }}>#connect &lt;user&gt;</code>
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
