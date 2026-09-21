// Ported verbatim from script.js's AXIPromptTemplates IIFE (lines ~10674-10776).
export const TEMPLATES = [
  {
    category: 'Analysis', icon: '📊',
    items: [
      { label: 'Executive Summary', desc: 'Key stats, highlights & business insights', prompt: 'Give me a concise executive summary of this dataset with key statistics, highlights, and actionable business insights' },
      { label: 'Anomaly Detection', desc: 'Outliers, missing data & unusual patterns', prompt: 'Identify all anomalies, outliers, and unusual patterns in this data. Explain what each might indicate and recommend fixes.' },
      { label: 'Correlation Analysis', desc: 'Relationships & dependencies between columns', prompt: 'Find and explain the strongest correlations and relationships between columns in this dataset. Visualize the top correlations.' },
      { label: 'Data Quality Report', desc: 'Missing values, duplicates & issues', prompt: 'Generate a detailed data quality report — missing values, duplicates, inconsistencies, outliers, and specific recommendations to fix them.' },
    ]
  },
  {
    category: 'Charts & Visuals', icon: '📈',
    items: [
      { label: 'KPI Dashboard', desc: '3–4 charts with the most important metrics', prompt: 'Create an interactive dashboard with 3-4 charts showing the most important KPIs in this data. Include a summary below each chart.' },
      { label: 'Top 10 Bar Chart', desc: 'Ranked bar chart by key metric', prompt: 'Show the top 10 records by the most significant numeric metric as a ranked horizontal bar chart with values labeled.' },
      { label: 'Trend Over Time', desc: 'Line / area chart of key changes', prompt: 'Show the key metrics trend over time as a line or area chart. Annotate any significant changes or inflection points.' },
      { label: 'Distribution Breakdown', desc: 'Histogram, pie, or category chart', prompt: 'Show the distribution of the main categorical and numeric columns as charts. Highlight any skewed or unusual distributions.' },
    ]
  },
  {
    category: 'Reports', icon: '📄',
    items: [
      {
        label: 'Full Analysis Report', desc: 'Overview, charts, findings & recommendations',
        prompt: `Generate a comprehensive analysis report using ONLY the data provided. Write EVERYTHING in plain Markdown. Use these exact section headings:

## Executive Overview
Write 2-3 sentences summarising the dataset, its purpose, and the most important takeaway.

## Key Findings
List 5-8 specific, data-driven findings as bullet points. Include actual numbers from the data.

## Supporting Charts
Place 2-3 charts here. Each chart must be a \`\`\`json code block containing {"chart":{...}}. Do NOT output any bare JSON array or object outside of a code block.

## Anomalies & Risks
Write bullet points about outliers, missing data, or risk patterns. If none, say so explicitly.

## Recommendations
List 3-5 actionable recommendations as bullet points based on the data findings above.

STRICT FORMAT RULES — you MUST follow all of these:
1. Use ## Markdown headers for every section name. Do NOT prefix with "Report" or any other title.
2. Use plain prose or bullet points for all text. NEVER write text as JSON like {"Finding":"..."}.
3. Charts go inside \`\`\`json code blocks ONLY. No bare JSON arrays anywhere in the response.
4. Do not repeat section names or add extra prefixes.`
      },
      { label: 'Compare Groups', desc: 'Side-by-side category comparison', prompt: 'Compare and contrast all groups/categories in this data. Show key metric differences with a grouped bar chart and a comparison table.' },
      { label: 'Predictive Insights', desc: 'Forecasts and what-if analysis', prompt: 'Based on current trends, provide a forecast and predictive insights. What patterns suggest what might happen next?' },
    ]
  },
  {
    category: 'Payroll', icon: '💰',
    items: [
      { label: 'Payroll Summary', desc: 'Earnings, deductions & net pay breakdown', prompt: 'Generate a complete payroll summary with total earnings, total deductions, average net pay, and a month-wise grouped bar chart.' },
      { label: 'Earnings vs Deductions', desc: 'Visual comparison with net pay trend', prompt: 'Show total gross earnings vs total deductions as a grouped bar chart, with the net pay trend as an overlaid line.' },
      { label: 'YTD Salary Statement', desc: 'Year-to-date cumulative analysis', prompt: 'Summarize the year-to-date salary statement with cumulative totals for earnings, deductions and net pay, shown as an area chart by month.' },
      { label: 'PF & ESI Breakdown', desc: 'Statutory deduction analysis', prompt: 'Analyze PF, ESI, and other statutory deductions in detail. Show the contribution trend and compare against gross pay.' },
    ]
  }
];
