import { useState, useMemo } from "react";
import Avatar from "./Avatar.jsx";
import sandeshLogo from "../../../assets/sandesh-logo.png";

export default function Sidebar({
  me,
  chats,
  onlineUsers,
  activeChatId,
  isOpen,
  onSelectChat,
  onSelectOnlineUser,
  onEditProfile,
  onClose,
  onNewGroup,
  onOpenAiChat,
  onOpenAdminConsole,
  onOpenCommandsHelp,
  onOpenWorkspace,
  onSignOut,
  socketStatus,
  onReconnectSocket,
  onDeleteChat,
  onOpenApprovals,
  pendingApprovalsCount = 0,
}) {
  const [categoryFilter, setCategoryFilter] = useState("all"); // "all" | "hosts" | "direct"
  const [searchTerm, setSearchTerm] = useState("");

  // Determine if a chat or associate is online
  const isChatOnline = (chat) => {
    if (chat.isGroup) return false;
    if (chat.isOnline) return true;
    const target = (
      chat.username ||
      (chat.id?.startsWith("user-") ? chat.id.replace(/^user-/, "") : "") ||
      chat.name ||
      ""
    ).toLowerCase().trim();

    return (onlineUsers || []).some((u) => {
      const uUsername = (u.username || "").toLowerCase().trim();
      const uName = (u.name || "").toLowerCase().trim();
      const uId = (u.id || "").toLowerCase().trim();
      return (
        (uUsername && uUsername === target) ||
        (uName && uName === target) ||
        (uId && uId === target) ||
        (chat.name && uName === chat.name.toLowerCase().trim())
      );
    });
  };

  // Combine existing chats with any online associates not yet in chat list
  const allConversations = useMemo(() => {
    const list = [...(chats || [])];
    (onlineUsers || []).forEach((user) => {
      const uUsername = (user.username || user.id || user.name || "").toLowerCase().trim();
      const alreadyHasChat = list.some((c) => {
        const cTarget = (
          c.username ||
          (c.id?.startsWith("user-") ? c.id.replace(/^user-/, "") : "") ||
          c.name ||
          ""
        ).toLowerCase().trim();
        return cTarget === uUsername || c.id === `user-${uUsername}`;
      });

      if (!alreadyHasChat && uUsername) {
        list.push({
          id: `user-${uUsername}`,
          username: uUsername,
          name: user.name || uUsername,
          isGroup: false,
          category: "direct",
          designation: user.status || "Active Associate",
          preview: user.status || "Online on Sandesh",
          time: "now",
          unread: 0,
          initials: user.initials || (user.name || uUsername).slice(0, 2).toUpperCase(),
          color: user.color || "#34c759",
          isOnline: true,
          originalUser: user,
        });
      }
    });
    return list;
  }, [chats, onlineUsers]);

  const filteredChats = allConversations.filter((c) => {
    // Exclude General Broadcast from conversation list
    if (c.id === "room-general" || c.name === "General Broadcast") {
      return false;
    }

    const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.preview && c.preview.toLowerCase().includes(searchTerm.toLowerCase()));
    if (!matchesSearch) return false;

    if (categoryFilter === "hosts") return c.isHost || c.category?.includes("host");
    if (categoryFilter === "direct") return !c.isHost && (!c.category || !c.category.includes("host"));
    return true;
  });

  return (
    <aside id="sandesh-sidebar" className={`sandesh-sidebar-3d ${isOpen ? "open" : ""}`}>
      {/* 1. Header Profile & Brand */}
      <div className="sandesh-sidebar-header">
        <div className="sandesh-brand-row">
          <div className="sandesh-logo-mark">
            <img src={sandeshLogo} alt="Sandesh" className="sandesh-logo-mark-img" />
          </div>
          <div className="sandesh-brand-info">
            <span className="brand-name">Sandesh</span>
            <span className="brand-badge">ENTERPRISE</span>
          </div>
          <button
            type="button"
            className="sidebar-close-btn"
            onClick={onClose}
            aria-label="Close sidebar"
          >
            ×
          </button>
        </div>

        {/* User Card */}
        <div className="sandesh-user-glass-card">
          <div className="user-info-left" onClick={onEditProfile} role="button" tabIndex={0}>
            <div className="avatar-wrapper">
              <Avatar initials={me.initials || "AS"} color={me.color || "#ff7a59"} />
              <span className="online-presence-dot" title="Active (You)" />
            </div>
            <div className="user-details">
              <div className="user-name-line">
                <span className="user-name">{me.name}</span>
                {me.isAdmin && <span className="admin-tag">Admin</span>}
              </div>
              <span className="user-role">{me.username ? `@${me.username} • ` : ""}{me.designation || me.role}</span>
            </div>
          </div>
          <div className="user-actions-right">
            <button
              type="button"
              className="sandesh-icon-btn-3d"
              onClick={onOpenCommandsHelp}
              title="# Commands Guide & Directory"
              aria-label="Commands guide"
            >
              <span className="material-icons">terminal</span>
            </button>
            {me.isAdmin && (
              <>
                <button
                  type="button"
                  className="sandesh-icon-btn-3d"
                  onClick={onOpenApprovals}
                  title={`User Approvals ${pendingApprovalsCount > 0 ? `(${pendingApprovalsCount} waiting)` : ""}`}
                  aria-label="User approvals"
                  style={{ position: "relative" }}
                >
                  <span className="material-icons" style={{ color: pendingApprovalsCount > 0 ? "var(--sandesh-coral-accent)" : "inherit" }}>
                    how_to_reg
                  </span>
                  {pendingApprovalsCount > 0 && (
                    <span className="sandesh-sidebar-pulse-dot">{pendingApprovalsCount}</span>
                  )}
                </button>
                <button
                  type="button"
                  className="sandesh-icon-btn-3d"
                  onClick={onOpenAdminConsole}
                  title="Open Sandesh Admin Console"
                  aria-label="Admin console"
                >
                  <span className="material-icons">settings</span>
                </button>
              </>
            )}
            <button
              type="button"
              className="sandesh-icon-btn-3d"
              onClick={onSignOut}
              title="Sign Out"
              aria-label="Sign out"
            >
              <span className="material-icons">logout</span>
            </button>
          </div>
        </div>

        {/* WebSocket Connection Status Pill */}
        <div className="sandesh-connection-pill">
          <span className={`status-indicator ${socketStatus === "connected" ? "online" : "offline"}`} />
          <span className="connection-text">
            {socketStatus === "connected"
              ? "Live Sync (Erlang 8080)"
              : "Disconnected (Reconnecting...)"}
          </span>
          {socketStatus !== "connected" && (
            <button
              type="button"
              className="reconnect-link"
              onClick={onReconnectSocket}
              title="Click to retry backend connection"
            >
              Connect
            </button>
          )}
        </div>
      </div>

      {/* 2. New Chat Button & Search */}
      <div className="sandesh-sidebar-action-bar">
        <button type="button" className="sandesh-btn-new-chat-3d" onClick={onNewGroup}>
          <span className="material-icons">add_comment</span>
          <span>+ New Group / Chat</span>
        </button>

        <div className="sandesh-search-glass-3d">
          <span className="material-icons search-icon">search</span>
          <input
            type="text"
            placeholder="Search conversations &amp; hosts…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button type="button" className="clear-search" onClick={() => setSearchTerm("")}>
              ×
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="sandesh-filter-row">
          <button
            type="button"
            className={`filter-btn ${categoryFilter === "all" ? "active" : ""}`}
            onClick={() => setCategoryFilter("all")}
          >
            All
          </button>
          <button
            type="button"
            className={`filter-btn ${categoryFilter === "hosts" ? "active" : ""}`}
            onClick={() => setCategoryFilter("hosts")}
          >
            🏢 Hosts &amp; AI
          </button>
          <button
            type="button"
            className={`filter-btn ${categoryFilter === "direct" ? "active" : ""}`}
            onClick={() => setCategoryFilter("direct")}
          >
            💬 Direct &amp; Teams
          </button>
        </div>
      </div>

      {/* 3. Conversation & Channels List */}
      <div className="sandesh-chat-list-scroll">
        <div className="section-label">Active Conversations</div>
        <ul className="sandesh-chat-list">
          {filteredChats.map((chat) => {
            const isOnline = isChatOnline(chat);
            return (
              <li
                key={chat.id}
                className={`sandesh-chat-item-3d ${chat.id === activeChatId ? "active" : ""}`}
                onClick={() => {
                  if (chat.originalUser && onSelectOnlineUser) {
                    onSelectOnlineUser(chat.originalUser);
                  } else {
                    onSelectChat?.(chat.id);
                  }
                  onClose?.();
                }}
              >
                <div className="avatar-wrapper">
                  <Avatar
                    initials={chat.id === "workspace" ? "WS" : chat.initials || chat.name[0]}
                    color={chat.id === "workspace" ? "#ff7a59" : chat.color || (chat.isHost ? "#ff7a59" : chat.isGroup ? "#ff9472" : "#f2709c")}
                    group={chat.isGroup}
                  />
                  {isOnline && (
                    <span className="online-presence-dot" title="Online now" />
                  )}
                  {chat.id === "workspace" && (
                    <span className="host-seal-icon" title="My Workspace">
                      <span className="material-icons">dashboard</span>
                    </span>
                  )}
                  {chat.id !== "workspace" && chat.isHost && (
                    <span className="host-seal-icon" title="Certified Sandesh Host">
                      <span className="material-icons">verified</span>
                    </span>
                  )}
                </div>
                <div className="chat-meta">
                  <div className="chat-name-row">
                    <span className="chat-name">{chat.name}</span>
                    <span className="chat-time">{chat.time}</span>
                  </div>
                  <div className="chat-preview-row">
                    <span className="chat-preview">{chat.preview}</span>
                    {chat.unread > 0 && <span className="sandesh-unread-badge-3d">{chat.unread}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  className="sandesh-chat-delete-btn"
                  title="Delete conversation"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteChat?.(chat.id, chat.name);
                  }}
                >
                  <span className="material-icons">delete_outline</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
