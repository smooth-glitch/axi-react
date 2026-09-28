import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from 'styled-components';
import { Pencil, Play, Plus, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, EmptyState, HoverCard, IconButton, IconTile, Input, Sheet, Skeleton, Text } from '../kit';
import { iconFor } from '../icons';
import { Ensure } from '../Provider';
import { deleteOption, listOptions } from '../../core/api';
import { applicableSummary, optionType } from '../../core/options';
import { timeAgo } from '../../core/format';

function OptionsListInner({ onNew, onEdit, onRun, onDeleted, onLoaded, refreshKey }) {
  const t = useTheme();
  const [options, setOptions] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState(null); // option pending deletion
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    setError(null);
    listOptions()
      .then((o) => {
        setOptions(o);
        onLoaded?.(o);
      })
      .catch((e) => {
        setError(e.message);
        setOptions((cur) => cur || []);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const shown = useMemo(() => (options || []).filter((o) => o.caption.toLowerCase().includes(q.trim().toLowerCase())), [options, q]);

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteOption(confirm.id);
      onDeleted?.(confirm);
      setConfirm(null);
      load();
    } catch (e) {
      setError(e.message);
      setConfirm(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <Alert onRetry={load}>{error}</Alert>
      {options === null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: t.spacing.md }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} $height={76} $radius={t.radius.xl} />
          ))}
        </div>
      ) : options.length === 0 && !error ? (
        <EmptyState icon={SlidersHorizontal} title="No options yet — create one" message="An option is a configurable action: open a struct's form, download a file or upload one." actionLabel={onNew ? 'New option' : undefined} actionIcon={Plus} onAction={onNew} />
      ) : (
        <>
          <div style={{ marginBottom: t.spacing.lg, maxWidth: 360 }}>
            <Input icon={Search} value={q} onChangeText={setQ} placeholder="Search options" aria-label="Search options" />
          </div>
          {shown.length === 0 ? (
            <Text $variant="body" $color="textMuted" $center style={{ padding: t.spacing.xxl }}>
              No options match "{q}"
            </Text>
          ) : null}
          {shown.map((o) => {
            const ty = optionType(o.type);
            return (
              <motion.div key={o.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: t.motion.s(t.motion.base) }} style={{ marginBottom: t.spacing.md }}>
                <HoverCard testID={`option-${o.caption}`} onPress={() => onRun?.(o)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg, flexWrap: 'wrap' }}>
                    <IconTile icon={iconFor(ty.icon)} tone={ty.functional ? 'primary' : 'neutral'} size={40} />
                    <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: t.spacing.xs }}>
                      <Text $variant="bodyStrong" $ellipsis>
                        {o.caption}
                      </Text>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: t.spacing.xs, alignItems: 'center' }}>
                        <Badge tone={ty.functional ? 'primary' : 'neutral'}>{ty.label}</Badge>
                        {ty.functional ? null : <Badge tone="warning">Config only</Badge>}
                        <Badge>{`For: ${applicableSummary(o.applicableTo)}`}</Badge>
                        <Text $variant="caption" $color="textFaint" $inline>
                          {o.modifiedAt ? `edited ${timeAgo(o.modifiedAt)}` : `created ${timeAgo(o.createdAt)}`}
                        </Text>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: t.spacing.xs, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                      {onRun ? <Button title="Run" size="sm" icon={Play} onPress={() => onRun(o)} testID={`run-${o.caption}`} /> : null}
                      {onEdit ? <IconButton icon={Pencil} label={`Edit ${o.caption}`} onPress={() => onEdit(o)} testID={`edit-option-${o.caption}`} /> : null}
                      <IconButton icon={Trash2} label={`Delete ${o.caption}`} color={t.danger} hoverBg={t.dangerSoft} onPress={() => setConfirm(o)} testID={`delete-option-${o.caption}`} />
                    </div>
                  </div>
                </HoverCard>
              </motion.div>
            );
          })}
        </>
      )}

      <Sheet
        visible={!!confirm}
        onClose={() => setConfirm(null)}
        title="Delete this option?"
        subtitle={confirm?.caption}
        testID="confirm-delete"
        footer={
          <>
            <Button title="Cancel" variant="secondary" onPress={() => setConfirm(null)} />
            <Button title="Delete option" variant="danger" icon={Trash2} onPress={remove} loading={deleting} testID="confirm-delete-btn" />
          </>
        }
      >
        <Text $variant="body" $color="textMuted" style={{ marginTop: t.spacing.md }}>
          The option is removed for good. A file it downloads stays in the file store.
        </Text>
      </Sheet>
    </div>
  );
}

/**
 * <OptionsList /> - every option (caption + type) with Run / Edit / Delete. Self-contained: it needs no router.
 *   onNew()        shows the empty-state button
 *   onRun(option)  shows a Run button (and runs on card click)
 *   onEdit(option) shows an Edit button
 *   onDeleted(option), onLoaded(options), refreshKey
 */
export function OptionsList(props) {
  return (
    <Ensure>
      <OptionsListInner {...props} />
    </Ensure>
  );
}
