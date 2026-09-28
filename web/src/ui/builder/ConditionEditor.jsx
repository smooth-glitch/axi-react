import React from 'react';
import { motion } from 'framer-motion';
import styled from 'styled-components';
import { GitBranch } from 'lucide-react';
import { Input, Select, SwitchField, Text } from '../kit';
import { optionList } from '../../core/builderModel';

const OPERATORS = [
  { value: 'equals', label: 'is' },
  { value: 'notEquals', label: 'is not' },
  { value: 'gt', label: 'is greater than' },
  { value: 'lt', label: 'is less than' },
  { value: 'contains', label: 'contains' },
];

const Box = styled(motion.div)`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.spacing.sm}px;
  padding: ${(p) => p.theme.spacing.md}px;
  border-radius: ${(p) => p.theme.radius.lg}px;
  border: 1px solid ${(p) => p.theme.border};
  background: ${(p) => p.theme.surfaceAlt};
`;

// "Show only when <field> <operator> <value>" - a plain-language editor for one condition.
// candidates: drafts that can drive the condition (already excludes the owner).
export default function ConditionEditor({ value, onChange, candidates, noun = 'field' }) {
  const usable = candidates.filter((c) => c.label.trim() && c.type !== 'fill');
  const on = !!value;
  const src = value && usable.find((c) => c.key === value.fieldKey);

  return (
    <div>
      <SwitchField
        label={`Show this ${noun} conditionally`}
        hint={on ? undefined : 'Always visible'}
        value={on}
        onValueChange={(v) => onChange(v ? { fieldKey: undefined, operator: 'equals', value: '' } : undefined)}
      />
      {on ? (
        <Box initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
          {usable.length === 0 ? (
            <Text $variant="small" $color="textMuted">
              Add and name another field first — the condition depends on another field's value.
            </Text>
          ) : (
            <>
              <Text $variant="label" $color="textMuted">
                Show only when
              </Text>
              <Select
                value={value.fieldKey}
                onChange={(k) => onChange({ ...value, fieldKey: k, value: '' })}
                options={usable.map((c) => ({ value: c.key, label: c.label }))}
                placeholder="Choose a field"
                icon={GitBranch}
              />
              <Select value={value.operator} onChange={(o) => onChange({ ...value, operator: o || 'equals' })} options={OPERATORS} placeholder="Operator" />
              {src?.type === 'list' && optionList(src).length ? (
                <Select value={value.value} onChange={(v) => onChange({ ...value, value: v ?? '' })} options={optionList(src)} placeholder="Choose a value" />
              ) : (
                <Input placeholder="Value" value={String(value.value ?? '')} onChangeText={(v) => onChange({ ...value, value: v })} inputMode={src && ['wholeNumber', 'number'].includes(src.type) ? 'numeric' : 'text'} autoCapitalize="none" />
              )}
            </>
          )}
        </Box>
      ) : null}
    </div>
  );
}
