import { useState } from "react";
import Avatar from "./Avatar.jsx";

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
  onSignOut,
  socketStatus,
  onReconnectSocket,
}) {
  const [categoryFilter, setCategoryFilter] = useState("all"); // "all" | "hosts" | "direct"
  const [searchTerm, setSearchTerm] = useState("");

  const filteredChats = chats.filter((c) => {
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
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
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
            <Avatar initials={me.initials || "AS"} color={me.color || "#ff7a59"} />
            <div className="user-details">
              <div className="user-name-line">
                <span className="user-name">{me.name}</span>
                {me.isAdmin && <span className="admin-tag">Admin</span>}
              </div>
              <span className="user-role">{me.username ? `@${me.username} • ` : ""}{me.designation || me.role}</span>
            </div>
          </div>
          <div className="user-actions-right">
            {me.isAdmin && (
              <button
                type="button"
                className="sandesh-icon-btn-3d"
                onClick={onOpenAdminConsole}
                title="Open Sandesh Admin Console"
                aria-label="Admin console"
              >
                <span className="material-icons">settings</span>
              </button>
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
              : "Active Local Fallback"}
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
          {filteredChats.map((chat) => (
            <li
              key={chat.id}
              className={`sandesh-chat-item-3d ${chat.id === activeChatId ? "active" : ""}`}
              onClick={() => {
                onSelectChat?.(chat.id);
                onClose?.();
              }}
            >
              <div className="avatar-wrapper">
                <Avatar
                  initials={chat.name[0]}
                  color={chat.isHost ? "#ff7a59" : chat.isGroup ? "#ff9472" : "#f2709c"}
                  group={chat.isGroup}
                />
                {chat.isHost && (
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
            </li>
          ))}
        </ul>

        {/* Online Directory */}
        <div className="section-label">Online Associates ({onlineUsers.length})</div>
        <ul className="sandesh-online-list">
          {onlineUsers.map((user) => (
            <li
              key={user.id}
              className="sandesh-online-item-3d"
              onClick={() => {
                if (onSelectOnlineUser) {
                  onSelectOnlineUser(user);
                } else {
                  onSelectChat?.(`user-${user.id}`);
                }
                onClose?.();
              }}
            >
              <div className="avatar-wrapper">
                <Avatar initials={user.initials} color={user.color} />
                <span className="online-presence-dot" />
              </div>
              <div className="chat-meta">
                <span className="chat-name">{user.name}</span>
                <span className="chat-preview">{user.status}</span>
              </div>
            </li>
          ))}

          {/* AI Assistant Navigation Item */}
          <li
            className="sandesh-online-item-3d sandesh-ai-nav-item"
            id="sandesh-ai-assistant-btn"
            onClick={onOpenAiChat}
          >
            <div className="avatar-wrapper">
              <Avatar initials="AI" color="#5856d6" />
            </div>
            <div className="chat-meta">
              <span className="chat-name">Sandesh AI Assistant</span>
              <span className="chat-preview">Switch to full AI workspace</span>
            </div>
            <span className="material-icons arrow-icon">arrow_forward</span>
          </li>
        </ul>
      </div>
    </aside>
  );
}
