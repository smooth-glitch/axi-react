/* ========================================================================
   PUSH TO TSTRUCT -- AXIBOT -> Axpert CachedSaveQueue
   ------------------------------------------------------------------------
   Adds a "Push to tstruct" pill under every AI response. Clicking it opens
   a 3-step dialog: pick a tstruct -> map the response onto its (non-grid)
   fields -> review the exact AxPut JSON and push it into Axpert's
   CachedSaveQueue via AxInterface.js's AxPushtoQueueAPI(jsonData, ok, err).

   Entirely self-contained and purely additive -- nothing above this point
   is modified. Reads Axpert datasources through its own private reader
   (never window.fetchADSData, which would leak tstruct metadata into the
   AI's data context -- see that function's own globals at the top of this
   file). See "ARMCachedSaveWorkerService ReadMe Note (1).txt" for the
   queue payload format this implements (AxPut format, section 1).

   v1 scope: non-grid DCs only; grid DCs are detected and excluded with a
   visible count. One push can create many records (one AxPut "data" entry
   per included row). Toggle window.axiPtqMock(true) to exercise the full
   UI with sample tstructs/fields when Axpert isn't reachable (e.g. testing
   this page in a plain browser tab).
   ======================================================================== */
(function () {
    'use strict';
    if (window.__axiPtqLoaded) return;
    window.__axiPtqLoaded = true;

    /* -- 0. CONFIG -- the only block that should need real values ---------
       Swap ADS_TSTRUCT_LIST / ADS_TSTRUCT_FIELDS for the real datasource
       names once available. COLS lists candidate column names per logical
       field so real datasources likely work unmodified; if a datasource
       uses a name not listed here, add it to the relevant array. */
    var PTQ_CFG = {
        ADS_TSTRUCT_LIST: 'axi_ai_gettstructs',
        ADS_TSTRUCT_FIELDS: 'axi_ai_gettstruct_fields',
        FIELD_SQLPARAM: 'ptransid',                 // sqlParam key used to filter fields by tstruct
        PROJECT: '',                                // blank = auto-resolve at runtime
        QUEUE_NAME: 'CachedSaveQueue',
        VALIDATE_ONLY: true,                        // true = Axpert validates but does not save (dry run) -- flip to false once a validate-only push looks right
        ONLY_WHEN_TABULAR: false,                    // true = only show the pill on table/list-shaped responses
        MAX_RECORDS: 200,
        UI_ONLY: true,                               // true = skip every Axpert/AI call and use fixture data below -- for reviewing the UI/UX in isolation before wiring in real datasources
        COLS: {
            tstructName: ['tstructname', 'tstruct', 'name', 'structname', 'transid'],
            tstructCaption: ['caption', 'tstructcaption', 'label', 'description', 'title'],
            fieldName: ['fieldname', 'fldname', 'field', 'colname', 'columnname', 'name'],
            fieldCaption: ['caption', 'fldcap', 'fldcaption', 'label', 'fieldcaption'],
            dc: ['dcname', 'dc', 'container', 'dcno', 'dc_no', 'dcnumber'],
            mandatory: ['mandatory', 'ismandatory', 'required', 'isrequired'],
            datatype: ['datatype', 'fdatatype', 'type', 'fieldtype', 'cdatatype'],
            isGrid: ['isgrid', 'gridflag', 'dctype', 'container_type', 'grid']
        }
    };

    var PTQ_ICON_PILL = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/></svg>';
    var PTQ_ICON_HEAD = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/></svg>';

    var PTQ_MOCK = false;

    /* -- 1. small local helpers (no dependency on any other module) -------- */
    function _ptqEsc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function _ptqToast(msg, type, dur) {
        try { if (typeof window.axiToast === 'function') { window.axiToast(msg, type, dur); return; } } catch (e) { }
        console.log('[PTQ]', type || 'info', msg);
    }
    function _ptqPickAxFn(name) {
        try { if (typeof parent !== 'undefined' && typeof parent[name] === 'function') return parent[name]; } catch (e) { }
        try { if (typeof window[name] === 'function') return window[name]; } catch (e) { }
        return null;
    }
    function _ptqNormKey(s) {
        return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
    }
    function _ptqPick(row, keys) {
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k];
            var upper = k.toUpperCase();
            if (row[upper] !== undefined && row[upper] !== null && row[upper] !== '') return row[upper];
        }
        return '';
    }
    function _ptqTruthy(v) {
        var s = String(v == null ? '' : v).trim().toLowerCase();
        return s === 't' || s === 'true' || s === 'y' || s === 'yes' || s === '1' || s === 'grid';
    }

    /* axi_ai_gettstructs needs pusername/puserrole/presponsiblity (sqlParams,
       confirmed by the colleague who owns the datasource). pusername/puserrole
       follow the same parent.mainUserName / parent.AxUserRoles pattern already
       used elsewhere in this file (see loadDataSources(), index.html). There is
       no existing "responsibility" global anywhere in this app, so it is
       resolved best-effort from a few likely parent globals and otherwise left
       blank -- verify against a real Axpert session once this is live. */
    function _ptqUserContext() {
        var username = '', userrole = '', responsibility = '';
        try { username = (typeof parent !== 'undefined' && parent.mainUserName) || (typeof mainUserName !== 'undefined' ? mainUserName : '') || ''; } catch (e) { }
        try { userrole = (typeof parent !== 'undefined' && parent.AxUserRoles) || (typeof AxUserRoles !== 'undefined' ? AxUserRoles : '') || ''; } catch (e) { }
        var respCandidates = ['AxResponsibility', 'AxResponsiblity', 'mainResponsibility', 'AxUserResponsibility', 'responsibility'];
        for (var i = 0; i < respCandidates.length; i++) {
            try {
                var v = parent && parent[respCandidates[i]];
                if (v) { responsibility = v; break; }
            } catch (e) { }
        }
        return {
            pusername: String(username || ''),
            puserrole: String(userrole || ''),
            presponsiblity: String(responsibility || '')
        };
    }

    /* -- 2. side-effect-free Axpert datasource reader ---------------------
       Deliberately does NOT use window.fetchADSData -- that function sets
       window.CURRENTADSDATA / CURRENTADSNAME / pendingDatabaseData and
       rebuilds the AI's vector index, which would leak tstruct metadata
       into the chat context. Modeled on the private _axiGetAdsRows /
       _axiExtractRowsFromAdsResponse pair (index.html), kept as a local
       copy since those are closure-private and not exposed on window. */
    function _ptqIsSessionText(raw) {
        return typeof raw === 'string' && /^SessionId\b/i.test(raw.trim());
    }
    function _ptqParseAxResponse(raw) {
        if (raw == null) return null;
        if (typeof raw !== 'string') return raw;
        var text = raw.trim();
        if (!text) return null;
        if (_ptqIsSessionText(text)) throw new Error('Axpert session expired. Re-login and reopen this page from Axpert.');
        if (text[0] !== '{' && text[0] !== '[') throw new Error('Axpert returned a non-JSON response: ' + text.slice(0, 120));
        return JSON.parse(text);
    }
    function _ptqExtractRows(response) {
        var outer = _ptqParseAxResponse(response);
        var dContent = (outer && outer.d) ? outer.d : outer;
        var inner = _ptqParseAxResponse(dContent);
        if (inner && inner.result && inner.result.success === false) {
            throw new Error(inner.result.message || 'Axpert datasource error');
        }
        if (inner && inner.result && Array.isArray(inner.result.data) && inner.result.data.length) {
            return inner.result.data[0].data || [];
        }
        if (inner && inner.result && Array.isArray(inner.result.row)) return inner.result.row;
        if (Array.isArray(inner)) return inner;
        return [];
    }
    function _ptqAds(adsName, sqlParams) {
        if (PTQ_MOCK) return _ptqMockAds(adsName, sqlParams);
        return new Promise(function (resolve, reject) {
            try {
                // STANDALONE-MODE FIX: dropped the `window.parent === window`
                // rejection — see axi-databin-services.js's ensureAxpertContext
                // for the full explanation. Only whether GetDataFromAxList is
                // actually callable matters.
                if (typeof parent === 'undefined' || typeof parent.GetDataFromAxList !== 'function') {
                    reject(new Error('This page must be opened from inside Axpert with a valid parent session.'));
                    return;
                }
                if (!adsName) { resolve([]); return; }
                var params = { adsNames: [adsName], refreshCache: true, sqlParams: sqlParams || {} };
                parent.GetDataFromAxList(params, function (response) {
                    try {
                        if (_ptqIsSessionText(response)) {
                            reject(new Error('Axpert session expired. Re-login and reopen this page from Axpert.'));
                            return;
                        }
                        var rows = _ptqExtractRows(response);
                        resolve(Array.isArray(rows) ? rows : []);
                    } catch (e) { reject(e); }
                });
            } catch (e) { reject(e); }
        });
    }

    /* -- mock datasource + push, for reviewing the UI without Axpert ------ */
    function _ptqMockAds(adsName, sqlParams) {
        return new Promise(function (resolve) {
            setTimeout(function () {
                if (adsName === PTQ_CFG.ADS_TSTRUCT_LIST) {
                    resolve([
                        { tstructname: 'forma', caption: 'Sample Form A (all non-grid)' },
                        { tstructname: 'formb', caption: 'Sample Form B (has a grid DC)' }
                    ]);
                    return;
                }
                if (adsName === PTQ_CFG.ADS_TSTRUCT_FIELDS) {
                    var tstruct = (sqlParams && sqlParams[PTQ_CFG.FIELD_SQLPARAM]) || '';
                    if (tstruct === 'forma') {
                        resolve([
                            { fieldname: 'flda', caption: 'Name', dc: 'dc1', mandatory: 'T', datatype: 'c', isgrid: 'F' },
                            { fieldname: 'fldb', caption: 'Owner', dc: 'dc1', mandatory: 'F', datatype: 'c', isgrid: 'F' },
                            { fieldname: 'fldc', caption: 'Amount', dc: 'dc1', mandatory: 'F', datatype: 'n', isgrid: 'F' },
                            { fieldname: 'fldd', caption: 'Notes', dc: 'dc1', mandatory: 'F', datatype: 'c', isgrid: 'F' }
                        ]);
                        return;
                    }
                    if (tstruct === 'formb') {
                        resolve([
                            { fieldname: 'flda', caption: 'Item', dc: 'dc1', mandatory: 'T', datatype: 'c', isgrid: 'F' },
                            { fieldname: 'fldb', caption: 'Category', dc: 'dc1', mandatory: 'F', datatype: 'c', isgrid: 'F' },
                            { fieldname: 'fldd', caption: 'Line Item', dc: 'dc2', mandatory: 'F', datatype: 'c', isgrid: 'T' },
                            { fieldname: 'flde', caption: 'Line Amount', dc: 'dc2', mandatory: 'F', datatype: 'n', isgrid: 'T' }
                        ]);
                        return;
                    }
                    resolve([]);
                    return;
                }
                resolve([]);
            }, 350);
        });
    }
    function _ptqMockPush(payload) {
        console.info('[PTQ mock] would push:', payload);
        return new Promise(function (resolve) { setTimeout(function () { resolve({ mock: true }); }, 700); });
    }
    window.axiPtqMock = function (enable) {
        PTQ_MOCK = !!enable;
        _ptqToast('Push-to-tstruct mock mode ' + (PTQ_MOCK ? 'ON -- sample tstructs, no Axpert needed.' : 'OFF.'), 'info', 2500);
    };

    /* -- UI_ONLY fixture data --------------------------------------------
       Used while PTQ_CFG.UI_ONLY is true: no Axpert datasource calls, no AI
       calls, no AxPushtoQueueAPI call. Deliberately leaves one mandatory
       field unmapped per tstruct so the validation warning is exercised,
       and includes a grid-bearing tstruct so the "N grid fields hidden"
       note is exercised too. Flip PTQ_CFG.UI_ONLY to false once the UI has
       been reviewed, to switch back to the real datasource/push logic. */
    var PTQ_UI_FIXTURE = {
        tstructs: [
            { name: 'demoform', caption: 'Demo Form (UI preview)' },
            { name: 'demoinvoice', caption: 'Demo Invoice (has a grid DC)' }
        ],
        fields: {
            demoform: [
                { fldname: 'custname', fldcap: 'Customer Name', dc: 'dc1', mandatory: true, datatype: 'c', isGrid: false },
                { fldname: 'custcode', fldcap: 'Customer Code', dc: 'dc1', mandatory: true, datatype: 'c', isGrid: false },
                { fldname: 'amount', fldcap: 'Amount', dc: 'dc1', mandatory: false, datatype: 'n', isGrid: false },
                { fldname: 'notes', fldcap: 'Notes', dc: 'dc1', mandatory: false, datatype: 'c', isGrid: false }
            ],
            demoinvoice: [
                { fldname: 'invno', fldcap: 'Invoice No', dc: 'dc1', mandatory: true, datatype: 'c', isGrid: false },
                { fldname: 'vendor', fldcap: 'Vendor', dc: 'dc1', mandatory: false, datatype: 'c', isGrid: false },
                { fldname: 'lineitem', fldcap: 'Line Item', dc: 'dc2', mandatory: false, datatype: 'c', isGrid: true },
                { fldname: 'lineamount', fldcap: 'Line Amount', dc: 'dc2', mandatory: false, datatype: 'n', isGrid: true }
            ]
        },
        sourceRows: [
            { 'Customer Name': 'Acme Corp', 'Customer Code': 'ACM001', 'Amount': '1250.00' },
            { 'Customer Name': 'Globex Inc', 'Customer Code': 'GLX002', 'Amount': '980.50' },
            { 'Customer Name': 'Initech LLC', 'Customer Code': 'INI003', 'Amount': '430.00' }
        ]
    };

    /* -- 3. normalize datasource rows using the candidate COLS map --------- */
    function _ptqNormTstructs(rows) {
        return (rows || []).map(function (r) {
            return {
                name: String(_ptqPick(r, PTQ_CFG.COLS.tstructName) || '').trim(),
                caption: String(_ptqPick(r, PTQ_CFG.COLS.tstructCaption) || '').trim()
            };
        }).filter(function (t) { return t.name; });
    }
    function _ptqNormFields(rows) {
        return (rows || []).map(function (r) {
            var name = String(_ptqPick(r, PTQ_CFG.COLS.fieldName) || '').trim();
            var caption = String(_ptqPick(r, PTQ_CFG.COLS.fieldCaption) || '').trim() || name;
            var dc = String(_ptqPick(r, PTQ_CFG.COLS.dc) || '').trim().toLowerCase() || 'dc1';
            var datatype = String(_ptqPick(r, PTQ_CFG.COLS.datatype) || '').trim().toLowerCase();
            return {
                fldname: name,
                fldcap: caption,
                dc: dc,
                mandatory: _ptqTruthy(_ptqPick(r, PTQ_CFG.COLS.mandatory)),
                datatype: datatype,
                isGrid: _ptqTruthy(_ptqPick(r, PTQ_CFG.COLS.isGrid))
            };
        }).filter(function (f) { return f.fldname; });
    }

    /* -- 4. AI response -> rows. Reuses the production Smart List converter
       (axiConvertResponseToSmartListData / axiInferSmartListMeta) instead
       of writing a second parser -- see script.js "AXI SMART LIST
       INTEGRATION" earlier in this file. ---------------------------------- */
    function _ptqSourceText(bubble) {
        return (bubble && (bubble._axiMarkdown || bubble.innerText || bubble.textContent)) || '';
    }
    async function _ptqExtractSourceRows(bubble) {
        var text = _ptqSourceText(bubble).trim();
        if (!text) return { rows: [], cols: [] };
        try {
            if (typeof axiConvertResponseToSmartListData === 'function') {
                var rows = await axiConvertResponseToSmartListData(text);
                if (Array.isArray(rows) && rows.length) {
                    var cols = typeof axiInferSmartListMeta === 'function'
                        ? axiInferSmartListMeta(rows).map(function (m) { return m.fldname; })
                        : Object.keys(rows[0]);
                    return { rows: rows, cols: cols };
                }
            }
        } catch (e) {
            console.warn('[PTQ] response->rows conversion failed, falling back to raw text', e);
        }
        return { rows: [{ response_text: text.slice(0, 500) }], cols: ['response_text'] };
    }

    /* -- 5. auto-map: fast local scoring pass, then one LLM pass, merged -- */
    function _ptqLocalScore(field, col) {
        var fn = _ptqNormKey(field.fldname), fc = _ptqNormKey(field.fldcap), cn = _ptqNormKey(col);
        if (!cn) return 0;
        if (cn === fn || cn === fc) return 100;
        if (fn.indexOf(cn) >= 0 || cn.indexOf(fn) >= 0) return 75;
        if (fc && (fc.indexOf(cn) >= 0 || cn.indexOf(fc) >= 0)) return 70;
        var ft = {};
        (field.fldcap + ' ' + field.fldname).toLowerCase().split(/[^a-z0-9]+/).forEach(function (t) { if (t) ft[t] = true; });
        var ct = String(col).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        if (!ct.length) return 0;
        var hit = ct.filter(function (t) { return ft[t]; }).length;
        return Math.round((hit / ct.length) * 55);
    }
    function _ptqLocalAutoMap(fields, cols) {
        var pairs = [];
        fields.forEach(function (f) {
            cols.forEach(function (c) {
                var score = _ptqLocalScore(f, c);
                if (score >= 40) pairs.push({ field: f.fldname, col: c, score: score });
            });
        });
        pairs.sort(function (a, b) { return b.score - a.score; });
        var mapping = {}, usedCols = {};
        pairs.forEach(function (p) {
            if (mapping[p.field] || usedCols[p.col]) return;
            mapping[p.field] = p.col;
            usedCols[p.col] = true;
        });
        return mapping;
    }
    async function _ptqLLMAutoMap(fields, cols, sampleRows) {
        if (!fields.length || !cols.length || typeof axiChatCompletion !== 'function') return {};
        try {
            var sample = sampleRows.slice(0, 3);
            var colInfo = cols.map(function (c) {
                var vals = sample.map(function (r) { return r[c]; })
                    .filter(function (v) { return v !== undefined && v !== null && v !== ''; }).slice(0, 2);
                return c + (vals.length ? ' (e.g. ' + vals.join(', ') + ')' : '');
            }).join('\n- ');
            var fieldInfo = fields.map(function (f) {
                return f.fldname + (f.fldcap && f.fldcap !== f.fldname ? ' ("' + f.fldcap + '")' : '') +
                    (f.mandatory ? ' [required]' : '') + (f.datatype ? ' [' + f.datatype + ']' : '');
            }).join('\n- ');
            var prompt = 'You are mapping columns from an extracted data table onto the fields of a form.\n\n' +
                'Form fields:\n- ' + fieldInfo + '\n\n' +
                'Source columns (with sample values):\n- ' + colInfo + '\n\n' +
                'Return ONLY a JSON object mapping each form field name to the single best-matching source column ' +
                'name, or null if nothing matches well. Every key must be one of the exact form field names above. ' +
                'Every value must be one of the exact source column names above, or null. No prose, no markdown fences.';
            var raw = await axiChatCompletion({ messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 800 });
            var parsed = typeof tryParseJsonStrict === 'function' ? tryParseJsonStrict(raw) : JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return {};
            var fieldNames = {}; fields.forEach(function (f) { fieldNames[f.fldname] = true; });
            var colNames = {}; cols.forEach(function (c) { colNames[c] = true; });
            var out = {};
            Object.keys(parsed).forEach(function (k) {
                if (!fieldNames[k]) return;
                var v = parsed[k];
                if (v && colNames[v]) out[k] = v;
            });
            return out;
        } catch (e) {
            console.warn('[PTQ] LLM auto-map failed, using local matches only', e);
            return null;
        }
    }
    async function _ptqAutoMap(fields, cols, sampleRows) {
        var local = _ptqLocalAutoMap(fields, cols);
        var llm = await _ptqLLMAutoMap(fields, cols, sampleRows);
        if (llm === null) {
            _ptqToast('Auto-map used quick local matching only (AI mapping unavailable).', 'info', 3000);
            var autoLocal = {}; Object.keys(local).forEach(function (k) { autoLocal[k] = true; });
            return { mapping: local, auto: autoLocal };
        }
        var mapping = {}, auto = {};
        fields.forEach(function (f) {
            var chosen = llm[f.fldname] || local[f.fldname] || '';
            if (chosen) { mapping[f.fldname] = chosen; auto[f.fldname] = true; }
        });
        return { mapping: mapping, auto: auto };
    }

    /* -- 6. modal state -------------------------------------------------- */
    var PTQ = {
        dom: {},
        step: 1,
        bubble: null,
        tstructs: [], tstructsLoaded: false, tstructsLoading: false, tstructsError: null,
        tstructFilter: '',
        selectedTstruct: null,
        fields: [], gridFieldCount: 0, fieldsLoading: false, fieldsError: null,
        sourceRows: [], sourceCols: [],
        mapping: {}, customValues: {}, autoMapped: {},
        records: [],
        mapLoading: false,
        pushing: false,
        project: ''
    };

    function _ptqReset() {
        PTQ.step = 1; PTQ.bubble = null;
        PTQ.tstructs = []; PTQ.tstructsLoaded = false; PTQ.tstructsLoading = false; PTQ.tstructsError = null;
        PTQ.tstructFilter = ''; PTQ.selectedTstruct = null;
        PTQ.fields = []; PTQ.gridFieldCount = 0; PTQ.fieldsLoading = false; PTQ.fieldsError = null;
        PTQ.sourceRows = []; PTQ.sourceCols = [];
        PTQ.mapping = {}; PTQ.customValues = {}; PTQ.autoMapped = {};
        PTQ.records = []; PTQ.mapLoading = false; PTQ.pushing = false;
    }

    function _ptqApplyMappingToColumn(fieldname) {
        var src = PTQ.mapping[fieldname];
        PTQ.records.forEach(function (rec, i) {
            var row = PTQ.sourceRows[i] || {};
            var v = '';
            if (src === '__custom__') v = PTQ.customValues[fieldname] || '';
            else if (src) v = (row[src] !== undefined && row[src] !== null) ? row[src] : '';
            rec.values[fieldname] = v;
        });
    }
    function _ptqBuildRecords() {
        var rows = PTQ.sourceRows.slice(0, PTQ_CFG.MAX_RECORDS);
        PTQ.records = rows.map(function (row, i) {
            var values = {};
            PTQ.fields.forEach(function (f) {
                var src = PTQ.mapping[f.fldname];
                var v = '';
                if (src === '__custom__') v = PTQ.customValues[f.fldname] || '';
                else if (src) v = (row[src] !== undefined && row[src] !== null) ? row[src] : '';
                values[f.fldname] = v;
            });
            return { include: true, values: values };
        });
        if (!PTQ.records.length) {
            var blank = {}; PTQ.fields.forEach(function (f) { blank[f.fldname] = ''; });
            PTQ.records = [{ include: true, values: blank }];
        }
    }
    function _ptqUnmappedMandatory() {
        return PTQ.fields.filter(function (f) {
            if (!f.mandatory) return false;
            var anyValue = PTQ.records.some(function (r) { return r.include && String(r.values[f.fldname] || '').trim() !== ''; });
            return !anyValue;
        });
    }

    /* -- 7. project resolution ------------------------------------------- */
    function _ptqResolveProject() {
        if (PTQ_CFG.PROJECT) return PTQ_CFG.PROJECT;
        var candidates = ['ARMProjectName', 'projectName', 'mainProject', 'project'];
        for (var i = 0; i < candidates.length; i++) {
            try {
                var v = parent && parent[candidates[i]];
                if (v && typeof v === 'string') return v;
            } catch (e) { }
        }
        try { if (window.axpertProject) return String(window.axpertProject); } catch (e) { }
        try {
            var stored = localStorage.getItem('axi_ptq_project');
            if (stored) return stored;
        } catch (e) { }
        return '';
    }

    /* -- 8. payload + push ---------------------------------------------- */
    function _ptqBuildPayload() {
        var username = '';
        try { username = (typeof parent !== 'undefined' && parent.mainUserName) || (typeof mainUserName !== 'undefined' ? mainUserName : '') || ''; } catch (e) { }
        var included = PTQ.records.filter(function (r) { return r.include; });
        var data = included.map(function (r) {
            var submitdata = {};
            PTQ.fields.forEach(function (f) {
                var val = r.values[f.fldname];
                if (val === undefined || val === null || val === '') return;
                var dc = f.dc || 'dc1';
                if (!submitdata[dc]) submitdata[dc] = { row1: {} };
                submitdata[dc].row1[f.fldname] = String(val);
            });
            return { transid: PTQ.selectedTstruct.name, action: 'create', submitdata: submitdata };
        });
        return {
            _parameters: [{
                ARMSessionId: '', ARMToken: '', isaxput: 'true',
                project: PTQ.project || '', username: username,
                trace: false, validateonly: !!PTQ_CFG.VALIDATE_ONLY,
                axclient_dateformat: 'yyyy-MM-dd', millisecsintimestamp: true,
                data: data
            }]
        };
    }
    function _ptqPush(payload) {
        if (PTQ_CFG.UI_ONLY || PTQ_MOCK) return _ptqMockPush(payload);
        return new Promise(function (resolve, reject) {
            var fn = _ptqPickAxFn('AxPushtoQueueAPI');
            if (!fn) { reject(new Error('AxPushtoQueueAPI is not available. This page must be running inside Axpert.')); return; }
            var settled = false;
            var timer = setTimeout(function () {
                if (settled) return; settled = true;
                reject(new Error('Timed out waiting for Axpert to respond.'));
            }, 30000);
            try {
                fn(payload, function (res) {
                    if (settled) return; settled = true; clearTimeout(timer); resolve(res);
                }, function (err) {
                    if (settled) return; settled = true; clearTimeout(timer);
                    reject(err instanceof Error ? err : new Error(typeof err === 'string' ? err : (err && err.message) || 'Push failed.'));
                });
            } catch (e) { clearTimeout(timer); reject(e); }
        });
    }

    /* -- 9. dialog shell (built once, appended to <body>) ----------------
       Reuses the live .axcn / .axModal__* chrome shared by connectModal /
       axiKeySetupModal / systemPromptModal (index.html), so it matches the
       app theme exactly. Built and wired entirely in JS -- no HTML edits. */
    function _ptqBuildDialog() {
        if (document.getElementById('axiPtqModal')) return;
        var dlg = document.createElement('dialog');
        dlg.id = 'axiPtqModal';
        dlg.className = 'axiModal';
        dlg.setAttribute('aria-labelledby', 'axiPtqTitle');
        dlg.innerHTML =
            '<div class="axcn">' +
            '<div class="axcn__head">' +
            '<div class="axcn__headLeft">' +
            '<span class="axcn__headIcon">' + PTQ_ICON_HEAD + '</span>' +
            '<div>' +
            '<h2 id="axiPtqTitle" class="axcn__title">Push to tstruct</h2>' +
            '<p class="axcn__sub" id="axiPtqSub">Choose a table structure to save this response into</p>' +
            '</div>' +
            '</div>' +
            '<button class="axModal__x" type="button" id="axiPtqCloseBtn" aria-label="Close">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
            '</button>' +
            '</div>' +
            '<div class="axiptq-steps" id="axiPtqSteps"></div>' +
            '<div class="axcn__body axiptq-body" id="axiPtqBody"></div>' +
            '<div class="axmp__foot">' +
            '<div id="axiPtqStatus" class="axModal__status" style="display:none;"></div>' +
            '<div class="axmp__actions" id="axiPtqActions"></div>' +
            '</div>' +
            '</div>';
        document.body.appendChild(dlg);
        dlg.querySelector('#axiPtqCloseBtn').addEventListener('click', function () { _ptqClose(); });
        dlg.addEventListener('mousedown', function (e) { if (e.target === dlg) _ptqClose(); });
        dlg.addEventListener('cancel', function (e) { e.preventDefault(); _ptqClose(); });
        PTQ.dom.dialog = dlg;
        PTQ.dom.sub = dlg.querySelector('#axiPtqSub');
        PTQ.dom.steps = dlg.querySelector('#axiPtqSteps');
        PTQ.dom.body = dlg.querySelector('#axiPtqBody');
        PTQ.dom.status = dlg.querySelector('#axiPtqStatus');
        PTQ.dom.actions = dlg.querySelector('#axiPtqActions');
    }

    function _ptqSetStatus(msg, type) {
        var el = PTQ.dom.status; if (!el) return;
        if (!msg) { el.style.display = 'none'; el.className = 'axModal__status'; return; }
        var icon = type === 'error' ? 'error_outline' : type === 'success' ? 'check_circle' : 'info';
        el.className = 'axModal__status status--' + (type || 'info');
        el.style.display = 'flex';
        el.innerHTML = '<span class="material-icons" style="font-size:16px;">' + icon + '</span><span>' + _ptqEsc(msg) + '</span>';
    }

    function _ptqOpen(bubble) {
        _ptqBuildDialog();
        _ptqReset();
        PTQ.bubble = bubble;
        PTQ.project = PTQ_CFG.UI_ONLY ? (_ptqResolveProject() || 'demo_project') : _ptqResolveProject();
        var titleEl = PTQ.dom.dialog.querySelector('#axiPtqTitle');
        if (titleEl) titleEl.textContent = PTQ_CFG.UI_ONLY ? 'Push to tstruct (UI preview)' : 'Push to tstruct';
        _ptqSetStatus('');
        _ptqRender();
        try { if (!PTQ.dom.dialog.open) PTQ.dom.dialog.showModal(); } catch (e) { PTQ.dom.dialog.setAttribute('open', ''); }
        if (!PTQ.tstructsLoaded && !PTQ.tstructsLoading) _ptqLoadTstructs();
    }
    function _ptqClose() {
        if (PTQ.pushing) return;
        try { if (PTQ.dom.dialog.open) PTQ.dom.dialog.close(); } catch (e) { PTQ.dom.dialog.removeAttribute('open'); }
    }

    /* -- 10. render ------------------------------------------------------ */
    function _ptqRender() {
        _ptqRenderSteps();
        if (PTQ.step === 1) _ptqRenderStep1();
        else if (PTQ.step === 2) _ptqRenderStep2();
        else _ptqRenderStep3();
        _ptqRenderActions();
    }
    function _ptqRenderSteps() {
        var labels = ['Choose tstruct', 'Map fields', 'Review & push'];
        var html = '';
        labels.forEach(function (label, i) {
            var n = i + 1;
            var cls = n === PTQ.step ? 'active' : (n < PTQ.step ? 'done' : '');
            var doneIcon = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
            html += '<div class="axiptq-step ' + cls + '"><span class="axiptq-step-dot">' + (n < PTQ.step ? doneIcon : n) + '</span><span>' + label + '</span></div>';
            if (n < 3) html += '<div class="axiptq-step-line"></div>';
        });
        PTQ.dom.steps.innerHTML = html;
    }

    async function _ptqLoadTstructs() {
        PTQ.tstructsLoading = true; PTQ.tstructsError = null;
        if (PTQ.step === 1) _ptqRefreshTstructResults();
        if (PTQ_CFG.UI_ONLY) {
            await new Promise(function (r) { setTimeout(r, 350); });
            PTQ.tstructs = PTQ_UI_FIXTURE.tstructs.slice();
            PTQ.tstructsLoaded = true;
            PTQ.tstructsLoading = false;
            if (PTQ.step === 1) _ptqRefreshTstructResults();
            return;
        }
        try {
            var rows = await _ptqAds(PTQ_CFG.ADS_TSTRUCT_LIST, _ptqUserContext());
            PTQ.tstructs = _ptqNormTstructs(rows);
            PTQ.tstructsLoaded = true;
        } catch (e) {
            PTQ.tstructsError = (e && e.message) ? e.message : 'Could not load tstructs.';
        }
        PTQ.tstructsLoading = false;
        if (PTQ.step === 1) _ptqRefreshTstructResults();
    }

    function _ptqRenderStep1() {
        PTQ.dom.sub.textContent = 'Choose a table structure to save this response into';
        var body = PTQ.dom.body;
        body.innerHTML =
            '<div class="axiptq-search">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
            '<input type="text" id="axiPtqSearch" placeholder="Search tstructs..." autocomplete="off" spellcheck="false" value="' + _ptqEsc(PTQ.tstructFilter) + '">' +
            '</div>' +
            '<div id="axiPtqResults"></div>';
        var search = body.querySelector('#axiPtqSearch');
        search.addEventListener('input', function () { PTQ.tstructFilter = search.value; _ptqRefreshTstructResults(); });
        _ptqRefreshTstructResults();
    }
    function _ptqRefreshTstructResults() {
        var results = PTQ.dom.body.querySelector('#axiPtqResults');
        if (!results) return;
        var html;
        if (PTQ.tstructsLoading) {
            html = '<div class="axiptq-loading"><span class="axiptq-spinner"></span> Loading tstructs...</div>';
        } else if (PTQ.tstructsError) {
            html = '<div class="axiptq-empty">' + _ptqEsc(PTQ.tstructsError) + '<br><button class="axModal__btn axModal__btn--ghost" id="axiPtqRetryTstructs" type="button" style="margin-top:10px;">Retry</button></div>';
        } else {
            var q = _ptqNormKey(PTQ.tstructFilter);
            var filtered = PTQ.tstructs.filter(function (t) {
                if (!q) return true;
                return _ptqNormKey(t.name).indexOf(q) >= 0 || _ptqNormKey(t.caption).indexOf(q) >= 0;
            });
            if (!PTQ.tstructs.length) html = '<div class="axiptq-empty">No tstructs found.</div>';
            else if (!filtered.length) html = '<div class="axiptq-empty">No tstructs match "' + _ptqEsc(PTQ.tstructFilter) + '".</div>';
            else html = '<div class="axiptq-list">' + filtered.map(function (t) {
                return '<button type="button" class="axiptq-item" data-tstruct="' + _ptqEsc(t.name) + '">' +
                    '<span class="axiptq-item-name">' + _ptqEsc(t.name) + '</span>' +
                    (t.caption ? '<span class="axiptq-item-cap">' + _ptqEsc(t.caption) + '</span>' : '') +
                    '</button>';
            }).join('') + '</div>';
        }
        results.innerHTML = html;
        results.querySelectorAll('.axiptq-item').forEach(function (btn) {
            btn.addEventListener('click', function () { _ptqSelectTstruct(btn.getAttribute('data-tstruct')); });
        });
        var retryBtn = results.querySelector('#axiPtqRetryTstructs');
        if (retryBtn) retryBtn.addEventListener('click', function () { PTQ.tstructsLoaded = false; _ptqLoadTstructs(); });
    }

    async function _ptqSelectTstruct(name) {
        var t = PTQ.tstructs.filter(function (x) { return x.name === name; })[0];
        if (!t) return;
        PTQ.selectedTstruct = t;
        PTQ.step = 2;
        PTQ.fieldsLoading = true; PTQ.fieldsError = null; PTQ.mapLoading = true;
        _ptqRender();
        if (PTQ_CFG.UI_ONLY) {
            await new Promise(function (r) { setTimeout(r, 300); });
            var fixtureFields = (PTQ_UI_FIXTURE.fields[t.name] || []).map(function (f) {
                var copy = {}; for (var k in f) copy[k] = f[k]; return copy;
            });
            PTQ.gridFieldCount = fixtureFields.filter(function (f) { return f.isGrid; }).length;
            PTQ.fields = fixtureFields.filter(function (f) { return !f.isGrid; });
            PTQ.sourceRows = PTQ_UI_FIXTURE.sourceRows.slice();
            PTQ.sourceCols = PTQ.sourceRows.length ? Object.keys(PTQ.sourceRows[0]) : [];
            PTQ.fieldsLoading = false;
            if (PTQ.step === 2) _ptqRender();

            await new Promise(function (r) { setTimeout(r, 250); });
            PTQ.mapping = {}; PTQ.autoMapped = {};
            PTQ.fields.forEach(function (f) {
                if (f.fldname === 'custname') { PTQ.mapping[f.fldname] = 'Customer Name'; PTQ.autoMapped[f.fldname] = true; }
                if (f.fldname === 'amount') { PTQ.mapping[f.fldname] = 'Amount'; PTQ.autoMapped[f.fldname] = true; }
                // custcode / invno deliberately left unmapped to exercise the
                // "required field not mapped" warning in the UI.
            });
            _ptqBuildRecords();
            PTQ.mapLoading = false;
            if (PTQ.step === 2) _ptqRender();
            return;
        }
        try {
            var sqlParams = {}; sqlParams[PTQ_CFG.FIELD_SQLPARAM] = t.name;
            var results = await Promise.all([
                _ptqAds(PTQ_CFG.ADS_TSTRUCT_FIELDS, sqlParams),
                _ptqExtractSourceRows(PTQ.bubble)
            ]);
            var allFields = _ptqNormFields(results[0]);
            PTQ.gridFieldCount = allFields.filter(function (f) { return f.isGrid; }).length;
            PTQ.fields = allFields.filter(function (f) { return !f.isGrid; });
            PTQ.sourceRows = results[1].rows;
            PTQ.sourceCols = results[1].cols;
            PTQ.fieldsLoading = false;
            if (PTQ.step === 2) _ptqRender();

            var auto = await _ptqAutoMap(PTQ.fields, PTQ.sourceCols, PTQ.sourceRows);
            PTQ.mapping = auto.mapping;
            PTQ.autoMapped = auto.auto;
            _ptqBuildRecords();
        } catch (e) {
            PTQ.fieldsError = (e && e.message) ? e.message : 'Could not load fields for this tstruct.';
            PTQ.fieldsLoading = false;
        }
        PTQ.mapLoading = false;
        if (PTQ.step === 2) _ptqRender();
    }

    function _ptqRenderStep2() {
        PTQ.dom.sub.textContent = PTQ.selectedTstruct ? ('Map the response onto ' + PTQ.selectedTstruct.name) : 'Map fields';
        var body = PTQ.dom.body;
        if (PTQ.fieldsLoading) {
            body.innerHTML = '<div class="axiptq-loading"><span class="axiptq-spinner"></span> Loading fields...</div>';
            return;
        }
        if (PTQ.fieldsError) {
            body.innerHTML = '<div class="axiptq-empty">' + _ptqEsc(PTQ.fieldsError) + '<br><button class="axModal__btn axModal__btn--ghost" id="axiPtqRetryFields" type="button" style="margin-top:10px;">Retry</button></div>';
            var rb = body.querySelector('#axiPtqRetryFields');
            if (rb) rb.addEventListener('click', function () { _ptqSelectTstruct(PTQ.selectedTstruct.name); });
            return;
        }
        if (!PTQ.fields.length) {
            body.innerHTML = '<div class="axiptq-empty">This tstruct has no non-grid fields' +
                (PTQ.gridFieldCount ? ' (only ' + PTQ.gridFieldCount + ' grid field' + (PTQ.gridFieldCount === 1 ? '' : 's') + ', not supported yet).' : '.') + '</div>';
            return;
        }

        var mapRows = PTQ.fields.map(function (f) {
            var options = '<option value="">-- leave empty --</option>' +
                PTQ.sourceCols.map(function (c) {
                    return '<option value="' + _ptqEsc(c) + '"' + (PTQ.mapping[f.fldname] === c ? ' selected' : '') + '>' + _ptqEsc(c) + '</option>';
                }).join('') +
                '<option value="__custom__"' + (PTQ.mapping[f.fldname] === '__custom__' ? ' selected' : '') + '>Custom value...</option>';
            var isCustom = PTQ.mapping[f.fldname] === '__custom__';
            return '<div class="axiptq-fieldrow" data-field="' + _ptqEsc(f.fldname) + '">' +
                '<span class="axiptq-field-label">' +
                (f.mandatory ? '<span class="axiptq-mandatory-dot" title="Required"></span>' : '') +
                _ptqEsc(f.fldcap) +
                '</span>' +
                (f.datatype ? '<span class="axiptq-field-type">' + _ptqEsc(f.datatype) + '</span>' : '') +
                '<select class="axiptq-field-select" data-map-field="' + _ptqEsc(f.fldname) + '">' + options + '</select>' +
                (isCustom ? '<input type="text" class="axiptq-custom-input" data-custom-field="' + _ptqEsc(f.fldname) + '" placeholder="Value for all records" value="' + _ptqEsc(PTQ.customValues[f.fldname] || '') + '">' : '') +
                (PTQ.autoMapped[f.fldname] ? '<span class="axiptq-auto-badge">auto</span>' : '') +
                '</div>';
        }).join('');

        var unmapped = _ptqUnmappedMandatory();
        var headCells = PTQ.fields.map(function (f) { return '<th>' + _ptqEsc(f.fldcap) + '</th>'; }).join('');
        var recordsRows = PTQ.records.map(function (rec, i) {
            var cells = PTQ.fields.map(function (f) {
                return '<td><input type="text" data-rec="' + i + '" data-field="' + _ptqEsc(f.fldname) + '" value="' + _ptqEsc(rec.values[f.fldname]) + '"></td>';
            }).join('');
            return '<tr class="' + (rec.include ? '' : 'excluded') + '">' +
                '<td><input type="checkbox" data-rec-include="' + i + '"' + (rec.include ? ' checked' : '') + '></td>' +
                cells +
                '</tr>';
        }).join('');

        body.innerHTML =
            '<p class="axiptq-hint">' + (PTQ.mapLoading ? 'Auto-mapping...  ' : '') + 'Response columns were matched to fields automatically -- review and adjust, or leave a field empty to skip it.</p>' +
            mapRows +
            (PTQ.gridFieldCount ? '<div class="axiptq-grid-note"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>' + PTQ.gridFieldCount + ' grid field' + (PTQ.gridFieldCount === 1 ? '' : 's') + ' hidden -- grid DCs aren\'t supported in this version.</div>' : '') +
            '<div class="axiptq-records-head"><span class="axiptq-records-title">Records to push</span><span class="axiptq-records-count">' + PTQ.records.filter(function (r) { return r.include; }).length + ' of ' + PTQ.records.length + ' included</span></div>' +
            '<div class="axiptq-table-wrap"><table class="axiptq-table"><thead><tr><th></th>' + headCells + '</tr></thead><tbody>' + recordsRows + '</tbody></table></div>' +
            (unmapped.length ? '<div class="axiptq-grid-note" style="border-color:#FECACA;background:#FEF2F2;color:#B91C1C;">Required field' + (unmapped.length === 1 ? '' : 's') + ' not mapped: ' + unmapped.map(function (f) { return _ptqEsc(f.fldcap); }).join(', ') + '</div>' : '');

        body.querySelectorAll('[data-map-field]').forEach(function (sel) {
            sel.addEventListener('change', function () {
                var field = sel.getAttribute('data-map-field');
                PTQ.mapping[field] = sel.value;
                delete PTQ.autoMapped[field];
                if (sel.value !== '__custom__') delete PTQ.customValues[field];
                _ptqApplyMappingToColumn(field);
                _ptqRenderStep2();
                _ptqRenderActions();
            });
        });
        body.querySelectorAll('[data-custom-field]').forEach(function (inp) {
            inp.addEventListener('input', function () {
                var field = inp.getAttribute('data-custom-field');
                PTQ.customValues[field] = inp.value;
                _ptqApplyMappingToColumn(field);
            });
            inp.addEventListener('blur', function () { _ptqRenderActions(); });
        });
        body.querySelectorAll('[data-rec-include]').forEach(function (cb) {
            cb.addEventListener('change', function () {
                var i = parseInt(cb.getAttribute('data-rec-include'), 10);
                PTQ.records[i].include = cb.checked;
                var tr = cb.closest('tr'); if (tr) tr.classList.toggle('excluded', !cb.checked);
                _ptqRenderActions();
            });
        });
        body.querySelectorAll('.axiptq-table input[type="text"]').forEach(function (inp) {
            inp.addEventListener('input', function () {
                var i = parseInt(inp.getAttribute('data-rec'), 10);
                var field = inp.getAttribute('data-field');
                PTQ.records[i].values[field] = inp.value;
            });
        });
    }

    function _ptqRenderStep3() {
        PTQ.dom.sub.textContent = 'Review the exact JSON before it goes into ' + PTQ_CFG.QUEUE_NAME;
        var body = PTQ.dom.body;
        var included = PTQ.records.filter(function (r) { return r.include; });
        var payload = _ptqBuildPayload();
        var pretty = JSON.stringify(payload, null, 2);
        var needsProject = !PTQ.project;

        body.innerHTML =
            (needsProject ?
                '<div class="axiptq-project-row"><label class="axModal__label" style="margin:0;white-space:nowrap;">Project</label><input type="text" id="axiPtqProjectInput" placeholder="Axpert project name" value="' + _ptqEsc(PTQ.project) + '"></div>'
                : '') +
            '<div class="axiptq-summary">' +
            '<span class="axiptq-summary-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></span>' +
            '<span>Pushing <strong>' + included.length + ' record' + (included.length === 1 ? '' : 's') + '</strong> into <strong>' + _ptqEsc(PTQ.selectedTstruct.name) + '</strong> via <strong>' + PTQ_CFG.QUEUE_NAME + '</strong>.</span>' +
            '</div>' +
            '<details class="axiptq-payload"><summary>View payload JSON</summary><pre>' + _ptqEsc(pretty) + '</pre></details>';

        var projInput = body.querySelector('#axiPtqProjectInput');
        if (projInput) {
            projInput.addEventListener('input', function () {
                PTQ.project = projInput.value.trim();
                try { localStorage.setItem('axi_ptq_project', PTQ.project); } catch (e) { }
                _ptqRenderActions();
            });
        }
    }

    function _ptqRenderActions() {
        var actions = PTQ.dom.actions;
        if (PTQ.step === 1) {
            actions.innerHTML = '<button class="axModal__btn axModal__btn--ghost" type="button" id="axiPtqCancel">Cancel</button>';
            actions.querySelector('#axiPtqCancel').addEventListener('click', _ptqClose);
            return;
        }
        if (PTQ.step === 2) {
            var unmapped = _ptqUnmappedMandatory();
            var included = PTQ.records.filter(function (r) { return r.include; }).length;
            var disabled = PTQ.fieldsLoading || !!PTQ.fieldsError || !PTQ.fields.length || unmapped.length > 0 || included === 0;
            actions.innerHTML =
                '<button class="axModal__btn axModal__btn--ghost" type="button" id="axiPtqBack">Back</button>' +
                '<button class="axModal__btn axModal__btn--primary" type="button" id="axiPtqNext"' + (disabled ? ' disabled' : '') + '>Review &amp; push</button>';
            actions.querySelector('#axiPtqBack').addEventListener('click', function () { PTQ.step = 1; _ptqRender(); });
            var nextBtn = actions.querySelector('#axiPtqNext');
            if (nextBtn) nextBtn.addEventListener('click', function () { if (disabled) return; PTQ.step = 3; _ptqRender(); });
            return;
        }
        var included3 = PTQ.records.filter(function (r) { return r.include; }).length;
        var pushDisabled = PTQ.pushing || !included3 || !PTQ.project;
        actions.innerHTML =
            '<button class="axModal__btn axModal__btn--ghost" type="button" id="axiPtqBack3"' + (PTQ.pushing ? ' disabled' : '') + '>Back</button>' +
            '<button class="axModal__btn axModal__btn--primary" type="button" id="axiPtqPushBtn"' + (pushDisabled ? ' disabled' : '') + '>' +
            (PTQ.pushing ? '<span class="axiptq-spinner" style="width:12px;height:12px;border-width:2px;"></span> Pushing...' : 'Push ' + included3 + ' record' + (included3 === 1 ? '' : 's')) +
            '</button>';
        var back3 = actions.querySelector('#axiPtqBack3');
        if (back3) back3.addEventListener('click', function () { if (PTQ.pushing) return; PTQ.step = 2; _ptqRender(); });
        var pushBtn = actions.querySelector('#axiPtqPushBtn');
        if (pushBtn) pushBtn.addEventListener('click', _ptqDoPush);
    }

    async function _ptqDoPush() {
        if (PTQ.pushing) return;
        PTQ.pushing = true;
        _ptqSetStatus('Pushing to ' + PTQ_CFG.QUEUE_NAME + '...', 'info');
        _ptqRenderActions();
        try {
            var payload = _ptqBuildPayload();
            await _ptqPush(payload);
            var n = PTQ.records.filter(function (r) { return r.include; }).length;
            _ptqSetStatus('Pushed successfully.', 'success');
            _ptqToast(n + ' record' + (n === 1 ? '' : 's') + ' pushed to ' + PTQ_CFG.QUEUE_NAME + '.', 'success', 4000);
            PTQ.pushing = false;
            setTimeout(_ptqClose, 900);
        } catch (e) {
            PTQ.pushing = false;
            _ptqSetStatus((e && e.message) ? e.message : 'Push failed.', 'error');
            _ptqRenderActions();
        }
    }

    /* -- 11. pill under every AI response -- own MutationObserver, matches
       the existing hookMessages() pattern (this file) without touching it. */
    function _ptqInjectPill(msgNode) {
        if (!msgNode || msgNode.dataset.axiPtqDone) return;
        msgNode.dataset.axiPtqDone = '1';
        var bubble = msgNode.querySelector('.message__bubble, .messagebubble, .bubble');
        if (!bubble) return;
        if (PTQ_CFG.ONLY_WHEN_TABULAR && typeof axiHasTabularContent === 'function' && !axiHasTabularContent(bubble)) return;
        var parentEl = bubble.parentElement;
        if (!parentEl) return;
        var row = document.createElement('div');
        row.className = 'axiptq-pillrow';
        var pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'axiptq-pill';
        pill.title = 'Save this response into an Axpert tstruct';
        pill.innerHTML = '<span class="axiptq-pill-icon">' + PTQ_ICON_PILL + '</span><span>Push to tstruct</span>';
        pill.addEventListener('click', function (e) { e.stopPropagation(); _ptqOpen(bubble); });
        row.appendChild(pill);
        parentEl.appendChild(row);
    }
    function _ptqHookMessages() {
        var el = document.getElementById('messages'); if (!el) return;
        var handle = function (node) {
            if (node.nodeType !== 1 || !node.classList || !node.classList.contains('message--assistant')) return;
            if (node.classList.contains('axi-streaming-msg')) {
                var obs = new MutationObserver(function () {
                    if (!node.classList.contains('axi-streaming-msg')) {
                        obs.disconnect();
                        setTimeout(function () { _ptqInjectPill(node); }, 420);
                    }
                });
                obs.observe(node, { attributes: true, attributeFilter: ['class'] });
            } else {
                setTimeout(function () { _ptqInjectPill(node); }, 420);
            }
        };
        new MutationObserver(function (m) { m.forEach(function (r) { r.addedNodes.forEach(handle); }); }).observe(el, { childList: true, subtree: false });
        Array.prototype.forEach.call(el.querySelectorAll('.message--assistant'), function (n) {
            if (!n.classList.contains('axi-streaming-msg')) _ptqInjectPill(n);
        });
    }

    /* -- 12. styles -- injected once, namespaced .axiptq-* so nothing else
       is affected. Colours match the live amber accent used across
       connectModal / axiKeySetupModal (styles.css :root, ~line 14170+). */
    function _ptqInjectStyles() {
        if (document.getElementById('axiPtqStyles')) return;
        var css = '' +
            '.axiptq-pillrow{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 4px;}' +
            '.axiptq-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 13px;border-radius:20px;font-size:11.5px;font-weight:600;cursor:pointer;border:none;font-family:inherit;white-space:nowrap;user-select:none;background:linear-gradient(135deg,#fff4e5,#fff8ef);border:1.5px solid #fbdcb0;color:#c2570a;animation:axiptqPillIn .3s cubic-bezier(.22,.68,0,1.2) both;transition:transform .13s ease,box-shadow .13s ease,background .15s ease;}' +
            '.axiptq-pill:hover{transform:translateY(-2px);box-shadow:0 4px 14px rgba(242,140,40,.18);background:linear-gradient(135deg,#ffedd5,#fff4e5);}' +
            '.axiptq-pill:active{transform:translateY(0);}' +
            '.axiptq-pill-icon{display:inline-flex;align-items:center;flex-shrink:0;opacity:.95;}' +
            '@keyframes axiptqPillIn{from{opacity:0;transform:scale(.88) translateY(5px);}to{opacity:1;transform:scale(1) translateY(0);}}' +
            '#axiPtqModal .axcn{max-height:calc(100vh - 40px);}' +
            '#axiPtqModal .axiptq-body{flex:1 1 auto;overflow-y:auto;min-height:0;}' +
            '#axiPtqModal .axcn__head{flex:0 0 auto;}' +
            '.axiptq-steps{display:flex;align-items:center;gap:6px;padding:0 20px 14px;flex:0 0 auto;}' +
            '.axiptq-step{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#c3c7cf;}' +
            '.axiptq-step-dot{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;background:#f1f1ee;color:#9aa1ab;font-size:10.5px;transition:all .15s;}' +
            '.axiptq-step.active .axiptq-step-dot{background:#f28c28;color:#fff;}' +
            '.axiptq-step.done .axiptq-step-dot{background:#fff4e5;color:#e07820;border:1.5px solid #f5d8bb;}' +
            '.axiptq-step.active{color:#111418;}' +
            '.axiptq-step-line{width:20px;height:1.5px;background:#eceeef;}' +
            '.axiptq-search{position:relative;margin-bottom:10px;}' +
            '.axiptq-search input{width:100%;box-sizing:border-box;padding:9px 12px 9px 34px;border-radius:10px;border:1px solid #DDDDD5;background:#FBFBF8;font-size:13px;font-family:inherit;color:#111418;}' +
            '.axiptq-search input:focus{outline:none;border-color:#93C5FD;box-shadow:0 0 0 3px rgba(147,197,253,.20);}' +
            '.axiptq-search svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:#9aa1ab;}' +
            '.axiptq-list{display:flex;flex-direction:column;gap:5px;max-height:340px;overflow-y:auto;}' +
            '.axiptq-item{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;padding:10px 13px;border-radius:10px;border:1.5px solid #EEEEE8;background:#fff;cursor:pointer;transition:all .13s;width:100%;box-sizing:border-box;font-family:inherit;}' +
            '.axiptq-item:hover{border-color:#f5d8bb;background:#FFFBF5;}' +
            '.axiptq-item-name{font-size:13px;font-weight:700;color:#111418;}' +
            '.axiptq-item-cap{font-size:11.5px;color:#8a97a8;}' +
            '.axiptq-hint{font-size:12px;color:#8a97a8;margin:0 0 12px;line-height:1.5;}' +
            '.axiptq-fieldrow{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #F4F4F0;}' +
            '.axiptq-fieldrow:last-child{border-bottom:none;}' +
            '.axiptq-field-label{flex:0 0 150px;font-size:12.5px;font-weight:600;color:#111418;display:flex;align-items:center;gap:5px;}' +
            '.axiptq-mandatory-dot{width:5px;height:5px;border-radius:50%;background:#e11d48;flex-shrink:0;}' +
            '.axiptq-field-type{font-size:9.5px;font-weight:700;text-transform:uppercase;color:#9aa1ab;background:#F4F4F0;padding:1px 6px;border-radius:5px;flex-shrink:0;}' +
            '.axiptq-field-select{flex:1 1 auto;padding:7px 10px;border-radius:8px;border:1px solid #DDDDD5;background:#FBFBF8;font-size:12.5px;font-family:inherit;color:#111418;}' +
            '.axiptq-field-select:focus{outline:none;border-color:#93C5FD;}' +
            '.axiptq-auto-badge{flex-shrink:0;font-size:9px;font-weight:700;color:#e07820;background:#FFF4E5;border:1px solid #F5D8BB;padding:1px 6px;border-radius:5px;}' +
            '.axiptq-custom-input{flex:1 1 auto;padding:7px 10px;border-radius:8px;border:1px solid #DDDDD5;background:#fff;font-size:12.5px;font-family:inherit;margin-left:6px;}' +
            '.axiptq-grid-note{display:flex;align-items:center;gap:6px;font-size:11.5px;color:#8a97a8;background:#F8F8F5;border:1px dashed #E2E2DA;border-radius:8px;padding:8px 11px;margin-top:12px;}' +
            '.axiptq-records-head{display:flex;align-items:center;justify-content:space-between;margin:18px 0 8px;}' +
            '.axiptq-records-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a97a8;}' +
            '.axiptq-records-count{font-size:11.5px;color:#8a97a8;}' +
            '.axiptq-table-wrap{border:1px solid #EEEEE8;border-radius:10px;overflow:auto;max-height:260px;}' +
            '.axiptq-table{border-collapse:collapse;width:100%;font-size:12px;}' +
            '.axiptq-table th{position:sticky;top:0;background:#FAFAF7;text-align:left;padding:7px 9px;font-weight:700;color:#8a97a8;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;border-bottom:1px solid #EEEEE8;white-space:nowrap;}' +
            '.axiptq-table td{padding:4px 6px;border-bottom:1px solid #F4F4F0;vertical-align:middle;}' +
            '.axiptq-table tr:last-child td{border-bottom:none;}' +
            '.axiptq-table input[type="text"]{width:100%;box-sizing:border-box;border:1px solid transparent;background:transparent;padding:5px 6px;border-radius:6px;font-size:12px;font-family:inherit;color:#111418;}' +
            '.axiptq-table input[type="text"]:focus{outline:none;border-color:#93C5FD;background:#fff;}' +
            '.axiptq-table tr.excluded{opacity:.4;}' +
            '.axiptq-table input[type="checkbox"]{cursor:pointer;}' +
            '.axiptq-summary{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:10px;background:#FFF4E5;border:1px solid #F5D8BB;margin-bottom:14px;}' +
            '.axiptq-summary-icon{color:#e07820;flex-shrink:0;}' +
            '.axiptq-summary strong{color:#111418;}' +
            '.axiptq-payload{margin-top:6px;}' +
            '.axiptq-payload summary{cursor:pointer;font-size:12px;font-weight:600;color:#64748B;padding:6px 0;}' +
            '.axiptq-payload pre{max-height:220px;overflow:auto;background:#0F172A;color:#E2E8F0;padding:12px 14px;border-radius:10px;font-size:11px;line-height:1.5;font-family:var(--font-mono,monospace);white-space:pre-wrap;word-break:break-word;}' +
            '.axiptq-project-row{display:flex;align-items:center;gap:8px;margin-bottom:14px;}' +
            '.axiptq-project-row input{flex:1 1 auto;padding:8px 11px;border-radius:8px;border:1px solid #DDDDD5;font-size:12.5px;font-family:inherit;}' +
            '.axModal__status.status--info{display:flex;background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;}' +
            '.axiptq-spinner{width:16px;height:16px;border:2px solid #F1F1EE;border-top-color:#F28C28;border-radius:50%;animation:axiptqSpin .7s linear infinite;display:inline-block;}' +
            '@keyframes axiptqSpin{to{transform:rotate(360deg);}}' +
            '.axiptq-loading{display:flex;align-items:center;justify-content:center;gap:8px;padding:40px 14px;color:#8a97a8;font-size:12.5px;}' +
            '.axiptq-empty{padding:28px 14px;text-align:center;color:#9aa1ab;font-size:12.5px;}';
        var style = document.createElement('style');
        style.id = 'axiPtqStyles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    /* -- 13. boot -------------------------------------------------------- */
    function _ptqInit() {
        _ptqInjectStyles();
        _ptqHookMessages();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(_ptqInit, 100); });
    } else {
        setTimeout(_ptqInit, 100);
    }
})();


if (typeof window !== "undefined") { window.SandeshPushToTstruct = true; }
