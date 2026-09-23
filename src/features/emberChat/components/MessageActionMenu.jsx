export default function MessageActionMenu({ style, canDelete, onReply, onCopy, onDelete }) {
  return (
    <div id="ember-message-action-menu" role="menu" aria-label="Message actions" style={style}>
      <button type="button" id="ember-action-reply" role="menuitem" onClick={onReply}>
        <span className="action-icon">↩</span> Reply
      </button>
      <button type="button" id="ember-action-copy" role="menuitem" onClick={onCopy}>
        <span className="action-icon">📋</span> Copy Text
      </button>
      <button
        type="button"
        id="ember-action-delete"
        className={`danger${canDelete ? "" : " hidden"}`}
        role="menuitem"
        onClick={onDelete}
      >
        <span className="action-icon">🗑</span> Delete for Everyone
      </button>
    </div>
  );
}
