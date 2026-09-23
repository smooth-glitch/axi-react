import Avatar from "../Avatar.jsx";

export default function MembersModal({ title = "Members", members, addableUsers, onAdd, onLeave, onClose }) {
  return (
    <div id="ember-members-modal" className="modal">
      <div className="modal-header" id="ember-members-modal-title">
        {title}
      </div>
      <div className="modal-body">
        <ul id="ember-members-list">
          {members.map((m) => (
            <li className="member-row" key={m.id}>
              <Avatar initials={m.initials} color={m.color} />
              <span className="name">{m.name}</span>
            </li>
          ))}
        </ul>
        <div className="add-member-row">
          <select id="ember-add-member-select">
            {addableUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" id="ember-add-member-btn" onClick={onAdd}>
            Add
          </button>
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-danger" id="ember-leave-group-btn" onClick={onLeave}>
          Leave group
        </button>
        <button className="btn btn-secondary" id="ember-members-close-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
