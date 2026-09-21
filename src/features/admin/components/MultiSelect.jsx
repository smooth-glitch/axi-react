import { useEffect, useRef, useState } from 'react';

// Ported from msBuild/msRefreshLabel (core.js:34-123) — a searchable
// multi-select dropdown positioned under (or above, if no room) its trigger
// button, with a tag-summary label ("A, B +N more").
export default function MultiSelect({ options, selected, onChange, placeholder = 'Select…' }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dropStyle, setDropStyle] = useState({});
  const btnRef = useRef(null);
  const dropRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (!btnRef.current?.contains(e.target) && !dropRef.current?.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  function openDrop() {
    const r = btnRef.current.getBoundingClientRect();
    const estH = Math.min(268, options.length * 38 + 46);
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const style = spaceBelow >= estH || spaceBelow >= window.innerHeight / 2
      ? { top: r.bottom + 4, bottom: 'auto' }
      : { bottom: window.innerHeight - r.top + 4, top: 'auto' };
    setDropStyle({ ...style, left: r.left, width: Math.max(r.width, 220), display: 'block' });
    setSearch('');
    setOpen(true);
    setTimeout(() => searchRef.current?.focus(), 30);
  }

  function toggle(value) {
    const next = selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
    onChange(next);
  }

  const filtered = options.filter((o) => !search.trim() || o.label.toLowerCase().includes(search.trim().toLowerCase()));

  const labelNode = !selected.length
    ? <span style={{ color: 'var(--text-placeholder,#a8a9ad)' }}>{placeholder}</span>
    : selected.length <= 2
      ? selected.map((v) => <span key={v} className="adm-ms-tag">{v}</span>)
      : (<>
        <span className="adm-ms-tag">{selected[0]}</span>
        <span className="adm-ms-tag">{selected[1]}</span>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary,#888a8f)', marginLeft: 3 }}>+{selected.length - 2} more</span>
      </>);

  return (
    <div className="adm-ms">
      <button
        type="button"
        ref={btnRef}
        className={`adm-ms-btn${open ? ' open' : ''}`}
        onClick={(e) => { e.stopPropagation(); if (open) setOpen(false); else openDrop(); }}
      >
        <span className="adm-ms-val">{labelNode}</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0, opacity: 0.5 }}><polyline points="6 9 12 15 18 9" /></svg>
      </button>

      {open && (
        <div ref={dropRef} className="adm-ms-drop" style={dropStyle} onClick={(e) => e.stopPropagation()}>
          <div className="adm-ms-search-wrap">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF', pointerEvents: 'none' }}><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></svg>
            <input
              ref={searchRef}
              className="adm-ms-search-inp"
              type="text"
              placeholder="Search…"
              autoComplete="off"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          {!options.length && <div style={{ padding: '10px 12px', fontSize: 12.5, color: '#888A8F' }}>No options available</div>}
          {options.length > 0 && !filtered.length && <div className="adm-ms-no-res">No results</div>}
          {filtered.map((o) => (
            <label key={o.value} className="adm-ms-opt">
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
