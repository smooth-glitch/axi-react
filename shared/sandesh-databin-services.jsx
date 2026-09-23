/* ============================================================
   SANDESH DATABIN SERVICES
   Extracted verbatim from axi-databin-core.js and axi-databin-extras.js so the
   backend/persistence layer (Axpert ADS reads, AxSetValue/AxSubmitData/
   AxCallScriptAPIAsync writes, DataBinStore, active-bin state) can be shared
   by a future React UI layer without reimplementing it. Must load before
   axi-databin-core.js and axi-databin-extras.js (temporarily, during
   migration -- those files still define their own local copies of some of
   this logic; nothing has been removed from them yet) and before any new
   React bundle that calls window.DataBinStore / window.applyPin / etc.
   ============================================================ */
(function () {

    // ── Active Data Bin pointer (localStorage) ──────────────────────────
    // NOTE: in the original code these were function-local to
    // axi-databin-core.js's _axiDataBinCoreBoot() closure, NOT global.
    // axi-databin-extras.js's `typeof setActiveDataBin === "function"` /
    // `typeof getActiveDataBinId === "function"` guards (around its
    // loadSavedPins) therefore always evaluated false there -- those
    // branches were dead code. Exposing these on window here (as this
    // shared module must, so both old files and the new React UI can call
    // them) makes those two branches in axi-databin-extras.js start firing.
    // That is a real behavior change, flagged here rather than shipped
    // silently -- see the extraction report.
    window.ACTIVEDATABINKEY = "axi-active-databin-id";

    window.setActiveDataBin = function setActiveDataBin(id, name) {
        localStorage.setItem(window.ACTIVEDATABINKEY, id || "");
        syncSavedPinsDropdownSelection?.(id, name);
    };

    window.getActiveDataBinId = function getActiveDataBinId() {
        return localStorage.getItem(window.ACTIVEDATABINKEY);
    };

    // ── Data Bin draft state (the wizard's in-progress record) ──────────
    window.dataPinState = window.dataPinState || {
        sources: [],  // { name, caption }
        files: []     // File objects
    };

    window.ensureDataPinState = function ensureDataPinState() {
        if (!window.dataPinState) {
            window.dataPinState = {
                id: null,
                createdAt: null,
                sources: [],
                files: [],
                name: "My Data Bin 1"
            };
        }
        return window.dataPinState;
    };

    // ── Axpert response parsing helpers ──────────────────────────────────
    function isSessionText(raw) {
        return typeof raw === "string" && /^SessionId\b/i.test(raw.trim());
    }

    // STANDALONE-MODE FIX: this used to reject whenever `window.parent ===
    // window`, on the assumption that only ever happens by mistake (page
    // opened directly instead of inside Axpert's iframe). axi-standalone-
    // bridge.js deliberately relies on exactly that condition — a normal,
    // non-embedded top-level page — to make `parent.GetDataFromAxList`
    // resolve to its own REST-backed implementation (since parent === window
    // there). The real precondition that matters is just "is
    // GetDataFromAxList actually callable," regardless of whether that's
    // because we're embedded in Axpert or the standalone bridge installed it.
    function ensureAxpertContext() {
        if (typeof parent.GetDataFromAxList !== "function") {
            throw new Error("This page must be opened from inside Axpert with a valid parent session.");
        }
    }

    // NOTE: axi-databin-core.js currently declares parseAxpertResponseSafely
    // TWICE (once ~line 2807 without isSessionText, once ~line 2905 using
    // isSessionText). Function declarations in the same scope overwrite each
    // other in source order, so the SECOND one (below) is the one actually in
    // effect today; the first is dead code. This module keeps only the live
    // version.
    function parseAxpertResponseSafely(raw) {
        if (raw == null) return null;
        if (typeof raw !== "string") return raw;

        const text = raw.trim();
        if (!text) return null;

        if (isSessionText(text)) {
            throw new Error("Axpert session expired or invalid. Re-login and reopen this page from Axpert.");
        }

        if (!text.startsWith("{") && !text.startsWith("[")) {
            throw new Error("Axpert returned non-JSON response: " + text.slice(0, 120));
        }

        return JSON.parse(text);
    }

    function _axiExtractRowsFromAdsResponse(response) {
        const outer = parseAxpertResponseSafely(response);
        const dContent = outer && outer.d ? outer.d : outer;
        const inner = parseAxpertResponseSafely(dContent);

        if (inner?.result?.success === false) {
            throw new Error(inner?.result?.message || "Axpert ADS error");
        }

        if (inner?.result && Array.isArray(inner.result.data) && inner.result.data.length > 0) {
            return inner.result.data[0].data || [];
        }
        if (inner?.result && Array.isArray(inner.result.row)) {
            return inner.result.row || [];
        }
        if (Array.isArray(inner)) return inner;
        return [];
    }

    // ── ADS read ─────────────────────────────────────────────────────────
    function _axiGetAdsRows(adsName, sqlParams = {}) {
        return new Promise(function (resolve, reject) {
            try {
                ensureAxpertContext();
                if (!adsName) return resolve([]);

                const params = {
                    adsNames: [adsName],
                    refreshCache: true,
                    sqlParams: sqlParams || {}
                };

                parent.GetDataFromAxList(params, function (response) {
                    try {
                        if (isSessionText(response)) {
                            reject(new Error("Axpert session expired. Re-login and reopen this page from Axpert."));
                            return;
                        }
                        const rows = _axiExtractRowsFromAdsResponse(response);
                        resolve(Array.isArray(rows) ? rows : []);
                    } catch (e) {
                        reject(e);
                    }
                });
            } catch (e) {
                reject(e);
            }
        });
    }
    window._axiGetAdsRows = _axiGetAdsRows;

    function _normalizeBinRow(row) {
        const r = row || {};
        // bin_id is the user-facing logical ID; recordid is the Axpert internal row ID
        const id =
            r.bin_id || r.id || r.binid || r.databinid || r.databin_id || r.databinid_pk;
        /* Axpert returns the raw column name (the "recordid" SQL alias is NOT applied).
           For tstruct a__xd, the auto-generated PK column is a__xd1id (and uppercase
           variant). Without these aliases, recordid stays empty → save creates a new
           row instead of updating the existing one (the editing bug). */
        const recordid =
            r.axai_datasources_detailsid || r.AXAI_DATASOURCES_DETAILSID ||
            r.a__xd1id || r.A__XD1ID ||
            r.recordid || r.RECORDID || r.record_id || r.RECORD_ID ||
            r.transid || r.TRANSID || "";
        const name =
            r.name || r.bin_name || r.binname || r.databinname || r.caption || r.title || r.bin_caption || r.databin_caption;

        function tryJson(v) {
            if (v == null) return null;
            if (typeof v === "object") return v;
            const s = String(v).trim();
            if (!s || s === '-') return null;
            try { return JSON.parse(s); } catch (_) { return null; }
        }

        // Datasources: may be JSON, CSV, or a single string.
        const dsRaw =
            r.datasources || r.datasource || r.datasource_details || r.datasource_list || r.ds_list || r.ds ||
            r.datasource_names || r.ds_names || r.dsname || r.dsname_list;
        let datasources = [];
        if (dsRaw && String(dsRaw).trim() !== '-') {
            const parsedDs = tryJson(dsRaw);
            if (Array.isArray(parsedDs)) {
                datasources = parsedDs;
            } else if (typeof dsRaw === "string" && dsRaw.includes(",")) {
                datasources = dsRaw.split(",").map(s => ({ name: s.trim(), caption: s.trim(), type: "database" })).filter(x => x.name);
            } else if (dsRaw) {
                const v = String(dsRaw).trim();
                if (v) datasources = [{ name: v, caption: v, type: "database" }];
            }
        }
        datasources = (datasources || []).map(function (s) {
            if (!s) return null;
            if (typeof s === "string") return { name: s, caption: s, type: "database", sqlParams: {} };
            const nm = s.name || s.dsname || s.sqlname || s.value;
            const cap = s.caption || s.label || nm;
            if (!nm) return null;
            const sp = (s.sqlParams && typeof s.sqlParams === 'object') ? s.sqlParams : {};
            return { name: nm, caption: cap || nm, type: "database", sqlParams: sp };
        }).filter(Boolean);

        // Files: remote bins typically store metadata only (name/type/size/lastModified)
        const filesRaw = r.files || r.file_list || r.file_meta || r.file_names || r.document_details;
        let files = [];
        if (filesRaw && String(filesRaw).trim() !== '-') {
            const parsedFiles = tryJson(filesRaw);
            if (Array.isArray(parsedFiles)) {
                files = parsedFiles;
            } else if (typeof filesRaw === "string" && filesRaw.includes(",")) {
                files = filesRaw.split(",").map(s => ({ name: s.trim() })).filter(f => f.name);
            } else if (filesRaw) {
                const v = String(filesRaw).trim();
                if (v) files = [{ name: v }];
            }
        }
        files = (files || []).map(function (f) {
            if (!f) return null;
            if (typeof f === "string") return { name: f };
            return {
                name: f.name,
                type: f.type || "application/octet-stream",
                size: f.size || 0,
                lastModified: f.lastModified || Date.now(),
                data: f.data || null  // base64 content embedded in DB — preserved for server-side file analysis
            };
        }).filter(f => f && f.name);

        const createdAt = Number(r.createdAt || r.created_at || r.crtdt || r.createdon || r.created_on || 0) || Date.now();
        const updatedAt = Number(r.updatedAt || r.updated_at || r.upddt || r.updatedon || r.updated_on || 0) || createdAt;

        return {
            id: String(id || "").trim(),
            recordid: String(recordid || "").trim(),
            userKey: r.userKey || r.user_key || r.owner || r.createdby || r.created_by || "",
            name: String(name || "Untitled Data Bin"),
            createdAt,
            updatedAt,
            datasources,
            files,
            raw: r
        };
    }

    function _resolveAxFns() {
        // Prefer parent.* — AxSetValue/AxSubmitData rely on jQuery ($) which only
        // exists in the parent frame; calling the window-scoped copy throws "$ is not defined".
        function _pickFn(name) {
            try { if (typeof parent !== 'undefined' && typeof parent[name] === 'function') return parent[name]; } catch (e) { }
            if (typeof window[name] === 'function') return window[name];
            return null;
        }
        const setterFn = _pickFn('AxSetValue');
        const submitFn = _pickFn('AxSubmitData');
        if (!setterFn || !submitFn) {
            throw new Error("AxSetValue or AxSubmitData not available. This page must run inside Axpert.");
        }
        return { setterFn, submitFn };
    }

    function _saveDataBinRemote(record) {
        const { setterFn, submitFn } = _resolveAxFns();
        const tstruct = 'a__xd';
        // If record has an Axpert recordid, we're updating; otherwise creating (0 = new)
        const axRecordId = record.recordid || '0';
        const isUpdate = axRecordId && axRecordId !== '0';

        try {
            setterFn(tstruct, 'bin_id', '1', 0, String(record.id || ''));
            setterFn(tstruct, 'bin_name', '1', 0, String(record.name || ''));
            setterFn(tstruct, 'datasource_details', '1', 0, (record.datasources && record.datasources.length) ? JSON.stringify(record.datasources) : '-');
            setterFn(tstruct, 'document_details', '1', 0, (record.files && record.files.length) ? JSON.stringify(record.files) : '-');
            submitFn(tstruct, axRecordId);
            console.log('[DataBin] ' + (isUpdate ? 'Updated' : 'Created') + ' tstruct a__xd:', record.id, record.name, 'axRecordId=' + axRecordId);
        } catch (err) {
            console.error('[DataBin] AxSetValue/AxSubmitData failed:', err);
            throw new Error('Failed to save Data Bin to server: ' + (err.message || err));
        }
    }

    async function _deleteDataBinRemote(id) {
        let axRecordId = '0';
        try {
            const bin = await _axiGetAdsRows("axi_ai_bin", {});
            const row = (bin || []).map(_normalizeBinRow).find(b => b.id === id);
            if (row && row.recordid) axRecordId = row.recordid;
        } catch (_) { }

        if (!axRecordId || axRecordId === '0') {
            throw new Error("Cannot delete: Axpert recordid not found for bin_id=" + id);
        }

        // Prefer parent: AxInterface functions rely on jQuery ($) which is only
        // available in the parent frame, not in this embedded page.
        const callScriptFn = (typeof parent !== 'undefined' && typeof parent.AxCallScriptAPIAsync === 'function') ? parent.AxCallScriptAPIAsync
            : (typeof window.AxCallScriptAPIAsync === 'function') ? window.AxCallScriptAPIAsync
                : null;
        if (!callScriptFn) {
            throw new Error("AxCallScriptAPIAsync not available. This page must run inside Axpert.");
        }
        const tstruct = 'a__xd';
        await new Promise(function (resolve, reject) {
            callScriptFn('script1', 'form', tstruct, axRecordId, {}, resolve, reject);
        });
        console.log('[DataBin] Delete script called for bin_id:', id, 'recordid:', axRecordId);
    }

    // ── Data Bin CRUD store ──────────────────────────────────────────────
    window.DataBinStore = {
        async getAll() {
            const rows = await _axiGetAdsRows("axi_ai_bin", {});
            const bins = (rows || []).map(_normalizeBinRow).filter(b => b.id);
            bins.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            return bins;
        },
        async getById(id) {
            if (!id) return null;
            // The Axpert ADS always returns ALL rows regardless of sqlParams —
            // server-side filtering by bin_id is not supported. Fetch all and
            // find the exact match using String comparison (avoids type mismatch).
            const all = await this.getAll();
            return all.find(b => String(b.id) === String(id)) || null;
        },
        async save(record) {
            if (!record) throw new Error("Missing record");
            _saveDataBinRemote(record);

            // Poll the server for the freshly written row instead of a blind wait.
            // Slow servers used to drop out of a single 1200ms wait with fresh=null,
            // leaving record.recordid='' — the next save then created a duplicate
            // row (axRecordId='0' = new). Retry up to ~6s and bail early.
            let fresh = null;
            const POLL_DELAYS_MS = [500, 700, 900, 1200, 1500, 1500]; // ~6.3s worst case
            for (let i = 0; i < POLL_DELAYS_MS.length; i++) {
                await new Promise(function (r) { setTimeout(r, POLL_DELAYS_MS[i]); });
                try {
                    fresh = await this.getById(record.id);
                } catch (e) {
                    // transient ADS read failure — keep retrying
                    fresh = null;
                }
                if (fresh && fresh.recordid) break;
            }

            if (fresh && fresh.recordid) record.recordid = fresh.recordid;
            console.log('[DataBin] After save, fetched recordid:', record.recordid || '(not found)');
            return fresh || record;
        },
        async delete(id) {
            if (!id) return;
            await _deleteDataBinRemote(id);
            return true;
        }
    };

    window.deleteDataBin = async function (id) {
        if (!id || !window.DataBinStore) return;

        const pin = await window.DataBinStore.getById(id);
        await window.DataBinStore.delete(id);

        const activeId = typeof getActiveDataBinId === "function" ? getActiveDataBinId() : null;
        const deletingActive =
            (window.ACTIVEDATABINCONTEXT && String(window.ACTIVEDATABINCONTEXT.id) === String(id)) ||
            (String(activeId) === String(id));

        if (deletingActive) {
            localStorage.removeItem(window.ACTIVEDATABINKEY);
            const valueEl = document.getElementById("savedPinsValue");
            if (valueEl) { valueEl.textContent = "Load Pin..."; valueEl.title = "No Data Bin selected"; }
            window.ACTIVEDATABINCONTEXT = null;
            window.ACTIVE_DATABIN_CONTEXT = null;
            window.ACTIVEDATABINAIPAYLOAD = null;
            window.pendingDatabaseData = null;
            const promptInput = document.getElementById('prompt');
            if (promptInput) { promptInput.value = ''; promptInput.dispatchEvent(new Event('input', { bubbles: true })); }
            const statusEl = document.getElementById('promptStatus');
            if (statusEl) statusEl.textContent = '';
        }

        await window.loadSavedPins?.();

        if (deletingActive) {
            const newCtx = window.ACTIVEDATABINCONTEXT;
            const promptEl = document.getElementById('prompt');
            if (newCtx && newCtx.name && promptEl) {
                promptEl.value = 'Analyze Data Bin ' + newCtx.name;
                promptEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    };

    // ── ADS parameter probing (used by both the param editor UI and save flow) ──
    // Probe cache — keyed by ADS name, persists for the session
    window._axiParamProbeCache = window._axiParamProbeCache || {};
    // Set of ADS names currently being probed (prevents double-click re-entry)
    window._axiProbingADS = window._axiProbingADS || new Set();

    /**
     * Parse an Axpert error message for bind-variable names and their types.
     * Handles :param_name  @param_name  "parameter 'name'"  "name (Type/System.Type)"
     */
    function _parseParamsFromError(msg) {
        if (!msg) return [];
        var params = [], seen = new Set();
        function add(name, type) {
            if (!name || name.length < 2 || seen.has(name)) return;
            seen.add(name);
            var t = (type || '').toLowerCase();
            var norm = t.includes('int') ? 'Integer'
                : t.includes('decimal') || t.includes('double') || t.includes('float') ? 'Decimal'
                    : t.includes('date') ? 'Date'
                        : t.includes('bool') ? 'Boolean' : 'String';
            params.push({ name: name, type: norm });
        }
        var m;
        var bp = /[@:][a-zA-Z][a-zA-Z0-9_]+/g;
        while ((m = bp.exec(msg)) !== null) {
            var tm = msg.slice(m.index).match(/\(([A-Za-z]+)(?:\/[^)]+)?\)/);
            add(m[0].slice(1), tm ? tm[1] : 'String');
        }
        var ap = /([a-zA-Z][a-zA-Z0-9_]+)\s*\(([A-Za-z]+)\/System\.[A-Za-z]+\)/g;
        while ((m = ap.exec(msg)) !== null) add(m[1], m[2]);
        var pp = /\bparam(?:eter)?\s+['"]([a-zA-Z][a-zA-Z0-9_]+)['"]/gi;
        while ((m = pp.exec(msg)) !== null) add(m[1], 'String');
        return params;
    }

    /**
     * Probe a datasource with empty sqlParams.
     * Returns { status: 'clean'|'parameterized'|'unknown', params:[{name,type}] }
     * Always resolves, never rejects.
     */
    async function _probeADSParams(adsName) {
        if (window._axiParamProbeCache[adsName]) return window._axiParamProbeCache[adsName];
        var allParams = [], seen = new Set(), currentParams = {};
        var maxPasses = 15; // safety cap — no real query has >15 params
        for (var pass = 0; pass < maxPasses; pass++) {
            try {
                await window.fetchADSData(adsName, currentParams);
                // Success — no more missing params
                break;
            } catch (err) {
                var parsed = _parseParamsFromError(err.message || String(err));
                var newParams = parsed.filter(function (p) { return !seen.has(p.name); });
                if (!newParams.length) break; // different error, stop probing
                newParams.forEach(function (p) {
                    seen.add(p.name);
                    allParams.push(p);
                    currentParams[p.name] = ''; // supply empty so Axpert moves past this param
                });
            }
        }
        var result = allParams.length > 0
            ? { status: 'parameterized', params: allParams }
            : { status: 'clean', params: [] };
        window._axiParamProbeCache[adsName] = result;
        return result;
    }
    window._probeADSParams = _probeADSParams;

    // ── Saved-pins cache + list loader (header dropdown) ────────────────
    // NOTE: this function is ~90% DOM/UI rendering for the header's
    // "Load Pin..." dropdown (#savedPinsWrapper/#savedPinsList), not pure
    // persistence — it was moved here verbatim per the extraction brief
    // because it owns window.SAVED_PINS_CACHE and is the thing that decides
    // which bin auto-applies on load. Treat it as UI-adjacent, not a clean
    // service function, when planning the React rewrite.
    window.SAVED_PINS_CACHE = [];

    window.loadSavedPins = async function () {
        function _releaseBoot() {
            if (window._axiKeepLoaderForData) {
                window._axiKeepLoaderForData = false;
                window.hideLoader?.();
            }
        }

        try {
            if (!window.DataBinStore || !window.DataBinStore.getAll) { window.axiSetEmptyState?.(true); _releaseBoot(); return; }

            const pins = await window.DataBinStore.getAll();
            const wrapper = document.getElementById("savedPinsWrapper");
            const list = document.getElementById("savedPinsList");
            const trigger = document.getElementById("savedPinsTrigger");
            const valueEl = document.getElementById("savedPinsValue");

            if (!wrapper || !list || !trigger || !valueEl) { _releaseBoot(); return; }

            const sortedPins = (pins || []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            window.SAVED_PINS_CACHE = sortedPins;

            if (!sortedPins.length) {
                wrapper.style.display = "none";
                list.innerHTML = "";
                window.axiSetEmptyState?.(true);
                _releaseBoot();
                return;
            }

            window.axiSetEmptyState?.(false);
            wrapper.style.display = "block";

            // ── Determine which bin is currently active ──────────────────
            // Priority: in-memory context (set by applyPin) > localStorage
            // Never fall back to auto-selecting if a context is already live.
            const alreadyActive = !!window.ACTIVEDATABINCONTEXT;
            let activeId = alreadyActive
                ? window.ACTIVEDATABINCONTEXT.id
                : (typeof getActiveDataBinId === "function" ? getActiveDataBinId() : null);

            if (!activeId && sortedPins[0]) {
                activeId = sortedPins[0].id;
                if (!alreadyActive && typeof setActiveDataBin === "function") {
                    setActiveDataBin(sortedPins[0].id, sortedPins[0].name);
                }
            }

            // ── Render list HTML ─────────────────────────────────────────
            const isEmp = !!window._axiIsClientEmployee;
            list.innerHTML = sortedPins.map(function (pin) {
                const srcCount = pin.datasources?.length || 0;
                const fileCount = pin.files?.length || 0;
                const isActive = String(pin.id) === String(activeId);
                return `
                <li class="custom-option ${isActive ? "selected" : ""}" data-id="${pin.id}" title="${escapeHtml(pin.name || 'Untitled Data Bin')} • ${srcCount} datasource${srcCount === 1 ? '' : 's'} • ${fileCount} file${fileCount === 1 ? '' : 's'}">
                  <div class="savedPinRow">
                    <div class="savedPinMain">
                      <span class="savedPinTitle">${escapeHtml(pin.name || "Untitled Data Bin")}</span>
                      <span class="savedPinMeta">${srcCount} datasource${srcCount === 1 ? "" : "s"} • ${fileCount} file${fileCount === 1 ? "" : "s"}</span>
                    </div>
                    ${isEmp ? "" : `
                    <div class="savedPinActions">
                      <button type="button" class="savedPinActionBtn" data-action="edit" data-id="${pin.id}" aria-label="Edit Data Bin" title="Edit Data Bin">
                        <span class="material-icons">edit</span>
                      </button>
                      <button type="button" class="savedPinActionBtn savedPinActionBtn--danger" data-action="delete" data-id="${pin.id}" data-name="${escapeHtml(pin.name || 'Untitled Data Bin')}" aria-label="Delete Data Bin" title="Delete Data Bin">
                        <span class="material-icons">delete</span>
                      </button>
                    </div>`}
                  </div>
                </li>`;
            }).join("");

            // Sticky footer — injected once outside the scrollable <ul>
            const _footerContainer = list.closest('.custom-options-container');
            if (!isEmp) {
                if (_footerContainer && !_footerContainer.querySelector('.dataBinCreateFooter')) {
                    const footer = document.createElement('div');
                    footer.className = 'custom-option dataBinCreateOption dataBinCreateFooter';
                    footer.dataset.action = 'new';
                    footer.innerHTML = `<div style="display:flex;align-items:center;gap:10px;font-weight:600;color:#0F172A;">
        <span class="material-icons" style="font-size:18px;color:#F28C28;">add_circle</span>
        <span>Add new Data Bin</span>
    </div>`;
                    _footerContainer.appendChild(footer);
                }
            } else {
                // Non-admin: always purge the footer in case it was injected before the role flag was ready
                _footerContainer?.querySelector('.dataBinCreateFooter')?.remove();
            }

            // ── Search bar — wire up ONCE, reset on each re-render ──────
            (function _wireSearch() {
                var searchInput = document.getElementById('savedPinsSearch');
                if (!searchInput) return;
                searchInput.value = '';
                if (!searchInput._axiSearchBound) {
                    searchInput._axiSearchBound = true;
                    searchInput.addEventListener('input', function () {
                        var q = this.value.trim().toLowerCase();
                        var items = document.querySelectorAll('#savedPinsList .custom-option');
                        items.forEach(function (item) {
                            var name = (item.querySelector('.savedPinTitle') ? item.querySelector('.savedPinTitle').textContent : '').toLowerCase();
                            var meta = (item.querySelector('.savedPinMeta') ? item.querySelector('.savedPinMeta').textContent : '').toLowerCase();
                            item.style.display = (!q || name.includes(q) || meta.includes(q)) ? '' : 'none';
                        });
                    });
                    searchInput.addEventListener('click', function (e) { e.stopPropagation(); });
                    searchInput.addEventListener('mousedown', function (e) { e.stopPropagation(); });
                    searchInput.addEventListener('keydown', function (e) { e.stopPropagation(); });
                }
                document.querySelectorAll('#savedPinsList .custom-option').forEach(function (item) {
                    item.style.display = '';
                });
            })();

            // ── Trigger (open/close) — re-assign safely ──────────────────
            trigger.onclick = function (e) {
                e.preventDefault();
                e.stopPropagation();
                /* BUG-3 FIX: close template panel before opening DataBin */
                if (!wrapper.classList.contains('open') && typeof closeTplPanel === 'function') closeTplPanel();
                // ── Close Provider panel if open ──
                const _pp = document.getElementById('axiProviderPanel');
                if (_pp && _pp.style.display === 'block') {
                    if (typeof closePanel === 'function') closePanel();
                    else { _pp.style.display = 'none'; document.getElementById('axiProviderBtn')?.classList.remove('axi-provider-active'); }
                }
                wrapper.classList.toggle("open");
                if (!wrapper.classList.contains('open')) {
                    var _si = document.getElementById('savedPinsSearch');
                    if (_si) { _si.value = ''; document.querySelectorAll('#savedPinsList .custom-option').forEach(function (el) { el.style.display = ''; }); }
                } else { setTimeout(function () { var _si = document.getElementById('savedPinsSearch'); if (_si) _si.focus(); }, 50); }
            };
            trigger.onkeydown = function (e) {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    /* BUG-3 FIX: close template panel before opening DataBin */
                    if (!wrapper.classList.contains('open') && typeof closeTplPanel === 'function') closeTplPanel();
                    // ── Close Provider panel if open ──
                    const _pp = document.getElementById('axiProviderPanel');
                    if (_pp && _pp.style.display === 'block') {
                        if (typeof closePanel === 'function') closePanel();
                        else { _pp.style.display = 'none'; document.getElementById('axiProviderBtn')?.classList.remove('axi-provider-active'); }
                    }
                    wrapper.classList.toggle("open");
                    if (!wrapper.classList.contains('open')) {
                        var _si = document.getElementById('savedPinsSearch');
                        if (_si) { _si.value = ''; document.querySelectorAll('#savedPinsList .custom-option').forEach(function (el) { el.style.display = ''; }); }
                    } else { setTimeout(function () { var _si = document.getElementById('savedPinsSearch'); if (_si) _si.focus(); }, 50); }
                }
            };

            // ── Click delegation — attach ONCE to wrapper ────────────────
            // Uses a flag so repeated loadSavedPins calls never double-bind.
            if (!wrapper._axiClickBound) {
                wrapper._axiClickBound = true;

                wrapper.addEventListener("click", async function (e) {
                    // ── Action buttons (edit / delete) ───────────────────
                    const actionBtn = e.target.closest(".savedPinActionBtn");
                    if (actionBtn) {
                        e.preventDefault();
                        e.stopPropagation();
                        const id = actionBtn.dataset.id;
                        const action = actionBtn.dataset.action;
                        if (!id) return;

                        if (action === "edit") {
                            wrapper.classList.remove("open");
                            await window.openExistingDataBin?.(id);
                            return;
                        }
                        if (action === "delete") {
                            /* BUG-4 FIX: require confirmation before deleting */
                            const binName = actionBtn.dataset.name || 'this Data Bin';
                            if (!confirm('Delete "' + binName + '"?\n\nThis cannot be undone.')) return;
                            wrapper.classList.remove("open");
                            window.showLoader("Deleting Data Bin...");
                            await new Promise(r => setTimeout(r, 50)); // flush paint before async work
                            try {
                                await window.deleteDataBin?.(id);
                                // Sync: strip this bin from all assignment rows (same logic as admin handleDelBin)
                                if (typeof window._axiSyncBinDelete === 'function') await window._axiSyncBinDelete(binName);
                                await window.loadSavedPins?.();
                            } finally {
                                window.hideLoader();
                            }
                            return;
                        }
                        return;
                    }

                    // ── Option rows ──────────────────────────────────────
                    const option = e.target.closest(".custom-option");
                    if (!option || option.classList.contains("disabled")) return;

                    e.preventDefault();
                    e.stopPropagation();

                    const action = option.dataset.action;
                    if (action === "new") {
                        wrapper.classList.remove("open");
                        await window.startNewDataBin?.();
                        return;
                    }

                    // ── Select a bin ─────────────────────────────────────
                    const id = String(option.dataset.id || "").trim();
                    if (!id) return;

                    // Look up in live cache — always current after any loadSavedPins call
                    const pin = (window.SAVED_PINS_CACHE || []).find(p => String(p.id) === id);
                    if (!pin) return;

                    // Skip if this bin is already loaded
                    if (String(window.ACTIVEDATABINCONTEXT?.id) === id) {
                        wrapper.classList.remove("open");
                        return;
                    }

                    wrapper.classList.remove("open");
                    window.showLoader(`Loading "${pin.name || "Data Bin"}"…`);
                    try {
                        await window.applyPin(pin.id);
                        // Refresh selected state in list
                        wrapper.querySelectorAll(".custom-option").forEach(function (el) {
                            el.classList.toggle("selected", String(el.dataset.id) === id);
                        });
                        // Update trigger label
                        const valEl = document.getElementById("savedPinsValue");
                        if (valEl) valEl.textContent = pin.name || "Data Bin";
                    } catch (err) {
                        console.error("[AXI] Failed to switch Data Bin:", err);
                        // Show a self-contained error banner — no dependency on
                        // external toast functions that may be out of scope here.
                        (function _showBinErr(msg) {
                            var existing = document.getElementById('_axiBinErrBanner');
                            if (existing) existing.remove();
                            var banner = document.createElement('div');
                            banner.id = '_axiBinErrBanner';
                            banner.style.cssText =
                                'position:fixed;top:24px;right:24px;' +
                                'max-width:520px;width:calc(100% - 48px);background:#1e293b;color:#f8fafc;' +
                                'padding:12px 16px;border-radius:10px;font-size:13px;line-height:1.5;' +
                                'box-shadow:0 8px 24px rgba(0,0,0,.35);z-index:99999;' +
                                'border-left:4px solid #ef4444;cursor:pointer;';
                            banner.innerHTML =
                                '<strong style="color:#fca5a5;">Data Bin error</strong><br>' +
                                msg.replace(/</g, '<').replace(/>/g, '>');
                            banner.title = 'Click to dismiss';
                            var t = setTimeout(function () { banner.remove(); }, 5000);
                            banner.addEventListener('click', function () { clearTimeout(t); banner.remove(); });
                            document.body.appendChild(banner);
                        })(err.message || 'Failed to load Data Bin. Please try again.');
                    } finally {
                        window.hideLoader();
                    }
                });
            }

            // ── Update trigger label to reflect active bin ────────────────
            const activePin = sortedPins.find(p => String(p.id) === String(activeId)) || null;
            valueEl.textContent = activePin?.name || "Load Pin...";
            valueEl.title = activePin?.name || "No Data Bin selected";

            // ── Auto-apply on first page load ONLY ────────────────────────
            // If a bin is already in memory, nothing to do — the user's context is intact.
            if (!alreadyActive && activeId && typeof window.applyPin === "function") {
                try {
                    await window.applyPin(activeId);
                } catch (e) {
                    console.warn("[AXI] Auto-apply on load failed:", e.message);
                    (function _showBinErr(msg) {
                        var existing = document.getElementById('_axiBinErrBanner');
                        if (existing) existing.remove();
                        var banner = document.createElement('div');
                        banner.id = '_axiBinErrBanner';
                        banner.style.cssText =
                            'position:fixed;top:24px;right:24px;' +
                            'max-width:520px;width:calc(100% - 48px);background:#1e293b;color:#f8fafc;' +
                            'padding:12px 16px;border-radius:10px;font-size:13px;line-height:1.5;' +
                            'box-shadow:0 8px 24px rgba(0,0,0,.35);z-index:99999;' +
                            'border-left:4px solid #ef4444;cursor:pointer;';
                        banner.innerHTML =
                            '<strong style="color:#fca5a5;">Data Bin error</strong><br>' +
                            msg.replace(/</g, '<').replace(/>/g, '>');
                        banner.title = 'Click to dismiss';
                        var t = setTimeout(function () { banner.remove(); }, 5000);
                        banner.addEventListener('click', function () { clearTimeout(t); banner.remove(); });
                        document.body.appendChild(banner);
                    })(e.message || 'Failed to auto-load the active Data Bin.');
                } finally {
                    _releaseBoot();
                }
            } else {
                _releaseBoot();
            }

        } catch (err) {
            console.error("Failed to load saved Data Bins", err);
            window.axiSetEmptyState?.(true);
        }
    };

    // ── Active Data Bin context (hydrates rows + files for chat/AI use) ──
    window.ACTIVE_DATABIN_CONTEXT = null;
    window.ACTIVEDATABINCONTEXT = null;
    window.IS_APPLYING_DATABIN = false;
    window.ACTIVE_DATABIN_REQUEST = 0;

    window.buildActiveDataBinContext = async function (id) {
        if (!id) throw new Error("Missing Data Bin id.");
        if (!window.DataBinStore) throw new Error("DataBinStore is not available.");

        const pin = await window.DataBinStore.getById(id);
        if (!pin) throw new Error("Data Bin not found.");

        const validSources = (pin.datasources || []).filter(function (src) {
            return src && src.name;
        });

        let datasourcePayloads = [];

        // Fetch every datasource individually so each one receives its own
        // admin-configured sqlParams. A batch call would share one sqlParams
        // object across all sources, making per-source params impossible and
        // causing parameterized sources to silently return no data (Bug 3 & 4).
        // Promise.all lets us name the exact failing datasource in the error (Bug 1 & 2).
        datasourcePayloads = await Promise.all(validSources.map(async function (src) {
            const sp = (src.sqlParams && typeof src.sqlParams === 'object') ? src.sqlParams : {};
            let rows;
            try {
                rows = await window.fetchADSData(src.name, sp);
            } catch (fetchErr) {
                // Re-throw naming the specific datasource so the error message
                // shown in the chat-page dropdown tells the user exactly what to fix.
                throw new Error(
                    `Datasource "${src.caption || src.name}" failed to load: ` +
                    `${fetchErr.message || fetchErr}. ` +
                    `Edit this Data Bin and check the parameters for "${src.caption || src.name}".`
                );
            }
            return {
                name: src.name,
                caption: src.caption || src.name,
                rows: Array.isArray(rows) ? rows : []
            };
        }));

        // Hydrate real File objects for analysis.
        // Priority 1: base64 content embedded in the DB record (server-side,
        //             device-independent — works on any browser, any session).
        // Priority 2: AxiLibrary IndexedDB / localStorage (browser-local cache,
        //             catches files saved before Option-A was deployed).
        // Priority 3: metadata-only stub — triggers "content unavailable" notice.
        const _rawFileList = (pin.files || []).map(function (f) {
            if (!f) return null;
            return typeof f === "string" ? { name: f } : f;
        }).filter(function (f) { return f && f.name; });

        const fileObjects = await Promise.all(_rawFileList.map(async function (f) {
            // ── Priority 1: DB-embedded base64 ──────────────────────────
            if (f.data) {
                try {
                    var byteStr = atob(f.data);
                    var ab = new ArrayBuffer(byteStr.length);
                    var ia = new Uint8Array(ab);
                    var chunk = 8192;
                    for (var i = 0; i < byteStr.length; i += chunk) {
                        var end = Math.min(i + chunk, byteStr.length);
                        for (var j = i; j < end; j++) ia[j] = byteStr.charCodeAt(j);
                    }
                    var blob = new Blob([ab], { type: f.type || 'application/octet-stream' });
                    return new File([blob], f.name, {
                        type: f.type || 'application/octet-stream',
                        lastModified: f.lastModified || Date.now()
                    });
                } catch (e) {
                    console.warn('[DataBin] DB content decode failed for', f.name, e);
                }
            }
            // ── Priority 2: AxiLibrary (IndexedDB → localStorage) ────────
            if (window.AxiLibrary && typeof AxiLibrary.getFileObj === "function") {
                try {
                    const fileObj = await AxiLibrary.getFileObj(f.name);
                    if (fileObj) return fileObj;
                } catch (e) {
                    console.warn("[DataBin] AxiLibrary.getFileObj failed for", f.name, e);
                }
            }
            // ── Priority 3: metadata-only stub ───────────────────────────
            return {
                name: f.name,
                type: f.type || "application/octet-stream",
                size: f.size || 0,
                lastModified: f.lastModified || Date.now()
            };
        }));

        const combinedRows = datasourcePayloads.flatMap(function (ds) {
            return (ds.rows || []).map(function (row) {
                return {
                    __source: ds.name,
                    __sourceCaption: ds.caption,
                    ...row
                };
            });
        });

        return {
            id: pin.id,
            name: pin.name || "Untitled Data Bin",
            datasources: datasourcePayloads,
            files: fileObjects,
            combinedDatabaseRows: combinedRows,
            rawPin: pin
        };
    };

    // ── Apply (activate) a saved Data Bin as the chat's active context ──
    // NOTE: window.buildActiveDataBinAiPayload is defined in script.js
    // (script.js:6133), not here — called via the typeof guard below exactly
    // as in the original.
    // NOTE: this function also calls several UI render functions
    // (renderDataPinModal, renderDataPinFiles, renderDataPinSourceChips,
    // renderDatasourceCards, renderFilePills, axiSwitchChatsToBin) through
    // `typeof X === "function"` guards. Those are defined in
    // axi-databin-core.js / axi-databin-extras.js / script.js today; when
    // those UI files are eventually replaced by the React wizard, these
    // guards will simply no-op unless the React layer re-registers globals
    // of the same names (or applyPin is refactored to emit an event instead).
    window.applyPin = async function (id) {
        const statusEl = document.getElementById("selectedValue");
        const promptInput = document.getElementById("prompt");

        if (!id) return null;
        var _prevBinName = (window.ACTIVEDATABINCONTEXT || window.ACTIVE_DATABIN_CONTEXT || {}).name || null;
        const requestId = ++window.ACTIVE_DATABIN_REQUEST;
        window.IS_APPLYING_DATABIN = true;

        try {
            if (statusEl) statusEl.textContent = "Loading Data Bin...";

            // ── 1. Fetch data ─────────────────────────────────────────────
            const context = await window.buildActiveDataBinContext(id);
            if (requestId !== window.ACTIVE_DATABIN_REQUEST) {
                return window.ACTIVE_DATABIN_CONTEXT;
            }

            // ── 2. Build AI payload ───────────────────────────────────────
            let aiPayload = null;
            if (typeof window.buildActiveDataBinAiPayload === "function") {
                aiPayload = await window.buildActiveDataBinAiPayload(context);
            }
            if (requestId !== window.ACTIVE_DATABIN_REQUEST) {
                return window.ACTIVE_DATABIN_CONTEXT;
            }

            // ── 3. Commit all state immediately ───────────────────────────
            // Do this BEFORE any UI renders so a render error can never
            // leave the context in a half-applied state.
            const pin = context.rawPin || {};
            const state = window.ensureDataPinState();
            state.id = context.id || null;
            state.createdAt = pin.createdAt || Date.now();
            state.name = context.name || "My Data Bin";
            state.sources = (context.datasources || []).map(function (ds) {
                return {
                    name: ds.name, caption: ds.caption || ds.name, type: "database",
                    sqlParams: (ds.sqlParams && typeof ds.sqlParams === 'object') ? ds.sqlParams : {}
                };
            });
            state.files = [...(context.files || [])];

            window.ACTIVE_DATABIN_CONTEXT = context;
            window.ACTIVEDATABINCONTEXT = context;
            window.ACTIVEDATABINAIPAYLOAD = aiPayload;
            window.pendingDatabaseData = context.combinedDatabaseRows.length
                ? {
                    name: (context.datasources || []).map(ds => ds.name).join(", "),
                    data: context.combinedDatabaseRows
                }
                : null;

            // ── 4. Update dropdown label + localStorage ───────────────────
            if (typeof setActiveDataBin === "function") {
                setActiveDataBin(context.id, context.name);
            } else {
                syncSavedPinsDropdownSelection(context.id, context.name);
            }

            // ── 5. Update prompt ──────────────────────────────────────────
            // Done here, before any renders, so a render error never blocks it.
            if (promptInput) {
                promptInput.value = `Analyze Data Bin ${context.name}`;
                promptInput.dispatchEvent(new Event('input', { bubbles: true }));
            }

            // ── 6. Update status text ─────────────────────────────────────
            if (statusEl) {
                const dsCount = context.datasources.length;
                const rowCount = context.combinedDatabaseRows.length;
                const fileCount = context.files.length;
                statusEl.textContent =
                    `${dsCount} datasource${dsCount === 1 ? "" : "s"}, ` +
                    `${rowCount} row${rowCount === 1 ? "" : "s"}, ` +
                    `${fileCount} file${fileCount === 1 ? "" : "s"} ready`;
            }

            // ── 7. Re-render DataBin UI panels (best-effort) ──────────────
            // Wrapped individually so a broken render never aborts the switch.
            try { if (typeof window.renderDataPinModal === "function") window.renderDataPinModal(); } catch (e) { console.warn("[AXI] renderDataPinModal failed:", e); }
            try { if (typeof renderDataPinFiles === "function") renderDataPinFiles(); } catch (e) { console.warn("[AXI] renderDataPinFiles failed:", e); }
            try { if (typeof renderDataPinSourceChips === "function") renderDataPinSourceChips(); } catch (e) { console.warn("[AXI] renderDataPinSourceChips failed:", e); }
            try {
                if (typeof renderDatasourceCards === "function") {
                    renderDatasourceCards(document.getElementById("dataBinDatasourcePageSearch")?.value || "");
                }
            } catch (e) { console.warn("[AXI] renderDatasourceCards failed:", e); }

            // ── 8. Render file analysis chips ─────────────────────────────
            try { if (typeof window.renderFilePills === "function") window.renderFilePills(); } catch (e) { console.warn("[AXI] renderFilePills failed:", e); }

            // Swap chat thread to the newly selected bin
            var _newBinName = context.name || null;
            if (_newBinName && typeof window.axiSwitchChatsToBin === 'function') {
                window.axiSwitchChatsToBin(_prevBinName, _newBinName);
            }

            return context;

        } catch (err) {
            // Only clear state if this is still the active request AND
            // the context was not already committed (i.e., we failed before step 3).
            if (requestId === window.ACTIVE_DATABIN_REQUEST &&
                window.ACTIVEDATABINCONTEXT?.id !== id) {
                window.ACTIVEDATABINAIPAYLOAD = null;
                window.ACTIVE_DATABIN_CONTEXT = null;
                window.ACTIVEDATABINCONTEXT = null;
                window.pendingDatabaseData = null;
                if (statusEl) statusEl.textContent = "Error loading Data Bin";
                try { if (typeof window.renderFilePills === "function") window.renderFilePills(); } catch (_) { }
            }
            console.error("Failed to apply Data Bin", err);
            throw err;
        } finally {
            if (requestId === window.ACTIVE_DATABIN_REQUEST) {
                window.IS_APPLYING_DATABIN = false;
            }
        }
    };

})();

if (typeof window !== "undefined") { window.SandeshDataBinServices = true; }
