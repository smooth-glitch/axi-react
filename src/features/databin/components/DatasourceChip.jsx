import { useState } from 'react';
import { removeSource, setSourceParam } from '../logic';
import { notify } from '../store';

// Mirrors core.js:2338-2502 renderDataPinSourceChips (per-chip rendering +
// the inline SQL param editor). Expansion state was a global Set
// (window._axiExpandedParamChips) in the original; here it's a prop driven
// by the parent so it survives re-renders keyed on source identity, not index.
export default function DatasourceChip({ src, idx, isAdmin, expanded, onToggleExpand }) {
  const probeStatus = src._probeStatus || 'unknown';
  const isProbing = probeStatus === 'probing';
  const isClean = probeStatus === 'clean';
  const detected = Array.isArray(src._detectedParams) ? src._detectedParams : [];
  const hasParams = detected.length > 0;
  const showParamUi = isAdmin && !isProbing && !isClean;

  return (
    <div className="attachmentChip axChipWithParams">
      <div className="attachmentChipthumb">
        <span className="material-icons" style={{ fontSize: 18, color: 'var(--axi-blue)' }}>
          {isProbing ? 'hourglass_top' : 'table_rows'}
        </span>
      </div>
      <div className="attachmentChipname" title={src.caption || src.name}>
        {src.caption || src.name}
        {isProbing && <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 4 }}>Checking…</span>}
      </div>

      {showParamUi && (
        <button
          type="button"
          className={`axParamConfigBtn${hasParams ? ' has-params' : ''}`}
          title={hasParams ? `${detected.length} parameter(s) configured — click to edit` : 'Configure SQL parameters'}
          onClick={(e) => { e.stopPropagation(); onToggleExpand(idx); }}
        >
          <span className="material-icons" style={{ fontSize: 13 }}>settings</span>
          {hasParams ? <span className="axParamBadge">{detected.length}</span> : <span style={{ fontSize: 11, fontWeight: 600 }}>Params</span>}
        </button>
      )}

      <button
        className="attachmentChipremove"
        type="button"
        aria-label="Remove datasource"
        onClick={() => removeSource(idx)}
      >
        <span className="material-icons" style={{ fontSize: 18 }}>close</span>
      </button>

      {showParamUi && (
        <div className="axParamEditor" hidden={!expanded}>
          <div className="axParamEditorLabel">SQL Parameters for {src.caption || src.name}</div>
          <div className="axParamRows">
            {hasParams ? (
              detected.map((det) => (
                <ParamRow key={det.name} idx={idx} name={det.name} type={det.type} value={src.sqlParams?.[det.name] || ''} />
              ))
            ) : (
              <p className="axParamEmpty">No parameters required.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ParamRow({ idx, name, type, value }) {
  const [local, setLocal] = useState(value);
  return (
    <div className="axParamRow" data-key={name} data-detected="true">
      <span className="axParamNameLabel" title={name}>{name}</span>
      <span className="axParamTypeBadge">{type}</span>
      <span className="axParamSep">=</span>
      <input
        type="text"
        className="axParamInput axParamVal"
        value={local}
        placeholder="Enter value…"
        spellCheck={false}
        onChange={(e) => {
          setLocal(e.target.value);
          setSourceParam(idx, name, e.target.value);
        }}
        onBlur={() => notify()}
      />
    </div>
  );
}
