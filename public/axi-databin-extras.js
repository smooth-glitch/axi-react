/* ============================================================
   AXI DATABIN EXTRAS
   Global dataPinState + AxiAnalysisDB (IndexedDB session persistence), saved-pins dropdown + applyPin, and the 'AXI PATCH v3' JSON-parsing/custom-template patches. Extracted from index.html's inline <script> blocks (originally lines 5597-5894, 5895-6511, 6516-7237). Must load after axi-databin-core.js: addSourceToPin/addFileToPin are also defined there.
   UPDATE (React cutover): openDataBinPage/closeDataBinPage/openExistingDataBin/
   startNewDataBin/renderDataPinModal are now defined by axi-databin-wizard.js
   (loaded after this file and axi-databin-core.js), which overwrites this
   file's window.dataPinState-adjacent UI glue for those five. applyPin/
   buildActiveDataBinContext/loadSavedPins here are unchanged and still live
   (byte-identical copies also exist in axi-databin-services.js for the React
   layer to call; whichever runs last wins and both behave the same).
   ============================================================ */
        // ============================================================
        // GLOBAL Data Bin STATE
        // ============================================================
        window.dataPinState = {
            sources: [],  // { name, caption }
            files: []     // File objects
        };

        /**
         * AxiAnalysisDB — IndexedDB store for non-admin analysis sessions.
         * Persists AI responses so they survive localStorage clears.
         */
        window.AxiAnalysisDB = (function () {
            var DB_NAME = 'axi_analysis_db';
            var DB_VER = 1;
            var STORE = 'sessions';
            var _db = null;

            function _open() {
                return new Promise(function (resolve, reject) {
                    if (_db) { resolve(_db); return; }
                    var req = indexedDB.open(DB_NAME, DB_VER);
                    req.onupgradeneeded = function (e) {
                        var db = e.target.result;
                        if (!db.objectStoreNames.contains(STORE))
                            db.createObjectStore(STORE, { keyPath: 'key' });
                    };
                    req.onsuccess = function (e) { _db = e.target.result; resolve(_db); };
                    req.onerror = function () { reject(new Error('IDB open failed')); };
                });
            }

            function _key(username, binName) {
                return ('u_' + (username || '') + '_b_' + (binName || ''))
                    .toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            }

            return {
                save: function (username, binName, messages, chatId) {
                    if (!messages || !messages.length) return Promise.resolve();
                    return _open().then(function (db) {
                        return new Promise(function (resolve) {
                            var tx = db.transaction(STORE, 'readwrite');
                            var store = tx.objectStore(STORE);
                            var record = {
                                key: _key(username, binName),
                                username: username, binName: binName,
                                messages: messages, chatId: chatId,
                                timestamp: Date.now()
                            };
                            store.put(record);
                            /* Also write a username-only pointer so restore works even
                               when localStorage (incl. axi_emp_session_v1) is wiped */
                            var uKey = 'current_' + (username || '').toLowerCase()
                                .replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
                            store.put(Object.assign({}, record, { key: uKey }));
                            tx.oncomplete = resolve;
                            tx.onerror = resolve;
                        });
                    }).catch(function () { });
                },

                get: function (username, binName) {
                    return _open().then(function (db) {
                        return new Promise(function (resolve) {
                            var tx = db.transaction(STORE, 'readonly');
                            var req = tx.objectStore(STORE).get(_key(username, binName));
                            req.onsuccess = function () { resolve(req.result || null); };
                            req.onerror = function () { resolve(null); };
                        });
                    }).catch(function () { return null; });
                }
            };
        })();

        /* ── AXI Session Auto-Save ─────────────────────────────────────────────────
   Intercepts every localStorage.setItem call. When axpert_chats_v2 is written
   with an assistant response AND we have a pending first-visit session to save,
   it persists to IDB immediately — no dependency on onAnalyzed callback.     */
        (function () {
            var _origSet = localStorage.setItem.bind(localStorage);
            localStorage.setItem = function (key, value) {
                _origSet(key, value);
                if (key !== 'axpert_chats_v2') return;
                if (!window._axiPendingIdbSave) return;
                try {
                    var chats = JSON.parse(value || '[]');
                    var chat = chats[0];
                    if (!chat || !Array.isArray(chat.messages)) return;
                    var last = chat.messages[chat.messages.length - 1];
                    if (!last || last.role !== 'assistant' || (last.content || '').length < 20) return;

                    /* Assistant response is in localStorage — save to IDB now */
                    var _s = window._axiPendingIdbSave;
                    window._axiPendingIdbSave = null; /* consume once */

                    /* Persist session flag */
                    _origSet('axi_emp_session_v1', JSON.stringify({
                        username: _s.username, binName: _s.binName,
                        analyzed: true, timestamp: Date.now()
                    }));

                    /* Write to IDB (both keyed record and current-user pointer) */
                    if (window.AxiAnalysisDB) {
                        window.AxiAnalysisDB.save(_s.username, _s.binName, chat.messages, chat.id);
                    }
                    console.error('[AXI] Session auto-saved to IDB for', _s.username, '/', _s.binName);
                } catch (_e) { console.error('[AXI] Session auto-save error:', _e); }
            };
        })();

        /**
         * window.startAnalysis({ bin, provider, key })
         * Called by the non-admin (employee) user panel when they click "Analyse".
         * 1. Injects the RBAC-assigned key into runtime memory so handleSend() can use it.
         * 2. Hides the user-panel overlay so the main chat is visible.
         * 3. Applies the matching saved data-bin (if found) so data is already loaded.
         */
        window.startAnalysis = function (opts) {
            if (!opts || !opts.key || !opts.provider) {
                console.warn('[AXI startAnalysis] called without key/provider — aborting.');
                return;
            }

            /* ── 1. Inject key into runtime ─────────────────────────────── */
            if (typeof window.setAxiRuntimeKey === 'function') {
                window.setAxiRuntimeKey(opts.key, opts.provider);
            }
            /* Always mirror to localStorage so the getAxiConfig() fallback path also works */
            try {
                localStorage.setItem('axi_api_key', opts.key);
                localStorage.setItem('axi_provider', opts.provider.toLowerCase());
            } catch (e) { /* private-browsing / storage full — safe to ignore */ }

            /* Update the provider badge button */
            var _bt = 0;
            (function _tryBtn() {
                if (typeof window.axiSwitchProviderUpdateBtn === 'function') {
                    window.axiSwitchProviderUpdateBtn(opts.provider);
                } else if (_bt++ < 20) {
                    setTimeout(_tryBtn, 150);
                }
            })();

            /* ── 2. Hide the user-panel overlay ─────────────────────────── */
            var shell = document.getElementById('axiadm-shell');
            if (shell) shell.style.display = 'none';

            /* Also show the reopen button if present */
            var rb = document.getElementById('adm-reopen-btn');
            if (rb) rb.style.display = 'inline-flex';

            /* ── 3. Load the matching saved data-bin ─────────────────────── */
            if (opts.bin) {
                var tryApply = 0;
                (function _tryApplyBin() {
                    var pins = window.SAVED_PINS_CACHE || [];
                    var pin = pins.find(function (p) {
                        return (p.name || '').trim().toLowerCase() === opts.bin.trim().toLowerCase();
                    });
                    if (pin && typeof window.applyPin === 'function') {
                        window.applyPin(pin.id);
                    } else if (!pin && tryApply++ < 12) {
                        /* SAVED_PINS_CACHE may not be ready yet — retry */
                        setTimeout(_tryApplyBin, 400);
                    }
                })();
            }

            /* ── 4. Auto-send analysis prompt on first visit (non-admin) ── *
             * Only runs when opts.autoAnalyze === true.                      *
             * Waits for the bin context to be fully committed before sending  *
             * so the AI receives the live data.  Calls opts.onAnalyzed()      *
             * once the first assistant reply is persisted in localStorage.    */
            if (opts.autoAnalyze) {
                var _aaTries = 0;
                (function _tryAutoSend() {
                    /* Wait until bin context is committed AND loading is complete */
                    if (window.ACTIVEDATABINCONTEXT && !window.IS_APPLYING_DATABIN) {
                        var _p = document.getElementById('prompt');
                        var _s = document.getElementById('send');
                        if (_p && _s) {
                            var _aPrompt = opts.analysisPrompt ||
                                'Provide a comprehensive analysis of this dataset: summarise key metrics, highlight notable trends or patterns, and share actionable insights.';
                            _p.value = _aPrompt;
                            _p.dispatchEvent(new Event('input', { bubbles: true }));
                            _p.focus();
                            setTimeout(function () {
                                var _sb = document.getElementById('send');
                                if (_sb && !_sb.disabled) {
                                    _sb.click();
                                    /* Poll localStorage until the assistant reply is saved */
                                    if (typeof opts.onAnalyzed === 'function') {
                                        var _ptCount = 0;
                                        var _pi = setInterval(function () {
                                            _ptCount++;
                                            try {
                                                var _chats = JSON.parse(localStorage.getItem('axpert_chats_v2') || '[]');
                                                var _chat = _chats[0];
                                                if (_chat && Array.isArray(_chat.messages) && _chat.messages.length >= 2) {
                                                    var _last = _chat.messages[_chat.messages.length - 1];
                                                    if (_last && _last.role === 'assistant' && (_last.content || '').length > 20) {
                                                        clearInterval(_pi);
                                                        opts.onAnalyzed();
                                                    }
                                                }
                                            } catch (_e) { /* storage not available */ }
                                            if (_ptCount > 180) clearInterval(_pi); /* 4.5 min safety cap */
                                        }, 1500);
                                    }
                                }
                            }, 150);
                            return; /* sent — do not retry */
                        }
                    }
                    /* Bin context or send button not ready yet — retry */
                    if (_aaTries++ < 30) setTimeout(_tryAutoSend, 600);
                })();
            }
        };

        window.addSourceToPin = function (name, caption) {
            const already = window.dataPinState.sources.some(s => s.name === name);
            if (already) {
                showPinToast(`"${caption || name}" is already pinned.`, 'warn');
                return;
            }
            window.dataPinState.sources.push({ name, caption: caption || name });
            showPinToast(`"${caption || name}" added to pin.`, 'success');
        };

        window.addFileToPin = function (file) {
            const already = window.dataPinState.files.some(f => f.name === file.name && f.size === file.size);
            if (already) {
                showPinToast(`"${file.name}" is already pinned.`, 'warn');
                return;
            }
            window.dataPinState.files.push(file);
            showPinToast(`"${file.name}" added to pin.`, 'success');
        };

        async function getNextDataBinNumber() {
            const pins = await window.DataBinStore.getAll();
            const nums = pins
                .map(pin => {
                    const match = String(pin.name || "").match(/^My Data Bin\s+(\d+)$/i);
                    return match ? Number(match[1]) : 0;
                })
                .filter(Boolean);

            return (nums.length ? Math.max(...nums) : 0) + 1;
        }

        async function getNextDefaultDataBinName() {
            const nextNum = await getNextDataBinNumber();
            return `My Data Bin ${nextNum}`;
        }

        // Local startNewDataBin: REMOVED (was dead code — every call site in this
        // file already used window.startNewDataBin?.(), which now resolves to
        // axi-databin-wizard.js's React version; see that file's mount.jsx).
        function showPinToast(message, type = 'success') {
            let toast = document.getElementById('pinToast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'pinToast';
                toast.style.cssText = `
                    position:fixed; bottom:28px; left:50%; transform:translateX(-50%);
                    padding:10px 20px; border-radius:12px; font-size:14px; font-weight:600;
                    color:#fff; z-index:9999; display:none; align-items:center; gap:8px;
                    box-shadow:0 8px 24px rgba(0,0,0,0.15); transition:opacity 0.3s ease;
                `;
                document.body.appendChild(toast);
            }
            toast.style.background = type === 'success' ? '#10B981' : '#F59E0B';
            toast.innerHTML = `<span class="material-icons" style="font-size:18px">${type === 'success' ? 'check_circle' : 'info'}</span> ${message}`;
            toast.style.display = 'flex';
            clearTimeout(toast._timer);
            toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 2500);
        }


        function syncSavedPinsDropdownSelection(activeId, activeName) {
            const wrapper = document.getElementById("savedPinsWrapper");
            const valueEl = document.getElementById("savedPinsValue");
            const list = document.getElementById("savedPinsList");

            if (wrapper) wrapper.style.display = "block";

            if (valueEl) {
                valueEl.textContent = activeName || "Load Pin...";
                /* BUG-6 FIX: keep tooltip in sync with selected bin name */
                valueEl.title = activeName || "No Data Bin selected";
            }

            if (!list) return;

            list.querySelectorAll(".custom-option.selected").forEach(function (el) {
                el.classList.remove("selected");
            });

            if (!activeId) return;

            const activeOption = list.querySelector('.custom-option[data-id="' + activeId + '"]');
            if (activeOption) {
                activeOption.classList.add("selected");
            }
        }

        // --- UTILITIES ---
        // escapeHtml used to be redeclared here (entity-mangled into a no-op escaper,
        // and a silent duplicate of the working global escapeHtml already defined in
        // script.js). Removed — script.js's version is the sole implementation now.

        // --- LOAD SAVED PINS UI ---
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

        document.addEventListener("click", (e) => {
            const wrap = document.getElementById("savedPinsWrapper");
            if (wrap && !wrap.contains(e.target)) {
                wrap.classList.remove("open");
                var _si = document.getElementById('savedPinsSearch');
                if (_si && _si.value) {
                    _si.value = '';
                    document.querySelectorAll('#savedPinsList .custom-option').forEach(function (el) { el.style.display = ''; });
                }
            }
        });

        // DOMContentLoaded may have already fired by the time this script runs
        // (it's at the bottom of a large file). Guard against that case.
        if (document.readyState === 'loading') {
            document.addEventListener("DOMContentLoaded", () => {
                setTimeout(() => { window.loadSavedPins?.(); }, 800);
            });
        } else {
            // DOM is already ready — fire immediately
            setTimeout(() => { window.loadSavedPins?.(); }, 800);
        }

        // Safety net: if something upstream fails and the boot loader is still
        // showing after 12s, force-dismiss it so the app is never permanently blocked.
        setTimeout(() => {
            if (window._axiKeepLoaderForData) {
                window._axiKeepLoaderForData = false;
                window.hideLoader?.();
                console.warn('[AXI] Boot loader safety timeout fired — loader was not dismissed normally.');
            }
        }, 5000);


        // Close DataBin dropdown when Provider button is clicked
        document.addEventListener('click', function (e) {
            if (e.target.closest('#axiProviderBtn')) {
                document.getElementById('savedPinsWrapper')?.classList.remove('open');
            }
        }, true); // capture phase — fires before stopPropagation on the button
        /* ═══════════════════════════════════════════════════════════════════════════════
           AXI PATCH v3
           Fix 1 — JSON parsing bugs (bullet sections, // comments, bare charts JSON)
           Fix 2 — Remove Insights button
           Fix 3 — Custom user templates with Axpert DB persistence (tstruct: a__xt)
                    Fields required in a__xt: username, label, description, prompt
        ═══════════════════════════════════════════════════════════════════════════════ */
        (function () {
            'use strict';

            /* ─────────────────────────────────────────────────────────────────────────────
               SECTION A — JSON PARSING PATCHES
               ─────────────────────────────────────────────────────────────────────────── */
            function tryParseJson(str) {
                str = (str || '').trim();
                try { return JSON.parse(str); } catch (e) { }
                var cleaned = str
                    .replace(/\/\/[^\r\n]*/g, '')
                    .replace(/\/\*[\s\S]*?\*\//g, '')
                    .replace(/,(\s*[}\]])/g, '$1');
                try { return JSON.parse(cleaned); } catch (e2) { }
                return null;
            }

            function applyJsonPatches() {
                if (typeof parseInlineJsonSections === 'function' && !parseInlineJsonSections.__axiPatched) {
                    var _orig = parseInlineJsonSections;
                    parseInlineJsonSections = function (answer) {
                        return _orig((answer || '').replace(/^[\*\-]\s+/gm, ''));
                    };
                    parseInlineJsonSections.__axiPatched = true;
                }
                if (typeof sanitizeJsonString === 'function' && !sanitizeJsonString.__axiPatched) {
                    var _os = sanitizeJsonString;
                    sanitizeJsonString = function (str) {
                        return _os(str.replace(/\/\/[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''));
                    };
                    sanitizeJsonString.__axiPatched = true;
                }
                if (typeof _finalizeStreamNode === 'function' && !_finalizeStreamNode.__axiPatched) {
                    var _of = _finalizeStreamNode;
                    _finalizeStreamNode = function (node, bubbleEl, fc, cdl) {
                        if (typeof fc === 'string') {
                            fc = fc.replace(/^(?:(?:Report|DASHBOARD)\s*[\r\n]+)+/gi, '').trim();
                            if ((!cdl || !cdl.length) && /^\s*\{[\s\S]*"charts"\s*:/i.test(fc)) {
                                var p = tryParseJson(fc);
                                if (p && Array.isArray(p.charts)) {
                                    cdl = (cdl || []).slice();
                                    p.charts.forEach(function (item) {
                                        if (item && item.chart) cdl.push(item.chart);
                                        else if (item && item.type) cdl.push(item);
                                    });
                                    fc = '📊 **' + cdl.length + ' chart' + (cdl.length > 1 ? 's' : '') + ' rendered below.**';
                                }
                            }
                            if (/^[\*\-]?\s*[A-Za-z][\w\s&]+:\s*[{\[]/m.test(fc) && typeof parseInlineJsonSections === 'function') {
                                var r = parseInlineJsonSections(fc);
                                if (r && r.markdown) { fc = r.markdown; if (r.charts && r.charts.length) cdl = (cdl || []).concat(r.charts); }
                            }
                        }
                        return _of(node, bubbleEl, fc, cdl);
                    };
                    _finalizeStreamNode.__axiPatched = true;
                }
            }

            /* ─────────────────────────────────────────────────────────────────────────────
               SECTION B — CUSTOM TEMPLATES (DB-persisted via Axpert tstruct a__xt)
               ─────────────────────────────────────────────────────────────────────────── */
            var AXI_TPL_TSTRUCT = 'a__xt';           // user templates (tstruct a__xt)
            var AXI_ADMIN_TPL_TSTRUCT = 'pgbase114'; // shared/admin templates (pgbase 114)
            var userTemplates = [];   // { id, label, desc, prompt }
            var tplPanelOpen = false;
            var tplLoaded = false;

            function getUsername() {
                try {
                    return (typeof parent !== 'undefined' && parent.mainUserName)
                        ? parent.mainUserName
                        : (typeof mainUserName !== 'undefined' ? mainUserName : '');
                } catch (e) { return ''; }
            }
            function getAxFn(name) {
                // Prefer parent.* — AxSetValue/AxSubmitData rely on jQuery ($) which only
                // exists in the parent frame; calling the window-scoped copy throws "$ is not defined".
                try { if (typeof parent !== 'undefined' && typeof parent[name] === 'function') return parent[name]; } catch (e) { }
                if (typeof window[name] === 'function') return window[name];
                return null;
            }
            function escH(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"'); }

            async function loadUserTemplates() {
                if (typeof window.fetchADSData !== 'function') return;
                try {
                    /* BUG-FIX: clear stale cache BEFORE fetching so fetchADSData never
                       returns a previously-cached response after a save or update. */
                    window.pendingDatabaseData = null; window.CURRENTADSDATA = null; window.CURRENTADSNAME = null;
                    var rows = await window.fetchADSData('axi_user_templates');
                    window.pendingDatabaseData = null; window.CURRENTADSDATA = null; window.CURRENTADSNAME = null;

                    // API returns the raw column name a__xt1id (SQL alias "recordid" is NOT applied in the response)
                    // Filter: only this user's rows, and exclude soft-deleted rows (delete_chk = "True")
                    var me = getUsername().trim().toLowerCase();
                    userTemplates = (rows || [])
                        .filter(function (r) {
                            var owner = (r.pusername || '').trim().toLowerCase();
                            var deleted = (r.delete_chk || '').toString().trim();
                            return owner === me && deleted !== 'True' && deleted !== 'true';
                        })
                        .map(function (r) {
                            return {
                                id: String(r['axai_templatesid'] || r['a__xt1id'] || ''),   // PK column from API response
                                label: r.label || '',
                                desc: r.description || '',
                                prompt: r.templates || ''
                            };
                        })
                        .filter(function (t) { return t.id && t.id !== 'undefined' && t.id !== 'null' && t.label; });

                    tplLoaded = true;
                } catch (e) {
                    console.warn('[AXI Templates] load failed:', e);
                    userTemplates = [];
                }
            }

            function saveTemplate(label, desc, prompt, onDone) {
                var set = getAxFn('AxSetValue'), sub = getAxFn('AxSubmitData');
                if (!set || !sub) { alert('AxSetValue/AxSubmitData not available'); return; }
                var me = getUsername();
                set(AXI_TPL_TSTRUCT, 'pusername', '1', 0, me);
                set(AXI_TPL_TSTRUCT, 'label', '1', 0, label.trim());
                set(AXI_TPL_TSTRUCT, 'description', '1', 0, (desc || '').trim());
                set(AXI_TPL_TSTRUCT, 'templates', '1', 0, prompt.trim());
                set(AXI_TPL_TSTRUCT, 'delete_chk', '1', 0, 'False');
                sub(AXI_TPL_TSTRUCT, '0');
                /* BUG-FIX: increased from 800ms to give DB enough time to commit. */
                setTimeout(function () { loadUserTemplates().then(onDone); }, 1500);
            }

            /* BUG-14 FIX: update an existing template record */
            function updateTemplate(recordId, label, desc, prompt, onDone) {
                var set = getAxFn('AxSetValue'), sub = getAxFn('AxSubmitData');
                if (!set || !sub) { alert('AxSetValue/AxSubmitData not available'); return; }
                var rid = String(recordId);
                if (!rid || rid === '0' || rid === 'undefined' || rid === 'null') {
                    console.error('[AXI Templates] updateTemplate: invalid recordId', rid);
                    return;
                }
                /* BUG-FIX: re-set pusername and delete_chk so the row always passes
                   the owner/deleted filter inside loadUserTemplates after an update. */
                var me = getUsername();
                set(AXI_TPL_TSTRUCT, 'pusername', '1', 0, me);
                set(AXI_TPL_TSTRUCT, 'label', '1', 0, label.trim());
                set(AXI_TPL_TSTRUCT, 'description', '1', 0, (desc || '').trim());
                set(AXI_TPL_TSTRUCT, 'templates', '1', 0, prompt.trim());
                set(AXI_TPL_TSTRUCT, 'delete_chk', '1', 0, 'False');
                sub(AXI_TPL_TSTRUCT, rid);
                /* BUG-FIX: increased from 800ms to give DB enough time to commit. */
                setTimeout(function () { loadUserTemplates().then(onDone); }, 1500);
            }

            function deleteTemplate(recordId, onDone) {
                // Prefer parent: AxInterface functions rely on jQuery ($) which is only
                // available in the parent frame, not in this embedded page.
                var callScriptFn = null;
                try { if (typeof parent !== 'undefined' && typeof parent.AxCallScriptAPIAsync === 'function') callScriptFn = parent.AxCallScriptAPIAsync; } catch (e) { }
                if (!callScriptFn) callScriptFn = (typeof window.AxCallScriptAPIAsync === 'function') ? window.AxCallScriptAPIAsync : null;
                if (!callScriptFn) { alert('AxCallScriptAPIAsync not available'); return; }
                var rid = String(recordId);
                if (!rid || rid === '0' || rid === 'undefined' || rid === 'null') {
                    console.error('[AXI Templates] deleteTemplate: invalid recordId', rid);
                    return;
                }
                callScriptFn('script1', 'form', AXI_TPL_TSTRUCT, rid, {},
                    function () { console.log('[AXI Templates] Delete script done for recordId:', rid); },
                    function (err) { console.error('[AXI Templates] Delete script failed:', err); }
                );
                userTemplates = userTemplates.filter(function (t) { return String(t.id) !== rid; });
                setTimeout(function () { loadUserTemplates().then(onDone); }, 800);
            }

            /* ── Built-in categories (unchanged from original) ── */
            var BUILTIN = [
                {
                    category: 'Analysis', icon: '📊', items: [
                        {
                            label: 'Executive Summary', desc: 'Key stats, highlights & business insights',
                            prompt: 'Give me a concise executive summary of this dataset with key statistics, highlights, and actionable business insights'
                        },
                        {
                            label: 'Anomaly Detection', desc: 'Outliers, missing data & unusual patterns',
                            prompt: 'Identify all anomalies, outliers, and unusual patterns in this data. Explain what each might indicate and recommend fixes.'
                        },
                        {
                            label: 'Correlation Analysis', desc: 'Relationships & dependencies between columns',
                            prompt: 'Find and explain the strongest correlations and relationships between columns in this dataset. Visualize the top correlations.'
                        },
                        {
                            label: 'Data Quality Report', desc: 'Missing values, duplicates & issues',
                            prompt: 'Generate a detailed data quality report — missing values, duplicates, inconsistencies, outliers, and specific recommendations to fix them.'
                        }
                    ]
                },
                {
                    category: 'Charts & Visuals', icon: '📈', items: [
                        {
                            label: 'KPI Dashboard', desc: '3–4 charts with the most important metrics',
                            prompt: 'Create an interactive dashboard with 3-4 charts showing the most important KPIs in this data. Include a summary below each chart.'
                        },
                        {
                            label: 'Top 10 Bar Chart', desc: 'Ranked bar chart by key metric',
                            prompt: 'Show the top 10 records by the most significant numeric metric as a ranked horizontal bar chart with values labeled.'
                        },
                        {
                            label: 'Trend Over Time', desc: 'Line / area chart of key changes',
                            prompt: 'Show the key metrics trend over time as a line or area chart. Annotate any significant changes or inflection points.'
                        },
                        {
                            label: 'Distribution Breakdown', desc: 'Histogram, pie, or category chart',
                            prompt: 'Show the distribution of the main categorical and numeric columns as charts. Highlight any skewed or unusual distributions.'
                        }
                    ]
                },
                {
                    category: 'Reports', icon: '📄', items: [
                        {
                            label: 'Full Analysis Report', desc: 'Overview, charts, findings & recommendations',
                            prompt: 'Generate a comprehensive analysis report using ONLY the data provided. Write EVERYTHING in plain Markdown. Use these exact section headings:\n\n## Executive Overview\nWrite 2-3 sentences summarising the dataset, its purpose, and the most important takeaway.\n\n## Key Findings\nList 5-8 specific, data-driven findings as bullet points. Include actual numbers from the data.\n\n## Supporting Charts\nPlace 2-3 charts here. Each chart must be a ```json code block containing {"chart":{...}}. Do NOT output any bare JSON array or object outside of a code block.\n\n## Anomalies & Risks\nWrite bullet points about outliers, missing data, or risk patterns. If none, say so explicitly.\n\n## Recommendations\nList 3-5 actionable recommendations as bullet points based on the data findings above.\n\nSTRICT FORMAT RULES:\n1. Use ## Markdown headers for every section name.\n2. Use plain prose or bullet points for all text. NEVER write text as JSON.\n3. Charts go inside ```json code blocks ONLY.\n4. Do not repeat section names or add extra prefixes.'
                        },
                        {
                            label: 'Compare Groups', desc: 'Side-by-side category comparison',
                            prompt: 'Compare and contrast all groups/categories in this data. Show key metric differences with a grouped bar chart and a comparison table.'
                        },
                        {
                            label: 'Predictive Insights', desc: 'Forecasts and what-if analysis',
                            prompt: 'Based on current trends, provide a forecast and predictive insights. What patterns suggest what might happen next?'
                        }
                    ]
                },
                {
                    category: 'Payroll', icon: '💰', items: [
                        {
                            label: 'Payroll Summary', desc: 'Earnings, deductions & net pay breakdown',
                            prompt: 'Generate a complete payroll summary with total earnings, total deductions, average net pay, and a month-wise grouped bar chart.'
                        },
                        {
                            label: 'Earnings vs Deductions', desc: 'Visual comparison with net pay trend',
                            prompt: 'Show total gross earnings vs total deductions as a grouped bar chart, with the net pay trend as an overlaid line.'
                        },
                        {
                            label: 'YTD Salary Statement', desc: 'Year-to-date cumulative analysis',
                            prompt: 'Summarize the year-to-date salary statement with cumulative totals for earnings, deductions and net pay, shown as an area chart by month.'
                        },
                        {
                            label: 'PF & ESI Breakdown', desc: 'Statutory deduction analysis',
                            prompt: 'Analyze PF, ESI, and other statutory deductions in detail. Show the contribution trend and compare against gross pay.'
                        }
                    ]
                }
            ];

            /* ── Styles ── */
            function injectTplStyles() {
                if (document.getElementById('axiTplPatchStyles')) return;
                var s = document.createElement('style');
                s.id = 'axiTplPatchStyles';
                s.textContent = `
#axiTplBtnNew {
  display:inline-flex; align-items:center; gap:6px;
  padding:0 13px; height:48px; border-radius:14px;
  border:1.5px solid #e0e4ef; background:#fff;
  color:#374151; font-size:13.5px; font-weight:600;
  cursor:pointer; white-space:nowrap; flex-shrink:0;
  transition:all .18s; box-shadow:0 1px 4px rgba(0,0,0,.06); font-family:inherit;
}
#axiTplBtnNew:hover { border-color:#a5b4fc; background:#eef2ff; color:#4338ca; box-shadow:0 2px 8px rgba(99,102,241,.18); }
#axiTplBtnNew.active { border-color:#818cf8; background:#eef2ff; color:#4338ca; }
#axiTplBtnNew .chev { width:12px; height:12px; opacity:.6; flex-shrink:0; transition:transform .18s; }
#axiTplBtnNew.active .chev { transform:rotate(180deg); }
.axi-tpl-new-wrap { position:relative; display:inline-flex; align-items:center; flex-shrink:0; }
#axiTplPanelNew {
  position:fixed; z-index:10001;
  width:360px;
  background:#fff; border-radius:16px;
  border:1.5px solid #e4e9f5;
  box-shadow:0 12px 40px rgba(0,0,0,.16),0 4px 12px rgba(0,0,0,.07);
  overflow:hidden;
  animation:axiTplFadeIn .2s cubic-bezier(.22,.68,0,1.2) both;
  transform-origin:bottom left;
  display:flex; flex-direction:column;
  /* height calculated dynamically via JS when opened */
}
@keyframes axiTplFadeIn { from{opacity:0;transform:scale(.93) translateY(8px)} to{opacity:1;transform:scale(1) translateY(0)} }
.axi-tpl-new-hdr {
  display:flex; align-items:center; justify-content:space-between;
  padding:12px 16px 10px; border-bottom:1.5px solid #f0f2f8;
  background:#fff; flex-shrink:0; position:sticky; top:0; z-index:2;
}
.axi-tpl-new-hdr-title { font-size:11.5px; font-weight:700; color:#1e293b; text-transform:uppercase; letter-spacing:.05em; display:flex; align-items:center; gap:7px; }
.axi-tpl-new-hdr-right { display:flex; align-items:center; gap:6px; }
.axi-tpl-add-btn {
  display:inline-flex; align-items:center; gap:4px;
  padding:4px 10px; border-radius:8px; border:1.5px solid #6366f1;
  background:#eef2ff; color:#4338ca; font-size:11px; font-weight:700;
  cursor:pointer; transition:all .15s; font-family:inherit;
}
.axi-tpl-add-btn:hover { background:#6366f1; color:#fff; }
.axi-tpl-close-btn {
  width:24px; height:24px; border-radius:7px; border:none;
  background:transparent; color:#94a3b8; cursor:pointer; font-size:16px;
  display:flex; align-items:center; justify-content:center; transition:all .15s;
}
.axi-tpl-close-btn:hover { background:#f1f5f9; color:#374151; }
.axi-tpl-new-scroll { overflow-y:auto; flex:1; min-height:0; overscroll-behavior:contain; }
.axi-tpl-new-scroll::-webkit-scrollbar { width:3px; }
.axi-tpl-new-scroll::-webkit-scrollbar-thumb { background:#d1d5db; border-radius:4px; }
.axi-tpl-cat-hdr {
  padding:10px 16px 3px; font-size:9.5px; font-weight:700;
  color:#9aa3b8; text-transform:uppercase; letter-spacing:.06em;
  display:flex; align-items:center; gap:6px;
}
.axi-tpl-row {
  display:flex; align-items:center; gap:10px;
  padding:8px 16px; cursor:pointer; transition:background .13s;
  border:none; background:none; width:100%; text-align:left; font-family:inherit;
}
.axi-tpl-row:hover { background:#f8fafc; }
.axi-tpl-row:hover .axi-tpl-lbl { color:#4f46e5; }
.axi-tpl-row:hover .axi-tpl-arr { color:#6366f1; transform:translateX(3px); }
.axi-tpl-ico {
  flex:0 0 30px; height:30px; border-radius:8px;
  background:linear-gradient(135deg,#eef2ff,#f0fdf4);
  border:1px solid #e0e7ff;
  display:flex; align-items:center; justify-content:center; font-size:14px;
}
.axi-tpl-info { flex:1; min-width:0; overflow:hidden; }
.axi-tpl-lbl  { font-size:12.5px; font-weight:600; color:#1e293b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.axi-tpl-dsc  { font-size:10.5px; color:#94a3b8; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.axi-tpl-arr  { flex:0 0 14px; color:#c7d2fe; font-size:16px; transition:transform .13s,color .13s; font-weight:300; }
.axi-tpl-del-btn {
  flex:0 0 22px; height:22px; border-radius:6px; border:1.5px solid #fecaca;
  background:#fff5f5; color:#ef4444; font-size:13px; font-weight:700;
  cursor:pointer; display:flex; align-items:center; justify-content:center;
  transition:all .15s; line-height:1; padding:0; flex-shrink:0;
}
.axi-tpl-del-btn:hover { background:#ef4444; color:#fff; border-color:#ef4444; }
/* BUG-14 FIX: edit button for user templates */
.axi-tpl-edit-btn {
  flex:0 0 22px; height:22px; border-radius:6px; border:1.5px solid #c7d2fe;
  background:#f5f7ff; color:#6366f1; font-size:11px; font-weight:700;
  cursor:pointer; display:flex; align-items:center; justify-content:center;
  transition:all .15s; line-height:1; padding:0; flex-shrink:0; margin-right:2px;
}
.axi-tpl-edit-btn:hover { background:#6366f1; color:#fff; border-color:#6366f1; }
.axi-tpl-divider { height:1px; background:#f0f2f8; margin:4px 0; }
.axi-tpl-empty-user {
  padding:10px 16px 6px; font-size:11px; color:#b0b8cc; font-style:italic; text-align:center;
}
/* Add-template form */
#axiAddTplForm {
  padding:14px 16px; border-bottom:1.5px solid #f0f2f8;
  background:#f8f9ff; display:none; flex-direction:column; gap:8px;
}
#axiAddTplForm.visible { display:flex; }
#axiAddTplForm input, #axiAddTplForm textarea {
  width:100%; padding:7px 10px; border-radius:8px;
  border:1.5px solid #e0e4ef; font-size:12px; font-family:inherit;
  outline:none; background:#fff; box-sizing:border-box; color:#1e293b;
  transition:border .15s;
}
#axiAddTplForm input:focus, #axiAddTplForm textarea:focus { border-color:#818cf8; }
#axiAddTplForm textarea { resize:vertical; min-height:70px; }
#axiAddTplForm .form-row { display:flex; gap:6px; }
#axiAddTplForm .btn-save {
  flex:1; padding:7px; border-radius:8px; border:none;
  background:#6366f1; color:#fff; font-size:12px; font-weight:700;
  cursor:pointer; font-family:inherit; transition:background .15s;
}
#axiAddTplForm .btn-save:hover { background:#4f46e5; }
#axiAddTplForm .btn-cancel {
  flex:0 0 auto; padding:7px 12px; border-radius:8px;
  border:1.5px solid #e0e4ef; background:#fff; color:#64748b;
  font-size:12px; font-weight:600; cursor:pointer; font-family:inherit; transition:all .15s;
}
#axiAddTplForm .btn-cancel:hover { border-color:#94a3b8; color:#1e293b; }
.axi-saving-msg { font-size:11px; color:#6366f1; text-align:center; padding:4px 0; }
    `;
                document.head.appendChild(s);
            }

            /* ── Panel HTML builder ── */
            function buildPanelHTML() {
                var h = '';

                /* ── Add-template inline form (hidden by default) ── */
                h += '<div id="axiAddTplForm">' +
                    '  <input id="_tplEditId" type="hidden" value=""/>' +
                    '  <input id="_tplLabel"  type="text" placeholder="Template name *" maxlength="60"/>' +
                    '  <input id="_tplDesc"   type="text" placeholder="Short description (optional)" maxlength="100"/>' +
                    '  <textarea id="_tplPrompt" placeholder="Prompt text *"></textarea>' +
                    '  <div class="form-row">' +
                    '    <button class="btn-save"   id="_tplSaveBtn">Save Template</button>' +
                    '    <button class="btn-cancel" id="_tplCancelBtn">Cancel</button>' +
                    '  </div>' +
                    '  <div id="_tplSavingMsg" class="axi-saving-msg" style="display:none">Saving…</div>' +
                    '</div>';

                /* ── My Templates section ── */
                h += '<div class="axi-tpl-cat-hdr"><span>⭐</span> My Templates</div>';
                if (userTemplates.length === 0) {
                    h += '<div class="axi-tpl-empty-user">No saved templates yet — click "+ Add" to create one.</div>';
                } else {
                    userTemplates.forEach(function (t) {
                        h += '<div class="axi-tpl-row" style="cursor:default;">' +
                            '  <div class="axi-tpl-ico">⭐</div>' +
                            '  <div class="axi-tpl-info">' +
                            '    <div class="axi-tpl-lbl">' + escH(t.label) + '</div>' +
                            '    <div class="axi-tpl-dsc">' + escH(t.desc) + '</div>' +
                            '  </div>' +
                            '  <button class="axi-tpl-arr" data-use-prompt="' + escH(t.prompt) + '" ' +
                            '          style="background:none;border:none;cursor:pointer;font-size:18px;padding:0 2px;" title="Use this template">›</button>' +
                            '  <button class="axi-tpl-edit-btn" data-edit-id="' + escH(t.id) + '" data-edit-label="' + escH(t.label) + '" data-edit-desc="' + escH(t.desc) + '" data-edit-prompt="' + escH(t.prompt) + '" title="Edit template">✎</button>' +
                            '  <button class="axi-tpl-del-btn" data-del-id="' + escH(t.id) + '" title="Delete">×</button>' +
                            '</div>';
                    });
                }

                h += '<div class="axi-tpl-divider"></div>';

                /* ── Built-in categories ── */
                BUILTIN.forEach(function (cat, ci) {
                    if (ci > 0) h += '<div class="axi-tpl-divider"></div>';
                    h += '<div class="axi-tpl-cat-hdr"><span>' + cat.icon + '</span>' + escH(cat.category) + '</div>';
                    cat.items.forEach(function (item) {
                        h += '<button class="axi-tpl-row" data-prompt="' + escH(item.prompt) + '">' +
                            '  <div class="axi-tpl-ico">' + cat.icon + '</div>' +
                            '  <div class="axi-tpl-info">' +
                            '    <div class="axi-tpl-lbl">' + escH(item.label) + '</div>' +
                            '    <div class="axi-tpl-dsc">' + escH(item.desc) + '</div>' +
                            '  </div>' +
                            '  <span class="axi-tpl-arr">›</span>' +
                            '</button>';
                    });
                });

                return h;
            }

            function sendPrompt(text) {
                closeTplPanel();
                var p = document.getElementById('prompt');
                if (!p) return;
                p.value = text;
                p.dispatchEvent(new Event('input', { bubbles: true }));
                p.focus();
                setTimeout(function () { var b = document.getElementById('send'); if (b && !b.disabled) b.click(); }, 90);
            }

            function wireFormEvents(panel) {
                var addBtn = panel.querySelector('#_axiTplAddBtn');
                var form = panel.querySelector('#axiAddTplForm');
                var saveBtn = panel.querySelector('#_tplSaveBtn');
                var cancelBtn = panel.querySelector('#_tplCancelBtn');
                var savingMsg = panel.querySelector('#_tplSavingMsg');

                if (addBtn) addBtn.onclick = function (e) {
                    e.stopPropagation();
                    /* opening the add form always clears any pending edit */
                    var editIdEl = form.querySelector('#_tplEditId');
                    if (editIdEl) editIdEl.value = '';
                    /* BUG-FIX: also clear the input fields when opening a fresh "Add" form */
                    form.querySelector('#_tplLabel').value = '';
                    form.querySelector('#_tplDesc').value = '';
                    form.querySelector('#_tplPrompt').value = '';
                    saveBtn.textContent = 'Save Template';
                    form.classList.toggle('visible');
                    if (form.classList.contains('visible')) panel.querySelector('#_tplLabel').focus();
                };
                if (cancelBtn) cancelBtn.onclick = function (e) {
                    e.stopPropagation();
                    form.classList.remove('visible');
                    form.querySelector('#_tplLabel').value = '';
                    form.querySelector('#_tplDesc').value = '';
                    form.querySelector('#_tplPrompt').value = '';
                    var editIdEl = form.querySelector('#_tplEditId');
                    if (editIdEl) editIdEl.value = '';
                    saveBtn.textContent = 'Save Template';
                };
                if (saveBtn) saveBtn.onclick = function (e) {
                    e.stopPropagation();
                    var lbl = form.querySelector('#_tplLabel').value.trim();
                    var desc = form.querySelector('#_tplDesc').value.trim();
                    var prompt = form.querySelector('#_tplPrompt').value.trim();
                    var editId = (form.querySelector('#_tplEditId') || {}).value || '';
                    if (!lbl) { form.querySelector('#_tplLabel').focus(); return; }
                    if (!prompt) { form.querySelector('#_tplPrompt').focus(); return; }
                    saveBtn.disabled = true;
                    if (savingMsg) savingMsg.style.display = 'block';
                    if (editId) {
                        /* BUG-14 FIX: update existing template */
                        updateTemplate(editId, lbl, desc, prompt, function () {
                            refreshPanelBody(panel);
                            if (savingMsg) savingMsg.style.display = 'none';
                            saveBtn.disabled = false;
                        });
                    } else {
                        saveTemplate(lbl, desc, prompt, function () {
                            refreshPanelBody(panel);
                            if (savingMsg) savingMsg.style.display = 'none';
                            saveBtn.disabled = false;
                        });
                    }
                };

                /* BUG-14 FIX: Edit buttons — pre-fill form */
                panel.querySelectorAll('[data-edit-id]').forEach(function (el) {
                    el.onclick = function (e) {
                        e.stopPropagation();
                        form.querySelector('#_tplEditId').value = el.dataset.editId;
                        form.querySelector('#_tplLabel').value = el.dataset.editLabel || '';
                        form.querySelector('#_tplDesc').value = el.dataset.editDesc || '';
                        form.querySelector('#_tplPrompt').value = el.dataset.editPrompt || '';
                        saveBtn.textContent = 'Update Template';
                        form.classList.add('visible');
                        panel.querySelector('#_tplLabel').focus();
                    };
                });

                /* Use prompt arrows on My Templates */
                panel.querySelectorAll('[data-use-prompt]').forEach(function (el) {
                    el.onclick = function (e) { e.stopPropagation(); sendPrompt(el.dataset.usePrompt); };
                });
                /* Delete buttons */
                panel.querySelectorAll('[data-del-id]').forEach(function (el) {
                    el.onclick = function (e) {
                        e.stopPropagation();
                        if (!confirm('Delete this template?')) return;
                        deleteTemplate(el.dataset.delId, function () { refreshPanelBody(panel); });
                    };
                });
                /* Built-in prompt rows */
                panel.querySelectorAll('.axi-tpl-row[data-prompt]').forEach(function (el) {
                    el.onclick = function () { sendPrompt(el.dataset.prompt); };
                });
                /* Close button */
                var closeBtn = panel.querySelector('#_axiTplNewClose');
                if (closeBtn) closeBtn.onclick = closeTplPanel;
            }

            function refreshPanelBody(panel) {
                var scroll = panel.querySelector('.axi-tpl-new-scroll');
                if (!scroll) return;
                scroll.innerHTML = buildPanelHTML();
                wireFormEvents(panel);
            }

            function openTplPanel() {
                var btn = document.getElementById('axiTplBtnNew');
                if (!btn) return;
                var panel = document.getElementById('axiTplPanelNew');
                if (!panel) {
                    panel = document.createElement('div');
                    panel.id = 'axiTplPanelNew';
                    panel.innerHTML =
                        '<div class="axi-tpl-new-hdr">' +
                        '  <div class="axi-tpl-new-hdr-title">' +
                        '    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>' +
                        '    Prompt Templates' +
                        '  </div>' +
                        '  <div class="axi-tpl-new-hdr-right">' +
                        '    <button class="axi-tpl-add-btn" id="_axiTplAddBtn">+ Add</button>' +
                        '    <button class="axi-tpl-close-btn" id="_axiTplNewClose">' +
                        '      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
                        '    </button>' +
                        '  </div>' +
                        '</div>' +
                        '<div class="axi-tpl-new-scroll"></div>';
                    document.body.appendChild(panel);
                }

                // Position the panel above the button using fixed coordinates
                var rect = btn.getBoundingClientRect();
                var GAP = 10;
                var PANEL_W = 360;
                var viewH = window.innerHeight;
                var viewW = window.innerWidth;

                // Show temporarily off-screen to measure height
                panel.style.visibility = 'hidden';
                panel.style.display = 'flex';
                panel.style.flexDirection = 'column';

                var scroll = panel.querySelector('.axi-tpl-new-scroll');
                if (scroll) { scroll.innerHTML = buildPanelHTML(); }

                // After paint, calculate actual position
                requestAnimationFrame(function () {
                    var maxH = rect.top - GAP - 16;  // space above button minus margin
                    if (maxH < 200) maxH = Math.min(viewH - rect.bottom - GAP - 16, viewH * 0.75); // flip below if not enough room
                    panel.style.maxHeight = Math.max(200, maxH) + 'px';

                    // Horizontal: align left of button, clamp to viewport
                    var left = rect.left;
                    if (left + PANEL_W > viewW - 8) left = viewW - PANEL_W - 8;
                    if (left < 8) left = 8;

                    // Vertical: above button by default
                    var bottom = viewH - rect.top + GAP;
                    panel.style.left = left + 'px';
                    panel.style.bottom = 'auto';
                    panel.style.top = 'auto';
                    // Position from top instead (more reliable across browsers)
                    var topPos = rect.top - panel.offsetHeight - GAP;
                    if (topPos < 8) topPos = rect.bottom + GAP; // flip below if no room
                    panel.style.top = topPos + 'px';
                    panel.style.bottom = 'auto';
                    panel.style.visibility = 'visible';
                });

                tplPanelOpen = true;
                btn.classList.add('active');
                wireFormEvents(panel);
            }

            function closeTplPanel() {
                var panel = document.getElementById('axiTplPanelNew');
                if (panel) panel.style.display = 'none';
                var btn = document.getElementById('axiTplBtnNew');
                if (btn) btn.classList.remove('active');
                tplPanelOpen = false;
            }

            /* ── Button injection (replaces original) ── */
            function injectNewTplBtn() {
                if (document.getElementById('axiTplBtnNew')) return;

                /* Remove the original templates button injected by the IIFE */
                var oldWrap = document.querySelector('.axi-tpl-wrap');
                if (oldWrap) oldWrap.remove();
                /* Also hide the insights wrap just in case CSS wasn't enough */
                document.querySelectorAll('.axi-insights-wrap').forEach(function (el) { el.style.display = 'none'; });

                /* Inject into the controls-row axiCtrl so Templates lives
                   beside AI Provider and Data Bin, not floating in composerShell. */
                var targetCtrl = document.getElementById('axiTemplatesCtrl');
                if (!targetCtrl) return;

                var wrap = document.createElement('div');
                wrap.className = 'axi-tpl-new-wrap';

                var btn = document.createElement('button');
                btn.id = 'axiTplBtnNew';
                btn.type = 'button';
                btn.title = 'Prompt Templates';
                btn.innerHTML =
                    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                    '<rect x="3" y="3" width="18" height="18" rx="2"/>' +
                    '<line x1="3" y1="9" x2="21" y2="9"/>' +
                    '<line x1="9" y1="21" x2="9" y2="9"/></svg>' +
                    ' Templates' +
                    '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
                    '<polyline points="6 9 12 15 18 9"/></svg>';
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    /* BUG-3 FIX: close DataBin dropdown before opening template panel */
                    if (!tplPanelOpen) {
                        var dbWrapper = document.getElementById('savedPinsWrapper');
                        if (dbWrapper) dbWrapper.classList.remove('open');
                    }
                    tplPanelOpen ? closeTplPanel() : openTplPanel();
                });
                wrap.appendChild(btn);

                targetCtrl.appendChild(wrap);

                /* Outside-click to close */
                document.addEventListener('click', function (e) {
                    var panel = document.getElementById('axiTplPanelNew');
                    if (tplPanelOpen && panel && !panel.contains(e.target) && !btn.contains(e.target)) closeTplPanel();
                }, true);
            }

            /* ─────────────────────────────────────────────────────────────────────────────
               SECTION C — INIT
               ─────────────────────────────────────────────────────────────────────────── */
            function init() {
                applyJsonPatches();
                injectTplStyles();

                /* Load user templates from DB, then inject button */
                loadUserTemplates().then(function () {
                    injectNewTplBtn();
                    console.info('[AXI PATCH v3] ✅ Custom templates loaded (' + userTemplates.length + ' user templates)');
                }).catch(function () {
                    injectNewTplBtn();
                });
            }

            /* Wait for versioned scripts + original IIFE to fully execute */
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 2000); });
            } else {
                setTimeout(init, 2000);
            }
            /* Safety-net retries for JSON patches (they can fire earlier) */
            [1500, 3000, 5000].forEach(function (d) {
                setTimeout(function () {
                    if (typeof _finalizeStreamNode === 'function' && !_finalizeStreamNode.__axiPatched) applyJsonPatches();
                }, d);
            });

        })();
