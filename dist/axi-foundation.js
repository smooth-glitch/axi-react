/* ============================================================
   AXI FOUNDATION
   Console silencing, axpertURL, AxiLibrary/renderFilePills, marked renderer. Extracted from index.html's inline <script> blocks (originally lines 2-8, 37-42, 58-60, 62-313, 316-397) so Axpert's Js slot -- not the size-limited HTML field -- serves this code.
   ============================================================ */
        /* ── Production: silence all diagnostic logging ── */
        (function () {
            var noop = function () { };
            console.log = console.info = console.warn = console.debug = noop;
        })();

        if (typeof pdfjsLib !== "undefined") {
            pdfjsLib.GlobalWorkerOptions.workerSrc =
                "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/legacy/build/pdf.worker.min.js";
        }

        window.axpertURL = window.location.origin + '/axpert/';  // adjust if your Axpert is in a subfolder


        const AxiLibrary = {
            KEY: 'axi_file_library_v1',   // legacy localStorage key — kept for backward-compat reads
            IDB_NAME: 'axi_file_store_v1',
            IDB_STORE: 'files',
            _idb: null,
            _idbP: null,

            // ── Open IndexedDB (memoised) ────────────────────────────────────
            _openIdb: function () {
                if (this._idb) return Promise.resolve(this._idb);
                if (this._idbP) return this._idbP;
                var self = this;
                this._idbP = new Promise(function (res, rej) {
                    if (!window.indexedDB) return rej(new Error('no-idb'));
                    var r = indexedDB.open(self.IDB_NAME, 1);
                    r.onupgradeneeded = function (e) {
                        e.target.result.createObjectStore(self.IDB_STORE, { keyPath: 'name' });
                    };
                    r.onsuccess = function (e) { self._idb = e.target.result; res(self._idb); };
                    r.onerror = function (e) { rej(e.target.error); };
                });
                return this._idbP;
            },

            // ── Save a File object ───────────────────────────────────────────
            // Primary: IndexedDB — stores raw ArrayBuffer, no base64 overhead, no ~5 MB cap.
            // Fallback: localStorage base64 — legacy path, used when IDB is unavailable.
            save: function (file) {
                var self = this;
                return new Promise(function (resolve, reject) {
                    var reader = new FileReader();
                    reader.onload = function (e) {
                        var ab = e.target.result; // ArrayBuffer
                        self._openIdb().then(function (db) {
                            var tx = db.transaction(self.IDB_STORE, 'readwrite');
                            var req = tx.objectStore(self.IDB_STORE).put({
                                name: file.name,
                                type: file.type || 'application/octet-stream',
                                size: file.size || 0,
                                lastModified: file.lastModified || Date.now(),
                                data: ab
                            });
                            req.onsuccess = function () {
                                console.log('[AxiLibrary] IDB saved: ' + file.name);
                                resolve(true);
                            };
                            req.onerror = function () {
                                console.warn('[AxiLibrary] IDB put failed — falling back to localStorage');
                                self._lsSaveAb(file, ab).then(resolve).catch(reject);
                            };
                        }).catch(function () {
                            // IDB unavailable entirely — use localStorage
                            self._lsSaveAb(file, ab).then(resolve).catch(reject);
                        });
                    };
                    reader.onerror = function () {
                        reject(new Error('Could not read file "' + file.name + '".'));
                    };
                    reader.readAsArrayBuffer(file);
                });
            },

            // localStorage fallback — converts ArrayBuffer → base64 data URL
            _lsSaveAb: function (file, ab) {
                var _this = this;
                return new Promise(function (resolve, reject) {
                    try {
                        var ia = new Uint8Array(ab);
                        var binary = '';
                        for (var i = 0; i < ia.length; i++) binary += String.fromCharCode(ia[i]);
                        var b64 = 'data:' + (file.type || 'application/octet-stream') + ';base64,' + btoa(binary);
                        var lib = JSON.parse(localStorage.getItem(_this.KEY) || '[]');
                        lib = lib.filter(function (f) { return f.name !== file.name; });
                        lib.push({ name: file.name, type: file.type, data: b64, date: Date.now() });
                        localStorage.setItem(_this.KEY, JSON.stringify(lib));
                        console.log('[AxiLibrary] localStorage saved: ' + file.name);
                        resolve(true);
                    } catch (err) {
                        console.error('[AxiLibrary] Storage error saving "' + file.name + '":', err);
                        reject(new Error('File too large to store locally (limit ~5 MB). Try a smaller file.'));
                    }
                });
            },

            // ── Get all file metadata (sync, localStorage-based for UI lists) ─
            getAll: function () {
                return JSON.parse(localStorage.getItem(this.KEY) || '[]');
            },

            // ── Reconstruct a File object ────────────────────────────────────
            // Tries IndexedDB first (new saves), then localStorage (legacy saves).
            getFileObj: function (fileName) {
                var self = this;
                return new Promise(function (resolve) {
                    self._openIdb().then(function (db) {
                        var tx = db.transaction(self.IDB_STORE, 'readonly');
                        var req = tx.objectStore(self.IDB_STORE).get(fileName);
                        req.onsuccess = function (e) {
                            var rec = e.target.result;
                            if (rec && rec.data) {
                                var blob = new Blob([rec.data], { type: rec.type });
                                resolve(new File([blob], rec.name, {
                                    type: rec.type,
                                    lastModified: rec.lastModified || Date.now()
                                }));
                            } else {
                                // Not in IDB — check legacy localStorage
                                resolve(self._lsGetFileObj(fileName));
                            }
                        };
                        req.onerror = function () { resolve(self._lsGetFileObj(fileName)); };
                    }).catch(function () { resolve(self._lsGetFileObj(fileName)); });
                });
            },

            // ── Legacy localStorage retrieval (backward compat) ──────────────
            _lsGetFileObj: function (fileName) {
                try {
                    var lib = JSON.parse(localStorage.getItem(this.KEY) || '[]');
                    var item = lib.find(function (f) { return f.name === fileName; });
                    if (!item) return null;
                    var parts = item.data.split(',');
                    var byteStr = atob(parts[1]);
                    var mime = parts[0].split(':')[1].split(';')[0];
                    var ab = new ArrayBuffer(byteStr.length);
                    var ia = new Uint8Array(ab);
                    for (var i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
                    return new File([new Blob([ab], { type: mime })], item.name, { type: item.type });
                } catch (e) {
                    console.error('[AxiLibrary] localStorage retrieval error:', e);
                    return null;
                }
            }
        };

        // Expose globally
        window.AxiLibrary = AxiLibrary;

        // ── File analysis pill bar ────────────────────────────────────────────────
        // Renders clickable chips above the composer for each file in the active bin.
        // Clicking a chip auto-sends a targeted analysis request for that file.
        window.renderFilePills = function () {
            var el = document.getElementById('axiFilePills');
            if (!el) return;

            var ctx = window.ACTIVEDATABINCONTEXT;
            var files = (ctx && Array.isArray(ctx.files))
                ? ctx.files.filter(function (f) { return f && f.name; })
                : [];

            if (!files.length) {
                el.style.display = 'none';
                el.innerHTML = '';
                return;
            }

            function _extIcon(name) {
                var ext = (name.split('.').pop() || '').toLowerCase();
                var map = { xlsx: '📊', xls: '📊', csv: '📊', pdf: '📄', docx: '📝', doc: '📝', txt: '📃', json: '📋' };
                return map[ext] || '📎';
            }
            function _trunc(str, max) {
                return str.length > max ? str.slice(0, max - 1) + '…' : str;
            }
            function _esc(s) {
                return String(s || '').replace(/&/g, '&amp;').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
            }

            var scrollHtml = '';
            files.forEach(function (f) {
                scrollHtml += '<button class="axi-file-pill" data-filename="' + _esc(f.name) + '" title="Analyze ' + _esc(f.name) + '">' +
                    '<span class="axi-file-pill__icon">' + _extIcon(f.name) + '</span>' +
                    '<span>' + _esc(_trunc(f.name, 22)) + '</span>' +
                    '</button>';
            });

            var allPillHtml = files.length > 1
                ? '<div id="axiFilePills-all">' +
                '<button class="axi-file-pill axi-file-pill--all" data-filename="__all__" title="Analyze all files in this bin">' +
                '<span class="axi-file-pill__icon">⚡</span><span>All files</span>' +
                '</button></div>'
                : '';

            el.innerHTML =
                '<span id="axiFilePills-label">Analyze</span>' +
                '<button class="axi-pills-arrow" id="axiPillsLeft" title="Scroll left">&#8249;</button>' +
                '<div id="axiFilePills-scroll">' + scrollHtml + '</div>' +
                '<button class="axi-pills-arrow" id="axiPillsRight" title="Scroll right">&#8250;</button>' +
                allPillHtml;

            el.style.display = 'flex';

            // ── Arrow scroll logic ────────────────────────────────────────
            var track = document.getElementById('axiFilePills-scroll');
            var btnLeft = document.getElementById('axiPillsLeft');
            var btnRight = document.getElementById('axiPillsRight');
            var STEP = 160; // px per click

            function _updateArrows() {
                if (!track) return;
                var hasOverflow = track.scrollWidth > track.clientWidth + 2;
                var atStart = track.scrollLeft <= 2;
                var atEnd = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;

                btnLeft.classList.toggle('visible', hasOverflow && !atStart);
                btnRight.classList.toggle('visible', hasOverflow && !atEnd);
            }

            btnLeft.addEventListener('click', function () {
                track.scrollBy({ left: -STEP, behavior: 'smooth' });
            });
            btnRight.addEventListener('click', function () {
                track.scrollBy({ left: STEP, behavior: 'smooth' });
            });
            track.addEventListener('scroll', _updateArrows, { passive: true });

            // Also allow mouse-wheel horizontal scroll on the track
            track.addEventListener('wheel', function (e) {
                if (e.deltaY !== 0) {
                    e.preventDefault();
                    track.scrollBy({ left: e.deltaY * 1.5, behavior: 'smooth' });
                }
            }, { passive: false });

            // Check overflow after render (needs a tick for layout)
            requestAnimationFrame(_updateArrows);
            // ─────────────────────────────────────────────────────────────

            el.querySelectorAll('.axi-file-pill').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    if (window.IS_APPLYING_DATABIN) {
                        if (typeof toast === 'function') toast('Data Bin is still loading — please wait.', 'info', 2000);
                        return;
                    }
                    var fname = btn.dataset.filename;
                    var promptEl = document.getElementById('prompt');
                    if (!promptEl) return;
                    var msg = fname === '__all__'
                        ? 'Analyze all files in the data bin'
                        : 'Analyze the file "' + fname + '"';
                    promptEl.value = msg;
                    promptEl.dispatchEvent(new Event('input', { bubbles: true }));
                    window._axiChipFileTarget = fname;
                    var sendBtn = document.getElementById('send');
                    if (sendBtn) sendBtn.click();
                });
            });
        };


        // ============================================================
        // AXPERT — POLISHED MARKDOWN + CODE RENDERER
        // ============================================================
        (function setupMarkedRenderer() {
            if (typeof marked === 'undefined' || typeof hljs === 'undefined') return;

            const renderer = new marked.Renderer();

            // ── Fenced code blocks → codeCard
            renderer.code = function (code, lang) {
                // Normalize lang string (marked v12 may pass an object)
                if (lang && typeof lang === 'object') lang = lang.lang || '';
                const rawLang = (lang || '').split(/[\s.]/)[0].toLowerCase();
                const displayLang = rawLang || 'code';

                let highlighted = '';
                try {
                    if (rawLang && hljs.getLanguage(rawLang)) {
                        highlighted = hljs.highlight(code, { language: rawLang, ignoreIllegals: true }).value;
                    } else {
                        highlighted = hljs.highlightAuto(code).value;
                    }
                } catch (e) {
                    highlighted = escSafe(code);
                }

                const id = 'cc_' + Math.random().toString(36).slice(2, 8);
                return `
            <div class="codeCard" id="${id}">
                <div class="codeCard__header">
                    <div class="codeCard__header-left">
                        <span class="codeCard__dots"><span></span><span></span><span></span></span>
                        <span class="codeCard__lang">${displayLang}</span>
                    </div>
                    <button class="codeCard__copy" onclick="axiCopyCode(this)" title="Copy code">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                        <span>Copy</span>
                    </button>
                </div>
                <pre><code class="hljs language-${rawLang}">${highlighted}</code></pre>
            </div>`;
            };

            // ── Inline code
            renderer.codespan = function (code) {
                if (code && typeof code === 'object') code = code.text || '';
                return `<code class="inline-code">${code}</code>`;
            };

            function escSafe(str) {
                return String(str)
                    .replace(/&/g, String.fromCharCode(38) + 'amp;')
                    .replace(/</g, String.fromCharCode(38) + 'lt;')
                    .replace(/>/g, String.fromCharCode(38) + 'gt;');
            }

            marked.use({
                renderer,
                breaks: true,
                gfm: true
            });

            // window.axiCopyCode used to be defined here too, with an incompatible
            // signature (took a card id string) from script.js's version (takes the
            // button element via onclick="axiCopyCode(this)"). Whichever loaded last
            // silently won. script.js's version is the sole implementation now — it
            // has a document.execCommand fallback and nicer button feedback that this
            // one lacked, and the onclick markup above already calls it correctly.
        })();
