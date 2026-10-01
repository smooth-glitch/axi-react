import React, { useState, useEffect, useMemo, useCallback } from "react";
import Avatar from "./Avatar.jsx";
import WorkspaceChatsSlider from "./WorkspaceChatsSlider.jsx";
import WorkspaceNotificationsSlider from "./WorkspaceNotificationsSlider.jsx";
import sandeshLogo from "../../../assets/sandesh-logo.png";
import { smartPromptsByCategory } from "../data/sampleData.js";
import { sandeshApi } from "../../../services/sandeshApi.js";
import { sandeshSocket } from "../../../services/sandeshSocket.js";
import { formatTimeAgo } from "../utils/roleNotifications.js";

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
  onOpenSubmissions,
  pendingApprovalsCount = 0,
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

  // Real Sandesh feed notifications state
  const [notifications, setNotifications] = useState([]);
  const [priorityCounts, setPriorityCounts] = useState({
    high: 0,
    medium: 0,
    low: 0,
    resolved: 0,
    unread: 0,
    total: 0,
  });

  // Re-render relative timestamps ("15m ago") every minute
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  // 1. Load: GET /api/sd/feed (Bearer token) or WS /sd feed.list
  const loadFeed = useCallback(async () => {
    try {
      if (sandeshSocket?.ws?.readyState === WebSocket.OPEN) {
        const res = await sandeshSocket.sd("feed.list");
        if (res.ok && res.data) {
          setNotifications(res.data.notifications || []);
          if (res.data.counts) setPriorityCounts(res.data.counts);
          return;
        }
      }
      if (currentUser?.token) {
        const res = await sandeshApi.getFeed({}, currentUser.token);
        if (res.ok && res.data) {
          setNotifications(res.data.notifications || []);
          if (res.data.counts) setPriorityCounts(res.data.counts);
        }
      }
    } catch (err) {
      console.error("[MyWorkspace] Failed to load notification feed:", err);
    }
  }, [currentUser?.token]);

  // Load after login
  useEffect(() => {
    if (currentUser?.token) {
      loadFeed();
    }
  }, [currentUser?.token, loadFeed]);

  // 2. Keep the list in state & update from live pushes on existing socket.
  // Also reload feed on every socket (re)connect.
  useEffect(() => {
    const unsubscribe = sandeshSocket.subscribe((event) => {
      if (event.type === "status_change" && event.status === "connected") {
        loadFeed();
      } else if (event.type === "sd_event") {
        if (event.event === "feed_item" && event.data?.notification) {
          // Upsert by id (new or changed item)
          const item = event.data.notification;
          setNotifications((prev) => [
            item,
            ...prev.filter((n) => n.id !== item.id),
          ]);
          if (event.data.counts) setPriorityCounts(event.data.counts);
        } else if (event.event === "feed_removed" && event.data?.ids) {
          // Remove those ids
          const ids = event.data.ids;
          setNotifications((prev) => prev.filter((n) => !ids.includes(n.id)));
          if (event.data.counts) setPriorityCounts(event.data.counts);
        } else if (event.event === "feed_changed" && event.data?.ids) {
          // Set read on those ids
          const { ids, read } = event.data;
          setNotifications((prev) =>
            prev.map((n) => (ids.includes(n.id) ? { ...n, read } : n))
          );
          if (event.data.counts) setPriorityCounts(event.data.counts);
        }
      }
    });

    return () => unsubscribe();
  }, [loadFeed]);

  // 3. Handlers wired to WS /sd feed.<action> or REST POST /api/sd/feed/<action>
  // Do not re-fetch: server replies & live pushes carry the fresh state and counts.
  const handleResolve = (id) => {
    if (sandeshSocket?.ws?.readyState === WebSocket.OPEN) {
      sandeshSocket.sd("feed.resolve", { id });
    } else if (currentUser?.token) {
      sandeshApi.feedResolve(id, currentUser.token);
    }
    pushToast?.("Notification marked as Resolved (Green)");
  };

  const handleMarkRead = (notifOrId) => {
    const item = typeof notifOrId === "object" ? notifOrId : notifications.find((n) => n.id === notifOrId);
    if (!item) return;
    const newRead = !item.read;
    if (sandeshSocket?.ws?.readyState === WebSocket.OPEN) {
      sandeshSocket.sd("feed.read", { ids: [item.id], read: newRead });
    } else if (currentUser?.token) {
      sandeshApi.feedRead({ ids: [item.id], read: newRead }, currentUser.token);
    }
  };

  const handleMarkAllRead = () => {
    if (sandeshSocket?.ws?.readyState === WebSocket.OPEN) {
      sandeshSocket.sd("feed.read", { all: true });
    } else if (currentUser?.token) {
      sandeshApi.feedRead({ all: true }, currentUser.token);
    }
    pushToast?.("All notifications marked as read");
  };

  const handleClearResolved = () => {
    if (sandeshSocket?.ws?.readyState === WebSocket.OPEN) {
      sandeshSocket.sd("feed.clear");
    } else if (currentUser?.token) {
      sandeshApi.feedClear(currentUser.token);
    }
    pushToast?.("Cleared resolved notifications");
  };

  const handleDismiss = (id) => {
    if (sandeshSocket?.ws?.readyState === WebSocket.OPEN) {
      sandeshSocket.sd("feed.dismiss", { id });
    } else if (currentUser?.token) {
      sandeshApi.feedDismiss(id, currentUser.token);
    }
    pushToast?.("Notification dismissed");
  };

  const handleAction = (notif) => {
    if (!notif) return;
    if (notif.actionType === "open_chat" && notif.chatId) {
      onSelectChat?.(notif.chatId);
      onOpenChatView?.();
    } else if (notif.actionType === "approvals") {
      onOpenApprovals?.();
    } else if (notif.actionType === "submissions") {
      onOpenSubmissions?.(notif.ref);
    } else if (notif.actionType === "admin_console") {
      onOpenAdminConsole?.();
    } else if (notif.actionType === "smart_prompt" && notif.actionPrompt) {
      const pList =
        smartPromptsByCategory[currentUser?.category || "employee"] ||
        smartPromptsByCategory.employee;
      const found = pList.find((p) => p.id === notif.actionPrompt);
      onOpenSmartPrompts?.(found || { id: notif.actionPrompt, label: "Smart Prompt" });
    } else if (notif.actionType !== "none") {
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
        counts={priorityCounts}
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
                  <h1 className="workspace-heading">
                    {currentUser?.name || currentUser?.username || "My Workspace"}
                  </h1>
                  <span className="workspace-role-pill">
                    {currentUser?.isAdmin ? "ADMIN" : (currentUser?.role || "USER").toUpperCase()}
                  </span>
                </div>
                <div className="workspace-live-status">
                  <span
                    className={`status-dot ${socketStatus === "connected" ? "online" : "offline"}`}
                  />
                  <span>
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
            {(currentUser?.isAdmin || currentUser?.isHost) && (
              <button
                type="button"
                className="workspace-pill-action-btn"
                onClick={onOpenApprovals}
                title={`User Access Approvals ${pendingApprovalsCount > 0 ? `(${pendingApprovalsCount} waiting)` : ""
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
                imageUrl={currentUser?.avatar || currentUser?.imageUrl}
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
                                className={`deck-priority-pill ${isHigh ? "pill-red" : "pill-yellow"
                                  }`}
                              >
                                {isHigh ? "🔴 High Priority" : "🟡 Medium Priority"}
                              </span>
                              <h4 className="deck-card-title">
                                {item.title}
                                {item.count > 1 ? ` (${item.count})` : ""}
                              </h4>
                              <p className="deck-card-desc">{item.message}</p>
                              <span className="deck-card-time">{formatTimeAgo(item.ts, item.time)}</span>
                            </div>

                            <div className="deck-card-right">
                              {item.actionType !== "none" && item.actionLabel && (
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
                          imageUrl={c.avatar || c.imageUrl}
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
