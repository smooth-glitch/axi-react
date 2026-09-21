import { useSyncExternalStore } from 'react';

// Same pattern as messageThread/store.js, separate notify channel
// (window.__axiNotifyComposer) so a composer-only change (busy toggle,
// attachment added/removed) doesn't force the message thread to re-render
// and vice versa — both read the same underlying window.state object,
// owned by script.js.
const listeners = new Set();
let version = 0;

export function getState() {
  return window.state || { chats: [], activeChatId: null, busy: false, pendingAttachments: [] };
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

export function useComposerVersion() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// Registered once by mount.jsx as window.__axiNotifyComposer so script.js's
// setBusy/syncComposerButtons/refreshComposerState/renderAttachmentTray/
// attachFileToChat can force a re-render exactly like they forced a DOM
// rebuild in the vanilla implementation.
export function registerGlobalNotifyHook() {
  window.__axiNotifyComposer = notify;
}
