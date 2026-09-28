import React, { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import styled, { useTheme } from 'styled-components';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Text } from './Text';

/* ------------------------------------------------------------------ text input */
const Wrap = styled.div`
  display: flex;
  align-items: ${(p) => (p.$multiline ? 'flex-start' : 'center')};
  gap: ${(p) => p.theme.spacing.sm}px;
  min-height: ${(p) => p.theme.layout.controlHeight}px;
  padding: 0 ${(p) => p.theme.spacing.md}px;
  border: 1px solid ${(p) => (p.$invalid ? p.theme.danger : p.theme.border)};
  border-radius: ${(p) => p.theme.radius.lg}px;
  background: ${(p) => (p.$disabled ? p.theme.surfaceAlt : p.theme.surface)};
  transition: border-color ${(p) => p.theme.motion.fast}ms ease, box-shadow ${(p) => p.theme.motion.fast}ms ease;
  &:hover { border-color: ${(p) => (p.$invalid ? p.theme.danger : p.theme.borderStrong)}; }
  &:focus-within {
    border-color: ${(p) => (p.$invalid ? p.theme.danger : p.theme.primary)};
    box-shadow: ${(p) => p.theme.shadow.focus(p.$invalid ? p.theme.danger : p.theme.primary)};
  }
  & > svg { flex: none; color: ${(p) => p.theme.textFaint}; margin-top: ${(p) => (p.$multiline ? 12 : 0)}px; }
  &:focus-within > svg { color: ${(p) => p.theme.primary}; }
`;

const Field = styled.input`
  flex: 1;
  min-width: 0;
  width: 100%;
  height: ${(p) => p.theme.layout.controlHeight - 2}px;
  border: 0;
  outline: none;
  background: transparent;
  color: ${(p) => p.theme.text};
  font-size: ${(p) => p.theme.type.body.size}px;
  padding: 0;
  color-scheme: ${(p) => p.theme.mode};
  &::placeholder { color: ${(p) => p.theme.textFaint}; }
  &:disabled, &[readonly] { cursor: default; }
`;

const Area = styled.textarea`
  flex: 1;
  min-width: 0;
  width: 100%;
  min-height: 96px;
  border: 0;
  outline: none;
  resize: vertical;
  background: transparent;
  color: ${(p) => p.theme.text};
  font-size: ${(p) => p.theme.type.body.size}px;
  line-height: ${(p) => p.theme.type.body.line}px;
  padding: ${(p) => p.theme.spacing.md}px 0;
  &::placeholder { color: ${(p) => p.theme.textFaint}; }
`;

// icon: lucide component. onChangeText(value) is a convenience over onChange(event). type: text | number | date | time ...
export const Input = forwardRef(function Input({ icon: IconCmp, invalid, multiline, style, className, testID, onChangeText, onChange, right, editable = true, ...rest }, ref) {
  const Tag = multiline ? Area : Field;
  return (
    <Wrap $invalid={invalid} $multiline={multiline} $disabled={!editable} style={style} className={className}>
      {IconCmp ? <IconCmp size={16} strokeWidth={1.9} /> : null}
      <Tag
        ref={ref}
        data-testid={testID}
        readOnly={!editable}
        onChange={(e) => {
          onChangeText?.(e.target.value);
          onChange?.(e);
        }}
        {...rest}
      />
      {right}
    </Wrap>
  );
});

/* ------------------------------------------------------------------ custom dropdown */
const Trigger = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.sm}px;
  height: ${(p) => p.theme.layout.controlHeight}px;
  padding: 0 ${(p) => p.theme.spacing.md}px;
  border: 1px solid ${(p) => (p.$invalid ? p.theme.danger : p.$open ? p.theme.primary : p.theme.border)};
  border-radius: ${(p) => p.theme.radius.lg}px;
  background: ${(p) => (p.$disabled ? p.theme.surfaceAlt : p.theme.surface)};
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  box-shadow: ${(p) => (p.$open ? p.theme.shadow.focus(p.theme.primary) : 'none')};
  transition: border-color ${(p) => p.theme.motion.fast}ms ease, box-shadow ${(p) => p.theme.motion.fast}ms ease;
  outline: none;
  &:hover { border-color: ${(p) => (p.$disabled || p.$invalid ? undefined : p.$open ? p.theme.primary : p.theme.borderStrong)}; }
  &:focus-visible { border-color: ${(p) => p.theme.primary}; box-shadow: ${(p) => p.theme.shadow.focus(p.theme.primary)}; }
  & > svg { flex: none; }
  user-select: none;
`;

const Layer = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
`;

const Menu = styled(motion.div)`
  font-family: ${(p) => p.theme.fontFamily};
  color: ${(p) => p.theme.text};
  position: fixed;
  background: ${(p) => p.theme.surface};
  border: 1px solid ${(p) => p.theme.border};
  border-radius: ${(p) => p.theme.radius.lg}px;
  box-shadow: ${(p) => p.theme.shadow.lg};
  overflow: hidden;
  z-index: 1001;
`;

const Option = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.sm}px;
  height: 36px;
  padding: 0 ${(p) => p.theme.spacing.md}px;
  cursor: pointer;
  background: ${(p) => (p.$active ? p.theme.primarySoft : 'transparent')};
`;

const norm = (options) => options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }));
const MENU_MAX = 264;
const ROW_H = 36;
const SEARCH_H = 48;
const SEARCH_AT = 8; // show a search box from this many options

// Themed dropdown (replaces the browser's native <select> list): popover under the trigger (opens upward when
// there is no room), search box for long lists, arrow / enter / escape keys, check mark on the selected option.
// options: [{value,label}] | string[]. onChange(undefined) is called when the placeholder row is chosen.
export function Select({ value, onChange, options, placeholder = 'Select...', invalid, enabled = true, icon: IconCmp, style, testID }) {
  const t = useTheme();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  const all = useMemo(() => norm(options), [options]);
  const searchable = all.length >= SEARCH_AT;
  const list = useMemo(() => all.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())), [all, q]);
  const selected = all.find((o) => o.value === value);
  // row 0 is the "clear" row (shows the placeholder); options follow
  const rows = useMemo(() => [{ value: undefined, label: placeholder, clear: true }, ...list], [list, placeholder]);

  const close = () => {
    setOpen(false);
    ref.current?.focus({ preventScroll: true });
  };
  const show = () => {
    if (!enabled || !ref.current) return;
    setRect(ref.current.getBoundingClientRect());
    setQ('');
    setActive(Math.max(0, all.findIndex((r) => r.value === value) + 1));
    setOpen(true);
  };
  const pick = (row) => {
    onChange(row.value);
    close();
  };
  const onKey = (e) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === 'ArrowDown') setActive((a) => Math.min(rows.length - 1, a + 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
    else if (e.key === 'Enter' && rows[active]) pick(rows[active]);
    else if (e.key === 'Escape') close();
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) e.preventDefault();
  };

  // keep the popover attached: close when the page scrolls/resizes
  useEffect(() => {
    if (!open) return undefined;
    const off = () => setOpen(false);
    window.addEventListener('resize', off);
    return () => window.removeEventListener('resize', off);
  }, [open]);

  const menuH = Math.min(MENU_MAX, rows.length * ROW_H) + (searchable ? SEARCH_H : 0) + 2;
  const up = rect ? rect.bottom + menuH + t.spacing.lg > window.innerHeight && rect.top > menuH + t.spacing.lg : false;
  const dy = up ? t.spacing.sm : -t.spacing.sm;

  return (
    <>
      <Trigger
        ref={ref}
        data-testid={testID}
        role="combobox"
        aria-expanded={open}
        aria-disabled={!enabled}
        tabIndex={enabled ? 0 : -1}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKey}
        $invalid={invalid}
        $open={open}
        $disabled={!enabled}
        style={style}
      >
        {IconCmp ? <IconCmp size={16} strokeWidth={1.9} color={t.textFaint} /> : null}
        <Text $variant="body" $color={selected ? 'text' : 'textFaint'} $ellipsis style={{ flex: 1 }}>
          {selected ? selected.label : placeholder}
        </Text>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: t.motion.s(t.motion.fast) }} style={{ display: 'flex' }}>
          <ChevronDown size={16} strokeWidth={1.9} color={t.textMuted} />
        </motion.span>
      </Trigger>

      {createPortal(
        <AnimatePresence>
          {open && rect ? (
            <Layer key="select-layer">
              <div style={{ position: 'absolute', inset: 0 }} onClick={close} aria-label="Close options" />
              <Menu
                initial={{ opacity: 0, y: dy, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: dy, scale: 0.98 }}
                transition={{ duration: t.motion.s(t.motion.fast + 40) }}
                style={{ left: rect.left, width: Math.max(rect.width, 180), ...(up ? { bottom: window.innerHeight - rect.top + t.spacing.xs } : { top: rect.bottom + t.spacing.xs }) }}
              >
                {searchable ? (
                  <div style={{ height: SEARCH_H, padding: `0 ${t.spacing.md}px`, borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: t.spacing.sm }}>
                    <Search size={14} color={t.textFaint} />
                    <input
                      autoFocus
                      value={q}
                      onChange={(e) => {
                        setQ(e.target.value);
                        setActive(1);
                      }}
                      onKeyDown={onKey}
                      placeholder="Search..."
                      style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', padding: 0, color: t.text, fontSize: t.type.body.size }}
                    />
                  </div>
                ) : null}
                <div style={{ maxHeight: MENU_MAX, overflowY: 'auto' }} role="listbox">
                  {rows.map((r, i) => {
                    const isSel = !r.clear && r.value === value;
                    return (
                      <Option
                        key={r.clear ? '__clear' : String(r.value)}
                        role="option"
                        aria-label={r.label}
                        aria-selected={isSel}
                        onClick={() => pick(r)}
                        onMouseEnter={() => setActive(i)}
                        $active={i === active}
                      >
                        <Text $variant="body" $color={r.clear ? 'textFaint' : 'text'} $ellipsis style={{ flex: 1, fontWeight: isSel ? t.fontWeight.semibold : t.fontWeight.regular }}>
                          {r.label}
                        </Text>
                        {isSel ? <Check size={15} color={t.primary} strokeWidth={2.4} /> : null}
                      </Option>
                    );
                  })}
                  {list.length === 0 ? (
                    <Text $variant="small" $color="textMuted" style={{ padding: t.spacing.md }}>
                      No matches
                    </Text>
                  ) : null}
                </div>
              </Menu>
            </Layer>
          ) : null}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}

/* ------------------------------------------------------------------ switch + label */
const SwitchRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.md}px;
  padding: ${(p) => p.theme.spacing.sm}px 0;
  cursor: pointer;
  outline: none;
  &:focus-visible { outline: 2px solid ${(p) => p.theme.primary}; outline-offset: 2px; border-radius: ${(p) => p.theme.radius.md}px; }
`;

const Track = styled.span`
  position: relative;
  flex: none;
  width: 40px;
  height: 22px;
  border-radius: 11px;
  background: ${(p) => (p.$on ? p.theme.primary : p.theme.borderStrong)};
  transition: background ${(p) => p.theme.motion.base}ms ease;
`;

const Thumb = styled(motion.span)`
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
`;

export function SwitchField({ label, hint, value, onValueChange }) {
  return (
    <SwitchRow
      role="switch"
      aria-checked={!!value}
      tabIndex={0}
      onClick={() => onValueChange(!value)}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onValueChange(!value);
        }
      }}
    >
      <div style={{ flex: 1 }}>
        <Text $variant="bodyStrong">{label}</Text>
        {hint ? (
          <Text $variant="caption" $color="textMuted">
            {hint}
          </Text>
        ) : null}
      </div>
      <Track $on={!!value}>
        <Thumb animate={{ x: value ? 18 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 32 }} />
      </Track>
    </SwitchRow>
  );
}

const LabelBox = styled.div`
  margin-top: ${(p) => p.theme.spacing.lg}px;
  margin-bottom: ${(p) => p.theme.spacing.xs + p.theme.spacing.xxs}px;
`;

export function FieldLabel({ children, required, hint }) {
  return (
    <LabelBox>
      <Text $variant="label">
        {children}
        {required ? (
          <Text $variant="label" $color="danger" $inline>
            {' *'}
          </Text>
        ) : null}
      </Text>
      {hint ? (
        <Text $variant="caption" $color="textMuted">
          {hint}
        </Text>
      ) : null}
    </LabelBox>
  );
}
