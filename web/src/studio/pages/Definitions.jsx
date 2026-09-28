import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTheme } from 'styled-components';
import { Pencil, Plus, Search, Shapes, Table2 } from 'lucide-react';
import Page from '../Page';
import { Alert, Avatar, Badge, Button, EmptyState, HoverCard, Input, Skeleton, Text } from '../../ui/kit';
import { useStructs } from '../StructsContext';
import { timeAgo } from '../../core/format';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// Definitions: every struct definition in one place. Click one to edit its fields, sections and conditions.
export default function Definitions() {
  const t = useTheme();
  const navigate = useNavigate();
  const { structs, error, refresh } = useStructs();
  const [q, setQ] = useState('');
  const shown = useMemo(() => (structs || []).filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase())), [structs, q]);

  return (
    <Page title="Definitions" subtitle={structs ? `${plural(structs.length, 'struct')} defined` : 'Loading…'} actions={<Button title="New struct" icon={Plus} onPress={() => navigate('/structs/new')} />}>
      <Alert onRetry={refresh}>{error}</Alert>
      {structs === null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: t.spacing.md }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} $height={76} $radius={t.radius.xl} />
          ))}
        </div>
      ) : structs.length === 0 ? (
        <EmptyState icon={Shapes} title="No structs yet — create one" message="Definitions you create show up here, and you can edit them any time." actionLabel="New struct" actionIcon={Plus} onAction={() => navigate('/structs/new')} />
      ) : (
        <>
          <div style={{ marginBottom: t.spacing.lg, maxWidth: 360 }}>
            <Input icon={Search} value={q} onChangeText={setQ} placeholder="Search definitions" aria-label="Search definitions" />
          </div>
          {shown.length === 0 ? (
            <Text $variant="body" $color="textMuted" $center style={{ padding: t.spacing.xxl }}>
              No definitions match "{q}"
            </Text>
          ) : null}
          {shown.map((s) => (
            <motion.div key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: t.motion.s(t.motion.base) }} style={{ marginBottom: t.spacing.md }}>
              <HoverCard testID={`def-${s.name}`} onPress={() => navigate(`/structs/${s.id}/edit`)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg, flexWrap: 'wrap' }}>
                  <Avatar name={s.name} size={40} />
                  <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: t.spacing.xs }}>
                    <Text $variant="bodyStrong" $ellipsis>
                      {s.name}
                    </Text>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: t.spacing.xs, alignItems: 'center' }}>
                      {s.key ? <Badge tone="warning">{s.key}</Badge> : null}
                      <Badge>{plural(s.fieldCount ?? 0, 'field')}</Badge>
                      {s.sectionCount ? <Badge>{plural(s.sectionCount, 'section')}</Badge> : null}
                      <Badge tone={s.recordCount ? 'primary' : 'neutral'}>{plural(s.recordCount ?? 0, 'record')}</Badge>
                      <Text $variant="caption" $color="textFaint" $inline>
                        {s.modifiedAt ? `edited ${timeAgo(s.modifiedAt)}` : `created ${timeAgo(s.createdAt)}`}
                      </Text>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: t.spacing.sm }} onClick={(e) => e.stopPropagation()}>
                    <Button title="Records" size="sm" variant="ghost" icon={Table2} onPress={() => navigate(`/structs/${s.id}/records`)} />
                    <Button title="Edit" size="sm" variant="secondary" icon={Pencil} onPress={() => navigate(`/structs/${s.id}/edit`)} testID={`edit-${s.name}`} />
                  </div>
                </div>
              </HoverCard>
            </motion.div>
          ))}
        </>
      )}
    </Page>
  );
}
