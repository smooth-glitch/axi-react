/* ============================================================
   AXI UI POLISH
   Small, independent UI-polish IIFEs: rail collapse/expand, home-screen char counter + greeting, edit-prompt button wiring, admin-reopen chevron, provider 'Update key' buttons, ctrl-row collapse toggle, message-enter animation + scroll button + applyPin skeleton wrap, and the datasource-card 'fly to rail' animation. Extracted from index.html's inline <script> blocks (originally lines 9367-9451, 9453-9565, 9572-9588, 9589-9613, 9614-9696, 9698-9729, 9731-9870, 9873-9989). Each is independently IIFE-wrapped in the source already, so order among these 8 doesn't matter -- kept in original document order regardless.
   ============================================================ */
        (function () {
            'use strict';

            var RAIL_COLLAPSED = 'axi-rail-collapsed';
            var RAIL_EXPANDED = 'axi-rail-expanded';

            function getRail() { return document.querySelector('.dataBinSelectionRail'); }
            function getPage() { return document.getElementById('dataBinPage'); }

            function updateCount() {
                var el = document.getElementById('axiRailCollapsedCount');
                if (!el) return;
                try {
                    var s = window.dataPinState;
                    var n = ((s && s.sources ? s.sources.length : 0) +
                        (s && s.files ? s.files.length : 0));
                    el.textContent = n;
                } catch (_) { el.textContent = '0'; }
            }

            function setCollapsed() {
                var r = getRail(); if (!r) return;
                r.classList.remove(RAIL_EXPANDED);
                r.classList.add(RAIL_COLLAPSED);
                updateCount();
            }

            function setExpanded() {
                var r = getRail(); if (!r) return;
                r.classList.remove(RAIL_COLLAPSED);
                r.classList.add(RAIL_EXPANDED);
                // Scroll expanded panel to top
                r.scrollTop = 0;
            }

            function setNormal() {
                var r = getRail(); if (!r) return;
                r.classList.remove(RAIL_COLLAPSED, RAIL_EXPANDED);
            }

            function wire() {
                var collapseBtn = document.getElementById('axiRailCollapseBtn');
                var expandBtn = document.getElementById('axiRailExpandBtn');
                var closeBtn = document.getElementById('axiRailCloseExpand');
                var collapsedTab = document.getElementById('axiRailCollapsedTab');

                if (collapseBtn) collapseBtn.addEventListener('click', function (e) { e.stopPropagation(); setCollapsed(); });
                if (expandBtn) expandBtn.addEventListener('click', function (e) { e.stopPropagation(); setExpanded(); });
                if (closeBtn) closeBtn.addEventListener('click', function (e) { e.stopPropagation(); setNormal(); });
                if (collapsedTab) collapsedTab.addEventListener('click', function () { setNormal(); });

                // Close expanded view with Escape key
                document.addEventListener('keydown', function (e) {
                    if (e.key === 'Escape') {
                        var r = getRail();
                        if (r && r.classList.contains(RAIL_EXPANDED)) setNormal();
                    }
                });

                // Reset to normal whenever the DataBin wizard opens/closes
                var page = getPage();
                if (page) {
                    var obs = new MutationObserver(function (mutations) {
                        mutations.forEach(function (m) {
                            if (m.type === 'attributes' && m.attributeName === 'hidden') {
                                if (!page.hidden) { setNormal(); }
                            }
                        });
                    });
                    obs.observe(page, { attributes: true });
                }
            }

            // Wire immediately if DOM is ready, otherwise defer
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', wire);
            } else {
                wire();
            }

            // Expose so renderDataPinSourceChips / renderDataPinFiles can refresh the count
            window._axiRailUpdateCount = updateCount;
        })();

        (function () {
            function init() {
                // REMOVED (React cutover): the char counter (#prompt ->
                // #axiCharCount, with the >1800 amber / >2000 red+disabled
                // thresholds) used to be wired here directly. axi-composer-
                // react.js's Composer now owns #prompt/#axiCharCount/#send
                // entirely and computes the same thresholds reactively from
                // its own controlled textarea state — this querySelector-based
                // wiring would just bind to whichever #prompt node exists at
                // this script's execution time, which could race against the
                // React mount given script.js/this file load via the Axpert
                // platform's Js slot at a position neither can fully control.
                // Welcome toggle
                var hs = document.getElementById('axi-home-screen'), ms = document.getElementById('messages');
                if (hs && ms) {
                    function upH() { hs.classList.toggle('hidden', ms.querySelectorAll('.message--user,.message--assistant').length > 0); }
                    new MutationObserver(upH).observe(ms, { childList: true, subtree: false });
                    upH();
                }
                // Dynamic greeting — one-shot type-in, stays static after
                setTimeout(function () {
                    try {
                        var p = typeof parent !== 'undefined' ? parent : {};
                        var n = (p.mainUserName || (typeof mainUserName !== 'undefined' ? mainUserName : '') || '').trim();
                        var firstName = 'there';
                        if (n) { var f = n.split(' ')[0]; firstName = f.charAt(0).toUpperCase() + f.slice(1).toLowerCase(); }

                        var typed = document.getElementById('axiGreetTyped');
                        var cursor = document.getElementById('axiCursor');
                        var sub1 = document.getElementById('axiSub1');
                        var sub2 = document.getElementById('axiSub2');
                        if (!typed) return;

                        // ── Greeting ──────────────────────────────────────────────
                        var hr = new Date().getHours();
                        var timeGreeting =
                            hr >= 5 && hr < 12 ? 'Good morning' :
                                hr >= 12 && hr < 17 ? 'Good afternoon' :
                                    hr >= 17 && hr < 21 ? 'Good evening' : 'Good evening';

                        var fullText = timeGreeting + ', ' + firstName + '.';

                        // ── Sub-lines (professional, context-aware) ───────────────
                        var sub = (function () {
                            var day = new Date().getDay();
                            if (hr >= 5 && hr < 12) return ['Ready to start the day with fresh insights?', 'Your data is up to date and ready to explore.'];
                            if (hr >= 12 && hr < 14) return ['A good time to review your latest metrics.', 'Ask anything — analysis, summaries, comparisons.'];
                            if (hr >= 14 && hr < 17) return ['Afternoon check-in — what would you like to dig into?', 'Your dashboards and data bins are ready.'];
                            if (day === 5) return ['Wrapping up the week? Let\'s review what matters.', 'Pull a summary, compare trends, or start fresh.'];
                            if (day === 1) return ['New week, new questions to answer.', 'What would you like to focus on today?'];
                            return ['What would you like to explore today?', 'Ask a question, run an analysis, or review your data.'];
                        })();

                        // ── One-shot type-in, then stay static ────────────────────
                        var idx = 0;

                        function escHtml(s) {
                            var d = document.createElement('div');
                            d.textContent = s;
                            return d.innerHTML;
                        }
                        function applyNameHighlight() {
                            if (!firstName || firstName === 'there') return;
                            var ni = fullText.indexOf(firstName);
                            if (ni === -1) return;
                            typed.innerHTML =
                                escHtml(fullText.slice(0, ni)) +
                                '<em class="axi-name-hl">' + escHtml(firstName) + '</em>' +
                                escHtml(fullText.slice(ni + firstName.length));
                        }
                        function done() {
                            applyNameHighlight();
                            // Hide cursor — animation complete, stay static
                            if (cursor) cursor.style.display = 'none';
                            // Fade in sub-lines
                            var divider = document.getElementById('axiHomeDivider');
                            if (divider) setTimeout(function () { divider.classList.add('axi-sub-visible'); }, 80);
                            if (sub1) { sub1.textContent = sub[0]; setTimeout(function () { sub1.classList.add('axi-sub-visible'); }, 220); }
                            if (sub2) { sub2.textContent = sub[1]; setTimeout(function () { sub2.classList.add('axi-sub-visible'); }, 400); }
                        }
                        function type() {
                            if (idx < fullText.length) {
                                typed.textContent = fullText.slice(0, ++idx);
                                setTimeout(type, idx < 6 ? 55 : 42);
                            } else {
                                setTimeout(done, 120);
                            }
                        }

                        type();
                    } catch (e) { }
                }, 700);
                // Sparkle
                var sp = document.getElementById('axiSparkleBtn');
                if (sp) sp.addEventListener('click', function () { var p = document.getElementById('prompt'); if (p) p.focus(); });
            }
            document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
        })();

        // REMOVED (React cutover): this used to forward #axiEditPromptBtn's
        // click to the hidden #openSystemPrompt proxy button, which
        // axi-databin-core.js's (now-retired) initSystemPromptEditor listened
        // on. axi-system-prompt-editor-react.js wires #axiEditPromptBtn
        // directly — no proxy needed.

        (function () {
            function addAdminChevron() {
                var btn = document.getElementById('adm-reopen-btn');
                if (!btn || btn._chevronAdded) return;
                btn._chevronAdded = true;
                var chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                chev.setAttribute('width', '11'); chev.setAttribute('height', '11');
                chev.setAttribute('viewBox', '0 0 24 24'); chev.setAttribute('fill', 'none');
                chev.setAttribute('stroke', '#9CA3AF'); chev.setAttribute('stroke-width', '2.5');
                chev.style.cssText = 'flex-shrink:0;';
                var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                poly.setAttribute('points', '6 9 12 15 18 9');
                chev.appendChild(poly);
                btn.appendChild(chev);
            }
            // BUG FIX (found during standalone testing): this used to call
            // document.body immediately, un-gated — but this script tag
            // loads in <head>, before <body> exists yet, so
            // obs.observe(document.body, ...) threw "parameter 1 is not of
            // type 'Node'" every time. Latent since this file was written;
            // apparently never triggered inside real Axpert (whose own
            // script-injection slot may place scripts differently), but real
            // regardless of standalone vs embedded. Gated the same way most
            // other IIFEs in this file already are.
            function init() {
                // The admin button is injected ~2400ms after load
                setTimeout(addAdminChevron, 3000);
                // Also observe DOM for the button appearing
                var obs = new MutationObserver(function () {
                    if (document.getElementById('adm-reopen-btn')) { addAdminChevron(); }
                });
                obs.observe(document.body, { childList: true, subtree: true });
            }
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', init);
            } else {
                init();
            }
        })();

        (function () {
            'use strict';

            /* Open the key-setup modal pre-selected to a specific provider.
               Works whether called from "Update key" (existing) or any new connect flow. */
            window.axiOpenProviderKeyModal = function (providerId, isUpdate) {
                var modal = document.getElementById('axiKeySetupModal');
                if (!modal) return;

                /* Pre-select the provider radio */
                var radio = modal.querySelector('input[name="axiSetupProvider"][value="' + providerId + '"]');
                if (radio) {
                    radio.checked = true;
                    radio.dispatchEvent(new Event('change', { bubbles: true }));
                }

                /* Update modal title if replacing an existing key */
                var titleEl = document.getElementById('axiKeySetupTitle');
                var subEl = modal.querySelector('.axcn__sub');
                if (isUpdate) {
                    if (titleEl) titleEl.textContent = 'Update API key';
                    if (subEl) subEl.textContent = 'Paste your new key — it replaces the existing one.';
                } else {
                    if (titleEl) titleEl.textContent = 'Connect your AI';
                    if (subEl) subEl.textContent = 'Choose a provider and paste your API key to get started';
                }

                modal.showModal();
            };

            /* Inject "Update key →" into each connected provider row every time
               the panel re-renders (openPanel() blows away innerHTML each time). */
            function patchProviderPanel(panel) {
                panel.querySelectorAll('.axi-provider-item').forEach(function (item) {
                    var pid = (item.dataset.provider || '').toLowerCase();
                    var statusEl = item.querySelector('.axi-pi-status.connected');
                    if (!statusEl) return;                              /* not connected — skip */
                    if (item.querySelector('.axi-update-key-btn')) return; /* already added */

                    var btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'axi-update-key-btn';
                    btn.textContent = 'Update key';
                    btn.title = 'Replace the saved ' + pid + ' API key';

                    btn.addEventListener('click', function (e) {
                        e.stopPropagation();
                        /* Close the provider panel */
                        var panelEl = document.getElementById('axiProviderPanel');
                        var trigBtn = document.getElementById('axiProviderBtn');
                        if (panelEl) panelEl.style.display = 'none';
                        if (trigBtn) trigBtn.classList.remove('axi-provider-active');

                        /* Open the key-setup modal pre-selected and titled correctly */
                        window.axiOpenProviderKeyModal(pid, true);
                    });

                    /* Insert right after the "Connected" badge */
                    statusEl.insertAdjacentElement('afterend', btn);
                });
            }

            function initUpdateKey() {
                var panel = document.getElementById('axiProviderPanel');
                if (!panel) { setTimeout(initUpdateKey, 400); return; }

                /* Observe content changes — openPanel() calls panel.innerHTML = ...
                   which fires a childList mutation on the panel itself. */
                var obs = new MutationObserver(function () {
                    /* Slight defer so the new HTML is fully in the DOM */
                    setTimeout(function () { patchProviderPanel(panel); }, 0);
                });
                obs.observe(panel, { childList: true });
            }

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', initUpdateKey);
            } else {
                initUpdateKey();
            }
        })();

        (function () {
            'use strict';
            var STORAGE_KEY = 'axi_ctrl_row_collapsed';

            function init() {
                var toggle = document.getElementById('axiCtrlToggle');
                var wrap = document.getElementById('axiCtrlRowWrap');
                if (!toggle || !wrap) return;

                /* Restore last state */
                var collapsed = localStorage.getItem(STORAGE_KEY) === '1';
                if (collapsed) {
                    wrap.classList.add('collapsed');
                    toggle.classList.add('collapsed');
                }

                toggle.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var isNowCollapsed = wrap.classList.toggle('collapsed');
                    toggle.classList.toggle('collapsed', isNowCollapsed);
                    try { localStorage.setItem(STORAGE_KEY, isNowCollapsed ? '1' : '0'); } catch (_) { }
                });
            }

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', init);
            } else {
                init();
            }
        })();

        (function () {
            'use strict';

            function init() {
                var messagesEl = document.getElementById('messages');
                var scrollBtn = document.getElementById('scrollDownBtn');
                var badge = document.getElementById('axiScrollBadge');
                var composerCard = document.querySelector('.axiComposerCard');
                var sendBtn = document.getElementById('send');

                // ── 1. MESSAGE BUBBLE FADE+SLIDE IN ──────────────────────
                if (messagesEl) {
                    new MutationObserver(function (mutations) {
                        mutations.forEach(function (m) {
                            m.addedNodes.forEach(function (node) {
                                if (node.nodeType !== 1 || !node.classList) return;
                                if (node.classList.contains('message')) {
                                    node.classList.remove('axi-msg-enter');
                                    requestAnimationFrame(function () {
                                        node.classList.add('axi-msg-enter');
                                    });
                                }
                            });
                        });
                    }).observe(messagesEl, { childList: true });
                }

                // ── 2. SCROLL BUTTON — smooth visibility + unread badge ──
                var unread = 0;

                function atBottom() {
                    if (!messagesEl) return true;
                    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
                }
                function refreshBadge() {
                    if (!badge) return;
                    if (unread > 0) {
                        badge.textContent = unread > 99 ? '99+' : String(unread);
                        badge.style.display = 'flex';
                    } else {
                        badge.style.display = 'none';
                    }
                }
                function refreshScrollBtn() {
                    if (!scrollBtn) return;
                    var hide = atBottom();
                    scrollBtn.classList.toggle('visible', !hide);
                    if (hide) { unread = 0; refreshBadge(); }
                }

                if (messagesEl) {
                    messagesEl.addEventListener('scroll', refreshScrollBtn, { passive: true });

                    // Count incoming messages when not at bottom
                    new MutationObserver(function (mutations) {
                        mutations.forEach(function (m) {
                            m.addedNodes.forEach(function (node) {
                                if (node.nodeType !== 1 || !node.classList) return;
                                if (node.classList.contains('message') && !atBottom()) {
                                    unread++;
                                    refreshBadge();
                                    refreshScrollBtn();
                                }
                            });
                        });
                    }).observe(messagesEl, { childList: true });
                }

                if (scrollBtn) {
                    scrollBtn.addEventListener('click', function () {
                        if (messagesEl) messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
                        unread = 0;
                        refreshBadge();
                        scrollBtn.classList.remove('visible');
                    });
                }

                // ── 3. THINKING BORDER — watches send button disabled state
                if (sendBtn && composerCard) {
                    new MutationObserver(function (mutations) {
                        mutations.forEach(function (m) {
                            if (m.attributeName === 'disabled') {
                                composerCard.classList.toggle('axi-thinking', sendBtn.disabled);
                            }
                        });
                    }).observe(sendBtn, { attributes: true });
                }

                // ── 4. DATA BIN SKELETON — replaces global overlay during applyPin
                var SKEL_ID = 'axi-databin-skeleton';

                function showSkeleton() {
                    if (!messagesEl || document.getElementById(SKEL_ID)) return;
                    var s = document.createElement('div');
                    s.id = SKEL_ID;
                    s.className = 'axi-skeleton-wrap';
                    s.innerHTML =
                        '<div class="axi-skel-row"><div class="axi-skel axi-skel--avatar"></div><div class="axi-skel-lines"><div class="axi-skel axi-skel--line" style="width:58%"></div><div class="axi-skel axi-skel--line" style="width:38%"></div></div></div>' +
                        '<div class="axi-skel-row axi-skel-row--user"><div class="axi-skel-lines axi-skel-lines--right"><div class="axi-skel axi-skel--bubble" style="width:48%"></div></div></div>' +
                        '<div class="axi-skel-row"><div class="axi-skel axi-skel--avatar"></div><div class="axi-skel-lines"><div class="axi-skel axi-skel--line" style="width:72%"></div><div class="axi-skel axi-skel--line" style="width:50%"></div><div class="axi-skel axi-skel--line" style="width:30%"></div></div></div>';
                    messagesEl.appendChild(s);
                    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
                }

                function hideSkeleton() {
                    var s = document.getElementById(SKEL_ID);
                    if (!s) return;
                    s.style.opacity = '0';
                    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 320);
                }

                // Wait until applyPin is fully patched by upstream code, then wrap it
                setTimeout(function () {
                    var _orig = window.applyPin;
                    if (typeof _orig !== 'function' || _orig._skelPatched) return;
                    window.applyPin = async function (id) {
                        // Do NOT call hideLoader here — keep the global overlay blocking
                        // the chat input while the bin loads so the user cannot send before
                        // ACTIVEDATABINCONTEXT / ACTIVEDATABINAIPAYLOAD are fully ready.
                        showSkeleton();
                        try {
                            return await _orig.apply(this, arguments);
                        } finally {
                            hideSkeleton();
                        }
                    };
                    window.applyPin._skelPatched = true;
                    // Forward any flags from original
                    window.applyPin._axiEmpKeyPatched = _orig._axiEmpKeyPatched;
                }, 1200);
            }

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 950); });
            } else {
                setTimeout(init, 950);
            }
        })();

        (function () {
            function animateFlyToRail(card) {
                var rail = document.querySelector('.dataBinSelectionRailGrid, .dataBinSelectionRail');
                if (!rail) return;

                var cR = card.getBoundingClientRect();
                var rR = rail.getBoundingClientRect();

                var dot = document.createElement('div');
                dot.setAttribute('aria-hidden', 'true');
                var icon = card.querySelector('.material-icons');
                dot.innerHTML = '<span class="material-icons" style="font-size:14px;color:#fff;">' +
                    (icon ? icon.textContent : 'table_rows') + '</span>';
                dot.style.cssText = [
                    'position:fixed',
                    'width:34px', 'height:34px',
                    'border-radius:50%',
                    'background:linear-gradient(135deg,#F97316,#EA580C)',
                    'display:grid', 'place-items:center',
                    'z-index:9999', 'pointer-events:none',
                    'box-shadow:0 4px 16px rgba(249,115,22,.5)',
                    'left:' + (cR.left + cR.width / 2 - 17) + 'px',
                    'top:' + (cR.top + cR.height / 2 - 17) + 'px',
                ].join(';');
                document.body.appendChild(dot);

                var sX = cR.left + cR.width / 2 - 17;
                var sY = cR.top + cR.height / 2 - 17;
                var eX = rR.left + rR.width / 2 - 17;
                var eY = rR.top + 56;
                var mX = (sX + eX) / 2;
                var mY = Math.min(sY, eY) - 90;

                var t0 = null;
                var dur = 580;

                function ease(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

                (function frame(ts) {
                    if (!t0) t0 = ts;
                    var p = Math.min((ts - t0) / dur, 1);
                    var e = ease(p);
                    var u = 1 - e;
                    var x = u * u * sX + 2 * u * e * mX + e * e * eX;
                    var y = u * u * sY + 2 * u * e * mY + e * e * eY;
                    dot.style.left = x + 'px';
                    dot.style.top = y + 'px';
                    dot.style.transform = 'scale(' + (1 - p * 0.65) + ')';
                    dot.style.opacity = p > 0.72 ? String(1 - (p - 0.72) / 0.28) : '1';

                    if (p < 1) {
                        requestAnimationFrame(frame);
                    } else {
                        dot.remove();
                        var railEl = document.querySelector('.dataBinSelectionRail');
                        if (railEl) {
                            railEl.classList.remove('axi-rail-received');
                            void railEl.offsetWidth; /* reflow to restart anim */
                            railEl.classList.add('axi-rail-received');
                            setTimeout(function () { railEl.classList.remove('axi-rail-received'); }, 560);
                        }
                    }
                })(0);
                requestAnimationFrame(function (ts) {
                    t0 = ts;
                    requestAnimationFrame(function f(ts2) {
                        if (!t0) t0 = ts2;
                        var p = Math.min((ts2 - t0) / dur, 1);
                        var e = ease(p);
                        var u = 1 - e;
                        var x = u * u * sX + 2 * u * e * mX + e * e * eX;
                        var y = u * u * sY + 2 * u * e * mY + e * e * eY;
                        dot.style.left = x + 'px';
                        dot.style.top = y + 'px';
                        dot.style.transform = 'scale(' + (1 - p * 0.65) + ')';
                        dot.style.opacity = p > 0.72 ? String(1 - (p - 0.72) / 0.28) : '1';
                        if (p < 1) requestAnimationFrame(f);
                        else {
                            dot.remove();
                            var re = document.querySelector('.dataBinSelectionRail');
                            if (re) {
                                re.classList.remove('axi-rail-received');
                                void re.offsetWidth;
                                re.classList.add('axi-rail-received');
                            }
                        }
                    });
                });
            }

            function initFlyAnim() {
                var grid = document.getElementById('dataBinDatasourceGrid');
                if (!grid) return;
                var obs = new MutationObserver(function (mutations) {
                    mutations.forEach(function (m) {
                        if (m.type !== 'attributes' || m.attributeName !== 'class') return;
                        var el = m.target;
                        if (!el.classList.contains('dataBinDatasourceCard')) return;
                        if (el.classList.contains('is-selected') && !el._axiFlown) {
                            el._axiFlown = true;
                            animateFlyToRail(el);
                        } else if (!el.classList.contains('is-selected')) {
                            el._axiFlown = false;
                        }
                    });
                });
                obs.observe(grid, { attributes: true, subtree: true, attributeFilter: ['class'] });
            }

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', function () { setTimeout(initFlyAnim, 1400); });
            } else {
                setTimeout(initFlyAnim, 1400);
            }
        })();
