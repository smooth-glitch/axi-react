import { useEffect, useState } from 'react';
import { ensureDataPinState, useDataPinVersion } from '../store';
import { saveCurrentDataBin } from '../logic';
import StepDatasources from './StepDatasources';
import StepFiles from './StepFiles';
import StepName from './StepName';
import { SourceList, FileList } from './SelectionRail';

// Mirrors index.html:131-317 (#dataBinPage markup) + core.js's
// renderDataBinStep/validateOptionalDataBinStep/bindDataBinOverrideClick
// (core.js:821-858, 4077-4301 — the *live* override, not the original
// all-steps-required validator; see EXTRACTION_NOTES.md item 7/10).
export default function DataBinWizard({ step, onStepChange, onClose }) {
  useDataPinVersion();
  const state = ensureDataPinState();
  const [status, setStatus] = useState(null); // { type: 'error'|'success', message }
  const [expandedIdx, setExpandedIdx] = useState(null);

  useEffect(() => {
    function onExternalStatus(e) { setStatus(e.detail); }
    window.addEventListener('axi-databin-status', onExternalStatus);
    return () => window.removeEventListener('axi-databin-status', onExternalStatus);
  }, []);

  // Step 1/2 are optional (validateOptionalDataBinStep); only step 3 requires a name.
  function validateStep(targetStep) {
    if (targetStep === 3 && !String(state.name || '').trim()) {
      setStatus({ type: 'error', message: 'Enter a name for this Data Bin.' });
      return false;
    }
    setStatus(null);
    return true;
  }

  function goToStep(next) {
    const safe = Math.max(1, Math.min(3, next));
    onStepChange(safe);
  }

  function handleNext() {
    if (!validateStep(step)) return;
    goToStep(step + 1);
  }

  function handleTab(target) {
    if (target > step && !validateStep(step)) return;
    goToStep(target);
  }

  async function handleSave() {
    const result = await saveCurrentDataBin(state.name);
    if (result.type === 'error') {
      setStatus(result);
      if (result.step) goToStep(result.step);
      return;
    }
    setStatus(result);
    setTimeout(() => onClose(), 180);
  }

  return (
    <div className="dataBinPageShell">
      <header className="dataBinPageHeader dataBinPageHeader--minimal">
        <div className="dataBinPageHeaderMain">
          <h1 className="dataBinWizardTitle">Create Data Bin</h1>
          <p className="dataBinPageIntro">Follow 3 simple steps to build a Data Bin.</p>
        </div>

        <div className="dataBinPageHeaderActions">
          <button className="miniBtn miniBtn--secondary" type="button" onClick={onClose}>
            <span className="material-icons">arrow_back</span>
            <span>Back</span>
          </button>

          {step > 1 && (
            <button className="miniBtn miniBtn--secondary" type="button" onClick={() => goToStep(step - 1)}>
              <span className="material-icons">chevron_left</span>
              <span>Previous</span>
            </button>
          )}

          {step < 3 && (
            <button className="miniBtn btn--primary" type="button" onClick={handleNext}>
              <span className="material-icons">chevron_right</span>
              <span>Next</span>
            </button>
          )}

          {step === 3 && (
            <button className="miniBtn btn--primary" type="button" onClick={handleSave}>
              <span className="material-icons">save</span>
              <span>Save Data Bin</span>
            </button>
          )}
        </div>
      </header>

      <nav className="dataBinTabs dataBinSteps" aria-label="Data Bin creation steps">
        <button className={`dataBinTab${step === 1 ? ' is-active' : ''}`} type="button" data-step="1" onClick={() => handleTab(1)}>
          <span className="material-icons">table_rows</span>
          <span>Add DS</span>
        </button>
        <button className={`dataBinTab${step === 2 ? ' is-active' : ''}`} type="button" data-step="2" onClick={() => handleTab(2)}>
          <span className="material-icons">description</span>
          <span>Add Files</span>
        </button>
        <button className={`dataBinTab${step === 3 ? ' is-active' : ''}`} type="button" data-step="3" onClick={() => handleTab(3)}>
          <span className="material-icons">bookmark</span>
          <span>Name Bin</span>
        </button>
      </nav>

      {status && (
        <div id="dataPinStatus" className={`status status--${status.type === 'error' ? 'error' : 'success'}`} style={{ display: 'flex' }}>
          {status.message}
        </div>
      )}

      {step === 1 && <StepDatasources onExpandParam={setExpandedIdx} />}
      {step === 2 && <StepFiles onStatus={setStatus} />}
      {step === 3 && <StepName />}

      <aside className="dataBinSelectionRail">
        <div className="dataBinSelectionRailHead">
          <div className="axiRailHeadRow">
            <div className="axiRailHeadText">
              <h3>Included in this Data Bin</h3>
              <p>Your selected datasources and uploaded files stay visible while you work.</p>
            </div>
            <div className="axiRailHeadActions">
              <button id="axiRailExpandBtn" type="button" className="axiRailToggleBtn" title="Expand to full view">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <polyline points="9 21 3 21 3 15"></polyline>
                  <line x1="21" y1="3" x2="14" y2="10"></line>
                  <line x1="3" y1="21" x2="10" y2="14"></line>
                </svg>
              </button>
              <button id="axiRailCollapseBtn" type="button" className="axiRailToggleBtn" title="Collapse panel">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="axiRailCollapsedTab" id="axiRailCollapsedTab">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
            <path d="M3 5v4c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
            <path d="M3 9v4c0 1.66 4 3 9 3s9-1.34 9-3V9"></path>
            <path d="M3 13v4c0 1.66 4 3 9 3s9-1.34 9-3v-4"></path>
          </svg>
          <span id="axiRailCollapsedCount" className="axiRailCollapsedCount">
            {(state.sources?.length || 0) + (state.files?.length || 0)}
          </span>
          <svg className="axiRailExpandArrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </div>

        <button id="axiRailCloseExpand" type="button" className="axiRailCloseExpand" title="Close expanded view">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
          Close
        </button>

        <div className="axiRailExpandedSections">
          <div className="axiRailExpandedSection">
            <div className="axiRailExpandedSectionHead">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                <path d="M3 5v4c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                <path d="M3 9v4c0 1.66 4 3 9 3s9-1.34 9-3V9"></path>
                <path d="M3 13v4c0 1.66 4 3 9 3s9-1.34 9-3v-4"></path>
              </svg>
              Datasources
            </div>
            <SourceList sources={state.sources || []} expandedIdx={expandedIdx} onToggleExpand={setExpandedIdx} />
          </div>
          <div className="axiRailExpandedSection">
            <div className="axiRailExpandedSectionHead">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
              Files
            </div>
            <FileList files={state.files || []} />
          </div>
        </div>
      </aside>
    </div>
  );
}
