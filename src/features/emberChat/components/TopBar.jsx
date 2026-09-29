import Avatar from "./Avatar.jsx";

export default function TopBar({
  chat,
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
            initials={chat.initials || chat.name?.[0]}
            color={chat.color || (chat.isHost ? "#ff7a59" : chat.isGroup ? "#ff9472" : "#f2709c")}
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
            <h2 className="chat-title">{chat.name}</h2>
            {chat.isHost && <span className="host-pill">HOST</span>}
            {chat.isGroup && <span className="group-pill">GROUP</span>}
            {isOnline && (
              <span className="online-status-pill">
                <span className="online-status-dot" /> Online
              </span>
            )}
          </div>
          <span className="chat-subtitle">
            {chat.designation ||
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

      {/* Center: View Switcher (Messages vs Topics/Episodes vs Timeline) */}
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
          <span>Topics &amp; Episodes</span>
        </button>
      </div>

      {/* Right Action Icons */}
      <div className="topbar-right">
        {/* Smart Prompts Button */}
        <button
          type="button"
          className="sandesh-action-pill-btn"
          onClick={onOpenSmartPrompts}
          title="Access Smart Structure prompts (Leave, Vitals, Tickets, Invoices)"
        >
          <span className="material-icons">bolt</span>
          <span>Smart Prompts</span>
        </button>

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

        {/* Group Actions: Add Member & View Members */}
        {chat.isGroup && (
          <>
            <button
              type="button"
              className="sandesh-action-pill-btn add-member-pill-btn"
              onClick={onMembersClick}
              title="Add a new member to this group"
            >
              <span className="material-icons">person_add</span>
              <span>Add Member</span>
            </button>
            <button
              type="button"
              className="sandesh-icon-btn-3d"
              onClick={onMembersClick}
              title="View group members"
            >
              <span className="material-icons">group</span>
            </button>
          </>
        )}

        {/* Delete / Clear Chat Button */}
        <button
          type="button"
          className="sandesh-icon-btn-3d danger-btn"
          onClick={() => {
            if (window.confirm(`Are you sure you want to delete / clear the conversation "${chat.name}"?`)) {
              onDeleteChat?.(chat.id);
            }
          }}
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
