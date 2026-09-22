// The single owner of app state — replaces script.js's module-scope `state`
// object (script.js:769-779) and its mutator functions. Ported verbatim in
// shape and behavior (including the exact localStorage key "axpert_chats_v2"
// — existing users' saved chats must still load) — the only real change is
// WHO creates and owns this object (this module, at app boot, instead of
// script.js being injected via the Axpert platform's Js slot).
//
// window.state is still exposed for backward compatibility with files not
// yet ported off it (axi-databin-services.js, axi-admin-services.js,
// axi-databin-core.js/extras.js, axi-ui-polish.js) and with the existing
// per-feature store.js files (messageThread/composer/databin), which already
// read window.state + call window.__axiNotify* — those files are unchanged
// and keep working against this object by reference.
export const state = {
  busy: false,
  chats: [],
  activeChatId: null,
  pendingAttachments: [],
};
window.state = state;

const LS_KEY = 'axpert_chats_v2';

export function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Persistence (script.js:3321-3385, verbatim) ──────────────────────────
export function loadChats() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveChats() {
  try {
    localStorage.setItem(LS_KEY + '_active', state.activeChatId || '');
  } catch (_) { /* ignore */ }

  // Strip large transient fields before persisting — re-hydrated from the
  // active Data Bin on each send and must not fill localStorage (5-10MB cap).
  const MAX_MSG_CHARS = 20000;
  const slim = state.chats.map((c) => {
    const s = { ...c };
    delete s.fileContext;
    delete s.datasetRows;
    delete s.datasetProfile;
    delete s.datasetAggregates;
    delete s.dataset;
    if (Array.isArray(s.messages)) {
      s.messages = s.messages.map((m) =>
        m && m.content && m.content.length > MAX_MSG_CHARS
          ? { ...m, content: m.content.slice(0, MAX_MSG_CHARS) + '\n[…truncated]' }
          : m
      );
    }
    return s;
  });
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(slim));
  } catch (e) {
    if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
      console.warn('[chatStore] localStorage quota exceeded — pruning oldest chats');
      const keep = Math.max(1, Math.ceil(slim.length / 2));
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(slim.slice(slim.length - keep)));
      } catch (_) { /* give up */ }
    }
  }
}

function binKey(binName) {
  return LS_KEY + '__' + binName.replace(/\s+/g, '_');
}

export function saveChatsForBin(binName) {
  if (!binName) return;
  const key = binKey(binName);
  try { localStorage.setItem(key, JSON.stringify(state.chats)); } catch (_) { /* ignore */ }
  try { localStorage.setItem(key + '_active', state.activeChatId || ''); } catch (_) { /* ignore */ }
}

export function loadChatsForBin(binName) {
  if (!binName) return;
  const key = binKey(binName);
  try {
    const chats = JSON.parse(localStorage.getItem(key) || '[]');
    const activeId = localStorage.getItem(key + '_active') || '';
    state.chats = chats.length
      ? chats
      : [{ id: uid(), title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(), messages: [], dataset: null }];
    state.activeChatId = activeId && state.chats.find((c) => c.id === activeId) ? activeId : state.chats[0].id;
    notify();
  } catch (_) { /* ignore */ }
}

// Swap the active chat list when switching Data Bins — called by
// axi-databin-services.js's applyPin with (prevBinName, newBinName).
window.axiSwitchChatsToBin = function axiSwitchChatsToBin(prevBinName, newBinName) {
  if (prevBinName) saveChatsForBin(prevBinName);
  if (newBinName) loadChatsForBin(newBinName);
};

// ── Chat/session management (script.js:3387-5401, verbatim) ─────────────
export function getActiveChat() {
  return state.chats.find((c) => c.id === state.activeChatId) || null;
}
window.getActiveChat = getActiveChat;

export function ensureAtLeastOneChat() {
  if (state.chats.length) return;
  const c = { id: uid(), title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(), messages: [], dataset: null };
  state.chats.unshift(c);
  state.activeChatId = c.id;
  saveChats();
}

export function setActiveChat(chatId) {
  state.activeChatId = chatId;
  saveChats();
  notify();
}
window.setActiveChat = setActiveChat;

export function newChat() {
  const chat = {
    id: uid(),
    title: 'New chat',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    dataset: null,
    _axiSentBinIds: new Set(),
  };
  state.chats.unshift(chat);
  saveChats();
  setActiveChat(chat.id);
  return chat;
}
window.newChat = newChat;

export function deleteChat(chatId) {
  const idx = state.chats.findIndex((c) => c.id === chatId);
  if (idx === -1) return;
  state.chats.splice(idx, 1);
  if (state.activeChatId === chatId) {
    state.activeChatId = state.chats[0]?.id || null;
    ensureAtLeastOneChat();
  }
  saveChats();
  notify();
}
window.deleteChat = deleteChat;

// Real implementation (script.js:5392-5399, verbatim) — restores
// activeChatId from its own localStorage key, reloads chats, re-activates.
// Exposed for the admin dashboard's restore path.
window.axiRestoreThread = function axiRestoreThread() {
  const savedId = localStorage.getItem(LS_KEY + '_active');
  if (savedId && state.chats.find((c) => c.id === savedId)) {
    state.activeChatId = savedId;
  }
  state.chats = loadChats();
  setActiveChat(state.activeChatId || (state.chats[0] && state.chats[0].id));
};

window.axiClearChat = function axiClearChat() {
  const chat = getActiveChat();
  if (!chat) return;
  chat.messages = [];
  chat.title = 'New chat';
  chat.updatedAt = Date.now();
  saveChats();
  notify();
};

// ── Messages (script.js:4666-4688, verbatim) ─────────────────────────────
export function pushMessage(role, content, markdown = false, charts = []) {
  const chat = getActiveChat();
  if (!chat) return null;

  const m = { id: uid(), role, content, markdown, ts: Date.now(), charts };
  chat.messages.push(m);

  if (chat.title === 'New chat' && role === 'user') {
    chat.title = content.slice(0, 40) + (content.length > 40 ? '...' : '');
  }
  chat.updatedAt = Date.now();
  saveChats();
  notify();
  return m;
}
window.pushMessage = pushMessage;

// ── Busy / composer ───────────────────────────────────────────────────────
export function setBusy(v) {
  state.busy = !!v;
  notifyComposer();
}
window.setBusy = setBusy;

// Thin shims kept because a wide surface of code (axi-databin-services.js,
// axi-admin-services.js, axi-databin-core.js/extras.js, axi-ui-polish.js)
// still calls these by name expecting "the thread/composer needs to reflect
// current state" — exactly the contract script.js's own reduced shims (see
// script.js:3671, the "REMOVED (React cutover)" block) already established.
window.renderThread = function renderThread() {
  notify();
};
window.syncComposerButtons = function syncComposerButtons() {
  notifyComposer();
};
window.refreshComposerState = function refreshComposerState() {
  notifyComposer();
};
window.renderAttachmentTray = function renderAttachmentTray() {
  notifyComposer();
};

// ── Notify channels ───────────────────────────────────────────────────────
// IMPORTANT: this module does NOT own the notify/subscribe machinery itself.
// axi-message-thread-react.js's and axi-composer-react.js's own store.js
// files (src/features/messageThread/store.js, src/features/composer/store.js)
// each already implement a useSyncExternalStore-based subscribe/notify pair
// and register themselves as window.__axiNotifyThread / window.__axiNotifyComposer
// via registerGlobalNotifyHook() (called once from main.jsx at boot). If this
// module also assigned window.__axiNotifyThread to its own separate notify
// function, whichever assignment ran last would silently win and the other's
// listeners would never fire — so instead we just call the already-registered
// global hooks, exactly like script.js itself always did.
function notify() {
  window.__axiNotifyThread?.();
}
function notifyComposer() {
  window.__axiNotifyComposer?.();
}

// ── Boot (script.js:5371-5383, verbatim) ─────────────────────────────────
// Call after main.jsx has registered the notify hooks above.
export function bootChatStore() {
  state.chats = loadChats();
  const savedId = localStorage.getItem(LS_KEY + '_active');
  if (savedId && state.chats.find((c) => c.id === savedId)) {
    state.activeChatId = savedId;
  }
  ensureAtLeastOneChat();
  setActiveChat(state.activeChatId);
}
