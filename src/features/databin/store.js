// Thin external-store wrapper around window.dataPinState (owned by
// AXIBOT/axi-databin-services.js). We don't move state ownership into React —
// other files (axi-databin-services.js's applyPin, axi-admin-dashboard.js)
// read/write window.dataPinState directly and expect it to keep working.
// Instead we expose a subscribe/notify pair wired to window.renderDataPinModal,
// the exact seam the vanilla code already used to say "state changed, re-render".
import { useSyncExternalStore } from 'react';

const listeners = new Set();
let version = 0;

export function ensureDataPinState() {
  if (typeof window.ensureDataPinState === 'function') return window.ensureDataPinState();
  if (!window.dataPinState) {
    window.dataPinState = { id: null, createdAt: null, sources: [], files: [], name: 'My Data Bin 1' };
  }
  return window.dataPinState;
}

export function notify() {
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

// Re-render hook: call in any component that reads window.dataPinState so it
// re-renders both on local mutations (which call notify() themselves) and on
// external ones (applyPin, openExistingDataBin-equivalent, etc. calling
// window.renderDataPinModal()).
export function useDataPinVersion() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// Registered once by mount.jsx as window.renderDataPinModal so external code
// (axi-databin-services.js's applyPin, in particular) can force a re-render
// exactly like it forced a re-draw in the vanilla implementation.
export function registerGlobalRerenderHook() {
  window.renderDataPinModal = notify;
}
