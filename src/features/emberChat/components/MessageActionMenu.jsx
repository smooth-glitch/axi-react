export default function MessageActionMenu({
  style,
  msg,
  canDelete = true,
  onReply,
  onCopy,
  onReact,
  onForward,
  onStar,
  onDelete,
}) {
  return (
    <div
      id="ember-message-action-menu"
      className="sandesh-action-menu-dark"
      role="menu"
      aria-label="Message actions"
      style={style}
    >
      <button
        type="button"
        id="ember-action-reply"
        className="action-menu-item"
        role="menuitem"
        onClick={onReply}
      >
        <span className="material-icons menu-icon">reply</span>
        <span className="menu-label">Reply</span>
      </button>

      <button
        type="button"
        id="ember-action-copy"
        className="action-menu-item"
        role="menuitem"
        onClick={onCopy}
      >
        <span className="material-icons menu-icon">content_copy</span>
        <span className="menu-label">Copy</span>
      </button>

      <button
        type="button"
        id="ember-action-react"
        className="action-menu-item"
        role="menuitem"
        onClick={onReact}
      >
        <span className="material-icons menu-icon">add_reaction</span>
        <span className="menu-label">React</span>
      </button>

      <button
        type="button"
        id="ember-action-forward"
        className="action-menu-item"
        role="menuitem"
        onClick={onForward}
      >
        <span className="material-icons menu-icon" style={{ transform: "scaleX(-1)" }}>
          reply
        </span>
        <span className="menu-label">Forward</span>
      </button>

      <button
        type="button"
        id="ember-action-star"
        className="action-menu-item"
        role="menuitem"
        onClick={onStar}
      >
        <span className="material-icons menu-icon">star_outline</span>
        <span className="menu-label">Star</span>
      </button>

      {canDelete && (
        <button
          type="button"
          id="ember-action-delete"
          className="action-menu-item item-danger"
          role="menuitem"
          onClick={onDelete}
        >
          <span className="material-icons menu-icon">delete_outline</span>
          <span className="menu-label">Delete</span>
        </button>
      )}
    </div>
  );
}
