import { TstructStudio } from "@tstruct/react";

// Opens the Lite Tstruct Builder studio (struct definitions, forms, records, options — everything, including the
// map location picker) inside the app, so it can be clicked through without a separate dev server or tab. The
// studio's own routing is in-memory (MemoryRouter, inside TstructStudio) — it never touches this page's URL.
//
// Dev-only affordance for testing that the code brought into web/ is wired up and working; not part of any real
// Sandesh flow (see the "Open Lite Tstruct Builder" button in TopBar.jsx).
export default function TstructStudioModal({ onClose }) {
  return (
    <div className="sandesh-modal-card-3d tstruct-studio-modal">
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <span className="material-icons modal-header-icon">widgets</span>
          <div>
            <h3>Lite Tstruct Builder</h3>
            <span className="modal-subtitle">Struct definitions, forms, records &amp; options</span>
          </div>
        </div>
        <button type="button" className="close-btn-3d" onClick={onClose} aria-label="Close modal">
          ×
        </button>
      </div>
      <div className="tstruct-studio-body">
        <TstructStudio />
      </div>
    </div>
  );
}
