import { useMemo, useState } from "react";
import Avatar from "../Avatar.jsx";

export default function ForwardModal({
  message,
  chats = [],
  onlineUsers = [],
  availableUsers = [],
  currentUsername = "",
  onCancel,
  onForward,
}) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);

  // Compile full list of forward destinations (chats/groups + direct team contacts)
  const candidateDestinations = useMemo(() => {
    const list = [];
    const seenKeys = new Set();

    // 1. Existing Chats & Channels
    chats.forEach((c) => {
      const key = `chat-${c.id}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        list.push({
          id: c.id,
          type: c.isGroup ? "group" : c.isHost ? "host" : "dm",
          name: c.name || (c.username ? `@${c.username}` : c.id),
          username: c.username || (c.id.startsWith("user-") ? c.id.replace(/^user-/, "") : null),
          subtitle: c.isGroup
            ? (c.id === "room-general" ? "Broadcast Channel" : "Team Group")
            : c.isHost
            ? "Department Channel"
            : "Direct Message",
          initials: (c.name || c.id).slice(0, 2).toUpperCase(),
          color: c.color || (c.isGroup ? "#ff7a59" : "#6366f1"),
          isGroup: c.isGroup,
          isHost: c.isHost,
          online: false,
        });
      }
    });

    // 2. Online / Authorized Team Users (if not already listed as a 1:1 chat)
    const pool = availableUsers.length > 0 ? availableUsers : onlineUsers;
    pool.forEach((u) => {
      const uName = (u.username || u.name || u.id || "").toLowerCase();
      if (uName && uName !== (currentUsername || "").toLowerCase()) {
        const directChatId = `user-${uName}`;
        if (!seenKeys.has(`chat-${directChatId}`)) {
          seenKeys.add(`chat-${directChatId}`);
          const isOnline = onlineUsers.some(
            (o) => (typeof o === "string" ? o.toLowerCase() === uName : (o.username || o.id || "").toLowerCase() === uName)
          );
          list.push({
            id: directChatId,
            type: "dm",
            name: u.name || u.username,
            username: u.username || uName,
            subtitle: u.designation || u.department || (isOnline ? "Online" : "Team Member"),
            initials: (u.initials || (u.name || uName).slice(0, 2)).toUpperCase(),
            color: u.color || "#10b981",
            isGroup: false,
            isHost: false,
            online: isOnline,
          });
        }
      }
    });

    return list;
  }, [chats, onlineUsers, availableUsers, currentUsername]);

  const filteredDestinations = useMemo(() => {
    if (!search.trim()) return candidateDestinations;
    const q = search.trim().toLowerCase();
    return candidateDestinations.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.username && d.username.toLowerCase().includes(q)) ||
        d.subtitle.toLowerCase().includes(q)
    );
  }, [candidateDestinations, search]);

  const toggleSelect = (destId) => {
    setSelectedIds((prev) =>
      prev.includes(destId) ? prev.filter((id) => id !== destId) : [...prev, destId]
    );
  };

  const handleForwardSubmit = () => {
    if (selectedIds.length === 0) return;
    const selectedTargets = candidateDestinations.filter((d) => selectedIds.includes(d.id));
    onForward?.(selectedTargets, message);
  };

  // Preview snippet for what's being forwarded
  const previewSnippet = useMemo(() => {
    if (!message) return "";
    if (message.text) return message.text;
    if (message.fileName) return `Attachment: ${message.fileName}`;
    if (message.title) return `Card: ${message.title}`;
    if (message.kind === "audio") return `Voice note (${message.duration || "audio"})`;
    return "Message";
  }, [message]);

  return (
    <div className="sandesh-modal-card-3d sandesh-forward-modal">
      {/* 1. Header */}
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <div className="forward-modal-icon-badge">
            <span className="material-icons" style={{ transform: "scaleX(-1)" }}>
              reply
            </span>
          </div>
          <div>
            <h3>Forward Message</h3>
            <span className="modal-subtitle">Share with teammates or channels</span>
          </div>
        </div>
        <button
          type="button"
          className="close-btn-3d"
          onClick={onCancel}
          aria-label="Close modal"
        >
          ×
        </button>
      </div>

      {/* 2. Body */}
      <div className="sandesh-modal-body forward-modal-body">
        {/* Preview Banner of Message Being Forwarded */}
        {message && (
          <div className="forward-preview-card">
            <div className="forward-preview-accent" />
            <div className="forward-preview-content">
              <span className="forward-preview-from">
                <span className="material-icons" style={{ fontSize: "13px", transform: "scaleX(-1)", verticalAlign: "middle", marginRight: "4px" }}>
                  reply
                </span>
                {message.from || "Original message"}
              </span>
              <p className="forward-preview-text">{previewSnippet}</p>
            </div>
          </div>
        )}

        {/* Search Field */}
        <div className="forward-search-wrapper">
          <span className="material-icons search-icon">search</span>
          <input
            type="text"
            className="forward-search-input"
            placeholder="Search chats, groups, or team members..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {search && (
            <button
              type="button"
              className="clear-search-btn"
              onClick={() => setSearch("")}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {/* Selected Destinations Chips Bar */}
        {selectedIds.length > 0 && (
          <div className="forward-selected-chips-bar">
            <span className="selected-count-label">{selectedIds.length} selected:</span>
            <div className="selected-chips-scroll">
              {selectedIds.map((id) => {
                const target = candidateDestinations.find((d) => d.id === id);
                if (!target) return null;
                return (
                  <span key={id} className="forward-chip-pill">
                    <span className="chip-name">{target.name}</span>
                    <button
                      type="button"
                      className="chip-remove-btn"
                      onClick={() => toggleSelect(id)}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
            <button
              type="button"
              className="forward-clear-all-link"
              onClick={() => setSelectedIds([])}
            >
              Clear
            </button>
          </div>
        )}

        {/* List of Destinations */}
        <div className="forward-destinations-list">
          {filteredDestinations.length === 0 ? (
            <div className="forward-empty-state">
              <span className="material-icons">search_off</span>
              <p>No chats or contacts match &ldquo;{search}&rdquo;</p>
            </div>
          ) : (
            filteredDestinations.map((dest) => {
              const isSelected = selectedIds.includes(dest.id);
              return (
                <div
                  key={dest.id}
                  className={`forward-dest-item ${isSelected ? "selected" : ""}`}
                  onClick={() => toggleSelect(dest.id)}
                  role="checkbox"
                  aria-checked={isSelected}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleSelect(dest.id);
                    }
                  }}
                >
                  <Avatar initials={dest.initials} color={dest.color} />

                  <div className="forward-dest-info">
                    <div className="dest-name-row">
                      <span className="dest-name">{dest.name}</span>
                      {dest.isGroup && (
                        <span className="dest-badge badge-group">Group</span>
                      )}
                      {dest.isHost && (
                        <span className="dest-badge badge-host">Host</span>
                      )}
                      {dest.online && (
                        <span className="dest-badge badge-online">Online</span>
                      )}
                    </div>
                    <span className="dest-subtitle">{dest.subtitle}</span>
                  </div>

                  {/* WhatsApp-style Circular Checkbox */}
                  <div className={`forward-checkbox ${isSelected ? "checked" : ""}`}>
                    {isSelected && <span className="material-icons">check</span>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 3. Actions Footer */}
      <div className="sandesh-modal-actions forward-modal-actions">
        <span className="forward-selection-indicator">
          {selectedIds.length === 0
            ? "Select recipients"
            : `${selectedIds.length} recipient${selectedIds.length > 1 ? "s" : ""} selected`}
        </span>
        <div className="forward-action-buttons">
          <button
            type="button"
            className="btn-secondary-3d"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary-3d forward-confirm-btn"
            disabled={selectedIds.length === 0}
            onClick={handleForwardSubmit}
          >
            <span className="material-icons" style={{ transform: "scaleX(-1)", fontSize: "17px" }}>
              reply
            </span>
            <span>Forward{selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
