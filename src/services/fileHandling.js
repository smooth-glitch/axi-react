// File/attachment reading and parsing — ported verbatim from script.js
// (lines ~1750-1935, 5015, 5285-5288, 5489-5556). Structural move only.
//
// NOT ported: parseCSV (script.js:5099) and parseXLSX (script.js:5184) —
// verified via grep to have ZERO call sites anywhere in script.js. They're
// dead code (their only dependency, createAssistantShell/createMessageNode,
// was already superseded by the React message-thread bundle per the
// extraction report). The live upload flow parses CSV/XLSX inline inside
// handleSend's attachment branch instead (see chatFlow.js) — that inline
// logic is preserved as-is rather than redirected at these two dead
// functions, since the inline path is the one that's actually tested.

import { normalizeRow, syncPendingDatabaseToActiveChat, buildProfile, buildAggregates } from './datasetContext.js';
import { getActiveChat, saveChats } from '../store/chatStore.js';

export function extOf(name = '') {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file);
  });
}

export async function readAsArrayBuffer(file) {
  return await file.arrayBuffer();
}

export function clipFileText(fullData, maxChars = 60000) {
  const text = String(fullData || '').trim();
  if (!text) return 'No readable text could be extracted from this file.';
  return text.length > maxChars
    ? text.slice(0, maxChars) + `\n...[TRUNCATED ${text.length - maxChars} chars omitted]`
    : text;
}

export function buildFileContextFromText(fileName, fullData) {
  const clipped = clipFileText(fullData, 60000);
  return `--- SYSTEM FILE CONTENT ATTACHED ---
Name: ${fileName}
Content:
${clipped}
--- END FILE CONTENT ---`;
}

export async function extractTextFromPdf(file) {
  if (!window.pdfjsLib) {
    throw new Error('PDF parser not loaded. Add pdf.js loader to index.html.');
  }

  // DataBin stores files as metadata-only objects {name, type, size} without
  // binary content. Calling .arrayBuffer() on such an object throws
  // TypeError. Detect this early and return a structured notice instead.
  if (typeof file.arrayBuffer !== 'function') {
    return (
      `[FILE_CONTENT_UNAVAILABLE]\n` +
      `File: ${file.name}\n` +
      `Status: This file is referenced in the Data Bin but its content is not available ` +
      `in this session. The Data Bin stores file metadata only (name, type, size) — ` +
      `not the actual file bytes.\n` +
      `Instruction: Tell the user they need to upload "${file.name}" directly into the ` +
      `chat (drag-and-drop or the attachment button) for the AI to read and analyze it. ` +
      `Simply having it in the Data Bin is not enough for file-content analysis.`
    );
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await window.pdfjsLib.getDocument({ data, disableWorker: true }).promise;

  let out = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item?.str || '').join(' ').replace(/\s+/g, ' ').trim();
    if (pageText) out.push(`--- Page ${pageNum} ---\n${pageText}`);
  }

  const result = out.join('\n\n').trim();

  console.log('[AXI] PDF extraction:', { name: file.name, pages: pdf.numPages, chars: result.length });

  if (!result) {
    return (
      `[PDF_EXTRACTION_NOTICE]\n` +
      `File: ${file.name}\n` +
      `Pages: ${pdf.numPages}\n` +
      `Status: No selectable text could be extracted from this PDF. ` +
      `The document appears to be scanned or entirely image-based.\n` +
      `Instruction: Inform the user that this PDF contains no extractable text ` +
      `and suggest they upload a text-based or OCR-processed version of the document.`
    );
  }

  return result;
}

export async function extractTextFromDocx(file) {
  if (!window.mammoth) {
    throw new Error('DOCX parser not loaded. Add mammoth.browser.min.js to index.html.');
  }

  if (typeof file.arrayBuffer !== 'function') {
    throw new Error(
      `"${file.name}" content is not available in this session. ` +
      `The Data Bin stores file metadata only — not the actual file bytes. ` +
      `Upload "${file.name}" directly in the chat for AI analysis.`
    );
  }

  const arrayBuffer = await file.arrayBuffer();

  // DOCX is a ZIP archive — magic bytes must be PK\x03\x04. DataBin file
  // stubs have a real .arrayBuffer() method but return an empty/invalid
  // buffer, causing mammoth to throw "Can't find end of central directory".
  // Caught early here with a meaningful error before mammoth sees the data.
  const magic = new Uint8Array(arrayBuffer, 0, 4);
  if (arrayBuffer.byteLength < 4 || magic[0] !== 0x50 || magic[1] !== 0x4B || magic[2] !== 0x03 || magic[3] !== 0x04) {
    throw new Error(
      `"${file.name}" does not contain valid DOCX data. ` +
      `The Data Bin stores file metadata only — not the actual file bytes. ` +
      `Upload "${file.name}" directly in the chat to analyze its content.`
    );
  }

  let rawText = '';
  try {
    const result = await window.mammoth.extractRawText({ arrayBuffer });
    rawText = String(result?.value || '').trim();
    console.log('DOCX raw extraction:', { name: file.name, chars: rawText.length, warnings: result?.messages || [] });
  } catch (err) {
    console.error('DOCX raw extraction failed:', err);
  }

  if (rawText) return rawText;

  try {
    const htmlResult = await window.mammoth.convertToHtml({ arrayBuffer });
    const html = String(htmlResult?.value || '').trim();
    const text = new DOMParser().parseFromString(html, 'text/html').body.textContent.trim();

    console.log('DOCX html fallback extraction:', { name: file.name, chars: text.length, warnings: htmlResult?.messages || [] });

    if (text) return text;
  } catch (err) {
    console.error('DOCX html fallback failed:', err);
  }

  throw new Error('Could not extract readable text from this DOCX file.');
}

// Dispatches by extension: txt -> file.text(), docx -> extractTextFromDocx,
// pdf -> extractTextFromPdf, else -> readFileAsText. This is the fix target
// for the `extractTextFromUploadedFile` ReferenceError already fixed in
// script.js directly (see script.js:6330) — preserved here verbatim.
export async function extractTextForAnalysis(file) {
  const ext = extOf(file.name);
  if (ext === 'txt') return await file.text();
  if (ext === 'docx') return await extractTextFromDocx(file);
  if (ext === 'pdf') return await extractTextFromPdf(file);
  return await readFileAsText(file);
}

export function isLikelyTabularText(text, parsed, rows) {
  if (!Array.isArray(rows) || !rows.length) return false;
  const fields = Array.isArray(parsed?.meta?.fields)
    ? parsed.meta.fields.filter((f) => String(f).trim() !== '')
    : Object.keys(rows[0] || {}).filter((f) => String(f).trim() !== '');
  if (fields.length < 2) return false;
  if (rows.length < 2) return false;
  const filledRows = rows.filter((row) => {
    let filled = 0;
    for (const field of fields) {
      if (String(row?.[field] ?? '').trim() !== '') filled++;
    }
    return filled >= 2;
  }).length;
  if (filledRows < 2) return false;
  const raw = String(text || '').trim();
  if ((raw.startsWith('{') || raw.startsWith('[')) && rows.length <= 2) return false;
  return true;
}

export function parseDelimitedTextToRows(text, options = {}) {
  if (typeof window.Papa === 'undefined') return [];

  const { strict = false } = options;

  const parsed = window.Papa.parse(text, {
    header: true,
    skipEmptyLines: 'greedy',
    delimiter: '',
    delimitersToGuess: [',', '\t', '|', ';'],
  });

  const rows = (parsed.data || [])
    .map(normalizeRow)
    .filter((r) => Object.values(r).some((v) => String(v ?? '').trim() !== ''));

  if (!rows.length) return [];
  if (!Object.keys(rows[0] || {}).length) return [];

  if (strict && !isLikelyTabularText(text, parsed, rows)) {
    return [];
  }

  return rows;
}

export function getPdfMetaFromContext(fileName = '', fileContext = '') {
  const safeName = String(fileName || '').trim();
  const text = String(fileContext || '');
  const pageMatches = text.match(/--- Page \d+ ---/g) || [];
  return { fileName: safeName, extractedPageCount: pageMatches.length, isPdf: /\.pdf$/i.test(safeName) };
}

// NOTE: this file and datasetContext.js import from each other (a circular
// import) — safe here because neither module calls the other's exports at
// top-level module-evaluation time, only from inside function bodies invoked
// later; Vite/Rollup's live-binding ES module semantics resolve this
// correctly.
export async function handleDatasetRowsFromFile(file, rows) {
  const profile = buildProfile(rows);
  const aggregates = buildAggregates(rows);

  const currentChat = getActiveChat();
  if (currentChat) {
    currentChat.dataset = { fileName: file.name, profile, aggregates };
    currentChat.datasetFileName = file.name;
    currentChat.datasetRows = rows;
    currentChat.datasetProfile = profile;
    currentChat.datasetAggregates = aggregates;
    currentChat.fileName = file.name;
    currentChat.fileContext = '';
    currentChat.updatedAt = Date.now();
    saveChats();
  }

  syncPendingDatabaseToActiveChat(currentChat);

  const promptEl = document.getElementById('prompt');
  if (promptEl && !promptEl.value.trim()) {
    promptEl.value = `Analyze this file: ${file.name}`;
    promptEl.dispatchEvent(new Event('input', { bubbles: true }));
    window.__axiNotifyComposer?.();
  }
}
