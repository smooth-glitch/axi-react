// FIXED BUG (found via live testing with real ARM credentials): the Data
// Bin wizard's datasource list (window.DBLIST) is populated by
// loadDataSources() inside axi-databin-core.js, called once at that file's
// own boot time. Same class of bug as the admin-dashboard one-shot-timer
// fix in App.jsx: axi-databin-core.js loads (via App.jsx's deferred script
// loader) shortly after React's first render — almost certainly before an
// interactive standalone sign-in has completed — so window.mainUserName is
// still empty when loadDataSources() builds its sqlParams.pusername, and
// the ARM API call rejects with "Parameter 'pusername' is missing in input
// params." (confirmed live). window.DBLIST is left as `[]` and nothing
// ever re-populates it, since loadDataSources isn't re-triggered by
// anything and isn't exposed on window to call again from here.
//
// loadDataSources itself is a local function inside axi-databin-core.js's
// closure (not on window) so it can't be called directly — this is a
// faithful reimplementation of its request/response handling (same
// adsNames, same response shape), triggered fresh whenever the wizard's
// datasource step actually mounts instead of relying on a boot-time
// snapshot. That's strictly more correct behavior for a real user too:
// datasources added after page load would never have shown up otherwise.
export async function refreshDataSources() {
  const pusername = window.mainUserName || '';
  const puserrole = window.AxUserRoles || '';

  return new Promise((resolve) => {
    window.GetDataFromAxList(
      { adsNames: ['axi_ai_getadslist'], sqlParams: { pusername, puserrole } },
      (response) => {
        try {
          const inner = response?.result ? response : (typeof response === 'string' ? JSON.parse(response) : response);
          if (inner?.result?.success === false) {
            console.error('[dataSources] refreshDataSources: AxList reported failure:', inner.result.message, inner);
            window.DBLIST = [];
            resolve({ error: inner.result.message || 'axi_ai_getadslist datasource call failed.' });
            return;
          }
          let rows = [];
          if (inner?.result && Array.isArray(inner.result.data) && inner.result.data.length > 0) {
            rows = inner.result.data[0].data || [];
          } else if (inner?.result && Array.isArray(inner.result.row)) {
            rows = inner.result.row;
          }
          window.DBLIST = rows
            .map((item) => ({
              name: item.sqlname || item.dsname || item.name,
              caption: item.caption || item.sqlname || item.dsname || item.name,
              type: 'database',
            }))
            .filter((item) => item.name);
          resolve({ ok: true, count: window.DBLIST.length });
        } catch (e) {
          console.error('[dataSources] refreshDataSources parse error:', e, response);
          window.DBLIST = [];
          resolve({ error: e.message });
        }
      },
      (err) => {
        console.error('[dataSources] refreshDataSources failed:', err);
        window.DBLIST = [];
        resolve({ error: String(err) });
      }
    );
  });
}
