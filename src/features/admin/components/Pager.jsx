// Replaces the string-templated _pagerHtml (core.js:503-526). Same behavior:
// always shows the per-page selector, only shows page nav when >1 page,
// shows up to 2 pages on either side of the current one with ellipses.
export default function Pager({ page, pages, total, perPage, itemLabel, onPage, onPerPage }) {
  if (total <= 0) return null;
  const start = (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);
  const lo = Math.max(1, page - 2);
  const hi = Math.min(pages, page + 2);
  const nums = [];
  for (let p = lo; p <= hi; p++) nums.push(p);

  return (
    <div className="adm-pager">
      <span className="adm-pager-info">Showing {start} to {end} of {total} {itemLabel}</span>
      {pages > 1 && (
        <div className="adm-pager-pages">
          <button className="adm-pg-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} title="Prev">&#8249;</button>
          {lo > 1 && (<>
            <button className="adm-pg-btn" onClick={() => onPage(1)}>1</button>
            {lo > 2 && <span style={{ padding: '0 3px', color: '#9CA3AF' }}>…</span>}
          </>)}
          {nums.map((p) => (
            <button key={p} className={`adm-pg-btn${p === page ? ' active' : ''}`} onClick={() => onPage(p)}>{p}</button>
          ))}
          {hi < pages && (<>
            {hi < pages - 1 && <span style={{ padding: '0 3px', color: '#9CA3AF' }}>…</span>}
            <button className="adm-pg-btn" onClick={() => onPage(pages)}>{pages}</button>
          </>)}
          <button className="adm-pg-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} title="Next">&#8250;</button>
        </div>
      )}
      <div className="adm-pager-r">
        <select className="adm-per-page" value={perPage} onChange={(e) => onPerPage(parseInt(e.target.value, 10) || 10)}>
          {[5, 10, 20, 50].map((n) => <option key={n} value={n}>{n} per page</option>)}
        </select>
      </div>
    </div>
  );
}
