import { grpColor } from '../logic';

// Ported from the inline avHtml markup in renderAssignments (core.js:588-589, 609).
export default function GroupAvatar({ name, size = 32 }) {
  const c = grpColor(name);
  const initial = (name || '?').charAt(0).toUpperCase();
  return (
    <div
      className="adm-av-grp"
      style={{ background: c.bg, color: c.c, width: size, height: size, fontSize: size <= 32 ? 12 : 14 }}
    >
      {initial}
    </div>
  );
}
