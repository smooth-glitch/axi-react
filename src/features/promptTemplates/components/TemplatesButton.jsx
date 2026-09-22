import { useEffect, useRef, useState } from 'react';
import { TEMPLATES } from '../data';

// Ported from AXIPromptTemplates (script.js ~10668-11004): a button that
// opens a categorized list of canned prompts; clicking one fills #prompt and
// auto-clicks #send.
export default function TemplatesButton() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  }, [open]);

  function sendPromptAndClose(text) {
    setOpen(false);
    const p = document.getElementById('prompt');
    if (!p) return;
    p.value = text;
    p.dispatchEvent(new Event('input', { bubbles: true }));
    p.focus();
    setTimeout(() => {
      const btn = document.getElementById('send');
      if (btn && !btn.disabled) btn.click();
    }, 90);
  }

  return (
    <div className="axi-tpl-wrap" ref={wrapRef}>
      <button
        id="axiTplBtnReact"
        type="button"
        title="Prompt Templates"
        className={open ? 'axi-tpl-active' : ''}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></svg>
        Templates
        <svg className="axi-tpl-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
      </button>

      {open && (
        <div id="axiTplPanel" style={{ display: 'block' }}>
          <div className="axi-tpl-hdr">
            <div className="axi-tpl-hdr-title">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></svg>
              Prompt Templates
            </div>
            <button className="axi-tpl-hdr-close" onClick={() => setOpen(false)}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
          {TEMPLATES.map((cat, ci) => (
            <div key={cat.category}>
              {ci > 0 && <div className="axi-tpl-divider" />}
              <div className="axi-tpl-cat-label"><span className="axi-tpl-cat-icon">{cat.icon}</span>{cat.category}</div>
              {cat.items.map((item) => (
                <button key={item.label} className="axi-tpl-item" onClick={() => sendPromptAndClose(item.prompt)}>
                  <div className="axi-tpl-icon-wrap">{cat.icon}</div>
                  <div className="axi-tpl-text">
                    <div className="axi-tpl-item-label">{item.label}</div>
                    <div className="axi-tpl-item-desc">{item.desc}</div>
                  </div>
                  <span className="axi-tpl-arrow">›</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
