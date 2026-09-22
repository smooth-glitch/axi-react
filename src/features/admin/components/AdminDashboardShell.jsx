import { useEffect, useState } from 'react';
import AssignmentsPanel from './AssignmentsPanel';
import DataBinsPanel from './DataBinsPanel';
import Toast from './Toast';
import { useToast } from '../useToast';
import ReopenButton from './ReopenButton';

// Ported from buildShell/boot/switchTab (core.js:1194-1731, 2071-2118).
// The shell mounts once (for admin users) and stays mounted for the whole
// session; visibility toggles via `open` rather than remove/recreate, matching
// the original's persistent-DOM-with-display-toggle approach — this is what
// lets handleCreateBin/handleEditBin hide it under the Data Bin wizard and
// restore it afterward via the window._axiAdmOnClose one-shot callback.
export default function AdminDashboardShell() {
  const [open, setOpenRaw] = useState(false);
  const [hasOpenedOnce, setHasOpenedOnce] = useState(false);
  function setOpen(v) { setOpenRaw(v); if (v) setHasOpenedOnce(true); }
  const [tab, setTab] = useState('assignments');
  const [rows, setRows] = useState([]);
  const [groups, setGroups] = useState([]);
  const [bins, setBins] = useState([]);
  const [keys, setKeys] = useState({});
  const [refreshing, setRefreshing] = useState(true);
  const [toast, toastState] = useToast();

  function syncFromService() {
    const s = window.AxiAdminService.getState();
    setRows([...s.rows]);
    setGroups([...s.groups]);
    setBins([...s.bins]);
    setKeys({ ...s.keys });
  }

  async function fetchAndSync() {
    setRefreshing(true);
    await window.AxiAdminService.fetchAll();
    syncFromService();
    setRefreshing(false);
  }

  useEffect(() => {
    // boot(): fetchADSData may not be ready yet — poll like the original did.
    // Also wait for App.jsx's deferred legacy-script loader (__axiLegacyScriptsReady)
    // — axi-databin-extras.js defines syncSavedPinsDropdownSelection, which
    // loadSavedPins()/setActiveDataBin() call as a bare global; calling
    // loadSavedPins before that script has loaded throws a ReferenceError
    // (confirmed via live testing with real credentials), which — since
    // axi-databin-services.js's own catch block doesn't release the global
    // loading overlay on failure — left it stuck. Not a full fix on its own
    // (App.jsx's loader also self-heals with its own retry once everything
    // is loaded), but avoids relying on that retry as the only path.
    let cancelled = false;
    let tries = 0;
    (async function tryLoad() {
      tries++;
      if ((typeof window.fetchADSData !== 'function' || !window.__axiLegacyScriptsReady) && tries < 20) {
        setTimeout(tryLoad, 500);
        return;
      }
      if (typeof window.loadSavedPins === 'function') window.loadSavedPins().catch(() => { });
      if (!cancelled) await fetchAndSync();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function hideShell() { setOpen(false); }
  function showShellAndSync() { setOpen(true); syncFromService(); }

  return (
    <>
      <ReopenButton visible={!open} onClick={() => setOpen(true)} />
      {/* Always rendered once opened for the first time; visibility toggles via
          `display`, not mount/unmount, so search/pagination/tab state in the
          child panels survives the hide-while-wizard-is-open round trip —
          matching the original's persistent-DOM approach. */}
      {(open || hasOpenedOnce) && (
        <div id="axiadm-shell" role="dialog" aria-label="AXI Admin Dashboard" style={{ display: open ? 'flex' : 'none' }}>
          <div id="adm-tabbar" role="tablist">
            <button
              id="adm-tab-assignments"
              className={`adm-tab${tab === 'assignments' ? ' adm-tab-on' : ''}`}
              role="tab"
              aria-selected={tab === 'assignments'}
              onClick={() => setTab('assignments')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
              Assignments <span className="adm-tab-ct">{refreshing ? '—' : rows.length}</span>
            </button>
            <button
              id="adm-tab-bins"
              className={`adm-tab${tab === 'bins' ? ' adm-tab-on' : ''}`}
              role="tab"
              aria-selected={tab === 'bins'}
              onClick={() => setTab('bins')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>
              Data bins <span className="adm-tab-ct">{refreshing ? '—' : bins.length}</span>
            </button>
            <button id="adm-exit" style={{ marginLeft: 'auto' }} onClick={() => setOpen(false)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
              Back to chat
            </button>
          </div>

          <div id="adm-body">
            {tab === 'assignments' ? (
              <AssignmentsPanel
                rows={rows} groups={groups} bins={bins} keys={keys}
                refreshing={refreshing} onRefresh={fetchAndSync}
                toast={toast} onDataChanged={syncFromService}
              />
            ) : (
              <DataBinsPanel
                bins={bins} rows={rows}
                refreshing={refreshing} onRefresh={fetchAndSync}
                toast={toast} onDataChanged={syncFromService}
                onHideShell={hideShell} onShowShell={showShellAndSync}
              />
            )}
          </div>
        </div>
      )}
      <Toast state={toastState} />
    </>
  );
}
