// handleSend — ported verbatim from script.js (lines 6118-7122, ~1000 lines).
// Structural move only: global function -> ES module import/export, calls to
// now-local functions become local calls, calls to functions still living in
// script.js/other untouched service files stay as `window.X?.()` reads.
//
// DROPPED (confirmed dead by the extraction report, re-verified while
// reading): the `isChartRequest`/`isConversationalFollowUp` locals computed
// near the top of the original — assigned, never read anywhere in the rest
// of the function body.
//
// CONSOLIDATED: the original had a second, inline duplicate of the XLSX
// parsing logic inside this function's attachment branch, alongside the
// separate (but dead — zero callers) `parseXLSX()` function. Since
// `parseXLSX()` is unreachable dead code entangled with other dead code
// (createAssistantShell, renderTableInMessage, etc. — see
// responseParsing.js's header comment), the inline logic here is preserved
// as-is rather than redirected at it — this is the one actually-tested path.

import { state, getActiveChat, newChat, pushMessage, setBusy, saveChats } from '../store/chatStore.js';
import {
  hasRuntimeKey, withRetry, axiChatCompletion, axiChatCompletionStream, callOpenAI,
} from './transport.js';
import {
  buildProfile, buildAggregates, buildLLMPayload, buildDatasetSafetyContext,
  hydrateChatFromActiveDataBin, syncPendingDatabaseToActiveChat, clearDatasetState,
} from './datasetContext.js';
import {
  extOf, extractTextForAnalysis, buildFileContextFromText, parseDelimitedTextToRows,
  handleDatasetRowsFromFile, getPdfMetaFromContext,
} from './fileHandling.js';
import {
  sanitizeJsonString, convertNamedSectionReport, convertReportJsonToMarkdown,
  convertUnknownJsonToMarkdown, parseInlineJsonSections, tryParseDatasetJson,
} from './responseParsing.js';

// script.js:2180-2216, verbatim. Only handleSend reads this (via a
// `typeof SYSTEM_PROMPT_CHARTS !== 'undefined'` guard in the original —
// always true here since it's a real, always-defined import).
const SYSTEM_PROMPT_CHARTS = `
You are a helpful AI assistant.

CHART PROTOCOL — HOW TO EMBED CHARTS IN ANY RESPONSE:
Always embed charts as a JSON code block (using triple backticks with "json" tag), like this:

\`\`\`json
{
  "chart": {
    "type": "column",
    "title": "Clear chart title",
    "xAxis": { "categories": ["Jan", "Feb", "Mar"] },
    "series": [
      { "name": "Meaningful metric label", "data": [10, 20, 30] }
    ]
  }
}
\`\`\`

For multiple charts:
\`\`\`json
{ "charts": [ { "chart": { ... } }, { "chart": { ... } } ] }
\`\`\`

CRITICAL RULES:
- NEVER output a bare JSON object or array as the main response body.
- NEVER wrap prose, bullet points, or report sections inside JSON objects.
- Charts go INSIDE json code blocks only. All other content uses plain Markdown.
- When writing a report or analysis that includes charts, use ## Markdown headers and bullet points for all text sections. Only the chart data goes in the json code block.

Legend naming rules:
- series.name must be specific and business-meaningful.
- Never use "Series 1", "Series", "Metric", "Values", or "Data".
- Use labels like "Revenue", "Invoice Count", "Units Sold", "Cancelled Orders", "Tax Amount", or another exact metric supported by the data.
- If there is only one series, it still needs a proper name.
- Chart title and legend must not say the same vague thing.
`;

export async function handleSend() {
  const promptEl = document.getElementById('prompt');
  const text = (promptEl?.value || '').trim();

  /* BUG-2 FIX: hard block if over 2000 chars */
  if ((promptEl?.value || '').length > 2000) {
    window.toast?.('Message too long — maximum 2000 characters.', 'error', 3500);
    const ct = document.getElementById('axiCharCount');
    if (ct) { ct.style.color = '#EF4444'; ct.style.fontWeight = '700'; }
    return;
  }

  if (!getActiveChat()) newChat();
  let currentChat = getActiveChat();

  const upperText = text.toUpperCase();
  if (upperText === 'AXI CONNECT') {
    if (hasRuntimeKey()) {
      pushMessage('assistant', "✅ Already connected — your organisation's API key is active for this session.");
      return;
    }
    window.location.href = 'axi-connect.html';
    return;
  }
  if (upperText === 'AXI UPLOAD') { window.location.href = 'axi-upload.html'; return; }
  if (upperText === 'AXI ASK') { window.location.href = 'axi-ask.html'; return; }

  const attachments = state.pendingAttachments.slice();

  // Guard: prevent sending while a Data Bin is still being applied. The
  // skeleton patch hides the global loader before applyPin finishes, so
  // without this guard the user could send before ACTIVEDATABINCONTEXT and
  // ACTIVEDATABINAIPAYLOAD are ready, causing the first message to receive
  // no bin context (only stale data or nothing at all).
  if (window.IS_APPLYING_DATABIN) {
    window.toast?.('Data Bin is still loading — please wait a moment.', 'info', 2000);
    return;
  }

  if (!text && !attachments.length) return;

  let fileContext = '';
  let activeBinFileContext = '';

  if (!attachments.length && window.ACTIVEDATABINCONTEXT) {
    const binState = await hydrateChatFromActiveDataBin(currentChat);
    activeBinFileContext = binState.binFileContext || '';
  } else if (!attachments.length) {
    if (window.pendingDatabaseData && window.pendingDatabaseData.chatId !== currentChat.id) {
      const rows = window.pendingDatabaseData.data || [];

      if (rows.length > 0) {
        const profile = buildProfile(rows);
        const aggregates = buildAggregates(rows);

        currentChat.dataset = { fileName: window.pendingDatabaseData.name, profile, aggregates };
        currentChat.datasetFileName = window.pendingDatabaseData.name;
        currentChat.datasetRows = rows;
        currentChat.datasetProfile = profile;
        currentChat.datasetAggregates = aggregates;
        currentChat.fileName = window.pendingDatabaseData.name;
        currentChat.fileContext = '';
        currentChat.updatedAt = Date.now();
        saveChats();
      }

      window.pendingDatabaseData.chatId = currentChat.id;
    } else {
      syncPendingDatabaseToActiveChat(currentChat);
    }
  }

  if (attachments.length > 0) {
    const att = attachments[0];
    const file = (att instanceof File) ? att : (att.fileObj || att.file || att.blob || null);

    if (!file || !file.name) {
      fileContext = 'System: Attachment found but file object is missing.';
      if (currentChat) {
        currentChat.fileContext = fileContext;
        currentChat.fileName = 'unknown';
        currentChat.updatedAt = Date.now();
        saveChats();
      }
    } else {
      const ext = extOf(file.name);

      try {
        if (ext === 'csv') {
          if (typeof window.Papa === 'undefined') {
            throw new Error('PapaParse not loaded.');
          }

          const fullData = await file.text();
          const rows = parseDelimitedTextToRows(fullData);

          if (!rows.length) {
            throw new Error('No usable rows found in CSV file.');
          }

          await handleDatasetRowsFromFile(file, rows);
        } else if (ext === 'xlsx' || ext === 'xls') {
          if (typeof window.XLSX === 'undefined') {
            throw new Error('XLSX library not loaded.');
          }

          const buf = await file.arrayBuffer();
          const wb = window.XLSX.read(buf, { type: 'array' });
          const sheetName = wb.SheetNames?.[0];
          if (!sheetName) {
            throw new Error('No sheet found in workbook.');
          }

          const ws = wb.Sheets[sheetName];
          const json = window.XLSX.utils.sheet_to_json(ws, { defval: '' });

          const mainHeaders = Object.keys(json[0] || {}).filter((k) => !k.startsWith('__EMPTY'));
          const primaryCol = mainHeaders[0];

          const rows = json.map((r) => {
            const clean = {};
            let validMainFieldsCount = 0;

            for (const [k, v] of Object.entries(r)) {
              const key = (k || '').trim();
              const val = (v ?? '').toString().trim();

              if (!key.startsWith('__EMPTY')) {
                clean[key] = val;
                if (val !== '' && val !== '0') {
                  validMainFieldsCount++;
                }
              }
            }

            clean._isValid =
              (clean[primaryCol] && String(clean[primaryCol]).trim() !== '') ||
              (validMainFieldsCount >= 2);

            return clean;
          })
            .filter((r) => r._isValid)
            .map((r) => {
              delete r._isValid;
              return r;
            });

          if (!rows.length) {
            throw new Error('No usable rows found in workbook.');
          }

          await handleDatasetRowsFromFile(file, rows);
        } else if (ext === 'txt' || ext === 'json') {
          const fullData = await file.text();
          let rows = tryParseDatasetJson(fullData);

          if (!rows || !rows.length) {
            rows = parseDelimitedTextToRows(fullData, { strict: true });
          }

          if (rows && rows.length) {
            await handleDatasetRowsFromFile(file, rows);
          } else {
            clearDatasetState(currentChat);
            fileContext = buildFileContextFromText(file.name, fullData);

            if (currentChat) {
              currentChat.fileContext = fileContext;
              currentChat.fileName = file.name;
              currentChat.updatedAt = Date.now();
              saveChats();
            }
          }
        } else if (ext === 'pdf' || ext === 'docx') {
          clearDatasetState(currentChat);

          const fullData = await extractTextForAnalysis(file);
          fileContext = buildFileContextFromText(file.name, fullData);

          if (currentChat) {
            currentChat.fileContext = fileContext;
            currentChat.fileName = file.name;
            currentChat.updatedAt = Date.now();
            saveChats();
          }

          if (!promptEl?.value.trim()) {
            if (promptEl) {
              promptEl.value = `Analyze this file: ${file.name}`;
              promptEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
            window.__axiNotifyComposer?.();
          }
        } else {
          clearDatasetState(currentChat);

          const fullData = await extractTextForAnalysis(file);
          const MAX_CHARS = 60000;
          const clipped =
            fullData.length > MAX_CHARS
              ? fullData.slice(0, MAX_CHARS) + `\n\n[TRUNCATED: ${fullData.length - MAX_CHARS} chars omitted]`
              : fullData;

          fileContext =
            `--- SYSTEM FILE CONTENT ATTACHED ---\n` +
            `File Name: ${file.name}\n` +
            `Data Content:\n${clipped}\n` +
            `--- END FILE CONTENT ---`;

          if (currentChat) {
            currentChat.fileContext = fileContext;
            currentChat.fileName = file.name;
            currentChat.updatedAt = Date.now();
            saveChats();
          }
        }
      } catch (err) {
        console.error('Failed to read attachment:', err);
        fileContext = buildFileContextFromText(
          file.name,
          `[FILE_READ_ERROR]\nFile: ${file.name}\nReason: ${err.message}\nInstruction: Clearly inform the user that this file could not be read and suggest a remedy (e.g., re-upload as a text-based PDF or a different format).`
        );

        if (currentChat) {
          currentChat.fileContext = fileContext;
          currentChat.fileName = file.name;
          currentChat.updatedAt = Date.now();
          saveChats();
        }
      }
    }
  }

  if (!text && !attachments.length) return;

  if (!getActiveChat()) newChat();
  currentChat = getActiveChat();

  state.pendingAttachments = [];
  window.__axiNotifyComposer?.();
  if (promptEl) {
    promptEl.value = '';
    promptEl.dispatchEvent(new Event('input', { bubbles: true }));
    promptEl.style.height = 'auto';
  }

  const firstAttachmentName =
    attachments?.[0]?.name ||
    attachments?.[0]?.file?.name ||
    attachments?.[0]?.fileObj?.name ||
    attachments?.[0]?.blob?.name ||
    'attachment';

  const userContent = text || (attachments.length ? `Uploaded ${firstAttachmentName}` : '');
  pushMessage('user', userContent, false);
  setBusy(true);

  // ── Streaming assistant setup ─────────────────────────────────────────
  currentChat = getActiveChat();
  currentChat.messages.push({ role: 'assistant', content: '', markdown: true, ts: Date.now(), _streaming: true });
  currentChat.updatedAt = Date.now();
  saveChats();
  const assistantMsgIndex = currentChat.messages.length - 1;
  window.__axiNotifyThread?.(); // show the "thinking" placeholder immediately

  let firstChunkReceived = false;
  let thinkingText = '';
  const thinkingStartTime = Date.now();

  // NOTE (preserved from the original): thinkingText is never actually
  // appended to anywhere in this function — streamCallbacks below has no
  // onThinking handler, so onThinking?.() is always a no-op and
  // thinkingText.trim() is always "". The "real reasoning tokens arrived"
  // branch has therefore never been reachable; preserved as-is.
  let _renderTimer = null;
  let _latestText = '';

  function _scheduleRender(text) {
    _latestText = text;
    if (_renderTimer) return;
    _renderTimer = setTimeout(() => {
      _renderTimer = null;
      currentChat.messages[assistantMsgIndex].content = _latestText;
      window.__axiNotifyThread?.();
    }, 120);
  }

  const streamCallbacks = {
    onChunk(chunk, fullText) {
      if (!firstChunkReceived) {
        firstChunkReceived = true;
        if (thinkingText.trim()) {
          const duration = ((Date.now() - thinkingStartTime) / 1000).toFixed(1);
          currentChat.messages[assistantMsgIndex]._thinkingText = thinkingText;
          currentChat.messages[assistantMsgIndex]._thinkingDuration = duration;
        } else {
          currentChat.messages[assistantMsgIndex]._thinkingDone = true;
        }
        window.__axiNotifyThread?.();
      }
      _scheduleRender(fullText);
    },
  };

  try {
    const history = currentChat.messages
      .filter((m, i) => i !== assistantMsgIndex)
      .map((m) => ({ role: m.role, content: m.content }));

    // Keep the most-recent 20 conversational messages.
    const _AXI_MAX_CONV_MSGS = 20;
    if (history.length > _AXI_MAX_CONV_MSGS) {
      history.splice(0, history.length - _AXI_MAX_CONV_MSGS);
    }

    // Truncate large individual messages (first analysis response can be 100k+ chars).
    const _AXI_MAX_MSG_CHARS = 12000;
    history.forEach((m) => {
      if (m.content && m.content.length > _AXI_MAX_MSG_CHARS) {
        m.content = m.content.slice(0, _AXI_MAX_MSG_CHARS) + '\n[…truncated to fit context window]';
      }
    });

    // If applyPin ran before buildActiveDataBinAiPayload was ready, build it now.
    if (!window.ACTIVEDATABINAIPAYLOAD && window.ACTIVEDATABINCONTEXT && typeof window.buildActiveDataBinAiPayload === 'function') {
      try {
        window.ACTIVEDATABINAIPAYLOAD = await window.buildActiveDataBinAiPayload(window.ACTIVEDATABINCONTEXT);
      } catch (e) {
        console.warn('[AXI] on-demand payload build failed', e);
      }
    }

    const activeDataBinAiPayload =
      !attachments.length && window.ACTIVEDATABINAIPAYLOAD ? window.ACTIVEDATABINAIPAYLOAD : null;

    // Set by renderFilePills when a specific file pill is clicked.
    // Single-use: consumed here and cleared so normal sends are unaffected.
    const _chipTarget = window._axiChipFileTarget || null;
    window._axiChipFileTarget = null;

    const _allDsNames = activeDataBinAiPayload
      ? (activeDataBinAiPayload.datasources || []).map((d) => ({ key: d.meta?.sourceName || d.name || '', unit: d }))
      : [];

    const _mentionedDs = _allDsNames.length > 1
      ? _allDsNames.find((d) => d.key && new RegExp('\\b' + d.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text))
      : null;

    const _binPayload = !activeDataBinAiPayload ? null
      : (_chipTarget || _mentionedDs) ? {
        ...activeDataBinAiPayload,
        datasources: _mentionedDs
          ? [_mentionedDs.unit]
          : (_chipTarget === '__all__'
            ? []
            : (activeDataBinAiPayload.datasources || []).filter((fu) => fu.name === _chipTarget)),
        combined: null,
        files: _chipTarget
          ? (_chipTarget === '__all__'
            ? (activeDataBinAiPayload.files || [])
            : (activeDataBinAiPayload.files || []).filter((fu) => fu.name === _chipTarget))
          : (activeDataBinAiPayload.files || []),
        _fileOnly: !_mentionedDs && !!_chipTarget,
        meta: activeDataBinAiPayload.meta ? {
          ...activeDataBinAiPayload.meta,
          datasourceCount: _mentionedDs ? 1 : activeDataBinAiPayload.meta.datasourceCount,
          combinedRowCount: _mentionedDs ? (_mentionedDs.unit.rowCount || 0) : 0,
          allColumns: _mentionedDs ? (_mentionedDs.unit.columns || []) : [],
        } : activeDataBinAiPayload.meta,
      }
        : activeDataBinAiPayload;

    const effectiveFileContext = fileContext || currentChat?.fileContext || activeBinFileContext || '';

    // Shared character budget for all raw TOON / file-text chunks in this
    // request. 1 token ≈ 4 chars; 75 000 tokens * 4 = 300 000 chars.
    const _dsTotal = (_binPayload?.datasources || []).length;
    const _axiToonBudgetPerDs = _dsTotal > 1 ? Math.floor(300000 / _dsTotal) : 300000;
    let _axiToonBudget = 300000;

    if (_binPayload) {
      const binMessages = [
        {
          role: 'system',
          content: _binPayload._fileOnly
            ? (function () {
              const _fUnits = _binPayload.files || [];
              const _fList = _fUnits.map((f, i) => (i + 1) + '. ' + (f.name || 'File ' + (i + 1))).join(' | ');
              return _fUnits.length > 1
                ? `FILE ANALYSIS — CRITICAL: You are analyzing ${_fUnits.length} REAL files from the Data Bin ` +
                `"${_binPayload.meta?.name || 'Data Bin'}". ` +
                `Files present: ${_fList}. ` +
                `You MUST analyze EVERY file listed — do NOT stop after the first. ` +
                `File content is provided below as authoritative data.`
                : `FILE ANALYSIS — CRITICAL: You are analyzing a REAL file from the Data Bin ` +
                `"${_binPayload.meta?.name || 'Data Bin'}". ` +
                `The file content is provided below as authoritative data. ` +
                `Do NOT reference or include any database/datasource content in this response. ` +
                `Focus exclusively on the file(s) specified by the user.`;
            })()
            : (function () {
              const srcNames = (_binPayload.datasources || []).map((ds) => ds.meta?.sourceName || ds.name || 'unnamed');
              const srcList = srcNames.length ? srcNames.map((n, i) => (i + 1) + '. ' + n).join(' | ') : '1 source';
              return `DATA PROVENANCE — CRITICAL: You are analyzing ${srcNames.length || 1} REAL, live datasource(s) ` +
                `from the Data Bin "${_binPayload.meta?.name || 'Data Bin'}" fetched live from Axpert. ` +
                `Sources present: ${srcList}. ` +
                `Total records across all sources: ${_binPayload.meta?.combinedRowCount ?? '?'}. ` +
                `This data is NOT fabricated, estimated, or invented. ` +
                `You MUST analyze EVERY source listed above in your response — ` +
                `do not stop after the first source. ` +
                `If the user asks you to prove authenticity, state that all data was fetched live from Axpert.`;
            })(),
        },
        { role: 'system', content: 'ACTIVE DATA BIN METADATA ' + JSON.stringify(_binPayload.meta) },
        {
          role: 'system',
          content: _binPayload._fileOnly
            ? (function () {
              const _fUnits = _binPayload.files || [];
              const _fNames = _fUnits.map((f, i) => (i + 1) + '. "' + (f.name || 'File ' + (i + 1)) + '"').join('  ');
              const multiFileRule = _fUnits.length > 1
                ? 'This bin contains ' + _fUnits.length + ' files: ' + _fNames + '. ' +
                'You MUST produce a separate ## section for EACH file. Do NOT skip any. '
                : '';
              return 'FILE ANALYSIS RULES — ' + multiFileRule +
                'For EACH file section you MUST: ' +
                '(1) State what the file contains and its row/record count. ' +
                '(2) Give a concise 2-3 sentence insight from the actual content — key patterns, notable values, or findings. ' +
                '(3) If the file has numeric columns suitable for a chart, include ONE chart using the CHART PROTOCOL JSON block. ' +
                '(4) End with 1-2 bullet "Key Findings" grounded in the actual data. ' +
                'TOON blocks are authoritative raw data — use actual values. ' +
                'Never invent fields, values, or missing facts. ' +
                'If something is absent, say: Not available in the uploaded file.';
            })()
            : (function () {
              const _ds = (_binPayload.datasources || []);
              const nameList = _ds.map((d, i) => (i + 1) + '. "' + (d.meta?.sourceName || d.name || 'Source ' + (i + 1)) + '"').join('  ');
              const multiRule = _ds.length > 1
                ? 'This bin contains ' + _ds.length + ' datasources: ' + nameList + '. ' +
                'You MUST produce a separate ## section for EACH datasource. Do NOT skip any. '
                : '';
              return 'ACTIVE DATA BIN RULES — ' + multiRule +
                'For EACH datasource section you MUST: ' +
                '(1) State row count and a brief description of what the data represents. ' +
                '(2) Give a concise 2-3 sentence insight — key patterns, notable values, or anomalies from the actual rows. Do NOT just list column names. ' +
                '(3) If the data has numeric or categorical columns suitable for a chart, include ONE chart using the CHART PROTOCOL JSON block. ' +
                '(4) End with 1-2 bullet "Key Findings" grounded in the actual data. ' +
                'After all datasource sections, add a ## Summary section with cross-source observations if relevant. ' +
                'TOON blocks are the authoritative raw data — use actual values, not column names. ' +
                'Never invent values. If a value is absent, say: Not available in the data.';
            })(),
        },
      ];

      // Only inject combined summary for single-source bins. With multiple
      // sources it collapses all data into one blob and the AI treats it as
      // the sole dataset, ignoring the per-source blocks below.
      const _dsCount = (_binPayload.datasources || []).length;
      if (_binPayload.combined?.llmPayload && _dsCount <= 1) {
        binMessages.push({
          role: 'system',
          content: 'ACTIVE DATA BIN COMBINED SUMMARY ' + JSON.stringify(_binPayload.combined.llmPayload),
        });
      }

      (_binPayload.datasources || []).forEach((ds) => {
        binMessages.push({
          role: 'system',
          content: 'DATA BIN DATASOURCE SUMMARY ' + JSON.stringify({
            name: ds.meta?.sourceName || ds.name,
            caption: ds.meta?.sourceCaption || ds.name,
            rowCount: ds.rowCount,
            columns: ds.columns,
          }),
        });

        let _dsToonBudget = _axiToonBudgetPerDs;
        (ds.toonChunks || []).forEach((chunk, idx) => {
          if (_dsToonBudget <= 0) return;
          const msg = 'DATA BIN DATASOURCE TOON [' + String(ds.meta?.sourceName || ds.name) + '] chunk ' + (idx + 1) + '/' + ds.toonChunks.length + '\n' + chunk;
          binMessages.push({ role: 'system', content: msg });
          _dsToonBudget -= msg.length;
          _axiToonBudget -= msg.length;
        });
      });

      (_binPayload.files || []).forEach((fileUnit) => {
        if (fileUnit.kind === 'dataset') {
          binMessages.push({
            role: 'system',
            content: 'DATA BIN FILE DATASET SUMMARY ' + JSON.stringify({
              name: fileUnit.name,
              fileType: fileUnit.meta?.fileType || fileUnit.fileType || '',
              rowCount: fileUnit.rowCount,
              columns: fileUnit.columns,
              llmPayload: fileUnit.llmPayload || null,
            }),
          });

          (fileUnit.toonChunks || []).forEach((chunk, idx) => {
            if (_axiToonBudget <= 0) return;
            const msg = 'DATA BIN FILE TOON [' + String(fileUnit.name) + '] chunk ' + (idx + 1) + '/' + fileUnit.toonChunks.length + '\n' + chunk;
            binMessages.push({ role: 'system', content: msg });
            _axiToonBudget -= msg.length;
          });

          return;
        }

        (fileUnit.textChunks || []).forEach((chunk, idx) => {
          if (_axiToonBudget <= 0) return;
          const msg = 'DATA BIN FILE TEXT [' + String(fileUnit.name) + '] chunk ' + (idx + 1) + '/' + fileUnit.textChunks.length + '\n' + chunk;
          binMessages.push({ role: 'system', content: msg });
          _axiToonBudget -= msg.length;
        });
      });

      history.unshift(...binMessages);
      if (activeDataBinAiPayload && (_binPayload.datasources || []).length > 1) {
        const _dsNames = (_binPayload.datasources || []).map((d) => d.meta?.sourceName || d.name || 'Unnamed');
        history.push({
          role: 'system',
          content: 'MANDATORY RESPONSE FORMAT — Your response is INCOMPLETE unless it contains ' +
            'ALL of the following sections in this exact order:\n' +
            _dsNames.map((n, i) => '## ' + (i + 1) + '. ' + n).join('\n') + '\n' +
            '## Summary\n\n' +
            'Each section MUST contain: a 2-3 sentence insight from actual data values, ' +
            'at least one key finding, and a chart if numeric data is available. ' +
            'Do NOT merge sections. Do NOT omit any section. ' +
            'A response covering only ' + _dsNames[0] + ' is WRONG.',
        });
      }

      if (_binPayload._fileOnly && (_binPayload.files || []).length > 1) {
        const _fNames = (_binPayload.files || []).map((f, i) => '## ' + (i + 1) + '. ' + (f.name || 'File ' + (i + 1)));
        history.push({
          role: 'system',
          content: 'MANDATORY RESPONSE FORMAT — Your response is INCOMPLETE unless it contains ' +
            'ALL of the following sections in this exact order:\n' +
            _fNames.join('\n') + '\n' +
            '## Summary\n\n' +
            'Each section MUST contain: a 2-3 sentence insight from actual file content, ' +
            'at least one key finding, and a chart if numeric data is available. ' +
            'Do NOT merge sections. Do NOT omit any file. ' +
            'A response covering only ' + (_binPayload.files[0]?.name || 'the first file') + ' is WRONG.',
        });
      }
    }

    const activeFileName = String(currentChat?.fileName || firstAttachmentName || '');
    const activeExt = extOf(activeFileName);
    const isDocumentFile = activeExt === 'pdf' || activeExt === 'docx';

    if (isDocumentFile) {
      history.unshift({
        role: 'system',
        content:
          'DOCUMENT METADATA:\n' +
          JSON.stringify({
            fileName: activeFileName,
            fileType: activeExt,
            extractedPageCount: activeExt === 'pdf'
              ? getPdfMetaFromContext(activeFileName, effectiveFileContext).extractedPageCount
              : null,
          }),
      });

      history.unshift({
        role: 'system',
        content: [
          'DOCUMENT REPORT PROTOCOL (CRITICAL)',
          'Return a polished markdown report using exactly these sections:',
          '## Executive Summary',
          '## Document Overview',
          '## Key Findings',
          '## Extracted Data',
          '## Recommendations',
          '## Data Confidence',
          '',
          'Rules:',
          '- Use only the document text already provided in FILE CONTEXT.',
          "- If the FILE CONTEXT contains a '[PDF_EXTRACTION_NOTICE]' or a read-error message, clearly explain the situation to the user (e.g., scanned PDF, no selectable text) and suggest corrective action. Otherwise, do not claim you cannot access the file — the extracted text is already present in FILE CONTEXT.",
          '- Treat DOCX and PDF the same way for analysis.',
          '- In Document Overview, mention the file type and page count if available.',
          '- In Key Findings, give concrete insights grounded in the extracted text.',
          '- In Extracted Data, include a markdown table with exactly 2 columns: Field | Value.',
          '- Prefer exact dates, names, amounts, counts, totals, headings, and section names when present.',
          '- If a value is not present, say: Not available in the uploaded file/data.',
          '- If the document contains enough numeric or category data, include 1 or 2 charts using the existing CHART PROTOCOL JSON code block.',
          '- If the document is mostly narrative and a chart is not justified, do not invent one.',
          '- Keep the response concise, analytical, and grounded.',
        ].join('\n'),
      });
    }

    const hasDatasetContext =
      !effectiveFileContext &&
      !activeDataBinAiPayload &&
      (
        (window.pendingDatabaseData && Array.isArray(window.pendingDatabaseData.data) && window.pendingDatabaseData.data.length) ||
        (Array.isArray(currentChat?.datasetRows) && currentChat.datasetRows.length)
      );
    const allowedCols = hasDatasetContext
      ? (
        (currentChat?.datasetProfile?.columns && Array.isArray(currentChat.datasetProfile.columns))
          ? currentChat.datasetProfile.columns.map(String)
          : (Array.isArray(currentChat?.datasetRows) && currentChat.datasetRows.length)
            ? Object.keys(currentChat.datasetRows[0] || {}).map(String)
            : []
      )
      : [];

    if (hasDatasetContext && allowedCols.length) {
      history.unshift({
        role: 'system',
        content:
          `ALLOWED_COLUMNS (exact):\n` +
          `${allowedCols.join(', ')}\n\n` +
          `Rules:\n` +
          `- When you mention any column/field from the dataset, you MUST wrap the exact column name in backticks, like \`ColumnName\`.\n` +
          `- You are NOT allowed to invent or infer new columns.\n` +
          `- If the user asks for something requiring a column not in ALLOWED_COLUMNS, say: "Not available in the uploaded file/data."`,
      });
    }

    if (hasDatasetContext && Array.isArray(currentChat?.datasetRows) && currentChat.datasetRows.length) {
      const profile = currentChat.datasetProfile || buildProfile(currentChat.datasetRows);
      const aggregates = currentChat.datasetAggregates || buildAggregates(currentChat.datasetRows);
      const payload = buildLLMPayload(currentChat.datasetFileName || 'dataset', currentChat.datasetRows, profile, aggregates);

      history.unshift({
        role: 'system',
        content: 'DATASET SAFETY:\n' + JSON.stringify(buildDatasetSafetyContext(currentChat.datasetRows, profile)),
      });

      history.unshift({
        role: 'system',
        content: 'DATASET PAYLOAD (schema, aggregates, sampleRows):\n' + JSON.stringify(payload),
      });
    }

    if (effectiveFileContext) {
      history.unshift({ role: 'system', content: effectiveFileContext });
    }

    history.unshift({ role: 'system', content: SYSTEM_PROMPT_CHARTS });

    // UNIVERSAL FOLLOW-UP DETECTION: history[0] is the current question. If
    // history.length > 1, this is a follow-up!
    const isFollowUp = history.length > 1;

    if (!isFollowUp) {
      history.unshift({
        role: 'system',
        content: `You MUST answer only using the provided FILE/DATASET CONTEXT. If the answer is not in the context, say "Not available in the uploaded file/data." Do not guess or invent values.`.trim(),
      });
    } else {
      history.unshift({
        role: 'system',
        content: `You are engaging in a continuous data conversation. You MUST use the conversation history to answer questions, explain charts, and discuss trends. Do NOT say "Not available" if the information can be deduced from the chat history or previous JSON charts you generated.`.trim(),
      });
    }

    const previousPendingDatabaseData = window.pendingDatabaseData;
    const usingActiveDataBin = !!activeDataBinAiPayload;

    if (usingActiveDataBin) {
      window.pendingDatabaseData = null;
    }

    let rawAnswer;
    try {
      if (usingActiveDataBin) {
        // Bypass callOpenAI — it has its own pipeline that rebuilds messages
        // from pendingDatabaseData and ignores our bin context entirely.
        if (typeof streamCallbacks?.onChunk === 'function') {
          rawAnswer = await withRetry(() => axiChatCompletionStream({
            messages: history,
            temperature: 0.3,
            maxtokens: 4000,
            onChunk: streamCallbacks.onChunk,
            onThinking: streamCallbacks?.onThinking,
          }));
        } else {
          rawAnswer = await withRetry(() => axiChatCompletion({ messages: history, temperature: 0.3, max_tokens: 4000 }));
        }
      } else {
        rawAnswer = await callOpenAI(history, null, streamCallbacks);
      }
    } finally {
      if (usingActiveDataBin) {
        window.pendingDatabaseData = previousPendingDatabaseData;
      }
    }

    // Cancel any pending debounced render — the final persist step below
    // sets .content directly, superseding it.
    if (_renderTimer) { clearTimeout(_renderTimer); _renderTimer = null; }

    const answer = (typeof rawAnswer === 'string') ? rawAnswer : JSON.stringify(rawAnswer || 'No response received.');

    let finalContent = answer;
    let chartDataList = [];

    const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/gi;
    let match;
    while ((match = jsonBlockRegex.exec(answer)) !== null) {
      try {
        const jsonStr = match[1];
        let parsed;
        try {
          parsed = JSON.parse(jsonStr);
        } catch (e) {
          parsed = JSON.parse(sanitizeJsonString(jsonStr));
        }
        if (parsed.chart) chartDataList.push(parsed.chart);
        else if (parsed.charts && Array.isArray(parsed.charts)) {
          parsed.charts.forEach((item) => chartDataList.push(item.chart || item));
        }
        finalContent = finalContent.replace(match[0], '');
      } catch (e) { /* leave this block untouched */ }
    }

    // PATCH: handle "Report\nDASHBOARD\nCharts: [{chart:{...}, summary:"..."}]" format
    if (chartDataList.length === 0 && /Charts\s*:/i.test(answer)) {
      try {
        const dashMatch = answer.match(/Charts\s*:\s*(\[[\s\S]*\])/i);
        if (dashMatch) {
          const items = JSON.parse(dashMatch[1]);
          if (Array.isArray(items)) {
            items.forEach((item) => {
              const spec = item.chart || item;
              if (spec && spec.type) {
                if (item.summary) spec._summary = item.summary;
                chartDataList.push(spec);
              }
            });
            finalContent = finalContent
              .replace(/^Report\s*[\r\n]*/i, '')
              .replace(/^DASHBOARD\s*[\r\n]*/i, '')
              .replace(/Charts\s*:\s*\[[\s\S]*\]/i, '')
              .trim();
            if (!finalContent) finalContent = '## 📊 Dashboard';
          }
        }
      } catch (e) { /* malformed – leave as-is */ }
    }

    // PATCH: handle "Section Name: {JSON}" inline format from template responses
    {
      const inlineParsed = parseInlineJsonSections(finalContent);
      if (inlineParsed && inlineParsed.markdown) {
        finalContent = inlineParsed.markdown;
        chartDataList.push(...inlineParsed.charts);
      }
    }

    if (chartDataList.length === 0 && answer.trim().startsWith('{')) {
      let parsed = null;
      try {
        parsed = JSON.parse(answer);
      } catch (e) {
        try { parsed = JSON.parse(sanitizeJsonString(answer)); } catch (e2) { /* give up */ }
      }

      if (parsed) {
        const reportContent = parsed.report || parsed;
        const looksLikeNamedSection = Object.keys(reportContent).some((k) => /overview|findings|anomal|risk|recommendation/i.test(k));

        if (looksLikeNamedSection) {
          const result = convertNamedSectionReport(parsed);
          if (result) {
            finalContent = result.markdown;
            chartDataList.push(...result.charts);
          }
        } else if (reportContent.summary || reportContent.insights || (reportContent.recommendations && !reportContent.chart && !reportContent.charts)) {
          const reportMarkdown = convertReportJsonToMarkdown(parsed);
          if (reportMarkdown) {
            finalContent = reportMarkdown;
            if (reportContent.charts && Array.isArray(reportContent.charts)) {
              reportContent.charts.forEach((item) => {
                if (item.chart) chartDataList.push(item.chart);
                else if (item.type) chartDataList.push(item);
              });
            }
          }
        } else if (parsed.chart || parsed.charts) {
          if (parsed.chart) chartDataList.push(parsed.chart);
          else if (parsed.charts) chartDataList.push(...parsed.charts.map((c) => c.chart || c));
          finalContent = `**Analysis Complete**\n\nGenerated ${chartDataList.length} chart(s).`;
        } else {
          const unknownMarkdown = convertUnknownJsonToMarkdown(parsed);
          if (unknownMarkdown) {
            finalContent = unknownMarkdown;
          }
        }
      }
    }

    // Also check for JSON anywhere in the response (not just at start)
    if (!finalContent || finalContent === answer) {
      const jsonMatch = answer.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          const reportContent = parsed.report || parsed;
          if (reportContent.summary || reportContent.insights || reportContent.recommendations) {
            const reportMarkdown = convertReportJsonToMarkdown(parsed);
            if (reportMarkdown) {
              finalContent = reportMarkdown;
            }
          }
        } catch (e) { /* leave as-is */ }
      }
    }

    // Strip any leading "Report\n" or "DASHBOARD\n" lines the AI may prepend (handle multiple)
    finalContent = finalContent.replace(/^(?:(?:Report|DASHBOARD)\s*[\r\n]+)+/gi, '').trim();

    // Last-resort: if content still has "SectionName: {json}" lines, convert them
    if (/^[\*\-]?\s*[A-Za-z][\w\s&]+:\s*[{\[]/m.test(finalContent)) {
      const lastResort = parseInlineJsonSections(finalContent);
      if (lastResort && lastResort.markdown) {
        finalContent = lastResort.markdown;
        chartDataList.push(...lastResort.charts);
      }
    }

    finalContent = finalContent.trim();

    currentChat.messages[assistantMsgIndex].content = finalContent;
    currentChat.messages[assistantMsgIndex].markdown = true;
    currentChat.messages[assistantMsgIndex].ts = Date.now();
    delete currentChat.messages[assistantMsgIndex]._streaming;
    if (chartDataList.length > 0) {
      currentChat.messages[assistantMsgIndex].chartSpecs = chartDataList;
    }

    saveChats();

    // DEFERRED (known gap, preserved from the original): the 150ms-later
    // follow-up-suggestions/report-actions injection is implemented
    // independently in the React message-thread bundle (follow-ups) and via
    // the injectMessageActions MutationObserver (report actions) — not
    // triggered from here, matching the original's own deferred-work note.
    window.__axiNotifyThread?.();

    window.scrollToBottom?.(true);
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollToBottom?.(true)));
  } catch (err) {
    console.error('HandleSend Error:', err);
    const errMsg = `Error: ${err.message}`;
    currentChat.messages[assistantMsgIndex].content = errMsg;
    currentChat.messages[assistantMsgIndex]._error = true;
    delete currentChat.messages[assistantMsgIndex]._streaming;
    saveChats();
    window.__axiNotifyThread?.();
    window.scrollToBottom?.(true);
  } finally {
    setBusy(false);
    window.syncComposerButtons?.();
  }
}

window.handleSend = handleSend;
