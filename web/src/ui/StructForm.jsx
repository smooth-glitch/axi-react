import React, { useCallback, useEffect, useState } from 'react';
import { useTheme } from 'styled-components';
import DynamicForm from './DynamicForm';
import RecordsBrowser from './RecordsBrowser';
import { Alert, Skeleton } from './kit';
import { Ensure } from './Provider';
import { createRecord, getRecord, getStruct, listRecords, updateRecord } from '../core/api';

const providerProps = ({ apiUrl, getAuthToken, user, theme, colorMode }) => ({ apiUrl, getAuthToken, user, theme, colorMode });

function StructFormInner({ struct: structRef, mode = 'new', recordId, initialValues, recordRef, meta, onSubmitted, onCancel, onError, onLoaded, submitLabel, intro, hideHeader }) {
  const t = useTheme();
  const [struct, setStruct] = useState(null);
  const [record, setRecord] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    setStruct(null);
    setRecord(null);
    const jobs = [getStruct(structRef)];
    if (mode === 'edit') jobs.push(getRecord(structRef, recordId));
    Promise.all(jobs)
      .then(([s, r]) => {
        setStruct(s);
        if (r) setRecord(r);
        onLoaded?.({ struct: s, record: r });
      })
      .catch((e) => {
        setError(e.message);
        onError?.(e);
      });
  }, [structRef, mode, recordId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  const ready = struct && (mode !== 'edit' || record);
  return (
    <div>
      <Alert onRetry={load}>{error}</Alert>
      {!ready && !error ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: t.spacing.lg }}>
          <Skeleton $height={88} $radius={t.radius.xl} />
          <Skeleton $height={56} />
          <Skeleton $height={56} />
        </div>
      ) : null}
      {ready ? (
        <DynamicForm
          struct={struct}
          initialValues={mode === 'edit' ? record.data : initialValues}
          intro={intro || (mode === 'edit' ? 'Update the details below.' : undefined)}
          submitLabel={submitLabel || (mode === 'edit' ? 'Save changes' : 'Submit')}
          hideHeader={hideHeader}
          onCancel={onCancel}
          onSubmit={async (data) => {
            try {
              const extra = {};
              if (recordRef !== undefined) extra.ref = recordRef;
              if (meta !== undefined) extra.meta = meta;
              const res = mode === 'edit' ? await updateRecord(struct.id, record.id, data, extra) : await createRecord(struct.id, data, extra);
              onSubmitted?.(res.record, { mode, struct });
            } catch (e) {
              onError?.(e);
              throw e; // DynamicForm shows the message / per-field errors
            }
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * <StructForm struct="leave-request" />  - the form of one struct, ready to fill.
 *
 * Props
 *   struct        id or key of the struct (required)
 *   mode          'new' (default) | 'edit'
 *   recordId      record to edit (mode="edit")
 *   initialValues pre-filled values for a NEW record: { fieldId: value }
 *   recordRef     string stored on the saved record as `ref` (link it to an entity of the host app)
 *   meta          object stored on the saved record as `meta`
 *   onSubmitted   (record, { mode, struct }) => void   after the record was saved
 *   onCancel      () => void   shows a Discard button
 *   onError       (error) => void
 *   onLoaded      ({ struct, record }) => void
 *   submitLabel, intro, hideHeader   texts / hide the name header
 *   apiUrl, getAuthToken, user, theme, colorMode   used only when NOT inside <TstructProvider> (see Provider.jsx)
 */
export function StructForm(props) {
  return (
    <Ensure {...providerProps(props)}>
      <StructFormInner {...props} />
    </Ensure>
  );
}

function RecordListInner({ struct: structRef, recordRef, onEditRecord, onAdd, refreshKey }) {
  const t = useTheme();
  const [struct, setStruct] = useState(null);
  const [records, setRecords] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    setError(null);
    Promise.all([getStruct(structRef), listRecords(structRef, { ref: recordRef })])
      .then(([s, r]) => {
        setStruct(s);
        setRecords(r);
      })
      .catch((e) => setError(e.message));
  }, [structRef, recordRef]);
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <div>
      <Alert onRetry={load}>{error}</Alert>
      {!records && !error ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: t.spacing.md }}>
          <Skeleton $height={40} />
          <Skeleton $height={48} />
          <Skeleton $height={48} />
        </div>
      ) : null}
      {struct && records ? <RecordsBrowser struct={struct} records={records} onEdit={onEditRecord} onAdd={onAdd} /> : null}
    </div>
  );
}

/**
 * <RecordList struct="leave-request" recordRef="order-123" onEditRecord={(record) => ...} />
 * Records of one struct (optionally only those saved with the given recordRef), as a table / cards with a detail drawer.
 */
export function RecordList(props) {
  return (
    <Ensure {...providerProps(props)}>
      <RecordListInner {...props} />
    </Ensure>
  );
}
