// Chart rendering + post-processing helpers for rendered message bubbles.
// Ported from script.js (renderHighchartInMessage:971, enhanceCodeBlocks:832,
// axiEnhanceCallouts/axiEscHtml/axiCopyCode/axiCopyFallback:3268-3297,
// renderMarkdown:3319) verbatim — these are called by the already-built
// axi-message-thread-react.js bundle via window.renderHighchartInMessage /
// window.enhanceCodeBlocks / window.axiEnhanceCallouts (confirmed via that
// bundle's own `typeof window.X === "function"` guards), which is why they're
// still exposed on window here rather than only exported.
//
// NOTE: this was a real (pre-existing, not introduced by the SPA conversion)
// gap — script.js itself is published via the Axpert platform's "Js slot" in
// production and was NEVER loaded by a <script src> tag in axibot/index.html
// (confirmed by grep — there is no such tag). The legacy hybrid app has
// therefore never actually had working chart/code-block rendering when
// served standalone either; every "NOT YET VERIFIED against a live Axpert
// session" comment in that index.html reflects this. Porting these here
// means the SPA is standalone-functional in a way the legacy page wasn't.

export function axiEscHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Ported from script.js:7614 (escapeHtml — a separate, fuller helper than
// axiEscHtml above, also escaping quotes/apostrophes since it's used inside
// HTML attribute values, e.g. title="..."). This one is a genuine missing
// global, not a timing issue: axi-databin-services.js's loadSavedPins()
// calls a bare `escapeHtml(...)` expecting it as a global (script.js:524),
// but script.js — the only file that ever defined it — isn't loaded by this
// SPA at all. Confirmed via live testing with real ARM credentials: signing
// in and loading saved Data Bins threw "ReferenceError: escapeHtml is not
// defined", which (per loadSavedPins' own error handling in
// axi-databin-services.js — its catch block logs the error but never calls
// _releaseBoot()/hideLoader()) left the global loading overlay stuck
// forever. Exposing this fixes the crash at its source rather than papering
// over the stuck-loader symptom.
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
window.escapeHtml = escapeHtml;

export function renderMarkdown(md) {
  return DOMPurify.sanitize(marked.parse(md || ''));
}
window.renderMarkdown = renderMarkdown;

export function axiCopyFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

// Global copy-code handler — codeCard markup (built by axi-foundation.js's
// marked renderer AND by enhanceCodeBlocks below) wires its copy button via
// inline onclick="axiCopyCode(this)", so this must stay a window global.
window.axiCopyCode = function axiCopyCode(btn) {
  const codeEl = btn && btn.closest && btn.closest('.codeCard') && btn.closest('.codeCard').querySelector('code');
  const text = codeEl ? (codeEl.innerText || codeEl.textContent || '') : '';
  if (!text) return;
  const orig = btn.innerHTML;
  const done = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22C55E" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg><span>Copied!</span>';
  function onDone() {
    btn.innerHTML = done;
    btn.style.color = '#22C55E';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 1800);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onDone).catch(() => { axiCopyFallback(text); onDone(); });
  } else {
    axiCopyFallback(text);
    onDone();
  }
};

// Post-process callout patterns (Note:/Tip:/Warning:/etc.) inside a rendered
// bubble into styled callout boxes.
export function axiEnhanceCallouts(el) {
  if (!el) return;
  const map = [
    { prefix: /^note:\s*/i, cls: 'callout-note', icon: 'ℹ️', label: 'Note' },
    { prefix: /^tip:\s*/i, cls: 'callout-tip', icon: '💡', label: 'Tip' },
    { prefix: /^warning:\s*/i, cls: 'callout-warning', icon: '⚠️', label: 'Warning' },
    { prefix: /^caution:\s*/i, cls: 'callout-warning', icon: '⚠️', label: 'Caution' },
    { prefix: /^important:\s*/i, cls: 'callout-important', icon: '🔴', label: 'Important' },
    { prefix: /^key insight:\s*/i, cls: 'callout-insight', icon: '✨', label: 'Key Insight' },
    { prefix: /^insight:\s*/i, cls: 'callout-insight', icon: '✨', label: 'Key Insight' },
  ];
  el.querySelectorAll('p').forEach((p) => {
    const text = (p.textContent || '').trim();
    for (const m of map) {
      if (m.prefix.test(text)) {
        const body = text.replace(m.prefix, '').trim();
        const box = document.createElement('div');
        box.className = 'axi-callout ' + m.cls;
        box.innerHTML = `<span class="axi-callout-icon">${m.icon}</span><div class="axi-callout-body"><div class="axi-callout-title">${m.label}</div><div class="axi-callout-text">${axiEscHtml(body)}</div></div>`;
        p.replaceWith(box);
        break;
      }
    }
  });
}
window.axiEnhanceCallouts = axiEnhanceCallouts;

// Wraps <pre><code> blocks (that aren't already inside a codeCard, e.g. ones
// axi-foundation.js's marked renderer didn't build) with the codeCard chrome
// + a working copy button, and applies hljs syntax highlighting.
export function enhanceCodeBlocks(rootEl) {
  const pres = rootEl.querySelectorAll('pre');

  pres.forEach((pre) => {
    if (pre.closest('.codeCard')) return;

    const codeEl = pre.querySelector('code');
    if (!codeEl) return;

    const rawCode = codeEl.textContent || '';
    const langMatch = (codeEl.className || '').match(/language-([\w-]+)/);
    const language = (langMatch && langMatch[1]) ? langMatch[1] : 'code';

    if (window.hljs && !codeEl.dataset.highlighted) {
      try { hljs.highlightElement(codeEl); } catch (e) { /* ignore */ }
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'codeCard';

    const header = document.createElement('div');
    header.className = 'codeCard__header';

    const langLabel = document.createElement('span');
    langLabel.className = 'codeCard__lang';
    langLabel.textContent = language.toUpperCase();

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'codeCard__copy';
    copyBtn.innerHTML = `
          <svg viewBox="0 0 24 24" class="codeCard__copyIcon" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" ry="2"></rect>
            <path d="M5 15V5a2 2 0 0 1 2-2h10"></path>
          </svg>
          <span>Copy</span>
        `;

    async function copyToClipboard(text) {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
      axiCopyFallback(text);
    }

    copyBtn.addEventListener('click', async () => {
      try {
        await copyToClipboard(rawCode);
        copyBtn.classList.add('codeCard__copy--done');
        copyBtn.querySelector('span').textContent = 'Copied';
        setTimeout(() => {
          copyBtn.classList.remove('codeCard__copy--done');
          copyBtn.querySelector('span').textContent = 'Copy';
        }, 1400);
      } catch (e) {
        console.error('Copy failed:', e);
      }
    });

    const body = document.createElement('div');
    body.className = 'codeCard__body';

    header.appendChild(langLabel);
    header.appendChild(copyBtn);
    wrapper.appendChild(header);
    wrapper.appendChild(body);

    pre.classList.add('codeCard__pre');
    pre.replaceWith(wrapper);
    body.appendChild(pre);
  });
}
window.enhanceCodeBlocks = enhanceCodeBlocks;

// Renders one Highcharts chart into a message bubble, with a PNG download
// button. Called by axi-message-thread-react.js via
// window.renderHighchartInMessage(container, chartSpec).
export function renderHighchartInMessage(container, chartSpec) {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    position:relative; margin-top:20px; border-radius:12px;
    overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.05);
  `;

  const chartDiv = document.createElement('div');
  chartDiv.style.cssText = `width:100%; height:320px;`;
  wrapper.appendChild(chartDiv);

  container.appendChild(wrapper);

  const chart = Highcharts.chart(chartDiv, {
    chart: {
      type: chartSpec.type || 'line',
      style: { fontFamily: 'Inter, sans-serif' },
      backgroundColor: '#ffffff',
      events: { render() {} },
    },
    title: { text: chartSpec.title || 'Chart' },
    xAxis: chartSpec.xAxis,
    yAxis: { title: { text: 'Values' } },
    series: chartSpec.series,
    credits: { enabled: false },
    plotOptions: { series: { borderRadius: 4, animation: { duration: 1000 } } },
    colors: ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'],
    exporting: {
      enabled: true,
      fallbackToExportServer: false,
      buttons: { contextButton: { enabled: false } },
    },
  });

  const dlBtn = document.createElement('button');
  dlBtn.title = 'Download chart as PNG';
  dlBtn.style.cssText = `
    position:absolute; top:10px; right:10px; z-index:10;
    display:flex; align-items:center; gap:5px;
    padding:5px 11px; border-radius:8px;
    border:1.5px solid #E2E8F0; background:rgba(255,255,255,0.92);
    backdrop-filter:blur(4px); color:#374151;
    font-size:12px; font-weight:500; cursor:pointer;
    box-shadow:0 1px 4px rgba(0,0,0,0.08);
    transition:background 0.15s, border-color 0.15s;
  `;
  const pngIcon = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
    PNG
  `;
  dlBtn.innerHTML = pngIcon;

  dlBtn.onmouseover = () => {
    dlBtn.style.background = '#EFF6FF';
    dlBtn.style.borderColor = '#93C5FD';
  };
  dlBtn.onmouseout = () => {
    dlBtn.style.background = 'rgba(255,255,255,0.92)';
    dlBtn.style.borderColor = '#E2E8F0';
  };

  dlBtn.addEventListener('click', () => {
    const title = chartSpec.title || 'chart';
    const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    try {
      chart.exportChart(
        { type: 'image/png', filename: safeName },
        { chart: { backgroundColor: '#ffffff' } }
      );
    } catch (e) {
      const svg = chart.getSVG({ chart: { backgroundColor: '#ffffff' } });
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width || 800;
        canvas.height = img.height || 400;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        const a = document.createElement('a');
        a.download = `${safeName}.png`;
        a.href = canvas.toDataURL('image/png');
        a.click();
      };
      img.src = url;
    }

    dlBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
        stroke="#22C55E" stroke-width="2.5">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      Saved!
    `;
    dlBtn.style.borderColor = '#86EFAC';
    dlBtn.style.color = '#16A34A';
    setTimeout(() => {
      dlBtn.innerHTML = pngIcon;
      dlBtn.style.borderColor = '#E2E8F0';
      dlBtn.style.color = '#374151';
    }, 1800);
  });

  wrapper.appendChild(dlBtn);

  if (chartSpec._summary) {
    const s = document.createElement('div');
    s.style.cssText = 'padding:10px 16px 14px;font-size:13px;color:#4B5563;line-height:1.6;border-top:1px solid #E5E7EB;background:#F8FAFC;border-radius:0 0 12px 12px';
    s.textContent = chartSpec._summary;
    wrapper.appendChild(s);
  }
}
window.renderHighchartInMessage = renderHighchartInMessage;
