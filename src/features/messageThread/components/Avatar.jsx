// Ported from createMessageNode's avatar logic (script.js ~3597-3620).
export default function Avatar({ role }) {
  if (role !== 'user') {
    return (
      <div className="message__avatar">
        <img src="../../images/ai-logo.png" alt="" />
      </div>
    );
  }

  let raw = '';
  try {
    const p = typeof parent !== 'undefined' ? parent : {};
    raw = (p.mainUserName || window.mainUserName || '').trim();
  } catch { /* cross-origin parent access denied — fall back to 'U' */ }
  const parts = raw ? raw.split(/\s+/) : [];
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts.length === 1
      ? parts[0][0].toUpperCase()
      : 'U';

  return (
    <div className="message__avatar axi-user-avatar">
      <span className="axi-user-initials">{initials}</span>
    </div>
  );
}
