import { createRoot } from 'react-dom/client';
import MessageThread from './components/MessageThread';
import { registerGlobalNotifyHook } from './store';

// Replaces renderThread/createMessageNode/ensureThread/the whole streaming-DOM
// pipeline (createStreamingNode/_scheduleRender/_updateStreamBubble/
// _finalizeThinkingBlock/_finalizeStreamNode) in script.js. This bundle owns
// #messages entirely; script.js still owns the composer (#prompt/#send/
// #attachmentTray, untouched) and all business logic (handleSend, the AI
// transport layer, dataset/data-bin context building) — it now writes into
// window.state and calls window.__axiNotifyThread() instead of touching the
// DOM directly. See the "REMOVED (React cutover)" comments left in place of
// each old DOM-writing block in script.js for the exact mapping.
//
// script.js is injected via the Axpert platform's Js slot at a position this
// bundle can't control (it may load before OR after script.js), so
// window.state may not exist yet at mount time — registerGlobalNotifyHook
// installs the hook immediately regardless, and a short poll below fires one
// notify() once window.state actually appears, so whatever chats already
// exist (restored from localStorage) show up without needing a user action.
registerGlobalNotifyHook();

function boot() {
  const container = document.getElementById('messages');
  if (!container) return;
  createRoot(container).render(<MessageThread />);

  let tries = 0;
  const poll = setInterval(() => {
    tries++;
    if (window.state) {
      window.__axiNotifyThread();
      clearInterval(poll);
    } else if (tries > 40) { // ~10s
      clearInterval(poll);
    }
  }, 250);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
