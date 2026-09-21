import DatasourceChip from './DatasourceChip';
import { removeFile } from '../logic';

// Mirrors renderDataPinSourceChips (core.js:2338-2502) and renderDataPinFiles
// (core.js:2505-2543). Split into two exports because the original markup
// (index.html:288-312) nests #dataPinSourceList and #dataPinFileList inside
// two separate .axiRailExpandedSection blocks, not as adjacent siblings.
// expandedIdx/onToggleExpand are lifted to the wizard so selecting a
// parameterized datasource in Step 1 can auto-expand its param editor here
// (mirrors core.js:1017's window._axiExpandedParamChips.add(srcIdx)).
export function SourceList({ sources, expandedIdx, onToggleExpand }) {
  const isAdmin = !window._axiIsClientEmployee;

  return (
    <div id="dataPinSourceList" className="dataBinPinnedList">
      {!sources.length ? (
        <div className="dataBinPinnedEmpty">
          <span className="material-icons">table_rows</span>
          <span>No datasources added yet.</span>
        </div>
      ) : (
        sources.map((src, idx) => (
          <DatasourceChip
            key={src.name + idx}
            src={src}
            idx={idx}
            isAdmin={isAdmin}
            expanded={expandedIdx === idx}
            onToggleExpand={(i) => onToggleExpand((cur) => (cur === i ? null : i))}
          />
        ))
      )}
    </div>
  );
}

export function FileList({ files }) {
  return (
    <div id="dataPinFileList" className="dataBinPinnedList">
      {!files.length ? (
        <div className="dataBinPinnedEmpty">
          <span className="material-icons">description</span>
          <span>No files added yet.</span>
        </div>
      ) : (
        files.map((file, idx) => (
          <div className="attachmentChip" key={file.name + idx}>
            <div className="attachmentChipthumb">
              <span className="material-icons" style={{ fontSize: 18, color: 'var(--axi-orange)' }}>description</span>
            </div>
            <div className="attachmentChipname" title={file.name}>{file.name}</div>
            <button className="attachmentChipremove" type="button" aria-label="Remove file" onClick={() => removeFile(idx)}>
              <span className="material-icons" style={{ fontSize: 18 }}>close</span>
            </button>
          </div>
        ))
      )}
    </div>
  );
}
