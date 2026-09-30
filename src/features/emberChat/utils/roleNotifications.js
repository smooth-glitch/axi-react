/**
 * Role-Based Priority Notifications Utility
 *
 * Real notifications are loaded dynamically from the backend notification feed
 * (/api/sd/feed and WS feed.*) and pushed live.
 * All fake/mock presets (Erlang sync, database backup, quota alerts, etc.) have been removed.
 */

export function formatTimeAgo(ts, fallback = "Just now") {
  if (!ts) return fallback;
  const num = typeof ts === "number" ? ts : Number(ts);
  if (isNaN(num) || num <= 0) return fallback;

  const now = Date.now();
  const diffMs = Math.max(0, now - num);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "Just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  return new Date(num).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * @deprecated Fake presets are completely removed. Returns empty array.
 */
export function buildInitialRoleNotifications() {
  return [];
}
