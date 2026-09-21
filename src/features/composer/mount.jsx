import { createRoot } from 'react-dom/client';
import Composer from './components/Composer';
import { registerGlobalNotifyHook } from './store';

// Replaces the composer's static markup + refreshComposerState/
// syncComposerButtons/renderAttachmentTray/the submit-input-keydown listeners
// (script.js). This bundle owns #composer's children (#prompt/#send/
// #attachmentTray/#axiCharCount/#axiClearChatBtn) — the <form id="composer">
// element itself is left as real (non-React) markup; only its contents are
// React-rendered, mirroring the same pattern used for #messages and the
// system prompt dialog.
//
// el.prompt/el.send/el.attachmentTray/el.composer in script.js were converted
// to getters specifically so this cutover wouldn't leave any of the many
// existing el.X.value/el.X.disabled/etc. call sites holding a stale
// reference to a node this bundle just replaced.
registerGlobalNotifyHook();

function boot() {
  const form = document.getElementById('composer');
  if (!form) return;
  createRoot(form).render(<Composer />);

  // Safety net: the Composer's own button-click and textarea-keydown
  // handlers already preventDefault + call handleSend() directly, so the
  // form's native submit event shouldn't normally fire — but if anything
  // else ever triggers it (browser autofill, accessibility tools), this
  // still routes to the exact same unchanged global, matching the original's
  // el.composer.addEventListener("submit", ...) behavior exactly.
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    window.handleSend?.();
  });

  console.info('[AXI Composer] React version loaded');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
