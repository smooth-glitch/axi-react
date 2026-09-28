import React, { useMemo } from 'react';
import styled, { useTheme } from 'styled-components';
import { ChevronRight, SearchX } from 'lucide-react';
import { Card, HoverCard, Text } from './kit';
import { useElementWidth } from './hooks';
import { formatValue, hasValue, timeAgo } from '../core/format';

const NUM_W = 56;
const DATE_W = 140;
const COL_MIN = 150;

const HeadRow = styled.div`
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 ${(p) => p.theme.spacing.lg}px;
  background: ${(p) => p.theme.surfaceAlt};
  border-bottom: 1px solid ${(p) => p.theme.border};
`;

const BodyRow = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  min-height: 48px;
  padding: 0 ${(p) => p.theme.spacing.lg}px;
  border-bottom: 1px solid ${(p) => p.theme.border};
  background: ${(p) => (p.$selected ? p.theme.primarySoft : 'transparent')};
  cursor: pointer;
  outline: none;
  transition: background ${(p) => p.theme.motion.fast}ms ease;
  &:last-child { border-bottom: 0; }
  &:hover { background: ${(p) => (p.$selected ? p.theme.primarySoft : p.theme.surfaceAlt)}; }
  &:focus-visible { box-shadow: inset 0 0 0 2px ${(p) => p.theme.primary}; }
  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: ${(p) => p.theme.primary};
    opacity: ${(p) => (p.$selected ? 1 : 0)};
    transition: opacity ${(p) => p.theme.motion.fast}ms ease;
  }
  &:hover::before { opacity: 1; }
`;

const activate = (fn) => (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};

function TableRow({ columns, record, number, selected, onOpen }) {
  return (
    <BodyRow data-testid={`record-${number}`} tabIndex={0} onClick={onOpen} onKeyDown={activate(onOpen)} $selected={selected}>
      <Text $variant="bodyStrong" $color="textMuted" style={{ width: NUM_W, flex: 'none' }}>
        #{number}
      </Text>
      {columns.map((f) => (
        <Text key={f.id} $variant="body" $color={hasValue(record.data[f.id]) ? 'text' : 'textFaint'} $ellipsis style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
          {formatValue(record.data[f.id])}
        </Text>
      ))}
      <Text $variant="small" $color="textMuted" $ellipsis style={{ width: DATE_W, flex: 'none' }}>
        {timeAgo(record.createdAt)}
      </Text>
    </BodyRow>
  );
}

function CardRow({ struct, record, number, onOpen }) {
  const t = useTheme();
  const filled = struct.fields.filter((f) => hasValue(record.data[f.id])).slice(0, 3);
  return (
    <div style={{ marginBottom: t.spacing.md }}>
      <HoverCard testID={`record-${number}`} onPress={onOpen}>
        <div style={{ padding: t.spacing.lg }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: t.spacing.sm }}>
            <Text $variant="bodyStrong">Record #{number}</Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: t.spacing.xs }}>
              <Text $variant="caption" $color="textMuted" $inline>
                {timeAgo(record.createdAt)}
              </Text>
              <ChevronRight size={16} color={t.textFaint} />
            </div>
          </div>
          {filled.length === 0 ? (
            <Text $variant="small" $color="textFaint">
              No values
            </Text>
          ) : (
            filled.map((f) => (
              <div key={f.id} style={{ display: 'flex', padding: `${t.spacing.xs}px 0`, gap: t.spacing.md }}>
                <Text $variant="small" $color="textMuted" $ellipsis style={{ width: '36%', flex: 'none' }}>
                  {f.label}
                </Text>
                <Text $variant="small" $lines={2} style={{ flex: 1 }}>
                  {formatValue(record.data[f.id])}
                </Text>
              </div>
            ))
          )}
        </div>
      </HoverCard>
    </div>
  );
}

// Records as a real table on wide panes; below the breakpoint each record becomes a stacked card (no horizontal scrolling).
export default function RecordTable({ struct, records, query, selectedId, onOpen }) {
  const t = useTheme();
  const [ref, width] = useElementWidth();
  const total = records.length;
  const term = (query || '').trim().toLowerCase();

  const rows = useMemo(
    () =>
      records
        .map((r, i) => ({ r, number: total - i })) // records arrive newest first
        .filter(({ r }) => !term || Object.values(r.data).some((v) => formatValue(v).toLowerCase().includes(term))),
    [records, total, term]
  );

  const asTable = width >= t.layout.tableBreakpoint;
  const cols = Math.max(1, Math.min(struct.fields.length, Math.floor((width - NUM_W - DATE_W - t.spacing.lg * 2) / COL_MIN)));
  const columns = struct.fields.slice(0, cols);
  const hidden = struct.fields.length - columns.length;

  return (
    <div ref={ref}>
      {rows.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: t.spacing.xxxl, gap: t.spacing.sm }}>
          <SearchX size={24} color={t.textFaint} />
          <Text $variant="body" $color="textMuted">
            No records match "{query}"
          </Text>
        </div>
      ) : asTable ? (
        <Card style={{ overflow: 'hidden' }}>
          <HeadRow>
            <Text $variant="label" $color="textMuted" style={{ width: NUM_W, flex: 'none' }}>
              #
            </Text>
            {columns.map((f) => (
              <Text key={f.id} $variant="label" $color="textMuted" $ellipsis style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
                {f.label}
              </Text>
            ))}
            <Text $variant="label" $color="textMuted" style={{ width: DATE_W, flex: 'none' }}>
              Created
            </Text>
          </HeadRow>
          {rows.map(({ r, number }) => (
            <TableRow key={r.id} columns={columns} record={r} number={number} selected={r.id === selectedId} onOpen={() => onOpen(r, number)} />
          ))}
        </Card>
      ) : (
        rows.map(({ r, number }) => <CardRow key={r.id} struct={struct} record={r} number={number} onOpen={() => onOpen(r, number)} />)
      )}
      {asTable && hidden > 0 && rows.length > 0 ? (
        <Text $variant="caption" $color="textMuted" style={{ marginTop: t.spacing.sm }}>
          Showing {columns.length} of {struct.fields.length} fields — open a row to see all of them.
        </Text>
      ) : null}
    </div>
  );
}
