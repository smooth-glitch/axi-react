import { useState } from 'react';

// Ported from createStreamingNode's thinking-block markup + _finalizeThinkingBlock
// (script.js ~5669-5698). Visible from send until the first token arrives
// (handleSend sets _thinkingDone or _thinkingText/_thinkingDuration on the
// message object in its onChunk handler, then notifies).
//
// NOTE: _thinkingText is preserved for fidelity but in practice is always
// empty — script.js's streamCallbacks has no onThinking handler wired up, so
// the "real reasoning tokens" branch was already unreachable before this
// port (see the comment left in script.js's handleSend). This block will
// therefore always take the "done, no reasoning shown" path once the first
// token arrives.
export default function ThinkingBlock({ message }) {
  const [expanded, setExpanded] = useState(false);
  const done = !!(message._thinkingDone || message._thinkingText);
  if (done && !message._thinkingText) return null; // silently removed, matching the original

  const duration = message._thinkingDuration;

  return (
    <div className={`axi-thinking-block${done ? ' axi-thinking-block--done' : ' axi-thinking-block--active'}${expanded ? ' axi-thinking-block--expanded' : ''}`}>
      <div
        className="axi-thinking-header"
        onClick={done ? () => setExpanded((e) => !e) : undefined}
        style={done ? { cursor: 'pointer' } : undefined}
      >
        {done ? (
          <svg className="axi-thinking-done-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
        ) : (
          <svg className="axi-thinking-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /></svg>
        )}
        <span className="axi-thinking-label">{done ? `Thought for ${duration}s` : 'Thinking'}</span>
        {!done && (
          <span className="axi-thinking-dots"><span /><span /><span /></span>
        )}
        {done && (
          <svg className="axi-thinking-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
        )}
      </div>
      <div className="axi-thinking-body">
        <div className="axi-thinking-content">
          {done ? (message._thinkingText || 'Processed the request and composed a response.') : ''}
        </div>
      </div>
    </div>
  );
}
