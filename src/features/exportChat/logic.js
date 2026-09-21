// Ported verbatim from script.js's AXIExportChat IIFE (exportChatAsMarkdown,
// ~lines 11038-11090). Pure DOM-scraping + file-download logic, no React
// needed here — only the trigger button is a component.
function pad2(n) { return String(n).padStart(2, '0'); }

function safeToast(msg, type) {
  // Original wrapped a bare `toast` reference in try/catch since script.js's
  // toast() may not be defined yet (script.js loads via the Axpert platform's
  // Js slot at an order this bundle can't control). Same guard here.
  try { window.toast?.(msg, type, 2500); } catch { /* toast not ready */ }
}

export function exportChatAsMarkdown() {
  const msgs = document.querySelectorAll('#messages .message--user, #messages .message--assistant');
  if (!msgs.length) {
    safeToast('No messages to export yet', 'warning');
    return;
  }

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const binName = window.ACTIVEDATABINCONTEXT?.name || '';
  const model = (typeof window.getAxiConfig === 'function') ? (() => { try { return window.getAxiConfig().model; } catch { return ''; } })() : '';

  let md = `# AXI AI — Chat Export\n\n`;
  md += `| | |\n|---|---|\n`;
  md += `| **Date** | ${dateStr} |\n`;
  if (binName) md += `| **Data Bin** | ${binName} |\n`;
  if (model) md += `| **Model** | ${model} |\n`;
  md += `| **Messages** | ${msgs.length} |\n\n---\n\n`;

  let msgIndex = 0;
  msgs.forEach((msg) => {
    const isUser = msg.classList.contains('message--user');
    const bubble = msg.querySelector('.message__bubble, .messagebubble, .bubble');
    if (!bubble) return;
    const text = (bubble.innerText || bubble.textContent || '').trim();
    if (!text) return;

    msgIndex++;
    md += isUser ? `## 🧑 You\n\n${text}\n\n` : `## 🤖 AXI AI\n\n${text}\n\n`;
    md += `---\n\n`;
  });

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `axi-chat-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}.md`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1200);

  safeToast(`✅ Chat exported (${msgIndex} messages)`, 'success');
}
