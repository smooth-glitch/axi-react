import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import ThinkingBlock from './ThinkingBlock';
import ReportActions from './ReportActions';

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Ported from createMessageNode's content-processing branches (script.js
// ~3624-3641): literal "Thinking..." placeholder, full-HTML-document preview,
// markdown, or escaped plain text — in that priority order.
function renderBubbleHtml(message) {
  const content = message.content || '';
  if (content.trim() === 'Thinking...') {
    return '<div class="thinking-anim">Thinking<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></div>';
  }
  if (typeof window.isFullHtmlDocument === 'function' && window.isFullHtmlDocument(content)) {
    return window.buildHtmlPreviewHTML(content);
  }
  if (message.markdown && typeof window.marked !== 'undefined') {
    let html = window.marked.parse(content);
    if (typeof window.DOMPurify !== 'undefined') html = window.DOMPurify.sanitize(html);
    return html;
  }
  return escapeHtml(content);
}

// Ported from the catch block of handleSend (script.js, the retry button's
// click handler) — same splice-last-2-messages-then-resend sequence, just
// triggered from React instead of a hand-wired DOM listener. getActiveChat/
// saveChats/handleSend are unchanged true globals in script.js.
function retryLastMessage() {
  const chat = window.getActiveChat?.();
  const lastUser = (chat?.messages || []).filter((m) => m.role === 'user').slice(-1)[0]?.content || '';
  if (chat?.messages) {
    const len = chat.messages.length;
    if (len >= 2) chat.messages.splice(len - 2, 2);
    else if (len === 1) chat.messages.splice(0, 1);
    chat.updatedAt = Date.now();
    window.saveChats?.();
    window.__axiNotifyThread?.();
  }
  const p = document.getElementById('prompt');
  if (p && lastUser) {
    p.value = lastUser;
    p.dispatchEvent(new Event('input', { bubbles: true }));
  }
  setTimeout(() => window.handleSend?.(), 80);
}

// Ported from regenerateFromEdit (script.js) — the original located the
// message by walking #messages' real DOM and counting user-role siblings to
// map back to a chat.messages index. React already knows the exact index
// (passed down from MessageThread's .map), so this is simpler and doesn't
// depend on DOM structure matching array order.
function regenerateFromEdit(idx, newText) {
  const chat = window.getActiveChat?.();
  if (!chat) return;
  chat.messages.splice(idx); // remove this message + everything after; handleSend re-adds it fresh
  chat.updatedAt = Date.now();
  window.saveChats?.();
  window.__axiNotifyThread?.();

  setTimeout(() => {
    const prompt = document.getElementById('prompt');
    if (prompt) {
      prompt.value = newText;
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
      window.syncComposerButtons?.();
      window.handleSend?.();
    }
  }, 80);
}

function EditableUserBubble({ message, idx }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.content);
  const [hover, setHover] = useState(false);

  if (editing) {
    return (
      <div className="message__bubble" style={{ position: 'relative' }}>
        <textarea
          className="axi-inline-editor"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              const t = text.trim();
              if (t) regenerateFromEdit(idx, t);
            }
            if (e.key === 'Escape') { setText(message.content); setEditing(false); }
          }}
          style={{ width: '100%', minHeight: 72, maxHeight: 240, padding: '10px 12px', borderRadius: 8, border: '1.5px solid #3B82F6', outline: 'none', fontSize: 14, fontFamily: 'inherit', lineHeight: 1.6, color: '#1a1a2e', background: '#fff', resize: 'vertical', boxSizing: 'border-box', boxShadow: '0 0 0 3px rgba(59,130,246,0.12)' }}
          autoFocus
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => { setText(message.content); setEditing(false); }}
            style={{ padding: '6px 14px', borderRadius: 7, border: '1.5px solid #E2E8F0', background: '#F8FAFC', color: '#374151', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { const t = text.trim(); if (t) regenerateFromEdit(idx, t); }}
            style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: '#2563EB', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            Regenerate ↵
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="message__bubble"
      style={{ position: 'relative' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div dangerouslySetInnerHTML={{ __html: renderBubbleHtml(message) }} />
      <button
        type="button"
        className="axi-edit-btn"
        title="Edit message"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        style={{
          position: 'absolute', top: 8, right: 8, zIndex: 5, display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 9px', borderRadius: 7, border: '1.5px solid rgba(0,0,0,0.08)', background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(4px)', color: '#6B7280', fontSize: 11, fontWeight: 500, cursor: 'pointer',
          opacity: hover ? 1 : 0, transition: 'opacity 0.18s, background 0.15s',
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
        Edit
      </button>
    </div>
  );
}

// One-time injected keyframe + hover/active rules for .axi-suggestion-chip —
// these live only in this injected <style>, not in the main stylesheet, in
// the original too (script.js's renderFollowUpSuggestions did the same
// injectOnce-into-head trick). Ported verbatim.
function ensureSuggestionStyle() {
  if (document.getElementById('axi-suggestions-style')) return;
  const style = document.createElement('style');
  style.id = 'axi-suggestions-style';
  style.textContent = `
    @keyframes axiFadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    .axi-suggestion-chip:hover { background: #EFF6FF !important; border-color: #93C5FD !important; color: #1D4ED8 !important; transform: translateY(-1px); }
    .axi-suggestion-chip:active { transform: scale(0.97) !important; }
  `;
  document.head.appendChild(style);
}

const CHIP_STYLE = {
  display: 'inline-flex', alignItems: 'center', padding: '9px 18px', borderRadius: 999,
  border: '1.5px solid #CBD5E1', background: '#F8FAFC', color: '#374151', fontSize: 14,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontWeight: 500,
  cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s, color 0.15s, transform 0.12s',
  whiteSpace: 'normal', wordBreak: 'break-word', maxWidth: '100%', lineHeight: 1.45, textAlign: 'left',
};

// Ported from generateFollowUpSuggestions + renderFollowUpSuggestions
// (script.js): after the LAST message in the thread finishes streaming (as
// an assistant response), fetch up to 3 follow-up prompts and show them as
// clickable chips that auto-fill + auto-send.
function FollowUpChips({ message, isLast }) {
  const [suggestions, setSuggestions] = useState([]);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!isLast || message.role !== 'assistant' || message._streaming || message._error) return;
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    const chat = window.getActiveChat?.();
    const lastUserMsg = (chat?.messages || []).filter((m) => m.role === 'user').slice(-1)[0]?.content || '';
    window.generateFollowUpSuggestions?.(lastUserMsg, message.content).then((s) => {
      if (Array.isArray(s) && s.length) { ensureSuggestionStyle(); setSuggestions(s); }
    }).catch(() => { });
  }, [isLast, message.role, message._streaming, message._error, message.content]);

  if (!suggestions.length) return null;

  function pick(text) {
    const p = document.getElementById('prompt');
    if (!p) return;
    setTimeout(() => {
      p.value = text;
      p.dispatchEvent(new Event('input', { bubbles: true }));
      p.focus();
      window.syncComposerButtons?.();
      setTimeout(() => window.handleSend?.(), 180);
    }, 120);
  }

  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#94A3B8', marginTop: 14, marginBottom: 2, padding: '0 2px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
        Suggested follow-ups
      </div>
      <div className="axi-suggestions" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '14px 0 6px 0', opacity: 0, animation: 'axiFadeUp 0.35s ease forwards', animationDelay: '0.15s' }}>
        {suggestions.map((s, i) => (
          <button key={i} type="button" className="axi-suggestion-chip" style={CHIP_STYLE} onClick={() => pick(s)}>{s}</button>
        ))}
      </div>
    </>
  );
}

export default function MessageBubble({ message, idx, isLast }) {
  const bubbleRef = useRef(null);
  const nodeRef = useRef(null);
  const chartsRenderedRef = useRef(false);
  const enhancedRef = useRef(false);

  const roleClass = message.role === 'user' ? 'message--user' : 'message--assistant';
  // The "AXI EXT" enhancement layer (message action bar, insight pills, pin
  // button — all defined elsewhere in script.js) watches for this exact class
  // via MutationObservers on the `class` attribute to know when a message is
  // done streaming. Restoring it here is what makes those already-existing
  // systems keep working against React-rendered message nodes.
  const streamingClass = message._streaming ? ' axi-streaming-msg' : '';
  const timeStr = new Date(message.ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const charts = message.chartSpecs || message.charts || [];

  // Chart rendering (Highcharts) — genuinely third-party/complex, call the
  // existing global rather than reimplementing it. Guarded to fire once per
  // message: renderHighchartInMessage APPENDS a chart div each call, so
  // re-running on every re-render (e.g. a sibling message streaming) would
  // duplicate charts.
  useEffect(() => {
    if (chartsRenderedRef.current) return;
    if (message._streaming) return; // wait for final content
    if (!charts.length || typeof window.renderHighchartInMessage !== 'function') return;
    chartsRenderedRef.current = true;
    charts.forEach((spec) => window.renderHighchartInMessage(bubbleRef.current, spec));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message._streaming, charts.length]);

  // Code-block syntax highlighting + callout enhancement — post-processes
  // whatever HTML the bubble already rendered. Only run once finalized
  // (matches the original: never called during live streaming ticks).
  useEffect(() => {
    if (enhancedRef.current) return;
    if (message._streaming) return;
    if (typeof window.enhanceCodeBlocks === 'function') window.enhanceCodeBlocks(nodeRef.current);
    if (typeof window.axiEnhanceCallouts === 'function') window.axiEnhanceCallouts(nodeRef.current);
    enhancedRef.current = true;
  }, [message._streaming, message.content]);

  if (message._error) {
    return (
      <div className={`message ${roleClass}`} ref={nodeRef}>
        <Avatar role={message.role} />
        <div className="message__content">
          <div className="message__bubble" ref={bubbleRef} style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ color: '#ef4444' }}>{message.content}</span>
              <button
                type="button"
                onClick={retryLastMessage}
                style={{ padding: '5px 13px', borderRadius: 8, border: '1.5px solid #fca5a5', background: '#fef2f2', color: '#dc2626', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                ↺ Retry
              </button>
            </div>
          </div>
          <div className="message__meta">{timeStr}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`message ${roleClass}${streamingClass}`} ref={nodeRef}>
      <Avatar role={message.role} />
      <div className="message__content">
        {message.role === 'assistant' && message._streaming && <ThinkingBlock message={message} />}
        {message.role === 'user' ? (
          <EditableUserBubble message={message} idx={idx} />
        ) : (
          <div className="message__bubble" ref={bubbleRef} style={{ position: 'relative' }}>
            <div dangerouslySetInnerHTML={{ __html: renderBubbleHtml(message) }} />
            {message._streaming && <span className="axi-stream-cursor" />}
          </div>
        )}
        <div className="message__meta">{timeStr}</div>
        {message.role === 'assistant' && !message._streaming && <ReportActions message={message} bubbleRef={bubbleRef} />}
        {message.role === 'assistant' && <FollowUpChips message={message} isLast={isLast} />}
      </div>
    </div>
  );
}
