import { createRoot } from 'react-dom/client';
import DataBinWizard from './components/DataBinWizard';
import { registerGlobalRerenderHook, notify } from './store';
import { loadExistingDataBin, startNewDataBin } from './logic';

// Replaces the wizard portion of axi-databin-core.js / axi-databin-extras.js
// with a React tree, while preserving the global function surface the rest of
// the app calls (see AXIBOT/EXTRACTION_NOTES equivalent report): openDataBinPage,
// closeDataBinPage, openExistingDataBin, startNewDataBin, renderDataPinModal.
//
// IMPORTANT — cutover step required in AXIBOT/index.html: this file's global
// assignments only "win" if it loads AFTER axi-databin-core.js and
// axi-databin-extras.js (last script tag wins for a plain `window.foo = ...`).
// Do not just add this script tag — remove (or gut) the old open/close/existing/
// new/renderDataPinModal definitions from those two files, since leaving both
// versions loaded is a race that depends on tag order and is easy to regress.
// axi-databin-services.js is unaffected by this and must keep loading first.

let root = null;
let container = null;

function ensureRoot() {
  if (root) return root;
  container = document.getElementById('dataBinPage');
  if (!container) {
    throw new Error('[AxiDataBinWizard] #dataBinPage element not found in the page.');
  }
  root = createRoot(container);
  return root;
}

function render(step) {
  const r = ensureRoot();
  r.render(
    <DataBinWizard
      step={step}
      onStepChange={(s) => render(s)}
      onClose={() => window.closeDataBinPage()}
    />
  );
}

let currentStep = 1;

window.openDataBinPage = function openDataBinPage(step = 1) {
  // The original also accepted a string step name ("datasources") from one
  // call site (axi-databin-extras.js:280) due to a load-order bug — see
  // EXTRACTION_NOTES.md item 7. Normalize both forms here deliberately.
  const stepMap = { datasources: 1, files: 2, name: 3 };
  currentStep = typeof step === 'string' ? (stepMap[step] || 1) : (Number(step) || 1);
  if (!container) container = document.getElementById('dataBinPage');
  if (!container) return;
  container.hidden = false;
  document.body.style.overflow = 'hidden';
  render(currentStep);
};

window.closeDataBinPage = function closeDataBinPage() {
  if (!container) container = document.getElementById('dataBinPage');
  if (!container) return;
  container.hidden = true;
  document.body.style.overflow = '';
};

window.openExistingDataBin = async function openExistingDataBin(id) {
  try {
    await loadExistingDataBin(id);
    window.openDataBinPage(1);
  } catch (err) {
    console.error('Failed to open existing Data Bin', err);
  }
};

window.startNewDataBin = async function startNewDataBinGlobal() {
  await startNewDataBin();
  window.openDataBinPage(1);
};

registerGlobalRerenderHook(); // window.renderDataPinModal = notify

// Entry points that call the trigger buttons directly (index.html:
// #axiEsCreateBin, #axiCtrlCreateBin, and any #openDataPin-style button) still
// work unchanged since they call window.startNewDataBin()/openDataBinPage(),
// not anything defined inside axi-databin-core.js's closure.

export function mount() {
  ensureRoot();
}
