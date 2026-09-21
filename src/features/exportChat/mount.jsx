import { createRoot } from 'react-dom/client';
import ExportButton from './components/ExportButton';
import { exportChatAsMarkdown } from './logic';
import './export.css';

// Replaces AXIExportChat's injectButton() (script.js ~11092-11117).
//
// DELIBERATE FIX: the original searched for '.chatHeader, .chat__header,
// [class*="chatHeader"], [class*="chat-header"], .pageHeader' — none of
// these exist anywhere in the current index.html, so the button has never
// actually rendered; the feature was only reachable via window.axiExportChat
// from a console/keyboard-shortcut path that doesn't exist either. Placing
// it in .composerShell (next to the Prompt Templates button) instead gives
// it an actual, reachable home rather than faithfully reproducing dead UI.
function boot() {
  if (document.getElementById('axiExportBtn')) return;
  const shell = document.querySelector('.composerShell');
  if (!shell) return;

  const anchor = document.createElement('span');
  shell.appendChild(anchor);
  createRoot(anchor).render(<ExportButton />);

  // Preserve the original's global entry point.
  window.axiExportChat = exportChatAsMarkdown;
  console.info('[AXI Export Chat] React version loaded');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1000));
} else {
  setTimeout(boot, 1000);
}
