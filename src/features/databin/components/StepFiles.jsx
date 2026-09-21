import { useRef, useState } from 'react';
import { handleFiles } from '../logic';

// Mirrors core.js:3941-4042 handleFiles + the dropzone wiring at
// core.js:3883-3939. NOTE (see EXTRACTION_NOTES.md item 4-5): in the original,
// clicking the dropzone did NOT open a file picker (#dataBinDropzone/
// #dataBinPicker were never wired to any handler — only whole-panel
// drag-and-drop worked). That's fixed here deliberately: click now opens the
// picker too, since there's no reason to keep that gap.
export default function StepFiles({ onStatus }) {
  const inputRef = useRef(null);
  const [isDrag, setIsDrag] = useState(false);

  async function process(fileList) {
    const result = await handleFiles(fileList);
    if (result) onStatus?.(result);
  }

  return (
    <section className="dataBinPanel" data-panel="files">
      <div className="dataBinFilesCard">
        <div className="dataBinFilesCardHead">
          <h2>Files</h2>
          <p>Upload one or many files to include in this Data Bin.</p>
        </div>

        <div
          className={`dataBinUploadSurface${isDrag ? ' isDrag' : ''}`}
          tabIndex={0}
          role="button"
          aria-label="Upload files to this Data Bin"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDrag(true); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDrag(true); }}
          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDrag(false); }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDrag(false);
            const dt = e.dataTransfer;
            if (dt && dt.files.length) process(dt.files);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".csv,.xlsx,.xls,.txt,.pdf,.docx,.json"
            hidden
            onChange={(e) => {
              if (e.target.files.length) process(e.target.files);
              e.target.value = '';
            }}
          />

          <div className="dataBinUploadSurfaceIcon" aria-hidden="true">
            <span className="material-icons">cloud_upload</span>
          </div>

          <div className="dataBinUploadSurfaceBody">
            <h3>Drop files here</h3>
            <p>Drag and drop files here, or click to browse from your device.</p>
          </div>

          <button type="button" className="miniBtn miniBtn--secondary dataBinUploadSurfaceBtn" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
            <span className="material-icons">folder_open</span>
            <span>Browse files</span>
          </button>
        </div>

        <div className="dataBinFilesSupportText">
          Supports CSV, XLSX, XLS, TXT, PDF, DOCX and JSON.
        </div>
      </div>
    </section>
  );
}
