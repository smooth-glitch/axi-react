/* ============================================================
   SANDESH ADMIN SERVICES
   Backend/persistence + runtime-bridge logic extracted verbatim (behavior-
   preserving) from axi-admin-dashboard.js so the React rewrite of the admin
   dashboard UI (axi-admin-dashboard-react.js, built from ../axi-react,
   src/features/admin) can call it without reimplementing it — same pattern
   as axi-databin-services.js for the Data Bin wizard.

   Exposes:
   - window.AxiAdminService.{getUser, fetchAll, loadRows, loadGroups, loadBins,
     buildKeyCache, saveRow, delRow, validateKey, getState, PROVS, PM}
   - window._axiSyncBinRename / window._axiSyncBinDelete — EXACT original
     global names. Called by axi-databin-core.js, axi-databin-extras.js and
     axi-databin-services.js after a bin is renamed/deleted. Must keep these
     exact names and async signatures.

   Must load after axi-databin-services.js (uses window.fetchADSData,
   window.loadSavedPins, window.SAVED_PINS_CACHE, window.DataBinStore — all
   defined there/in axi-databin-core.js) and before both axi-admin-dashboard.js
   (temporarily, during migration — nothing removed from it yet) and the React
   bundle.
   ============================================================ */
(function () {
    'use strict';

    var T = 'a__xr';
    var DS_RBAC = 'axi_ai_rbac_config';
    var DS_GRP = 'axi_ai_usergroups';
    var PROVS = ['openai', 'gemini', 'openrouter']; // anthropic hidden until MCP server is available
    var PM = {
        openai: { label: 'OpenAI', ph: 'sk-…', tc: '#15803D', bg: '#F0FDF4', bc: '#BBF7D0', dot: '#22C55E' },
        anthropic: { label: 'Claude (Anthropic)', ph: 'sk-ant-…', tc: '#6D28D9', bg: '#F5F3FF', bc: '#DDD6FE', dot: '#A78BFA' },
        gemini: { label: 'Google Gemini', ph: 'AIza…', tc: '#92400E', bg: '#FFFBEB', bc: '#FDE68A', dot: '#F59E0B' },
        openrouter: { label: 'OpenRouter', ph: 'sk-or-…', tc: '#C2410C', bg: '#FFF7ED', bc: '#FED7AA', dot: '#FB923C' }
    };

    var S = { rows: [], groups: [], bins: [], keys: {} };

    /* ── helpers ── */
    // Prefer parent.* — AxSetValue/AxSubmitData rely on jQuery ($) which only
    // exists in the parent frame; calling the window-scoped copy throws "$ is not defined".
    function axFn(n) { try { if (typeof parent !== 'undefined' && typeof parent[n] === 'function') return parent[n]; } catch (e) { } if (typeof window[n] === 'function') return window[n]; return null; }
    function axSet(f, rid, v) { var fn = axFn('AxSetValue'); if (fn) fn(T, f, String(rid), 0, String(v == null ? '' : v)); }
    function axSub(rid) { var fn = axFn('AxSubmitData'); if (fn) fn(T, String(rid)); }
    function rowId(r) { return r.a__xr1id || r.A__XR1ID || r.recordid || r.RECORDID || ''; }
    function fld(r) { for (var i = 1; i < arguments.length; i++) { var k = arguments[i]; if (r[k] !== undefined && r[k] !== null) return r[k]; } return ''; }

    function getUser() {
        try {
            var p = typeof parent !== 'undefined' ? parent : {};
            var n = (p.mainUserName || (typeof mainUserName !== 'undefined' ? mainUserName : '') || '');
            var roles = (p.AxUserRoles || (typeof AxUserRoles !== 'undefined' ? AxUserRoles : '') || '');
            var b = false, c = false;
            function truthy(v) { return !!v && v !== 'F' && v !== 'f' && v !== '0' && v !== 'false' && v !== 'False'; }
            try { b = truthy(p.getSessionValue ? p.getSessionValue('Build') : window.getSessionValue && window.getSessionValue('Build')); } catch (e) { }
            try { c = truthy(p.getSessionValue ? p.getSessionValue('AppMgrAccess') : window.getSessionValue && window.getSessionValue('AppMgrAccess')); } catch (e) { }
            var isAdmin = b || c || (n.toLowerCase() === 'admin');
            return { username: n.trim(), roles: roles, isAdmin: isAdmin };
        } catch (e) { return { username: '', roles: '', isAdmin: false }; }
    }

    /* ── data layer ── */
    async function fetchAll() { await Promise.all([loadRows(), loadGroups(), loadBins()]); buildKeyCache(); }

    async function loadRows() {
        if (typeof window.fetchADSData !== 'function') return;
        try {
            var rows = await window.fetchADSData(DS_RBAC);
            window.pendingDatabaseData = null; window.CURRENTADSDATA = null; window.CURRENTADSNAME = null;
            S.rows = (rows || []).filter(function (r) { return (fld(r, 'delete_chk', 'DELETE_CHK') || '').toString().trim() !== 'True'; });
        } catch (e) { console.warn('[AXI Admin] loadRows:', e); S.rows = []; }
    }

    async function loadGroups() {
        if (typeof window.fetchADSData !== 'function') return;
        try {
            var rows = await window.fetchADSData(DS_GRP);
            window.pendingDatabaseData = null; window.CURRENTADSDATA = null; window.CURRENTADSNAME = null;
            S.groups = (rows || []).map(function (r) {
                var v = fld(r, 'users_group_name', 'USERS_GROUP_NAME', 'groupname', 'GROUPNAME', 'group_name', 'name', 'NAME', 'value');
                var l = fld(r, 'display_name', 'DISPLAY_NAME', 'label', 'LABEL') || v;
                return { value: v, label: l };
            }).filter(function (g) { return g.value; });
        } catch (e) { console.warn('[AXI Admin] loadGroups:', e); S.groups = []; }
    }

    async function loadBins() {
        try {
            if (typeof window.loadSavedPins === 'function') await window.loadSavedPins();
            var cache = window.SAVED_PINS_CACHE || [];
            if (cache.length) { S.bins = cache.map(function (p) { return { id: p.id, name: p.name || p.id }; }); return; }
            if (window.DataBinStore) {
                var all = await window.DataBinStore.getAll();
                S.bins = (all || []).map(function (p) { return { id: p.id, name: p.name || p.id }; });
            }
        } catch (e) { console.warn('[AXI Admin] loadBins:', e); S.bins = []; }
    }

    function buildKeyCache() {
        S.keys = {};
        /* Single source of truth: axi_rbac_config only (S.rows).
           When multiple rows share the same provider, pick the most recent one
           (highest numeric record ID = most recently created). */
        var byProvider = {};
        S.rows.forEach(function (r) {
            var pRaw = fld(r, 'provider', 'PROVIDER', 'ai_provider', 'AI_PROVIDER');
            var p = (pRaw || '').toString().trim().toLowerCase();
            var kRaw = fld(r, 'providerkey', 'PROVIDERKEY', 'provider_key', 'PROVIDER_KEY',
                'apikey', 'APIKEY', 'api_key', 'API_KEY',
                'aikey', 'AIKEY', 'ai_key', 'AI_KEY');
            var k = (kRaw || '').toString().trim();
            if (p && k) {
                if (!byProvider[p]) byProvider[p] = [];
                byProvider[p].push({ key: k, rid: parseInt(rowId(r)) || 0 });
            }
        });
        Object.keys(byProvider).forEach(function (p) {
            byProvider[p].sort(function (a, b) { return b.rid - a.rid; });
            S.keys[p] = byProvider[p][0].key;
        });
        /* Never let a stale RBAC row for a provider clobber a personal key the
           admin just reconnected with via initAxiKeyFromDatasource. */
        Object.keys(S.keys).forEach(function (p) {
            if (window._AXI_PERSONAL_PROVIDERS && window._AXI_PERSONAL_PROVIDERS.has(p)) {
                delete S.keys[p];
            }
        });
        /* ── Provider-cache correction — runs ALWAYS (before possible early return) ── */
        setTimeout(function () {
            if (!window._AXI_PROVIDER_KEY_CACHE) return;
            var PROV_LIST = ['openai', 'anthropic', 'gemini', 'openrouter'];
            PROV_LIST.forEach(function (pid) {
                var inRBAC = !!(S.keys && S.keys[pid]);
                var isPersonal = !!(window._AXI_PERSONAL_PROVIDERS && window._AXI_PERSONAL_PROVIDERS.has(pid));
                if (!inRBAC && !isPersonal) {
                    window._AXI_PROVIDER_KEY_CACHE[pid] = false;
                    if (window._AXI_PROVIDER_KEYS) delete window._AXI_PROVIDER_KEYS[pid];
                }
            });
        }, 300);

        var firstProv = null;
        Object.keys(S.keys).forEach(function (p) {
            if (typeof window._AXI_PROVIDER_KEY_CACHE !== 'undefined')
                window._AXI_PROVIDER_KEY_CACHE[p] = true;
            if (window._AXI_PROVIDER_KEYS) window._AXI_PROVIDER_KEYS[p] = S.keys[p];
            if (!firstProv && p !== 'anthropic') firstProv = p;
        });

        if (!firstProv) firstProv = Object.keys(S.keys)[0] || null;
        if (!firstProv) {
            var _curProv = window._AXI_RUNTIME_PROVIDER || null;
            var _isPersonal = !!(_curProv &&
                window._AXI_PERSONAL_PROVIDERS &&
                window._AXI_PERSONAL_PROVIDERS.has(_curProv));
            if (!_isPersonal && typeof window.clearAxiRuntimeKey === 'function') {
                window.clearAxiRuntimeKey();
                window._AXI_RUNTIME_KEY = null;
                window._AXI_RUNTIME_PROVIDER = null;
                window._AXI_RUNTIME_MODEL = null;
            }
            return;
        }
        if (typeof window.setAxiRuntimeKey === 'function') {
            Object.keys(S.keys).forEach(function (p) {
                if (S.keys[p]) window.setAxiRuntimeKey(S.keys[p], p);
            });
            window.setAxiRuntimeKey(S.keys[firstProv], firstProv);
        } else {
            window._AXI_RUNTIME_PROVIDER = firstProv;
            window._AXI_RUNTIME_KEY = S.keys[firstProv] || null;
        }
        window._AXI_RUNTIME_PROVIDER = firstProv;
        window._AXI_RUNTIME_KEY = S.keys[firstProv] || null;
        try {
            localStorage.setItem('axi_api_key', S.keys[firstProv]);
            localStorage.setItem('axi_provider', firstProv);
        } catch (e) { /* private-browsing or storage full — ignore */ }

        var _tries = 0;
        function _tryUpdateBtn() {
            if (typeof window.axiSwitchProviderUpdateBtn === 'function') {
                window.axiSwitchProviderUpdateBtn(firstProv);
                _patchSwitchToProvider();
                setTimeout(function () {
                    if (!window._AXI_PROVIDER_KEY_CACHE) return;
                    var PROV_LIST = ['openai', 'anthropic', 'gemini', 'openrouter'];
                    PROV_LIST.forEach(function (pid) {
                        var inRBAC = !!(S.keys && S.keys[pid]);
                        var isPersonal = !!(window._AXI_PERSONAL_PROVIDERS && window._AXI_PERSONAL_PROVIDERS.has(pid));
                        if (!inRBAC && !isPersonal) {
                            window._AXI_PROVIDER_KEY_CACHE[pid] = false;
                            if (window._AXI_PROVIDER_KEYS) delete window._AXI_PROVIDER_KEYS[pid];
                        }
                    });
                }, 250);
            } else if (_tries++ < 20) {
                setTimeout(_tryUpdateBtn, 150);
            }
        }
        _tryUpdateBtn();
    }

    function _patchSwitchToProvider() {
        if (window._axiProviderPatched) return;
        window._axiProviderPatched = true;
        document.addEventListener('click', function (e) {
            if (e.target.closest('.axi-update-key-btn')) return;
            var item = e.target.closest('.axi-provider-item');
            if (!item) return;
            var id = (item.dataset.provider || '').toLowerCase();
            var key = S.keys[id];
            if (!key) return;
            e.stopImmediatePropagation();

            if (typeof window.setAxiRuntimeKey === 'function') {
                window.setAxiRuntimeKey(key, id);
            }
            window._AXI_RUNTIME_PROVIDER = id;
            window._AXI_RUNTIME_KEY = key;
            try {
                localStorage.setItem('axi_api_key', key);
                localStorage.setItem('axi_provider', id);
            } catch (e) { }

            if (typeof window._updateModelBadge === 'function') window._updateModelBadge();
            if (typeof window.axiSwitchProviderUpdateBtn === 'function') {
                window.axiSwitchProviderUpdateBtn(id);
            }
            if (typeof window.toast === 'function')
                window.toast('Switched to ' + id.charAt(0).toUpperCase() + id.slice(1), 'success', 2000);

            var panel = document.getElementById('axiProviderPanel');
            var btn = document.getElementById('axiProviderBtn');
            if (panel) panel.style.display = 'none';
            if (btn) btn.classList.remove('axi-provider-active');
        }, true);
    }

    /* Promise-based wrapper around the original saveRow(data, cb, onErr) callback
       shape, for cleaner use from React. Behavior (the 900ms settle wait before
       reloading rows) is unchanged. */
    function saveRow(data) {
        return new Promise(function (resolve, reject) {
            var rid = data.rid || '0';
            try {
                axSet('axusergroups', rid, data.groupname || '');
                axSet('axusername', rid, data.username || '');
                axSet('binname', rid, data.binname || '');
                axSet('provider', rid, data.provider || '');
                axSet('providerkey', rid, data.providerkey || '');
                axSet('delete_chk', rid, 'False');
                axSub(rid);
            } catch (e) {
                console.error('[AXI Admin] saveRow axSet/axSub failed:', e);
                reject(e);
                return;
            }
            setTimeout(function () {
                loadRows().then(function () {
                    try { buildKeyCache(); } catch (e) { console.warn('[AXI Admin] buildKeyCache:', e); }
                    resolve();
                }).catch(function (err) {
                    console.error('[AXI Admin] saveRow loadRows failed:', err);
                    reject(err);
                });
            }, 900);
        });
    }

    /* Promise-based wrapper around the original delRow(rid) — confirm() stays
       the caller's (React's) responsibility now, this just does the delete. */
    function delRow(rid) {
        return new Promise(function (resolve, reject) {
            var strRid = String(rid);
            if (!strRid || strRid === '0' || strRid === 'undefined' || strRid === 'null') {
                reject(new Error('Cannot delete: invalid record ID.'));
                return;
            }
            var callScriptFn = null;
            try { if (typeof parent !== 'undefined' && typeof parent.AxCallScriptAPIAsync === 'function') callScriptFn = parent.AxCallScriptAPIAsync; } catch (e) { }
            if (!callScriptFn) callScriptFn = (typeof window.AxCallScriptAPIAsync === 'function') ? window.AxCallScriptAPIAsync : null;
            if (!callScriptFn) { reject(new Error('AxCallScriptAPIAsync not available')); return; }

            S.rows = S.rows.filter(function (r) { return String(rowId(r)) !== strRid; });

            callScriptFn('script1', 'form', T, strRid, {},
                function () {
                    loadRows().then(function () {
                        S.rows = S.rows.filter(function (r) { return String(rowId(r)) !== strRid; });
                        buildKeyCache();
                        resolve();
                    });
                },
                function (err) {
                    console.error('[AXI Admin] delRow script failed:', err);
                    loadRows().then(function () { buildKeyCache(); });
                    reject(err);
                }
            );
        });
    }

    async function validateKey(prov, key) {
        if (!key || key.length < 20) throw new Error('API key is too short');
        if (/\s/.test(key)) throw new Error('API key must not contain spaces');
        if (prov === 'openai') {
            if (!key.startsWith('sk-')) throw new Error('Invalid OpenAI key — expected prefix: sk-');
            const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + key } });
            if (!res.ok) throw new Error('Invalid OpenAI key — rejected by OpenAI');
        } else if (prov === 'anthropic') {
            if (!key.startsWith('sk-ant-')) throw new Error('Invalid Anthropic key — expected prefix: sk-ant-');
            if (key.length < 40) throw new Error('Invalid Anthropic key — key is too short');
        } else if (prov === 'gemini') {
            if (!key.startsWith('AIza')) throw new Error('Invalid Gemini key — expected prefix: AIza');
            const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key));
            if (!res.ok) throw new Error('Invalid Gemini key — rejected by Google');
        } else if (prov === 'openrouter') {
            if (!key.startsWith('sk-or-')) throw new Error('Invalid OpenRouter key — expected prefix: sk-or-');
            const res = await fetch('https://openrouter.ai/api/v1/models', { headers: { 'Authorization': 'Bearer ' + key, 'HTTP-Referer': window.location.href } });
            if (!res.ok) throw new Error('Invalid OpenRouter key — rejected by OpenRouter');
        } else {
            throw new Error('Unknown provider: ' + prov);
        }
    }

    /* ── Rename-sync: called by DataBin save when the name changes ── */
    window._axiSyncBinRename = async function (oldName, newName) {
        if (!oldName || !newName || oldName.trim() === newName.trim()) return;

        try { await loadRows(); } catch (e) { console.warn('[AXI] _axiSyncBinRename loadRows:', e); }

        var affected = S.rows.filter(function (r) {
            var bn = fld(r, 'binname', 'BINNAME', 'bin_name') || '';
            return bn.split(',').map(function (s) { return s.trim(); }).indexOf(oldName.trim()) !== -1;
        });
        if (!affected.length) return;

        var fn_set = axFn('AxSetValue');
        var fn_sub = axFn('AxSubmitData');
        if (!fn_set || !fn_sub) {
            console.warn('[AXI] _axiSyncBinRename: AxSetValue/AxSubmitData not available');
            return;
        }
        affected.forEach(function (r) {
            var rid = rowId(r);
            if (!rid || rid === '0') return;
            var bn = fld(r, 'binname', 'BINNAME', 'bin_name') || '';
            var updated = bn.split(',').map(function (s) {
                return s.trim() === oldName.trim() ? newName.trim() : s.trim();
            }).join(',');

            r.binname = updated; r.BINNAME = updated;

            fn_set(T, 'axusergroups', '1', 0, fld(r, 'axusergroups', 'AXUSERGROUPS', 'groupname', 'GROUPNAME', 'group_name', 'GROUP_NAME') || '');
            fn_set(T, 'axusername', '1', 0, fld(r, 'axusername', 'AXUSERNAME', 'username', 'USERNAME') || '');
            fn_set(T, 'provider', '1', 0, fld(r, 'provider', 'PROVIDER') || '');
            fn_set(T, 'providerkey', '1', 0, fld(r, 'providerkey', 'PROVIDERKEY', 'provider_key', 'PROVIDER_KEY') || '');
            fn_set(T, 'delete_chk', '1', 0, 'False');
            fn_set(T, 'binname', '1', 0, updated);
            fn_sub(T, String(rid));
        });
    };

    window._axiSyncBinDelete = async function (deletedName) {
        if (!deletedName) return;

        try { await loadRows(); } catch (e) { console.warn('[AXI] _axiSyncBinDelete loadRows:', e); }

        var affected = S.rows.filter(function (r) {
            var bn = fld(r, 'binname', 'BINNAME', 'bin_name') || '';
            return bn.split(',').map(function (s) { return s.trim(); }).indexOf(deletedName.trim()) !== -1;
        });
        if (!affected.length) return;

        var fn_set = axFn('AxSetValue');
        var fn_sub = axFn('AxSubmitData');
        if (!fn_set || !fn_sub) {
            console.warn('[AXI] _axiSyncBinDelete: AxSetValue/AxSubmitData not available');
            return;
        }

        var callScriptFn = null;
        try { if (typeof parent !== 'undefined' && typeof parent.AxCallScriptAPIAsync === 'function') callScriptFn = parent.AxCallScriptAPIAsync; } catch (e) { }
        if (!callScriptFn && typeof window.AxCallScriptAPIAsync === 'function') callScriptFn = window.AxCallScriptAPIAsync;

        affected.forEach(function (r) {
            var rid = rowId(r);
            if (!rid || rid === '0') return;
            var bn = fld(r, 'binname', 'BINNAME', 'bin_name') || '';

            var updated = bn.split(',')
                .map(function (s) { return s.trim(); })
                .filter(function (s) { return s && s !== deletedName.trim(); })
                .join(',');

            if (!updated) {
                S.rows = S.rows.filter(function (row) { return String(rowId(row)) !== String(rid); });
                if (callScriptFn) {
                    callScriptFn('script1', 'form', T, String(rid), {},
                        function () { /* success */ },
                        function (err) { console.warn('[AXI] _axiSyncBinDelete: failed to delete assignment', rid, err); }
                    );
                }
            } else {
                r.binname = updated; r.BINNAME = updated;
                fn_set(T, 'axusergroups', '1', 0, fld(r, 'axusergroups', 'AXUSERGROUPS', 'groupname', 'GROUPNAME', 'group_name', 'GROUP_NAME') || '');
                fn_set(T, 'axusername', '1', 0, fld(r, 'axusername', 'AXUSERNAME', 'username', 'USERNAME') || '');
                fn_set(T, 'provider', '1', 0, fld(r, 'provider', 'PROVIDER') || '');
                fn_set(T, 'providerkey', '1', 0, fld(r, 'providerkey', 'PROVIDERKEY', 'provider_key', 'PROVIDER_KEY') || '');
                fn_set(T, 'delete_chk', '1', 0, 'False');
                fn_set(T, 'binname', '1', 0, updated);
                fn_sub(T, String(rid));
            }
        });
    };

    window.AxiAdminService = {
        PROVS: PROVS, PM: PM,
        getUser: getUser,
        fetchAll: fetchAll,
        loadRows: loadRows,
        loadGroups: loadGroups,
        loadBins: loadBins,
        buildKeyCache: buildKeyCache,
        saveRow: saveRow,
        delRow: delRow,
        validateKey: validateKey,
        getState: function () { return S; },
        fld: fld,
        rowId: rowId
    };

})();

if (typeof window !== "undefined") { window.SandeshAdminService = window.AxiAdminService; }
