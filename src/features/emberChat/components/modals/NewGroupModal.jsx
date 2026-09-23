import { useState } from "react";

export default function NewGroupModal({ onlineUsers, onCancel, onCreate }) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState([]);

  const toggle = (id) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  return (
    <div id="ember-new-group-modal" className="modal">
      <div className="modal-header">New group</div>
      <div className="modal-body">
        <input
          id="ember-group-name-input"
          type="text"
          placeholder="Group name"
          maxLength={32}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="section-label" style={{ paddingLeft: 0 }}>
          Add online users
        </div>
        <div id="ember-group-invite-list">
          {onlineUsers.map((u) => (
            <label className="invite-row" key={u.id}>
              <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
              <span className="name">{u.name}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" id="ember-group-cancel-btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" id="ember-group-create-btn" onClick={() => onCreate?.({ name, selected })}>
          Create
        </button>
      </div>
    </div>
  );
}
