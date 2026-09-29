import React, { useState, useMemo } from "react";

/**
 * WorkspaceNotificationsSlider
 * 
 * Right-hand slide-out drawer exclusively for "My Workspace".
 * Categorizes and color-codes all notifications by priority:
 *   - High Priority = Red (#ef4444)
 *   - Medium Priority = Yellow (#f59e0b)
 *   - Low Priority = Grey (#64748b)
 *   - Resolved = Green (#10b981)
 * 
 * Works for all users based on their roles.
 */
export default function WorkspaceNotificationsSlider({
  isOpen,
  onClose,
  notifications = [],
  onResolve,
  onMarkRead,
  onMarkAllRead,
  onClearResolved,
  onDismiss,
  onAction,
  user,
}) {
  const [priorityFilter, setPriorityFilter] = useState("all"); // "all" | "high" | "medium" | "low" | "resolved"

  // Counts for each priority
  const counts = useMemo(() => {
    const res = {
      all: notifications.length,
      high: 0,
      medium: 0,
      low: 0,
      resolved: 0,
      unread: 0,
    };
    notifications.forEach((n) => {
      const p = (n.priority || "low").toLowerCase();
      if (p === "high") res.high += 1;
      else if (p === "medium") res.medium += 1;
      else if (p === "resolved") res.resolved += 1;
      else res.low += 1;

      if (!n.read) res.unread += 1;
    });
    return res;
  }, [notifications]);

  // Filtered notifications
  const filteredNotifs = useMemo(() => {
    if (priorityFilter === "all") return notifications;
    return notifications.filter((n) => {
      const p = (n.priority || "low").toLowerCase();
      return p === priorityFilter;
    });
  }, [notifications, priorityFilter]);

  // Color config helper
  const getPriorityConfig = (priority) => {
    switch (priority) {
      case "high":
        return {
          label: "High Priority",
          color: "#ef4444",
          badgeClass: "badge-high-red",
          cardClass: "card-priority-high",
          icon: "error_outline",
          desc: "Urgent Action Required",
        };
      case "medium":
        return {
          label: "Medium Priority",
          color: "#f59e0b",
          badgeClass: "badge-med-yellow",
          cardClass: "card-priority-med",
          icon: "warning_amber",
          desc: "Pending Review & Action",
        };
      case "resolved":
        return {
          label: "Resolved",
          color: "#10b981",
          badgeClass: "badge-res-green",
          cardClass: "card-priority-resolved",
          icon: "check_circle",
          desc: "Completed & Verified",
        };
      case "low":
      default:
        return {
          label: "Low Priority",
          color: "#64748b",
          badgeClass: "badge-low-grey",
          cardClass: "card-priority-low",
          icon: "info",
          desc: "General Info & Updates",
        };
    }
  };

  return (
    <aside
      id="workspace-notifications-slider"
      className={`workspace-notifications-slider-3d ${isOpen ? "open" : ""}`}
      aria-label="Workspace Priority Notifications"
    >
      {/* Slider Header */}
      <div className="wns-header">
        <div className="wns-title-group">
          <div className="wns-icon-badge">
            <span className="material-icons">notifications_active</span>
            {counts.unread > 0 && <span className="wns-pulse-dot" />}
          </div>
          <div>
            <h3 className="wns-heading">Notifications Center</h3>
            <span className="wns-sub">
              {user?.role ? `${user.role} Workspace` : "My Workspace"} • {counts.unread} unread
            </span>
          </div>
        </div>
        <button
          type="button"
          className="wns-close-btn"
          onClick={onClose}
          title="Close Notifications Slider"
          aria-label="Close notifications slider"
        >
          <span className="material-icons">chevron_right</span>
        </button>
      </div>

      {/* Priority Legend & Quick Action Bar */}
      <div className="wns-actions-bar">
        <span className="wns-legend-hint">Priority Color Codes:</span>
        <div className="wns-quick-actions">
          {counts.unread > 0 && (
            <button
              type="button"
              className="wns-btn-text"
              onClick={onMarkAllRead}
              title="Mark all notifications as read"
            >
              <span className="material-icons">done_all</span> Mark All Read
            </button>
          )}
          {counts.resolved > 0 && (
            <button
              type="button"
              className="wns-btn-text text-danger"
              onClick={onClearResolved}
              title="Clear all resolved notifications"
            >
              <span className="material-icons">cleaning_services</span> Clear Resolved
            </button>
          )}
        </div>
      </div>

      {/* Priority Tabs with Exact Color Codes */}
      <div className="wns-priority-tabs-scroll">
        <div className="wns-priority-tabs">
          {/* All */}
          <button
            type="button"
            className={`wns-tab-pill ${priorityFilter === "all" ? "active" : ""}`}
            onClick={() => setPriorityFilter("all")}
          >
            <span>All</span>
            <span className="wns-pill-count">{counts.all}</span>
          </button>

          {/* High Priority = Red */}
          <button
            type="button"
            className={`wns-tab-pill pill-red ${priorityFilter === "high" ? "active" : ""}`}
            onClick={() => setPriorityFilter("high")}
            title="High Priority = Red Color Notifications"
          >
            <span className="wns-color-dot dot-red" />
            <span>High</span>
            <span className="wns-pill-count count-red">{counts.high}</span>
          </button>

          {/* Medium Priority = Yellow */}
          <button
            type="button"
            className={`wns-tab-pill pill-yellow ${priorityFilter === "medium" ? "active" : ""}`}
            onClick={() => setPriorityFilter("medium")}
            title="Medium Priority = Yellow Color Notifications"
          >
            <span className="wns-color-dot dot-yellow" />
            <span>Medium</span>
            <span className="wns-pill-count count-yellow">{counts.medium}</span>
          </button>

          {/* Low Priority = Grey */}
          <button
            type="button"
            className={`wns-tab-pill pill-grey ${priorityFilter === "low" ? "active" : ""}`}
            onClick={() => setPriorityFilter("low")}
            title="Low Priority = Grey Color Notifications"
          >
            <span className="wns-color-dot dot-grey" />
            <span>Low</span>
            <span className="wns-pill-count count-grey">{counts.low}</span>
          </button>

          {/* Resolved = Green */}
          <button
            type="button"
            className={`wns-tab-pill pill-green ${priorityFilter === "resolved" ? "active" : ""}`}
            onClick={() => setPriorityFilter("resolved")}
            title="Resolved = Green Color Notifications"
          >
            <span className="wns-color-dot dot-green" />
            <span>Resolved</span>
            <span className="wns-pill-count count-green">{counts.resolved}</span>
          </button>
        </div>
      </div>

      {/* Notifications List */}
      <div className="wns-cards-container">
        {filteredNotifs.length === 0 ? (
          <div className="wns-empty-state">
            <span className="material-icons empty-icon">
              {priorityFilter === "resolved" ? "task_alt" : "notifications_off"}
            </span>
            <h4>No {priorityFilter === "all" ? "" : priorityFilter} notifications</h4>
            <p>
              {priorityFilter === "resolved"
                ? "No resolved tasks to display."
                : "You are completely caught up on this priority stream."}
            </p>
          </div>
        ) : (
          <div className="wns-cards-stack">
            {filteredNotifs.map((n) => {
              const priority = (n.priority || "low").toLowerCase();
              const cfg = getPriorityConfig(priority);

              return (
                <div
                  key={n.id}
                  className={`wns-notification-card ${cfg.cardClass} ${!n.read ? "is-unread" : ""}`}
                >
                  {/* Card Header: Color-coded priority pill + Time */}
                  <div className="wns-card-top">
                    <span className={`wns-priority-badge ${cfg.badgeClass}`}>
                      <span className="wns-badge-dot" />
                      {cfg.label}
                    </span>
                    <span className="wns-card-time">{n.time || "Just now"}</span>
                  </div>

                  {/* Card Content Row */}
                  <div className="wns-card-body-row">
                    <div className="wns-card-icon-wrap" style={{ color: cfg.color }}>
                      <span className="material-icons">{n.icon || cfg.icon}</span>
                    </div>

                    <div className="wns-card-text-col">
                      <h4 className="wns-card-title">{n.title}</h4>
                      <p className="wns-card-desc">{n.message || n.text}</p>
                    </div>
                  </div>

                  {/* Card Footer Actions */}
                  <div className="wns-card-footer">
                    <div className="wns-footer-left">
                      {/* Optional Context Action (e.g. Review, Open Chat, View Slip) */}
                      {n.actionLabel && (
                        <button
                          type="button"
                          className="wns-action-btn"
                          onClick={() => onAction?.(n)}
                        >
                          <span className="material-icons">arrow_forward</span>
                          <span>{n.actionLabel}</span>
                        </button>
                      )}

                      {/* Resolve Action (Turn into green resolved) */}
                      {priority !== "resolved" && (
                        <button
                          type="button"
                          className="wns-resolve-btn"
                          onClick={() => onResolve?.(n.id)}
                          title="Mark as Resolved (Green)"
                        >
                          <span className="material-icons">check</span>
                          <span>Resolve</span>
                        </button>
                      )}
                    </div>

                    <div className="wns-footer-right">
                      {/* Mark Read/Unread */}
                      <button
                        type="button"
                        className="wns-icon-action-btn"
                        onClick={() => onMarkRead?.(n.id)}
                        title={n.read ? "Mark unread" : "Mark as read"}
                      >
                        <span className="material-icons">
                          {n.read ? "drafts" : "mark_email_read"}
                        </span>
                      </button>

                      {/* Dismiss */}
                      <button
                        type="button"
                        className="wns-icon-action-btn danger"
                        onClick={() => onDismiss?.(n.id)}
                        title="Dismiss notification"
                      >
                        <span className="material-icons">close</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Slider Footer Info */}
      <div className="wns-footer-info">
        <div className="wns-info-row">
          <span className="wns-dot dot-red" /> High: Urgent
          <span className="wns-dot dot-yellow" style={{ marginLeft: 8 }} /> Med: Action
          <span className="wns-dot dot-grey" style={{ marginLeft: 8 }} /> Low: Info
          <span className="wns-dot dot-green" style={{ marginLeft: 8 }} /> Resolved: Done
        </div>
      </div>
    </aside>
  );
}
