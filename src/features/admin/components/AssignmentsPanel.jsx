import { useMemo, useState } from 'react';
import AssignmentsToolbar from './AssignmentsToolbar';
import AssignmentsTable from './AssignmentsTable';
import AssignmentsCardGrid from './AssignmentsCardGrid';
import AssignmentModal from './AssignmentModal';
import Pager from './Pager';
import { filterAssignments, sortAssignments, paginate } from '../logic';

// Ported from the assignments panel markup + renderAssignments (core.js:528-651,
// 1406-1484). Hero card kept verbatim (illustration SVG etc.) since it's pure
// presentation with no behavior.
export default function AssignmentsPanel({ rows, groups, bins, keys, refreshing, onRefresh, toast, onDataChanged }) {
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [sort, setSort] = useState('latest');
  const [view, setView] = useState('table');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [modalRid, setModalRid] = useState(undefined); // undefined = closed, null = new, id = edit

  const filtered = useMemo(() => filterAssignments(rows, { search, providerFilter }), [rows, search, providerFilter]);
  const sorted = useMemo(() => sortAssignments(filtered, sort), [filtered, sort]);
  const { pageItems, total, pages, page: safePage } = paginate(sorted, page, perPage);

  function resetToPage1(setter) {
    return (v) => { setter(v); setPage(1); };
  }

  async function handleDelete(rid) {
    if (!confirm('Delete this assignment?')) return;
    try {
      await window.AxiAdminService.delRow(rid);
      toast('Assignment deleted');
      onDataChanged();
    } catch {
      alert('Could not delete assignment. Please try again.');
    }
  }

  const emptyMessage = rows.length ? 'No assignments match your search.' : 'No assignments yet. Click + Add assignment to get started.';

  return (
    <div id="adm-panel-assignments">
      <div className="adm-hero">
        <div className="adm-hero-content">
          <h2 className="adm-hero-title">Access assignments</h2>
          <p className="adm-hero-sub">Control which user groups and individuals can access each data bin and which AI provider they use.</p>
          <div className="adm-hero-actions">
            <button className="adm-btn-blue" onClick={() => setModalRid(null)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Add assignment
            </button>
            <button className="adm-btn-s" onClick={onRefresh} disabled={refreshing}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
              Refresh
            </button>
          </div>
        </div>
        <div className="adm-hero-illus">
          <svg width="110" height="100" viewBox="0 0 110 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="12" y="18" width="70" height="72" rx="10" fill="#C7D7FD" opacity=".35" />
            <rect x="18" y="10" width="70" height="72" rx="10" fill="#fff" stroke="#D6E0FF" strokeWidth="1.5" />
            <rect x="28" y="26" width="40" height="5" rx="2.5" fill="#C7D7FD" />
            <rect x="28" y="37" width="30" height="4" rx="2" fill="#DDE6FF" />
            <rect x="28" y="47" width="35" height="4" rx="2" fill="#DDE6FF" />
            <circle cx="77" cy="65" r="20" fill="#4F6FE8" />
            <path d="M77 57v16M69 65h16" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="77" cy="65" r="20" fill="none" stroke="#fff" strokeWidth="1.5" opacity=".3" />
          </svg>
        </div>
        <div className="adm-hero-stat">
          <span className="adm-hero-stat-n">{rows.length || '—'}</span>
          <span className="adm-hero-stat-l">Total assignments</span>
        </div>
      </div>

      <AssignmentsToolbar
        search={search} onSearch={resetToPage1(setSearch)}
        providerFilter={providerFilter} onProviderFilter={resetToPage1(setProviderFilter)}
        sort={sort} onSort={resetToPage1(setSort)}
        view={view} onView={setView}
      />

      {view === 'grid'
        ? <AssignmentsCardGrid rows={pageItems} onEdit={setModalRid} onDelete={handleDelete} />
        : <AssignmentsTable rows={pageItems} emptyMessage={emptyMessage} onEdit={setModalRid} onDelete={handleDelete} />}

      <Pager page={safePage} pages={pages} total={total} perPage={perPage} itemLabel="assignments" onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} />

      {modalRid !== undefined && (
        <AssignmentModal
          editRid={modalRid}
          rows={rows}
          groups={groups}
          bins={bins}
          keys={keys}
          toast={toast}
          onClose={() => setModalRid(undefined)}
          onSaved={() => { setModalRid(undefined); onDataChanged(); }}
        />
      )}
    </div>
  );
}
