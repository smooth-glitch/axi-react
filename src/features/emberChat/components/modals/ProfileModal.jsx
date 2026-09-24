import { useState } from "react";
import Avatar from "../Avatar.jsx";
import { statusPresets } from "../../data/sampleData.js";

export default function ProfileModal({ me, onCancel, onSave }) {
  const [status, setStatus] = useState(me.status ?? "");

  return (
    <div id="ember-profile-modal" className="sandesh-modal-card-3d" style={{ maxWidth: "440px" }}>
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <div className="new-group-icon-badge" style={{ background: "rgba(255, 122, 89, 0.15)", color: "var(--sandesh-coral-accent)" }}>
            <span className="material-icons">account_circle</span>
          </div>
          <div>
            <h3>Your Profile</h3>
            <span className="modal-subtitle">Custom status and avatar appearance</span>
          </div>
        </div>
        <button type="button" className="close-btn-3d" onClick={onCancel} aria-label="Close modal">
          ×
        </button>
      </div>

      <div className="sandesh-modal-body" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div id="ember-profile-avatar-row" style={{ display: "flex", alignItems: "center", gap: "16px", background: "rgba(255,255,255,0.7)", padding: "12px 16px", borderRadius: "14px", border: "1px solid var(--sandesh-glass-border)" }}>
          <Avatar initials={me.initials} color={me.color} className="" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--sandesh-text-main)" }}>{me.name}</div>
            <div style={{ fontSize: "12px", color: "var(--sandesh-text-muted)" }}>{me.designation || me.role}</div>
          </div>
          <label className="sandesh-btn-secondary-3d" id="ember-profile-photo-label" style={{ fontSize: "11px", padding: "6px 12px", cursor: "pointer" }}>
            Photo
            <input type="file" id="ember-profile-photo-input" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" />
          </label>
        </div>

        <div>
          <div className="section-title-wrap" style={{ marginBottom: "8px" }}>
            <span className="section-title">Status Message</span>
          </div>
          <div className="new-group-input-box">
            <span className="material-icons field-icon">edit_note</span>
            <input
              id="ember-profile-status-input"
              type="text"
              className="new-group-input"
              placeholder="What's on your mind?"
              maxLength={80}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            />
          </div>
        </div>

        <div>
          <div className="section-title-wrap" style={{ marginBottom: "8px" }}>
            <span className="section-title">Quick Presets</span>
          </div>
          <div id="ember-profile-status-presets" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {statusPresets.map((p) => (
              <button
                key={p}
                className="status-preset"
                type="button"
                style={{
                  background: status === p ? "rgba(255, 122, 89, 0.15)" : "rgba(255,255,255,0.7)",
                  borderColor: status === p ? "var(--sandesh-coral-accent)" : "rgba(0,0,0,0.06)",
                  color: status === p ? "var(--sandesh-coral-accent)" : "var(--sandesh-text-main)",
                  fontWeight: status === p ? "700" : "500",
                  padding: "6px 12px",
                  borderRadius: "20px",
                  fontSize: "12px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  border: "1px solid"
                }}
                onClick={() => setStatus(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="sandesh-modal-actions new-group-footer">
        <button className="sandesh-btn-secondary-3d" id="ember-profile-cancel-btn" onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="sandesh-btn-primary-3d" id="ember-profile-save-btn" onClick={() => onSave?.({ status })} type="button">
          Save Changes
        </button>
      </div>
    </div>
  );
}
