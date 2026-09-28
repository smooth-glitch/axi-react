import React from 'react';
import { motion } from 'framer-motion';
import styled, { useTheme } from 'styled-components';
import { Plus } from 'lucide-react';
import { IconTile, Sheet, Text } from '../kit';
import { iconFor } from '../icons';
import { CATEGORIES, FIELD_CATALOG } from '../../core/fieldTypes';

const Row = styled(motion.button)`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.md}px;
  width: 100%;
  padding: ${(p) => p.theme.spacing.sm}px ${(p) => p.theme.spacing.md}px;
  border: 0;
  border-radius: ${(p) => p.theme.radius.lg}px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background ${(p) => p.theme.motion.fast}ms ease;
  &:hover { background: ${(p) => p.theme.primarySoft}; }
  &:hover .plus { opacity: 1; color: ${(p) => p.theme.primary}; transform: scale(1.15); }
  &:focus-visible { outline: 2px solid ${(p) => p.theme.primary}; }
  .plus { opacity: 0.35; color: ${(p) => p.theme.textFaint}; transition: all ${(p) => p.theme.motion.fast}ms ease; display: flex; }
`;

// Categorised field-type chooser (Basic / Components / Special) in a slide-over drawer.
export default function TypePickerSheet({ visible, onPick, onClose }) {
  const t = useTheme();
  let n = 0;
  return (
    <Sheet visible={visible} onClose={onClose} title="Add a field" subtitle="Choose what kind of data it holds">
      {CATEGORIES.map((cat) => (
        <div key={cat} style={{ marginTop: t.spacing.lg }}>
          <Text $variant="label" $color="textMuted" style={{ marginBottom: t.spacing.xs, letterSpacing: 0.5 }}>
            {cat.toUpperCase()}
          </Text>
          {FIELD_CATALOG.filter((c) => c.category === cat).map((c) => (
            <Row
              key={c.label}
              type="button"
              data-testid={`type-${c.label}`}
              aria-label={c.label}
              onClick={() => onPick(c)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: t.motion.s(t.motion.base), delay: (n++) * 0.025 }}
            >
              <IconTile icon={iconFor(c.icon)} tone={c.tone} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text $variant="bodyStrong">{c.label}</Text>
                <Text $variant="caption" $color="textMuted">
                  {c.hint}
                </Text>
              </div>
              <span className="plus">
                <Plus size={16} />
              </span>
            </Row>
          ))}
        </div>
      ))}
    </Sheet>
  );
}
