// Full-chat export — ported verbatim from script.js:7300-7561 plus the
// DOM-scraping helpers it falls back on (script.js:7614-7776). Structural
// move only; no logic changed. logoUrl is the same Axpert-platform-relative
// path used elsewhere in this codebase (script.js:89) — 404s outside the
// real platform, same already-documented gap as generatePDFReport's logo.
import { getActiveChat } from '../store/chatStore.js';
import { renderMarkdown } from './messageRendering.js';

const logoUrl = '../../images/ai-logo.png';

export function safeFileName(name) {
  return String(name || 'chat')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function stripHtmlToText(s) {
  const str = String(s || '');
  if (!str.trim()) return '';
  const doc = new DOMParser().parseFromString(str, 'text/html');
  return (doc.body.textContent || '').trim();
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, String.fromCharCode(38) + 'amp;')
    .replace(/</g, String.fromCharCode(38) + 'lt;')
    .replace(/>/g, String.fromCharCode(38) + 'gt;')
    .replace(/"/g, String.fromCharCode(38) + 'quot;')
    .replace(/'/g, String.fromCharCode(38) + '#39;');
}

export function normalizeText(s) {
  return String(s || '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function detectRoleFromDom(messageEl) {
  const avatar = messageEl.querySelector('.message__avatar, .messageavatar');
  const hasImg = !!avatar?.querySelector('img');
  return hasImg ? 'assistant' : 'user';
}

function escapeMd(s) {
  return String(s || '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function tableToMarkdown(tableEl, maxRows = 25) {
  const rows = Array.from(tableEl.querySelectorAll('tr'));
  if (!rows.length) return '';

  const matrix = rows.map((tr) =>
    Array.from(tr.children).map((cell) => escapeMd(cell.innerText || cell.textContent))
  );

  const header = matrix[0] || [];
  const colCount = header.length || Math.max(0, ...matrix.map((r) => r.length));

  const norm = (r) => {
    const out = (r || []).slice(0, colCount);
    while (out.length < colCount) out.push('');
    return out;
  };

  const head = norm(header);
  const sep = new Array(colCount).fill('---');
  const body = matrix.slice(1, 1 + maxRows).map(norm);

  const line = (arr) => `| ${arr.join(' | ')} |`;
  return [line(head), line(sep), ...body.map(line)].join('\n');
}

function answerCardToMarkdown(cardEl) {
  const out = [];
  const title = cardEl.querySelector('.answerCard__label, .answerCardlabel')?.innerText || '';
  if (title.trim()) out.push(`### ${normalizeText(title)}`);

  cardEl.querySelectorAll('h3').forEach((h) => {
    const t = normalizeText(h.innerText || '');
    if (t) out.push(`#### ${t}`);
  });

  cardEl.querySelectorAll('p').forEach((p) => {
    const t = normalizeText(p.innerText || '');
    if (t) out.push(t);
  });

  return out.join('\n\n');
}

function extractMessageTextFromDom(messageEl) {
  const wrap = messageEl.querySelector('.message__content') || messageEl.querySelector('.messagecontent');
  if (!wrap) return '';

  const clone = wrap.cloneNode(true);

  clone.querySelectorAll('.message__meta, .messagemeta').forEach((n) => n.remove());

  const parts = [];

  const tableCards = Array.from(clone.querySelectorAll('article.tableCard'));
  if (tableCards.length) {
    tableCards.forEach((card) => {
      const title = normalizeText(card.querySelector('.tableCardheader')?.innerText || 'Data preview');
      parts.push(`### ${title}`);

      const table = card.querySelector('table');
      if (table) parts.push(tableToMarkdown(table, 25));
      else parts.push(normalizeText(card.innerText || ''));
    });

    Array.from(
      clone.querySelectorAll('article.insightsCard, article.answerCard, article.tableNotesCard, .messageChart')
    ).forEach((el) => {
      const t = normalizeText(el.innerText || '');
      if (t) parts.push(t);
      if (el.matches('article.answerCard')) {
        const md = answerCardToMarkdown(el);
        if (md) parts.push(md);
      }
    });

    return normalizeText(parts.join('\n\n'));
  }

  return normalizeText(clone.innerText || clone.textContent || '');
}

export function getExportableThread() {
  const chat = getActiveChat();
  const title = chat?.title || 'Chat';
  const exportedAt = new Date().toLocaleString();

  // 1) Primary: saved messages (normal chat flow uses pushMessage -> chat.messages)
  if (chat?.messages?.length) {
    const msgs = chat.messages
      .map((m) => {
        let raw = String(m?.content || '');
        if (raw.trim().startsWith('<')) raw = stripHtmlToText(raw);
        return {
          role: m?.role === 'assistant' ? 'assistant' : 'user',
          ts: m?.ts,
          tsText: m?.ts ? new Date(m.ts).toLocaleString() : '',
          content: normalizeText(raw),
        };
      })
      .filter((m) => m.content);

    if (msgs.length) return { title, exportedAt, messages: msgs };
  }

  // 2) Fallback: scrape rendered UI (chat.messages empty)
  const nodes = Array.from(document.querySelectorAll('#messages .message'));
  const messages = nodes
    .map((n) => {
      const role = detectRoleFromDom(n);
      const tsText = normalizeText(n.querySelector('.message__meta, .messagemeta')?.textContent || '');
      const content = extractMessageTextFromDom(n);
      return { role, content, markdown: true, tsText };
    })
    .filter((m) => m.content);

  return { title, exportedAt, messages };
}

export function chatToMarkdown(chat) {
  const title = chat?.title || 'Chat';
  const exportedAt = new Date().toLocaleString();

  const lines = [];
  lines.push(`# ${title}`);
  lines.push(``);
  lines.push(`_Exported: ${exportedAt}_`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  (chat?.messages || []).forEach((m) => {
    const role = m?.role === 'assistant' ? 'Assistant' : 'User';
    const ts = m?.ts ? new Date(m.ts).toLocaleString() : '';
    const heading = ts ? `## ${role} — ${ts}` : `## ${role}`;

    let content = '';
    if (m?.markdown) {
      content = String(m?.content || '');
      if (content.trim().startsWith('<')) {
        content = stripHtmlToText(content);
      }
    } else {
      const raw = String(m?.content || '');
      content = raw.trim().startsWith('<') ? stripHtmlToText(raw) : raw;
    }

    lines.push(heading);
    lines.push('');
    lines.push(content || '_(No content)_');
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}

export async function exportActiveChatMarkdown() {
  const data = getExportableThread();
  if (!data.messages.length) return alert('No messages found to export.');

  const lines = [];
  lines.push(`# ${data.title}`);
  lines.push(``);
  lines.push(`_Exported: ${data.exportedAt}_`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  data.messages.forEach((m) => {
    const roleLabel = m.role === 'assistant' ? 'Assistant' : 'User';
    const ts = m.ts ? new Date(m.ts).toLocaleString() : (m.tsText || '');
    lines.push(`## ${roleLabel}${ts ? ` — ${ts}` : ''}`);
    lines.push(``);
    lines.push(String(m.content || '').trim() || '—');
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  downloadBlob(blob, `${safeFileName(data.title)}.md`);
}

export async function exportActiveChatPdf() {
  const data = getExportableThread();
  if (!data.messages.length) {
    alert('No messages found to export');
    return;
  }

  const title = data.title;
  const exportedAt = data.exportedAt;
  const messages = data.messages;

  let messagesHtml = '';
  messages.forEach((m) => {
    const roleLabel = m?.role === 'assistant' ? 'Assistant' : 'User';
    const ts = m?.ts ? new Date(m.ts).toLocaleString() : (m?.tsText || '');
    const timestamp = ts
      ? `<div style="color:#6b7280;font-size:11px;margin-bottom:6px;">${escapeHtml(ts)}</div>`
      : '';

    let raw = String(m?.content || '').trim();

    let bodyHtml = '';
    if (m?.markdown) {
      bodyHtml = renderMarkdown(raw || '_No content_');
    } else {
      if (raw.startsWith('<')) raw = stripHtmlToText(raw);
      bodyHtml = `<div style="white-space:pre-wrap;word-break:break-word;line-height:1.6;color:#374151">${escapeHtml(raw || 'No content')}</div>`;
    }

    messagesHtml += `
              <div style="margin-bottom:24px;padding-bottom:18px;border-bottom:1px solid #e5e7eb">
                <div style="font-weight:600;margin-bottom:4px;color:#111827">${escapeHtml(roleLabel)}</div>
                ${timestamp || ''}
                <div>${bodyHtml}</div>
              </div>
            `;
  });

  const w = window.open('', '_blank');
  if (!w) {
    alert('Popup blocked. Allow popups to export PDF.');
    return;
  }

  w.document.open();
  w.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(title)}</title>
          <style>
            @page { margin: 1.5cm; }
            body {
              font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
              padding: 20px;
              color: #111827;
              line-height: 1.6;
              position: relative;
            }
            /* Axpert logo watermark in top-right corner */
            body::before {
              content: "";
              position: fixed;
              top: 20px;
              right: 20px;
              width: 80px;
              height: 80px;
              background-image: url('${logoUrl}');
              background-size: contain;
              background-repeat: no-repeat;
              opacity: 0.3;
              z-index: 1000;
            }
            h1 { margin: 0 0 8px; font-size: 24px; color: #111827; position: relative; z-index: 1; }
            .meta { color: #6b7280; font-size: 12px; margin-bottom: 24px; position: relative; z-index: 1; }
            @media print {
              body { padding: 0; }
              body::before { position: absolute; }
            }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(title)}</h1>
          <div class="meta">Exported: ${escapeHtml(exportedAt)}</div>
          ${messagesHtml}
          <script>
            window.onload = () => window.print();
          </script>
        </body>
      </html>
    `);
  w.document.close();
}

export async function exportActiveChatDocx() {
  const data = getExportableThread();
  if (!data.messages.length) {
    alert('No messages found to export');
    return;
  }

  const docxLib = window.docx;
  if (!docxLib) {
    alert(
      'DOCX export requires the docx library. Add:\n' +
      '<script src="https://unpkg.com/docx@8.5.0/build/index.umd.js"></script>'
    );
    return;
  }

  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docxLib;

  const title = data.title;
  const exportedAt = data.exportedAt;
  const messages = data.messages;

  const children = [];
  children.push(new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }));
  children.push(
    new Paragraph({
      children: [new TextRun({ text: `Exported: ${exportedAt}`, color: '6B7280', size: 20 })],
    })
  );
  children.push(new Paragraph(''));

  messages.forEach((m) => {
    const roleLabel = m?.role === 'assistant' ? 'Assistant' : 'User';
    const ts = m?.ts ? new Date(m.ts).toLocaleString() : (m?.tsText || '');
    const heading = ts ? `${roleLabel} — ${ts}` : roleLabel;

    let raw = String(m?.content || '');
    if (raw.trim().startsWith('<')) raw = stripHtmlToText(raw);
    const text = raw || '(No content)';

    children.push(new Paragraph({ text: heading, heading: HeadingLevel.HEADING_2 }));

    String(text).split(/\r?\n/).forEach((line) => {
      children.push(new Paragraph(line));
    });

    children.push(new Paragraph(''));
  });

  const doc = new Document({ sections: [{ properties: {}, children }] });
  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${safeFileName(title)}.docx`);
}

export function exportActiveChatJson() {
  const chat = getActiveChat();
  if (!chat) return;

  const blob = new Blob([JSON.stringify(chat, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(chat.title || 'chat').replace(/[^\w\-]+/g, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // The original also called closeHeaderDrawer() here — that drawer
  // (script.js:7780-7896, the header "Resources" panel) isn't ported to the
  // SPA (out of scope per the migration notes), so this is a no-op guard
  // rather than a hard dependency.
  window.closeHeaderDrawer?.();
}
