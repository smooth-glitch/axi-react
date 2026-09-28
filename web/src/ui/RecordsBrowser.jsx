import React, { useState } from 'react';
import { useTheme } from 'styled-components';
import { Inbox, Plus, Search } from 'lucide-react';
import { EmptyState, Input } from './kit';
import RecordTable from './RecordTable';
import RecordDetail from './RecordDetail';

// Search box + records (table / cards) + detail drawer. Shared by the studio's Records page and the embeddable <RecordList>.
//   onEdit(record)  optional - shows an "Edit record" button in the drawer
//   onAdd()         optional - action of the empty state
export default function RecordsBrowser({ struct, records, onEdit, onAdd }) {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(null); // { record, number }

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
          onEdit
            ? () => {
                const rec = open.record;
                setOpen(null);
                onEdit(rec);
              }
            : undefined
        }
      />
    </>
  );
}
