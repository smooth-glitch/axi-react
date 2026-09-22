// AI response post-processing pipeline — ported verbatim from script.js
// (lines 1182-1838). Structural move only.
//
// NOT ported (dead code, verified via grep to have zero live call sites):
// - `tryParseJsonStrict` (script.js:1739) — only called from
//   `callOpenRouterForInsightsAndCharts`/`callOpenRouterForTableAndInsights`,
//   which are themselves only called from `parseCSV`/`parseXLSX`
//   (script.js:5099/5184), which have zero callers anywhere in the file.
// - `renderNarrativeReport`/`renderTableInMessage`/`renderTableNotes`
//   (script.js:1567/1601/1695) — same dead subsystem, only called from
//   `parseCSV`/`parseXLSX`.
// This whole subsystem (parseCSV, parseXLSX, createAssistantShell,
// callOpenRouterForTableAndInsights, callOpenRouterForInsightsAndCharts,
// renderNarrativeReport, renderTableInMessage, renderTableNotes,
// renderDatasetOverviewCard, renderChartInMessage) hangs together and is
// unreachable from the live handleSend flow — flagged for the parent /
// user, not deleted here (script.js itself isn't being edited in this pass).
//
// Also NOT ported: `renderHighchartInMessage` (script.js:971) — confirmed
// LIVE (called as `window.renderHighchartInMessage` from
// axi-message-thread-react.js's message-bubble component), but it's DOM
// chart-rendering, not response-parsing business logic, so it's out of this
// pass's scope. It keeps working unmodified as long as script.js stays
// loaded (untouched in this pass) — recommend porting it alongside a future
// MessageBubble pass, not folded in here.
//
// NOTE: this file and datasetContext.js import from each other (a circular
// import, same pattern as datasetContext.js <-> fileHandling.js) — safe
// because neither module calls the other's exports at top-level
// module-evaluation time, only from inside function bodies invoked later.
import { normalizeRow } from './datasetContext.js';

export function sanitizeJsonString(str) {
  // Fix unquoted number+unit values: "key": 2.03 units -> "key": "2.03 units"
  str = str.replace(/:\s*(\d+(?:\.\d+)?)\s+([a-zA-Z][a-zA-Z]*)\b(?=\s*[,}\]])/g, ': "$1 $2"');
  // Evaluate inline arithmetic expressions like 751535397.73 + 751549620.73 + 0 + 0
  str = str.replace(/(?<=[:\[,]\s*)(-?\d+(?:\.\d+)?(?:\s*[+\-*/]\s*-?\d+(?:\.\d+)?)+)(?=\s*[,\]}])/g,
    function (expr) {
      try {
        const val = Function('"use strict";return (' + expr + ')')();
        if (typeof val === 'number' && isFinite(val)) return String(val);
      } catch (e) { /* leave expr as-is */ }
      return expr;
    });
  // Fix trailing commas before } or ]
  str = str.replace(/,(\s*[}\]])/g, '$1');
  return str;
}

export function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/([A-Z])/g, ' $1').trim();
}

export function _inlineObjToMd(data) {
  if (!data || typeof data !== 'object') return String(data) + '\n';
  let md = '';
  const toLabel = (k) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();

  if (Array.isArray(data)) {
    data.forEach((item) => {
      if (typeof item === 'object' && item !== null) {
        const entries = Object.entries(item);
        md += `- ${entries.map(([k, v]) => `**${toLabel(k)}**: ${v}`).join(', ')}\n`;
      } else {
        md += `- ${item}\n`;
      }
    });
    return md;
  }

  Object.entries(data).forEach(([key, value]) => {
    const label = toLabel(key);
    if (Array.isArray(value)) {
      md += `- **${label}:**\n`;
      value.forEach((item) => {
        if (typeof item === 'object' && item !== null) {
          const parts = Object.entries(item).map(([k, v]) => `${toLabel(k)}: ${v}`);
          md += `  - ${parts.join(', ')}\n`;
        } else {
          md += `  - ${item}\n`;
        }
      });
    } else if (typeof value === 'object' && value !== null) {
      md += `- **${label}:**\n`;
      Object.entries(value).forEach(([k, v]) => {
        if (typeof v === 'object' && v !== null) {
          const parts = Object.entries(v).map(([k2, v2]) => `${toLabel(k2)}: ${v2}`);
          md += `  - **${toLabel(k)}:** ${parts.join(', ')}\n`;
        } else {
          md += `  - ${toLabel(k)}: ${v}\n`;
        }
      });
    } else {
      md += `- **${label}:** ${value}\n`;
    }
  });

  return md;
}

export function convertNamedSectionReport(reportObj) {
  const report = reportObj.report || reportObj;
  let md = '';
  const charts = [];

  for (const [key, value] of Object.entries(report)) {
    if (key.toLowerCase().includes('chart')) {
      const arr = Array.isArray(value) ? value : (value && value.charts ? value.charts : null);
      if (arr) {
        arr.forEach((item) => {
          if (item && item.chart) charts.push(item.chart);
          else if (item && item.type) charts.push(item);
        });
      }
      if (charts.length) md += `## ${key}\n\n*${charts.length} chart(s) rendered below.*\n\n`;
      continue;
    }
    md += `## ${key}\n\n`;
    md += _inlineObjToMd(value);
    md += '\n';
  }

  return md.trim() ? { markdown: md.trim(), charts } : null;
}

export function convertReportJsonToMarkdown(reportObj) {
  if (!reportObj || typeof reportObj !== 'object') return null;

  const report = reportObj.report || reportObj;
  if (!report.summary && !report.insights && !report.charts) return null;

  let md = '';

  if (report.summary) {
    md += '## Executive Summary\n\n';
    if (report.summary.totalRecords !== undefined) {
      md += `**Total Records Analyzed:** ${report.summary.totalRecords}\n\n`;
    }
    if (report.summary.sources && typeof report.summary.sources === 'object') {
      md += '**Data Sources:**\n';
      Object.entries(report.summary.sources).forEach(([key, val]) => {
        md += `- ${key}: ${val}\n`;
      });
      md += '\n';
    }
    if (report.summary.missingData && typeof report.summary.missingData === 'object') {
      md += '**Missing Data:**\n';
      Object.entries(report.summary.missingData).forEach(([key, val]) => {
        md += `- ${key}: ${val}\n`;
      });
      md += '\n';
    }
  }

  if (report.insights && typeof report.insights === 'object') {
    md += '## Key Insights\n\n';
    Object.entries(report.insights).forEach(([category, value]) => {
      if (category === 'charts') return;
      md += `### ${capitalizeFirst(category)}\n`;
      if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          value.forEach((item) => {
            if (typeof item === 'object' && item !== null) {
              const parts = Object.entries(item).map(([k, v]) => `**${capitalizeFirst(k)}**: ${v}`);
              md += `- ${parts.join(', ')}\n`;
            } else {
              md += `- ${item}\n`;
            }
          });
        } else {
          Object.entries(value).forEach(([k, v]) => {
            if (typeof v === 'object' && v !== null && v.item !== undefined) {
              md += `- **${v.item}**: ${v.amount || v.value || v.count || ''}\n`;
            } else {
              md += `- **${capitalizeFirst(k)}:** ${v}\n`;
            }
          });
        }
      } else {
        md += `${value}\n`;
      }
      md += '\n';
    });
  }

  if (Array.isArray(report.recommendations) && report.recommendations.length) {
    md += '## Recommendations\n\n';
    report.recommendations.forEach((rec) => {
      md += `- ${rec}\n`;
    });
    md += '\n';
  }

  return md.trim();
}

export function convertUnknownJsonToMarkdown(obj) {
  if (!obj || typeof obj !== 'object') return null;

  const json = obj;
  let md = '';

  const keys = Object.keys(json);
  if (keys.length === 0) return null;

  const isSimple = keys.every((k) => typeof json[k] !== 'object');
  if (isSimple) {
    md += '## Data\n\n';
    Object.entries(json).forEach(([k, v]) => {
      md += `- **${capitalizeFirst(k)}:** ${v}\n`;
    });
    return md;
  }

  md += '## Report\n\n';

  Object.entries(json).forEach(([key, value]) => {
    if (key === 'chart' || key === 'charts' || key === '__proto__' || key === 'prototype') return;

    md += `### ${capitalizeFirst(key)}\n`;

    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (typeof item === 'object' && item !== null) {
            const parts = Object.entries(item).map(([k, v]) => `${capitalizeFirst(k)}: ${v}`);
            md += `- ${parts.join(', ')}\n`;
          } else {
            md += `- ${item}\n`;
          }
        });
      } else {
        Object.entries(value).forEach(([k, v]) => {
          if (typeof v === 'object' && v !== null) {
            const nestedParts = Object.entries(v).map(([nk, nv]) => `${capitalizeFirst(nk)}: ${nv}`);
            md += `- **${capitalizeFirst(k)}:** ${nestedParts.join('; ')}\n`;
          } else {
            md += `- **${capitalizeFirst(k)}:** ${v}\n`;
          }
        });
      }
    } else {
      md += `${value}\n`;
    }
    md += '\n';
  });

  return md.trim() || null;
}

export function parseInlineJsonSections(answer) {
  const sections = {};
  const sectionText = {};
  const sectionOrder = [];

  const KNOWN_SECTIONS = /^(executive overview|key findings?|supporting charts?|anomalies?(\s*[&\/]\s*risks?)?|recommendations?|summary|insights?|data quality|highlights?|findings?|risks?|overview|conclusion)$/i;

  const normalized = answer
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");

  const lines = normalized.split(/\r?\n/);
  const jsonSectionStart = /^([A-Za-z][A-Za-z &]+):\s*(\{|\[)/;
  const textSectionStart = /^([A-Za-z][A-Za-z &]{2,}):\s*(.+)/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trimEnd().replace(/^[\*\-]\s+/, '');

    const jsonM = line.match(jsonSectionStart);
    if (jsonM) {
      const name = jsonM[1].trim();
      const colonPos = line.indexOf(':');
      let rest = line.substring(colonPos + 1).trim();

      let parsed = null;
      try {
        parsed = JSON.parse(rest);
      } catch (e) {
        let depth = 0;
        for (const ch of rest) {
          if (ch === '{' || ch === '[') depth++;
          else if (ch === '}' || ch === ']') depth--;
        }
        let j = i + 1;
        while (j < lines.length && depth > 0) {
          rest += '\n' + lines[j];
          for (const ch of lines[j]) {
            if (ch === '{' || ch === '[') depth++;
            else if (ch === '}' || ch === ']') depth--;
          }
          j++;
        }
        try { parsed = JSON.parse(rest); i = j - 1; } catch (e2) { /* give up on this section */ }
      }

      if (parsed !== null) {
        sections[name] = parsed;
        if (!sectionOrder.includes(name)) sectionOrder.push(name);
        i++;
        continue;
      }
    }

    const nameOnlyM = line.match(/^([A-Za-z][A-Za-z &]+):\s*$/);
    if (nameOnlyM && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trimEnd();
      if (/^\s*[\[{]/.test(nextLine)) {
        const name = nameOnlyM[1].trim();
        let rest = nextLine.trim();
        let parsed = null;
        try {
          parsed = JSON.parse(rest);
        } catch (e) {
          let depth = 0;
          for (const ch of rest) {
            if (ch === '{' || ch === '[') depth++;
            else if (ch === '}' || ch === ']') depth--;
          }
          let j = i + 2;
          while (j < lines.length && depth > 0) {
            rest += '\n' + lines[j];
            for (const ch of lines[j]) {
              if (ch === '{' || ch === '[') depth++;
              else if (ch === '}' || ch === ']') depth--;
            }
            j++;
          }
          try { parsed = JSON.parse(rest); i = j - 1; } catch (e2) { /* give up on this section */ }
        }
        if (parsed !== null) {
          sections[name] = parsed;
          if (!sectionOrder.includes(name)) sectionOrder.push(name);
          i += 2;
          continue;
        }
      }
    }

    const textM = line.match(textSectionStart);
    if (textM && KNOWN_SECTIONS.test(textM[1].trim())) {
      const name = textM[1].trim();
      const colonPos = line.indexOf(':');
      const text = line.substring(colonPos + 1).trim();
      if (text && !sectionOrder.includes(name)) {
        sectionText[name] = text;
        sectionOrder.push(name);
      }
    }

    i++;
  }

  if (sectionOrder.length < 2) return null;

  let md = '';
  const charts = [];

  for (const sectionName of sectionOrder) {
    const nameLower = sectionName.toLowerCase();

    if (sectionText[sectionName] !== undefined) {
      md += `## ${sectionName}\n\n${sectionText[sectionName]}\n\n`;
      continue;
    }

    const data = sections[sectionName];
    if (data === undefined) continue;

    if (nameLower.includes('chart')) {
      const chartsArr = data.charts || (Array.isArray(data) ? data : null);
      if (chartsArr) {
        chartsArr.forEach((item) => {
          if (item && item.chart) charts.push(item.chart);
          else if (item && item.type) charts.push(item);
        });
      }
      if (charts.length) md += `## ${sectionName}\n\n*${charts.length} chart(s) rendered below.*\n\n`;
      continue;
    }

    md += `## ${sectionName}\n\n`;
    md += _inlineObjToMd(data);
    md += '\n';
  }

  return md.trim() ? { markdown: md.trim(), charts } : null;
}

export function tryParseDatasetJson(text) {
  try {
    let obj = JSON.parse(text);

    // Handle stringified inner JSON (like the Qubix "d" wrapper)
    if (obj && typeof obj.d === 'string') {
      try {
        obj = JSON.parse(obj.d);
      } catch (e) { /* keep original obj if inner parse fails */ }
    }

    let rawRows = null;

    if (Array.isArray(obj?.result?.data?.[0]?.data)) {
      rawRows = obj.result.data[0].data;
    } else if (Array.isArray(obj?.result?.data)) {
      rawRows = obj.result.data;
    } else if (Array.isArray(obj?.data)) {
      rawRows = obj.data;
    } else if (Array.isArray(obj)) {
      rawRows = obj;
    }

    if (rawRows && rawRows.length > 0) {
      const rows = rawRows
        .map(normalizeRow)
        .filter((r) => Object.values(r).some((v) => String(v ?? '').trim() !== ''));

      if (rows.length && Object.keys(rows[0] || {}).length) {
        return rows;
      }
    }
  } catch (_) {
    // Not valid JSON or failed to parse — fail silently, let CSV/TXT parsers try
  }
  return [];
}
