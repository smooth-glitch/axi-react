import React, { useEffect, useState } from 'react';
import { useTheme } from 'styled-components';
import { AlertCircle, Check, Layers } from 'lucide-react';
import { Button, FieldLabel, Input, Sheet, Text } from '../kit';
import ConditionEditor from './ConditionEditor';

// Slide-over drawer for one section: name + optional visibility condition.
export default function SectionEditorSheet({ visible, draft, isNew, fields, onSave, onClose }) {
  const t = useTheme();
  const [d, setD] = useState(draft);
  const [err, setErr] = useState(null);
  useEffect(() => {
    setD(draft);
    setErr(null);
  }, [draft, visible]);

  return (
    <Sheet
      visible={visible && !!d}
      onClose={onClose}
      title={isNew ? 'New section' : 'Edit section'}
      subtitle="Groups fields into a collapsible card"
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} />
          <Button title={isNew ? 'Add section' : 'Save section'} icon={Check} testID="save-section" onPress={() => (d.label.trim() ? onSave(d) : setErr('Give this section a name.'))} />
        </>
      }
    >
      {d ? (
        <div>
          <FieldLabel required>Section name</FieldLabel>
          <Input
            autoFocus={isNew}
            icon={Layers}
            placeholder="e.g. Employer details"
            value={d.label}
            invalid={!!err}
            onChangeText={(v) => {
              setErr(null);
              setD({ ...d, label: v });
            }}
            testID="section-name"
          />
          {err ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: t.spacing.xs, marginTop: t.spacing.xs }}>
              <AlertCircle size={14} color={t.danger} />
              <Text $variant="small" $color="danger">
                {err}
              </Text>
            </div>
          ) : null}
          <div style={{ height: t.spacing.md }} />
          <ConditionEditor value={d.condition} onChange={(c) => setD({ ...d, condition: c })} candidates={fields} noun="section" />
        </div>
      ) : null}
    </Sheet>
  );
}
