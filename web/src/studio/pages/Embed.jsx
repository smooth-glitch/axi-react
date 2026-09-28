import React, { useEffect, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { StructForm, RecordList } from '../../ui/StructForm';
import { TstructProvider } from '../../ui/Provider';
import { postToHost } from '../../core/embedBridge';

const parseJson = (s) => {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch (e) {
    return undefined;
  }
};

/**
 * Chrome-less page for iframes: /embed/:structRef/form  and  /embed/:structRef/records
 *
 * Query parameters
 *   recordId      edit this record instead of creating a new one   (form)
 *   values        URL-encoded JSON of pre-filled values            (form, new record)
 *   ref           saved on new/edited records as `ref`; on /records it filters the list
 *   meta          URL-encoded JSON stored as `meta`                (form)
 *   theme         light | dark
 *   hideHeader    1 = hide the struct name/intro header            (form)
 *   submitLabel   text of the submit button
 *   origin        origin of the host page: postMessage target (default: '*')
 *   apiUrl        override the API base URL
 *
 * Messages sent to window.parent (see core/embedBridge.js): tstruct:ready, tstruct:submitted, tstruct:cancelled,
 * tstruct:error, tstruct:resize.
 */
export default function Embed() {
  const { structRef, view } = useParams();
  const [q] = useSearchParams();
  const origin = q.get('origin') || '*';
  const rootRef = useRef(null);
  const values = useMemo(() => parseJson(q.get('values')), [q]);
  const meta = useMemo(() => parseJson(q.get('meta')), [q]);
  const recordId = q.get('recordId') || undefined;
  const ref = q.get('ref') || undefined;

  useEffect(() => {
    document.body.style.background = 'transparent';
  }, []);

  // keep the host informed about our height so it can size the iframe
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => postToHost('resize', { height: Math.ceil(el.getBoundingClientRect().height) }, origin));
    ro.observe(el);
    return () => ro.disconnect();
  }, [origin]);

  return (
    <TstructProvider apiUrl={q.get('apiUrl') || undefined} colorMode={q.get('theme') === 'dark' ? 'dark' : q.get('theme') === 'light' ? 'light' : undefined}>
      <div ref={rootRef} style={{ padding: 8 }}>
        {view === 'records' ? (
          <RecordList struct={structRef} recordRef={ref} />
        ) : (
          <StructForm
            struct={structRef}
            mode={recordId ? 'edit' : 'new'}
            recordId={recordId}
            initialValues={values}
            recordRef={ref}
            meta={meta}
            hideHeader={q.get('hideHeader') === '1'}
            submitLabel={q.get('submitLabel') || undefined}
            onLoaded={({ struct }) => postToHost('ready', { structId: struct.id }, origin)}
            onSubmitted={(record, { mode, struct }) => postToHost('submitted', { structId: struct.id, mode, record }, origin)}
            onCancel={() => postToHost('cancelled', {}, origin)}
            onError={(e) => postToHost('error', { message: e.message }, origin)}
          />
        )}
      </div>
    </TstructProvider>
  );
}
