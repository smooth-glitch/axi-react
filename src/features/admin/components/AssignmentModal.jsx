import { useEffect, useMemo, useState } from 'react';
import MultiSelect from './MultiSelect';
import { PROVS, PM, rowGroup, rowBin, rowProvider, rowKey, rowId, saveAssignment } from '../logic';

// Ported from openModal/closeModal/updateKeyHint/handleSave (core.js:974-1165)
// and the modal markup (core.js:1552-1608).
export default function AssignmentModal({ editRid, rows, groups, bins, keys, onClose, onSaved, toast }) {
  const editRow = editRid ? rows.find((r) => String(rowId(r)) === String(editRid)) : null;

  const [groupname, setGroupname] = useState(editRow ? rowGroup(editRow) : '');
  // NOTE: the original modal markup has no #adm-f-usr input at all — handleSave
  // reads it defensively (`usrEl ? usrEl.value.trim() : ''`) and always gets ''
  // since the element doesn't exist. Individual-username assignment is
  // effectively dead in the current UI (only group-based assignment works);
  // preserved as-is rather than silently adding a field the original doesn't have.
  const username = '';
  const [binname, setBinname] = useState(editRow ? rowBin(editRow) : '');
  const [provider, setProvider] = useState(editRow ? rowProvider(editRow) : '');
  const [key, setKey] = useState(editRow ? rowKey(editRow) : '');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState(null);

  // "ALWAYS refresh keys from axi_ai_rbac_config so the dropdown reflects the
  // latest connected/not-connected status" (core.js:979-989).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await window.AxiAdminService.loadRows();
        window.AxiAdminService.buildKeyCache();
      } catch (e) { console.warn('[AXI Admin] refresh on modal open:', e); }
      if (!cancelled) setRefreshing(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const selectedGroups = useMemo(() => groupname ? groupname.split(',').map((s) => s.trim()).filter(Boolean) : [], [groupname]);
  const selectedBins = useMemo(() => binname ? binname.split(',').map((s) => s.trim()).filter(Boolean) : [], [binname]);

  const groupOptions = groups.length ? groups.map((g) => ({ value: g.value, label: g.label })) : (groupname ? [{ value: groupname, label: groupname }] : []);
  const uniqueBinNames = useMemo(() => [...new Set(bins.map((b) => b.name))], [bins]);
  const binOptions = uniqueBinNames.map((n) => ({ value: n, label: n }));

  const cachedForProvider = provider ? keys[provider] : null;

  function handleProviderChange(newProv) {
    const prevKey = provider ? keys[provider] : null;
    if (newProv && keys[newProv]) {
      setKey(keys[newProv]); // configured provider → auto-fill
    } else if (prevKey && key === prevKey) {
      setKey(''); // switching from configured to unconfigured → clear the old cached key
    }
    setProvider(newProv);
  }

  async function handleSave() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await saveAssignment({
      editRid,
      groupname,
      username: username.trim(),
      binname,
      provider,
      key: key.trim(),
      rows,
    });
    setBusy(false);
    if (!result.ok) {
      // Deliberate simplification: the original used native alert() for these
      // validation messages and a toast only for the final save failure. Here
      // every failure surfaces as the same inline banner — less jarring, no
      // behavior lost.
      setError(result.message);
      return;
    }
    toast('Assignment saved');
    onSaved();
  }

  return (
    <div id="adm-overlay" role="dialog" aria-modal="true" aria-labelledby="adm-modal-title">
      <div className="adm-overlay-bg" onClick={onClose} />
      <div className="adm-modal">
        <div className="adm-modal-hd">
          <h2 className="adm-modal-title" id="adm-modal-title">{editRid ? 'Edit assignment' : 'New assignment'}</h2>
          <button className="adm-modal-x" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="adm-modal-bd">
          <div className="adm-fs">
            <div className="adm-sec">
              <p className="adm-sec-hd">Access target</p>
              <div className="adm-fld">
                <label className="adm-lbl">User group</label>
                <MultiSelect
                  options={refreshing ? [] : groupOptions}
                  selected={selectedGroups}
                  onChange={(sel) => setGroupname(sel.join(','))}
                  placeholder={refreshing ? 'Loading…' : 'Select groups…'}
                />
              </div>
              <p className="adm-hint">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                Select one or more groups. All members of the selected groups will have access to the assigned bins and provider.
              </p>
            </div>
            <div className="adm-sec">
              <p className="adm-sec-hd">Data access</p>
              <div className="adm-fld">
                <label className="adm-lbl">Data bin</label>
                <MultiSelect
                  options={refreshing ? [] : binOptions}
                  selected={selectedBins}
                  onChange={(sel) => setBinname(sel.join(','))}
                  placeholder={refreshing ? 'Loading…' : 'Select data bins…'}
                />
              </div>
            </div>
            <div className="adm-sec">
              <p className="adm-sec-hd">AI provider</p>
              <div className="adm-r2">
                <div className="adm-fld">
                  <label className="adm-lbl">Provider</label>
                  <select className="adm-sel" value={provider} onChange={(e) => handleProviderChange(e.target.value)} disabled={refreshing}>
                    <option value="">Select provider…</option>
                    {PROVS.map((p) => (
                      <option key={p} value={p}>{PM[p].label}{keys[p] ? '  ✓ Connected' : '  • Not configured'}</option>
                    ))}
                  </select>
                </div>
                <div className="adm-fld">
                  <label className="adm-lbl">API key</label>
                  <div className="adm-key-wrap">
                    <input
                      className="adm-inp"
                      type={showKey ? 'text' : 'password'}
                      placeholder="Paste key…"
                      autoComplete="new-password"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                    />
                    <button type="button" title="Show / hide key" onClick={() => setShowKey((s) => !s)} style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', color: '#888A8F', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 5 }}>
                      {showKey
                        ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                        : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>}
                    </button>
                  </div>
                  <div className="adm-hint-row">
                    {provider && (
                      cachedForProvider
                        ? <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--success,#059669)', fontWeight: 500 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success,#059669)', flexShrink: 0 }} />Connected — key loaded from existing assignment. Update if needed.</span>
                        : <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-tertiary,#888A8F)', fontWeight: 500 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#9CA3AF', flexShrink: 0 }} />Not configured — enter API key{PM[provider]?.ph ? ` (format: ${PM[provider].ph})` : ''}.</span>
                    )}
                  </div>
                </div>
              </div>
              {error && <p style={{ color: '#DC2626', fontSize: 12.5, marginTop: 10, whiteSpace: 'pre-line' }}>{error}</p>}
            </div>
          </div>
        </div>
        <div className="adm-modal-ft">
          <button className="adm-btn-s" onClick={onClose}>Cancel</button>
          <button className="adm-btn-save" id="adm-save-btn" disabled={busy || refreshing} onClick={handleSave}>
            {busy
              ? (<><span className="adm-spin" />Saving…</>)
              : (<><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>Save assignment</>)}
          </button>
        </div>
      </div>
    </div>
  );
}
