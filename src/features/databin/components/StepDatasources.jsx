import { useEffect, useMemo, useState } from 'react';
import { ensureDataPinState, useDataPinVersion, notify } from '../store';
import { getDatasourceOptions, toggleDatasourceSelection } from '../logic';
import { refreshDataSources } from '../../../services/dataSources';

// Mirrors core.js:1033-1105 renderDatasourceCards + core.js:861-895
// updateDatasourceSelectionCount. Search input mirrors core.js:1126.
export default function StepDatasources({ onExpandParam }) {
  useDataPinVersion();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(!Array.isArray(window.DBLIST) || window.DBLIST.length === 0);
  const state = ensureDataPinState();

  // FIXED BUG: window.DBLIST used to be a one-shot boot-time snapshot that
  // was reliably empty for a standalone sign-in (see services/dataSources.js
  // for the full story) and was never refreshed after that. Re-fetch every
  // time this step actually mounts instead.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refreshDataSources().finally(() => {
      if (!cancelled) {
        setLoading(false);
        notify();
      }
    });
    return () => { cancelled = true; };
  }, []);

  const allOptions = getDatasourceOptions();
  const q = search.trim().toLowerCase();
  const options = useMemo(
    () => allOptions.filter((item) =>
      String(item.label || '').toLowerCase().includes(q) || String(item.value || '').toLowerCase().includes(q)
    ),
    [allOptions, q]
  );

  const selectedCount = state.sources?.length || 0;
  const totalCount = Array.isArray(window.DBLIST) ? window.DBLIST.length : 0;
  const selectedLabels = (state.sources || []).map((s) => s.caption || s.name).slice(0, 3);
  const more = selectedCount > 3 ? ` +${selectedCount - 3} more` : '';

  async function handleClick(item) {
    const result = await toggleDatasourceSelection(item.value, item.label, {
      onAutoExpand: (idx) => onExpandParam?.(idx),
    });
    if (result?.error) {
      // Surface via the shared status area in the parent wizard.
      window.dispatchEvent(new CustomEvent('axi-databin-status', { detail: { type: 'error', message: result.error } }));
    }
  }

  return (
    <section className="dataBinPanel is-active" data-panel="datasources">
      <div className="dataBinFilesCard">
        <div className="dataBinFilesCardHead">
          <h2>Datasources</h2>
          <p>Search and select one or more datasources.</p>
        </div>

        <div className="dataBinSearchBar">
          <span className="material-icons">search</span>
          <input
            type="text"
            placeholder="Search datasource name or caption..."
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="dataBinDatasourceGrid" aria-live="polite">
          {loading ? (
            <div className="dataBinEmptyState">
              <div>
                <span className="material-icons">hourglass_top</span>
                <h3>Loading datasources…</h3>
              </div>
            </div>
          ) : !options.length ? (
            <div className="dataBinEmptyState">
              <div>
                <span className="material-icons">search_off</span>
                <h3>No datasources found</h3>
                <p>Try another search term.</p>
              </div>
            </div>
          ) : (
            options.map((item) => {
              const isSelected = !!state.sources?.some((src) => src.name === item.value);
              return (
                <button
                  key={item.value}
                  type="button"
                  className={`dataBinDatasourceCard${isSelected ? ' is-selected' : ''}`}
                  aria-pressed={isSelected ? 'true' : 'false'}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleClick(item); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(item); } }}
                >
                  <div className="dataBinDatasourceCardTop">
                    <div className="dataBinDatasourceCardIcon">
                      <span className="material-icons">table_rows</span>
                    </div>
                    <div className="dataBinDatasourceCardCheck">
                      <span className="material-icons" style={{ fontSize: 15 }}>check</span>
                    </div>
                  </div>
                  <h3 className="dataBinDatasourceCardLabel">{item.label || item.value}</h3>
                  <span className="dataBinDatasourceCardName">{item.value}</span>
                  <div className="dataBinDatasourceCardMeta">
                    <span className="material-icons" style={{ fontSize: 14 }}>layers</span>
                    <span>{isSelected ? 'Selected' : 'Click to add'}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Selection count/preview badges — id-less in the original markup beyond
            #dataBinDatasourceCount/#dataBinDatasourceAvailableCount/#dataBinSelectionPreview.
            Rendered inline here since nothing outside this feature reads those ids. */}
        <div className="dataBinDatasourceCounts" style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12, color: '#64748B' }}>
          <span>{selectedCount === 1 ? '1 selected' : `${selectedCount} selected`}</span>
          <span>{totalCount === 1 ? '1 total' : `${totalCount} total`}</span>
        </div>
        <div className="dataBinSelectionPreview">
          {!selectedLabels.length ? (
            <>
              <span className="material-icons">bookmark_added</span>
              <span>No datasources selected yet.</span>
            </>
          ) : (
            <>
              <span className="material-icons">bookmark_added</span>
              <span>{selectedLabels.join(', ')}{more}</span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
