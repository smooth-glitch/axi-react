import { useSyncExternalStore } from 'react';

// Thin external-store wrapper around window.state (owned by script.js).
// State ownership stays where it is — script.js's handleSend/pushMessage/
// setActiveChat/etc. all still read and mutate the exact same object this
// reads. We only add a subscribe/notify pair, wired to window.__axiNotifyThread,
// the exact seam script.js's own renderThread()/pushMessage() calls already
// used to say "the thread needs to reflect current state."
const listeners = new Set();
let version = 0;

export function getState() {
  if (!window.state) {
    // script.js hasn't run yet (load-order isn't guaranteed — it's injected
    // via the Axpert platform's Js slot). Return a safe empty shape; the
    // real object appears within one notify() once script.js executes.
    return { chats: [], activeChatId: null, busy: false, pendingAttachments: [] };
  }
  return window.state;
}

export function getActiveChat() {
  const s = getState();
  return s.chats.find((c) => c.id === s.activeChatId) || null;
}

function notify() {
  version += 1;
  listeners.forEach((l) => l());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return version;
}

export function useThreadVersion() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// Registered once by mount.jsx as window.__axiNotifyThread so script.js's
// handleSend/pushMessage/renderThread can force a re-render exactly like they
// forced a DOM rebuild in the vanilla implementation.
export function registerGlobalNotifyHook() {
  window.__axiNotifyThread = notify;
}
