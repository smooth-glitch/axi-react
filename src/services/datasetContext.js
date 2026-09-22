// Dataset / Data-Bin context building — ported verbatim from script.js
// (lines ~918-2350, 4801-4930, 5508-6030). Structural move only.
//
// window.buildActiveDataBinAiPayload (script.js:6032) is NOT ported here —
// per the migration plan it stays defined in script.js's remaining shell
// (it conceptually belongs with axi-databin-services.js and is called from
// many places by that global name); this module still calls it as
// `window.buildActiveDataBinAiPayload` where the original did.

import { extOf, buildFileContextFromText, extractTextForAnalysis, readFileAsText, parseDelimitedTextToRows } from './fileHandling.js';
import { tryParseDatasetJson } from './responseParsing.js';
import { getActiveChat, saveChats } from '../store/chatStore.js';

// ── Column/profile helpers ────────────────────────────────────────────────
export function normalizeRow(r) {
  const clean = {};
  let hasData = false;

  for (const [k, v] of Object.entries(r)) {
    const key = (k || '').trim();
    const val = (v ?? '').toString().trim();
    if (!key.startsWith('__EMPTY')) {
      clean[key] = val;
      if (val !== '' && val !== '0') hasData = true;
    }
  }

  if (clean.noofpile !== undefined) {
    const n = parseInt(clean.noofpile, 10);
    clean.noofpile = Number.isFinite(n) ? n : null;
  }

  Object.defineProperty(clean, '_hasData', { value: hasData, enumerable: false, writable: true });
  return clean;
}

export function buildProfile(rows) {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const blanks = {};
  for (const c of columns) blanks[c] = 0;

  for (const r of rows) {
    for (const c of columns) {
      const v = r[c];
      if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) blanks[c]++;
    }
  }

  const totalCells = rows.length * columns.length || 1;
  const missingCells = Object.values(blanks).reduce((s, v) => s + v, 0);
  const missingRatio = missingCells / totalCells;

  return { rowCount: rows.length, columns, blanks, missingRatio };
}

export function countBy(rows, field) {
  const out = {};
  for (const r of rows) {
    const key = (r[field] ?? '').toString().trim() || '(blank)';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

export function buildAggregates(rows) {
  if (!rows || !rows.length) return {};
  const aggregates = {};

  const detectionSample = rows.length > 500 ? rows.slice(0, 500) : rows;
  const keys = Object.keys(detectionSample[0] || {});

  keys.forEach((key) => {
    let uniqueValues = new Set();
    let isCategory = true;
    let isNumeric = true;

    for (let row of detectionSample) {
      const val = row[key];
      if (val !== null && val !== undefined && String(val).trim() !== '') {
        uniqueValues.add(val);
        if (isNaN(parseFloat(val))) isNumeric = false;
      }
      if (uniqueValues.size > 100 && !isNumeric) {
        isCategory = false;
        break;
      }
    }

    if (isCategory && uniqueValues.size > 0 && uniqueValues.size < detectionSample.length) {
      aggregates[key] = { type: 'categorical', counts: countBy(rows, key) };
    }

    if (isNumeric && uniqueValues.size > 0) {
      let total = 0, count = 0;
      let min = Infinity, max = -Infinity;
      rows.forEach((r) => {
        const v = parseFloat(r[key]);
        if (!isNaN(v)) {
          total += v;
          count++;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      });
      if (count > 0) {
        aggregates[key] = {
          type: 'numeric',
          sum: parseFloat(total.toFixed(2)),
          avg: parseFloat((total / count).toFixed(2)),
          min: min === Infinity ? null : min,
          max: max === -Infinity ? null : max,
          count,
        };
      }
    }
  });
  return aggregates;
}

export function topN(obj, n = 8) {
  return Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, n);
}

export function pickExistingColumns(columns, candidates) {
  const byLower = new Map((columns || []).map((col) => [String(col).toLowerCase(), String(col)]));
  return (candidates || []).map((c) => byLower.get(String(c).toLowerCase())).filter(Boolean);
}

// ── Dataset safety context (anti-hallucination guardrails) ───────────────
export function buildDatasetSafetyContext(rows, profile) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const columns = Array.isArray(profile?.columns) ? profile.columns.map(String) : [];

  const idColumns = pickExistingColumns(columns, [
    'empid', 'employeeid', 'employee_id', 'staffid', 'staff_id', 'userid', 'user_id', 'code',
  ]);
  const nameColumns = pickExistingColumns(columns, [
    'firstname', 'lastname', 'fullname', 'full_name', 'name', 'employee_name', 'staff_name',
  ]);
  const genderColumns = pickExistingColumns(columns, [
    'gender', 'sex', 'employee_gender', 'gendername', 'gender_name', 'empgender', 'emp_gender', 'm/f',
  ]);
  const roleColumns = pickExistingColumns(columns, [
    'designation', 'role', 'title', 'jobtitle', 'job_title', 'position', 'employee_role',
  ]);
  const departmentColumns = pickExistingColumns(columns, [
    'department', 'dept', 'division', 'team', 'costcenter', 'cost_center',
  ]);
  const locationColumns = pickExistingColumns(columns, [
    'locationname', 'location', 'branchname', 'branch', 'city', 'state', 'region',
  ]);

  const isPeopleDataset =
    idColumns.length > 0 || nameColumns.length > 0 || genderColumns.length > 0 || roleColumns.length > 0;

  const identityColumns = [
    ...new Set([...idColumns, ...nameColumns, ...genderColumns, ...roleColumns, ...departmentColumns, ...locationColumns]),
  ];

  const sampleIdentityRows = safeRows
    .slice(0, 25)
    .map((row) => {
      const out = {};
      identityColumns.forEach((col) => {
        const val = row?.[col];
        if (val !== null && val !== undefined && String(val).trim() !== '') {
          out[col] = String(val).trim();
        }
      });
      return out;
    })
    .filter((obj) => Object.keys(obj).length > 0);

  return {
    datasetType: isPeopleDataset ? 'people_or_payroll' : 'generic',
    isPeopleDataset,
    identityColumns: { idColumns, nameColumns, genderColumns, roleColumns, departmentColumns, locationColumns },
    rules: isPeopleDataset
      ? [
        "Never infer gender, pronouns, title, role, seniority, department, or relationship from a person's name.",
        'Use only explicit column values present in the dataset.',
        'For single-person statements, use the exact name value or neutral terms like employee/person/record.',
        'Only mention gender when an explicit gender column exists and the exact row value is present.',
        'Only mention role or title when an explicit role/title column exists and use the exact stored cell value.',
        'If a value is missing, conflicting, or not explicit, say Not available in provided data or flag it as a data quality issue.',
      ]
      : ['Use only explicit values from the dataset.', 'Do not infer missing facts.'],
    sampleIdentityRows,
  };
}

// ── AI payload builders ───────────────────────────────────────────────────
export function buildDatasetPayload(fileName, rows, profile, aggregates) {
  const sampleRows = rows.slice(0, 50);
  return {
    fileName,
    schema: { rowCount: profile.rowCount, columns: profile.columns, missingRatio: profile.missingRatio },
    aggregates,
    sampleRows,
  };
}

export function buildChartPayload(fileName, rows, profile, aggregates) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeProfile = profile || buildProfile(safeRows);
  const rawAggregates = aggregates || buildAggregates(safeRows);
  const safety = buildDatasetSafetyContext(safeRows, safeProfile);

  const chartAggregates = {};
  Object.entries(rawAggregates).forEach(([col, agg]) => {
    const item = { type: agg.type };
    if (agg.type === 'numeric') {
      item.min = agg.min;
      item.max = agg.max;
      item.avg = agg.avg;
      if (typeof agg.sum !== 'undefined') item.sum = agg.sum;
    }
    if (agg.counts) {
      const top = Object.entries(agg.counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
      if (top.length) {
        item.counts = Object.fromEntries(top);
        item.uniqueCount = Object.keys(agg.counts).length;
      }
    }
    if (item.type === 'numeric' || item.counts) chartAggregates[col] = item;
  });

  return {
    fileName,
    schema: { rowCount: safeProfile.rowCount, columns: safeProfile.columns },
    safety: {
      isPeopleDataset: !!safety.isPeopleDataset,
      genderColumns: safety.genderColumns || [],
      roleColumns: safety.roleColumns || [],
      departmentColumns: safety.departmentColumns || [],
      locationColumns: safety.locationColumns || [],
    },
    aggregates: chartAggregates,
  };
}

export function buildLLMPayload(fileName, rows, profile, aggregates) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeProfile = profile || buildProfile(safeRows);
  const rawAggregates = aggregates || buildAggregates(safeRows);

  const safeAggregates = {};
  Object.keys(rawAggregates).forEach((col) => {
    const aggData = rawAggregates[col];
    if (!aggData || typeof aggData !== 'object') return;

    const colSummary = { type: aggData.type };
    if (aggData.type === 'numeric') {
      colSummary.sum = aggData.sum;
      colSummary.avg = aggData.avg;
      colSummary.min = aggData.min;
      colSummary.max = aggData.max;
      colSummary.count = aggData.count;
    }
    if (aggData.counts) {
      const uniqueCount = Object.keys(aggData.counts).length;
      colSummary.uniqueCount = uniqueCount;
      if (uniqueCount <= 100) {
        colSummary.counts = aggData.counts;
      } else {
        const top20 = Object.entries(aggData.counts).sort((a, b) => b[1] - a[1]).slice(0, 20);
        if (top20.length) {
          colSummary.counts = Object.fromEntries(top20);
          colSummary.note = `Top 20 of ${uniqueCount} unique values shown`;
        }
      }
    }
    safeAggregates[col] = colSummary;
  });

  const sample = safeRows.slice(0, 50);
  const safety = buildDatasetSafetyContext(safeRows, safeProfile);

  return {
    fileName,
    schema: { rowCount: safeProfile.rowCount, columns: safeProfile.columns, missingRatio: safeProfile.missingRatio },
    aggregates: safeAggregates,
    safety,
    sampleRows: sample,
  };
}

export function buildDbAnalysisPrompt(dbName, rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const rowCount = safeRows.length;
  const MAX_ROWS_TO_SEND = 200;
  const sample = safeRows.slice(0, MAX_ROWS_TO_SEND);
  const columns = rowCount ? Object.keys(sample[0] || {}) : [];

  return (
    `Analyze this database: ${dbName}

  Rules:
  - Only use the provided JSON data below.
  - If a value/column is not present, say "Not available in provided data".
  - Start by stating: rowCount, columns.

  rowCount: ${rowCount}
  columns: ${JSON.stringify(columns)}

  JSON DATA (first ${sample.length} rows):
  ${JSON.stringify(sample)}`
  );
}

export function jsonToToon(rows) {
  if (!Array.isArray(rows) || !rows.length) return '';
  const keys = Object.keys(rows[0]);
  let result = keys.join(' | ') + '\n';
  for (const row of rows) {
    result += keys.map((k) => {
      const val = row[k];
      let strVal = String(val !== null && val !== undefined ? val : '');
      return strVal.replace(/\n/g, ' ');
    }).join(' | ') + '\n';
  }
  return result;
}

export function findBestMatchingRow(rows, query) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const q = String(query || '').toLowerCase().trim();
  if (!q) return null;

  for (const row of rows) {
    const empid = String(row?.empid || '').toLowerCase().trim();
    if (empid && q.includes(empid)) return row;
  }

  const matches = rows.filter((row) => {
    const name = String(row?.firstname || '').toLowerCase().trim();
    return name && q.includes(name);
  });

  if (matches.length === 1) return matches[0];
  return null;
}

export function generateLocalReportMarkdown(datasetName, rows) {
  const profile = buildProfile(rows);
  const aggregates = buildAggregates(rows);
  const sections = [];

  sections.push(`## Executive Summary
Rows: ${profile.rowCount.toLocaleString()}
Columns: ${profile.columns.length}
Missing cells: ${(profile.missingRatio * 100).toFixed(1)}%`);

  const numericLines = Object.entries(aggregates)
    .filter(([, v]) => v && v.type === 'numeric')
    .slice(0, 6)
    .map(([k, v]) => `- ${k}: total ${Number(v.sum).toLocaleString()}, average ${Number(v.avg).toLocaleString()}`);

  if (numericLines.length) {
    sections.push(`## Numeric Metrics
${numericLines.join('\n')}`);
  }

  const categoricalLines = Object.entries(aggregates)
    .filter(([, v]) => v && v.type === 'categorical')
    .slice(0, 5)
    .map(([k, v]) => {
      const top = Object.entries(v.counts || {}).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([label, count]) => `${label}: ${count}`).join(', ');
      return `- ${k}: ${top || 'No dominant values'}`;
    });

  if (categoricalLines.length) {
    sections.push(`## Category Highlights
${categoricalLines.join('\n')}`);
  }

  const trend = aggregates.__monthlyTrend?.values || null;
  if (trend && Object.keys(trend).length) {
    const trendLines = Object.entries(trend).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, value]) => `- ${month}: ${Number(value).toLocaleString()}`);
    sections.push(`## Time Trend
${trendLines.join('\n')}`);
  }

  sections.push(`## Notes
This report was generated locally because the AI request exceeded the model context window.`);

  return `# ${datasetName || 'Dataset'} – Report

${sections.join('\n\n')}`;
}

// ── Chunking ───────────────────────────────────────────────────────────────
export function splitPlainTextForAi(text, maxChars = 12000) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  if (raw.length <= maxChars) return [raw];

  const out = [];
  for (let i = 0; i < raw.length; i += maxChars) {
    out.push(raw.slice(i, i + maxChars));
  }
  return out;
}

export function splitToonForAi(toon, maxChars = 12000) {
  const raw = String(toon || '').trim();
  if (!raw) return [];

  const lines = raw.split(/\r?\n/);
  if (lines.length <= 1) return splitPlainTextForAi(raw, maxChars);

  const header = lines[0];
  const chunks = [];
  let current = header;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const next = current + '\n' + line;

    if (next.length > maxChars && current !== header) {
      chunks.push(current);
      current = header + '\n' + line;
      continue;
    }

    if (next.length > maxChars) {
      const pieces = splitPlainTextForAi(line, Math.max(2000, maxChars - header.length - 1));
      pieces.forEach((piece) => chunks.push(header + '\n' + piece));
      current = header;
      continue;
    }

    current = next;
  }

  if (current && current !== header) chunks.push(current);
  return chunks.length ? chunks : [header];
}

// ── AI payload units (datasource / file) ──────────────────────────────────
export function buildAiDatasetUnit(name, rows, meta) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const profile = buildProfile(safeRows);
  const aggregates = buildAggregates(safeRows);
  const llmPayload = buildLLMPayload(name, safeRows, profile, aggregates);
  const toon = jsonToToon(safeRows);

  return {
    kind: 'dataset',
    name: name || 'Dataset',
    rowCount: safeRows.length,
    columns: Array.isArray(profile?.columns) ? profile.columns : (safeRows[0] ? Object.keys(safeRows[0]) : []),
    llmPayload: llmPayload || null,
    toonChunks: splitToonForAi(toon),
    meta: meta || {},
  };
}

export async function getDatasetRowsForAiFromFile(file) {
  const ext = extOf(file.name);

  // DataBin "files" are plain objects, not real File/Blob instances — use
  // this helper so both cases work.
  const getText = async () => {
    if (typeof file.text === 'function') return file.text();
    if (typeof file.content === 'string') return file.content;
    if (typeof file.rawText === 'string') return file.rawText;
    if (typeof file.data === 'string') return file.data;
    throw new TypeError('No readable text content on file object: ' + file.name);
  };
  const getBuffer = async () => {
    if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    throw new TypeError('No arrayBuffer on file object: ' + file.name);
  };

  if (ext === 'csv') {
    const raw = await getText();
    return parseDelimitedTextToRows(raw, { strict: true }) || [];
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const buf = await getBuffer();
    const wb = window.XLSX.read(buf, { type: 'array' });
    const rows = [];
    (wb.SheetNames || []).forEach((sheetName) => {
      const ws = wb.Sheets[sheetName];
      const json = ws ? window.XLSX.utils.sheet_to_json(ws, { defval: '' }) : [];
      json.forEach((row) => {
        const base = normalizeRow(row);
        const enriched = Object.assign({ __sheet: sheetName }, base);
        const hasData = Object.values(enriched).some((v) => String(v ?? '').trim() !== '');
        if (hasData) rows.push(enriched);
      });
    });
    return rows;
  }

  if (ext === 'json') {
    const raw = await getText();
    return tryParseDatasetJson(raw) || [];
  }

  if (ext === 'txt') {
    const raw = await getText();
    return tryParseDatasetJson(raw) || parseDelimitedTextToRows(raw, { strict: true }) || [];
  }

  return [];
}

export async function buildAiFileUnit(file) {
  const ext = extOf(file.name);

  const hasContent = typeof file.text === 'function' || typeof file.arrayBuffer === 'function';
  if (!hasContent) {
    const notice =
      `[FILE_CONTENT_UNAVAILABLE]\n` +
      `File: ${file.name}\n` +
      `Status: Content not accessible. The Data Bin stores file metadata only.\n` +
      `Instruction: The user must upload "${file.name}" directly in the chat ` +
      `(attachment button or drag-and-drop) for AI analysis.`;
    return {
      kind: 'document',
      name: file.name,
      fileType: ext,
      textChunks: splitPlainTextForAi(buildFileContextFromText(file.name, notice)),
      meta: { origin: 'file', contentUnavailable: true },
    };
  }

  const rows = await getDatasetRowsForAiFromFile(file);

  if (Array.isArray(rows) && rows.length) {
    return buildAiDatasetUnit(file.name, rows, { origin: 'file', fileType: ext });
  }

  let raw = '';
  if (ext === 'pdf' || ext === 'docx') raw = await extractTextForAnalysis(file);
  else if (ext === 'txt' || ext === 'json') raw = await file.text();
  else raw = await readFileAsText(file);

  const fileContext = buildFileContextFromText(file.name, raw);

  return {
    kind: 'document',
    name: file.name,
    fileType: ext,
    textChunks: splitPlainTextForAi(fileContext),
    meta: { origin: 'file' },
  };
}

// ── Chat/dataset state sync ────────────────────────────────────────────────
export function clearDatasetState(chat = getActiveChat(), options = {}) {
  const { clearFileContext = false } = options;
  if (chat) {
    chat.dataset = null;
    chat.datasetFileName = null;
    chat.datasetRows = null;
    chat.datasetProfile = null;
    chat.datasetAggregates = null;
    if (clearFileContext) {
      chat.fileContext = null;
      chat.fileName = null;
    }
    chat.updatedAt = Date.now();
    saveChats();
  }
  window.pendingDatabaseData = null;
}

export function syncPendingDatabaseToActiveChat(chat = getActiveChat()) {
  if (chat && Array.isArray(chat.datasetRows) && chat.datasetRows.length) {
    window.pendingDatabaseData = {
      name: chat.datasetFileName || chat.fileName || 'dataset',
      data: chat.datasetRows,
      chatId: chat.id,
    };
    return;
  }
  window.pendingDatabaseData = null;
}

export async function hydrateChatFromActiveDataBin(currentChat) {
  const context = window.ACTIVEDATABINCONTEXT;
  if (!context || !currentChat) return { binFileContext: '', usedBin: false };

  let binFileContext = '';
  const files = Array.isArray(context.files) ? context.files : [];
  const combinedRows = Array.isArray(context.combinedDatabaseRows) ? context.combinedDatabaseRows : [];

  let preferredDataset = null;

  for (const file of files) {
    const hasContent = typeof file.text === 'function'
      || typeof file.arrayBuffer === 'function'
      || typeof file.content === 'string'
      || typeof file.rawText === 'string'
      || typeof file.data === 'string';
    if (!hasContent) {
      console.info('[AXI DataBin] Skipping content-less file entry:', file?.name);
      continue;
    }
    try {
      const rows = await getDatasetRowsForAiFromFile(file);
      if (Array.isArray(rows) && rows.length) {
        preferredDataset = { fileName: file.name, rows };
        break;
      }
    } catch (err) {
      console.warn('Could not parse Data Bin file as dataset:', file?.name, err);
    }
  }

  if (preferredDataset) {
    const profile = buildProfile(preferredDataset.rows);
    const aggregates = buildAggregates(preferredDataset.rows);

    currentChat.dataset = {
      fileName: preferredDataset.fileName,
      profile,
      aggregates,
      dataBinId: context.id || null,
      sourceType: 'dataBinFile',
    };
    currentChat.datasetFileName = preferredDataset.fileName;
    currentChat.datasetRows = preferredDataset.rows;
    currentChat.datasetProfile = profile;
    currentChat.datasetAggregates = aggregates;
    currentChat.fileName = preferredDataset.fileName;
    currentChat.updatedAt = Date.now();

    window.pendingDatabaseData = {
      name: preferredDataset.fileName,
      data: preferredDataset.rows,
      chatId: currentChat.id,
      source: 'dataBinFile',
    };
  } else if (combinedRows.length) {
    const profile = buildProfile(combinedRows);
    const aggregates = buildAggregates(combinedRows);

    currentChat.dataset = {
      fileName: context.name || 'Data Bin',
      profile,
      aggregates,
      dataBinId: context.id || null,
      datasourceNames: (context.datasources || []).map((ds) => ds.name),
    };
    currentChat.datasetFileName = context.name || 'Data Bin';
    currentChat.datasetRows = combinedRows;
    currentChat.datasetProfile = profile;
    currentChat.datasetAggregates = aggregates;
    currentChat.updatedAt = Date.now();

    window.pendingDatabaseData = {
      name: context.name || 'Data Bin',
      data: combinedRows,
      chatId: currentChat.id,
      source: 'dataBinDatasource',
    };
  }

  if (files.length) {
    const chunks = [];
    for (const file of files) {
      try {
        const ext = extOf(file.name);

        const hasContent = typeof file.text === 'function' || typeof file.arrayBuffer === 'function';
        if (!hasContent) {
          chunks.push(buildFileContextFromText(
            file.name,
            `[FILE_CONTENT_UNAVAILABLE]\n` +
            `File: ${file.name}\n` +
            `Status: This file is stored in the Data Bin as a reference only ` +
            `(metadata: name, type, size). Its binary content is not available ` +
            `in this session.\n` +
            `Instruction: Tell the user to upload "${file.name}" directly into ` +
            `the chat (drag-and-drop or the attachment button) so the AI can ` +
            `read and analyze its content. The Data Bin does not retain file bytes.`
          ));
          continue;
        }

        if (ext === 'csv') {
          const raw = await file.text();
          chunks.push(buildFileContextFromText(file.name, raw));
          continue;
        }

        if (ext === 'xlsx' || ext === 'xls') {
          const rows = await getDatasetRowsForAiFromFile(file);
          chunks.push(buildFileContextFromText(file.name, JSON.stringify(rows.slice(0, 200), null, 2)));
          continue;
        }

        if (ext === 'txt' || ext === 'json') {
          const raw = await file.text();
          chunks.push(buildFileContextFromText(file.name, raw));
          continue;
        }

        if (ext === 'pdf' || ext === 'docx') {
          const raw = await extractTextForAnalysis(file);
          chunks.push(buildFileContextFromText(file.name, raw));
          continue;
        }
      } catch (err) {
        chunks.push(buildFileContextFromText(file.name, `Failed to read this file for analysis. ${err?.message || err}`));
      }
    }

    binFileContext = chunks.join('\n\n');
    currentChat.fileContext = binFileContext;
  }

  currentChat.activeDataBinId = context.id || null;
  currentChat.activeDataBinName = context.name || 'Data Bin';
  currentChat.updatedAt = Date.now();
  saveChats();

  return { binFileContext, usedBin: true };
}
