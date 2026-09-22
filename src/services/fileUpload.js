// FIXED GAP (found via live testing): #fileInput's change handler lived only
// in script.js (script.js:5290-5336), which this SPA doesn't load — the
// <input type="file" id="fileInput"> element existed in App.jsx's markup
// (a real attachment button somewhere triggers it) but nothing listened for
// its change event, so file upload via the composer silently did nothing.
// Ported verbatim: same extension whitelist, same "push to pendingAttachments
// then immediately call handleSend()" flow, same unsupported-type message.
//
// One deliberate fix, not a silent behavior change: the original pushed the
// File object under the key `fileObj`, but Composer.jsx's already-built
// AttachmentTray (the "Add to Data Pin" button) reads `a.file`/`a.blob`, not
// `a.fileObj` — a pre-existing naming mismatch between this handler (never
// ported before now) and the attachment tray UI. Pushing under `file` here
// satisfies both that UI and chatFlow.js's handleSend (which already checks
// `att.fileObj || att.file || att.blob`, so either key works there).
import { extOf } from './fileHandling.js';
import { state, pushMessage, setBusy } from '../store/chatStore.js';

const SUPPORTED_EXTS = new Set(['csv', 'xlsx', 'xls', 'json', 'txt', 'pdf', 'docx']);

export async function handleFileInputChange(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;

  setBusy(true);
  try {
    for (const f of files) {
      const ext = extOf(f.name);

      if (SUPPORTED_EXTS.has(ext)) {
        // Clear any old database injection so it doesn't merge with the new file.
        window.pendingDatabaseData = null;

        state.pendingAttachments.push({ kind: 'file', name: f.name, file: f });
        window.__axiNotifyComposer?.();

        const promptEl = document.getElementById('prompt');
        if (promptEl && !promptEl.value.trim()) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          nativeSetter.call(promptEl, `Analyze this file: ${f.name}`);
          promptEl.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Same structured Executive Summary flow as any other analysis request.
        await window.handleSend?.();
        continue;
      }

      pushMessage('assistant', `Unsupported file type: ${f.name}. Supported types: CSV, XLSX, XLS, TXT, JSON, PDF, DOCX.`, true);
    }
  } catch (err) {
    pushMessage('assistant', `Upload failed: ${err.message || err}`, true);
  } finally {
    setBusy(false);
  }
}

export function wireFileInput() {
  const input = document.getElementById('fileInput');
  if (!input) return undefined;
  input.addEventListener('change', handleFileInputChange);
  return () => input.removeEventListener('change', handleFileInputChange);
}
