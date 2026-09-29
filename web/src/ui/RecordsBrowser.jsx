import React, { useState } from 'react';
import { useTheme } from 'styled-components';
import { Inbox, Plus, Search } from 'lucide-react';
import { EmptyState, Input } from './kit';
import RecordTable from './RecordTable';
import RecordDetail from './RecordDetail';
import ConfirmSheet from './ConfirmSheet';

// Search box + records (table / cards) + detail drawer. Shared by the studio's Records page and the embeddable <RecordList>.
//   onEdit(record)  optional - shows an "Edit record" button in the drawer
//   onDelete(record) optional - async; shows a Delete button (with confirmation) in the drawer
//   canEdit(record) optional - hides Edit/Delete for records the user may not change (the server enforces it too)
//   onAdd()         optional - action of the empty state
export default function RecordsBrowser({ struct, records, onEdit, onDelete, canEdit, onAdd }) {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(null); // { record, number }
  const [confirm, setConfirm] = useState(null); // record awaiting delete confirmation

  if (records.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No records yet"
        message="Records you submit through this struct's form will show up here."
        actionLabel={onAdd ? 'New record' : undefined}
        actionIcon={Plus}
        onAction={onAdd}
      />
    );
  }

  return (
    <>
      <div style={{ marginBottom: t.spacing.lg, maxWidth: 360 }}>
        <Input icon={Search} value={query} onChangeText={setQuery} placeholder="Search records" aria-label="Search records" />
      </div>
      <RecordTable struct={struct} records={records} query={query} selectedId={open?.record.id} onOpen={(record, number) => setOpen({ record, number })} />
      <RecordDetail
        struct={struct}
        record={open?.record}
        number={open?.number}
        onClose={() => setOpen(null)}
        onEdit={
          onEdit && (!canEdit || (open && canEdit(open.record)))
            ? () => {
                const rec = open.record;
                setOpen(null);
                onEdit(rec);
              }
            : undefined
        }
        onDelete={onDelete && (!canEdit || (open && canEdit(open.record))) ? () => setConfirm(open.record) : undefined}
      />
      <ConfirmSheet
        visible={!!confirm}
        title="Delete this record?"
        message={`Record #${open?.number ?? ''} will be permanently deleted. This can't be undone.`}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await onDelete(confirm);
          setOpen(null);
        }}
      />
    </>
  );
}
