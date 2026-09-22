import { useState } from 'react';
import { generatePDFReport } from '../../../services/pdfExport.js';
import { axiCopyFallback } from '../../../services/messageRendering.js';

// PDF-export + copy-as-markdown buttons on a finished assistant message.
//
// Ported from script.js's renderReportActions/_injectReportBtns
// (script.js:3736-3799) and injectMessageActions' `if (bubble._axiMarkdown)`
// gate (script.js:8598-8601) — but NOTE: renderReportActions itself has zero
// call sites anywhere in script.js (confirmed dead code, per the earlier
// extraction pass) and nothing else ever sets `bubble._axiMarkdown`, so in
// the current live app these two buttons never actually appear — the whole
// feature is orphaned dead wiring, not something this port can faithfully
// reproduce as "currently visible." Given the button styling/behavior below
// (script.js:3748-3799) is fully built and was clearly intended to work,
// this component re-wires it to actually fire — on every finished
// (non-streaming, non-error) assistant message with substantial content —
// rather than silently leaving it permanently dead. Flagged as a deliberate
// fix, not a strict behavior-preserving port; revert to not rendering this
// at all if that's not the intended call.
const MIN_CONTENT_LENGTH = 40;

export default function ReportActions({ message, bubbleRef }) {
  const [pdfState, setPdfState] = useState('idle'); // idle | working | done | error
  const [copyState, setCopyState] = useState('idle');

  if (message._streaming || message._error) return null;
  const markdownText = message.content || '';
  if (markdownText.trim().length < MIN_CONTENT_LENGTH) return null;

  async function handlePdfExport() {
    if (pdfState === 'working' || !bubbleRef.current) return;
    setPdfState('working');
    try {
      await generatePDFReport(bubbleRef.current, markdownText);
      setPdfState('done');
      setTimeout(() => setPdfState('idle'), 2500);
    } catch (err) {
      console.error('[AXI] PDF export failed:', err);
      setPdfState('error');
      setTimeout(() => setPdfState('idle'), 2500);
    }
  }

  async function handleCopyMarkdown() {
    // Matches the fallback pattern already established by axiCopyCode
    // (messageRendering.js): the Clipboard API can reject for reasons that
    // have nothing to do with the content being copyable (document focus,
    // permissions policy, insecure context) — fall back to the textarea
    // execCommand trick rather than leaving the user with no feedback.
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(markdownText);
      } else {
        axiCopyFallback(markdownText);
      }
    } catch (err) {
      try {
        axiCopyFallback(markdownText);
      } catch (fallbackErr) {
        console.error('[AXI] Copy as markdown failed:', fallbackErr);
        return;
      }
    }
    setCopyState('done');
    setTimeout(() => setCopyState('idle'), 2000);
  }

  return (
    <div className="axiext-actions" style={{ display: 'flex', gap: 6, marginTop: 8 }}>
      <div className="axi-rpt-sep" style={{ width: 1, height: 14, background: '#e5e7eb', margin: '0 2px', flexShrink: 0, alignSelf: 'center' }} />
      <button
        type="button"
        className="axiext-action-btn axi-pdf-btn"
        title="Export PDF"
        onClick={handlePdfExport}
        disabled={pdfState === 'working'}
      >
        {pdfState === 'done' ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12" /></svg>
        ) : pdfState === 'working' ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ animation: 'spin 1s linear infinite' }}><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></svg>
        )}
      </button>
      <button
        type="button"
        className="axiext-action-btn axi-rpt-copy-btn"
        title="Copy as Markdown"
        onClick={handleCopyMarkdown}
      >
        {copyState === 'done' ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>
        )}
      </button>
    </div>
  );
}
