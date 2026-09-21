import { createPortal } from 'react-dom';

// Ported from injectReopenBtn (core.js:1674-1731). Portaled into the
// #axiAdminCtrl placeholder div that index.html already provides (or the
// .actionGroup fallback), exactly like the original's ag.appendChild(btn).
export default function ReopenButton({ visible, onClick }) {
  const container = document.getElementById('axiAdminCtrl') || document.querySelector('.actionGroup');
  if (!container) return null;

  return createPortal(
    <button
      id="adm-reopen-btn"
      type="button"
      title="Open Admin Dashboard"
      aria-label="Open Admin Dashboard"
      style={{ display: visible ? 'inline-flex' : 'none' }}
      onClick={onClick}
    >
      <span className="adm-btn-shield" aria-hidden="true">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <polyline points="9 12 11 14 15 10" />
        </svg>
      </span>
      <span className="adm-btn-text">
        <span className="adm-btn-eyebrow">Control</span>
        <span className="adm-btn-label">Admin</span>
      </span>
      <span className="adm-btn-dot" aria-hidden="true" />
    </button>,
    container
  );
}
