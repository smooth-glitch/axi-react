// PDF report generation — ported verbatim from script.js's
// generatePDFReport (script.js:4136-4615). Structural move only (global
// function -> ES module export); no logic, layout, or styling was changed.
// Uses the jspdf/html2canvas UMD globals already loaded via CDN <script>
// tags (see axi-react-src/index.html) — same as the original.
import { _axiFetch } from './transport.js';

// script.js:87 — Axpert-platform-relative path, 404s outside the real
// platform (same category as the other Axpert-only assets documented
// elsewhere in this codebase, e.g. axpertUI's CSS). Already handled
// gracefully below (logoB64 stays null on failure) — not a new gap.
const AI_LOGO_SRC = '../../images/ai-logo.png';

export async function generatePDFReport(container, markdownText) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'pt', 'a4');

  const PW = pdf.internal.pageSize.getWidth();    // 595.28 pt
  const PH = pdf.internal.pageSize.getHeight();   // 841.89 pt
  const ML = 48, MR = 48;
  const CW = PW - ML - MR;                        // ~499 pt content width
  const FOOTER_H = 28;                             // footer bar height
  const SAFE_BOTTOM = PH - FOOTER_H - 10;         // last Y before footer

  // ── Colour palette ────────────────────────────────────────
  const ORANGE = [249, 115, 22];
  const ORANGE_D = [180, 55, 6];
  const BLACK = [15, 15, 15];
  const BODY = [50, 50, 50];
  const SUB = [120, 120, 120];
  const DIVIDER = [220, 220, 220];
  const WHITE = [255, 255, 255];
  const TBL_HDR = [25, 25, 25];
  const TBL_ALT = [253, 246, 237];

  // ── Text sanitiser ────────────────────────────────────────
  // Strips emoji, non-Latin chars jsPDF can't render, backtick
  // spans, and converts ₹ → Rs. since Helvetica lacks that glyph.
  function sanitise(t) {
    return (t || '')
      .replace(/`([^`]*)`/g, '$1')               // `code` → plain
      .replace(/\*\*/g, '')                       // strip bold markers
      .replace(/[₹\u20B9]/g, 'Rs.')              // rupee sign → Rs.
      .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')    // emoji block 1
      .replace(/[\u{2600}-\u{27BF}]/gu, '')      // emoji block 2
      .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u024F]/g, '') // non-Latin
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Logo loader ───────────────────────────────────────────
  let logoB64 = null;
  try {
    const resp = await _axiFetch(AI_LOGO_SRC);
    const blob = await resp.blob();
    logoB64 = await new Promise((res) => {
      const fr = new FileReader();
      fr.onloadend = () => res(fr.result);
      fr.readAsDataURL(blob);
    });
    // Only keep a real image data URL — an empty one makes jsPDF attempt
    // a data: network load that CSP blocks.
    if (!/^data:image\//.test(logoB64 || '')) logoB64 = null;
  } catch (e) { logoB64 = null; console.warn('[PDF] Logo not loaded:', e.message); }

  // ── yPos (mutable, shared via closure) ───────────────────
  let yPos = 0;

  // ── Watermark: centred ghost logo ────────────────────────
  function drawWatermark() {
    if (!logoB64) return;
    // saveGraphicsState / restoreGraphicsState (PDF q/Q operators) guarantee
    // the pre-watermark opacity is restored. The old setGState({opacity:1})
    // reset silently failed in jsPDF 2.5.x, leaving all body text at 3.2%.
    try {
      pdf.saveGraphicsState();
      pdf.setGState(new pdf.GState({ opacity: 0.032 }));
      const s = 260;
      pdf.addImage(logoB64, 'PNG', (PW - s) / 2, (PH - s) / 2, s, s);
      pdf.restoreGraphicsState();
    } catch (e) {
      try { pdf.restoreGraphicsState(); } catch (_) { /* ignore */ }
    }
  }

  // ── Page header ───────────────────────────────────────────
  function drawHeader(isFirst) {
    const H = isFirst ? 82 : 42;

    pdf.setFillColor(...BLACK);
    pdf.rect(0, 0, PW, H, 'F');

    pdf.setFillColor(...ORANGE);
    pdf.rect(0, 0, 5, H, 'F');

    pdf.setFillColor(...ORANGE);
    pdf.rect(0, H, PW, 2.5, 'F');

    if (isFirst) {
      pdf.setTextColor(...WHITE);
      pdf.setFontSize(20);
      pdf.setFont(undefined, 'bold');
      pdf.text('AXI Analysis Report', ML, 32);

      pdf.setFontSize(8.5);
      pdf.setFont(undefined, 'normal');
      pdf.setTextColor(190, 190, 190);
      const dt = new Date().toLocaleDateString('en-IN',
        { year: 'numeric', month: 'long', day: 'numeric' });
      pdf.text(`Generated: ${dt}`, ML, 50);
      pdf.text('Powered by AXI  |  Axpert Insights', ML, 65);
    } else {
      pdf.setTextColor(...WHITE);
      pdf.setFontSize(8);
      pdf.setFont(undefined, 'bold');
      pdf.text('AXI ANALYSIS REPORT', ML, 18);
      pdf.setFont(undefined, 'normal');
      pdf.setTextColor(165, 165, 165);
      pdf.text('Axpert Insights', ML, 31);
    }

    if (logoB64) {
      try {
        const ls = isFirst ? 50 : 26;
        const ly = isFirst ? 14 : 8;
        pdf.addImage(logoB64, 'PNG', PW - MR - ls, ly, ls, ls);
      } catch (e) { /* ignore */ }
    }

    yPos = isFirst ? 98 : 56;
  }

  // ── Page footer ───────────────────────────────────────────
  function drawFooter(n, total) {
    const fy = PH - FOOTER_H;
    pdf.setFillColor(...BLACK);
    pdf.rect(0, fy, PW, FOOTER_H, 'F');
    pdf.setFillColor(...ORANGE);
    pdf.rect(0, fy, PW, 2, 'F');

    pdf.setFontSize(7.5);
    pdf.setFont(undefined, 'normal');
    pdf.setTextColor(...WHITE);
    pdf.text(`Page ${n} of ${total}`, ML, fy + 17);

    pdf.setFillColor(...ORANGE);
    pdf.circle(PW / 2, fy + 14, 2.5, 'F');

    pdf.setTextColor(175, 175, 175);
    pdf.text('Generated by AXI  |  Axpert Insights', PW - MR, fy + 17, { align: 'right' });
  }

  // ── Space guard — add a fresh page if needed ─────────────
  function ensureSpace(needed) {
    if (yPos + needed > SAFE_BOTTOM) {
      pdf.addPage();
      drawHeader(false);
      drawWatermark();
    }
  }

  // ── Section heading (##) ──────────────────────────────────
  function renderH2(raw) {
    const text = sanitise(raw.replace(/^#+\s*/, ''));
    pdf.setFontSize(12); pdf.setFont(undefined, 'bold');
    const lines = pdf.splitTextToSize(text, CW - 26);
    const blockH = lines.length * 15 + 9;
    ensureSpace(blockH + 12);
    yPos += 10;
    pdf.setFillColor(...ORANGE);
    pdf.rect(ML, yPos - 13, 4, blockH, 'F');
    pdf.setFillColor(255, 240, 224);
    pdf.roundedRect(ML + 8, yPos - 14, CW - 8, blockH + 2, 3, 3, 'F');
    pdf.setFontSize(12); pdf.setFont(undefined, 'bold'); pdf.setTextColor(...ORANGE_D);
    lines.forEach((ln, i) => pdf.text(ln, ML + 17, yPos + 4 + i * 15));
    yPos += blockH;
  }

  // ── Sub-heading (###) ─────────────────────────────────────
  function renderH3(raw) {
    const text = sanitise(raw.replace(/^#+\s*/, ''));
    pdf.setFontSize(10); pdf.setFont(undefined, 'bold');
    const lines = pdf.splitTextToSize(text, CW);
    ensureSpace(lines.length * 13 + 14);
    yPos += 8;
    pdf.setFillColor(...ORANGE);
    pdf.rect(ML, yPos + 3, 22, 1.5, 'F');
    pdf.setFontSize(10); pdf.setFont(undefined, 'bold'); pdf.setTextColor(...BLACK);
    lines.forEach((ln, i) => pdf.text(ln, ML, yPos + i * 13));
    yPos += (lines.length - 1) * 13 + 16;
  }

  // ── Body paragraph ────────────────────────────────────────
  function renderParagraph(raw) {
    const text = sanitise(raw);
    if (!text) return;
    // Set the font BEFORE splitTextToSize so the text wraps at the same
    // 9.5pt metrics it is rendered with. (Otherwise it inherits the
    // previous element's font — e.g. 12pt bold from a heading — and wraps
    // too narrow, leaving the paragraph clumped on the left.)
    pdf.setFontSize(9.5);
    pdf.setFont(undefined, 'normal');
    const wrapped = pdf.splitTextToSize(text, CW);
    ensureSpace(wrapped.length * 14 + 4);
    // Re-assert font + colour AFTER ensureSpace: if it added a page,
    // drawHeader() left the text colour light grey.
    pdf.setFontSize(9.5);
    pdf.setFont(undefined, 'normal');
    pdf.setTextColor(...BODY);
    wrapped.forEach((line, i) => {
      const isLast = i === wrapped.length - 1;
      // All lines except the last are justified; last line stays left-aligned
      // (standard typographic convention — prevents a single word stretching across the page)
      pdf.text(line, ML, yPos + i * 14, isLast ? {} : { maxWidth: CW, align: 'justify' });
    });
    yPos += wrapped.length * 14 + 4;
  }

  // ── Bullet point (level 0 = main, 1 = sub, 2 = sub-sub) ─────
  function renderBullet(raw, level) {
    level = level || 0;
    const text = sanitise(raw.replace(/^[\s\-•*>]+/, ''));
    if (!text) return;
    const indentX = ML + (level * 14);
    const textWidth = CW - 13 - (level * 14);
    const wrapped = pdf.splitTextToSize(text, textWidth);
    ensureSpace(wrapped.length * 14 + 3);
    if (level === 0) {
      pdf.setFillColor(...ORANGE);
      pdf.circle(indentX + 4, yPos - 3.5, 2.8, 'F');
    } else {
      pdf.setFillColor(...SUB);
      pdf.circle(indentX + 4, yPos - 3.5, 1.8, 'F');
    }
    pdf.setFontSize(9.5);
    pdf.setFont(undefined, 'normal');
    pdf.setTextColor(...BODY);
    wrapped.forEach((line, i) => pdf.text(line, indentX + 13, yPos + i * 14));
    yPos += wrapped.length * 14 + 3;
  }

  // ── Horizontal rule ───────────────────────────────────────
  function renderHRule() {
    ensureSpace(16);
    yPos += 4;
    pdf.setDrawColor(...DIVIDER);
    pdf.setLineWidth(0.5);
    pdf.line(ML, yPos, PW - MR, yPos);
    yPos += 12;
  }

  // ── Markdown table ────────────────────────────────────────
  function renderTable(tableLines) {
    // Parse rows, skipping separator lines like |---|---|
    const rows = tableLines
      .filter((l) => !/^\|[\s:\-|]+\|$/.test(l.trim()))
      .map((l) =>
        l.trim()
          .split('|')
          .filter((_, i, a) => i > 0 && i < a.length - 1)
          .map((c) => sanitise(c))
      )
      .filter((r) => r.length > 0);

    if (rows.length === 0) return;

    const header = rows[0];
    const data = rows.slice(1);
    const cols = header.length;
    if (cols === 0) return;

    const colW = CW / cols;
    const rowH = 20;
    const hdrH = 24;
    const totalH = hdrH + data.length * rowH + 12;

    ensureSpace(totalH);
    yPos += 6;

    // ── Header row ────────────────────────────────────────
    pdf.setFillColor(...TBL_HDR);
    pdf.roundedRect(ML, yPos, CW, hdrH, 3, 3, 'F');
    pdf.setFontSize(8.5);
    pdf.setFont(undefined, 'bold');
    pdf.setTextColor(...WHITE);
    header.forEach((h, i) => {
      pdf.text(h, ML + i * colW + 7, yPos + 15, { maxWidth: colW - 12 });
    });

    // Orange accent line below header
    pdf.setFillColor(...ORANGE);
    pdf.rect(ML, yPos + hdrH, CW, 1.5, 'F');
    yPos += hdrH + 1.5;

    // ── Data rows ─────────────────────────────────────────
    data.forEach((row, ri) => {
      pdf.setFillColor(...(ri % 2 === 0 ? WHITE : TBL_ALT));
      pdf.rect(ML, yPos, CW, rowH, 'F');

      pdf.setFontSize(8.5);
      pdf.setFont(undefined, ri === 0 ? 'normal' : 'normal');
      pdf.setTextColor(...BODY);
      row.forEach((cell, ci) => {
        pdf.text(cell, ML + ci * colW + 7, yPos + 13, { maxWidth: colW - 12 });
      });

      // Row divider
      pdf.setDrawColor(...DIVIDER);
      pdf.setLineWidth(0.3);
      pdf.line(ML, yPos + rowH, ML + CW, yPos + rowH);

      yPos += rowH;
    });

    // Outer border
    pdf.setDrawColor(...DIVIDER);
    pdf.setLineWidth(0.6);
    pdf.roundedRect(ML, yPos - hdrH - 1.5 - data.length * rowH, CW,
      hdrH + 1.5 + data.length * rowH, 3, 3, 'S');

    yPos += 12;
  }

  // ─────────────────────────────────────────────────────────
  // PRE-PROCESS: group table lines into blocks
  // ─────────────────────────────────────────────────────────
  const rawLines = markdownText.split('\n');
  const blocks = [];
  let li = 0;
  while (li < rawLines.length) {
    const l = rawLines[li];
    // group fenced code blocks so they don't render as body text
    if (l.trim().startsWith('```')) {
      li++; // skip opening fence
      while (li < rawLines.length && !rawLines[li].trim().startsWith('```')) li++;
      li++; // skip closing fence
      continue; // discard code block entirely — charts handle the visual output
    }
    if (l.trim().startsWith('|')) {
      const tbl = [];
      while (li < rawLines.length && rawLines[li].trim().startsWith('|')) {
        tbl.push(rawLines[li++]);
      }
      blocks.push({ type: 'table', lines: tbl });
    } else {
      blocks.push({ type: 'line', text: l });
      li++;
    }
  }

  // ─────────────────────────────────────────────────────────
  // PAGE 1 — header + watermark
  // ─────────────────────────────────────────────────────────
  drawHeader(true);
  drawWatermark();

  // ─────────────────────────────────────────────────────────
  // RENDER BLOCKS
  // ─────────────────────────────────────────────────────────
  // Consecutive plain-text lines are buffered and flushed as one
  // paragraph so they reflow to full content width instead of
  // each rendering as a separate short line.
  const paraBuffer = [];
  function flushPara() {
    if (!paraBuffer.length) return;
    renderParagraph(paraBuffer.join(' '));
    paraBuffer.length = 0;
  }

  for (const block of blocks) {
    if (block.type === 'table') {
      flushPara();
      renderTable(block.lines);
      continue;
    }

    const line = block.text;
    const trimmed = line.trim();

    if (line.startsWith('## ') || line.startsWith('# ')) { flushPara(); renderH2(line); }
    else if (line.startsWith('### ')) { flushPara(); renderH3(line); }
    else if (/^---+$/.test(trimmed)) { flushPara(); renderHRule(); }
    else if (/^[-•*] /.test(trimmed)) {
      flushPara();
      const leading = line.match(/^(\s*)/)[1].length;
      renderBullet(line, Math.min(Math.floor(leading / 2), 3));
    }
    else if (/^\d+\. /.test(trimmed)) {
      flushPara();
      const leading = line.match(/^(\s*)/)[1].length;
      renderBullet(line.replace(/^\d+\.\s*/, ''), Math.min(Math.floor(leading / 2), 3));
    }
    else if (trimmed) { paraBuffer.push(trimmed); }
    else { flushPara(); yPos += 6; }
  }
  flushPara();

  // ─────────────────────────────────────────────────────────
  // CHARTS — rendered inline after text.
  // A new page is added only when available vertical space
  // is < 80 pt (too small for any readable chart image).
  // maxH already scales the chart to fit whatever remains.
  // ─────────────────────────────────────────────────────────
  const charts = container.querySelectorAll('.highcharts-container');
  const CHART_TITLE_H = 26; // title bar height + gap below it

  for (let ci = 0; ci < charts.length; ci++) {
    yPos += 14; // breathing gap before chart

    try {
      // ── Capture canvas FIRST so we know the chart height ──────────
      const cnv = await html2canvas(charts[ci], {
        backgroundColor: '#ffffff',
        scale: 2,
        allowTaint: true,
        useCORS: true,
        ignoreElements: (el) =>
          el.tagName === 'LINK' && el.rel === 'stylesheet' &&
          el.href && !el.href.startsWith(window.location.origin),
      });

      const imgW = CW;
      const naturalH = (cnv.height * imgW) / cnv.width;

      // ── Page-break decision: title + chart must land on the same page ──
      const spaceNeeded = CHART_TITLE_H + Math.min(naturalH, SAFE_BOTTOM - 56 - 6);
      if (SAFE_BOTTOM - yPos < spaceNeeded) {
        pdf.addPage();
        drawHeader(false);
        drawWatermark();
        yPos += 6;
      }

      // ── Draw title bar (now guaranteed to be on same page as chart) ──
      const titleY = yPos;
      pdf.setFillColor(255, 240, 224);
      pdf.roundedRect(ML, titleY - 12, CW, 22, 3, 3, 'F');
      pdf.setFillColor(...ORANGE);
      pdf.rect(ML, titleY - 12, 4, 22, 'F');
      pdf.setFontSize(10.5);
      pdf.setFont(undefined, 'bold');
      pdf.setTextColor(...ORANGE_D);
      pdf.text(`Chart ${ci + 1}`, ML + 12, titleY + 5);
      yPos += 20;

      // ── Place chart image ─────────────────────────────────────────
      const maxH = SAFE_BOTTOM - yPos - 6;
      const imgH = Math.min(naturalH, maxH);
      const finalW = imgH < naturalH ? (imgH * imgW) / naturalH : imgW;
      const offsetX = ML + (imgW - finalW) / 2;

      const imgData = cnv.toDataURL('image/png');

      pdf.setFillColor(210, 210, 210);
      pdf.roundedRect(offsetX + 3, yPos + 3, finalW, imgH, 4, 4, 'F');
      pdf.setFillColor(...WHITE);
      pdf.roundedRect(offsetX, yPos, finalW, imgH, 4, 4, 'F');
      pdf.addImage(imgData, 'PNG', offsetX, yPos, finalW, imgH);
      pdf.setDrawColor(...DIVIDER);
      pdf.setLineWidth(0.75);
      pdf.roundedRect(offsetX, yPos, finalW, imgH, 4, 4, 'S');

      yPos += imgH + 10;
    } catch (e) {
      pdf.setFontSize(9);
      pdf.setTextColor(...SUB);
      pdf.text('Chart could not be rendered.', ML, yPos + 24);
      yPos += 40;
    }
  }

  // ─────────────────────────────────────────────────────────
  // FOOTERS — retroactively stamp every page
  // ─────────────────────────────────────────────────────────
  const totalPages = pdf.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    pdf.setPage(p);
    drawFooter(p, totalPages);
  }

  // ─────────────────────────────────────────────────────────
  // SAVE
  // ─────────────────────────────────────────────────────────
  const stamp = new Date().toISOString().slice(0, 10);
  pdf.save(`AXI_Report_${stamp}.pdf`);
}
