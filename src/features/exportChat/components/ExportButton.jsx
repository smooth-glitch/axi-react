import { useEffect, useRef, useState } from 'react';
import { exportChatAsMarkdown } from '../logic';
import { exportActiveChatPdf, exportActiveChatDocx, exportActiveChatJson } from '../../../services/chatExport.js';

// Ported from AXIExportChat's button markup (script.js ~11101-11113), plus a
// small format menu added here: the original app also had three separate
// full-chat exporters (exportActiveChatPdf/Docx/Json, script.js:7393-7559)
// that were never wired to any button in script.js's own UI (only
// exportActiveChatMarkdown had a call site, via a header dropdown that isn't
// part of the 8 React cutovers). Since this port makes them reachable
// (chatExport.js), giving them a real trigger here — rather than leaving
// working, tested export functions permanently unreachable — seemed like
// the more useful default; the primary click keeps its exact original
// behavior (Markdown export, same file/format) so nothing existing changes.
export default function ExportButton() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function pick(fn) {
    setOpen(false);
    fn();
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <button id="axiExportBtn" type="button" title="Export chat as Markdown (.md)" onClick={() => exportChatAsMarkdown()}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Export
      </button>
      <button
        type="button"
        title="More export formats"
        aria-label="More export formats"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 32, marginLeft: 2, borderRadius: 8,
          border: '1.5px solid #e0e4ef', background: '#fff', color: '#52545a',
          cursor: 'pointer', flexShrink: 0,
        }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50,
            background: '#fff', border: '1.5px solid #e0e4ef', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.1)', padding: 4, minWidth: 150,
          }}
        >
          <MenuItem label="PDF (.pdf)" onClick={() => pick(exportActiveChatPdf)} />
          <MenuItem label="Word (.docx)" onClick={() => pick(exportActiveChatDocx)} />
          <MenuItem label="JSON (.json)" onClick={() => pick(exportActiveChatJson)} />
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, onClick }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px',
        borderRadius: 6, border: 'none', background: 'transparent', color: '#374151',
        fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = '#F1F5F9'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {label}
    </button>
  );
}
