import { useState } from "react";
import Avatar from "../Avatar.jsx";

export default function NewGroupModal({
  onlineUsers = [],
  availableUsers = [],
  currentUsername = "",
  onCancel,
  onCreate,
}) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const candidateUsers = (availableUsers.length > 0 ? availableUsers : onlineUsers)
    .filter((u) => (u.username || u.id).toLowerCase() !== currentUsername.toLowerCase());

  const filteredUsers = candidateUsers.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      (u.username && u.username.toLowerCase().includes(q)) ||
      (u.designation && u.designation.toLowerCase().includes(q))
    );
  });

  const toggle = (id) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const handleSelectAll = () => {
    if (selected.length === candidateUsers.length) {
      setSelected([]);
    } else {
      setSelected(candidateUsers.map((u) => u.username || u.id));
    }
  };

  const handleCreate = () => {
    const cleanName = name.trim();
    if (!cleanName) {
      setError("Please enter a group subject / name.");
      return;
    }
    if (cleanName.length > 32) {
      setError("Group name must be at most 32 characters.");
      return;
    }
    onCreate?.({ name: cleanName, selected });
  };

  return (
    <div className="sandesh-modal-card-3d sandesh-new-group-modal">
      {/* 1. Glassmorphic Modal Header */}
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <div className="new-group-icon-badge">
            <span className="material-icons">group_add</span>
          </div>
          <div>
            <h3>Create New Group</h3>
            <span className="modal-subtitle">Start a collaborative channel with your team</span>
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

      {/* 2. Glassmorphic Modal Body */}
      <div className="sandesh-modal-body new-group-modal-body">
        {/* Group Name Input Group */}
        <div className="new-group-field">
          <label className="new-group-label">
            <span>Group Name / Subject</span>
            <span className="char-count">{name.length}/32</span>
          </label>
          <div className="new-group-input-box">
            <span className="material-icons field-icon">edit_note</span>
            <input
              type="text"
              className="new-group-input"
              placeholder="e.g. Engineering Core, Sprint Review..."
              maxLength={32}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError("");
              }}
              autoFocus
            />
          </div>
          {error && <div className="new-group-error-msg">{error}</div>}
        </div>

        {/* Participant Selection Section */}
        <div className="new-group-section">
          <div className="new-group-section-header">
            <div className="section-title-wrap">
              <span className="section-title">Select Group Participants</span>
              <span className="selected-pill">{selected.length} selected</span>
            </div>
            {candidateUsers.length > 0 && (
              <button
                type="button"
                className="select-all-btn"
                onClick={handleSelectAll}
              >
                {selected.length === candidateUsers.length ? "Deselect All" : "Select All"}
              </button>
            )}
          </div>

          {/* Quick search input */}
          {candidateUsers.length > 3 && (
            <div className="participant-search-box">
              <span className="material-icons search-icon">search</span>
              <input
                type="text"
                placeholder="Search colleagues..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className="clear-search-btn"
                  onClick={() => setSearch("")}
                >
                  ×
                </button>
              )}
            </div>
          )}

          {/* List of candidates */}
          <div className="new-group-members-list">
            {filteredUsers.length === 0 ? (
              <div className="empty-members-notice">
                <span className="material-icons">people_outline</span>
                <span>No colleagues found</span>
              </div>
            ) : (
              filteredUsers.map((u) => {
                const uId = u.username || u.id;
                const isSelected = selected.includes(uId);
                return (
                  <div
                    key={uId}
                    className={`participant-card ${isSelected ? "selected" : ""}`}
                    onClick={() => toggle(uId)}
                  >
                    <Avatar
                      initials={u.initials || u.name.slice(0, 2).toUpperCase()}
                      color={u.color || "#ff7a59"}
                    />
                    <div className="participant-info">
                      <div className="participant-name-row">
                        <span className="participant-name">{u.name}</span>
                        {u.role === "Enterprise Administrator" && (
                          <span className="role-tag admin">Admin</span>
                        )}
                        {u.role === "HR Operations Host" && (
                          <span className="role-tag hr">HR</span>
                        )}
                      </div>
                      <span className="participant-role">
                        {u.designation || u.role}
                      </span>
                    </div>

                    <div className={`custom-checkbox-3d ${isSelected ? "checked" : ""}`}>
                      {isSelected && (
                        <span className="material-icons check-icon">check</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 3. Footer Action Buttons */}
      <div className="sandesh-modal-actions new-group-footer">
        <button
          type="button"
          className="sandesh-btn-secondary-3d"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="sandesh-btn-primary-3d new-group-create-btn"
          onClick={handleCreate}
        >
          <span className="material-icons">group_add</span>
          <span>Create Group</span>
        </button>
      </div>
    </div>
  );
}

