import GroupAvatar from './GroupAvatar';
import BinPills from './BinPills';
import ProviderBadge from './ProviderBadge';
import { rowGroup, rowBin, rowProvider, rowKey, rowId } from '../logic';

const SVG_EDIT = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4z" /></svg>;
const SVG_DEL = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>;

// Ported from the card branch of renderAssignments (core.js:602-634).
export default function AssignmentsCardGrid({ rows, onEdit, onDelete }) {
  return (
    <div className="adm-asgn-cards">
      {rows.map((r) => {
        const rid = String(rowId(r));
        const grp = rowGroup(r);
        const key = rowKey(r);
        const prefix = key.length > 7 ? key.slice(0, 7) : '••••••';
        return (
          <div className="adm-asgn-card" key={rid}>
            <div className="adm-asgn-card-body">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <GroupAvatar name={grp} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#18191C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={grp || '—'}>{grp || '—'}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#9CA3AF' }}>User group</p>
                </div>
              </div>
              <div style={{ marginBottom: 12 }}><BinPills csv={rowBin(r)} /></div>
              <div><ProviderBadge provider={rowProvider(r)} /></div>
            </div>
            <div className="adm-asgn-card-foot">
              <span style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'monospace', letterSpacing: 0.5 }}>{prefix}••••••••••</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="adm-ic adm-ic-edit" title="Edit" onClick={() => onEdit(rid)}>{SVG_EDIT}</button>
                <button className="adm-ic adm-ic-del" title="Delete" onClick={() => onDelete(rid)}>{SVG_DEL}</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
