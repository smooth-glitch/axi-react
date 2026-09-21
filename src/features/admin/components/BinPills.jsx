// Ported from binChip (core.js:451-460) and the inline binHtml building in
// renderAssignments (core.js:590-593, 610-612). maxVisible=0 shows all
// (used by the assignment card view), a positive number truncates with a
// "+N" tag (used by the table view).
export default function BinPills({ csv, maxVisible = 0, emptyText = null }) {
  const names = (csv || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!names.length) {
    return emptyText ? <span style={{ color: '#CBD5E1', fontSize: 12, fontStyle: 'italic' }}>{emptyText}</span> : <span style={{ color: '#CBD5E1' }}>—</span>;
  }
  const visible = maxVisible > 0 ? names.slice(0, maxVisible) : names;
  const extra = names.length - visible.length;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      {visible.map((n) => (
        <span key={n} className="adm-bin-pill" title={n}>{n}</span>
      ))}
      {extra > 0 && (
        <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }} title={names.slice(maxVisible).join(', ')}>
          +{extra}
        </span>
      )}
    </div>
  );
}
