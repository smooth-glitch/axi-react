import Avatar from "../Avatar.jsx";

export default function UserProfileViewModal({
  user,
  onSendMessage,
  onClose,
}) {
  if (!user) return null;

  const displayName = user.name || user.username || "Colleague";
  const initials = user.initials || displayName.slice(0, 2).toUpperCase();
  const color = user.color || "#34c759";
  const designation = user.designation || user.role || "Enterprise Associate";
  const status = user.status || "Active on Sandesh";

  return (
    <div className="sandesh-modal-card-3d sandesh-user-profile-modal" style={{ maxWidth: "440px" }}>
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <div
            className="new-group-icon-badge"
            style={{
              background: "rgba(255, 122, 89, 0.15)",
              color: "var(--sandesh-coral-accent)",
            }}
          >
            <span className="material-icons">badge</span>
          </div>
          <div>
            <h3>Associate Profile</h3>
            <span className="modal-subtitle">Enterprise directory details &amp; credentials</span>
          </div>
        </div>
        <button
          type="button"
          className="close-btn-3d"
          onClick={onClose}
          aria-label="Close profile modal"
        >
          ×
        </button>
      </div>

      <div className="sandesh-modal-body" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
        {/* User Hero Card */}
        <div className="profile-hero-card">
          <Avatar initials={initials} color={color} className="large-avatar" />
          <div className="profile-hero-text">
            <h4 className="profile-hero-name">{displayName}</h4>
            <span className="profile-hero-handle">@{user.username || displayName.toLowerCase()}</span>
            <div className="profile-role-badge">{designation}</div>
          </div>
        </div>

        {/* Status Line */}
        <div className="profile-detail-card">
          <div className="profile-detail-label">
            <span className="material-icons" style={{ fontSize: "16px", color: "var(--sandesh-coral-accent)" }}>
              chat_bubble_outline
            </span>
            <span>Status Message</span>
          </div>
          <div className="profile-detail-value">{status}</div>
        </div>

        {/* Organization Info */}
        <div className="profile-detail-card">
          <div className="profile-detail-label">
            <span className="material-icons" style={{ fontSize: "16px", color: "#007aff" }}>
              apartment
            </span>
            <span>Enterprise Department</span>
          </div>
          <div className="profile-detail-value">
            {user.department || "Enterprise Associate"} • {user.branch || "Bangalore HQ"}
          </div>
        </div>

        {/* Contact info if present */}
        {(user.email || user.mobile) && (
          <div className="profile-detail-card">
            <div className="profile-detail-label">
              <span className="material-icons" style={{ fontSize: "16px", color: "#34c759" }}>
                contact_mail
              </span>
              <span>Contact Coordinates</span>
            </div>
            <div className="profile-detail-value" style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
              {user.email && <span>✉️ {user.email}</span>}
              {user.mobile && <span>📱 {user.mobile}</span>}
            </div>
          </div>
        )}
      </div>

      <div className="sandesh-modal-actions">
        <button
          type="button"
          className="sandesh-btn-secondary-3d"
          onClick={onClose}
        >
          Close
        </button>
        <button
          type="button"
          className="sandesh-btn-primary-3d"
          onClick={() => {
            onSendMessage?.(user);
            onClose?.();
          }}
        >
          <span className="material-icons" style={{ fontSize: "16px" }}>chat</span>
          <span>Send Direct Message</span>
        </button>
      </div>
    </div>
  );
}
