import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import styled, { useTheme } from 'styled-components';
import { ChevronDown, Layers, Send } from 'lucide-react';
import DynamicField from './DynamicField';
import { Alert, Avatar, Button, Text } from './kit';
import { useElementWidth } from './hooks';
import { isFieldVisible } from '../core/conditions';
import { isEmpty, validateField } from '../core/validation';
import { createLogger } from '../core/logger';

const log = createLogger('form');

const Wrap = styled(motion.div)`
  display: flex;
  align-items: flex-start;
  gap: ${(p) => p.theme.spacing.md}px;
`;

const Bubble = styled.div`
  flex: 1;
  min-width: 0;
  background: ${(p) => p.theme.surface};
  border: 1px solid ${(p) => p.theme.border};
  border-radius: ${(p) => p.theme.radius.xl}px;
  border-top-left-radius: ${(p) => p.theme.radius.sm}px;
  padding: ${(p) => p.theme.spacing.lg}px;
  box-shadow: ${(p) => p.theme.shadow.md};
`;

const Track = styled.div`
  height: 6px;
  border-radius: 3px;
  background: ${(p) => p.theme.surfaceAlt};
  overflow: hidden;
`;

const Fill = styled(motion.div)`
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, ${(p) => p.theme.gradient[0]}, ${(p) => p.theme.gradient[1]});
`;

const SectionHead = styled.button`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.sm}px;
  width: 100%;
  padding: ${(p) => p.theme.spacing.md}px 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
`;

const Bar = styled.div`
  position: sticky;
  bottom: 0;
  z-index: 5;
  margin-top: ${(p) => p.theme.spacing.lg}px;
  padding: ${(p) => p.theme.spacing.md}px 0;
  display: flex;
  justify-content: flex-end;
  gap: ${(p) => p.theme.spacing.md}px;
  background: ${(p) => p.theme.bg};
  box-shadow: 0 -12px 12px -8px ${(p) => p.theme.bg};
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(${(p) => p.$cols}, minmax(0, 1fr));
  column-gap: ${(p) => p.theme.spacing.lg}px;
`;

// Fields sit side by side: 1 / 2 / 3 columns depending on the width of the form. Long inputs (multi-line text,
// location) always take a full row.
const spansRow = (f) => f.type === 'location' || (f.type === 'text' && f.multiline);

function FieldGrid({ width, items }) {
  const t = useTheme();
  const cols = width >= t.layout.gridThreeCol ? 3 : width >= t.layout.gridTwoCol ? 2 : 1;
  return (
    <Grid $cols={cols}>
      <AnimatePresence initial={false}>
        {items.map((it) => (
          <motion.div
            key={it.key}
            layout="position"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: t.motion.s(t.motion.fast) } }}
            transition={{ duration: t.motion.s(t.motion.base) }}
            style={{ gridColumn: it.full ? '1 / -1' : 'auto', minWidth: 0 }}
          >
            {it.node}
          </motion.div>
        ))}
      </AnimatePresence>
    </Grid>
  );
}

// One collapsible section inside the bubble (chevron header, animated body).
function Section({ sec, count, filled, forceOpen, children }) {
  const t = useTheme();
  const [open, setOpen] = useState(true);
  React.useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      style={{ marginTop: t.spacing.md, borderTop: `1px solid ${t.border}` }}
    >
      <SectionHead type="button" onClick={() => setOpen(!open)} aria-label={sec.label} aria-expanded={open}>
        <Layers size={15} color={t.primary} strokeWidth={2} />
        <Text $variant="bodyStrong" style={{ flex: 1 }}>
          {sec.label}
        </Text>
        <Text $variant="caption" $color="textMuted">
          {filled} of {count} filled
        </Text>
        <motion.span animate={{ rotate: open ? 0 : -90 }} transition={{ duration: t.motion.s(t.motion.fast) }} style={{ display: 'flex' }}>
          <ChevronDown size={16} color={t.textMuted} />
        </motion.span>
      </SectionHead>
      {open ? children : null}
    </motion.div>
  );
}

// Stored record data -> what the inputs hold (numbers are edited as text).
const toInputValues = (struct, data = {}) => {
  const out = { ...data };
  for (const f of struct.fields) {
    if ((f.type === 'wholeNumber' || f.type === 'number') && typeof out[f.id] === 'number') out[f.id] = String(out[f.id]);
  }
  return out;
};

/**
 * Embeddable form renderer. Knows nothing about routing; talks to nobody but its callbacks.
 * props: struct, onSubmit(data) => Promise (may throw an Error with .details [{fieldId,message}]), submitLabel, onCancel,
 *        initialValues (record data, to edit or pre-fill), intro (line under the title), hideHeader
 * Conditions are re-evaluated on every render, i.e. after every field's change. Shown/hidden fields animate.
 */
export default function DynamicForm({ struct, onSubmit, onCancel, submitLabel = 'Submit', initialValues, intro = 'Please fill in the details below.', hideHeader = false }) {
  const t = useTheme();
  const [values, setValues] = useState(() => toInputValues(struct, initialValues));
  const [items, setItems] = useState({}); // selected raw item per selection field, for `fill`
  const [errors, setErrors] = useState({});
  const [errorVersion, setErrorVersion] = useState(0); // bumps on every failed submit, re-opens collapsed sections
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [bubbleRef, bubbleWidth] = useElementWidth();
  const gridWidth = Math.max(0, bubbleWidth - t.spacing.lg * 2); // inner width decides the number of columns

  // Values incl. auto-filled `fill` fields; this is what conditions and validation see.
  const effective = useMemo(() => {
    const out = { ...values };
    for (const f of struct.fields) {
      if (f.type !== 'fill') continue;
      const item = items[f.sourceField];
      if (isEmpty(values[f.sourceField])) out[f.id] = '';
      else if (item) out[f.id] = (f.sourceProp ? item.raw?.[f.sourceProp] : item.label) ?? '';
      else out[f.id] = initialValues?.[f.id] ?? ''; // editing: show the stored value until the options have loaded
    }
    return out;
  }, [values, items, struct, initialValues]);

  const visibleFields = struct.fields.filter((f) => isFieldVisible(f, struct, effective));
  const required = visibleFields.filter((f) => f.required && f.type !== 'fill');
  const done = required.filter((f) => !isEmpty(effective[f.id])).length;
  const pct = required.length ? done / required.length : 0;

  const setValue = (field, value, extra) => {
    log.debug(`onChange ${field.id}`, { value, extra });
    setValues((v) => {
      const next = { ...v, [field.id]: value };
      if (field.type === 'mobile' && extra?.country) next[`${field.id}__country`] = extra.country;
      return next;
    });
    if (field.type === 'selection') setItems((i) => ({ ...i, [field.id]: extra }));
    setErrors((e) => ({ ...e, [field.id]: undefined }));
  };

  const fail = (errs) => {
    setErrors(errs);
    setErrorVersion((n) => n + 1);
  };

  const submit = async () => {
    setFormError(null);
    const errs = {};
    for (const f of visibleFields) {
      if (f.type === 'fill') continue;
      const msg = validateField(f, effective[f.id], effective);
      if (msg) errs[f.id] = msg;
    }
    if (Object.keys(errs).length) {
      log.warn('client validation failed', errs);
      fail(errs);
      setFormError(`Please fix ${Object.keys(errs).length} field${Object.keys(errs).length === 1 ? '' : 's'} highlighted below.`);
      return;
    }

    const data = {};
    for (const f of visibleFields) {
      const v = effective[f.id];
      if (isEmpty(v)) continue;
      if (f.type === 'wholeNumber' || f.type === 'number') data[f.id] = Number(v);
      else if (f.type === 'mobile') {
        const p = parsePhoneNumberFromString(String(v), effective[`${f.id}__country`] || f.defaultCountry || 'US');
        data[f.id] = p ? p.number : v;
      } else data[f.id] = v;
    }

    setSubmitting(true);
    try {
      await onSubmit(data);
    } catch (e) {
      setFormError(e.message);
      if (e.details) fail(Object.fromEntries(e.details.map((d) => [d.fieldId, d.message])));
    } finally {
      setSubmitting(false);
    }
  };

  const renderField = (f) => (
    <DynamicField
      field={f}
      value={values[f.id]}
      fillValue={effective[f.id]}
      formData={effective}
      error={errors[f.id]}
      onChange={(v, extra) => setValue(f, v, extra)}
      onHydrate={(item) => setItems((i) => ({ ...i, [f.id]: item }))}
    />
  );
  const toItems = (list) => list.map((f) => ({ key: f.id, full: spansRow(f), node: renderField(f) }));

  const unsectioned = visibleFields.filter((f) => !f.sectionId);
  const sections = (struct.sections || [])
    .map((sec) => ({ sec, fields: visibleFields.filter((f) => f.sectionId === sec.id) }))
    .filter((x) => x.fields.length);

  return (
    <div>
      <Wrap initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: t.motion.s(t.motion.slow) }}>
        {hideHeader ? null : <Avatar name={struct.name} size={36} />}
        <Bubble ref={bubbleRef}>
          {hideHeader ? null : (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: t.spacing.md }}>
                <Text $variant="title" $ellipsis style={{ flex: 1 }}>
                  {struct.name}
                </Text>
                <Text $variant="caption" $color="textFaint">
                  {struct.fields.length} field{struct.fields.length === 1 ? '' : 's'}
                </Text>
              </div>
              <Text $variant="small" $color="textMuted">
                {intro}
              </Text>
            </>
          )}

          {required.length ? (
            <div style={{ marginTop: t.spacing.md, marginBottom: t.spacing.xs }}>
              <Track>
                <Fill initial={false} animate={{ width: `${Math.round(pct * 100)}%` }} transition={{ duration: t.motion.s(t.motion.slow) }} />
              </Track>
              <Text $variant="caption" $color="textMuted" style={{ marginTop: t.spacing.xs + t.spacing.xxs }}>
                {done} of {required.length} required field{required.length === 1 ? '' : 's'} completed
              </Text>
            </div>
          ) : null}

          <div style={{ marginTop: t.spacing.sm }}>
            <Alert>{formError}</Alert>
          </div>

          <FieldGrid width={gridWidth} items={toItems(unsectioned)} />
          <AnimatePresence initial={false}>
            {sections.map(({ sec, fields }) => (
              <Section key={sec.id} sec={sec} count={fields.length} filled={fields.filter((f) => !isEmpty(effective[f.id])).length} forceOpen={fields.some((f) => errors[f.id]) ? errorVersion : 0}>
                <FieldGrid width={gridWidth} items={toItems(fields)} />
              </Section>
            ))}
          </AnimatePresence>
        </Bubble>
      </Wrap>

      <Bar>
        {onCancel ? <Button title="Discard" variant="secondary" onPress={onCancel} /> : null}
        <Button title={submitLabel} icon={Send} onPress={submit} loading={submitting} testID="submit" />
      </Bar>
    </div>
  );
}
