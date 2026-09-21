import { useMemo, useState } from 'react';
import DataBinsToolbar from './DataBinsToolbar';
import DataBinCard from './DataBinCard';
import Pager from './Pager';
import { filterBins, sortBins, paginate, handleCreateBin, handleEditBin, handleDelBin } from '../logic';

// Ported from the bins panel markup + renderBins (core.js:656-764, 1486-1549).
export default function DataBinsPanel({ bins, rows, refreshing, onRefresh, toast, onDataChanged, onHideShell, onShowShell }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('latest');
  const [view, setView] = useState('grid');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const filtered = useMemo(() => filterBins(bins, rows, { search, filter }), [bins, rows, search, filter]);
  const sorted = useMemo(() => sortBins(filtered, rows, sort), [filtered, rows, sort]);
  const { pageItems, total, pages, page: safePage } = paginate(sorted, page, perPage);

  function resetToPage1(setter) {
    return (v) => { setter(v); setPage(1); };
  }

  function handleCreate() {
    try {
      handleCreateBin({ onHide: onHideShell, onShow: onShowShell });
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function handleEdit(id) {
    try {
      await handleEditBin(id, { onHide: onHideShell, onShow: onShowShell });
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete data bin "${name}"?\n\nAssignments using this bin will also be affected.`)) return;
    try {
      await handleDelBin(id, name);
      toast('Data bin deleted');
      onDataChanged();
    } catch (e) {
      toast('Error: ' + e.message, true);
    }
  }

  return (
    <div id="adm-panel-bins">
      <div className="adm-hero" style={{ background: 'linear-gradient(135deg,#EFF6FF 0%,#E0EFFE 100%)', borderColor: '#BFDBFE' }}>
        <div className="adm-hero-content">
          <h2 className="adm-hero-title">Data bins</h2>
          <p className="adm-hero-sub">Create, edit, or delete data bins. Once created, assign them to user groups in the Assignments tab.</p>
          <div className="adm-hero-actions">
            <button className="adm-btn-blue" onClick={handleCreate}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Create data bin
            </button>
            <button className="adm-btn-s" onClick={onRefresh} disabled={refreshing}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
              Refresh
            </button>
          </div>
        </div>
        <div className="adm-hero-illus">
          <svg width="100" height="90" viewBox="0 0 100 90" fill="none" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="50" cy="28" rx="32" ry="10" fill="#BFDBFE" opacity=".6" />
            <ellipse cx="50" cy="28" rx="32" ry="10" fill="none" stroke="#3B82F6" strokeWidth="1.8" />
            <path d="M18 28v22c0 5.5 14.3 10 32 10s32-4.5 32-10V28" stroke="#3B82F6" strokeWidth="1.8" />
            <path d="M18 39c0 5.5 14.3 10 32 10s32-4.5 32-10" stroke="#3B82F6" strokeWidth="1.5" strokeDasharray="4 3" opacity=".5" />
            <ellipse cx="50" cy="28" rx="32" ry="10" fill="#EFF6FF" />
            <ellipse cx="50" cy="28" rx="32" ry="10" fill="none" stroke="#3B82F6" strokeWidth="1.8" />
            <text x="50" y="32" textAnchor="middle" fontSize="11" fontWeight="700" fill="#2563EB">DB</text>
          </svg>
        </div>
        <div className="adm-hero-stat">
          <span className="adm-hero-stat-n">{bins.length || '—'}</span>
          <span className="adm-hero-stat-l">Total data bins</span>
        </div>
      </div>

      <DataBinsToolbar
        search={search} onSearch={resetToPage1(setSearch)}
        filter={filter} onFilter={resetToPage1(setFilter)}
        sort={sort} onSort={resetToPage1(setSort)}
        view={view} onView={setView}
      />

      {!pageItems.length ? (
        <div style={{ textAlign: 'center', padding: '56px 24px', gridColumn: '1/-1' }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#18191C', margin: '0 0 6px' }}>{search ? `No bins match "${search}"` : 'No data bins yet'}</p>
          <p style={{ fontSize: 12.5, color: '#888A8F', margin: '0 0 20px', lineHeight: 1.6 }}>{!search ? 'Create your first data bin to start assigning access to user groups.' : ''}</p>
          {!search && (
            <button className="adm-btn-blue" style={{ margin: '0 auto' }} onClick={handleCreate}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Create data bin
            </button>
          )}
        </div>
      ) : (
        <div className="adm-bins-grid" style={{ gridTemplateColumns: view === 'list' ? '1fr' : undefined }}>
          {pageItems.map((b) => (
            <DataBinCard key={b.id} bin={b} rows={rows} isList={view === 'list'} onEdit={handleEdit} onDelete={handleDelete} />
          ))}
        </div>
      )}

      <Pager page={safePage} pages={pages} total={total} perPage={perPage} itemLabel="data bins" onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} />
    </div>
  );
}
