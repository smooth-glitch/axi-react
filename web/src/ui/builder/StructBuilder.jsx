import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import styled, { useTheme } from 'styled-components';
import { ArrowDown, ArrowUp, Copy, GitBranch, Layers, ListPlus, Plus, Trash2 } from 'lucide-react';
import { Alert, Badge, Card, FieldLabel, IconButton, IconTile, Input, Text } from '../kit';
import TypePickerSheet from './TypePickerSheet';
import FieldEditorSheet from './FieldEditorSheet';
import SectionEditorSheet from './SectionEditorSheet';
import { iconFor } from '../icons';
import { metaFor } from '../../core/fieldTypes';
import { newField, newSection } from '../../core/builderModel';

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.md}px;
  padding: ${(p) => p.theme.spacing.md}px;
  border-radius: ${(p) => p.theme.radius.lg}px;
  border: 1px solid ${(p) => p.theme.border};
  background: ${(p) => p.theme.surface};
  cursor: pointer;
  outline: none;
  transition: border-color ${(p) => p.theme.motion.fast}ms ease, background ${(p) => p.theme.motion.fast}ms ease;
  &:hover, &:focus-visible { border-color: ${(p) => p.theme.primary}; background: ${(p) => p.theme.primarySoft}; }
  .acts { display: flex; align-items: center; opacity: 0.55; transition: opacity ${(p) => p.theme.motion.fast}ms ease; }
  &:hover .acts, &:focus-within .acts { opacity: 1; }
`;

const AddRow = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: ${(p) => p.theme.spacing.sm}px;
  width: 100%;
  height: 44px;
  margin-top: ${(p) => p.theme.spacing.md}px;
  border-radius: ${(p) => p.theme.radius.lg}px;
  border: 1.5px dashed ${(p) => p.theme.borderStrong};
  background: transparent;
  color: ${(p) => p.theme.textMuted};
  font-weight: ${(p) => p.theme.fontWeight.semibold};
  font-size: ${(p) => p.theme.type.body.size}px;
  cursor: pointer;
  transition: all ${(p) => p.theme.motion.fast}ms ease;
  &:hover { border-color: ${(p) => p.theme.primary}; background: ${(p) => p.theme.primarySoft}; color: ${(p) => p.theme.primary}; }
`;

const Head = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.md}px;
  margin-bottom: ${(p) => p.theme.spacing.md}px;
`;

const activate = (fn) => (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
    e.preventDefault();
    fn();
  }
};

const item = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, x: -16 },
};

function AddButton({ label, onPress, testID }) {
  return (
    <AddRow type="button" data-testid={testID} aria-label={label} onClick={onPress}>
      <Plus size={16} strokeWidth={2.2} />
      {label}
    </AddRow>
  );
}

function FieldRow({ f, index, count, sections, onEdit, onMove, onDuplicate, onRemove }) {
  const t = useTheme();
  const meta = metaFor(f);
  const section = sections.find((x) => x.key === f.sectionKey);
  return (
    <motion.div layout {...item} transition={{ duration: t.motion.s(t.motion.base) }} style={{ marginBottom: t.spacing.sm }}>
      <Row data-testid={`field-row-${index}`} role="button" tabIndex={0} onClick={onEdit} onKeyDown={activate(onEdit)}>
        <IconTile icon={iconFor(meta.icon)} tone={meta.tone} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: t.spacing.xs }}>
          <Text $variant="bodyStrong" $ellipsis>
            {f.label || 'Untitled field'}
          </Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: t.spacing.xs }}>
            <Badge>{meta.label}</Badge>
            {f.required ? <Badge tone="danger">Required</Badge> : null}
            {section ? (
              <Badge icon={Layers} tone="primary">
                {section.label || 'Section'}
              </Badge>
            ) : null}
            {f.condition ? (
              <Badge icon={GitBranch} tone="warning">
                Conditional
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="acts">
          <IconButton icon={ArrowUp} iconSize={16} label="Move up" onPress={() => onMove(-1)} color={index === 0 ? t.borderStrong : undefined} />
          <IconButton icon={ArrowDown} iconSize={16} label="Move down" onPress={() => onMove(1)} color={index === count - 1 ? t.borderStrong : undefined} />
          <IconButton icon={Copy} iconSize={15} label="Duplicate field" onPress={onDuplicate} />
          <IconButton icon={Trash2} iconSize={15} label="Remove field" onPress={onRemove} color={t.danger} hoverBg={t.dangerSoft} />
        </div>
      </Row>
    </motion.div>
  );
}

function SectionRow({ sec, fieldCount, onEdit, onRemove }) {
  const t = useTheme();
  return (
    <motion.div layout {...item} transition={{ duration: t.motion.s(t.motion.base) }} style={{ marginBottom: t.spacing.sm }}>
      <Row role="button" tabIndex={0} onClick={onEdit} onKeyDown={activate(onEdit)}>
        <IconTile icon={Layers} tone="warning" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: t.spacing.xs }}>
          <Text $variant="bodyStrong">{sec.label || 'Untitled section'}</Text>
          <div style={{ display: 'flex', gap: t.spacing.xs }}>
            <Badge>{`${fieldCount} field${fieldCount === 1 ? '' : 's'}`}</Badge>
            {sec.condition ? (
              <Badge icon={GitBranch} tone="warning">
                Conditional
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="acts">
          <IconButton icon={Trash2} iconSize={15} label="Remove section" onPress={onRemove} color={t.danger} hoverBg={t.dangerSoft} />
        </div>
      </Row>
    </motion.div>
  );
}

function Block({ title, subtitle, count, children }) {
  const t = useTheme();
  return (
    <Card style={{ padding: t.spacing.lg, marginBottom: t.spacing.lg }}>
      <Head>
        <div style={{ flex: 1 }}>
          <Text $variant="title">{title}</Text>
          {subtitle ? (
            <Text $variant="small" $color="textMuted">
              {subtitle}
            </Text>
          ) : null}
        </div>
        {count !== undefined ? <Badge>{String(count)}</Badge> : null}
      </Head>
      {children}
    </Card>
  );
}

// Controlled builder: name (+ optional key) + field list + sections. The parent owns the state (see the New/Edit struct pages).
// Fields are added via a categorised type picker, then edited in a slide-over drawer - no permanent side panel.
export default function StructBuilder({ name, setName, structKey, setStructKey, fields, setFields, sections, setSections, error, nameError }) {
  const t = useTheme();
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(null); // { draft, isNew }
  const [editingSec, setEditingSec] = useState(null);

  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j], next[i]];
    setFields(next);
  };
  const removeField = (key) => {
    // Clear conditions that depended on the removed field.
    setFields(fields.filter((f) => f.key !== key).map((f) => (f.condition?.fieldKey === key ? { ...f, condition: undefined } : f)));
    setSections(sections.map((x) => (x.condition?.fieldKey === key ? { ...x, condition: undefined } : x)));
  };
  const removeSection = (key) => {
    setSections(sections.filter((x) => x.key !== key));
    setFields(fields.map((f) => (f.sectionKey === key ? { ...f, sectionKey: undefined } : f)));
  };
  const saveField = (d) => {
    setFields(fields.some((f) => f.key === d.key) ? fields.map((f) => (f.key === d.key ? d : f)) : [...fields, d]);
    setEditing(null);
  };
  const saveSection = (d) => {
    setSections(sections.some((x) => x.key === d.key) ? sections.map((x) => (x.key === d.key ? d : x)) : [...sections, d]);
    setEditingSec(null);
  };

  return (
    <div>
      <Alert>{error}</Alert>

      <Block title="Details" subtitle="A unique name for this struct">
        <FieldLabel required>Struct name</FieldLabel>
        <Input placeholder="e.g. Leave Request" value={name} onChangeText={setName} invalid={!!nameError} testID="struct-name" />
        {setStructKey ? (
          <>
            <FieldLabel hint="Optional stable name other apps can use instead of the id (letters, digits, - and _)">Key</FieldLabel>
            <Input placeholder="e.g. leave-request" autoCapitalize="none" value={structKey || ''} onChangeText={setStructKey} testID="struct-key" />
          </>
        ) : null}
      </Block>

      <Block title="Fields" subtitle="Tap a field to edit its settings" count={fields.length}>
        {fields.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: t.spacing.sm, padding: `${t.spacing.lg}px 0` }}>
            <ListPlus size={28} color={t.textFaint} strokeWidth={1.5} />
            <Text $variant="body" $color="textMuted" $center>
              No fields yet — tap "Add field" to choose a type.
            </Text>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {fields.map((f, i) => (
              <FieldRow
                key={f.key}
                f={f}
                index={i}
                count={fields.length}
                sections={sections}
                onEdit={() => setEditing({ draft: f, isNew: false })}
                onMove={(d) => move(i, d)}
                onDuplicate={() => setFields([...fields.slice(0, i + 1), { ...f, id: undefined, key: newField().key, label: f.label ? `${f.label} copy` : '' }, ...fields.slice(i + 1)])}
                onRemove={() => removeField(f.key)}
              />
            ))}
          </AnimatePresence>
        )}
        <AddButton label="Add field" onPress={() => setPicking(true)} testID="add-field" />
      </Block>

      <Block title="Sections" subtitle="Optional — group fields and show them conditionally" count={sections.length}>
        {sections.length === 0 ? (
          <Text $variant="body" $color="textMuted">
            No sections. Fields are shown in one list.
          </Text>
        ) : (
          <AnimatePresence initial={false}>
            {sections.map((sec) => (
              <SectionRow
                key={sec.key}
                sec={sec}
                fieldCount={fields.filter((f) => f.sectionKey === sec.key).length}
                onEdit={() => setEditingSec({ draft: sec, isNew: false })}
                onRemove={() => removeSection(sec.key)}
              />
            ))}
          </AnimatePresence>
        )}
        <AddButton label="Add section" onPress={() => setEditingSec({ draft: newSection(), isNew: true })} testID="add-section" />
      </Block>

      <TypePickerSheet
        visible={picking}
        onClose={() => setPicking(false)}
        onPick={(c) => {
          setPicking(false);
          setEditing({ draft: newField(c.type, c.preset), isNew: true });
        }}
      />
      <FieldEditorSheet visible={!!editing} draft={editing?.draft} isNew={editing?.isNew} sections={sections} allDrafts={fields} onClose={() => setEditing(null)} onSave={saveField} />
      <SectionEditorSheet visible={!!editingSec} draft={editingSec?.draft} isNew={editingSec?.isNew} fields={fields} onClose={() => setEditingSec(null)} onSave={saveSection} />
    </div>
  );
}
