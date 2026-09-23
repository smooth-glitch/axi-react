import Avatar from "./Avatar.jsx";

export default function Sidebar({
  me,
  chats,
  onlineUsers,
  activeChatId,
  isOpen,
  onSelectChat,
  onEditProfile,
  onClose,
  onNewGroup,
  onOpenAiChat,
}) {
  return (
    <div id="ember-sidebar" className={isOpen ? "open" : ""}>
      <div className="me">
        <div className="who" id="ember-me-who" role="button" tabIndex={0} aria-label="Edit profile" onClick={onEditProfile}>
          <Avatar initials={me.initials} color={me.color} className="" />
          <div>
            <div className="title">Ember</div>
            <small id="ember-me-name">{me.name}</small>
            <small id="ember-me-status">{me.status}</small>
          </div>
        </div>
        <button className="icon-btn" id="ember-sidebar-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>

      <button id="ember-new-group-btn" onClick={onNewGroup}>
        + New Group
      </button>

      <div className="section-label">Chats</div>
      <ul id="ember-chat-list">
        {chats.map((chat) => (
          <li
            key={chat.id}
            className={`row-item${chat.id === activeChatId ? " active" : ""}`}
            onClick={() => onSelectChat?.(chat.id)}
          >
            <Avatar
              initials={chat.name[0]}
              color={chat.isGroup ? "var(--accent-2)" : "var(--accent)"}
              group={chat.isGroup}
            />
            <div className="meta">
              <div className="name-line">
                <span className="name">{chat.name}</span>
                <span className="time">{chat.time}</span>
              </div>
              <div className="preview">{chat.preview}</div>
            </div>
            {chat.unread > 0 && <span className="badge">{chat.unread}</span>}
          </li>
        ))}
      </ul>

      <div className="section-label">Online</div>
      <ul id="ember-online-list">
        {onlineUsers.map((user) => (
          <li key={user.id} className="row-item" onClick={() => onSelectChat?.(`user-${user.id}`)}>
            <Avatar initials={user.initials} color={user.color} />
            <div className="meta">
              <div className="name-line">
                <span className="name">{user.name}</span>
              </div>
              <div className="preview">{user.status}</div>
            </div>
            <span className="dot" />
          </li>
        ))}
        <li className="row-item" id="ember-ai-assistant-btn" onClick={onOpenAiChat}>
          <Avatar initials="AI" color="var(--accent-2)" />
          <div className="meta">
            <div className="name-line">
              <span className="name">AI Assistant</span>
            </div>
            <div className="preview">Open the AXI assistant</div>
          </div>
        </li>
      </ul>
    </div>
  );
}
