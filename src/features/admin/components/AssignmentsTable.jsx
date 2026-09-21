import GroupAvatar from './GroupAvatar';
import BinPills from './BinPills';
import ProviderBadge from './ProviderBadge';
import { rowGroup, rowBin, rowProvider, rowKey, rowId } from '../logic';

const SVG_EDIT = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4z" /></svg>;
const SVG_DEL = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>;

function KeyMask({ k }) {
  if (!k) return <span style={{ color: '#CBD5E1' }}>—</span>;
  const prefix = k.length > 7 ? k.slice(0, 7) : '••••••';
  return <span className="adm-key-mask"><span>{prefix}</span><span className="adm-key-dots">••••••••••</span></span>;
}

// Ported from the table branch of renderAssignments (core.js:582-599).
export default function AssignmentsTable({ rows, emptyMessage, onEdit, onDelete }) {
  if (!rows.length) {
    return (
      <div className="adm-card">
        <table className="adm-tbl">
          <colgroup><col style={{ width: '20%' }} /><col style={{ width: '28%' }} /><col style={{ width: '18%' }} /><col style={{ width: '24%' }} /><col style={{ width: '10%' }} /></colgroup>
          <thead><tr><th>User group</th><th>Data bin</th><th>Provider</th><th>API key</th><th style={{ textAlign: 'center' }}>Actions</th></tr></thead>
          <tbody><tr><td colSpan={5}><div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF', fontSize: 13 }}>{emptyMessage}</div></td></tr></tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="adm-card">
      <table className="adm-tbl">
        <colgroup><col style={{ width: '20%' }} /><col style={{ width: '28%' }} /><col style={{ width: '18%' }} /><col style={{ width: '24%' }} /><col style={{ width: '10%' }} /></colgroup>
        <thead><tr><th>User group</th><th>Data bin</th><th>Provider</th><th>API key</th><th style={{ textAlign: 'center' }}>Actions</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const rid = String(rowId(r));
            const grp = rowGroup(r);
            return (
              <tr className="adm-tr" key={rid}>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><GroupAvatar name={grp} /><span style={{ fontWeight: 600, color: '#18191C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={grp || '—'}>{grp || '—'}</span></div></td>
                <td><BinPills csv={rowBin(r)} maxVisible={2} /></td>
                <td><ProviderBadge provider={rowProvider(r)} /></td>
                <td><KeyMask k={rowKey(r)} /></td>
                <td>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                    <button className="adm-ic adm-ic-edit" title="Edit" onClick={() => onEdit(rid)}>{SVG_EDIT}</button>
                    <button className="adm-ic adm-ic-del" title="Delete" onClick={() => onDelete(rid)}>{SVG_DEL}</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
