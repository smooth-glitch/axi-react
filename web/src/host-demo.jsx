// A stand-in for "another application" that embeds Lite Tstruct Builder. It imports the PUBLIC package API only
// ('@tstruct/react' - aliased to src/embed/index.js in vite.config.js, exactly what `npm i @tstruct/react` would give).
//
// URL parameters (all optional):
//   struct=<id|key>   struct to show                 (default: the first struct)
//   ref=order-42      link records to this host entity
//   mode=new|edit     + recordId=...                   (default: new)
//   values={"days":3} pre-filled values (URL-encoded JSON)
//   brand=green       re-brand through the theme prop
//   iframe=1          use the /embed page inside an <iframe> instead of the component
//   options=1         show the Options components (<OptionsList>, <OptionRun>) instead - no router involved
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OptionRun, OptionsList, RecordList, StructForm, TstructProvider, configure } from '@tstruct/react';

const q = new URLSearchParams(window.location.search);
const struct = q.get('struct') || '';
const recordRef = q.get('ref') || 'order-42';
const mode = q.get('mode') === 'edit' ? 'edit' : 'new';
const recordId = q.get('recordId') || undefined;
let values;
try {
  values = q.get('values') ? JSON.parse(q.get('values')) : undefined;
} catch (e) {
  values = undefined;
}
const API = q.get('api') || 'http://localhost:4000';
const brand = q.get('brand') === 'green' ? { primary: '#0a7d5a', primarySoft: '#e3f6ef', gradient: ['#4fd1a5', '#0a7d5a'] } : undefined;

configure({ apiUrl: API, user: 'host-user' });

// Options inside a host app: the host decides what happens when a dataInput option wants to open a struct's form.
function OptionsDemo() {
  const [running, setRunning] = useState(null);
  const [opened, setOpened] = useState(null);
  return (
    <>
      <section>
        <h2 style={{ margin: '0 0 12px' }}>Options in the host app</h2>
        <OptionsList
          onRun={(o) => {
            setOpened(null);
            setRunning(o);
          }}
        />
      </section>
      {running ? (
        <section data-testid="host-run">
          <OptionRun key={running.id} option={running} onOpenStruct={(s) => setOpened(s)} />
          {opened ? (
            <div data-testid="host-opened" style={{ marginTop: 16 }}>
              <p>
                Host received the struct to open: <b>{opened.name}</b>
              </p>
              <StructForm struct={opened.id} />
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function Host() {
  const [events, setEvents] = useState([]);
  const [refresh, setRefresh] = useState(0);
  const log = (text) => setEvents((e) => [...e, text]);

  // messages from the iframe variant
  useEffect(() => {
    const on = (e) => {
      if (e.data?.source !== 'tstruct') return;
      log(`${e.data.type}${e.data.record ? ` id=${e.data.record.id}` : ''}${e.data.height ? ` height=${e.data.height}` : ''}`);
      if (e.data.type === 'tstruct:submitted') setRefresh((n) => n + 1);
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, []);

  const iframeSrc = `/embed/${encodeURIComponent(struct)}/form?ref=${encodeURIComponent(recordRef)}&origin=${encodeURIComponent(window.location.origin)}${values ? `&values=${encodeURIComponent(JSON.stringify(values))}` : ''}${mode === 'edit' ? `&recordId=${recordId}` : ''}`;

  return (
    <TstructProvider apiUrl={API} user="host-user" theme={brand}>
      <header style={{ background: '#1f2937', color: '#fff', padding: '14px 24px', display: 'flex', gap: 16, alignItems: 'baseline' }}>
        <strong>Acme CRM</strong>
        <span style={{ opacity: 0.7 }}>host application (demo) · order {recordRef}</span>
      </header>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24, display: 'grid', gap: 24 }}>
        {q.get('options') === '1' ? <OptionsDemo /> : null}
        {q.get('options') === '1' ? null : (
        <section>
          <h2 data-testid="host-title" style={{ margin: '0 0 12px' }}>{q.get('iframe') === '1' ? 'Embedded via iframe' : 'Embedded via <StructForm />'}</h2>
          {q.get('iframe') === '1' ? (
            <iframe data-testid="host-iframe" title="tstruct" src={iframeSrc} style={{ width: '100%', height: 640, border: 0 }} />
          ) : (
            <StructForm
              struct={struct}
              mode={mode}
              recordId={recordId}
              initialValues={values}
              recordRef={recordRef}
              meta={{ source: 'host-demo' }}
              onLoaded={({ struct: s }) => log(`loaded ${s.name}`)}
              onSubmitted={(record, info) => {
                log(`submitted ${info.mode} id=${record.id} ref=${record.ref} by=${record.createdBy}`);
                setRefresh((n) => n + 1);
              }}
              onCancel={() => log('cancelled')}
              onError={(e) => log(`error ${e.message}`)}
            />
          )}
        </section>
        )}
        {q.get('options') === '1' ? null : (
        <section>
          <h2 style={{ margin: '0 0 12px' }}>Records linked to {recordRef}</h2>
          <RecordList struct={struct} recordRef={recordRef} refreshKey={refresh} />
        </section>
        )}
        <section>
          <h3 style={{ margin: '0 0 8px' }}>Host event log</h3>
          <pre data-testid="host-events" style={{ background: '#fff', border: '1px solid #ddd', padding: 12, minHeight: 40, whiteSpace: 'pre-wrap' }}>{events.join('\n')}</pre>
        </section>
      </main>
    </TstructProvider>
  );
}

createRoot(document.getElementById('root')).render(<Host />);
