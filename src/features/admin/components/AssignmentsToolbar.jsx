// Ported from the search/filter/sort/view-toggle bar in buildShell's
// assignments panel markup (index.html-equivalent template, core.js:1442-1467).
export default function AssignmentsToolbar({ search, onSearch, providerFilter, onProviderFilter, sort, onSort, view, onView }) {
  return (
    <div className="adm-search-bar" style={{ marginBottom: 12 }}>
      <div className="adm-search-inp-wrap">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        <input type="search" className="adm-search-inp" placeholder="Search group, bin or user…" value={search} onChange={(e) => onSearch(e.target.value)} />
      </div>
      <select className="adm-filter-sel" value={providerFilter} onChange={(e) => onProviderFilter(e.target.value)}>
        <option value="">All providers</option>
        <option value="openai">OpenAI</option>
        <option value="gemini">Gemini</option>
        <option value="openrouter">OpenRouter</option>
      </select>
      <select className="adm-filter-sel" value={sort} onChange={(e) => onSort(e.target.value)}>
        <option value="latest">Sort by: Latest</option>
        <option value="az">Sort by: A → Z</option>
        <option value="za">Sort by: Z → A</option>
        <option value="provider">Sort by: Provider</option>
      </select>
      <div className="adm-view-toggle">
        <button className={`adm-view-btn${view === 'grid' ? ' active' : ''}`} title="Card view" onClick={() => onView('grid')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
        </button>
        <button className={`adm-view-btn${view === 'table' ? ' active' : ''}`} title="Table view" onClick={() => onView('table')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
        </button>
      </div>
    </div>
  );
}
