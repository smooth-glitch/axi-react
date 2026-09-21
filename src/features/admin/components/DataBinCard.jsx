import { binColor, binAssignedRows, rowGroup, rowUsername } from '../logic';

const SVG_DB = <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>;
const SVG_EDIT = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4z" /></svg>;
const SVG_DEL = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>;

function AssignBadge({ count }) {
  return (
    <span className={`adm-assign-badge ${count ? 'has' : 'none'}`}>
      {count > 0 && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>}
      {count} assignment{count !== 1 ? 's' : ''}
    </span>
  );
}

// Ported from the two renderBins branches (core.js:723-749, grid vs list).
export default function DataBinCard({ bin, rows, isList, onEdit, onDelete }) {
  const c = binColor(bin.name);
  const assignedRows = binAssignedRows(bin, rows);
  const targets = [...new Set(assignedRows.map((r) => rowUsername(r) || rowGroup(r)).filter(Boolean))].slice(0, 2);
  const moreCt = assignedRows.length - targets.length;

  if (isList) {
    return (
      <div className="adm-bin-card" style={{ borderRadius: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', gap: 14 }}>
          <div className="adm-bin-icon-wrap" style={{ background: c.bg, color: c.c, width: 40, height: 40, borderRadius: 10 }}>{SVG_DB}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#18191C', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={bin.name}>{bin.name}</p>
            <AssignBadge count={assignedRows.length} />
          </div>
          <div style={{ display: 'flex', gap: 5 }}>
            <button className="adm-bin-ic adm-bin-ic-edit" title="Edit" onClick={() => onEdit(bin.id, bin.name)}>{SVG_EDIT}</button>
            <button className="adm-bin-ic adm-bin-ic-del" title="Delete" onClick={() => onDelete(bin.id, bin.name)}>{SVG_DEL}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="adm-bin-card">
      <button className="adm-bin-kebab" title="Edit bin" onClick={() => onEdit(bin.id, bin.name)}>{SVG_EDIT}</button>
      <div className="adm-bin-card-body">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13, marginBottom: 10 }}>
          <div className="adm-bin-icon-wrap" style={{ background: c.bg, color: c.c }}>{SVG_DB}</div>
          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#18191C', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={bin.name}>{bin.name}</p>
            <AssignBadge count={assignedRows.length} />
          </div>
        </div>
        {targets.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {targets.map((t) => <span key={t} style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: '#F1F5F9', color: '#52545A', border: '1px solid #E2E8F0', whiteSpace: 'nowrap' }}>{t}</span>)}
            {moreCt > 0 && <span className="adm-more-tag">+{moreCt} more</span>}
          </div>
        ) : (
          <p style={{ fontSize: 11.5, color: '#B0B3BA', margin: '4px 0 0', fontStyle: 'italic' }}>No groups assigned yet</p>
        )}
      </div>
      <div className="adm-bin-card-foot">
        <button className="adm-bin-ic adm-bin-ic-del" title="Delete" onClick={() => onDelete(bin.id, bin.name)}>{SVG_DEL}</button>
      </div>
    </div>
  );
}
