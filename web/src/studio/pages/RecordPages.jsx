import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTheme } from 'styled-components';
import { Inbox, Pencil, Plus } from 'lucide-react';
import Page from '../Page';
import RecordsBrowser from '../../ui/RecordsBrowser';
import { StructForm } from '../../ui/StructForm';
import { Alert, Button, EmptyState, IconButton, Skeleton, useToast } from '../../ui/kit';
import { useWindowWidth } from '../../ui/hooks';
import { getStruct, listRecords } from '../../core/api';
import { fullDate } from '../../core/format';
import { useStructs } from '../StructsContext';

// Records: opened from the sidebar; lists every record of the struct, "New record" opens the form.
export function Records() {
  const { id } = useParams();
  const navigate = useNavigate();
  const t = useTheme();
  const width = useWindowWidth();
  const { refresh } = useStructs();
  const [struct, setStruct] = useState(null);
  const [records, setRecords] = useState(null);
  const [error, setError] = useState(null);
  const narrow = width < t.layout.tableBreakpoint;

  const load = useCallback(() => {
    setError(null);
    setStruct(null);
    setRecords(null);
    Promise.all([getStruct(id), listRecords(id)])
      .then(([s, r]) => {
        setStruct(s);
        setRecords(r);
        refresh(); // keep sidebar counts in sync
      })
      .catch((e) => setError(e.message));
  }, [id, refresh]);
  useEffect(() => {
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = () => navigate(`/structs/${id}/form`);
  const edit = () => navigate(`/structs/${id}/edit`);
  const total = records?.length ?? 0;

  return (
    <Page
      title={struct ? struct.name : ' '}
      subtitle={records ? `${total} record${total === 1 ? '' : 's'}` : 'Loading…'}
      actions={
        <div style={{ display: 'flex', gap: t.spacing.sm }}>
          {narrow ? (
            <IconButton icon={Pencil} label="Edit definition" size={40} onPress={edit} testID="edit-definition" />
          ) : (
            <Button title="Edit definition" icon={Pencil} variant="secondary" onPress={edit} testID="edit-definition" />
          )}
          <Button title="New record" icon={Plus} onPress={add} testID="add-record" />
        </div>
      }
    >
      {error ? (
        <EmptyState icon={Inbox} title="Couldn't load this struct" message={error} actionLabel="Try again" onAction={load} />
      ) : !records || !struct ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: t.spacing.md }}>
          <Skeleton $height={40} />
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} $height={48} />
          ))}
        </div>
      ) : (
        <RecordsBrowser struct={struct} records={records} onAdd={add} onEdit={(rec) => navigate(`/structs/${id}/record/${rec.id}`)} />
      )}
    </Page>
  );
}

// New record: the struct's form on the whole centre pane.
export function NewRecord() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh } = useStructs();
  const [struct, setStruct] = useState(null);
  const toRecords = () => navigate(`/structs/${id}/records`, { replace: true });

  return (
    <Page title={struct ? `New ${struct.name} record` : 'New record'} subtitle={struct ? 'Fill in the form and submit' : undefined} onBack={toRecords} width="full">
      <StructForm
        struct={id}
        onLoaded={({ struct: s }) => setStruct(s)}
        onCancel={toRecords}
        onSubmitted={(record, { struct: s }) => {
          refresh();
          toast.show({ title: 'Record saved', message: `New ${s.name} record created successfully.` });
          toRecords();
        }}
      />
    </Page>
  );
}

// Edit record: the struct's form pre-filled with a saved record; submitting replaces the record's data.
export function EditRecord() {
  const { id, recordId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh } = useStructs();
  const [info, setInfo] = useState({});
  const toRecords = () => navigate(`/structs/${id}/records`, { replace: true });

  return (
    <Page title={info.struct ? `Edit ${info.struct.name} record` : 'Edit record'} subtitle={info.record ? `Created ${fullDate(info.record.createdAt)}` : undefined} onBack={toRecords} width="full">
      <StructForm
        struct={id}
        mode="edit"
        recordId={recordId}
        onLoaded={setInfo}
        onCancel={toRecords}
        onSubmitted={(record, { struct: s }) => {
          refresh();
          toast.show({ title: 'Record updated', message: `${s.name} record saved.` });
          toRecords();
        }}
      />
    </Page>
  );
}

export { Alert };
