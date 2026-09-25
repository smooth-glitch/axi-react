import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import styled, { useTheme } from 'styled-components';
import { ArrowRight, Database, Layers, ListTree, PanelLeft, Plus, Shapes, Sparkles } from 'lucide-react';
import Sidebar from '../Sidebar';
import { Avatar, Button, Card, EmptyState, HoverCard, IconTile, Text } from '../../ui/kit';
import { useWindowWidth } from '../../ui/hooks';
import { useStructs } from '../StructsContext';

const Hero = styled(motion.div)`
  position: relative;
  border-radius: ${(p) => p.theme.radius.xl}px;
  padding: ${(p) => p.theme.spacing.xl}px;
  overflow: hidden;
  color: ${(p) => p.theme.onGradient};
  background: linear-gradient(135deg, ${(p) => p.theme.gradient[0]}, ${(p) => p.theme.gradient[1]});
  box-shadow: ${(p) => p.theme.shadow.glow};
`;

const Blob = styled(motion.div)`
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.14);
  pointer-events: none;
`;

// Counts up from 0 on mount (~700ms).
function CountUp({ value }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf;
    const start = Date.now();
    const tick = () => {
      const k = Math.min(1, (Date.now() - start) / 700);
      setN(Math.round(value * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <Text $variant="display">{n}</Text>;
}

const pop = (delay = 0) => ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { type: 'spring', damping: 22, stiffness: 220, delay } });

// Home. Wide: dashboard-style landing in the centre pane (the sidebar lists the structs). Narrow: the list IS the screen.
export default function Home() {
  const t = useTheme();
  const navigate = useNavigate();
  const width = useWindowWidth();
  const { structs } = useStructs();
  const stats = useMemo(
    () => ({
      structs: structs?.length ?? 0,
      records: (structs || []).reduce((n, s) => n + (s.recordCount || 0), 0),
      fields: (structs || []).reduce((n, s) => n + (s.fieldCount || 0), 0),
    }),
    [structs]
  );
  if (width < t.layout.wideBreakpoint) return <Sidebar variant="screen" />;

  if (structs && structs.length === 0) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.bg }}>
        <EmptyState icon={Shapes} title="No structs yet — create one" message="A struct is a form definition: a unique name plus typed fields. Create one, then collect records with it." actionLabel="Create your first struct" actionIcon={Plus} onAction={() => navigate('/structs/new')} />
      </div>
    );
  }
  if (!structs) return <div style={{ height: '100%', background: t.bg }} />;

  const tiles = [
    { label: 'Structs', value: stats.structs, icon: Layers },
    { label: 'Records collected', value: stats.records, icon: Database },
    { label: 'Fields defined', value: stats.fields, icon: ListTree },
  ];

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: t.bg, padding: t.spacing.xxl }}>
      <div style={{ width: '100%', maxWidth: t.layout.contentMaxWidth, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: t.spacing.xl }}>
        <Hero {...pop()}>
          <Blob animate={{ y: [-10, 10, -10] }} transition={{ duration: 5.2, repeat: Infinity, ease: 'easeInOut' }} style={{ width: 180, height: 180, top: -50, right: -30 }} />
          <Blob animate={{ y: [10, -10, 10] }} transition={{ duration: 6.4, repeat: Infinity, ease: 'easeInOut' }} style={{ width: 110, height: 110, bottom: -40, right: 190 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: t.spacing.sm, marginBottom: t.spacing.sm }}>
            <Sparkles size={16} />
            <Text $variant="label" style={{ color: 'inherit', opacity: 0.9 }}>
              LITE TSTRUCT BUILDER
            </Text>
          </div>
          <Text as="h2" $variant="display" style={{ color: 'inherit', margin: 0 }}>
            Design a struct. Collect the data.
          </Text>
          <Text $variant="body" style={{ color: 'inherit', opacity: 0.92, marginTop: t.spacing.sm, maxWidth: 520 }}>
            Pick a struct from the menu to browse its records, or build a new form from typed fields, sections and conditions.
          </Text>
          <div style={{ marginTop: t.spacing.lg }}>
            <Button title="New struct" icon={Plus} variant="secondary" onPress={() => navigate('/structs/new')} />
          </div>
        </Hero>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: t.spacing.lg }}>
          {tiles.map((s, i) => (
            <motion.div key={s.label} style={{ flex: '1 1 220px' }} {...pop(0.12 + i * 0.08)}>
              <Card style={{ padding: t.spacing.lg, display: 'flex', flexDirection: 'column', gap: t.spacing.md }}>
                <IconTile icon={s.icon} tone="primary" />
                <div>
                  <CountUp value={s.value} />
                  <Text $variant="small" $color="textMuted">
                    {s.label}
                  </Text>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>

        <div>
          <Text $variant="title" style={{ marginBottom: t.spacing.md }}>
            Your structs
          </Text>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: t.spacing.lg }}>
            {structs.map((s, i) => (
              <motion.div key={s.id} {...pop(0.3 + Math.min(i, 8) * 0.06)}>
                <HoverCard testID={`home-struct-${s.name}`} onPress={() => navigate(`/structs/${s.id}/records`)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg }}>
                    <Avatar name={s.name} size={40} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text $variant="bodyStrong" $ellipsis>
                        {s.name}
                      </Text>
                      <Text $variant="small" $color="textMuted">
                        {s.fieldCount} field{s.fieldCount === 1 ? '' : 's'} · {s.recordCount} record{s.recordCount === 1 ? '' : 's'}
                      </Text>
                    </div>
                    <ArrowRight size={18} color={t.textFaint} />
                  </div>
                </HoverCard>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export { PanelLeft };
