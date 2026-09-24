import { useState } from "react";

export default function NewGroupModal({ onlineUsers = [], onCancel, onCreate }) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState("");

  const toggle = (id) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const handleCreate = () => {
    const cleanName = name.trim();
    if (!cleanName) {
      setError("Please enter a group name.");
      return;
    }
    if (/\s/.test(cleanName)) {
      setError("Group names must not contain spaces.");
      return;
    }
    if (cleanName.length > 32) {
      setError("Group name must be at most 32 characters.");
      return;
    }
    onCreate?.({ name: cleanName, selected });
  };

  return (
    <div id="ember-new-group-modal" className="modal">
      <div className="modal-header">New group</div>
      <div className="modal-body">
        <input
          id="ember-group-name-input"
          type="text"
          placeholder="Group name (no spaces, max 32 chars)"
          maxLength={32}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError("");
          }}
        />
        {error && (
          <div style={{ color: "#ef4444", fontSize: "13px", marginTop: "4px", fontWeight: "500" }}>
            {error}
          </div>
        )}
        <div className="section-label" style={{ paddingLeft: 0, marginTop: "12px" }}>
          Add online associates ({selected.length} selected)
        </div>
        <div id="ember-group-invite-list" style={{ maxHeight: "180px", overflowY: "auto" }}>
          {onlineUsers.length === 0 ? (
            <div style={{ fontSize: "13px", color: "var(--sandesh-text-muted)", padding: "8px 0" }}>
              No other associates currently online
            </div>
          ) : (
            onlineUsers.map((u) => (
              <label className="invite-row" key={u.id} style={{ display: "flex", alignItems: "center", gap: "8px", margin: "6px 0", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={selected.includes(u.username || u.id)}
                  onChange={() => toggle(u.username || u.id)}
                />
                <span className="name">{u.name} (@{u.username || u.id})</span>
              </label>
            ))
          )}
        </div>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" id="ember-group-cancel-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" id="ember-group-create-btn" onClick={handleCreate}>
          Create Group
        </button>
      </div>
    </div>
  );
}
