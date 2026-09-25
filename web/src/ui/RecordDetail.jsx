import React from 'react';
import styled from 'styled-components';
import { Pencil } from 'lucide-react';
import { Button, Sheet, Text } from './kit';
import { formatValue, fullDate, hasValue } from '../core/format';

const Item = styled.div`
  padding: ${(p) => p.theme.spacing.md}px 0;
  border-bottom: 1px solid ${(p) => p.theme.border};
`;

// Right-hand drawer (bottom sheet on narrow screens) with every field of one record. onEdit adds an "Edit record" button.
export default function RecordDetail({ struct, record, number, onClose, onEdit }) {
  return (
    <Sheet
      visible={!!record}
      onClose={onClose}
      title={number ? `Record #${number}` : 'Record'}
      subtitle={record ? `${struct.name} · ${fullDate(record.createdAt)}${record.modifiedAt !== record.createdAt ? ` · edited ${fullDate(record.modifiedAt)}` : ''}` : undefined}
      testID="record-detail"
      footer={
        <>
          <Button title="Close" variant="secondary" onPress={onClose} />
          {onEdit ? <Button title="Edit record" icon={Pencil} onPress={onEdit} testID="edit-record" /> : null}
        </>
      }
    >
      {record
        ? struct.fields.map((f) => (
            <Item key={f.id}>
              <Text $variant="label" $color="textMuted">
                {f.label}
              </Text>
              <Text $variant="body" $color={hasValue(record.data[f.id]) ? 'text' : 'textFaint'} style={{ marginTop: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text' }}>
                {formatValue(record.data[f.id])}
              </Text>
            </Item>
          ))
        : null}
    </Sheet>
  );
}
