import React, { useState, useMemo } from "react";
import Avatar from "./Avatar.jsx";
import sandeshLogo from "../../../assets/sandesh-logo.png";

/**
 * WorkspaceChatsSlider
 * 
 * Left-hand slide-out drawer on "My Workspace" allowing users to check all their chats,
 * direct messages, channels, hosts, and active conversations.
 */
export default function WorkspaceChatsSlider({
  isOpen,
  onClose,
  me,
  chats = [],
  onlineUsers = [],
  activeChatId,
  onSelectChat,
  onOpenFullChat,
  onNewGroup,
  socketStatus,
  onReconnectSocket,
  onSignOut,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all"); // "all" | "hosts" | "direct"

  // Online check
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

  // Build complete conversation list including online associates
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
    // Exclude General Broadcast from this section per user specification
    if (c.id === "room-general" || c.name === "General Broadcast") {
      return false;
    }

    const matchesSearch =
      c.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.preview && c.preview.toLowerCase().includes(searchTerm.toLowerCase()));
    if (!matchesSearch) return false;

    if (categoryFilter === "hosts") return c.isHost || c.category?.includes("host");
    if (categoryFilter === "direct")
      return !c.isHost && (!c.category || !c.category.includes("host"));
    return true;
  });

  return (
    <aside
      id="workspace-chats-slider"
      className={`workspace-chats-slider-3d ${isOpen ? "open" : ""}`}
      aria-label="Workspace Chats Slider"
    >
      {/* Header */}
      <div className="wcs-header">
        <div className="wcs-brand-row">
          <div className="wcs-logo-wrap">
            <img src={sandeshLogo} alt="Sandesh" className="wcs-logo-img" />
          </div>
          <div>
            <div className="wcs-brand-title">Sandesh Chats</div>
            <div className="wcs-brand-sub">Active Conversations &amp; Hosts</div>
          </div>
        </div>
        <button
          type="button"
          className="wcs-close-btn"
          onClick={onClose}
          title="Close Chats Slider"
          aria-label="Close chats slider"
        >
          <span className="material-icons">chevron_left</span>
        </button>
      </div>

      {/* User Status Bar */}
      <div className="wcs-user-bar">
        <div className="wcs-user-avatar">
          <Avatar initials={me?.initials || "U"} color={me?.color || "#ff7a59"} size={34} imageUrl={me?.avatar || me?.imageUrl} />
          <span className="wcs-status-indicator" />
        </div>
        <div className="wcs-user-meta">
          <div className="wcs-user-name">{me?.username || me?.name || "User"}</div>
          <div className="wcs-user-role">{me?.role || "User"}</div>
        </div>
        <button
          type="button"
          className="wcs-user-logout-btn"
          onClick={onSignOut}
          title="Log Out"
          aria-label="Log Out"
        >
          <span className="material-icons">logout</span>
        </button>
      </div>

      {/* Action Bar: New Group & Search */}
      <div className="wcs-actions-section">
        <button
          type="button"
          className="wcs-btn-new-chat"
          onClick={() => {
            onNewGroup?.();
          }}
        >
          <span className="material-icons">add_comment</span>
          <span>+ New Group / Chat</span>
        </button>

        <div className="wcs-search-wrap">
          <span className="material-icons search-icon">search</span>
          <input
            type="text"
            placeholder="Search conversations & hosts…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button
              type="button"
              className="wcs-clear-search"
              onClick={() => setSearchTerm("")}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="wcs-tabs-row">
        {[
          { key: "all", label: "All" },
          { key: "hosts", label: "Hosts & AI" },
          { key: "direct", label: "Direct & Teams" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`wcs-tab-btn ${categoryFilter === tab.key ? "active" : ""}`}
            onClick={() => setCategoryFilter(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Conversation List */}
      <div className="wcs-list-container">
        <div className="wcs-list-header">
          <span>ACTIVE CONVERSATIONS ({filteredChats.length})</span>
        </div>

        {filteredChats.length === 0 ? (
          <div className="wcs-empty-state">
            <span className="material-icons">forum</span>
            <p>No conversations found</p>
          </div>
        ) : (
          <div className="wcs-items-stack">
            {filteredChats.map((c) => {
              const active = c.id === activeChatId;
              const online = isChatOnline(c);

              return (
                <div
                  key={c.id}
                  className={`wcs-chat-item ${active ? "is-active" : ""}`}
                  onClick={() => {
                    onSelectChat?.(c.id);
                    onOpenFullChat?.(c.id);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="wcs-item-avatar-wrap">
                    <Avatar
                      initials={c.initials || c.name?.[0]}
                      color={
                        c.color ||
                        (c.isHost ? "#ff7a59" : c.isGroup ? "#ff9472" : "#34c759")
                      }
                      group={c.isGroup}
                      imageUrl={c.id === "workspace" ? me?.avatar : (c.avatar || c.imageUrl)}
                      size={40}
                    />
                    {online && <span className="wcs-online-dot" title="Online now" />}
                    {c.isHost && (
                      <span className="wcs-host-badge" title="Sandesh Certified Host">
                        <span className="material-icons">verified</span>
                      </span>
                    )}
                  </div>

                  <div className="wcs-item-body">
                    <div className="wcs-item-top-row">
                      <span className="wcs-item-name">{c.name}</span>
                      <span className="wcs-item-time">{c.time || "now"}</span>
                    </div>

                    <div className="wcs-item-bottom-row">
                      <span className="wcs-item-preview">{c.preview || "No messages yet"}</span>
                      {c.unread > 0 && (
                        <span className="wcs-unread-badge">{c.unread}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </aside>
  );
}
