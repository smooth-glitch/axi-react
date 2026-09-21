import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ProviderLogo from './ProviderLogo';
import { PROVIDERS, getActiveProvider, hasKeyForProvider, switchToProvider } from '../logic';

// Ported from AXIProviderSwitcher's openPanel/closePanel/buildPanelHTML/init
// (script.js ~10738-10964). Replaces the entire #axiProviderWrap subtree
// (button + logo + name + panel) that used to be static markup wired up
// imperatively; ids/classes kept identical for CSS + any other by-id readers.
export default function ProviderSwitcher() {
  const [activeId, setActiveId] = useState(getActiveProvider);
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  // window._axiIsClientEmployee may not be set yet at mount time (race with
  // the platform's own boot sequence) — mirror the original's 1200ms-delayed
  // check via a short poll instead of hiding permanently on a false negative.
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      if (window._axiIsClientEmployee) {
        setHidden(true);
        console.info('[AXI Provider Switcher] hidden for employee user');
      }
    }, 1200);
    return () => clearTimeout(t);
  }, []);

  // Exposed for other files to call after a successful key-connect
  // (axi-databin-core.js, axi-databin-extras.js, axi-admin-services.js).
  useEffect(() => {
    // This component is a singleton mounted once for the app's lifetime, so
    // there's no meaningful unmount case to clean up after (mirrors the
    // original, which never tore down its `window.axiSwitchProviderUpdateBtn`
    // assignment either).
    window.axiSwitchProviderUpdateBtn = (id) => setActiveId(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (btnRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  }, [open]);

  function openPanel() {
    const rect = btnRef.current.getBoundingClientRect();
    const PANEL_W = 300;
    let left = rect.left;
    if (left + PANEL_W > window.innerWidth - 8) left = window.innerWidth - PANEL_W - 8;
    if (left < 8) left = 8;
    setPanelPos({ bottom: window.innerHeight - rect.top + 8, left });
    setOpen(true);
  }

  async function handleSelect(id) {
    setOpen(false);
    const newId = await switchToProvider(id, setActiveId);
    if (newId) setActiveId(newId);
  }

  if (hidden) return null;

  const active = PROVIDERS.find((p) => p.id === activeId) || PROVIDERS[0];

  return (
    <>
      <button
        id="axiProviderBtn"
        type="button"
        title="Switch AI Provider"
        ref={btnRef}
        className={open ? 'axi-provider-active' : ''}
        onClick={(e) => { e.stopPropagation(); if (open) setOpen(false); else openPanel(); }}
      >
        <span id="axiProviderLogo" className="axi-provider-logo" style={{ background: active.bg, color: active.color, border: `1px solid ${active.border}` }}>
          <ProviderLogo id={active.id} />
        </span>
        <span id="axiProviderName" className="axi-provider-name">{active.name}</span>
        <svg className="axi-provider-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
      </button>

      {open && createPortal(
        <div
          id="axiProviderPanel"
          ref={panelRef}
          style={{ display: 'block', position: 'fixed', bottom: panelPos.bottom, top: 'auto', left: panelPos.left, right: 'auto', zIndex: 99999 }}
        >
          <div className="axi-provider-hdr">AI Provider</div>
          <div className="axi-provider-list">
            {PROVIDERS.map((p) => {
              const isActive = p.id === activeId;
              const hasKey = hasKeyForProvider(p.id);
              return (
                <button key={p.id} className={`axi-provider-item${isActive ? ' active' : ''}`} type="button" title={p.name} onClick={() => handleSelect(p.id)}>
                  <span className="axi-pi-icon" style={{ background: p.bg, borderColor: p.border, color: p.color }}>
                    <ProviderLogo id={p.id} />
                  </span>
                  <span className="axi-pi-text">
                    <span className="axi-pi-name">{p.name}</span>
                    <span className="axi-pi-desc">{p.desc}</span>
                  </span>
                  <span className={`axi-pi-status ${hasKey ? 'connected' : 'disconnected'}`}>{hasKey ? 'Connected' : 'Not set'}</span>
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
