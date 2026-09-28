import React, { useEffect, useState } from 'react';
import { useTheme } from 'styled-components';
import { AlertCircle, Check, Layers } from 'lucide-react';
import { Button, FieldLabel, Input, Select, Sheet, SwitchField, Text } from '../kit';
import FieldTypeExtras from './FieldTypeExtras';
import ConditionEditor from './ConditionEditor';
import { iconFor } from '../icons';
import { FIELD_CATALOG, metaFor } from '../../core/fieldTypes';

const typeKey = (c) => c.type + (c.preset?.multiline ? ':ml' : '');

// Slide-over drawer with everything about ONE field: name, type-specific options, required, section, condition.
export default function FieldEditorSheet({ visible, draft, isNew, sections, allDrafts, onSave, onClose }) {
  const t = useTheme();
  const [d, setD] = useState(draft);
  const [err, setErr] = useState(null);
  useEffect(() => {
    setD(draft);
    setErr(null);
  }, [draft, visible]);

  const meta = d ? metaFor(d) : null;
  const MetaIcon = meta ? iconFor(meta.icon) : null;
  const others = d ? allDrafts.filter((x) => x.key !== d.key) : [];
  const save = () => {
    if (!d.label.trim()) return setErr('Give this field a name.');
    onSave(d);
  };

  return (
    <Sheet
      visible={visible && !!d}
      onClose={onClose}
      title={isNew ? 'New field' : 'Edit field'}
      subtitle={meta?.label}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} />
          <Button title={isNew ? 'Add field' : 'Save field'} icon={Check} onPress={save} testID="save-field" />
        </>
      }
    >
      {d ? (
        <div>
          <FieldLabel required>Field name</FieldLabel>
          <Input
            autoFocus={isNew}
            icon={MetaIcon}
            placeholder="e.g. Employment type"
            value={d.label}
            invalid={!!err}
            onChangeText={(v) => {
              setErr(null);
              setD({ ...d, label: v });
            }}
            testID="field-name"
          />
          {err ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: t.spacing.xs, marginTop: t.spacing.xs }}>
              <AlertCircle size={14} color={t.danger} />
              <Text $variant="small" $color="danger">
                {err}
              </Text>
            </div>
          ) : null}

          <FieldLabel>Field type</FieldLabel>
          <Select
            value={typeKey(d.multiline ? { type: d.type, preset: { multiline: true } } : { type: d.type })}
            onChange={(v) => {
              const c = FIELD_CATALOG.find((x) => typeKey(x) === v);
              if (c) setD({ ...d, type: c.type, multiline: !!c.preset?.multiline });
            }}
            options={FIELD_CATALOG.map((c) => ({ value: typeKey(c), label: c.label }))}
            icon={MetaIcon}
          />

          <FieldTypeExtras draft={d} onChange={setD} allDrafts={allDrafts} />

          {d.type !== 'fill' ? <SwitchField label="Required" hint="The form can't be submitted without it" value={!!d.required} onValueChange={(v) => setD({ ...d, required: v })} /> : null}

          <FieldLabel hint={sections.length ? undefined : 'Add a section from the builder to group fields'}>Section</FieldLabel>
          <Select
            value={d.sectionKey}
            onChange={(v) => setD({ ...d, sectionKey: v })}
            options={sections.filter((x) => x.label.trim()).map((x) => ({ value: x.key, label: x.label }))}
            placeholder="(none)"
            icon={Layers}
            enabled={sections.length > 0}
          />

          <div style={{ height: t.spacing.md }} />
          <ConditionEditor value={d.condition} onChange={(c) => setD({ ...d, condition: c })} candidates={others} noun="field" />
        </div>
      ) : null}
    </Sheet>
  );
}
