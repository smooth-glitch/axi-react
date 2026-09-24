export default function TopBar({
  chat,
  activeView,
  onChangeView,
  onMenuClick,
  onMembersClick,
  onOpenSmartPrompts,
  onOpenAdminConsole,
  onOpenAiChat,
  isAdmin,
}) {
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

        <div className="chat-title-info">
          <div className="title-row">
            <h2 className="chat-title">{chat.name}</h2>
            {chat.isHost && <span className="host-pill">HOST</span>}
            {chat.isGroup && <span className="group-pill">GROUP</span>}
          </div>
          <span className="chat-subtitle">
            {chat.designation || (chat.isGroup ? (chat.members?.length ? `${chat.members.length} members` : (chat.id === "room-general" ? "Enterprise Global Channel" : "Group Channel")) : "Active Now")}
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

        {/* Group Members Button */}
        {chat.isGroup && (
          <button
            type="button"
            className="sandesh-icon-btn-3d"
            onClick={onMembersClick}
            title="View group members"
          >
            <span className="material-icons">group</span>
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
