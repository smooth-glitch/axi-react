export default function TopBar({ title, subtitle, isGroup, onMenuClick, onMembersClick }) {
  return (
    <div id="ember-topbar">
      <button className="icon-btn" id="ember-menu-btn" aria-label="Show chats" onClick={onMenuClick}>
        ☰
      </button>
      <div>
        <div id="ember-topbar-title">{title}</div>
        <div id="ember-topbar-sub">{subtitle}</div>
      </div>
      <div className="spacer" />
      <button
        className={`icon-btn${isGroup ? "" : " hidden"}`}
        id="ember-members-btn"
        title="Group members"
        aria-label="Group members"
        onClick={onMembersClick}
      >
        👥
      </button>
    </div>
  );
}
