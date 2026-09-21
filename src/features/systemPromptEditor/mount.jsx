import { createRoot } from 'react-dom/client';
import SystemPromptModal from './components/SystemPromptModal';

// Replaces initSystemPromptEditor (axi-databin-core.js) + axi-ui-polish.js's
// initEditPromptBtn proxy (which forwarded #axiEditPromptBtn's click to a
// hidden #openSystemPrompt button purely so the old vanilla code's
// getElementById didn't null-ref). This mounts directly onto the real
// <dialog id="systemPromptModal"> (native dialog element, kept as-is —
// only its children are React-rendered) and wires #axiEditPromptBtn
// directly, no proxy needed.
function boot() {
  const dialog = document.getElementById('systemPromptModal');
  const openBtn = document.getElementById('axiEditPromptBtn');
  if (!dialog) return;

  const dialogRef = { current: dialog };
  const openRef = { current: null }; // set by the component; refreshes the textarea from storage

  createRoot(dialog).render(<SystemPromptModal dialogRef={dialogRef} openRef={openRef} />);

  openBtn?.addEventListener('click', () => {
    openRef.current?.();
    dialog.showModal();
  });

  dialog.addEventListener('mousedown', (e) => {
    if (e.target === dialog) dialog.close();
  });

  console.info('[AXI System Prompt Editor] React version loaded');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
