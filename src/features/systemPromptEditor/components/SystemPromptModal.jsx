import { useEffect, useRef, useState } from 'react';

// Ported from initSystemPromptEditor (axi-databin-core.js ~3260-3327) + the
// standalone char-counter IIFE (~154-167). Both read/write via
// window.getActiveSystemPrompt/saveCustomPrompt/DEFAULT_SYSTEM_PROMPT, which
// are pure localStorage-backed globals with no Axpert dependency — unchanged.
export default function SystemPromptModal({ dialogRef, openRef }) {
  const [text, setText] = useState(() => window.getActiveSystemPrompt?.() || '');
  const [toast, setToast] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const textareaRef = useRef(null);

  // Exposes a refresh function the trigger button's click handler calls
  // right before dialog.showModal() — matches the original's "reload the
  // current prompt every time the modal opens, discarding unsaved edits"
  // behavior exactly.
  useEffect(() => {
    openRef.current = () => setText(window.getActiveSystemPrompt?.() || '');
  }, [openRef]);

  function handleSave() {
    const newPrompt = text.trim();
    if (!newPrompt) {
      alert('System prompt cannot be empty');
      return;
    }
    const isCustom = window.saveCustomPrompt?.(newPrompt);
    dialogRef.current?.close();
    setToastMsg(`System prompt ${isCustom ? 'saved' : 'reset to default'} successfully!`);
    setToast(true);
    setTimeout(() => setToast(false), 3000);
  }

  function handleReset() {
    if (confirm('Reset to default system prompt?')) {
      setText(window.DEFAULT_SYSTEM_PROMPT || '');
    }
  }

  const len = text.length;
  const counterColor = len > 4000 ? '#EF4444' : len > 2000 ? '#F59E0B' : '#b1b1b1';

  return (
    <>
      <div className="axmp">
        <div className="axmp__head">
          <div className="axmp__headLeft">
            <span className="axmp__headIcon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
            </span>
            <div>
              <h2 id="systemPromptTitle" className="axmp__title">System Prompt</h2>
              <p className="axmp__sub">Customize how AXI thinks and responds</p>
            </div>
          </div>
          <button className="axModal__x" type="button" aria-label="Close" onClick={() => dialogRef.current?.close()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="axmp__body">
          <div className="axmp__labelRow">
            <label className="axModal__label" htmlFor="systemPromptEditor">Prompt</label>
            <span className="axmp__counter" style={{ color: counterColor }}>{len.toLocaleString()} chars</span>
          </div>
          <textarea
            id="systemPromptEditor"
            className="axmp__textarea"
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. You are AXI, a concise data analyst. Always cite sources and use structured output..."
          />
          <p className="axmp__hint">Sent with every request · keep it under 500 words</p>
        </div>

        <div className="axmp__foot">
          <div id="promptStatus" className="axModal__status" style={{ display: 'none' }} />
          <div className="axmp__actions">
            <button id="resetSystemPrompt" className="axModal__btn axModal__btn--ghost" type="button" onClick={handleReset}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
              Reset
            </button>
            <button id="saveSystemPrompt" className="axModal__btn axModal__btn--primary" type="button" onClick={handleSave}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
              Save Prompt
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', padding: '12px 20px', background: '#10B981', color: 'white', borderRadius: 12, fontSize: 14, fontWeight: 500, alignItems: 'center', gap: 8, boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}>
          <span className="material-icons" style={{ fontSize: 18 }}>check_circle</span> {toastMsg}
        </div>
      )}
    </>
  );
}
