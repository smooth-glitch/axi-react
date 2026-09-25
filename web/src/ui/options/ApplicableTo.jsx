import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import styled, { useTheme } from 'styled-components';
import { Info, Layers, X } from 'lucide-react';
import { Badge, Card, FieldLabel, Text } from '../kit';
import { BLOCKS, KNOWN_CATEGORIES, visibleBlocks } from '../../core/options';

const Seg = styled.div`
  display: inline-flex;
  padding: 2px;
  border-radius: ${(p) => p.theme.radius.lg}px;
  background: ${(p) => p.theme.surfaceAlt};
  border: 1px solid ${(p) => p.theme.border};
`;

const SegBtn = styled.button`
  border: 0;
  cursor: pointer;
  padding: ${(p) => p.theme.spacing.xs + 2}px ${(p) => p.theme.spacing.lg}px;
  border-radius: ${(p) => p.theme.radius.md}px;
  font-size: ${(p) => p.theme.type.small.size}px;
  font-weight: ${(p) => p.theme.fontWeight.semibold};
  color: ${(p) => (p.$on ? p.theme.text : p.theme.textMuted)};
  background: ${(p) => (p.$on ? p.theme.surface : 'transparent')};
  box-shadow: ${(p) => (p.$on ? p.theme.shadow.sm : 'none')};
  transition: all ${(p) => p.theme.motion.fast}ms ease;
  &:focus-visible { outline: 2px solid ${(p) => p.theme.primary}; }
`;

// All / Selected switch
function Segmented({ value, onChange, id }) {
  return (
    <Seg role="radiogroup" aria-label="Scope">
      {['all', 'selected'].map((v) => (
        <SegBtn key={v} type="button" role="radio" aria-checked={value === v} aria-label={v === 'all' ? 'All' : 'Selected'} data-testid={`${id}-${v}`} $on={value === v} onClick={() => onChange(v)}>
          {v === 'all' ? 'All' : 'Selected'}
        </SegBtn>
      ))}
    </Seg>
  );
}

const Chip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.xs}px;
  padding: 2px ${(p) => p.theme.spacing.sm}px 2px ${(p) => p.theme.spacing.md}px;
  border-radius: ${(p) => p.theme.radius.pill}px;
  background: ${(p) => p.theme.primarySoft};
  color: ${(p) => p.theme.primary};
  font-size: ${(p) => p.theme.type.small.size}px;
  font-weight: ${(p) => p.theme.fontWeight.semibold};
  button { display: flex; border: 0; padding: 2px; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; }
  button:hover { background: ${(p) => p.theme.primary}22; }
`;

const TagBox = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${(p) => p.theme.spacing.xs + 2}px;
  min-height: ${(p) => p.theme.layout.controlHeight}px;
  padding: ${(p) => p.theme.spacing.xs}px ${(p) => p.theme.spacing.sm}px;
  border: 1px solid ${(p) => p.theme.border};
  border-radius: ${(p) => p.theme.radius.lg}px;
  background: ${(p) => p.theme.surface};
  &:focus-within { border-color: ${(p) => p.theme.primary}; box-shadow: ${(p) => p.theme.shadow.focus(p.theme.primary)}; }
  input { flex: 1; min-width: 140px; border: 0; outline: 0; background: transparent; padding: ${(p) => p.theme.spacing.xs}px; color: ${(p) => p.theme.text}; font-size: ${(p) => p.theme.type.body.size}px; }
`;

// Type a value and press Enter (or comma) to add it; Backspace removes the last one.
function TagInput({ values, onChange, placeholder, testID }) {
  const [draft, setDraft] = useState('');
  const add = (raw) => {
    const v = raw.trim();
    if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setDraft('');
  };
  return (
    <TagBox>
      {values.map((v) => (
        <Chip key={v}>
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
            <X size={12} />
          </button>
        </Chip>
      ))}
      <input
        data-testid={testID}
        value={draft}
        placeholder={values.length ? '' : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => add(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
        }}
      />
    </TagBox>
  );
}

const Toggle = styled.button`
  padding: ${(p) => p.theme.spacing.xs + 2}px ${(p) => p.theme.spacing.md}px;
  border-radius: ${(p) => p.theme.radius.pill}px;
  cursor: pointer;
  font-size: ${(p) => p.theme.type.small.size}px;
  font-weight: ${(p) => p.theme.fontWeight.semibold};
  border: 1px solid ${(p) => (p.$on ? p.theme.primary : p.theme.borderStrong)};
  background: ${(p) => (p.$on ? p.theme.primarySoft : p.theme.surface)};
  color: ${(p) => (p.$on ? p.theme.primary : p.theme.textMuted)};
  transition: all ${(p) => p.theme.motion.fast}ms ease;
  &:focus-visible { outline: 2px solid ${(p) => p.theme.primary}; }
`;

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// A field that is "All" or a chosen list.
function ScopeField({ id, label, value, onChange, placeholder }) {
  const t = useTheme();
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <Segmented id={id} value={value.scope} onChange={(scope) => onChange({ ...value, scope })} />
      {value.scope === 'selected' ? (
        <div style={{ marginTop: t.spacing.sm }}>
          <TagInput testID={`${id}-input`} values={value.selected} onChange={(selected) => onChange({ ...value, selected })} placeholder={placeholder} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * "Applicable to" editor (config only - stored, never enforced).
 * value: see core/options.js. The scope blocks below appear/disappear with the SAME evaluateCondition mechanism as
 * struct sections: `userCategories contains "affiliate"` shows the Affiliate scope, `... "employee"` the Employee scope.
 */
export default function ApplicableTo({ value, onChange }) {
  const t = useTheme();
  const uc = value.userCategories;
  const blocks = visibleBlocks(value);
  const setUc = (next) => onChange({ ...value, userCategories: next });
  const toggleCategory = (c) => setUc({ ...uc, selected: uc.selected.includes(c) ? uc.selected.filter((x) => x !== c) : [...uc.selected, c] });
  const custom = uc.selected.filter((c) => !KNOWN_CATEGORIES.includes(c));

  return (
    <div data-testid="applicable-to">
      <div style={{ display: 'flex', gap: t.spacing.sm, alignItems: 'flex-start', padding: t.spacing.md, borderRadius: t.radius.lg, background: t.warningSoft, marginBottom: t.spacing.md }}>
        <Info size={16} color={t.warning} style={{ flex: 'none', marginTop: 2 }} />
        <Text $variant="small" $color="warning">
          Saved with the option but <strong>not enforced yet</strong> — the app has no user identity, so nothing checks these rules when an option is run.
        </Text>
      </div>

      <FieldLabel hint="Which kinds of users this option is for">User categories</FieldLabel>
      <Segmented id="applicable-uc" value={uc.scope} onChange={(scope) => setUc({ ...uc, scope })} />
      {uc.scope === 'selected' ? (
        <div style={{ marginTop: t.spacing.sm, display: 'flex', flexDirection: 'column', gap: t.spacing.sm }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: t.spacing.sm }}>
            {KNOWN_CATEGORIES.map((c) => (
              <Toggle key={c} type="button" data-testid={`cat-${c}`} aria-pressed={uc.selected.includes(c)} $on={uc.selected.includes(c)} onClick={() => toggleCategory(c)}>
                {cap(c)}
              </Toggle>
            ))}
          </div>
          <TagInput testID="cat-custom-input" values={custom} onChange={(list) => setUc({ ...uc, selected: [...uc.selected.filter((c) => KNOWN_CATEGORIES.includes(c)), ...list.map((c) => c.toLowerCase())] })} placeholder="Other category — type and press Enter" />
        </div>
      ) : null}

      <AnimatePresence initial={false}>
        {blocks.map((b) => (
          <motion.div key={b.id} data-testid={`block-${b.id}`} layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: t.motion.s(t.motion.base) }} style={{ marginTop: t.spacing.lg }}>
            <Card style={{ padding: t.spacing.lg, background: t.surfaceAlt }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: t.spacing.sm }}>
                <Layers size={15} color={t.primary} />
                <Text $variant="bodyStrong" style={{ flex: 1 }}>
                  {b.label}
                </Text>
                <Badge tone="primary">{`when categories contain "${b.condition.value}"`}</Badge>
              </div>
              {b.fields.map((f) => (
                <ScopeField
                  key={f.id}
                  id={`scope-${b.id}-${f.id}`}
                  label={f.label}
                  placeholder={f.placeholder}
                  value={value[b.id][f.id]}
                  onChange={(next) => onChange({ ...value, [b.id]: { ...value[b.id], [f.id]: next } })}
                />
              ))}
            </Card>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export { BLOCKS };
