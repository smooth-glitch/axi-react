import React, { useCallback, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { TstructProvider } from '../../ui/Provider';
import { OptionBuilder, OptionRun, OptionsList } from '../../ui/options';
import { postToHost } from '../../core/embedBridge';

/**
 * Chrome-less Options pages for iframes (no sidebar / page header):
 *   /embed/options                       list of options
 *   /embed/options/new                   create an option
 *   /embed/options/:optionId/edit        edit an option
 *   /embed/options/:optionId/run         run an option (dataInput opens /embed/:struct/form inside the iframe)
 * Query: theme=light|dark, origin=<host origin for postMessage>, apiUrl=<override>
 * Messages to window.parent: tstruct:option-saved {option, isNew}, tstruct:option-deleted {option}, tstruct:option-run {optionId, type},
 *   tstruct:resize {height}
 */
export default function OptionEmbed({ view }) {
  const { optionId } = useParams();
  const [q] = useSearchParams();
  const navigate = useNavigate();
  const origin = q.get('origin') || '*';
  const suffix = `?${q.toString()}`;
  const rootRef = useRef(null);

  useEffect(() => {
    document.body.style.background = 'transparent';
  }, []);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => postToHost('resize', { height: Math.ceil(el.getBoundingClientRect().height) }, origin));
    ro.observe(el);
    return () => ro.disconnect();
  }, [origin]);

  const openStruct = useCallback((s) => navigate(`/embed/${encodeURIComponent(s.id)}/form${suffix}`, { replace: true }), [navigate, suffix]);

  return (
    <TstructProvider apiUrl={q.get('apiUrl') || undefined} colorMode={q.get('theme') === 'dark' ? 'dark' : q.get('theme') === 'light' ? 'light' : undefined}>
      <div ref={rootRef} style={{ padding: 8 }}>
        {view === 'list' ? (
          <OptionsList
            onNew={() => navigate(`/embed/options/new${suffix}`)}
            onEdit={(o) => navigate(`/embed/options/${o.id}/edit${suffix}`)}
            onRun={(o) => {
              postToHost('option-run', { optionId: o.id, type: o.type }, origin);
              navigate(`/embed/options/${o.id}/run${suffix}`);
            }}
            onDeleted={(o) => postToHost('option-deleted', { option: o }, origin)}
          />
        ) : null}
        {view === 'builder' ? (
          <OptionBuilder
            optionId={optionId === 'new' ? undefined : optionId}
            onCancel={() => navigate(`/embed/options${suffix}`)}
            onSaved={(option, { isNew }) => {
              postToHost('option-saved', { option, isNew }, origin);
              navigate(`/embed/options${suffix}`, { replace: true });
            }}
          />
        ) : null}
        {view === 'run' ? <OptionRun optionId={optionId} onOpenStruct={openStruct} onEdit={(o) => navigate(`/embed/options/${o.id}/edit${suffix}`)} /> : null}
      </div>
    </TstructProvider>
  );
}
