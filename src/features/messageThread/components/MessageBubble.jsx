import { useEffect, useRef } from 'react';
import Avatar from './Avatar';
import ThinkingBlock from './ThinkingBlock';

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

export default function MessageBubble({ message }) {
  const bubbleRef = useRef(null);
  const nodeRef = useRef(null);
  const chartsRenderedRef = useRef(false);
  const enhancedRef = useRef(false);

  const roleClass = message.role === 'user' ? 'message--user' : 'message--assistant';
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
    <div className={`message ${roleClass}`} ref={nodeRef}>
      <Avatar role={message.role} />
      <div className="message__content">
        {message.role === 'assistant' && message._streaming && <ThinkingBlock message={message} />}
        <div className="message__bubble" ref={bubbleRef} style={{ position: 'relative' }}>
          <div dangerouslySetInnerHTML={{ __html: renderBubbleHtml(message) }} />
          {message._streaming && <span className="axi-stream-cursor" />}
        </div>
        <div className="message__meta">{timeStr}</div>
      </div>
    </div>
  );
}
