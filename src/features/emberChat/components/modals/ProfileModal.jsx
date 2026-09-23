import { useState } from "react";
import Avatar from "../Avatar.jsx";
import { statusPresets } from "../../data/sampleData.js";

export default function ProfileModal({ me, onCancel, onSave }) {
  const [status, setStatus] = useState(me.status ?? "");

  return (
    <div id="ember-profile-modal" className="modal">
      <div className="modal-header">Your Profile</div>
      <div className="modal-body">
        <div id="ember-profile-avatar-row">
          <Avatar initials={me.initials} color={me.color} className="" />
          <label className="btn btn-secondary" id="ember-profile-photo-label">
            Change Photo
            <input type="file" id="ember-profile-photo-input" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" />
          </label>
        </div>
        <div className="section-label" style={{ paddingLeft: 0 }}>
          Status
        </div>
        <input
          id="ember-profile-status-input"
          type="text"
          placeholder="What's on your mind?"
          maxLength={80}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        />
        <div id="ember-profile-status-presets">
          {statusPresets.map((p) => (
            <button key={p} className="status-preset" onClick={() => setStatus(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" id="ember-profile-cancel-btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" id="ember-profile-save-btn" onClick={() => onSave?.({ status })}>
          Save
        </button>
      </div>
    </div>
  );
}
