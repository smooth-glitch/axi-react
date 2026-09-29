import React, { useState, useEffect, useMemo } from "react";
import Avatar from "./Avatar.jsx";
import WorkspaceChatsSlider from "./WorkspaceChatsSlider.jsx";
import WorkspaceNotificationsSlider from "./WorkspaceNotificationsSlider.jsx";
import sandeshLogo from "../../../assets/sandesh-logo.png";
import { smartPromptsByCategory } from "../data/sampleData.js";

/**
 * Generate role-tailored notifications with explicit priority classifications:
 * - High Priority = Red
 * - Medium Priority = Yellow
 * - Low Priority = Grey
 * - Resolved = Green
 */
function buildInitialRoleNotifications(currentUser, approvals = [], serverNotifs = []) {
  const role = (currentUser?.role || "User").toLowerCase();
  const isAdmin = currentUser?.isAdmin || role === "admin";
  const category = (currentUser?.category || "employee").toLowerCase();

  const list = [];

  // 1. Backend Approvals (for Admin or Department Hosts)
  if (approvals && approvals.length > 0) {
    approvals.forEach((req) => {
      const isPending = req.status === "pending";
      list.push({
        id: `appr-${req.id}`,
        priority: isPending ? "high" : "resolved",
        category: "approvals",
        title: req.title || `Access Request: @${req.name || req.username}`,
        message:
          req.details ||
          `${req.name || req.username} requested ${req.type} access. Immediate approval needed.`,
        time: req.time || "Recently",
        icon: isPending ? "how_to_reg" : "verified_user",
        read: !isPending,
        actionType: "approvals",
        actionLabel: isPending ? "Review Approval" : "View Record",
        data: req,
      });
    });
  }

  // 2. Server notifications from WebSocket / push
  if (serverNotifs && serverNotifs.length > 0) {
    serverNotifs.forEach((sn) => {
      let priority = "low";
      if (sn.priority) {
        priority = sn.priority.toLowerCase();
      } else if (
        sn.category === "approvals" ||
        sn.title?.toLowerCase().includes("urgent") ||
        sn.title?.toLowerCase().includes("critical")
      ) {
        priority = "high";
      } else if (
        sn.category === "reminders" ||
        sn.title?.toLowerCase().includes("pending") ||
        sn.title?.toLowerCase().includes("schedule")
      ) {
        priority = "medium";
      }

      list.push({
        id: `srv-${sn.id || Math.random()}`,
        priority,
        category: sn.category || "system",
        title: sn.title || "System Notice",
        message: sn.text || sn.message || "",
        time: sn.time || "Just now",
        icon:
          sn.icon ||
          (priority === "high"
            ? "error_outline"
            : priority === "medium"
            ? "warning_amber"
            : "info"),
        read: !!sn.read,
        data: sn,
      });
    });
  }

  // 3. Role-specific preset notifications based on user role & category
  if (isAdmin) {
    list.push(
      {
        id: "notif-adm-high-1",
        priority: "high",
        category: "security",
        title: "2FA Policy Compliance Audit",
        message: "3 administrative accounts require Two-Factor Authentication activation before next billing cycle.",
        time: "15m ago",
        icon: "security",
        read: false,
        actionType: "admin_console",
        actionLabel: "Security Setup",
      },
      {
        id: "notif-adm-high-2",
        priority: "high",
        category: "system",
        title: "Erlang Node Live Sync Verification",
        message: "Erlang OTP backend active on ws://localhost:8080. Live socket sync enabled.",
        time: "25m ago",
        icon: "sync_alt",
        read: false,
        actionType: "system_status",
        actionLabel: "Check Status",
      },
      {
        id: "notif-adm-med-1",
        priority: "medium",
        category: "operations",
        title: "Department Quota Utilization",
        message: "Engineering & Architecture department reached 85% of assigned data bin quota.",
        time: "1h ago",
        icon: "storage",
        read: false,
        actionType: "admin_console",
        actionLabel: "Inspect Quotas",
      },
      {
        id: "notif-adm-med-2",
        priority: "medium",
        category: "system",
        title: "Scheduled Database Backup",
        message: "Nightly automated snapshot scheduled for 02:00 UTC. No downtime expected.",
        time: "2h ago",
        icon: "backup",
        read: true,
        actionType: "backup_view",
        actionLabel: "View Schedule",
      },
      {
        id: "notif-adm-low-1",
        priority: "low",
        category: "broadcast",
        title: "Enterprise Broadcast Channel Active",
        message: "Broadcast channel #room-general has active streams and all hosts initialized.",
        time: "3h ago",
        icon: "campaign",
        read: true,
        actionType: "open_chat",
        actionLabel: "Open Channel",
        chatId: "room-general",
      },
      {
        id: "notif-adm-res-1",
        priority: "resolved",
        category: "approvals",
        title: "User Role Assignment Completed",
        message: "Senior Solutions Consultant role permissions synchronized across all branches.",
        time: "Yesterday",
        icon: "check_circle",
        read: true,
        actionType: "admin_console",
        actionLabel: "Audit Log",
      },
      {
        id: "notif-adm-res-2",
        priority: "resolved",
        category: "security",
        title: "SSL / TLS Certificate Renewed",
        message: "Enterprise SSL certificates successfully validated with 365 days validity.",
        time: "2 days ago",
        icon: "verified",
        read: true,
      }
    );
  } else if (category === "healthcare") {
    list.push(
      {
        id: "notif-hc-high-1",
        priority: "high",
        category: "vitals",
        title: "Critical Vitals Alert - Bed #04",
        message: "Patient BP elevated (158/98 mmHg) and heart rate fluctuating. Attending review requested.",
        time: "10m ago",
        icon: "monitor_heart",
        read: false,
        actionType: "smart_prompt",
        actionPrompt: "record_vitals",
        actionLabel: "Record Vitals",
      },
      {
        id: "notif-hc-med-1",
        priority: "medium",
        category: "appointments",
        title: "Upcoming Consultation at 03:30 PM",
        message: "Specialist consultation scheduled with Dr. Arjun in OPD Wing B.",
        time: "45m ago",
        icon: "calendar_month",
        read: false,
        actionType: "smart_prompt",
        actionPrompt: "book_appt",
        actionLabel: "View Schedule",
      },
      {
        id: "notif-hc-low-1",
        priority: "low",
        category: "lab",
        title: "Pathology Routine Panel Published",
        message: "Standard metabolic results published for review in medical records.",
        time: "2h ago",
        icon: "biotech",
        read: true,
        actionType: "smart_prompt",
        actionPrompt: "lab_reports",
        actionLabel: "Check Report",
      },
      {
        id: "notif-hc-res-1",
        priority: "resolved",
        category: "pharmacy",
        title: "Prescription Dispensed Successfully",
        message: "Hospital pharmacy issued e-prescription medication batch #RX-9920.",
        time: "Yesterday",
        icon: "medication",
        read: true,
      }
    );
  } else {
    // Default Enterprise Employee
    list.push(
      {
        id: "notif-emp-high-1",
        priority: "high",
        category: "action",
        title: "Project Milestone Sign-off Due",
        message: "Quarterly sprint documentation requires your sign-off before 05:00 PM today.",
        time: "20m ago",
        icon: "assignment_late",
        read: false,
        actionType: "smart_prompt",
        actionPrompt: "raise_ticket",
        actionLabel: "Review Task",
      },
      {
        id: "notif-emp-high-2",
        priority: "high",
        category: "attendance",
        title: "Punch-In Checkpoint Reminder",
        message: "Morning attendance checkpoint is pending confirmation for your workstation.",
        time: "35m ago",
        icon: "fingerprint",
        read: false,
        actionType: "smart_prompt",
        actionPrompt: "punch_in",
        actionLabel: "Punch In Now",
      },
      {
        id: "notif-emp-med-1",
        priority: "medium",
        category: "payroll",
        title: "Monthly Payslip Generated",
        message: "Your monthly salary statement has been computed and is ready for download.",
        time: "1h ago",
        icon: "receipt_long",
        read: false,
        actionType: "smart_prompt",
        actionPrompt: "pay_slip",
        actionLabel: "View Payslip",
      },
      {
        id: "notif-emp-med-2",
        priority: "medium",
        category: "claims",
        title: "Expense Claim #EXP-4109 Under Review",
        message: "Client travel reimbursement claim has been forwarded to Corporate Finance Desk.",
        time: "2h ago",
        icon: "payments",
        read: false,
        actionType: "smart_prompt",
        actionPrompt: "expense_claim",
        actionLabel: "Inspect Claim",
      },
      {
        id: "notif-emp-low-1",
        priority: "low",
        category: "associates",
        title: "New Team Associate Connected",
        message: "Arjun connected with you. You can now exchange direct messages and share notes.",
        time: "4h ago",
        icon: "person_pin",
        read: true,
        actionType: "open_chat",
        actionLabel: "Say Hello",
        chatId: "user-arjun",
      },
      {
        id: "notif-emp-low-2",
        priority: "low",
        category: "system",
        title: "Sandesh Enterprise Version Live",
        message: "Workspace connected to live Erlang backend with real-time WebSocket protocol.",
        time: "Today",
        icon: "info",
        read: true,
      },
      {
        id: "notif-emp-res-1",
        priority: "resolved",
        category: "leave",
        title: "Privilege Leave Approved",
        message: "Your 2-day leave application was approved by Department Head.",
        time: "Yesterday",
        icon: "event_available",
        read: true,
      },
      {
        id: "notif-emp-res-2",
        priority: "resolved",
        category: "support",
        title: "IT Support Ticket #T-882 Resolved",
        message: "VPN connection certificate updated and verified by Enterprise IT team.",
        time: "2 days ago",
        icon: "task_alt",
        read: true,
      }
    );
  }

  return list;
}

export default function MyWorkspace({
  currentUser,
  chats = [],
  onlineUsers = [],
  activeChatId,
  onSelectChat,
  onOpenChatView,
  onOpenSmartPrompts,
  onOpenAdminConsole,
  onOpenAiChat,
  onOpenApprovals,
  pendingApprovalsCount = 0,
  approvals = [],
  serverNotifications = [],
  socketStatus,
  onReconnectSocket,
  onSignOut,
  onNewGroup,
  cards = [],
  onAddReminder,
  pushToast,
}) {
  // Sliders visibility state
  const [leftSliderOpen, setLeftSliderOpen] = useState(false);
  const [rightSliderOpen, setRightSliderOpen] = useState(false);

  // Notifications state
  const [notifications, setNotifications] = useState(() =>
    buildInitialRoleNotifications(currentUser, approvals, serverNotifications)
  );

  // Sync with incoming backend approvals or server notifications
  useEffect(() => {
    setNotifications((prev) => {
      const generated = buildInitialRoleNotifications(currentUser, approvals, serverNotifications);
      // Keep resolved statuses that user manually changed
      const resolvedIds = new Set(
        prev.filter((n) => n.priority === "resolved").map((n) => n.id)
      );
      const readIds = new Set(prev.filter((n) => n.read).map((n) => n.id));

      return generated.map((item) => ({
        ...item,
        priority: resolvedIds.has(item.id) ? "resolved" : item.priority,
        read: readIds.has(item.id) ? true : item.read,
      }));
    });
  }, [approvals, serverNotifications, currentUser]);

  // Priority count summary
  const priorityCounts = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0, resolved: 0, unread: 0 };
    notifications.forEach((n) => {
      const p = (n.priority || "low").toLowerCase();
      if (p === "high") counts.high += 1;
      else if (p === "medium") counts.medium += 1;
      else if (p === "resolved") counts.resolved += 1;
      else counts.low += 1;

      if (!n.read) counts.unread += 1;
    });
    return counts;
  }, [notifications]);

  // Handle resolving a notification (turns to green resolved!)
  const handleResolve = (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, priority: "resolved", read: true } : n))
    );
    pushToast?.("Notification marked as Resolved (Green)");
  };

  // Handle mark read/unread
  const handleMarkRead = (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: !n.read } : n))
    );
  };

  // Handle mark all read
  const handleMarkAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    pushToast?.("All notifications marked as read");
  };

  // Handle clear resolved
  const handleClearResolved = () => {
    setNotifications((prev) => prev.filter((n) => n.priority !== "resolved"));
    pushToast?.("Cleared resolved notifications");
  };

  // Handle dismiss single
  const handleDismiss = (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    pushToast?.("Notification dismissed");
  };

  // Handle notification action
  const handleAction = (notif) => {
    if (notif.actionType === "approvals") {
      onOpenApprovals?.();
    } else if (notif.actionType === "admin_console") {
      onOpenAdminConsole?.();
    } else if (notif.actionType === "open_chat" && notif.chatId) {
      onSelectChat?.(notif.chatId);
      onOpenChatView?.();
    } else if (notif.actionType === "smart_prompt" && notif.actionPrompt) {
      const pList =
        smartPromptsByCategory[currentUser?.category || "employee"] ||
        smartPromptsByCategory.employee;
      const found = pList.find((p) => p.id === notif.actionPrompt);
      onOpenSmartPrompts?.(found || { id: notif.actionPrompt, label: "Smart Prompt" });
    } else {
      pushToast?.(`Action for ${notif.title}`);
    }
  };

  // User's smart prompts based on category
  const userCategory = currentUser?.category || "employee";
  const userPrompts =
    smartPromptsByCategory[userCategory] || smartPromptsByCategory.employee || [];

  // Top action stream items for the dashboard (high & medium priority)
  const dashboardActionItems = useMemo(() => {
    return notifications
      .filter((n) => n.priority === "high" || n.priority === "medium")
      .slice(0, 4);
  }, [notifications]);

  // Local quick reminder state
  const [quickReminderText, setQuickReminderText] = useState("");
  const handleCreateReminder = (e) => {
    e.preventDefault();
    if (!quickReminderText.trim()) return;
    onAddReminder?.(quickReminderText.trim());
    setQuickReminderText("");
  };

  return (
    <div className="sandesh-workspace-fullscreen">
      {/* 1. Left Chats Slider Drawer */}
      <WorkspaceChatsSlider
        isOpen={leftSliderOpen}
        onClose={() => setLeftSliderOpen(false)}
        me={currentUser}
        chats={chats}
        onlineUsers={onlineUsers}
        activeChatId={activeChatId}
        onSelectChat={onSelectChat}
        onOpenFullChat={(chatId) => {
          onSelectChat?.(chatId);
          onOpenChatView?.();
        }}
        onNewGroup={onNewGroup}
        socketStatus={socketStatus}
        onReconnectSocket={onReconnectSocket}
      />

      {/* 2. Right Notifications Slider Drawer (Color Coded: Red, Yellow, Grey, Green) */}
      <WorkspaceNotificationsSlider
        isOpen={rightSliderOpen}
        onClose={() => setRightSliderOpen(false)}
        notifications={notifications}
        onResolve={handleResolve}
        onMarkRead={handleMarkRead}
        onMarkAllRead={handleMarkAllRead}
        onClearResolved={handleClearResolved}
        onDismiss={handleDismiss}
        onAction={handleAction}
        user={currentUser}
      />

      {/* Slider Backdrop Overlay for Mobile / Compact Views */}
      {(leftSliderOpen || rightSliderOpen) && (
        <div
          className="workspace-slider-backdrop"
          onClick={() => {
            setLeftSliderOpen(false);
            setRightSliderOpen(false);
          }}
        />
      )}

      {/* Floating Slider Pull-Tabs on screen edges */}
      {!leftSliderOpen && (
        <button
          type="button"
          className="workspace-slider-edge-tab edge-tab-left"
          onClick={() => setLeftSliderOpen(true)}
          title="Open Chats Slider"
          aria-label="Open chats slider"
        >
          <span className="material-icons">forum</span>
          <span className="edge-tab-label">Chats</span>
        </button>
      )}

      {!rightSliderOpen && (
        <button
          type="button"
          className="workspace-slider-edge-tab edge-tab-right"
          onClick={() => setRightSliderOpen(true)}
          title="Open Priority Notifications Slider"
          aria-label="Open notifications slider"
        >
          <span className="material-icons">notifications</span>
          <span className="edge-tab-label">Notifications</span>
          {priorityCounts.high > 0 && (
            <span className="edge-tab-badge badge-red">{priorityCounts.high}</span>
          )}
          {priorityCounts.high === 0 && priorityCounts.medium > 0 && (
            <span className="edge-tab-badge badge-yellow">{priorityCounts.medium}</span>
          )}
        </button>
      )}

      {/* 3. Main Central Workspace Container (Covers the whole screen) */}
      <div className="workspace-main-layout">
        {/* Workspace Top Bar */}
        <header className="workspace-topbar-3d">
          {/* Left: Chat Slider Toggle & Brand Identity */}
          <div className="workspace-topbar-left">
            <button
              type="button"
              className={`workspace-slider-toggle-btn ${leftSliderOpen ? "is-active" : ""}`}
              onClick={() => setLeftSliderOpen((prev) => !prev)}
              title="Toggle Left Chats Slider"
            >
              <span className="material-icons">menu_open</span>
              <span>Chats ({chats.length})</span>
            </button>

            <div className="workspace-brand-identity">
              <div className="workspace-brand-icon">
                <img src={sandeshLogo} alt="Sandesh" className="sandesh-logo-mark-img" />
              </div>
              <div className="workspace-brand-meta">
                <div className="workspace-title-row">
                  <h1 className="workspace-heading">My Workspace</h1>
                  <span className="workspace-role-pill">
                    {currentUser?.isAdmin ? "ADMIN" : (currentUser?.role || "USER").toUpperCase()}
                  </span>
                </div>
                <div className="workspace-live-status">
                  <span
                    className={`status-dot ${socketStatus === "connected" ? "online" : "offline"}`}
                  />
                  <span>
                    {socketStatus === "connected"
                      ? "Live Sync (Erlang 8080)"
                      : "Connecting..."}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Center: Workspace Navigation Tabs */}
          <div className="workspace-topbar-center">
            <div className="workspace-nav-pill-group">
              <button
                type="button"
                className="workspace-nav-tab is-active"
                title="Current Screen: My Workspace"
              >
                <span className="material-icons">dashboard</span>
                <span>My Workspace</span>
              </button>

              <button
                type="button"
                className="workspace-nav-tab"
                onClick={onOpenChatView}
                title="Switch to Full Team Chat & Channels"
              >
                <span className="material-icons">chat</span>
                <span>Messages / Chat</span>
              </button>

              <button
                type="button"
                className="workspace-nav-tab"
                onClick={() => onOpenSmartPrompts?.()}
                title="Open Smart Prompts"
              >
                <span className="material-icons">bolt</span>
                <span>Smart Prompts</span>
              </button>

              <button
                type="button"
                className="workspace-nav-tab"
                onClick={onOpenAiChat}
                title="Switch to AXI AI Workspace"
              >
                <span className="material-icons">auto_awesome</span>
                <span>AI Workspace</span>
              </button>
            </div>
          </div>

          {/* Right: Notification Slider Trigger & User Actions */}
          <div className="workspace-topbar-right">
            {/* Admin Approvals shortcut if Admin */}
            {currentUser?.isAdmin && (
              <button
                type="button"
                className="workspace-pill-action-btn"
                onClick={onOpenApprovals}
                title={`User Access Approvals ${
                  pendingApprovalsCount > 0 ? `(${pendingApprovalsCount} waiting)` : ""
                }`}
              >
                <span className="material-icons">how_to_reg</span>
                <span>Approvals</span>
                {pendingApprovalsCount > 0 && (
                  <span className="ws-badge-count">{pendingApprovalsCount}</span>
                )}
              </button>
            )}

            {/* Admin Console trigger if Admin */}
            {currentUser?.isAdmin && (
              <button
                type="button"
                className="workspace-icon-btn-3d"
                onClick={onOpenAdminConsole}
                title="Open Sandesh Admin Console"
                aria-label="Admin console"
              >
                <span className="material-icons">admin_panel_settings</span>
              </button>
            )}

            {/* Notifications Slider Toggle Button with Color-Coded Priority Counts */}
            <button
              type="button"
              className={`workspace-notif-slider-btn ${rightSliderOpen ? "is-active" : ""}`}
              onClick={() => setRightSliderOpen((prev) => !prev)}
              title="Toggle Right Priority Notifications Slider"
            >
              <div className="wns-btn-icon-wrap">
                <span className="material-icons">notifications</span>
                {priorityCounts.unread > 0 && <span className="wns-pulse-dot" />}
              </div>
              <span className="wns-btn-label">Notifications</span>

              {/* Priority Color Indicators */}
              <div className="wns-btn-priority-badges">
                {priorityCounts.high > 0 && (
                  <span className="priority-mini-pill pill-red" title="High Priority (Red)">
                    🔴 {priorityCounts.high}
                  </span>
                )}
                {priorityCounts.medium > 0 && (
                  <span className="priority-mini-pill pill-yellow" title="Medium Priority (Yellow)">
                    🟡 {priorityCounts.medium}
                  </span>
                )}
                {priorityCounts.low > 0 && (
                  <span className="priority-mini-pill pill-grey" title="Low Priority (Grey)">
                    ⚪ {priorityCounts.low}
                  </span>
                )}
                {priorityCounts.resolved > 0 && (
                  <span className="priority-mini-pill pill-green" title="Resolved (Green)">
                    🟢 {priorityCounts.resolved}
                  </span>
                )}
              </div>
            </button>

            {/* User Profile Avatar & Sign Out */}
            <div className="workspace-user-profile-widget">
              <Avatar
                initials={currentUser?.initials || "U"}
                color={currentUser?.color || "#ff7a59"}
                size={34}
              />
              <button
                type="button"
                className="workspace-icon-btn-3d signout-btn"
                onClick={onSignOut}
                title="Sign Out of Sandesh"
                aria-label="Sign out"
              >
                <span className="material-icons">logout</span>
              </button>
            </div>
          </div>
        </header>

        {/* Workspace Canvas Scrollable Body */}
        <main className="workspace-body-scrollable">
          <div className="workspace-content-canvas">
            {/* Welcome Banner */}
            <section className="workspace-welcome-card-3d">
              <div className="welcome-card-inner">
                <div className="welcome-text-col">
                  <div className="welcome-badge">
                    <span className="material-icons">verified</span>
                    <span>ENTERPRISE WORKSPACE • ROLE: {(currentUser?.role || "USER").toUpperCase()}</span>
                  </div>
                  <h2 className="welcome-title">
                    Welcome back, {currentUser?.name || "User"}!
                  </h2>
                  <p className="welcome-subtitle">
                    All enterprise streams, live Erlang chat channels, and priority workflow notifications
                    are synchronized and up to date.
                  </p>
                </div>

                <div className="welcome-actions-col">
                  <button
                    type="button"
                    className="ws-hero-btn primary"
                    onClick={() => setRightSliderOpen(true)}
                  >
                    <span className="material-icons">notifications_active</span>
                    <span>Check Notifications ({priorityCounts.unread} Unread)</span>
                  </button>
                  <button
                    type="button"
                    className="ws-hero-btn secondary"
                    onClick={() => {
                      onSelectChat?.("room-general");
                      onOpenChatView?.();
                    }}
                  >
                    <span className="material-icons">chat</span>
                    <span>Open Team Broadcast</span>
                  </button>
                </div>
              </div>
            </section>

            {/* 4 Priority Stat Cards (Red, Yellow, Grey, Green) */}
            <section className="workspace-stats-row">
              {/* High Priority = Red */}
              <div
                className="workspace-stat-card card-red"
                onClick={() => setRightSliderOpen(true)}
                role="button"
                tabIndex={0}
                title="Click to inspect High Priority Red Notifications"
              >
                <div className="stat-card-header">
                  <span className="stat-card-label">High Priority</span>
                  <div className="stat-icon-circle bg-red">
                    <span className="material-icons">error_outline</span>
                  </div>
                </div>
                <div className="stat-card-count text-red">{priorityCounts.high}</div>
                <div className="stat-card-footer">
                  <span className="stat-tag tag-red">🔴 Red Color Code</span>
                  <span className="stat-card-sub">Urgent action needed</span>
                </div>
              </div>

              {/* Medium Priority = Yellow */}
              <div
                className="workspace-stat-card card-yellow"
                onClick={() => setRightSliderOpen(true)}
                role="button"
                tabIndex={0}
                title="Click to inspect Medium Priority Yellow Notifications"
              >
                <div className="stat-card-header">
                  <span className="stat-card-label">Medium Priority</span>
                  <div className="stat-icon-circle bg-yellow">
                    <span className="material-icons">warning_amber</span>
                  </div>
                </div>
                <div className="stat-card-count text-yellow">{priorityCounts.medium}</div>
                <div className="stat-card-footer">
                  <span className="stat-tag tag-yellow">🟡 Yellow Color Code</span>
                  <span className="stat-card-sub">Pending review &amp; tasks</span>
                </div>
              </div>

              {/* Low Priority = Grey */}
              <div
                className="workspace-stat-card card-grey"
                onClick={() => setRightSliderOpen(true)}
                role="button"
                tabIndex={0}
                title="Click to inspect Low Priority Grey Notifications"
              >
                <div className="stat-card-header">
                  <span className="stat-card-label">Low Priority</span>
                  <div className="stat-icon-circle bg-grey">
                    <span className="material-icons">info</span>
                  </div>
                </div>
                <div className="stat-card-count text-grey">{priorityCounts.low}</div>
                <div className="stat-card-footer">
                  <span className="stat-tag tag-grey">⚪ Grey Color Code</span>
                  <span className="stat-card-sub">General stream updates</span>
                </div>
              </div>

              {/* Resolved = Green */}
              <div
                className="workspace-stat-card card-green"
                onClick={() => setRightSliderOpen(true)}
                role="button"
                tabIndex={0}
                title="Click to inspect Resolved Green Notifications"
              >
                <div className="stat-card-header">
                  <span className="stat-card-label">Resolved</span>
                  <div className="stat-icon-circle bg-green">
                    <span className="material-icons">task_alt</span>
                  </div>
                </div>
                <div className="stat-card-count text-green">{priorityCounts.resolved}</div>
                <div className="stat-card-footer">
                  <span className="stat-tag tag-green">🟢 Green Color Code</span>
                  <span className="stat-card-sub">Completed &amp; verified</span>
                </div>
              </div>
            </section>

            {/* Dashboard 2-Column Grid */}
            <div className="workspace-sections-grid">
              {/* Left Column: Workflows, Prompts & Priority Feed */}
              <div className="workspace-column-left">
                {/* Quick Smart Workflows */}
                <section className="workspace-glass-panel">
                  <div className="panel-header">
                    <div className="panel-title-with-icon">
                      <span className="material-icons panel-icon-coral">bolt</span>
                      <div>
                        <h3 className="panel-title">Smart Workflows &amp; Actions</h3>
                        <span className="panel-sub">
                          Role: {currentUser?.category || "Enterprise"} • One-click automated workflows
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="workflow-chips-grid">
                    {userPrompts.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="workflow-chip-card"
                        onClick={() => onOpenSmartPrompts?.(p)}
                      >
                        <div className="chip-icon-box">
                          <span className="material-icons">{p.icon || "receipt"}</span>
                        </div>
                        <div className="chip-info">
                          <span className="chip-label">{p.label}</span>
                          <span className="chip-desc">{p.desc}</span>
                        </div>
                        <span className="material-icons chip-arrow">arrow_forward</span>
                      </button>
                    ))}
                  </div>
                </section>

                {/* Priority Action Deck: Top High & Medium Items */}
                <section className="workspace-glass-panel">
                  <div className="panel-header">
                    <div className="panel-title-with-icon">
                      <span className="material-icons panel-icon-coral">dynamic_feed</span>
                      <div>
                        <h3 className="panel-title">Priority Notifications Queue</h3>
                        <span className="panel-sub">
                          High (Red) &amp; Medium (Yellow) items awaiting action
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="panel-header-link"
                      onClick={() => setRightSliderOpen(true)}
                    >
                      <span>Open Slider</span>
                      <span className="material-icons">chevron_right</span>
                    </button>
                  </div>

                  {dashboardActionItems.length === 0 ? (
                    <div className="panel-empty-state">
                      <span className="material-icons">check_circle</span>
                      <p>All priority tasks and alerts are resolved!</p>
                    </div>
                  ) : (
                    <div className="priority-deck-stack">
                      {dashboardActionItems.map((item) => {
                        const isHigh = item.priority === "high";
                        return (
                          <div
                            key={item.id}
                            className={`deck-card ${isHigh ? "deck-card-red" : "deck-card-yellow"}`}
                          >
                            <div className="deck-card-left">
                              <span
                                className={`deck-priority-pill ${
                                  isHigh ? "pill-red" : "pill-yellow"
                                }`}
                              >
                                {isHigh ? "🔴 High Priority" : "🟡 Medium Priority"}
                              </span>
                              <h4 className="deck-card-title">{item.title}</h4>
                              <p className="deck-card-desc">{item.message}</p>
                              <span className="deck-card-time">{item.time}</span>
                            </div>

                            <div className="deck-card-right">
                              {item.actionLabel && (
                                <button
                                  type="button"
                                  className="deck-action-btn"
                                  onClick={() => handleAction(item)}
                                >
                                  {item.actionLabel}
                                </button>
                              )}
                              <button
                                type="button"
                                className="deck-resolve-btn"
                                onClick={() => handleResolve(item.id)}
                                title="Mark Resolved (Green)"
                              >
                                <span className="material-icons">check</span> Resolve
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>

              {/* Right Column: Live Channels, Online Associates & Personal Notes */}
              <div className="workspace-column-right">
                {/* Active Live Channels & Quick Chats */}
                <section className="workspace-glass-panel">
                  <div className="panel-header">
                    <div className="panel-title-with-icon">
                      <span className="material-icons panel-icon-coral">groups</span>
                      <div>
                        <h3 className="panel-title">Channels &amp; Direct Chats</h3>
                        <span className="panel-sub">
                          {onlineUsers.length} online associates on Sandesh
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="panel-header-link"
                      onClick={() => setLeftSliderOpen(true)}
                    >
                      <span>All Chats</span>
                      <span className="material-icons">chevron_right</span>
                    </button>
                  </div>

                  <div className="quick-chats-list">
                    {chats.slice(0, 4).map((c) => (
                      <div
                        key={c.id}
                        className="quick-chat-item"
                        onClick={() => {
                          onSelectChat?.(c.id);
                          onOpenChatView?.();
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <Avatar
                          initials={c.initials || c.name?.[0]}
                          color={c.color || (c.isHost ? "#ff7a59" : "#ff9472")}
                          group={c.isGroup}
                          size={36}
                        />
                        <div className="quick-chat-info">
                          <span className="quick-chat-name">{c.name}</span>
                          <span className="quick-chat-preview">{c.preview || "Active"}</span>
                        </div>
                        <span className="material-icons quick-chat-arrow">chat</span>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Personal Reminders & Workspace Notes */}
                <section className="workspace-glass-panel">
                  <div className="panel-header">
                    <div className="panel-title-with-icon">
                      <span className="material-icons panel-icon-coral">alarm</span>
                      <div>
                        <h3 className="panel-title">Personal Reminders</h3>
                        <span className="panel-sub">Keep track of your day</span>
                      </div>
                    </div>
                  </div>

                  {/* Add Reminder Form */}
                  <form onSubmit={handleCreateReminder} className="reminder-add-form">
                    <input
                      type="text"
                      placeholder="Add a new reminder…"
                      value={quickReminderText}
                      onChange={(e) => setQuickReminderText(e.target.value)}
                    />
                    <button type="submit" className="reminder-add-btn">
                      <span className="material-icons">add</span>
                    </button>
                  </form>

                  {/* Reminders List */}
                  <div className="reminders-stack">
                    {cards.length === 0 ? (
                      <div className="reminders-empty">
                        <span className="material-icons">alarm_on</span>
                        <p>No personal reminders. Type above to add one.</p>
                      </div>
                    ) : (
                      cards.slice(0, 4).map((card) => (
                        <div key={card.id} className="reminder-item-card">
                          <span className="material-icons reminder-icon">check_box_outline_blank</span>
                          <div className="reminder-text-col">
                            <span className="reminder-title">{card.title || "Reminder"}</span>
                            <span className="reminder-text">{card.text}</span>
                          </div>
                          <span className="reminder-time">{card.time || "Today"}</span>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
