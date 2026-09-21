import { createRoot } from 'react-dom/client';
import AdminDashboardShell from './components/AdminDashboardShell';
import './admin.css';

// Replaces boot()/buildShell()/injectReopenBtn() (core.js:1194-2118) with a
// React tree. Mirrors the original's gating: only admins get any UI at all —
// buildUserPanel (the non-admin path) was dead code in the original (boot()
// returned early before ever calling it) and is deliberately not ported;
// confirm with the user before building it as a real feature if that's
// intended, rather than reviving unreachable/buggy code.
function boot() {
  const user = window.AxiAdminService.getUser();
  if (!user.isAdmin) return;

  // Patch window.closeDataBinPage ONCE so any close path (button OR the
  // Data Bin wizard's own save flow) can trigger the admin dashboard's
  // one-shot restore callback (window._axiAdmOnClose) — exact same contract
  // as the original (core.js:2077-2090).
  (function patchClose() {
    if (window._axiAdmClosePatch) return;
    if (typeof window.closeDataBinPage !== 'function') { setTimeout(patchClose, 200); return; }
    window._axiAdmClosePatch = true;
    const orig = window.closeDataBinPage;
    window.closeDataBinPage = function () {
      orig.apply(this, arguments);
      if (typeof window._axiAdmOnClose === 'function') {
        const cb = window._axiAdmOnClose;
        window._axiAdmOnClose = null; // consume once
        cb();
      }
    };
  })();

  const container = document.createElement('div');
  container.id = 'axi-admin-dashboard-root';
  document.body.appendChild(container);
  createRoot(container).render(<AdminDashboardShell />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 2400));
} else {
  setTimeout(boot, 2400);
}
