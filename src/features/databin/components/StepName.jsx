import { ensureDataPinState, notify, useDataPinVersion } from '../store';

// Mirrors the #dataBinPanelName markup + the name-input change handler
// (core.js:805-810: writes trimmed value into window.dataPinState.name).
export default function StepName() {
  useDataPinVersion();
  const state = ensureDataPinState();

  return (
    <section className="dataBinPanel" data-panel="name">
      <div className="dataBinFilesCard">
        <div className="dataBinFilesCardHead">
          <h2>Name your Data Bin</h2>
          <p>Give this collection a clear name so it is easy to recognize later.</p>
        </div>

        <div className="dataBinNameField">
          <span className="material-icons">bookmark</span>
          <input
            type="text"
            className="dataBinStepNameInput"
            value={state.name || ''}
            maxLength={80}
            aria-label="Data Bin name"
            placeholder="Example: Sales + Invoices March 2026"
            onChange={(e) => {
              state.name = e.target.value;
              notify();
            }}
          />
        </div>

        <div className="dataBinFilesSupportText">
          Choose a name that tells you what datasources and files are grouped together.
        </div>
      </div>
    </section>
  );
}
