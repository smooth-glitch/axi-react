import Avatar from "./Avatar.jsx";

export default function TopBar({
  chat,
  currentUser = null,
  activeView,
  onChangeView,
  onMenuClick,
  onMembersClick,
  onOpenSmartPrompts,
  onOpenTStructUser,
  onOpenAdminConsole,
  onOpenAiChat,
  onDeleteChat,
  isAdmin,
  onlineUsers = [],
  onOpenApprovals,
  pendingApprovalsCount = 0,
  onToggleNotifications,
  notificationsOpen = false,
  priorityCounts = null,
  onSignOut,
}) {
  const isOnline = !chat.isGroup && (chat.isOnline || (onlineUsers || []).some((u) => {
    const target = (
      chat.username ||
      (chat.id?.startsWith("user-") ? chat.id.replace(/^user-/, "") : "") ||
      chat.name ||
      ""
    ).toLowerCase().trim();
    const uUsername = (u.username || "").toLowerCase().trim();
    const uName = (u.name || "").toLowerCase().trim();
    const uId = (u.id || "").toLowerCase().trim();
    return (
      (uUsername && uUsername === target) ||
      (uName && uName === target) ||
      (uId && uId === target) ||
      (chat.name && uName === chat.name.toLowerCase().trim())
    );
  }));

  const isWorkspace = chat.id === "workspace" || chat.isWorkspace;
  let user = currentUser;
  if (!user) {
    try {
      const saved = localStorage.getItem("sandesh_session_user");
      if (saved) user = JSON.parse(saved);
    } catch {
      // ignore
    }
  }
  const actualUsername = user?.username || user?.name;
  const displayName = isWorkspace && actualUsername ? actualUsername : chat.name;

  return (
    <header className="sandesh-topbar-3d">
      <div className="topbar-left">
        <button
          className="topbar-menu-btn"
          onClick={onMenuClick}
          aria-label="Open conversation menu"
        >
          <span className="material-icons">menu</span>
        </button>

        <div className="topbar-avatar-wrap">
          <Avatar
            initials={
              isWorkspace
                ? (user?.initials || (actualUsername ? actualUsername.slice(0, 2).toUpperCase() : "WS"))
                : chat.initials || chat.name?.[0]
            }
            color={isWorkspace ? "#ff7a59" : chat.color || (chat.isHost ? "#ff7a59" : chat.isGroup ? "#ff9472" : "#f2709c")}
            imageUrl={isWorkspace ? user?.avatar : (chat.avatar || chat.imageUrl)}
            group={chat.isGroup}
            size={40}
          />
          {isOnline && <span className="online-presence-dot" title="Online now" />}
          {chat.isHost && (
            <span className="host-seal-icon" title="Certified Sandesh Host">
              <span className="material-icons">verified</span>
            </span>
          )}
        </div>

        <div className="chat-title-info">
          <div className="title-row">
            <h2 className="chat-title">{displayName}</h2>
            {!isWorkspace && chat.isHost && <span className="host-pill">HOST</span>}
            {chat.isGroup && <span className="group-pill">GROUP</span>}
            {isOnline && (
              <span className="online-status-pill">
                <span className="online-status-dot" /> Online
              </span>
            )}
          </div>
          <span className="chat-subtitle">
            {isWorkspace
              ? "Enterprise Workspace • Type '#' for commands"
              : chat.designation ||
                (chat.isGroup
                  ? chat.members?.length
                    ? `${chat.members.length} members`
                    : chat.id === "room-general"
                      ? "Enterprise Global Channel"
                      : "Group Channel"
                  : isOnline
                    ? "Active Now on Sandesh"
                    : "Active Now")}
          </span>
        </div>
      </div>

      {/* Center: View Switcher (Messages vs Topics/Episodes) */}
      <div className="topbar-center-switcher">
        <button
          type="button"
          className={`view-tab-btn ${activeView === "messages" ? "active" : ""}`}
          onClick={() => onChangeView("messages")}
          title="Standard chronological chat stream"
        >
          <span className="material-icons">chat</span>
          <span>Messages</span>
        </button>
        <button
          type="button"
          className={`view-tab-btn ${activeView === "episodes" ? "active" : ""}`}
          onClick={() => onChangeView("episodes")}
          title="Topics & Episodes categorization view"
        >
          <span className="material-icons">topic</span>
          <span className="view-tab-label-full">Topics &amp; Episodes</span>
          <span className="view-tab-label-short">Topics</span>
        </button>
      </div>

      {/* Right Action Icons */}
      <div className="topbar-right">
        {/* Org Structures Button */}
        <button
          type="button"
          className="sandesh-action-pill-btn"
          onClick={onOpenTStructUser}
          title="Create and manage org-wide user structures"
        >
          <span className="material-icons">table_chart</span>
          <span>Org Structs</span>
        </button>
        {/* Group Actions: Add Member */}
        {chat.isGroup && (
          <button
            type="button"
            className="sandesh-action-pill-btn add-member-pill-btn"
            onClick={onMembersClick}
            title="Add a new member to this group"
          >
            <span className="material-icons">person_add</span>
            <span>Add Member</span>
          </button>
        )}

        {/* Delete / Clear Chat Button */}
        <button
          type="button"
          className="sandesh-icon-btn-3d danger-btn"
          onClick={() => onDeleteChat?.(chat.id, chat.name)}
          title="Delete or clear this conversation"
          aria-label="Delete conversation"
        >
          <span className="material-icons">delete_sweep</span>
        </button>

        {/* User Approvals trigger */}
        {isAdmin && (
          <button
            type="button"
            className="sandesh-action-pill-btn approvals-topbar-pill"
            onClick={onOpenApprovals}
            title={`User Access Approvals ${pendingApprovalsCount > 0 ? `(${pendingApprovalsCount} waiting)` : ''}`}
          >
            <span className="material-icons" style={{ color: pendingApprovalsCount > 0 ? 'var(--sandesh-coral-accent)' : 'inherit' }}>
              how_to_reg
            </span>
            <span>Approvals</span>
            {pendingApprovalsCount > 0 && (
              <span className="topbar-approval-badge">{pendingApprovalsCount}</span>
            )}
          </button>
        )}

        {/* Admin Console trigger */}
        {isAdmin && (
          <button
            type="button"
            className="sandesh-icon-btn-3d"
            onClick={onOpenAdminConsole}
            title="Sandesh Admin Console"
          >
            <span className="material-icons">admin_panel_settings</span>
          </button>
        )}

        {/* AXI AI Assistant Trigger */}
        <button
          type="button"
          className="sandesh-icon-btn-3d ai-shortcut-btn"
          onClick={onOpenAiChat}
          title="Switch to AXI AI Workspace"
        >
          <span className="material-icons">auto_awesome</span>
        </button>
      </div>
    </header>
  );
}
