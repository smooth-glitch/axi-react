import { useState } from "react";

export default function NotificationsModal({
  initialCategory = "all",
  notifications = [],
  onMarkRead,
  onClose,
}) {
  const [activeCategory, setActiveCategory] = useState(initialCategory || "all");

  const filtered = notifications.filter((n) => {
    if (activeCategory === "all") return true;
    return n.category === activeCategory;
  });

  const unreadCount = filtered.filter((n) => !n.read).length;

  return (
    <div className="sandesh-modal-card-3d sandesh-notifications-modal">
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <div
            className="new-group-icon-badge"
            style={{
              background: "rgba(255, 122, 89, 0.15)",
              color: "var(--sandesh-coral-accent)",
            }}
          >
            <span className="material-icons">notifications</span>
          </div>
          <div>
            <h3>Notifications Center</h3>
            <span className="modal-subtitle">
              {unreadCount} unread update{unreadCount === 1 ? "" : "s"} across all streams
            </span>
          </div>
        </div>
        <button
          type="button"
          className="close-btn-3d"
          onClick={onClose}
          aria-label="Close notifications"
        >
          ×
        </button>
      </div>

      {/* Category Pills & Mark Read Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 22px 4px 22px", flexWrap: "wrap", gap: "8px" }}>
        <div className="sandesh-tab-pills-3d" style={{ margin: 0 }}>
          {["all", "approvals", "system", "reminders"].map((cat) => (
            <button
              key={cat}
              type="button"
              className={`sandesh-tab-pill ${activeCategory === cat ? "active" : ""}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="sandesh-btn-mini-ghost"
          style={{ fontSize: "11.5px", padding: "6px 10px" }}
          onClick={() => onMarkRead?.(activeCategory)}
        >
          <span className="material-icons" style={{ fontSize: "15px" }}>done_all</span>
          <span>Mark {activeCategory} Read</span>
        </button>
      </div>

      <div className="sandesh-modal-body" style={{ maxHeight: "420px", padding: "14px 22px" }}>
        {filtered.length === 0 ? (
          <div className="commands-empty-state">
            <span className="material-icons empty-icon">notifications_off</span>
            <h4>No notifications</h4>
            <p>You&apos;re completely caught up on {activeCategory} updates.</p>
          </div>
        ) : (
          <div className="notif-cards-stack">
            {filtered.map((n) => (
              <div key={n.id} className={`notif-entry-card ${!n.read ? "unread" : ""}`}>
                <div className="notif-icon-circle">
                  <span className="material-icons">
                    {n.category === "approvals" ? "how_to_reg" : n.category === "reminders" ? "alarm" : "info"}
                  </span>
                </div>

                <div className="notif-content-col">
                  <div className="notif-title-row">
                    <span className="notif-title">{n.title}</span>
                    <span className="notif-time">{n.time}</span>
                  </div>
                  <p className="notif-body">{n.text || n.message}</p>
                  <span className={`notif-category-tag cat-${n.category}`}>
                    {n.category}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sandesh-modal-actions" style={{ padding: "14px 22px" }}>
        <span style={{ fontSize: "12px", color: "var(--sandesh-text-muted)" }}>
          Command: <code style={{ color: "var(--sandesh-coral-accent)" }}>#notifications [category]</code> or <code style={{ color: "var(--sandesh-coral-accent)" }}>#markread &lt;category&gt;</code>
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
