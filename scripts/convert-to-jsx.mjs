import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sharedDir = join(__dirname, '..', 'shared');
const publicDir = join(__dirname, '..', 'public');

const filesToConvert = [
  {
    jsName: 'axi-standalone-bridge.js',
    jsxName: 'axi-standalone-bridge.jsx',
    sandeshName: 'sandesh-standalone-bridge.jsx',
    extraGlobals: '\nif (typeof window !== "undefined") { window.SandeshStandaloneBridge = true; }\n',
  },
  {
    jsName: 'axi-foundation.js',
    jsxName: 'axi-foundation.jsx',
    sandeshName: 'sandesh-foundation.jsx',
    extraGlobals: '\nif (typeof window !== "undefined") { window.SandeshLibrary = window.AxiLibrary; window.sandeshCopyCode = window.axiCopyCode; }\n',
  },
  {
    jsName: 'axi-databin-services.js',
    jsxName: 'axi-databin-services.jsx',
    sandeshName: 'sandesh-databin-services.jsx',
    extraGlobals: '\nif (typeof window !== "undefined") { window.SandeshDataBinServices = true; }\n',
  },
  {
    jsName: 'axi-admin-services.js',
    jsxName: 'axi-admin-services.jsx',
    sandeshName: 'sandesh-admin-services.jsx',
    extraGlobals: '\nif (typeof window !== "undefined") { window.SandeshAdminService = window.AxiAdminService; }\n',
  },
  {
    jsName: 'axi-databin-core.js',
    jsxName: 'axi-databin-core.jsx',
    sandeshName: 'sandesh-databin-core.jsx',
    extraGlobals: '\nif (typeof window !== "undefined") { window.SandeshDataBinCore = true; }\n',
  },
  {
    jsName: 'axi-databin-extras.js',
    jsxName: 'axi-databin-extras.jsx',
    sandeshName: 'sandesh-databin-extras.jsx',
    extraGlobals: '\nif (typeof window !== "undefined") { window.SandeshAnalysisDB = window.AxiAnalysisDB; }\n',
  },
  {
    jsName: 'axi-ui-polish.js',
    jsxName: 'axi-ui-polish.jsx',
    sandeshName: 'sandesh-ui-polish.jsx',
    extraGlobals: '\nif (typeof window !== "undefined") { window.SandeshUiPolish = true; }\n',
  },
  {
    jsName: 'axi-push-to-tstruct.js',
    jsxName: 'axi-push-to-tstruct.jsx',
    sandeshName: 'sandesh-push-to-tstruct.jsx',
    extraGlobals: '\nif (typeof window !== "undefined") { window.SandeshPushToTstruct = true; }\n',
  },
];

for (const item of filesToConvert) {
  const srcPath = join(sharedDir, item.jsName);
  let content = readFileSync(srcPath, 'utf8');

  // Rebrand user-facing comments, logs, and labels
  content = content
    .replace(/\bAXI STANDALONE BRIDGE\b/g, 'SANDESH STANDALONE BRIDGE')
    .replace(/\bAXI FOUNDATION\b/g, 'SANDESH FOUNDATION')
    .replace(/\bAXI DATABIN SERVICES\b/g, 'SANDESH DATABIN SERVICES')
    .replace(/\bAXI ADMIN SERVICES\b/g, 'SANDESH ADMIN SERVICES')
    .replace(/\bAXI DATABIN CORE\b/g, 'SANDESH DATABIN CORE')
    .replace(/\bAXI DATABIN EXTRAS\b/g, 'SANDESH DATABIN EXTRAS')
    .replace(/\bAXI UI POLISH\b/g, 'SANDESH UI POLISH')
    .replace(/\bAXI — Standalone Mode\b/g, 'Sandesh — Standalone Mode')
    .replace(/AXI Insights/g, 'Sandesh Insights')
    .replace(/Axpert Insights/g, 'Sandesh Insights');

  // Add extra globals for Sandesh namespace interoperability
  content += item.extraGlobals;

  // Write .jsx files to shared/ and public/
  writeFileSync(join(sharedDir, item.jsxName), content, 'utf8');
  writeFileSync(join(publicDir, item.jsxName), content, 'utf8');
  writeFileSync(join(sharedDir, item.sandeshName), content, 'utf8');
  writeFileSync(join(publicDir, item.sandeshName), content, 'utf8');

  console.log(`Generated .jsx files for ${item.jsName}: ${item.jsxName} & ${item.sandeshName}`);
}

console.log('Successfully converted all 8 files to .jsx format in shared/ and public/.');
