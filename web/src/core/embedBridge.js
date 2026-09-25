// Messaging between an embedded (iframe) page and its host application.
// Messages are plain objects: { source: 'tstruct', type, ...payload }, sent with window.parent.postMessage.
//
//   tstruct:ready       the embed finished loading            { structId }
//   tstruct:submitted   a record was created or updated       { structId, mode: 'new'|'edit', record }
//   tstruct:cancelled   the user pressed Discard
//   tstruct:error       loading / saving failed                { message }
//   tstruct:resize      content height changed (iframe auto-height)  { height }
export const MESSAGE_SOURCE = 'tstruct';

// Send to the parent window. targetOrigin should be the host's origin; '*' is only a fallback.
export function postToHost(type, payload = {}, targetOrigin = '*') {
  if (typeof window === 'undefined' || window.parent === window) return false;
  window.parent.postMessage({ source: MESSAGE_SOURCE, type: `tstruct:${type}`, ...payload }, targetOrigin);
  return true;
}
