/* ============================================================
   SANDESH DATABIN CORE (Block A)
   Provider/model badge, key-setup modal, RBAC bootstrap, Data Bin wizard, datasource/file pickers, DataBinStore, system prompt editor, connect/upload/provider-key modals, ask/analyze handoff. Extracted from index.html's inline <script> block (originally lines 1269-5566). Must load before axi-databin-extras.js and axi-admin-dashboard.js -- both depend on globals this defines (fetchADSData, DataBinStore, showLoader/hideLoader).
   UPDATE (React cutover): the Data Bin wizard's own UI (openDataBinPage/
   closeDataBinPage/openExistingDataBin/startNewDataBin/renderDataPinModal) has
   been removed from this file -- axi-databin-wizard.js (loaded after this file)
   now owns those five globals, backed by DataBinStore/_probeADSParams/etc.
   which still live here AND (byte-identical) in axi-databin-services.js. The
   datasource/file picker render functions below (renderDatasourceCards,
   renderDataPinSourceChips, renderDataPinFiles, updateDatasourceSelectionCount)
   are now DEAD CODE -- nothing calls them anymore since their only callers
   were the five removed functions. Safe to delete in a follow-up cleanup pass;
   left in place for this change to stay a minimal, reviewable diff.
   ============================================================ */
        // This used to be document.addEventListener('DOMContentLoaded', () => {...})
        // directly. Now that this code lives in an external file instead of an inline
        // <script> tag, it can no longer assume it loads before DOMContentLoaded fires
        // -- if it does, the listener below would just never fire and this whole block
        // would silently do nothing. Guarded the same way Block B (axi-admin-dashboard.js)
        // already does.
        function _axiDataBinCoreBoot() {

            function _updateModelBadge() {
                try {
                    const cfg = typeof getAxiConfig === 'function' ? getAxiConfig() : null;
                    if (!cfg) return;

                    const badgeText = document.getElementById('axiModelBadgeText');
                    const badgeDot = document.getElementById('axiModelBadgeDot');
                    const badgeEmoji = document.getElementById('axiModelBadgeEmoji');
                    if (!badgeText) return;

                    // Provider display names
                    const providerNames = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini', openrouter: 'OpenRouter' };

                    // Provider SVG icons (inline, 14x14)
                    const providerIcons = {
                        openai: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.896zm16.597 3.855l-5.843-3.372 2.02-1.168a.076.076 0 0 1 .071 0l4.83 2.786a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.402-.673zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>`,
                        anthropic: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13.827 3.52h3.603L24 20h-3.603l-6.57-16.48zm-3.654 0H6.57L0 20h3.603l1.352-3.384h6.537l-1.352-3.4H6.87l2.352-5.897L10.173 3.52z"/></svg>`,
                        gemini: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 24A12 12 0 0 1 12 0a12 12 0 0 1 0 24zm0-9.173-3.84 3.84a8.464 8.464 0 0 0 3.84.906 8.464 8.464 0 0 0 3.84-.906zm-5.013-1.174-.001.001A8.484 8.484 0 0 0 8.332 18.84L12 15.172l3.668 3.669a8.484 8.484 0 0 0 1.346-1.188L12 14.827l-5.013 3.826zm-.653-1.005L12 10.828l5.666 3.02A8.52 8.52 0 0 0 20.485 12 8.485 8.485 0 0 0 12 3.515 8.485 8.485 0 0 0 3.515 12a8.52 8.52 0 0 0 2.819 3.648z" fill="#4285F4"/></svg>`,
                        openrouter: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`
                    };

                    // Provider accent colors for the icon
                    const providerColors = {
                        openai: '#10a37f',
                        anthropic: '#d97706',
                        gemini: '#4285F4',
                        openrouter: '#6366f1'
                    };

                    const p = (cfg.provider || 'openai').toLowerCase();
                    const name = providerNames[p] || cfg.provider;
                    const iconSvg = providerIcons[p] || '';
                    const iconColor = providerColors[p] || '#334155';

                    // Hide the old emoji span entirely
                    if (badgeEmoji) badgeEmoji.style.display = 'none';

                    // Inject icon + name into badgeText
                    badgeText.innerHTML = `<span class="axi-mbadge__icon" style="display:inline-flex;align-items:center;color:${iconColor};flex-shrink:0;">${iconSvg}</span><span class="axi-mbadge__label">${name}</span>`;

                    // Hide dot
                    if (badgeDot) badgeDot.style.display = 'none';

                    const badgeWrap = document.getElementById('axiModelBadge');
                    if (badgeWrap) badgeWrap.style.display = 'flex';

                } catch (e) { }


            }
            // _updateModelBadge was declared inside this closure only, never
            // exposed on window — every `typeof _updateModelBadge === 'function'`
            // guard elsewhere (script.js's Provider Switcher, this file's own
            // key-connect flows) has therefore always evaluated false, silently
            // skipping the badge refresh. Fixing the miswiring rather than
            // faithfully reproducing a call that has never once fired.
            window._updateModelBadge = _updateModelBadge;
            /* --- 1. GLOBAL UI REFERENCES --- */
            const connectModal = document.getElementById("connectModal");
            const uploadModal = document.getElementById("uploadModal");
            const openConnectBtn = document.getElementById("openConnect");
            const openUploadBtn = document.getElementById("openUpload");
            const fileSelect = document.getElementById('axiFileSelect');
            const analyzeBtn = document.getElementById('axiLoad');
            const promptInput = document.getElementById('prompt');
            const composerForm = document.getElementById('composer');

            // -- Connect Modal Elements --
            const providerSelect = document.getElementById('provider');
            const keyInput = document.getElementById('apiKey');
            const connectBtn = document.getElementById('connectBtn');
            const connectStatus = document.getElementById('status');

            // -- Upload Modal Elements --
            const dropzone = document.getElementById('dropzone');
            const picker = document.getElementById('picker');
            // 1. Global variable to store the raw JSON data for the AI
            window.ACTIVEDATABINKEY = "axi-active-databin-id";

            function setActiveDataBin(id, name) {
                localStorage.setItem(window.ACTIVEDATABINKEY, id || "");
                syncSavedPinsDropdownSelection?.(id, name);
            }

            function getActiveDataBinId() {
                return localStorage.getItem(window.ACTIVEDATABINKEY);
            }




            window.CURRENT_ADS_DATA = null;
            window.IS_FETCHING_DATA = false;
            /* --- 2. INITIALIZATION --- */
            // Load saved settings
            providerSelect.value = localStorage.getItem('axi_provider') || 'openai';

            /* ── AXI: Provider radio cards sync with hidden select ─────── */
            (function syncProviderCards() {
                var radios = document.querySelectorAll('.axcn__radio');
                var hiddenSelect = document.getElementById('provider');
                if (!radios.length || !hiddenSelect) return;
                var saved = localStorage.getItem('axi_provider') || 'openai';
                var initRadio = document.querySelector('.axcn__radio[value="' + saved + '"]');
                if (initRadio) { initRadio.checked = true; hiddenSelect.value = saved; }
                radios.forEach(function (r) {
                    r.addEventListener('change', function () {
                        if (this.checked) hiddenSelect.value = this.value;
                    });
                });
                hiddenSelect.addEventListener('change', function () {
                    var r = document.querySelector('.axcn__radio[value="' + this.value + '"]');
                    if (r) r.checked = true;
                });
            })();

            /* ── AXI: API key visibility toggle ─────────────────────────── */
            (function wireKeyToggle() {
                var toggleBtn = document.getElementById('axcnToggleKey');
                var keyInput = document.getElementById('apiKey');
                var eyeShow = document.getElementById('axcnEyeShow');
                var eyeHide = document.getElementById('axcnEyeHide');
                if (!toggleBtn || !keyInput) return;
                toggleBtn.addEventListener('click', function () {
                    var isPass = keyInput.type === 'password';
                    keyInput.type = isPass ? 'text' : 'password';
                    if (eyeShow) eyeShow.style.display = isPass ? '' : 'none';
                    if (eyeHide) eyeHide.style.display = isPass ? 'none' : '';
                });
            })();

            // REMOVED (React cutover): this wired a live char counter for the
            // system prompt textarea. axi-system-prompt-editor-react.js's
            // SystemPromptModal computes the same length/color thresholds
            // (>4000 red, >2000 amber) reactively from its own controlled
            // textarea state — no separate wiring needed. (This IIFE also
            // targeted #promptCharCount by id, which no longer exists in the
            // React-rendered markup, so it was already a harmless no-op
            // before this removal — kept as an explicit comment rather than
            // silently-dead code.)

            /* ── AXI: Status class bridges ─────────────────────────────── */
            (function patchStatuses() {
                var s1 = document.getElementById('status');
                if (s1) s1.className = 'axModal__status';
                var s2 = document.getElementById('promptStatus');
                if (s2) s2.className = 'axModal__status';
            })();

            /* ── AXI: Prompt modal status bridge ─────────────────────────── */
            (function patchPromptStatus() {
                var statusEl = document.getElementById('promptStatus');
                if (!statusEl) return;
                statusEl.className = 'axmp__status';
            })();
            keyInput.value = localStorage.getItem('axi_api_key') || '';

            // ── First-time setup modal wiring ─────────────────────────────────
            const axiKeySetupModal = document.getElementById('axiKeySetupModal');
            const axiSetupKeyInput = document.getElementById('axiSetupKeyInput');
            const axiSetupSaveBtn = document.getElementById('axiSetupSaveBtn');
            const axiSetupBtnLabel = document.getElementById('axiSetupBtnLabel');
            const axiSetupStatus = document.getElementById('axiSetupStatus');
            const axiSetupKeyToggle = document.getElementById('axiSetupKeyToggle');
            const axiSetupEyeShow = document.getElementById('axiSetupEyeShow');
            const axiSetupEyeHide = document.getElementById('axiSetupEyeHide');

            // Eye toggle for setup modal key input
            if (axiSetupKeyToggle && axiSetupKeyInput) {

                axiSetupKeyToggle.addEventListener('click', function () {
                    const isPass = axiSetupKeyInput.type === 'password';
                    axiSetupKeyInput.type = isPass ? 'text' : 'password';
                    if (axiSetupEyeShow) axiSetupEyeShow.style.display = isPass ? '' : 'none';
                    if (axiSetupEyeHide) axiSetupEyeHide.style.display = isPass ? 'none' : '';
                });
            }

            // Close button for setup modal
            document.getElementById('axiSetupCloseBtn')?.addEventListener('click', function () {
                if (axiKeySetupModal && axiKeySetupModal.open) axiKeySetupModal.close();
            });
            axiKeySetupModal?.addEventListener('mousedown', function (e) {
                if (e.target === axiKeySetupModal) axiKeySetupModal.close();
            });

            // Sync axiSetupProvider radio → update placeholder hint
            (function syncSetupProvider() {
                const radios = document.querySelectorAll('input[name="axiSetupProvider"]');
                const hints = { openai: 'sk-proj-…', anthropic: 'sk-ant-…', gemini: 'AIza…', openrouter: 'sk-or-…' };
                radios.forEach(r => r.addEventListener('change', function () {
                    if (axiSetupKeyInput) axiSetupKeyInput.placeholder = hints[this.value] || 'Paste your API key…';
                }));
            })();

            // Save button: validate key → save to axi_ai_keys table → close modal
            if (axiSetupSaveBtn) {
                axiSetupSaveBtn.addEventListener('click', async function () {
                    const key = (axiSetupKeyInput?.value || '').trim();
                    const provider = document.querySelector('input[name="axiSetupProvider"]:checked')?.value || 'openai';

                    if (!key) {
                        if (axiSetupStatus) {
                            axiSetupStatus.className = 'axModal__status status--error';
                            axiSetupStatus.innerHTML = '<span class="material-icons" style="font-size:16px;">warning</span> <span>Please enter your API key.</span>';
                            axiSetupStatus.style.display = 'flex';
                        }
                        return;
                    }

                    axiSetupSaveBtn.disabled = true;
                    if (axiSetupBtnLabel) axiSetupBtnLabel.textContent = 'Verifying…';
                    if (axiSetupStatus) axiSetupStatus.style.display = 'none';

                    try {
                        window.showLoader('Verifying key…');
                        await validateKey(provider, key);
                        window.hideLoader();

                        window.saveAxiKeyToTable(key, '0', provider);
                        if (typeof window.axiSwitchProviderUpdateBtn === 'function')
                            window.axiSwitchProviderUpdateBtn(provider);
                        _updateModelBadge();

                        if (axiSetupStatus) {
                            axiSetupStatus.className = 'axModal__status status--success';
                            axiSetupStatus.innerHTML = '<span class="material-icons" style="font-size:16px;">check_circle</span> <span>Connected — you\'re ready to go!</span>';
                            axiSetupStatus.style.display = 'flex';
                        }

                        setTimeout(function () {
                            if (axiKeySetupModal && axiKeySetupModal.open) axiKeySetupModal.close();
                            axiSetupSaveBtn.disabled = false;
                            if (axiSetupBtnLabel) axiSetupBtnLabel.textContent = 'Verify & Connect';
                        }, 800);

                    } catch (err) {
                        window.hideLoader();
                        axiSetupSaveBtn.disabled = false;
                        if (axiSetupBtnLabel) axiSetupBtnLabel.textContent = 'Verify & Connect';
                        if (axiSetupStatus) {
                            axiSetupStatus.className = 'axModal__status status--error';
                            axiSetupStatus.innerHTML = '<span class="material-icons" style="font-size:16px;">warning</span> <span>' + escapeHtml(err.message || 'Failed to verify key.') + '</span>';
                            axiSetupStatus.style.display = 'flex';
                        }
                    }
                });
            }

            // Ensure loader helpers are defined before auto-connect runs
            window.showLoader = window.showLoader || function (text) {
                const loader = document.getElementById('globalLoaderOverlay');
                const textEl = document.getElementById('globalLoaderText');
                if (textEl) textEl.textContent = text || 'Loading…';
                if (loader) loader.classList.add('is-active');
            };
            window.hideLoader = window.hideLoader || function () {
                const loader = document.getElementById('globalLoaderOverlay');
                if (loader) loader.classList.remove('is-active');
            };

            // ── Auto-connect: fetch org API key from axi_ai_keys on every page load ─
            // Key lives in JS memory only — never written to localStorage.
            /* ── Non-admin bin access setup ── */
            var _axiDataBinStoreOrig = null;
            var _piBoot = null;             // shared so the RBAC flow can cancel it
            var _piBootDone = false;        // extra guard for already-queued interval callbacks
            var _axiStoreCommitted = false; // true once real bins are locked in
            var _axiCurrentAllowed = null;  // the live allowed-set — read at resolve time, not closure time
            function _axiGetWrapper() { return document.getElementById('savedPinsWrapper'); }

            function _axiPatchStore(allowedNames) {
                if (!window.DataBinStore) return false;

                if (!_axiDataBinStoreOrig)
                    _axiDataBinStoreOrig = window.DataBinStore.getAll.bind(window.DataBinStore);

                // Once bins are committed, reject any attempt to revert to null
                if (!allowedNames && _axiStoreCommitted) return true;
                if (allowedNames) _axiStoreCommitted = true;

                // Update the shared allowed-set. In-flight calls read this at resolve time,
                // so a slow ADS fetch started under the null-patch will see the committed
                // bins when it finally resolves — not the stale null it was called with.
                _axiCurrentAllowed = allowedNames
                    ? allowedNames.map(function (n) { return String(n || '').trim().toLowerCase(); })
                    : null;

                // Install the proxy only once. It always reads _axiCurrentAllowed dynamically.
                if (!window.DataBinStore._axiPatched) {
                    window.DataBinStore._axiPatched = true;
                    window.DataBinStore.getAll = async function () {
                        var all = await _axiDataBinStoreOrig();
                        var snap = _axiCurrentAllowed; // snapshot at resolve time
                        if (!snap) { console.log('[AXI] getAll blocked (no bins yet)'); return []; }
                        var filtered = (all || []).filter(function (b) {
                            var nm = String(b.name || b.id || '').trim().toLowerCase();
                            return snap.indexOf(nm) !== -1;
                        });
                        console.log('[AXI] getAll filter:', { total: (all || []).length, allowed: snap, returned: filtered.length, storeBins: (all || []).map(function (b) { return b.name; }) });
                        return filtered;
                    };
                }
                // If already patched, updating _axiCurrentAllowed above is all that's needed.
                return true;
            }

            function _axiShowNoAccess() {
                var m = document.querySelector('main.main');
                if (m) m.style.display = 'none';
                if (document.getElementById('axiNoAccessCover')) return;
                var c = document.createElement('div');
                c.id = 'axiNoAccessCover';
                c.style.cssText = 'position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,system-ui,sans-serif';
                var bar = document.createElement('div');
                bar.style.cssText = 'position:fixed;top:0;left:0;right:0;height:52px;background:#fff;border-bottom:1px solid #EAECF0;display:flex;align-items:center;padding:0 24px;z-index:1';
                bar.innerHTML = '<span style="font-size:17px;font-weight:800;color:#111827;letter-spacing:-.5px">Axi<span style="color:#2563EB">AI</span></span>';
                var card = document.createElement('div');
                card.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:20px;max-width:400px;text-align:center;padding:40px 32px;background:#fff;border-radius:20px;border:1px solid #EAECF0;box-shadow:0 4px 32px rgba(0,0,0,.07)';
                card.innerHTML = [
                    '<div style="width:60px;height:60px;border-radius:16px;background:linear-gradient(135deg,#EFF6FF,#DBEAFE);border:1.5px solid #BFDBFE;display:flex;align-items:center;justify-content:center">',
                    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">',
                    '<ellipse cx="12" cy="5" rx="9" ry="3"/>',
                    '<path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>',
                    '<path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
                    '<line x1="12" y1="11" x2="12" y2="13"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
                    '</svg></div>',
                    '<div style="display:flex;flex-direction:column;gap:8px">',
                    '<h2 style="margin:0;font-size:17px;font-weight:700;color:#111827;letter-spacing:-.3px">No data access configured</h2>',
                    '<p style="margin:0;font-size:13.5px;color:#6B7280;line-height:1.65">Your account has not been assigned to any data bins yet.<br>Please contact your administrator to get access.</p>',
                    '</div>',
                    '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#F9FAFB;border:1px solid #E5E7EB;width:100%;box-sizing:border-box;justify-content:center">',
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
                    '<span style="font-size:12px;font-weight:600;color:#9CA3AF">Access is managed by your administrator</span>',
                    '</div>'
                ].join('');
                c.appendChild(bar);
                c.appendChild(card);
                document.body.appendChild(c);
            }

            /* ── Parse-time admin check + immediate DataBinStore block for non-admins ──
               Must run synchronously BEFORE any setTimeout(..., 800) so no other
               loadSavedPins call can render bins before our patch is in place. */
            var _axiUser = (function () {
                try {
                    var p = typeof parent !== 'undefined' ? parent : {};
                    var n = (p.mainUserName || (typeof mainUserName !== 'undefined' ? mainUserName : '') || '');
                    function truthy(v) { return !!v && v !== 'F' && v !== 'f' && v !== '0' && v !== 'false' && v !== 'False'; }
                    var b = false, cc = false;
                    try { b = truthy(p.getSessionValue ? p.getSessionValue('Build') : window.getSessionValue && window.getSessionValue('Build')); } catch (e) { }
                    try { cc = truthy(p.getSessionValue ? p.getSessionValue('AppMgrAccess') : window.getSessionValue && window.getSessionValue('AppMgrAccess')); } catch (e) { }
                    return { username: n.trim(), isAdmin: b || cc || (n.toLowerCase() === 'admin') };
                } catch (e) { return { username: '', isAdmin: false }; }
            })();
            var _isEmp = !_axiUser.isAdmin;
            window._axiIsClientEmployee = _isEmp;

            if (_isEmp) {
                /* Patch DataBinStore NOW so every subsequent loadSavedPins gets [] until we allow specific bins */
                if (!_axiPatchStore(null)) {
                    _piBoot = setInterval(function () { if (_piBootDone || _axiPatchStore(null)) clearInterval(_piBoot); }, 50);
                }
                /* BUG-7 FIX: hide AI Provider ctrl and Admin ctrl from non-admin users immediately */
                function _axiHideAdminCtrls() {
                    var provCtrl = document.getElementById('axiProviderCtrl');
                    var admCtrl = document.getElementById('axiAdminCtrl');
                    var editPromptCtrl = document.getElementById('axiEditPromptCtrl');
                    if (provCtrl) provCtrl.style.display = 'none';
                    if (admCtrl) admCtrl.style.display = 'none';
                    if (editPromptCtrl) editPromptCtrl.style.display = 'none';
                }
                _axiHideAdminCtrls();
                setTimeout(_axiHideAdminCtrls, 800); /* safety-net: re-hide if late DOM injection restored them */
            }

            setTimeout(async function axiAutoConnect() {
                window.updateWelcomeCardVisibility && window.updateWelcomeCardVisibility();

                var _cBtn = document.getElementById('openConnect');
                var _dBtn = document.getElementById('openDataPin');

                if (_isEmp) {
                    if (_cBtn) _cBtn.style.display = 'none';
                    if (_dBtn) _dBtn.style.display = 'none';
                } else {
                    if (_cBtn) _cBtn.classList.remove('axi-emp-hidden');
                    if (_dBtn) _dBtn.classList.remove('axi-emp-hidden');
                }

                /* 2. Connect AI key */
                window.showLoader && window.showLoader('Connecting to AI\u2026');
                try {
                    var result = await window.initAxiKeyFromDatasource();
                    if (!result.found) {
                        window.hideLoader && window.hideLoader();
                        if (_isEmp) {
                            // Employee: no provider configured by admin yet — show informational toast
                            if (typeof toast === 'function') {
                                toast('No AI provider has been configured. Please contact your administrator.', 'warning', 6000);
                            }
                        } else {
                            // Admin: show first-time setup modal to configure a provider
                            if (axiKeySetupModal) axiKeySetupModal.showModal();
                        }
                    } else {
                        window.showLoader && window.showLoader('Loading your data\u2026');
                        window._axiKeepLoaderForData = true;
                    }
                    if (typeof _updateModelBadge === 'function') _updateModelBadge();
                    window.axiRefreshEmptyState && window.axiRefreshEmptyState();
                } catch (err) {
                    window.hideLoader && window.hideLoader();
                    console.warn('[AXI] key fetch failed:', err.message);
                    if (typeof _updateModelBadge === 'function') _updateModelBadge();
                    // Only offer manual connect fallback to admins
                    if (!_isEmp) {
                        var _cBtnFallback = document.getElementById('openConnect');
                        if (_cBtnFallback) _cBtnFallback.classList.remove('axi-emp-hidden');
                        if (axiKeySetupModal && !axiKeySetupModal.open) axiKeySetupModal.showModal();
                    }
                }

                if (!_isEmp) return; /* admin: done */
                console.error('[AXI-DEBUG] non-admin flow started, user:', _axiUser.username);

                /* 3. Wait for fetchADSData to be ready */
                var _waitTries = 0;
                while (typeof window.fetchADSData !== 'function' && _waitTries < 20) {
                    await new Promise(function (r) { setTimeout(r, 500); });
                    _waitTries++;
                }
                if (typeof window.fetchADSData !== 'function') { _axiShowNoAccess(); return; }

                /* 4. Fetch user's groups via DS: SELECT usergroups FROM axusers WHERE USERNAME=:pusername */
                var _userGroups = [];
                try {
                    var _gRows = await new Promise(function (resolve, reject) {
                        if (typeof parent === 'undefined' || typeof parent.GetDataFromAxList !== 'function')
                            return reject(new Error('GetDataFromAxList unavailable'));
                        parent.GetDataFromAxList({
                            adsNames: ['axi_ai_username_usergroups'],
                            refreshCache: true,
                            sqlParams: { pusername: _axiUser.username }
                        }, function (resp) {
                            try {
                                var o = typeof resp === 'string' ? JSON.parse(resp) : resp;
                                var d = o && o.d ? o.d : o;
                                var inn = typeof d === 'string' ? JSON.parse(d) : d;
                                var data = (inn && inn.result && Array.isArray(inn.result.data) && inn.result.data.length) ? inn.result.data[0].data || [] : [];
                                resolve(data);
                            } catch (e) { reject(e); }
                        });
                    });
                    _userGroups = (_gRows || []).flatMap(function (r) {
                        var v = r.usergroups || r.USERGROUPS || r.userGroup || r.UserGroups || '';
                        return v.split(',').map(function (g) { return g.trim().toLowerCase(); }).filter(Boolean);
                    });
                    console.log('[AXI] groups for', _axiUser.username, ':', _userGroups);
                } catch (e) {
                    console.warn('[AXI] group DS failed:', e.message);
                    _axiShowNoAccess(); return;
                }

                if (!_userGroups.length) { _axiShowNoAccess(); return; }

                /* 5. Fetch RBAC config and match rows for this user's groups */
                var _rbac = [];
                try {
                    _rbac = await window.fetchADSData('axi_ai_rbac_config');
                    window.pendingDatabaseData = null; window.CURRENTADSDATA = null; window.CURRENTADSNAME = null;
                } catch (e) { console.warn('[AXI] RBAC failed:', e.message); _axiShowNoAccess(); return; }

                var _matched = (_rbac || []).filter(function (r) {
                    var g = (r.axusergroups || r.AXUSERGROUPS || r.groupname || r.GROUPNAME || '').toLowerCase();
                    if (!g) return false;
                    return g.split(',').map(function (x) { return x.trim(); }).some(function (x) { return _userGroups.indexOf(x) !== -1; });
                });
                if (!_matched.length) { _axiShowNoAccess(); return; }

                /* 6. Build bin→provider map */
                var _binMap = {};
                _matched.forEach(function (r) {
                    var bins = (r.binname || r.BINNAME || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
                    var prov = (r.provider || r.PROVIDER || '').toLowerCase();
                    var key = r.providerkey || r.PROVIDERKEY || r.provider_key || '';
                    bins.forEach(function (b) { if (!_binMap[b]) _binMap[b] = { provider: prov, key: key }; });
                });
                var _bins = Object.keys(_binMap);
                if (!_bins.length) { _axiShowNoAccess(); return; }

                window._AXI_USER_BIN_MAP = _binMap;
                console.error('[AXI-DEBUG] RBAC matched bins:', _bins);
                console.log('[AXI] assigned bins:', _bins);

                /* 7. Update store patch with real bins, re-render — loadSavedPins handles visibility */
                _piBootDone = true;        // must be set FIRST — guards any already-queued interval callback
                clearInterval(_piBoot);
                _piBoot = null;
                _axiPatchStore(_bins);

                /* 7a. Key injection — non-admin users get their provider/key from RBAC, not from
                       the connect modal. Apply it now for the default bin, then re-apply on every
                       bin switch so the provider badge always reflects the active bin's assignment. */
                function _axiApplyBinKey(binName) {
                    if (!binName || !window._AXI_USER_BIN_MAP) return;
                    /* case-insensitive lookup against the RBAC bin map */
                    var nm = String(binName).trim();
                    var entry = window._AXI_USER_BIN_MAP[nm];
                    if (!entry) {
                        var lo = nm.toLowerCase();
                        Object.keys(window._AXI_USER_BIN_MAP).forEach(function (k) {
                            if (!entry && k.toLowerCase() === lo) entry = window._AXI_USER_BIN_MAP[k];
                        });
                    }
                    if (!entry || !entry.provider || !entry.key) {
                        console.warn('[AXI] _axiApplyBinKey: no RBAC entry found for bin:', binName, '— map:', window._AXI_USER_BIN_MAP);
                        return;
                    }

                    console.log('[AXI] applying RBAC key for bin:', binName, 'provider:', entry.provider, 'key length:', (entry.key || '').length);

                    /* Three-tier key injection so it works regardless of script.js version:
                       1. setAxiRuntimeKey   — sets the let _AXI_RUNTIME_* vars inside script.js
                                               without any DB write (requires updated script.js)
                       2. localStorage       — getAxiConfig() already reads axi_api_key / axi_provider
                                               as its fallback path; works with unmodified script.js
                       Both tiers are always applied so the active tier is whichever the engine reads. */
                    if (typeof window.setAxiRuntimeKey === 'function') {
                        window.setAxiRuntimeKey(entry.key, entry.provider);
                    }
                    /* Always write localStorage too — getAxiConfig() fallback reads it */
                    try {
                        localStorage.setItem('axi_api_key', entry.key);
                        localStorage.setItem('axi_provider', entry.provider.toLowerCase());
                    } catch (e) { /* private-browsing or storage full — safe to ignore */ }

                    /* axiSwitchProviderUpdateBtn may not be ready yet — retry until available */
                    var _bt = 0;
                    (function _tryBtn() {
                        if (typeof window.axiSwitchProviderUpdateBtn === 'function') {
                            window.axiSwitchProviderUpdateBtn(entry.provider);
                        } else if (_bt++ < 20) {
                            setTimeout(_tryBtn, 150);
                        }
                    })();
                    if (typeof _updateModelBadge === 'function') _updateModelBadge();
                }

                /* Apply immediately for the first assigned bin so a key is always in place */
                if (_bins.length) _axiApplyBinKey(_bins[0]);

                /* Wrap applyPin once so the key and provider badge update whenever the user switches bins.
                   The badge is updated BEFORE the async data load (from SAVED_PINS_CACHE) so it
                   always shows the correct provider even if the data load fails. */
                if (typeof window.applyPin === 'function' && !window.applyPin._axiEmpKeyPatched) {
                    var _origApplyPin = window.applyPin;
                    window.applyPin = async function (id) {
                        /* Immediate badge update from cache — does not wait for data load */
                        if (window._AXI_USER_BIN_MAP) {
                            var _cache = window.SAVED_PINS_CACHE || [];
                            var _pin = _cache.find(function (p) { return String(p.id) === String(id); });
                            if (_pin && _pin.name) _axiApplyBinKey(_pin.name);
                        }
                        var result = await _origApplyPin.call(this, id);
                        /* Confirm from committed context after a successful load */
                        var ctx = window.ACTIVEDATABINCONTEXT || window.ACTIVE_DATABIN_CONTEXT;
                        if (ctx && ctx.name && typeof window.axiSwitchChatsToBin === 'function') {
                            window.axiSwitchChatsToBin(ctx.name);
                        }
                        if (ctx && ctx.name) _axiApplyBinKey(ctx.name);
                        return result;
                    };
                    window.applyPin._axiEmpKeyPatched = true;
                }

                if (typeof window.loadSavedPins === 'function') await window.loadSavedPins();

                /* ── Single-bin auto-analysis ───────────────────────────────────────
                   If the RBAC check assigned exactly one bin to this user, skip the
                   selection panel entirely and auto-apply + auto-analyze the bin.
                   On subsequent visits (_sbIsRestore) we still apply the bin so the
                   saved chat is visible, but we do NOT re-send the analysis prompt.  */
                if (_bins.length === 1) {
                    var _sbBin = _bins[0];
                    var _sbEntry = _binMap[_sbBin];
                    var _sbUname = (_axiUser.username || '').toLowerCase();

                    /* Is this a restore? Session must say analyzed AND localStorage
                       must actually have messages (not cleared).                     */
                    var _sbSess = null;
                    try { _sbSess = JSON.parse(localStorage.getItem('axi_emp_session_v1') || 'null'); } catch (e) { }
                    var _sbHasLs = false;
                    try {
                        var _sbChats = JSON.parse(localStorage.getItem('axpert_chats_v2') || '[]');
                        _sbHasLs = (_sbChats || []).some(function (c) { return c.messages && c.messages.length > 0; });
                    } catch (e) { }
                    var _sbIsRestore = !!(_sbSess && _sbSess.binName === _sbBin && _sbSess.analyzed && _sbHasLs);
                    console.error('[AXI-DEBUG] single-bin check:', {
                        bin: _sbBin,
                        sess: _sbSess,
                        hasLs: _sbHasLs,
                        isRestore: _sbIsRestore
                    });
                    if (_sbIsRestore) {
                        setTimeout(function () {
                            if (typeof window.axiSwitchChatsToBin === 'function') {
                                window.axiSwitchChatsToBin(_sbBin);
                            } else if (typeof window.axiRestoreThread === 'function') {
                                window.axiRestoreThread();
                            }
                        }, 300);
                    } else {
                        /* localStorage may have been wiped (e.g. Axpert frame reload).
                           Check IDB first — if data exists, restore silently.
                           Only auto-analyze if IDB is also empty (genuine first visit). */
                        var _doAutoAnalyze = function () {
                            var _sbTries = 0;
                            (function _waitForStartAnalysis() {
                                if (typeof window.startAnalysis !== 'function') {
                                    if (_sbTries++ < 20) setTimeout(_waitForStartAnalysis, 300);
                                    return;
                                }
                                window.startAnalysis({
                                    bin: _sbBin,
                                    provider: _sbEntry.provider,
                                    key: _sbEntry.key,
                                    autoAnalyze: true,
                                    onAnalyzed: function () {
                                        try {
                                            localStorage.setItem('axi_emp_session_v1', JSON.stringify({
                                                username: _sbUname,
                                                binName: _sbBin,
                                                analyzed: true,
                                                timestamp: Date.now()
                                            }));
                                        } catch (e) { }
                                        try {
                                            var _c = JSON.parse(localStorage.getItem('axpert_chats_v2') || '[]');
                                            var _ch = _c[0];
                                            if (_ch && _ch.messages && _ch.messages.length && window.AxiAnalysisDB) {
                                                window.AxiAnalysisDB.save(_sbUname, _sbBin, _ch.messages, _ch.id);
                                            }
                                        } catch (_e) { }
                                    }
                                });
                            })();
                        };

                        if (window.AxiAnalysisDB) {
                            window.AxiAnalysisDB.get(_sbUname, _sbBin).then(function (rec) {
                                console.error('[AXI-DEBUG] IDB get result:', rec ? { key: rec.key, msgCount: rec.messages && rec.messages.length } : null);
                                if (rec && rec.messages && rec.messages.length) {
                                    /* IDB has data — restore directly, no page reload needed */
                                    try {
                                        var _chat = {
                                            id: rec.chatId || ('axi_restored_' + Date.now()),
                                            title: 'Analysis \u2014 ' + (rec.binName || ''),
                                            createdAt: rec.timestamp || Date.now(),
                                            updatedAt: rec.timestamp || Date.now(),
                                            messages: rec.messages,
                                            dataset: null
                                        };
                                        localStorage.setItem('axpert_chats_v2', JSON.stringify([_chat]));
                                        localStorage.setItem('axi_emp_session_v1', JSON.stringify({
                                            username: _sbUname,
                                            binName: _sbBin,
                                            analyzed: true,
                                            timestamp: Date.now()
                                        }));
                                        if (typeof window.loadChats === 'function') window.loadChats();
                                    } catch (_e) { _doAutoAnalyze(); }
                                } else {
                                    _doAutoAnalyze(); /* genuine first visit */
                                }
                            }).catch(function () { _doAutoAnalyze(); });
                        } else {
                            _doAutoAnalyze();
                        }
                    }
                }

            }, 800);
            const dataPinModal = document.getElementById('dataPinModal');
            const openDataPinBtn = document.getElementById('openDataPin');
            const dataPinStatus = document.getElementById('dataPinStatus');
            const saveDataPinBtn = document.getElementById('saveDataPin');
            const dataPinSourceChips = document.getElementById('dataPinSourceList');
            const dataPinFileList = document.getElementById('dataPinFileList');
            const dataBinNameInput = document.getElementById('dataBinNameInput');
            const dataBinPage = document.getElementById("dataBinPage");
            const closeDataBinPageBtn = document.getElementById("closeDataBinPage");
            const dataBinTabDatasources = document.getElementById("dataBinTabDatasources");
            const dataBinTabFiles = document.getElementById("dataBinTabFiles");
            const dataBinPanelDatasources = document.getElementById("dataBinPanelDatasources");
            const dataBinPanelFiles = document.getElementById("dataBinPanelFiles");
            const dataBinDatasourceGrid = document.getElementById("dataBinDatasourceGrid");
            const dataBinDatasourcePageSearch = document.getElementById("dataBinDatasourcePageSearch");
            const dataBinDatasourceCount = document.getElementById("dataBinDatasourceCount");
            const dataBinStepDatasources = document.getElementById("dataBinStepDatasources");
            const dataBinStepFiles = document.getElementById("dataBinStepFiles");
            const dataBinStepName = document.getElementById("dataBinStepName");
            const dataBinPanelName = document.getElementById("dataBinPanelName");
            const dataBinPrevStepBtn = document.getElementById("dataBinPrevStep");
            const dataBinNextStepBtn = document.getElementById("dataBinNextStep");



            window.showLoader = function (text = "Saving Data Bin...") {
                const loader = document.getElementById('globalLoaderOverlay');
                const textEl = document.getElementById('globalLoaderText');
                if (textEl) textEl.textContent = text;
                if (loader) loader.classList.add('is-active');
            };

            window.hideLoader = function () {
                const loader = document.getElementById('globalLoaderOverlay');
                if (loader) loader.classList.remove('is-active');
            };

            window.ensureDataPinState = function () {
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

            // window.openDataBinPage: REMOVED — now defined by axi-databin-wizard.js
            // (the React rewrite). renderDataBinStep/validateDataBinStep below are
            // dead code kept temporarily (harmless: they act on DOM nodes React
            // replaces on mount) — safe to delete in a follow-up cleanup pass.

            function validateDataBinStep(step) {
                const state = window.ensureDataPinState();

                if (step === 1 && !state.sources.length) {
                    setDataPinStatus("Select at least one datasource before continuing.", "error");
                    return false;
                }

                if (step === 2 && !state.files.length) {
                    setDataPinStatus("Add at least one file before continuing.", "error");
                    return false;
                }

                if (step === 3 && !String(dataBinNameInput?.value || "").trim()) {
                    setDataPinStatus("Enter a name for this Data Bin.", "error");
                    dataBinNameInput?.focus();
                    return false;
                }

                setDataPinStatus("", "");
                return true;
            }

            dataBinPrevStepBtn?.addEventListener("click", function () {
                renderDataBinStep(Math.max(1, window.currentDataBinStep - 1));
            });

            dataBinNextStepBtn?.addEventListener("click", function () {
                if (!validateDataBinStep(window.currentDataBinStep)) return;
                renderDataBinStep(Math.min(3, window.currentDataBinStep + 1));
            });

            dataBinStepDatasources?.addEventListener("click", function () {
                renderDataBinStep(1);
            });

            dataBinStepFiles?.addEventListener("click", function () {
                if (!validateDataBinStep(1)) return;
                renderDataBinStep(2);
            });

            dataBinStepName?.addEventListener("click", function () {
                if (!validateDataBinStep(1)) return;
                if (!validateDataBinStep(2)) return;
                renderDataBinStep(3);
            });
            // window.closeDataBinPage: REMOVED — now defined by axi-databin-wizard.js.


            dataBinNameInput?.addEventListener("input", function () {
                if (!window.dataPinState) {
                    window.dataPinState = { sources: [], files: [], name: "My Data Bin" };
                }
                window.dataPinState.name = this.value.trim() || "My Data Bin";
            });


            window.currentDataBinStep = 1;

            function getDataBinStepKey(step) {
                if (step === 1) return "datasources";
                if (step === 2) return "files";
                return "name";
            }

            function renderDataBinStep(step) {
                window.currentDataBinStep = step;
                const _dsSearch = document.getElementById('dataBinDatasourcePageSearch');
                if (_dsSearch) { _dsSearch.value = ''; }

                const isStep1 = step === 1;
                const isStep2 = step === 2;
                const isStep3 = step === 3;

                dataBinStepDatasources?.classList.toggle("is-active", isStep1);
                dataBinStepFiles?.classList.toggle("is-active", isStep2);
                dataBinStepName?.classList.toggle("is-active", isStep3);

                if (dataBinPanelDatasources) dataBinPanelDatasources.hidden = !isStep1;
                if (dataBinPanelFiles) dataBinPanelFiles.hidden = !isStep2;
                if (dataBinPanelName) dataBinPanelName.hidden = !isStep3;

                dataBinPanelDatasources?.classList.toggle("is-active", isStep1);
                dataBinPanelFiles?.classList.toggle("is-active", isStep2);
                dataBinPanelName?.classList.toggle("is-active", isStep3);

                if (dataBinPrevStepBtn) dataBinPrevStepBtn.style.display = step > 1 ? "inline-flex" : "none";
                if (dataBinNextStepBtn) dataBinNextStepBtn.style.display = step < 3 ? "inline-flex" : "none";
                if (saveDataPinBtn) saveDataPinBtn.style.display = step === 3 ? "inline-flex" : "none";

                if (isStep1 && typeof loadDataSources === "function") {
                    loadDataSources();
                    renderDatasourceCards(dataBinDatasourcePageSearch?.value);
                }

                if (isStep2 && typeof renderDataPinFiles === "function") {
                    renderDataPinFiles();
                }

                if (isStep3 && dataBinNameInput && !dataBinNameInput.value.trim()) {
                    dataBinNameInput.value = window.dataPinState?.name || "My Data Bin 1";
                }
            }


            function updateDatasourceSelectionCount() {
                const selectedCount = window.dataPinState?.sources?.length || 0;
                const totalCount = Array.isArray(window.DBLIST) ? window.DBLIST.length : 0;

                if (dataBinDatasourceCount) {
                    dataBinDatasourceCount.textContent =
                        selectedCount === 1 ? "1 selected" : `${selectedCount} selected`;
                }

                const availableEl = document.getElementById("dataBinDatasourceAvailableCount");
                if (availableEl) {
                    availableEl.textContent =
                        totalCount === 1 ? "1 total" : `${totalCount} total`;
                }

                const previewEl = document.getElementById("dataBinSelectionPreview");
                if (previewEl) {
                    const selectedLabels = (window.dataPinState?.sources || [])
                        .map(src => src.caption || src.name)
                        .slice(0, 3);

                    if (!selectedLabels.length) {
                        previewEl.innerHTML = `
        <span class="material-icons">bookmark_added</span>
        <span>No datasources selected yet.</span>
      `;
                    } else {
                        const more = selectedCount > 3 ? ` +${selectedCount - 3} more` : "";
                        previewEl.innerHTML = `
        <span class="material-icons">bookmark_added</span>
        <span>${dpEscape(selectedLabels.join(", "))}${dpEscape(more)}</span>
      `;
                    }
                }
            }

            // ── Probe cache — keyed by ADS name, persists for the session ──────
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

            async function toggleDatasourceSelection(value, label) {
                if (!value) return;

                const state = window.ensureDataPinState();
                const idx = state.sources.findIndex(src => src.name === value);

                if (idx >= 0) {
                    // ── Deselect ─────────────────────────────────────────────
                    state.sources.splice(idx, 1);
                    const next = new Set();
                    (window._axiExpandedParamChips || new Set()).forEach(function (i) {
                        if (i < idx) next.add(i);
                        else if (i > idx) next.add(i - 1);
                    });
                    window._axiExpandedParamChips = next;
                    renderDatasourceCards(dataBinDatasourcePageSearch?.value || "");
                    renderDataPinSourceChips();
                    updateDatasourceSelectionCount();
                    setDataPinStatus("", "success");
                    return;
                }

                // ── Select: probe first, then add ────────────────────────────
                if (window._axiProbingADS.has(value)) return; // prevent re-entry
                if (state.sources.length >= 5) {
                    setDataPinStatus('Maximum 5 datasources per Data Bin. Remove one before adding another.', 'error');
                    return;
                }
                window._axiProbingADS.add(value);

                // Add immediately with 'probing' flag so the chip shows a spinner
                state.sources.push({
                    name: value, caption: label || value,
                    type: "database", sqlParams: {}, _probeStatus: 'probing'
                });
                renderDatasourceCards(dataBinDatasourcePageSearch?.value || "");
                renderDataPinSourceChips();
                updateDatasourceSelectionCount();

                try {
                    const probe = await _probeADSParams(value);
                    const srcIdx = state.sources.findIndex(s => s.name === value);
                    if (srcIdx < 0) return; // removed while probing

                    state.sources[srcIdx]._probeStatus = probe.status;

                    if (probe.status === 'parameterized' && probe.params.length > 0) {
                        // Pre-populate sqlParams keys from detected param names (empty values)
                        const sp = {};
                        probe.params.forEach(function (p) { sp[p.name] = ''; });
                        state.sources[srcIdx].sqlParams = sp;
                        state.sources[srcIdx]._detectedParams = probe.params;
                        // Auto-expand the param editor for this chip
                        window._axiExpandedParamChips.add(srcIdx);
                    }
                } catch (_) {
                    const srcIdx = state.sources.findIndex(s => s.name === value);
                    if (srcIdx >= 0) state.sources[srcIdx]._probeStatus = 'unknown';
                } finally {
                    window._axiProbingADS.delete(value);
                }

                state.sources = dedupeBy(state.sources, x => x.name);
                renderDatasourceCards(dataBinDatasourcePageSearch?.value || "");
                renderDataPinSourceChips();
                updateDatasourceSelectionCount();
                setDataPinStatus("", "success");
            }

            function renderDatasourceCards(filterText = "") {
                if (!dataBinDatasourceGrid) return;

                const q = String(filterText || "").trim().toLowerCase();
                const allOptions = getDatasourceOptions();
                const options = allOptions.filter(item =>
                    String(item.label || "").toLowerCase().includes(q) ||
                    String(item.value || "").toLowerCase().includes(q)
                );

                if (!options.length) {
                    dataBinDatasourceGrid.innerHTML = `
      <div class="dataBinEmptyState">
        <div>
          <span class="material-icons">search_off</span>
          <h3>No datasources found</h3>
          <p>Try another search term.</p>
        </div>
      </div>
    `;
                    updateDatasourceSelectionCount();
                    return;
                }

                dataBinDatasourceGrid.innerHTML = "";

                options.forEach(item => {
                    const isSelected = !!window.ensureDataPinState().sources.some(
                        src => src.name === item.value
                    );

                    const btn = document.createElement("button");
                    btn.type = "button";
                    btn.className = `dataBinDatasourceCard${isSelected ? " is-selected" : ""}`;
                    btn.dataset.value = item.value;
                    btn.dataset.label = item.label || item.value;
                    btn.setAttribute("aria-pressed", isSelected ? "true" : "false");

                    btn.innerHTML = `
      <div class="dataBinDatasourceCardTop">
        <div class="dataBinDatasourceCardIcon">
          <span class="material-icons">table_rows</span>
        </div>
        <div class="dataBinDatasourceCardCheck">
          <span class="material-icons" style="font-size:15px;">check</span>
        </div>
      </div>
      <h3 class="dataBinDatasourceCardLabel">${dpEscape(item.label || item.value)}</h3>
      <span class="dataBinDatasourceCardName">${dpEscape(item.value)}</span>
      <div class="dataBinDatasourceCardMeta">
        <span class="material-icons" style="font-size:14px;">layers</span>
        <span>${isSelected ? "Selected" : "Click to add"}</span>
      </div>
    `;

                    btn.addEventListener("click", async function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        await toggleDatasourceSelection(item.value, item.label || item.value);
                    });

                    btn.addEventListener("keydown", async function (e) {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            await toggleDatasourceSelection(item.value, item.label || item.value);
                        }
                    });

                    dataBinDatasourceGrid.appendChild(btn);
                });

                updateDatasourceSelectionCount();
            }


            function dpEscape(str) {
                return String(str ?? "")
                    .replace(/&/g, String.fromCharCode(38) + 'amp;')
                    .replace(/</g, String.fromCharCode(38) + 'lt;')
                    .replace(/>/g, String.fromCharCode(38) + 'gt;')
                    .replace(/"/g, String.fromCharCode(38) + 'quot;')
                    .replace(/'/g, String.fromCharCode(38) + '#39;');
            }


            openDataPinBtn?.addEventListener("click", function () {
                startNewDataBin();
            });

            closeDataBinPageBtn?.addEventListener("click", function () {
                window.closeDataBinPage();
            });

            dataBinDatasourcePageSearch?.addEventListener("input", function () {
                renderDatasourceCards(this.value);
            });




            function dedupeBy(arr, keyFn) {
                const map = new Map();
                (arr || []).forEach(function (item) {
                    const key = keyFn(item);
                    if (!map.has(key)) map.set(key, item);
                });
                return Array.from(map.values());
            }

            function getDatasourceOptions() {
                if (!Array.isArray(window.DBLIST)) return [];
                return window.DBLIST
                    .map(function (item) {
                        const value = item?.name;
                        const label = item?.caption || item?.name;
                        return { value, label };
                    })
                    .filter(function (item) {
                        return item.value && item.label;
                    });
            }

            function updateDataPinDatasourceValue() {
                const valueEl = document.getElementById("dataPinDatasourceValue");
                if (!valueEl) return;

                const count = window.dataPinState?.sources?.length || 0;

                if (!count) {
                    valueEl.textContent = "Select datasources...";
                    return;
                }

                if (count === 1) {
                    valueEl.textContent =
                        window.dataPinState.sources[0].caption || window.dataPinState.sources[0].name;
                    return;
                }

                valueEl.textContent = count + " datasources selected";
            }

            function updateDataPinFileValue() {
                const valueEl = document.getElementById("selectedValue");
                if (!valueEl) return;

                const count = window.dataPinState?.files?.length || 0;

                if (!count) {
                    valueEl.textContent = "Select files...";
                    return;
                }

                if (count === 1) {
                    valueEl.textContent = window.dataPinState.files[0].name;
                    return;
                }

                valueEl.textContent = count + " files selected";
            }


            function renderDataPinFiles() {
                if (!dataPinFileList) return;

                const files = Array.isArray(window.dataPinState?.files) ? window.dataPinState.files : [];

                if (!files.length) {
                    dataPinFileList.classList.add("attachmentTray--hidden");
                    dataPinFileList.innerHTML = `
      <div class="dataBinFileEmpty">
        <div>
          <span class="material-icons">description</span>
          <div>No files added yet.</div>
        </div>
      </div>
    `;
                    return;
                }

                dataPinFileList.classList.remove("attachmentTray--hidden");
                dataPinFileList.innerHTML = "";

                files.forEach((file, idx) => {
                    const chip = document.createElement("div");
                    chip.className = "attachmentChip";
                    chip.innerHTML = `
      <div class="attachmentChipthumb">
        <span class="material-icons" style="font-size:18px;color:#64748B;">description</span>
      </div>
      <div class="attachmentChipname" title="${dpEscape(file.name)}">${dpEscape(file.name)}</div>
      <button class="attachmentChipremove" type="button" aria-label="Remove file">
        <span class="material-icons" style="font-size:18px;">close</span>
      </button>
    `;

                    chip.querySelector("button").addEventListener("click", function () {
                        window.dataPinState.files.splice(idx, 1);
                        renderDataPinFiles();
                    });

                    dataPinFileList.appendChild(chip);
                });
            }
            // window.renderDataPinModal: REMOVED — axi-databin-wizard.js registers
            // its own (window.renderDataPinModal = notify, a React re-render trigger).
            function renderDataBinFileOptions(query) {
                const listEl = document.getElementById("customOptionsList");
                if (!listEl) return;

                const allFiles =
                    window.AxiLibrary && typeof window.AxiLibrary.getAll === "function"
                        ? window.AxiLibrary.getAll()
                        : [];

                const q = String(query || "").trim().toLowerCase();
                const filtered = allFiles.filter(function (f) {
                    return String(f.name || "").toLowerCase().includes(q);
                });

                if (!filtered.length) {
                    listEl.innerHTML = '<li class="custom-option disabled">No uploaded files</li>';
                    return;
                }

                listEl.innerHTML = filtered
                    .map(function (fileMeta) {
                        const isSelected = window.dataPinState.files.some(function (f) {
                            return f.name === fileMeta.name;
                        });

                        return (
                            '<li class="custom-option ' + (isSelected ? "selected" : "") + '" ' +
                            'data-name="' + dpEscape(fileMeta.name) + '">' +
                            '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;">' +
                            '<div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">' +
                            '<input type="checkbox" ' + (isSelected ? "checked" : "") + ' style="pointer-events:none;">' +
                            '<div style="min-width:0;display:flex;flex-direction:column;">' +
                            '<span style="font-weight:600;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + dpEscape(fileMeta.name) + '</span>' +
                            "</div></div></div></li>"
                        );
                    })
                    .join("");
            }



            if (!document.body.dataset.dataBinOutsideClickBound) {
                document.body.dataset.dataBinOutsideClickBound = "1";

                document.addEventListener("click", function (e) {
                    const dsWrapper = document.getElementById("dataPinDatasourceWrapper");
                    const fileWrapper = document.getElementById("dataPinFileWrapper");

                    if (
                        e.target.closest("#dataPinDatasourceWrapper") ||
                        e.target.closest("#dataPinFileWrapper")
                    ) {
                        return;
                    }

                    dsWrapper?.classList.remove("open");
                    fileWrapper?.classList.remove("open");
                });
            }

            window.addSourceToPin = function (name, label) {
                if (!name) return;

                const exists = window.dataPinState.sources.some(function (src) {
                    return src.name === name;
                });

                if (!exists) {
                    window.dataPinState.sources.push({
                        name: name,
                        caption: label || name,
                        type: "database",
                        sqlParams: {}
                    });
                }

                window.dataPinState.sources = dedupeBy(window.dataPinState.sources, function (x) {
                    return x.name;
                });

                window.renderDataPinModal();
                renderDatasourceOptions(document.getElementById("dataPinDatasourceSearch")?.value || "");
            };

            window.addFileToPin = async function (file) {
                if (!file) return;
                if ((window.dataPinState.files || []).length >= 5) {
                    setDataPinStatus('Maximum 5 files per Data Bin. Remove a file before adding more.', 'error');
                    return;
                }

                window.dataPinState.files.push(file);
                window.dataPinState.files = dedupeBy(window.dataPinState.files, function (f) {
                    return [f.name, f.size, f.lastModified].join("|");
                });

                window.renderDataPinModal();
                renderDataBinFileOptions(document.getElementById("optionSearch")?.value || "");
            };
            if (!window.dataPinState) {
                window.dataPinState = { sources: [], files: [], name: 'my databin1' };
            }


            function updateDataPinDatasourceValue() {
                const valueEl = document.getElementById('dataPinDatasourceValue');
                if (!valueEl) return;

                const count = window.dataPinState?.sources?.length || 0;

                if (!count) {
                    valueEl.textContent = 'Select datasource(s)...';
                    return;
                }

                if (count === 1) {
                    valueEl.textContent = window.dataPinState.sources[0].caption || window.dataPinState.sources[0].name;
                    return;
                }

                valueEl.textContent = count + ' datasources selected';
            }

            function updateDataPinFileValue() {
                const valueEl = document.getElementById('selectedValue');
                if (!valueEl) return;

                const count = window.dataPinState?.files?.length || 0;

                if (!count) {
                    valueEl.textContent = 'Select file(s)...';
                    return;
                }

                if (count === 1) {
                    valueEl.textContent = window.dataPinState.files[0].name;
                    return;
                }

                valueEl.textContent = count + ' files selected';
            }

            function renderDatasourceOptions(filterText) {
                const listEl = document.getElementById('dataPinDatasourceList');
                if (!listEl) return;

                const q = String(filterText || '').trim().toLowerCase();

                const options = getDatasourceOptions().filter(function (item) {
                    return item.label.toLowerCase().includes(q) || item.value.toLowerCase().includes(q);
                });

                if (!options.length) {
                    listEl.innerHTML = '<li class="custom-option disabled">No datasources loaded</li>';
                    return;
                }

                listEl.innerHTML = options.map(function (item) {
                    const isSelected = (window.dataPinState?.sources || []).some(function (src) {
                        return src.name === item.value;
                    });

                    return `
            <li class="custom-option ${isSelected ? 'selected' : ''}" data-value="${escapeHtml(item.value)}" data-label="${escapeHtml(item.label)}">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;">
                    <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
                        <input type="checkbox" ${isSelected ? 'checked' : ''} style="pointer-events:none;">
                        <div style="min-width:0;display:flex;flex-direction:column;">
                            <span style="font-weight:600;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.label)}</span>
                            <span style="font-size:12px;color:#94A3B8;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.value)}</span>
                        </div>
                    </div>
                </div>
            </li>
        `;
                }).join('');
            }

            function updateDataPinDatasourceValue() {
                const valueEl = document.getElementById('dataPinDatasourceValue');
                if (!valueEl) return;

                const count = window.dataPinState?.sources?.length || 0;

                if (!count) {
                    valueEl.textContent = 'Select datasource(s)...';
                    return;
                }

                if (count === 1) {
                    valueEl.textContent = window.dataPinState.sources[0].caption || window.dataPinState.sources[0].name;
                    return;
                }

                valueEl.textContent = count + ' datasources selected';
            }

            function updateDataPinFileValue() {
                const valueEl = document.getElementById('selectedValue');
                if (!valueEl) return;

                const count = window.dataPinState?.files?.length || 0;

                if (!count) {
                    valueEl.textContent = 'Select file(s)...';
                    return;
                }

                if (count === 1) {
                    valueEl.textContent = window.dataPinState.files[0].name;
                    return;
                }

                valueEl.textContent = count + ' files selected';
            }

            function renderDatasourceOptions(filterText) {
                const listEl = document.getElementById('dataPinDatasourceList');
                if (!listEl) return;

                const q = String(filterText || '').trim().toLowerCase();

                const options = getDatasourceOptions().filter(function (item) {
                    return item.label.toLowerCase().includes(q) || item.value.toLowerCase().includes(q);
                });

                if (!options.length) {
                    listEl.innerHTML = '<li class="custom-option disabled">No datasources loaded</li>';
                    return;
                }

                listEl.innerHTML = options.map(function (item) {
                    const isSelected = (window.dataPinState?.sources || []).some(function (src) {
                        return src.name === item.value;
                    });

                    return `
            <li class="custom-option ${isSelected ? 'selected' : ''}" data-value="${escapeHtml(item.value)}" data-label="${escapeHtml(item.label)}">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;">
                    <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
                        <input type="checkbox" ${isSelected ? 'checked' : ''} style="pointer-events:none;">
                        <div style="min-width:0;display:flex;flex-direction:column;">
                            <span style="font-weight:600;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.label)}</span>
                            <span style="font-size:12px;color:#94A3B8;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.value)}</span>
                        </div>
                    </div>
                </div>
            </li>
        `;
                }).join('');
            }

            function renderDataBinFileOptions(query) {
                const listEl = document.getElementById('customOptionsList');
                if (!listEl) return;

                const allFiles = window.AxiLibrary && typeof AxiLibrary.getAll === 'function' ? AxiLibrary.getAll() : [];
                const q = String(query || '').trim().toLowerCase();

                const filtered = allFiles.filter(function (f) {
                    return String(f.name || '').toLowerCase().includes(q);
                });

                if (!filtered.length) {
                    listEl.innerHTML = '<li class="custom-option disabled">No uploaded files</li>';
                    return;
                }

                listEl.innerHTML = filtered.map(function (fileMeta) {
                    const isSelected = (window.dataPinState?.files || []).some(function (f) {
                        return f.name === fileMeta.name;
                    });

                    return `
            <li class="custom-option ${isSelected ? 'selected' : ''}" data-name="${escapeHtml(fileMeta.name)}">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;">
                    <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
                        <input type="checkbox" ${isSelected ? 'checked' : ''} style="pointer-events:none;">
                        <div style="min-width:0;display:flex;flex-direction:column;">
                            <span style="font-weight:600;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(fileMeta.name)}</span>
                        </div>
                    </div>
                </div>
            </li>
        `;
                }).join('');
            }


            function initDataBinFileDropdown() {
                const wrapper = document.getElementById('dataPinFileWrapper');
                const trigger = wrapper?.querySelector('.custom-select-trigger');
                const valueEl = document.getElementById('selectedValue');
                const searchEl = document.getElementById('optionSearch');
                const listEl = document.getElementById('customOptionsList');
                const hiddenEl = document.getElementById('axiFileSelect');

                if (!wrapper || !trigger || !valueEl || !searchEl || !listEl || !hiddenEl) return;
                if (wrapper.dataset.bound === '1') return;
                wrapper.dataset.bound = '1';

                updateDataPinFileValue();

                trigger.addEventListener('click', function (e) {
                    e.stopPropagation();
                    wrapper.classList.toggle('open');

                    if (wrapper.classList.contains('open')) {
                        searchEl.value = '';
                        renderDataBinFileOptions('');
                        setTimeout(function () { searchEl.focus(); }, 0);
                    }
                });

                trigger.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        trigger.click();
                    }
                });

                searchEl.addEventListener('input', function () {
                    renderDataBinFileOptions(this.value);
                });

                listEl.addEventListener('click', async function (e) {
                    const option = e.target.closest('.custom-option');
                    if (!option || option.classList.contains('disabled')) return;

                    e.preventDefault();
                    e.stopPropagation();

                    const fileName = option.dataset.name;

                    if (!window.dataPinState) {
                        window.dataPinState = { sources: [], files: [], name: 'my databin1' };
                    }

                    const existingIdx = window.dataPinState.files.findIndex(function (f) {
                        return f.name === fileName;
                    });

                    if (existingIdx >= 0) {
                        window.dataPinState.files.splice(existingIdx, 1);
                    } else {
                        if (!window.AxiLibrary || typeof AxiLibrary.getFileObj !== 'function') return;
                        const fileObj = await AxiLibrary.getFileObj(fileName);
                        if (!fileObj) return;
                        window.dataPinState.files.push(fileObj);
                    }

                    window.dataPinState.files = dedupeBy(window.dataPinState.files, function (f) {
                        return [f.name, f.size, f.lastModified].join('|');
                    });

                    hiddenEl.value = window.dataPinState.files.map(function (f) { return f.name; }).join(',');
                    updateDataPinFileValue();
                    renderDataBinFileOptions(searchEl.value || '');

                    if (typeof renderDataPinFiles === 'function') {
                        renderDataPinFiles();
                    }
                    if (typeof window.renderDataPinModal === 'function') {
                        window.renderDataPinModal();
                    }
                });
            }
            function initDataBinDatasourceDropdown() {
                const wrapper = document.getElementById('dataPinDatasourceWrapper');
                const trigger = wrapper?.querySelector('.custom-select-trigger');
                const valueEl = document.getElementById('dataPinDatasourceValue');
                const searchEl = document.getElementById('dataPinDatasourceSearch');
                const listEl = document.getElementById('dataPinDatasourceList');
                const hiddenEl = document.getElementById('dataPinDatasourceSelect');

                if (!wrapper || !trigger || !valueEl || !searchEl || !listEl || !hiddenEl) return;
                if (wrapper.dataset.bound === '1') return;
                wrapper.dataset.bound = '1';

                updateDataPinDatasourceValue();

                trigger.addEventListener('click', function (e) {
                    e.stopPropagation();
                    wrapper.classList.toggle('open');

                    if (wrapper.classList.contains('open')) {
                        loadDataSources();
                        searchEl.value = '';                             // ✅ clear on open
                        renderDatasourceOptions('');
                        setTimeout(function () { searchEl.focus(); }, 0);
                    }
                });

                trigger.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        trigger.click();
                    }
                });

                searchEl.addEventListener('input', function () {
                    renderDatasourceOptions(this.value);
                });

                listEl.addEventListener('click', function (e) {
                    const option = e.target.closest('.custom-option');
                    if (!option || option.classList.contains('disabled')) return;

                    e.preventDefault();
                    e.stopPropagation();

                    const value = option.dataset.value;
                    const label = option.dataset.label || option.textContent.trim();

                    if (!window.dataPinState) {
                        window.dataPinState = { sources: [], files: [], name: 'my databin1' };
                    }

                    const idx = window.dataPinState.sources.findIndex(function (src) {
                        return src.name === value;
                    });

                    if (idx >= 0) {
                        window.dataPinState.sources.splice(idx, 1);
                    } else {
                        window.dataPinState.sources.push({
                            name: value,
                            caption: label,
                            type: 'database'
                        });
                    }

                    window.dataPinState.sources = dedupeBy(window.dataPinState.sources, function (x) {
                        return x.name;
                    });

                    hiddenEl.value = window.dataPinState.sources.map(function (x) { return x.name; }).join(',');
                    updateDataPinDatasourceValue();
                    renderDatasourceOptions(searchEl.value || '');

                    if (typeof renderDataPinSourceChips === 'function') {
                        renderDataPinSourceChips();
                    }
                    if (typeof window.renderDataPinModal === 'function') {
                        window.renderDataPinModal();
                    }
                });
            }

            function initDataBinFileDropdown() {
                const wrapper = document.getElementById('dataPinFileWrapper');
                const trigger = wrapper?.querySelector('.custom-select-trigger');
                const valueEl = document.getElementById('selectedValue');
                const searchEl = document.getElementById('optionSearch');
                const listEl = document.getElementById('customOptionsList');
                const hiddenEl = document.getElementById('axiFileSelect');

                if (!wrapper || !trigger || !valueEl || !searchEl || !listEl || !hiddenEl) return;
                if (wrapper.dataset.bound === '1') return;
                wrapper.dataset.bound = '1';

                updateDataPinFileValue();

                trigger.addEventListener('click', function (e) {
                    e.stopPropagation();
                    wrapper.classList.toggle('open');

                    if (wrapper.classList.contains('open')) {
                        searchEl.value = '';
                        renderDataBinFileOptions('');
                        setTimeout(function () { searchEl.focus(); }, 0);
                    }
                });

                trigger.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        trigger.click();
                    }
                });

                searchEl.addEventListener('input', function () {
                    renderDataBinFileOptions(this.value);
                });

                listEl.addEventListener('click', async function (e) {
                    const option = e.target.closest('.custom-option');
                    if (!option || option.classList.contains('disabled')) return;

                    e.preventDefault();
                    e.stopPropagation();

                    const fileName = option.dataset.name;

                    if (!window.dataPinState) {
                        window.dataPinState = { sources: [], files: [], name: 'my databin1' };
                    }

                    const existingIdx = window.dataPinState.files.findIndex(function (f) {
                        return f.name === fileName;
                    });

                    if (existingIdx >= 0) {
                        window.dataPinState.files.splice(existingIdx, 1);
                    } else {
                        if (!window.AxiLibrary || typeof AxiLibrary.getFileObj !== 'function') return;
                        const fileObj = await AxiLibrary.getFileObj(fileName);
                        if (!fileObj) return;
                        window.dataPinState.files.push(fileObj);
                    }

                    window.dataPinState.files = dedupeBy(window.dataPinState.files, function (f) {
                        return [f.name, f.size, f.lastModified].join('|');
                    });

                    hiddenEl.value = window.dataPinState.files.map(function (f) { return f.name; }).join(',');
                    updateDataPinFileValue();
                    renderDataBinFileOptions(searchEl.value || '');

                    if (typeof renderDataPinFiles === 'function') {
                        renderDataPinFiles();
                    }
                    if (typeof window.renderDataPinModal === 'function') {
                        window.renderDataPinModal();
                    }
                });
            }

            if (!document.body.dataset.dataBinOutsideClickBound) {
                document.body.dataset.dataBinOutsideClickBound = '1';

                document.addEventListener('click', function (e) {
                    // If they are clicking on ANY dropdown trigger, do not aggressively close everything
                    // Let the trigger's own click handler manage toggling.
                    if (e.target.closest('.custom-select-trigger')) {
                        return;
                    }
                });
            }

            function getDatasourceOptions() {
                if (!Array.isArray(window.DBLIST)) return [];

                return window.DBLIST
                    .map(function (item) {
                        const value = item?.name || '';
                        const label = item?.caption || item?.name || '';
                        return { value: value, label: label };
                    })
                    .filter(function (item) {
                        return item.value && item.label;
                    });
            }

            // openExistingDataBin / startNewDataBin: REMOVED — now defined by
            // axi-databin-wizard.js (window.openExistingDataBin / window.startNewDataBin),
            // backed by the same DataBinStore/_probeADSParams in axi-databin-services.js.
            // ───────────────────────────────────────────────────────────────
            // DataBin persistence (REMOTE ONLY)
            // - Read all databins from shared DB via ADS: axi_ai_bin
            // - Save/Delete via server-side handler (your tstruct a__xd implementation)
            // - No IndexedDB fallback
            // ───────────────────────────────────────────────────────────────

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

            function _extractRecordId(response) {
                try {
                    const raw = typeof response === 'string' ? response : (response?.d || JSON.stringify(response));
                    const match = raw.match(/recordid=(\d+)/);
                    return match ? match[1] : '';
                } catch (_) { return ''; }
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
            function getCurrentDataPinUserKey() {
                return (
                    localStorage.getItem("axi_user_id") ||
                    localStorage.getItem("axi_api_key") ||
                    localStorage.getItem("axi_provider") ||
                    "anonymous"
                );
            }

            const dataPinState = {
                stagedSourceIds: [],
                sources: [],
                files: []
            };


            function setDataBinStep(step) {
                window.currentDataBinStep = step;

                const isStep1 = step === 1;
                const isStep2 = step === 2;
                const isStep3 = step === 3;

                dataBinStepDatasources?.classList.toggle('is-active', isStep1);
                dataBinStepFiles?.classList.toggle('is-active', isStep2);
                dataBinStepName?.classList.toggle('is-active', isStep3);

                if (dataBinPanelDatasources) dataBinPanelDatasources.hidden = !isStep1;
                if (dataBinPanelFiles) dataBinPanelFiles.hidden = !isStep2;
                if (dataBinPanelName) dataBinPanelName.hidden = !isStep3;

                dataBinPanelDatasources?.classList.toggle('is-active', isStep1);
                dataBinPanelFiles?.classList.toggle('is-active', isStep2);
                dataBinPanelName?.classList.toggle('is-active', isStep3);
            }

            dataBinStepDatasources?.addEventListener('click', () => setDataBinStep(1));
            dataBinStepFiles?.addEventListener('click', () => setDataBinStep(2));
            dataBinStepName?.addEventListener('click', () => setDataBinStep(3));

            dataBinNextStepBtn?.addEventListener('click', () => {
                setDataBinStep(Math.min(3, (window.currentDataBinStep || 1) + 1));
            });

            dataBinPrevStepBtn?.addEventListener('click', () => {
                setDataBinStep(Math.max(1, (window.currentDataBinStep || 1) - 1));
            });
            function setDataPinStatus(message, type) {
                if (!dataPinStatus) return;
                if (!message) {
                    dataPinStatus.style.display = "none";
                    dataPinStatus.className = "status";
                    dataPinStatus.textContent = "";
                    return;
                }
                dataPinStatus.textContent = message;
                dataPinStatus.className = "status " + (type === "error" ? "status--error" : "status--success");
                dataPinStatus.style.display = "flex";
            }

            function resetDataPinState() {
                dataPinState.stagedSourceIds = [];
                dataPinState.sources = [];
                dataPinState.files = [];
                if (dataPinOptionSearch) dataPinOptionSearch.value = "";
                setDataPinStatus("", "");
                renderDataPinSelectedText();
                renderDataPinOptions("");
                renderDataPinSourceChips();
                renderDataPinFiles();
            }

            function dedupeBy(arr, keyFn) {
                const map = new Map();
                arr.forEach(item => {
                    const key = keyFn(item);
                    if (!map.has(key)) map.set(key, item);
                });
                return Array.from(map.values());
            }

            function renderDataPinSelectedText() {
                if (!dataPinSelectedValue) return;
                if (!dataPinState.stagedSourceIds.length) {
                    dataPinSelectedValue.textContent = "Select datasources...";
                    return;
                }

                const labels = dataPinState.stagedSourceIds.map(id => {
                    const item = (window.DBLIST || []).find(x => x.name === id);
                    return item?.caption || item?.name || id;
                });

                dataPinSelectedValue.textContent = labels.join(", ");
            }

            function renderDataPinOptions(query) {
                if (!dataPinOptionsList) return;

                const sourceList = Array.isArray(window.DBLIST) ? window.DBLIST.slice() : [];
                const q = String(query || "").trim().toLowerCase();

                const filtered = !q
                    ? sourceList
                    : sourceList.filter(item =>
                        String(item.name || "").toLowerCase().includes(q) ||
                        String(item.caption || "").toLowerCase().includes(q)
                    );

                dataPinOptionsList.innerHTML = "";

                if (!filtered.length) {
                    dataPinOptionsList.innerHTML = '<li class="custom-option disabled">No data sources found</li>';
                    return;
                }

                filtered.forEach(item => {
                    const checked = dataPinState.stagedSourceIds.includes(item.name);
                    const li = document.createElement("li");
                    li.className = "custom-option" + (checked ? " selected" : "");

                    li.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
        <div style="display:flex; align-items:center; gap:10px; min-width:0;">
          <input type="checkbox" ${checked ? "checked" : ""} style="pointer-events:none;" />
          <span style="font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${item.caption || item.name}
          </span>
        </div>
        <span style="color:#94A3B8; font-size:12px; font-family:monospace;">
          ${item.name}
        </span>
      </div>
    `;

                    li.addEventListener("click", function (e) {
                        e.preventDefault();
                        e.stopPropagation();

                        const idx = dataPinState.stagedSourceIds.indexOf(item.name);
                        if (idx >= 0) dataPinState.stagedSourceIds.splice(idx, 1);
                        else dataPinState.stagedSourceIds.push(item.name);

                        renderDataPinSelectedText();
                        renderDataPinOptions(dataPinOptionSearch ? dataPinOptionSearch.value : "");
                    });

                    dataPinOptionsList.appendChild(li);
                });
            }

            // Tracks which chip indices have their param editor open across re-renders.
            window._axiExpandedParamChips = window._axiExpandedParamChips || new Set();

            function renderDataPinSourceChips() {
                const state = window.ensureDataPinState();
                if (!dataPinSourceChips) return;

                const isAdmin = !window._axiIsClientEmployee;

                dataPinSourceChips.innerHTML = "";

                if (!state.sources.length) {
                    dataPinSourceChips.innerHTML = `
      <div class="dataBinPinnedEmpty">
        <span class="material-icons">table_rows</span>
        <span>No datasources added yet.</span>
      </div>
    `;
                    return;
                }

                state.sources.forEach(function (src, idx) {
                    if (!src.sqlParams || typeof src.sqlParams !== 'object') src.sqlParams = {};
                    const probeStatus = src._probeStatus || 'unknown';
                    const isProbing = probeStatus === 'probing';
                    const isClean = probeStatus === 'clean';
                    const params = src.sqlParams;
                    const detected = Array.isArray(src._detectedParams) ? src._detectedParams : [];
                    const paramKeys = detected.map(function (d) { return d.name; });
                    const hasParams = paramKeys.length > 0;
                    const isExpanded = window._axiExpandedParamChips.has(idx);

                    const chip = document.createElement("div");
                    chip.className = "attachmentChip axChipWithParams";

                    let html = `
      <div class="attachmentChipthumb">
        <span class="material-icons" style="font-size:18px;color:var(--axi-blue);">${isProbing ? 'hourglass_top' : 'table_rows'}</span>
      </div>
      <div class="attachmentChipname" title="${dpEscape(src.caption || src.name)}">
        ${dpEscape(src.caption || src.name)}
        ${isProbing ? '<span style="font-size:11px;color:#94a3b8;margin-left:4px;">Checking…</span>' : ''}
      </div>`;

                    // Param config button: hidden while probing or when source is confirmed clean
                    if (isAdmin && !isProbing && !isClean) {
                        html += `
      <button class="axParamConfigBtn${hasParams ? ' has-params' : ''}" type="button"
              title="${hasParams ? paramKeys.length + ' parameter(s) configured — click to edit' : 'Configure SQL parameters'}">
        <span class="material-icons" style="font-size:13px;">settings</span>
        ${hasParams
                                ? `<span class="axParamBadge">${paramKeys.length}</span>`
                                : `<span style="font-size:11px;font-weight:600;">Params</span>`}
      </button>`;
                    }

                    html += `
      <button class="attachmentChipremove" type="button" aria-label="Remove datasource">
        <span class="material-icons" style="font-size:18px;">close</span>
      </button>`;

                    // Param editor: only when admin, not probing, not clean
                    if (isAdmin && !isProbing && !isClean) {
                        let editorRows = '';
                        detected.forEach(function (det) {
                            const key = det.name;
                            editorRows += `
        <div class="axParamRow" data-key="${dpEscape(key)}" data-detected="true">
          <span class="axParamNameLabel" title="${dpEscape(key)}">${dpEscape(key)}</span>
          <span class="axParamTypeBadge">${dpEscape(det.type)}</span>
          <span class="axParamSep">=</span>
          <input type="text" class="axParamInput axParamVal" value="${dpEscape(params[key] || '')}" placeholder="Enter value…" spellcheck="false">
        </div>`;
                        });

                        html += `
      <div class="axParamEditor"${isExpanded ? '' : ' hidden'}>
        <div class="axParamEditorLabel">SQL Parameters for ${dpEscape(src.caption || src.name)}</div>
        <div class="axParamRows">
          ${hasParams ? editorRows : '<p class="axParamEmpty">No parameters required.</p>'}
        </div>
      </div>`;
                    }

                    chip.innerHTML = html;

                    // ── Remove chip ─────────────────────────────────────────────
                    chip.querySelector(".attachmentChipremove").addEventListener("click", function () {
                        state.sources.splice(idx, 1);
                        const next = new Set();
                        (window._axiExpandedParamChips || new Set()).forEach(function (i) {
                            if (i < idx) next.add(i);
                            else if (i > idx) next.add(i - 1);
                        });
                        window._axiExpandedParamChips = next;
                        renderDataPinSourceChips();
                        renderDatasourceCards(dataBinDatasourcePageSearch?.value || "");
                        updateDatasourceSelectionCount?.();
                    });

                    if (!isAdmin || isProbing || isClean) {
                        dataPinSourceChips.appendChild(chip);
                        return;
                    }

                    // ── Toggle param editor ─────────────────────────────────────
                    const cfgBtn = chip.querySelector(".axParamConfigBtn");
                    if (cfgBtn) {
                        cfgBtn.addEventListener("click", function (e) {
                            e.stopPropagation();
                            if (window._axiExpandedParamChips.has(idx)) window._axiExpandedParamChips.delete(idx);
                            else window._axiExpandedParamChips.add(idx);
                            renderDataPinSourceChips();
                        });
                    }

                    const editorEl = chip.querySelector(".axParamEditor");
                    if (!editorEl) { dataPinSourceChips.appendChild(chip); return; }

                    // ── Existing detected param rows (value-only editable) ──────
                    editorEl.querySelectorAll(".axParamRow[data-detected='true']").forEach(function (row) {
                        const valInput = row.querySelector(".axParamVal");
                        const key = row.dataset.key;
                        if (valInput) {
                            valInput.addEventListener("input", function () {
                                if (state.sources[idx] && state.sources[idx].sqlParams)
                                    state.sources[idx].sqlParams[key] = valInput.value;
                            });
                        }
                    });

                    // ── Existing manual param rows (key + value editable) ───────
                    editorEl.querySelectorAll(".axParamRow:not([data-detected])").forEach(function (row) {
                        const keyInput = row.querySelector(".axParamKey");
                        const valInput = row.querySelector(".axParamVal");
                        const removeBtn = row.querySelector(".axParamRemoveBtn");
                        const origKey = row.dataset.key;

                        if (valInput) {
                            valInput.addEventListener("input", function () {
                                if (!state.sources[idx]) return;
                                const k = keyInput ? keyInput.value.trim() || origKey : origKey;
                                state.sources[idx].sqlParams[k] = valInput.value;
                            });
                        }

                        if (keyInput) {
                            keyInput.addEventListener("blur", function () {
                                const newKey = keyInput.value.trim();
                                if (!state.sources[idx]) return;
                                delete state.sources[idx].sqlParams[origKey];
                                if (newKey) state.sources[idx].sqlParams[newKey] = valInput ? valInput.value : '';
                                renderDataPinSourceChips();
                            });
                        }

                        if (removeBtn) {
                            removeBtn.addEventListener("click", function () {
                                if (state.sources[idx] && state.sources[idx].sqlParams)
                                    delete state.sources[idx].sqlParams[origKey];
                                renderDataPinSourceChips();
                            });
                        }
                    });

                    dataPinSourceChips.appendChild(chip);
                });
            }


            function renderDataPinFiles() {
                const state = window.ensureDataPinState();
                if (!dataPinFileList) return;

                dataPinFileList.innerHTML = "";

                if (!state.files.length) {
                    dataPinFileList.innerHTML = `
      <div class="dataBinPinnedEmpty">
        <span class="material-icons">description</span>
        <span>No files added yet.</span>
      </div>
    `;
                    return;
                }

                state.files.forEach((file, idx) => {
                    const chip = document.createElement("div");
                    chip.className = "attachmentChip";
                    chip.innerHTML = `
      <div class="attachmentChipthumb">
        <span class="material-icons" style="font-size:18px;color:var(--axi-orange);">description</span>
      </div>
      <div class="attachmentChipname" title="${dpEscape(file.name)}">
        ${dpEscape(file.name)}
      </div>
      <button class="attachmentChipremove" type="button" aria-label="Remove file">
        <span class="material-icons" style="font-size:18px;">close</span>
      </button>
    `;

                    chip.querySelector("button").addEventListener("click", function () {
                        state.files.splice(idx, 1);
                        renderDataPinFiles();
                    });

                    dataPinFileList.appendChild(chip);
                });
            }
            function addStagedSourcesToDataPin() {
                const dbList = Array.isArray(window.DBLIST) ? window.DBLIST : [];
                const additions = dataPinState.stagedSourceIds
                    .map(id => dbList.find(x => x.name === id))
                    .filter(Boolean)
                    .map(item => ({
                        name: item.name,
                        caption: item.caption || item.name,
                        type: "database"
                    }));

                dataPinState.sources = dedupeBy(
                    [...dataPinState.sources, ...additions],
                    x => x.name
                );

                dataPinState.stagedSourceIds = [];
                if (dataPinOptionSearch) dataPinOptionSearch.value = "";
                renderDataPinSelectedText();
                renderDataPinOptions("");
                renderDataPinSourceChips();
            }

            async function addFilesToDataPin(fileList) {
                const accepted = [".docx", ".pdf", ".xlsx", ".xls", ".txt", ".csv"];
                const nextFiles = Array.from(fileList || []).filter(file => {
                    const lower = String(file.name || "").toLowerCase();
                    return accepted.some(ext => lower.endsWith(ext));
                });

                if (!nextFiles.length) return;

                /* Limit: max 5 files per bin */
                var currentCount = Array.isArray(dataPinState.files) ? dataPinState.files.length : 0;
                var slotsLeft = 5 - currentCount;
                if (slotsLeft <= 0) {
                    const statusEl = document.getElementById('dataPinStatus');
                    if (statusEl) { statusEl.className = 'status status--error'; statusEl.innerHTML = '<span class="material-icons" style="font-size:18px;">error</span> Maximum 5 files per Data Bin. Remove a file before adding more.'; statusEl.style.display = 'flex'; }
                    return;
                }
                var filesToAdd = nextFiles.slice(0, slotsLeft);
                const savedFiles = [];
                const failedFiles = [];

                for (const file of filesToProcess) {
                    if (window.AxiLibrary && typeof AxiLibrary.save === 'function') {
                        try {
                            await AxiLibrary.save(file);
                            savedFiles.push(file);
                        } catch (err) {
                            console.error('[DataBin] Failed to save file:', file.name, err);
                            failedFiles.push(file.name);
                        }
                    } else {
                        savedFiles.push(file);
                    }
                }

                if (savedFiles.length) {
                    dataPinState.files = dedupeBy(
                        [...dataPinState.files, ...savedFiles],
                        f => [f.name, f.size, f.lastModified].join("::")
                    );
                    renderDataPinFiles();
                }

                if (status) {
                    if (failedFiles.length && !savedFiles.length) {
                        status.className = 'status status--error';
                        status.innerHTML = `<span class="material-icons" style="font-size:18px;">error</span>
                            Failed to upload: ${failedFiles.map(n => `<strong>${n}</strong>`).join(', ')}. File may exceed the 5 MB browser limit.`;
                        status.style.display = 'flex';
                    } else if (failedFiles.length) {
                        status.className = 'status status--error';
                        status.innerHTML = `<span class="material-icons" style="font-size:18px;">warning</span>
                            ${savedFiles.length} file(s) added. Could not store: ${failedFiles.map(n => `<strong>${n}</strong>`).join(', ')} (too large).`;
                        status.style.display = 'flex';
                    } else {
                        status.className = 'status status--success';
                        status.innerHTML = `<span class="material-icons" style="font-size:18px;">check_circle</span>
                            ${savedFiles.length === 1 ? '1 file added.' : `${savedFiles.length} files added.`}`;
                        status.style.display = 'flex';
                    }
                }
            }

            async function saveCurrentDataBin() {
                const state = window.ensureDataPinState();
                const status = document.getElementById('dataPinStatus');
                const finalName = String(dataBinNameInput?.value || state.name || "").trim();

                // 1. Validation checks
                if (!state.sources.length) {
                    if (status) {
                        status.className = 'status status--error';
                        status.innerHTML = '<span class="material-icons" style="font-size:18px;">warning</span>Select at least one datasource.';
                        status.style.display = 'flex';
                    }
                    renderDataBinStep(1);
                    return;
                }
                if (!state.files.length) {
                    if (status) {
                        status.className = 'status status--error';
                        status.innerHTML = '<span class="material-icons" style="font-size:18px;">warning</span>Add at least one file.';
                        status.style.display = 'flex';
                    }
                    renderDataBinStep(2);
                    return;
                }
                if (!finalName) {
                    if (status) {
                        status.className = 'status status--error';
                        status.innerHTML = '<span class="material-icons" style="font-size:18px;">warning</span>Enter a name for the Data Bin.';
                        status.style.display = 'flex';
                    }
                    renderDataBinStep(3);
                    dataBinNameInput?.focus();
                    return;
                }

                /* Duplicate name check */
                if (window.DataBinStore && typeof window.DataBinStore.getAll === 'function') {
                    try {
                        const existingBins = await window.DataBinStore.getAll();
                        const currentId = state.id;
                        const dup = (existingBins || []).find(function (b) {
                            return b.name && b.name.trim().toLowerCase() === finalName.trim().toLowerCase()
                                && b.id !== currentId;
                        });
                        if (dup) {
                            if (status) {
                                status.className = 'status status--error';
                                status.innerHTML = '<span class="material-icons" style="font-size:18px;">warning</span>A Data Bin named "' + finalName + '" already exists. Choose a different name.';
                                status.style.display = 'flex';
                            }
                            renderDataBinStep(3);
                            dataBinNameInput?.focus();
                            return;
                        }
                    } catch (_) { /* non-fatal */ }
                }



                const loader = document.getElementById('globalLoaderOverlay');
                var _isNewBinLeg = !state.id;                       // ← ADD
                var _savedRecordLeg = null;                         // ← ADD

                try {
                    // 2. SHOW THE LOADER IMMEDIATELY
                    if (loader) loader.classList.add('is-active');

                    const _oldBinNameLeg = state._originalName || state.name || '';
                    state.name = finalName;
                    if (_oldBinNameLeg && _oldBinNameLeg !== finalName && typeof window._axiSyncBinRename === 'function') {
                        await window._axiSyncBinRename(_oldBinNameLeg, finalName);
                    }
                    state._originalName = null;
                    const now = Date.now();
                    const record = {
                        id: state.id || window.crypto?.randomUUID?.() || `dp-${now}`,
                        recordid: state.recordid || '',
                        userKey: localStorage.getItem('axi_user_id') || localStorage.getItem('axi_api_key') || localStorage.getItem('axi_provider') || 'anonymous',
                        name: finalName,
                        createdAt: state.createdAt || now,
                        updatedAt: now,
                        datasources: state.sources.map(function (s) {
                            return { name: s.name, caption: s.caption || s.name, type: 'database', sqlParams: (s.sqlParams && typeof s.sqlParams === 'object') ? s.sqlParams : {} };
                        }),
                        files: await Promise.all(state.files.map(async function (file) {
                            var b64 = null;
                            try {
                                if (typeof file.arrayBuffer === 'function') {
                                    var ab = await file.arrayBuffer();
                                    var bytes = new Uint8Array(ab);
                                    var str = '', chunk = 8192;
                                    for (var i = 0; i < bytes.length; i += chunk)
                                        str += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                                    b64 = btoa(str);
                                }
                            } catch (e) {
                                console.warn('[DataBin] Could not encode file content for DB:', file.name, e);
                            }
                            if (!b64 && file.data) b64 = file.data;
                            if (window.AxiLibrary && typeof AxiLibrary.save === 'function' && typeof file.arrayBuffer === 'function') {
                                try { await AxiLibrary.save(file); } catch (e) { console.warn('[DataBin] AxiLibrary.save failed:', file.name, e); }
                            }
                            return {
                                name: file.name,
                                type: file.type || 'application/octet-stream',
                                size: file.size || 0,
                                lastModified: file.lastModified || now,
                                data: b64
                            };
                        }))
                    };

                    // Save to shared DB via server-side handler (tstruct a__xd) — NO IndexedDB fallback.
                    if (!window.DataBinStore) throw new Error("DataBinStore is not available");
                    const saved = await window.DataBinStore.save(record);
                    _savedRecordLeg = record;
                    state.id = record.id;
                    state.recordid = (saved && saved.recordid) || record.recordid || state.recordid || '';
                    state.createdAt = record.createdAt;
                    state.name = record.name;

                    if (typeof setActiveDataBin === "function") {
                        setActiveDataBin(record.id, record.name);
                    }

                    await window.loadSavedPins?.();

                    // Datasources fetched fresh on user activation — not during admin save.
                    if (status) {
                        status.className = 'status status--success';
                        status.innerHTML = '<span class="material-icons" style="font-size:18px;">check_circle</span>Data Bin saved! Datasources will load fresh when users activate it.';
                        status.style.display = 'flex';
                    }

                    // Close the modal upon success
                    window.closeDataBinPage();

                } catch (error) {
                    console.error("Failed to save or fetch Data Bin:", error);
                    if (_isNewBinLeg && _savedRecordLeg && window.DataBinStore) {
                        try {
                            await window.DataBinStore.delete(_savedRecordLeg.id);
                            state.id = null;
                            state.recordid = '';
                            await window.loadSavedPins?.();
                        } catch (rollbackErr) {
                            console.warn('[AXI] Rollback failed:', rollbackErr);
                        }
                    }
                    if (status) {
                        status.className = 'status status--error';
                        status.innerHTML = '<span class="material-icons" style="font-size:18px;">error</span>Failed to save Data Bin. Check that all datasource parameters are satisfied.';
                        status.style.display = 'flex';
                    }
                } finally {
                    // 3. ALWAYS HIDE THE LOADER WHEN DONE
                    if (loader) loader.classList.remove('is-active');
                }
            }

            // NOTE: Save click is handled by bindDataBinOverrideClick(saveDataPinBtn, …)
            // further below, which routes through saveCurrentDataBinOptional (the active
            // save flow). Binding the older saveCurrentDataBin here as well caused two
            // listeners with different validation rules — removed to keep a single source
            // of truth.

            // =========================================================================
            // <<<<< CUSTOM SEARCHABLE DROPDOWN LOGIC >>>>>
            // =========================================================================
            /* --- 4. DATA SOURCE HANDLING (DYNAMIC FETCH) --- */


            /**
 * Robust JSON parser for Axpert responses
 * Handles double-encoding, truncated strings, and extra characters
 */

            function parseAxpertResponseSafely(raw) {
                if (raw == null) return null;

                if (typeof raw !== "string") return raw;

                const text = raw.trim();
                if (!text) return null;

                if (text.startsWith("SessionId")) {
                    throw new Error("Axpert returned a SessionId/plain-text response instead of JSON.");
                }

                if (!(text.startsWith("{") || text.startsWith("["))) {
                    throw new Error("Axpert returned a non-JSON response: " + text.slice(0, 120));
                }

                return JSON.parse(text);
            }

            function safeParseData(jsonResponse) {
                try {
                    if (!jsonResponse) return [];

                    var outer = parseAxpertResponseSafely(jsonResponse);
                    if (!outer) return [];

                    var dString = outer.d ?? outer;

                    if (typeof dString !== "string") return dString;

                    dString = dString.trim();

                    if (dString.startsWith("SessionId")) {
                        throw new Error("Axpert returned SessionId text inside d.");
                    }

                    var lastBrace = dString.lastIndexOf("}");
                    var lastBracket = dString.lastIndexOf("]");
                    var lastValid = Math.max(lastBrace, lastBracket);
                    if (lastValid !== -1) dString = dString.substring(0, lastValid + 1);

                    var inner = parseAxpertResponseSafely(dString);

                    if (inner?.result?.data?.[0]?.data) return inner.result.data[0].data;
                    if (inner?.result?.data) return inner.result.data;
                    if (Array.isArray(inner)) return inner;

                    return [];
                } catch (e) {
                    console.error("Data Parse Error:", e, jsonResponse);
                    return [];
                }
            }
            /* --- 4. DATA SOURCE HANDLING (DYNAMIC FETCH) --- */

            /* --- 4. DATA SOURCE HANDLING (DYNAMIC FETCH) --- */

            // Initialize empty DB list (will be populated by API)
            /* --- 4. DATA SOURCE HANDLING (DYNAMIC FETCH) --- */

            function populateCustomDropdown() {
                try {
                    if (!Array.isArray(window.DBLIST)) return;

                    // Set current items for global search/filtering to use
                    currentItems = window.DBLIST;

                    // Instead of manually writing HTML strings here, 
                    // we call filterOptions which contains the correct 
                    // multi-select checkbox HTML logic and click handlers.
                    if (typeof filterOptions === 'function') {
                        // Passing an empty string draws all items with checkboxes
                        filterOptions('');
                    }

                    // Update the display text at the top of the dropdown
                    if (typeof updateDropdownDisplay === 'function') {
                        updateDropdownDisplay();
                    }

                } catch (e) {
                    console.error("populateCustomDropdown error:", e);
                }
            }
            // Initialize empty DB list (will be populated by API)
            let DB_LIST = [];


            function isSessionText(raw) {
                return typeof raw === "string" && /^SessionId\b/i.test(raw.trim());
            }

            // STANDALONE-MODE FIX: see the identical fix + explanation in
            // axi-databin-services.js's copy of this function.
            function ensureAxpertContext() {
                if (typeof parent.GetDataFromAxList !== "function") {
                    throw new Error("This page must be opened from inside Axpert with a valid parent session.");
                }
            }

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
            /**
             * Fetch datasources from Axpert using parent.GetDataFromAxList
             * Uses axi_structmetalist with session-based SQL params.
             */
            function loadDataSources() {
                try {
                    ensureAxpertContext();

                    var pusername = (typeof parent !== "undefined" && parent.mainUserName)
                        ? parent.mainUserName
                        : (typeof mainUserName !== "undefined" ? mainUserName : "");

                    var puserrole = (typeof parent !== "undefined" && parent.AxUserRoles)
                        ? parent.AxUserRoles
                        : (typeof AxUserRoles !== "undefined" ? AxUserRoles : "");

                    var params = {
                        adsNames: ["axi_ai_getadslist"],
                        refreshCache: true,
                        sqlParams: {
                            pusername: pusername || "", // Fallback to empty string to prevent null errors
                            puserrole: puserrole || ""
                        }
                    };

                    parent.GetDataFromAxList(params, function (response) {
                        try {
                            if (isSessionText(response)) {
                                window.DBLIST = [];
                                setDataPinStatus("Axpert session expired. Please login again and reopen this page.", "error");
                                return;
                            }

                            var outer = parseAxpertResponseSafely(response);
                            var dContent = outer && outer.d ? outer.d : outer;
                            var inner = parseAxpertResponseSafely(dContent);

                            // BUG FIX (found during standalone testing): AxList
                            // reports a broken/missing/not-permitted datasource
                            // as HTTP 200 with result.success===false — this
                            // was never checked, so "axi_ai_getadslist doesn't
                            // exist for this project" looked identical to
                            // "this project genuinely has zero datasources."
                            // Per the ARM API Handbook: "Without that check a
                            // broken datasource looks exactly like an empty
                            // one, and you debug the wrong thing for an hour."
                            if (inner?.result?.success === false) {
                                window.DBLIST = [];
                                var msg = inner.result.message || 'axi_ai_getadslist datasource call failed.';
                                console.error('[AXI] loadDataSources: AxList reported failure:', msg, inner);
                                setDataPinStatus('Could not load datasources: ' + msg, 'error');
                                return;
                            }

                            var rows = [];
                            if (inner?.result && Array.isArray(inner.result.data) && inner.result.data.length > 0) {
                                rows = inner.result.data[0].data || [];
                            } else if (inner?.result && Array.isArray(inner.result.row)) {
                                rows = inner.result.row;
                            }

                            window.DBLIST = rows
                                .map(function (item) {
                                    var name = item.sqlname || item.dsname || item.name;
                                    var caption = item.caption || item.sqlname || item.dsname || item.name;
                                    return { name, caption, type: "database" };
                                })
                                .filter(function (item) { return item.name; });

                        } catch (e) {
                            window.DBLIST = [];
                            setDataPinStatus(e.message, "error");
                            console.error("Error parsing axi_structmetalist response:", e, response);
                        }
                    });
                } catch (e) {
                    setDataPinStatus(e.message, "error");
                    console.error(e);
                }
            }

            window.fetchMultipleADSData = function (adsNames) {
                const names = Array.isArray(adsNames) ? adsNames.filter(Boolean) : [];
                if (!names.length) return Promise.resolve([]);

                const statusEl = document.getElementById("selectedValue");
                if (statusEl) statusEl.textContent = `Loading ${names.length} datasources...`;

                return new Promise(function (resolve, reject) {
                    const params = {
                        adsNames: names,
                        refreshCache: true,
                        sqlParams: {}

                    };

                    try {
                        if (typeof parent !== "undefined" && typeof parent.GetDataFromAxList === "function") {
                            parent.GetDataFromAxList(params, function (response) {
                                try {
                                    const outer = parseAxpertResponseSafely(response);
                                    const dContent = outer && outer.d ? outer.d : outer;
                                    const inner = parseAxpertResponseSafely(dContent);

                                    if (inner?.result?.success === false) {
                                        reject(new Error(inner?.result?.message || "Axpert API error"));
                                        return;
                                    }

                                    let blocks = [];
                                    if (Array.isArray(inner?.result?.data)) {
                                        blocks = inner.result.data;
                                    } else if (Array.isArray(inner?.result?.row)) {
                                        blocks = inner.result.row;
                                    }

                                    resolve(blocks);
                                } catch (e) {
                                    reject(e);
                                }
                            });
                        } else {
                            reject(new Error("Axpert API not available."));
                        }
                    } catch (e) {
                        reject(e);
                    }
                });
            };

            window.fetchADSData = function (adsName, sqlParams) {
                if (!adsName) return Promise.resolve([]);

                const statusEl = document.getElementById("selectedValue");
                if (statusEl) statusEl.textContent = `Loading ${adsName}...`;

                window.ISFETCHINGDATA = true;

                // Use caller-supplied sqlParams (admin-configured params stored in the bin).
                // Falls back to {} for non-parameterized sources — no behaviour change there.
                const _sqlParams = (sqlParams && typeof sqlParams === 'object') ? sqlParams : {};

                return new Promise(function (resolve, reject) {
                    const params = {
                        adsNames: [adsName],
                        refreshCache: true,
                        sqlParams: _sqlParams
                    };

                    try {
                        if (typeof parent === "undefined" || typeof parent.GetDataFromAxList !== "function") {
                            window.ISFETCHINGDATA = false;
                            reject(new Error("Axpert API not available."));
                            return;
                        }

                        parent.GetDataFromAxList(params, function (response) {
                            try {
                                let rows = safeParseData(response);

                                if (!Array.isArray(rows)) {
                                    if (typeof response === "string" && response.trim().startsWith("SessionId")) {
                                        throw new Error("Axpert returned a non-JSON SessionId response.");
                                    }

                                    const outer = typeof response === "string" ? JSON.parse(response) : response;
                                    const dContent = outer && outer.d ? outer.d : outer;
                                    const inner = typeof dContent === "string" ? JSON.parse(dContent) : dContent;

                                    if (inner?.result?.success === false) {
                                        throw new Error(inner?.result?.message || "Axpert API error");
                                    }

                                    if (Array.isArray(inner?.result?.data) && inner.result.data.length > 0) {
                                        rows = inner.result.data[0]?.data || [];
                                    } else if (Array.isArray(inner?.result?.row)) {
                                        rows = inner.result.row;
                                    } else {
                                        rows = [];
                                    }
                                }

                                window.CURRENTADSDATA = rows;
                                window.CURRENTADSNAME = adsName;
                                window.pendingDatabaseData = {
                                    name: adsName,
                                    data: rows
                                };

                                if (typeof window.buildVectorIndexForDataset === 'function') {
                                    window.buildVectorIndexForDataset(rows)
                                        .catch(e => console.error('Vector Indexing Failed', e));
                                } else {
                                    console.warn('Vector indexing skipped: script.js not loaded yet');
                                }
                                window.ISFETCHINGDATA = false;

                                if (statusEl) statusEl.textContent = `${adsName} Ready`;
                                resolve(Array.isArray(rows) ? rows : []);
                            } catch (e) {
                                window.ISFETCHINGDATA = false;
                                if (statusEl) statusEl.textContent = "Error loading data";
                                reject(e);
                            }
                        });
                    } catch (e) {
                        window.ISFETCHINGDATA = false;
                        if (statusEl) statusEl.textContent = "Error loading data";
                        reject(e);
                    }
                });
            };

            window.buildPreAnalysisPayload = async function () {
                const promptEl = document.getElementById("prompt");
                const promptText = (promptEl?.value || "").trim();
                const context = window.ACTIVEDATABINCONTEXT || null;
                const dbPayload = window.pendingDatabaseData || null;

                const fileSummaries = await Promise.all(
                    (context?.files || []).map(async function (file) {
                        return {
                            name: file.name,
                            type: file.type || "application/octet-stream",
                            size: file.size || 0
                        };
                    })
                );

                return {
                    systemPrompt: typeof window.getActiveSystemPrompt === "function"
                        ? window.getActiveSystemPrompt()
                        : "",
                    userPrompt: promptText,
                    dataBin: context ? {
                        id: context.id || null,
                        name: context.name || "Untitled Data Bin",
                        datasourceCount: Array.isArray(context.datasources) ? context.datasources.length : 0,
                        fileCount: Array.isArray(context.files) ? context.files.length : 0
                    } : null,
                    datasources: Array.isArray(context?.datasources)
                        ? context.datasources.map(function (ds) {
                            return {
                                name: ds.name,
                                caption: ds.caption || ds.name,
                                rowCount: Array.isArray(ds.rows) ? ds.rows.length : 0,
                                rows: Array.isArray(ds.rows) ? ds.rows : []
                            };
                        })
                        : [],
                    combinedDatabaseRows: Array.isArray(context?.combinedDatabaseRows)
                        ? context.combinedDatabaseRows
                        : (Array.isArray(dbPayload?.data) ? dbPayload.data : []),
                    files: fileSummaries
                };
            };
            const MOCK_DATA_RESPONSES = {
                "axmp_po": safeParseData(typeof RAW_PO_DATA !== 'undefined' ? RAW_PO_DATA : "") // Use safeParseData on RAW_PO_DATA if it exists
            };

            // --- Add this to your DOMContentLoaded initialization block ---
            // document.addEventListener('DOMContentLoaded', () => {
            //    ... existing init code ...
            //    loadDataSources(); // <--- Add this line
            // });

            // =========================================================================
            // <<<<< CUSTOM SYSTEM PROMPT EDITOR >>>>>
            // =========================================================================

            // Default system prompt (your original)
            const DEFAULT_SYSTEM_PROMPT = `You are AXI, an expert Data Analyst and Report Generator.

CAPABILITIES:
1. Analyze attached data deeply and thoroughly.
2. Visualize trends using Highcharts JSON format.
3. Report findings in professional, detailed format.

IMPORTANT RULE: 
- (most important) Don't assume.
- never make up data
- never assume genders
- never assume any information apart from what is provided to you.

⚠️ OUTPUT FORMAT RULE — CRITICAL, NO EXCEPTIONS:
All narrative text (summaries, findings, analysis, anomalies, recommendations) MUST be written as plain markdown prose or bullet points.
NEVER output narrative text as a JSON object like {"summary": "..."} or {"key": "value"}.
JSON format is EXCLUSIVELY for chart code blocks described below. Violating this rule produces broken, unreadable output.

CHART PROTOCOL:

Use diverse chart types to best represent the data. Do NOT rely only on Bar/Line charts.
Charts MUST be output as a fenced JSON code block (not inline JSON) in this format:
\`\`\`json
{
  "charts": [
    { "chart": { "type": "column", "title": "...", "xAxis": {...}, "series": [...] } }
  ]
}
\`\`\`

AVAILABLE CHART TYPES (Select the most insight-rich option):
- **column** / **bar**: For comparing categories or counts.
- **line** / **spline**: For trends over time (smooth curves).
- **area** / **areaspline**: For cumulative trends or volume over time.
- **pie** / **donut**: For part-to-whole composition (limit to 5-7 slices).
- **scatter**: For correlation between two variables (x, y).
- **bubble**: For 3D analysis (x, y, size).
- **heatmap**: For density or cross-tabulation intensity.
- **treemap**: For hierarchical data or showing size proportions.

**CHART GENERATION FOR GROUPED DATA:**
When asked to "group by" a field (like supplier, category, etc.):

1. For column/bar charts: Each unique value in the grouped field should be a SEPARATE SERIES
2. The series "name" MUST be the actual value (e.g., "ABB INDIA PVT LTD", "FOXCON INDIA PVT LTD")
3. Example format:
{
  "charts": [
    {
      "chart": { "type": "column" },
      "title": { "text": "Orders by Supplier" },
      "xAxis": { "categories": ["Product A", "Product B", ...] },
      "series": [
        { "name": "ABB INDIA PVT LTD", "data": [5, 10, 15] },
        { "name": "FOXCON INDIA PVT LTD", "data": [3, 7, 12] },
        { "name": "PADGET ELECTRONICS", "data": [2, 4, 8] }
      ]
    }
  ]
}

4. DO NOT use generic names like "Series 1", "Supplier 1", etc.
5. The legend MUST display the actual supplier/category names

REPORT PROTOCOL (CRITICAL):
When generating analysis or reports, structure them as:

## Executive Summary
Brief overview of key findings (2-3 paragraphs)

## Data Overview
- Total records analyzed
- Date range covered
- Key metrics summary

## Detailed Analysis
### [Category 1]
Findings, trends, patterns with specific data points

### [Category 2]
Findings, trends, patterns with specific data points

### [Category 3]
Findings, trends, patterns with specific data points

## Key Insights
- Bullet point insights
- Action items
- Recommendations

## Statistical Summary
Tables showing aggregated data

## Conclusion
Summary and next steps

**FORMATTING RULES:**
- Analyze all the rows uploaded
- Use Markdown headers (##, ###)
- Use **bold** for emphasis
- Use tables for structured data
- Use bullet points for lists
- Make reports detailed (aim for 1000+ words for comprehensive analysis)
- Include specific numbers, percentages, and data points`;

            // LocalStorage key for custom prompt
            const CUSTOM_PROMPT_KEY = 'axi_custom_system_prompt';

            // EXPOSE GLOBALLY - Add to window object
            window.DEFAULT_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT;
            window.CUSTOM_PROMPT_KEY = CUSTOM_PROMPT_KEY;

            // Get the current active system prompt - MAKE IT GLOBAL
            window.getActiveSystemPrompt = function () {
                const customPrompt = localStorage.getItem(CUSTOM_PROMPT_KEY);
                return customPrompt || DEFAULT_SYSTEM_PROMPT;
            };

            // Save custom prompt - MAKE IT GLOBAL
            window.saveCustomPrompt = function (prompt) {
                if (prompt === DEFAULT_SYSTEM_PROMPT) {
                    localStorage.removeItem(CUSTOM_PROMPT_KEY);
                    return false;
                } else {
                    localStorage.setItem(CUSTOM_PROMPT_KEY, prompt);
                    return true;
                }
            };

            // ── Data Bin MODAL LOGIC ──────────────────────────────────────


            // Open the Modal
            if (openDataPinBtn && dataPinModal) {
                openDataPinBtn.addEventListener('click', function () {
                    initDataBinDatasourceDropdown();
                    initDataBinFileDropdown();

                    loadDataSources(); // <-- this was missing

                    renderDataBinFileOptions();
                    if (typeof window.renderDataPinModal === 'function') window.renderDataPinModal();

                    const st = document.getElementById('dataPinStatus');
                    if (st) st.style.display = 'none';

                    window.openDataBinPage("datasources");
                });
            }
            // Close Modal on backdrop click
            if (dataPinModal) {
                dataPinModal.addEventListener("mousedown", function (e) {
                    if (e.target === e.currentTarget) dataPinModal.close();
                });
            }

            // Data Bin save is remote-only (shared DB). No IndexedDB persistence.

            // REMOVED (React cutover): initSystemPromptEditor used to wire
            // #openSystemPrompt (a hidden proxy button; axi-ui-polish.js's
            // #axiEditPromptBtn forwarded clicks to it) to open/populate/save/
            // reset the #systemPromptModal dialog imperatively. Now defined by
            // axi-system-prompt-editor-react.js (built from ../axi-react,
            // src/features/systemPromptEditor), which mounts directly onto the
            // dialog and wires #axiEditPromptBtn itself — the proxy button is
            // no longer needed (axi-ui-polish.js's forwarding IIFE was removed
            // too). window.getActiveSystemPrompt/saveCustomPrompt/
            // DEFAULT_SYSTEM_PROMPT (defined just above this comment) are
            // unchanged and still what the React version calls.
            // This function is kept as a no-op stub since it's still called
            // twice below (a pre-existing double-call, itself harmless).
            function initSystemPromptEditor() { }

            // Add animation keyframes if they don't exist
            if (!document.querySelector('#prompt-animation-style')) {
                const style = document.createElement('style');
                style.id = 'prompt-animation-style';
                style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
    `;
                document.head.appendChild(style);
            }

            // Initialize when DOM is ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', initSystemPromptEditor);
            } else {
                initSystemPromptEditor();
            }
            // =========================================================================
            // <<<<< OPENAI DATA FETCHER FOR DATABASES >>>>>
            // =========================================================================

            // =========================================================================
            // <<<<< OPENAI DATA FETCHER FOR DATABASES >>>>>
            // =========================================================================



            // Function to get the actual data for the selected database
            async function getSelectedDatabaseData() {
                const selectedDbName = hiddenInput.value;
                if (!selectedDbName) return null;

                const isDbMode = toggle ? toggle.checked : false;
                if (!isDbMode) return null; // Not in DB mode

                // Look up the data in MOCK_DATA_RESPONSES
                const dbData = MOCK_DATA_RESPONSES[selectedDbName];
                if (!dbData) {
                    console.error(`No data found for database: ${selectedDbName}`);
                    return null;
                }

                return {
                    name: selectedDbName,
                    data: dbData
                };
            }

            // Store the database data to be sent to AI (invisible to user)
            //window.pendingDatabaseData = null; // Directly set on window object// This sets the LOCAL variable, not window.pendingDatabaseData
            const originalAnalyzeHandler = analyzeBtn.onclick;

            // --- 3. ANALYZE BUTTON LOGIC (Fixed for Multi-Select) ---
            analyzeBtn.onclick = async function (e) {
                e.preventDefault();

                const hiddenInput = document.getElementById("axiFileSelect");
                const toggle = document.getElementById("sourceToggle");
                const promptInput = document.getElementById("prompt");
                const composerForm = document.getElementById("composer");

                const selectedName = hiddenInput ? hiddenInput.value : "";
                const isDbMode = toggle ? toggle.checked : false;

                const statusEl = document.getElementById("selectedValue");
                const setStatus = (t) => { if (statusEl && t) statusEl.textContent = t; };

                // Get all selected items
                const selectedNames = isDbMode
                    ? (typeof selectedDataSources !== 'undefined' && selectedDataSources.length > 0 ? selectedDataSources.slice() : (selectedName ? selectedName.split(',') : []))
                    : (selectedName ? [selectedName] : []);

                if (!selectedNames.length || (selectedNames.length === 1 && !selectedNames[0])) {
                    setStatus(isDbMode ? "Select at least one database first." : "Select a file first.");
                    return;
                }

                if (isDbMode) {
                    try {
                        setStatus(`Loading ${selectedNames.length} datasource(s)...`);

                        const results = [];
                        for (const name of selectedNames) {
                            if (!name) continue;
                            setStatus(`Loading ${name}...`);

                            // Await the fetch for each individual datasource
                            const rows = await window.fetchADSData(name);
                            if (Array.isArray(rows) && rows.length) {
                                results.push({ name: name, data: rows });
                            }
                        }

                        if (!results.length) {
                            setStatus("No data returned for selected datasources.");
                            return;
                        }

                        // Combine all arrays into one, tagging them with their source name
                        const combinedRows = results.flatMap(src =>
                            src.data.map(row => ({
                                __source: src.name,
                                ...row
                            }))
                        );

                        // Save this combined payload for the AI
                        window.pendingDatabaseData = {
                            name: selectedNames.join(', '),
                            data: combinedRows
                        };

                        setStatus(`${selectedNames.length} datasources ready.`);

                        if (promptInput) {
                            promptInput.value = "Analyze these databases: " + selectedNames.join(', ');
                        }

                        if (typeof handleSend === "function") {
                            await handleSend();
                        } else if (composerForm) {
                            composerForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
                        }
                    } catch (err) {
                        console.error("Analyze DB error:", err);
                        setStatus("Error analyzing datasources.");
                    }
                    return;
                }

                // 3. FILE MODE LOGIC 
                // 3. FILE MODE LOGIC
                else {
                    if (window.AxiLibrary) {
                        const fileObj = await AxiLibrary.getFileObj(selectedName);

                        if (!fileObj) {
                            console.error("File object not found for", selectedName);
                            alert("Could not load file data. Please re-upload or re-select.");
                            return;
                        }

                        if (!window.AXI || typeof window.AXI.attachFileToChat !== "function") {
                            console.error("AXI.attachFileToChat is not available.");
                            alert("File attach handler is not available.");
                            return;
                        }

                        window.AXI.attachFileToChat(fileObj);

                        if (promptInput) {
                            promptInput.value = `Analyze this file: ${selectedName}`;
                        }

                        if (typeof handleSend === "function") {
                            await handleSend();
                        } else if (composerForm) {
                            composerForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
                        }
                        return; // prevent falling through to the outer step-4 call
                    }
                }


                // 4. TRIGGER SUBMISSION
                // This calls your main chat function (handleSend) which sends data to OpenAI
                if (typeof handleSend === 'function') {
                    await handleSend();
                } else {
                    // Fallback: Dispatch submit event to the composer form
                    if (composerForm) {
                        composerForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                    }
                }
            };


            // Use this dynamic list instead of static MOCK_DBS

            /* --- 3. MODAL CONTROLS --- */
            // Open buttons
            if (openUploadBtn) openUploadBtn.addEventListener("click", () => uploadModal.showModal());

            // Close buttons (using data-close attribute)
            document.querySelectorAll("[data-close]").forEach(btn => {
                btn.addEventListener("click", () => {
                    const id = btn.getAttribute("data-close");
                    const dlg = document.getElementById(id);
                    if (dlg && dlg.open) dlg.close();
                });
            });

            // Close on backdrop click
            const axiProviderKeyModal = document.getElementById('axiProviderKeyModal');
            [connectModal, uploadModal, dataPinModal, axiProviderKeyModal].filter(Boolean).forEach(function (dlg) {
                dlg.addEventListener("mousedown", (e) => {
                    if (e.target === e.currentTarget) dlg.close();
                });
            });

            /* --- 4. CONNECT LOGIC --- */
            connectBtn.onclick = async () => {
                const provider = providerSelect.value;
                const key = keyInput.value.trim();

                if (!key) {
                    showStatus('Please enter an API Key', 'error');
                    return;
                }

                setConnectLoading(true);

                try {
                    await validateKey(provider, key);

                    // Save to DB (persists key per user + provider) and load into memory
                    if (typeof window.saveAxiKeyToTable === 'function') {
                        window.saveAxiKeyToTable(key, '0', provider);
                    } else {
                        // Fallback: localStorage only
                        localStorage.setItem('axi_provider', provider);
                        localStorage.setItem('axi_api_key', key);
                    }

                    // Update the provider button in the switcher
                    if (typeof window.axiSwitchProviderUpdateBtn === 'function') {
                        window.axiSwitchProviderUpdateBtn(provider);
                    }
                    _updateModelBadge();
                    showStatus('Connected!', 'success');

                    setTimeout(() => {
                        connectModal.close();
                        connectStatus.style.display = 'none';
                        setConnectLoading(false);

                        if (typeof refreshDataPinSelections === 'function') refreshDataPinSelections();
                        if (typeof renderPinnedDataBin === 'function') renderPinnedDataBin();
                        window.openDataBinPage("datasources");
                    }, 500);

                } catch (e) {
                    showStatus(e.message || 'Connection failed', 'error');
                    setConnectLoading(false);
                }
            };


            async function validateKey(provider, key) {
                if (!key || key.length < 20) throw new Error('API key is too short');
                if (/\s/.test(key)) throw new Error('API key must not contain spaces');
                if (provider === 'openai') {
                    if (!key.startsWith('sk-')) throw new Error('Invalid OpenAI key format — expected prefix: sk-');
                    const res = await fetch('https://api.openai.com/v1/models', {
                        headers: { Authorization: `Bearer ${key}` }
                    });
                    if (!res.ok) throw new Error('Invalid OpenAI key — the key was rejected by OpenAI');
                } else if (provider === 'gemini') {
                    if (!key.startsWith('AIza')) throw new Error('Invalid Gemini key format — expected prefix: AIza');
                    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
                    if (!res.ok) throw new Error('Invalid Gemini key — the key was rejected by Google');
                } else if (provider === 'anthropic') {
                    // Anthropic API does not support CORS — live validation not possible from browser.
                    // Apply strict format check: modern keys follow sk-ant-api03-{48+ chars}
                    if (!key.startsWith('sk-ant-')) throw new Error('Invalid Anthropic key format — expected prefix: sk-ant-');
                    if (key.length < 40) throw new Error('Invalid Anthropic key — key is too short');
                } else if (provider === 'openrouter') {
                    if (!key.startsWith('sk-or-')) throw new Error('Invalid OpenRouter key format — expected prefix: sk-or-');
                    const res = await fetch('https://openrouter.ai/api/v1/models', {
                        headers: {
                            'Authorization': `Bearer ${key}`,
                            'HTTP-Referer': window.location.href
                        }
                    });
                    if (!res.ok) throw new Error('Invalid OpenRouter key — the key was rejected by OpenRouter');
                } else {
                    throw new Error('Unknown provider: ' + provider);
                }
            }

            /* ── Empty state wiring ─────────────────────────────────────────── */
            (function wireEmptyState() {
                const es = document.getElementById('axiEmptyState');
                const createBtn = document.getElementById('axiEsCreateBin');
                const connectBtn = document.getElementById('axiEsConnectAI');
                const setupModal = document.getElementById('axiKeySetupModal');
                if (!es) return;

                // Hidden by default in HTML — loadSavedPins shows it via axiSetEmptyState(true)
                // only when bins are confirmed to be zero.  This avoids a flash before the loader.

                // Inline "Create" button that lives in the DATA BIN controls column.
                // This replaces the full-page overlay card when there are no bins.
                const inlineCreateBtn = document.getElementById('axiCtrlCreateBin');
                inlineCreateBtn?.addEventListener('click', function () {
                    if (typeof window.openDataBinPage === 'function') window.openDataBinPage(1);
                });

                function axiSetEmptyState(show) {
                    // Never show the full-page overlay card — use the compact inline button instead.
                    es.style.display = 'none';

                    // Show/hide the inline "+ Create" button in the DATA BIN column.
                    if (inlineCreateBtn) inlineCreateBtn.style.display = show ? 'inline-flex' : 'none';

                    // Keep the "Connect AI" ghost button logic intact for backward compat
                    // (it is hidden by default and only shown from the overlay path which
                    //  we are suppressing, so this is a no-op in practice).
                    if (show && connectBtn) {
                        const noKey = !(typeof hasRuntimeKey === 'function' ? hasRuntimeKey() : window._AXI_RUNTIME_KEY);
                        connectBtn.style.display = noKey ? 'inline-flex' : 'none';
                    }
                }

                createBtn?.addEventListener('click', function () {
                    if (typeof window.openDataBinPage === 'function') window.openDataBinPage(1);
                });

                connectBtn?.addEventListener('click', function () {
                    if (setupModal) setupModal.showModal();
                });

                // loadSavedPins calls this after it knows the bin count
                window.axiSetEmptyState = axiSetEmptyState;
                window.axiRefreshEmptyState = function () { }; // kept for compatibility
            })();

            /* ── Provider Key Modal wiring ──────────────────────────────────── */
            (function wireProviderKeyModal() {
                const modal = document.getElementById('axiProviderKeyModal');
                if (!modal) return;

                const logoEl = document.getElementById('apkLogo');
                const titleEl = document.getElementById('apkTitle');
                const subEl = document.getElementById('apkSub');
                const keyInput = document.getElementById('apkKeyInput');
                const eyeBtn = document.getElementById('apkEyeBtn');
                const eyeShow = document.getElementById('apkEyeShow');
                const eyeHide = document.getElementById('apkEyeHide');
                const getLink = document.getElementById('apkGetKeyLink');
                const btn = document.getElementById('apkConnectBtn');
                const btnLabel = document.getElementById('apkConnectBtnLabel');
                const statusEl = document.getElementById('apkStatus');
                const closeBtn = document.getElementById('apkClose');

                // SVG logos matching the provider card icons in connectModal
                const PROVIDER_META = {
                    openai: {
                        name: 'OpenAI', sub: 'GPT-4o · GPT-4o mini',
                        link: 'https://platform.openai.com/api-keys',
                        logoClass: 'axcn__logo--openai',
                        svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"></path></svg>'
                    },
                    anthropic: {
                        name: 'Anthropic', sub: 'Claude 3.5 Sonnet and family',
                        link: 'https://console.anthropic.com/settings/keys',
                        logoClass: 'axcn__logo--anthropic',
                        svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13.827 3.52h3.603L24 20h-3.603l-6.57-16.48zm-3.654 0H6.57L0 20h3.603l1.352-3.384h6.537l-1.352-3.4H6.87l2.352-5.897L10.173 3.52z"></path></svg>'
                    },
                    gemini: {
                        name: 'Google Gemini', sub: 'Gemini 2.5 Flash and family',
                        link: 'https://aistudio.google.com/app/apikey',
                        logoClass: 'axcn__logo--gemini',
                        svg: '<svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 24A12 12 0 0 1 12 0a12 12 0 0 1 0 24zm0-9.173-3.84 3.84a8.464 8.464 0 0 0 3.84.906 8.464 8.464 0 0 0 3.84-.906zm-5.013-1.174-.001.001A8.484 8.484 0 0 0 8.332 18.84L12 15.172l3.668 3.669a8.484 8.484 0 0 0 1.346-1.188L12 14.827l-5.013 3.826zm-.653-1.005L12 10.828l5.666 3.02A8.52 8.52 0 0 0 20.485 12 8.485 8.485 0 0 0 12 3.515 8.485 8.485 0 0 0 3.515 12a8.52 8.52 0 0 0 2.819 3.648z" fill="#4285F4"></path></svg>'
                    },
                    openrouter: {
                        name: 'OpenRouter', sub: 'Route to 200+ models',
                        link: 'https://openrouter.ai/keys',
                        logoClass: 'axcn__logo--openrouter',
                        svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>'
                    }
                };

                let _activeProvider = 'openai';

                // Eye toggle
                eyeBtn && eyeBtn.addEventListener('click', function () {
                    const isPass = keyInput.type === 'password';
                    keyInput.type = isPass ? 'text' : 'password';
                    if (eyeShow) eyeShow.style.display = isPass ? '' : 'none';
                    if (eyeHide) eyeHide.style.display = isPass ? 'none' : '';
                });

                // Close + backdrop
                closeBtn && closeBtn.addEventListener('click', () => modal.close());
                modal.addEventListener('mousedown', e => { if (e.target === modal) modal.close(); });

                function setApkStatus(msg, type) {
                    statusEl.className = 'axModal__status status--' + type;
                    statusEl.innerHTML = (type === 'success'
                        ? '<span class="material-icons" style="font-size:16px;">check_circle</span>'
                        : '<span class="material-icons" style="font-size:16px;">warning</span>') +
                        ' <span>' + escapeHtml(msg) + '</span>';
                    statusEl.style.display = 'flex';
                }

                // Connect button
                btn && btn.addEventListener('click', async function () {
                    const key = (keyInput?.value || '').trim();
                    if (!key) { setApkStatus('Please enter your API key.', 'error'); return; }

                    btn.disabled = true;
                    if (btnLabel) btnLabel.textContent = 'Verifying…';
                    statusEl.style.display = 'none';

                    try {
                        window.showLoader('Verifying key…');
                        await validateKey(_activeProvider, key);
                        window.hideLoader();

                        if (typeof window.saveAxiKeyToTable === 'function')
                            window.saveAxiKeyToTable(key, '0', _activeProvider);

                        if (typeof window.axiSwitchProviderUpdateBtn === 'function')
                            window.axiSwitchProviderUpdateBtn(_activeProvider);

                        if (typeof _updateModelBadge === 'function') _updateModelBadge();
                        setApkStatus('Connected! Switching provider…', 'success');

                        setTimeout(() => {
                            modal.close();
                            btn.disabled = false;
                            if (btnLabel) btnLabel.textContent = 'Verify & Connect';
                            statusEl.style.display = 'none';
                            const meta = PROVIDER_META[_activeProvider];
                            if (typeof toast === 'function') toast(`Connected to ${meta?.name || _activeProvider}`, 'success', 2500);
                        }, 700);
                    } catch (err) {
                        window.hideLoader();
                        btn.disabled = false;
                        if (btnLabel) btnLabel.textContent = 'Verify & Connect';
                        setApkStatus(err.message || 'Connection failed.', 'error');
                    }
                });

                // Public opener — called by switchToProvider in script.js
                window.axiOpenProviderKeyModal = function (providerId) {
                    const meta = PROVIDER_META[providerId] || PROVIDER_META.openai;
                    _activeProvider = providerId;

                    // Swap logo
                    if (logoEl) {
                        logoEl.className = 'apk__logo ' + meta.logoClass;
                        logoEl.innerHTML = meta.svg;
                    }
                    if (titleEl) titleEl.textContent = 'Connect ' + meta.name;
                    if (subEl) subEl.textContent = meta.sub;
                    if (getLink) getLink.href = meta.link;

                    // Reset state
                    if (keyInput) { keyInput.value = ''; keyInput.type = 'password'; }
                    if (eyeShow) eyeShow.style.display = '';
                    if (eyeHide) eyeHide.style.display = 'none';
                    if (btn) { btn.disabled = false; if (btnLabel) btnLabel.textContent = 'Verify & Connect'; }
                    if (statusEl) statusEl.style.display = 'none';

                    modal.showModal();
                };
            })();

            function showStatus(msg, type) {
                const icon = type === 'error'
                    ? '<span class="material-icons" style="font-size:18px;">warning</span>'
                    : '<span class="material-icons" style="font-size:18px;">check_circle</span>';

                connectStatus.innerHTML = `${icon} <span>${escapeHtml(msg)}</span>`;
                connectStatus.className = `status status--${type}`;
                connectStatus.style.display = 'flex';
            }

            function setConnectLoading(loading) {
                connectBtn.disabled = loading;
                connectBtn.innerHTML = loading
                    ? '<span class="material-icons" style="animation: spin 1s linear infinite;">sync</span> Verifying...'
                    : '<span>Verify & Connect</span><span class="material-icons" style="font-weight:bold;">arrow_forward</span>';
            }
            /* --- 5. UPLOAD LOGIC --- */
            const setDrag = (on) => dropzone.classList.toggle('isDrag', !!on);

            ['dragenter', 'dragover'].forEach(evt => {
                dropzone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); setDrag(true); });
            });
            ['dragleave', 'dragend', 'drop'].forEach(evt => {
                dropzone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); setDrag(false); });
            });

            dropzone.addEventListener('click', () => picker.click());

            picker.addEventListener('change', () => {
                if (picker.files.length) handleFiles(picker.files);
                picker.value = '';
            });

            dropzone.addEventListener('drop', (e) => {
                const dt = e.dataTransfer;
                if (dt && dt.files.length) handleFiles(dt.files);
            });


            // ✅ ADD THIS BLOCK immediately after — expands the drop target to the whole panel/modal
            (function () {
                const _parents = [
                    document.getElementById('dataBinPanelFiles'),   // DataBin creation flow
                    document.getElementById('uploadModal')           // quick upload modal
                ].filter(Boolean);

                _parents.forEach(function (container) {
                    container.addEventListener('dragenter', function (e) {
                        if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
                        e.preventDefault();
                        setDrag(true);
                    });

                    container.addEventListener('dragover', function (e) {
                        if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                    });

                    container.addEventListener('dragleave', function (e) {
                        // Only clear highlight when the cursor truly leaves the container,
                        // not when it moves between child elements
                        if (!container.contains(e.relatedTarget)) setDrag(false);
                    });

                    container.addEventListener('drop', function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        setDrag(false);
                        const dt = e.dataTransfer;
                        if (dt && dt.files.length) handleFiles(dt.files);
                    });
                });
            })();

            async function handleFiles(fileList) {
                const files = Array.from(fileList || []);
                if (!files.length) return;

                const accepted = [".csv", ".xlsx", ".xls", ".txt", ".pdf", ".docx", ".json"];
                const validFiles = files.filter(file => {
                    const lower = String(file.name || "").toLowerCase();
                    return accepted.some(ext => lower.endsWith(ext));
                });

                if (!validFiles.length) {
                    if (dataPinStatus) {
                        dataPinStatus.className = "status status--error";
                        dataPinStatus.innerHTML = `
        <span class="material-icons" style="font-size:18px;">warning</span>
        No supported files were selected.
      `;
                        dataPinStatus.style.display = "flex";
                    }
                    return;
                }

                // ✅ FIX: enforce 5-file limit
                var _currentCount = (window.dataPinState && window.dataPinState.files || []).length;
                var _slotsLeft = 5 - _currentCount;
                if (_slotsLeft <= 0) {
                    if (dataPinStatus) {
                        dataPinStatus.className = 'status status--error';
                        dataPinStatus.innerHTML = '<span class="material-icons" style="font-size:18px;">error</span> Maximum 5 files per Data Bin. Remove a file before adding more.';
                        dataPinStatus.style.display = 'flex';
                    }
                    return;
                }
                var filesToProcess = validFiles.slice(0, _slotsLeft);
                var _skipped = validFiles.length - filesToProcess.length;

                if (!window.dataPinState) {
                    window.dataPinState = {
                        sources: [],
                        files: [],
                        name: (dataBinNameInput?.value || "My Data Bin").trim()
                    };
                }

                const savedFiles = [];
                const failedFiles = [];

                for (const file of filesToProcess) {
                    if (window.AxiLibrary && typeof AxiLibrary.save === "function") {
                        try {
                            const ok = await AxiLibrary.save(file);
                            if (ok) {
                                savedFiles.push(file);
                            } else {
                                failedFiles.push(file.name);
                            }
                        } catch (saveErr) {
                            console.error("AxiLibrary.save failed for", file.name, saveErr);
                            failedFiles.push(file.name);
                        }
                    } else {
                        // No library — accept file in-memory only
                        savedFiles.push(file);
                    }
                }

                if (savedFiles.length) {
                    window.dataPinState.files = dedupeBy(
                        [...(window.dataPinState.files || []), ...savedFiles],
                        f => [f.name, f.size, f.lastModified].join("::")
                    );
                    // NOT renderDataPinFiles() — that does dataPinFileList.innerHTML = "...",
                    // a raw content replacement. #dataPinFileList is React-owned once the
                    // Data Bin wizard (axi-databin-wizard.js) has been opened; mutating it
                    // directly here would fight React's reconciler on the next re-render
                    // (risk of "Failed to execute 'removeChild' on 'Node'"). This is the
                    // shared upload-modal path (dropzone/picker, #uploadModal), which can
                    // run while the wizard is mounted, so route through the same re-render
                    // trigger applyPin uses instead of touching the DOM ourselves.
                    window.renderDataPinModal?.();
                }

                if (dataPinStatus) {
                    if (failedFiles.length && !savedFiles.length) {
                        dataPinStatus.className = "status status--error";
                        dataPinStatus.innerHTML = `<span class="material-icons" style="font-size:18px;">error</span>
                        Failed to upload: ${failedFiles.map(n => `<strong>${n}</strong>`).join(", ")}. File may be too large (>5 MB).`;
                    } else if (failedFiles.length) {
                        dataPinStatus.className = "status status--error";
                        dataPinStatus.innerHTML = `<span class="material-icons" style="font-size:18px;">warning</span>
                        ${savedFiles.length} file(s) added. Failed: ${failedFiles.map(n => `<strong>${n}</strong>`).join(", ")} (too large).`;
                    } else {
                        dataPinStatus.className = "status status--success";
                        const _totalFiles = (window.dataPinState.files || []).length;
                        const _addedNow = savedFiles.length;
                        dataPinStatus.innerHTML = `<span class="material-icons" style="font-size:18px;">check_circle</span>
                        ${_addedNow === 1 ? "1 file" : `${_addedNow} files`} added &mdash; ${_totalFiles} file${_totalFiles !== 1 ? "s" : ""} total in this Data Bin.`
                            + (_skipped > 0 ? ` <strong style="color:#d97706">(${_skipped} file${_skipped > 1 ? 's' : ''} skipped — limit reached)</strong>` : '');
                    }
                    dataPinStatus.style.display = "flex";
                }

                if (typeof window.AXI !== "undefined" && typeof window.AXI.refreshFileSelect === "function") {
                    window.AXI.refreshFileSelect(false);
                } else if (typeof refreshFileSelect === "function") {
                    refreshFileSelect(false);
                }

                if (picker) picker.value = "";
            }
            /* --- 6. ASK / ANALYZE LOGIC --- */
            // (Note: The `refreshFileSelect` logic was moved UP into the "TOGGLE LOGIC" block above. 
            // You should remove the DUPLICATE `refreshFileSelect` function that was down here.)


            function escapeHtml(str) {
                return String(str)
                    .replace(/&/g, String.fromCharCode(38) + 'amp;')
                    .replace(/</g, String.fromCharCode(38) + 'lt;')
                    .replace(/>/g, String.fromCharCode(38) + 'gt;')
                    .replace(/"/g, String.fromCharCode(38) + 'quot;')
                    .replace(/'/g, String.fromCharCode(38) + '#39;');
            }


            initSystemPromptEditor();
            loadDataSources();

            /* ===== DATA BIN OPTIONAL DATASOURCE / FILE FLOW OVERRIDE ===== */
            /* Paste this near the END of the existing DOMContentLoaded script,
               just BEFORE the final `});` */

            function dataBinHasAnyInput() {
                const state = window.ensureDataPinState();
                const sourceCount = Array.isArray(state.sources) ? state.sources.length : 0;
                const fileCount = Array.isArray(state.files) ? state.files.length : 0;
                return sourceCount > 0 || fileCount > 0;
            }

            function getFinalDataBinName() {
                const state = window.ensureDataPinState();
                return String(dataBinNameInput?.value || state.name || '').trim();
            }

            function validateOptionalDataBinStep(step) {
                const stepNum = Number(step) || 1;

                // Step 1 and Step 2 are optional now.
                if (stepNum === 1 || stepNum === 2) {
                    setDataPinStatus('', 'success');
                    return true;
                }

                // Step 3 still needs a name if we're validating it directly.
                if (!getFinalDataBinName()) {
                    setDataPinStatus('Enter a name for this Data Bin.', 'error');
                    dataBinNameInput?.focus();
                    return false;
                }

                setDataPinStatus('', 'success');
                return true;
            }

            function goToOptionalDataBinStep(step) {
                const safeStep = Math.max(1, Math.min(3, Number(step) || 1));
                renderDataBinStep(safeStep);
            }

            async function saveCurrentDataBinOptional() {
                // Re-entry guard: a fast double-click on Save (or another caller firing
                // while the first save is still awaiting) used to launch two concurrent
                // saves on the same record with empty recordid → Axpert created two rows
                // instead of one create + one update. Single in-flight save at a time.
                if (saveCurrentDataBinOptional._inFlight) return;
                saveCurrentDataBinOptional._inFlight = true;

                const state = window.ensureDataPinState();
                const finalName = getFinalDataBinName();

                if (!dataBinHasAnyInput()) {
                    setDataPinStatus('Add at least one datasource or one file before saving this Data Bin.', 'error');
                    saveCurrentDataBinOptional._inFlight = false;
                    return;
                }

                /* Validate parameterized datasources have values */
                var missingParams = [];
                (state.sources || []).forEach(function (src) {
                    if (src._probeStatus !== 'parameterized') return;
                    (Array.isArray(src._detectedParams) ? src._detectedParams : []).forEach(function (p) {
                        if (!String((src.sqlParams || {})[p.name] || '').trim())
                            missingParams.push('"' + p.name + '" in ' + (src.caption || src.name));
                    });
                });
                if (missingParams.length > 0) {
                    renderDataBinStep(1);
                    setDataPinStatus('Fill in all required parameters before saving: ' + missingParams.join(', '), 'error');
                    saveCurrentDataBinOptional._inFlight = false;
                    return;
                }
                if (!finalName) {
                    renderDataBinStep(3);
                    setDataPinStatus('Enter a name for this Data Bin.', 'error');
                    dataBinNameInput?.focus();
                    saveCurrentDataBinOptional._inFlight = false;
                    return;
                }

                /* BUG-17 FIX: block duplicate DataBin names on the frontend */
                if (window.DataBinStore && typeof window.DataBinStore.getAll === 'function') {
                    try {
                        const existingBins = await window.DataBinStore.getAll();
                        const currentId = state.id;
                        const duplicate = (existingBins || []).find(function (b) {
                            return b.name && b.name.trim().toLowerCase() === finalName.trim().toLowerCase()
                                && b.id !== currentId;
                        });
                        if (duplicate) {
                            setDataPinStatus('A Data Bin named "' + finalName + '" already exists. Choose a different name.', 'error');
                            renderDataBinStep(3);
                            dataBinNameInput?.focus();
                            saveCurrentDataBinOptional._inFlight = false;
                            return;
                        }
                    } catch (_) { /* non-fatal — proceed */ }
                }

                var _oldBinName = state._originalName || state.name || '';
                var _isNewBin = !state.id;          // ← ADD
                var _savedRecord = null;
                // 1. Get the loader
                const loader = document.getElementById('globalLoaderOverlay');

                try {
                    // 2. FORCE LOADER VISIBLE with correct message
                    /* BUG-9 FIX: use showLoader so the text is always correct */
                    window.showLoader('Saving Data Bin...');

                    const now = Date.now();
                    const record = {
                        id: state.id || window.crypto?.randomUUID?.() || `dp-${now}`,
                        recordid: state.recordid || '',
                        userKey: localStorage.getItem('axi_user_id') || localStorage.getItem('axi_api_key') || localStorage.getItem('axi_provider') || 'anonymous',
                        name: finalName,
                        createdAt: state.createdAt || now,
                        updatedAt: now,
                        datasources: Array.isArray(state.sources) ? state.sources.map(function (src) {
                            return { name: src.name, caption: src.caption || src.name, type: 'database', sqlParams: (src.sqlParams && typeof src.sqlParams === 'object') ? src.sqlParams : {} };
                        }) : [],
                        files: await Promise.all((Array.isArray(state.files) ? state.files : []).map(async function (file) {
                            var b64 = null;
                            try {
                                if (typeof file.arrayBuffer === 'function') {
                                    var ab = await file.arrayBuffer();
                                    var bytes = new Uint8Array(ab);
                                    var str = '', chunk = 8192;
                                    for (var i = 0; i < bytes.length; i += chunk)
                                        str += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                                    b64 = btoa(str);
                                }
                            } catch (e) {
                                console.warn('[DataBin] Could not encode file content for DB:', file.name, e);
                            }
                            if (!b64 && file.data) b64 = file.data;
                            if (window.AxiLibrary && typeof AxiLibrary.save === 'function' && typeof file.arrayBuffer === 'function') {
                                try { await AxiLibrary.save(file); } catch (e) { console.warn('[DataBin] AxiLibrary.save failed:', file.name, e); }
                            }
                            return {
                                name: file.name,
                                type: file.type || 'application/octet-stream',
                                size: file.size || 0,
                                lastModified: file.lastModified || now,
                                data: b64
                            };
                        }))
                    };

                    if (!window.DataBinStore) throw new Error("DataBinStore is not available");
                    const saved = await window.DataBinStore.save(record);
                    _savedRecord = record;
                    state.id = record.id;
                    state.recordid = (saved && saved.recordid) || record.recordid || state.recordid || '';
                    state.createdAt = record.createdAt;
                    state.name = record.name;
                    /* if the name changed, cascade the update to all assignments */
                    if (_oldBinName && _oldBinName !== record.name && typeof window._axiSyncBinRename === 'function') {
                        await window._axiSyncBinRename(_oldBinName, record.name);
                    }
                    state._originalName = null;
                    if (typeof setActiveDataBin === "function") {
                        setActiveDataBin(record.id, record.name);
                    } else if (typeof syncSavedPinsDropdownSelection === "function") {
                        syncSavedPinsDropdownSelection(record.id, record.name);
                    }

                    await window.loadSavedPins?.();

                    // Datasources fetched fresh on user activation — not during admin save.
                    setDataPinStatus('Data Bin saved! It will be ready for analysis when assigned users activate it.', 'success');

                    setTimeout(function () {
                        window.closeDataBinPage?.();
                    }, 180);

                } catch (error) {
                    console.error("Failed to save or fetch Optional Data Bin:", error);
                    if (_isNewBin && _savedRecord && window.DataBinStore) {
                        try {
                            await window.DataBinStore.delete(_savedRecord.id);
                            state.id = null;
                            state.recordid = '';
                            await window.loadSavedPins?.();
                        } catch (rollbackErr) {
                            console.warn('[AXI] Rollback failed:', rollbackErr);
                        }
                    }
                    setDataPinStatus('Failed to save Data Bin. Check that all datasource parameters are satisfied.', 'error');
                } finally {
                    // 3. ALWAYS HIDE LOADER
                    window.hideLoader();
                    saveCurrentDataBinOptional._inFlight = false;
                }
            }
            function bindDataBinOverrideClick(el, handler) {
                if (!el || el.dataset.optionalFlowBound === '1') return;
                el.dataset.optionalFlowBound = '1';

                el.addEventListener(
                    'click',
                    function (e) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        handler(e);
                    },
                    true
                );
            }

            /* Override any existing validator references */
            try {
                validateDataBinStep = validateOptionalDataBinStep;
            } catch (err) { }

            window.validateDataBinStep = validateOptionalDataBinStep;
            window.saveCurrentDataBin = saveCurrentDataBinOptional;

            /* Wizard navigation override */
            bindDataBinOverrideClick(dataBinPrevStepBtn, function () {
                goToOptionalDataBinStep((window.currentDataBinStep || 1) - 1);
            });

            bindDataBinOverrideClick(dataBinNextStepBtn, function () {
                const currentStep = window.currentDataBinStep || 1;
                if (!validateOptionalDataBinStep(currentStep)) return;
                goToOptionalDataBinStep(currentStep + 1);
            });

            bindDataBinOverrideClick(dataBinStepDatasources, function () {
                goToOptionalDataBinStep(1);
            });

            bindDataBinOverrideClick(dataBinStepFiles, function () {
                goToOptionalDataBinStep(2);
            });

            bindDataBinOverrideClick(dataBinStepName, function () {
                goToOptionalDataBinStep(3);
            });

            bindDataBinOverrideClick(saveDataPinBtn, async function () {
                await saveCurrentDataBinOptional();
            });
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', _axiDataBinCoreBoot);
        } else {
            _axiDataBinCoreBoot();
        }

if (typeof window !== "undefined") { window.SandeshDataBinCore = true; }
