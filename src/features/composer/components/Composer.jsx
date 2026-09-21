import { useLayoutEffect, useRef, useState } from 'react';
import { getState, useComposerVersion } from '../store';

const MAX_CHARS = 2000;
const WARN_CHARS = 1800;

function AttachmentTray({ attachments }) {
  const hidden = !attachments.length;
  return (
    <div id="attachmentTray" className={`attachmentTray${hidden ? ' attachmentTray--hidden' : ''}`}>
      {attachments.map((a, idx) => (
        <div className="attachmentChip" key={idx}>
          <div className="attachmentChip__thumb">
            {a.kind === 'image' && a.previewUrl
              ? <img src={a.previewUrl} alt="" />
              : <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#999', fontSize: 10 }}>{a.kind}</div>}
          </div>
          <div className="attachmentChip__name">{a.name}</div>
          <button
            type="button"
            title="Add to Data Pin"
            style={{ flex: '0 0 auto', height: 24, width: 24, borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: '#3B82F6', cursor: 'pointer', display: 'grid', placeItems: 'center', marginLeft: 2 }}
            onClick={(e) => {
              e.stopPropagation();
              if (a.file) window.addFileToPin?.(a.file);
              else if (a.blob) window.addFileToPin?.(new File([a.blob], a.name, { type: a.type || 'application/octet-stream' }));
            }}
          >
            <span className="material-icons" style={{ fontSize: 14 }}>push_pin</span>
          </button>
          <button
            className="attachmentChip__remove"
            type="button"
            onClick={() => {
              getState().pendingAttachments.splice(idx, 1);
              window.__axiNotifyComposer?.();
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
      ))}
    </div>
  );
}

// Ported from the composer's static markup + refreshComposerState/
// syncComposerButtons/renderAttachmentTray/the submit-input-keydown listeners
// (script.js). handleSend/getActiveChat/axiClearChat are unchanged globals —
// this component only replaces how they're triggered and how the composer
// renders, never their own logic.
export default function Composer() {
  useComposerVersion();
  const state = getState();
  const [text, setText] = useState('');
  const textareaRef = useRef(null);

  // Auto-grow, capped at 120px — same formula as the original's
  // refreshComposerState/input-listener (style.height = "auto" then
  // min(scrollHeight, 120)).
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }, [text]);

  const hasText = !!text.trim();
  const hasAny = hasText || state.pendingAttachments.length > 0;
  const overLimit = text.length > MAX_CHARS;
  const disabled = state.busy || overLimit || !hasAny;

  const counterColor = overLimit ? '#EF4444' : text.length > WARN_CHARS ? '#F59E0B' : '#B0B7C3';
  const counterWeight = overLimit ? 700 : text.length > WARN_CHARS ? 600 : undefined;

  async function submit() {
    if (disabled) return;
    await window.handleSend?.();
  }

  return (
    <>
      <div className="composer__inputWrap composer__inputWrap--withLeftAction">
        <textarea
          id="prompt"
          ref={textareaRef}
          className="composer__input"
          rows={1}
          placeholder="Ask anything about your data…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <span className="axi-char-count" id="axiCharCount" style={{ color: counterColor, fontWeight: counterWeight }}>
          {text.length}/{MAX_CHARS}
        </span>
        <AttachmentTray attachments={state.pendingAttachments} />
      </div>
      <button id="axiClearChatBtn" type="button" title="Clear chat" aria-label="Clear chat" onClick={() => window.axiClearChat?.()}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" /></svg>
      </button>
      <button id="send" title="Send" className="composer__submit" type="submit" aria-label="Send" disabled={disabled} onClick={(e) => { e.preventDefault(); submit(); }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
      </button>
    </>
  );
}
