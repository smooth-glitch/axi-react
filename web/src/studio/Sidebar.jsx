import React, { useMemo, useState } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import styled, { useTheme } from 'styled-components';
import { Boxes, LayoutDashboard, Monitor, Moon, Plus, Search, Settings2, SlidersHorizontal, Sun, Table2, X } from 'lucide-react';
import { Button, IconButton, Skeleton, Text } from '../ui/kit';
import { useStructs } from './StructsContext';
import { useThemeMode } from '../ui/theme';

const Root = styled.aside`
  position: relative;
  display: flex;
  flex-direction: column;
  background: ${(p) => p.theme.nav};
  backdrop-filter: ${(p) => p.theme.blur};
  overflow: hidden;
  ${(p) => (p.$fixed ? `flex: none; width: ${p.theme.layout.sidebarWidth}px; height: 100%; border-right: 1px solid ${p.theme.navBorder};` : 'height: 100%;')}
  &::before {
    content: '';
    position: absolute;
    inset: 0 0 auto 0;
    height: 220px;
    background: linear-gradient(${(p) => p.theme.gradient[1]}33, ${(p) => p.theme.gradient[1]}00);
    pointer-events: none;
  }
  & > * { position: relative; }
`;

const Brand = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.md}px;
  padding: ${(p) => p.theme.spacing.lg}px ${(p) => p.theme.spacing.lg}px ${(p) => p.theme.spacing.md}px;
`;

const Logo = styled.div`
  width: 34px;
  height: 34px;
  border-radius: ${(p) => p.theme.radius.lg}px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${(p) => p.theme.onGradient};
  background: linear-gradient(135deg, ${(p) => p.theme.gradient[0]}, ${(p) => p.theme.gradient[1]});
  box-shadow: ${(p) => p.theme.shadow.glow};
`;

const SearchBox = styled.label`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.sm}px;
  margin: 0 ${(p) => p.theme.spacing.lg}px;
  padding: 0 ${(p) => p.theme.spacing.md}px;
  height: 36px;
  border-radius: ${(p) => p.theme.radius.lg}px;
  background: ${(p) => p.theme.navSurface};
  border: 1px solid ${(p) => p.theme.navBorder};
  color: ${(p) => p.theme.navMuted};
  transition: border-color ${(p) => p.theme.motion.fast}ms ease;
  &:focus-within { border-color: ${(p) => p.theme.primary}; color: ${(p) => p.theme.primary}; }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    padding: 0;
    color: ${(p) => p.theme.navText};
    font-size: ${(p) => p.theme.type.small.size}px;
  }
  input::placeholder { color: ${(p) => p.theme.navMuted}; }
`;

const Item = styled(motion.a)`
  position: relative;
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.md}px;
  margin: 0 ${(p) => p.theme.spacing.sm}px;
  padding: ${(p) => p.theme.spacing.sm + 1}px ${(p) => p.theme.spacing.md}px;
  border-radius: ${(p) => p.theme.radius.lg}px;
  color: ${(p) => p.theme.navText};
  text-decoration: none;
  cursor: pointer;
  outline: none;
  background: ${(p) => (p.$active ? p.theme.navActive : 'transparent')};
  transition: background ${(p) => p.theme.motion.fast}ms ease, transform ${(p) => p.theme.motion.fast}ms ease;
  & > svg { flex: none; color: ${(p) => (p.$active ? p.theme.primary : p.theme.navMuted)}; transition: color ${(p) => p.theme.motion.fast}ms ease; }
  &:hover { background: ${(p) => (p.$active ? p.theme.navActive : p.theme.navHover)}; transform: translateX(3px); }
  &:hover > svg { color: ${(p) => p.theme.primary}; }
  &:focus-visible { box-shadow: inset 0 0 0 2px ${(p) => p.theme.primary}; }
`;

const Bar = styled(motion.span)`
  position: absolute;
  left: -${(p) => p.theme.spacing.sm}px;
  top: ${(p) => p.theme.spacing.sm}px;
  bottom: ${(p) => p.theme.spacing.sm}px;
  width: 3px;
  border-radius: 3px;
  background: linear-gradient(${(p) => p.theme.gradient[0]}, ${(p) => p.theme.gradient[1]});
`;

const Count = styled.span`
  min-width: 22px;
  padding: 0 ${(p) => p.theme.spacing.sm}px;
  text-align: center;
  border-radius: ${(p) => p.theme.radius.pill}px;
  font-size: ${(p) => p.theme.type.caption.size}px;
  font-weight: ${(p) => p.theme.fontWeight.semibold};
  background: ${(p) => (p.$active ? p.theme.primary : p.theme.navHover)};
  color: ${(p) => (p.$active ? p.theme.primaryText : p.theme.navMuted)};
`;

const Foot = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${(p) => p.theme.spacing.md}px ${(p) => p.theme.spacing.lg}px;
  border-top: 1px solid ${(p) => p.theme.navBorder};
`;

function NavLink({ icon: IconCmp, label, active, onPress, testID, badge, index = 0, children }) {
  const t = useTheme();
  return (
    <Item
      href="#"
      data-testid={testID}
      aria-current={active ? 'page' : undefined}
      $active={active}
      onClick={(e) => {
        e.preventDefault();
        onPress();
      }}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: t.motion.s(t.motion.base), delay: Math.min(index, 12) * 0.03 }}
    >
      {active ? <Bar layoutId="nav-active-bar" transition={{ type: 'spring', stiffness: 500, damping: 34 }} /> : null}
      <IconCmp size={16} strokeWidth={1.9} />
      <Text $variant={active ? 'bodyStrong' : 'body'} $ellipsis style={{ flex: 1, color: 'inherit' }}>
        {label}
      </Text>
      {badge ? <Count $active={active}>{badge}</Count> : null}
      {children}
    </Item>
  );
}

const NEXT = { system: 'light', light: 'dark', dark: 'system' };
const MODE_ICON = { system: Monitor, light: Sun, dark: Moon };

// Struct navigation. variant="sidebar": fixed left menu (wide screens). variant="screen": full-screen home list (narrow).
export default function Sidebar({ variant = 'sidebar' }) {
  const t = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeRef = matchPath('/structs/:ref/:view/*', pathname)?.params.ref;
  const { structs, error, refresh } = useStructs();
  const { preference, setPreference } = useThemeMode();
  const [q, setQ] = useState('');
  const fixed = variant === 'sidebar';
  const ModeIcon = MODE_ICON[preference];

  const shown = useMemo(() => (structs || []).filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase())), [structs, q]);
  // wide: replace (switching structs doesn't build history); narrow: push so Back returns to the list
  const go = (path) => navigate(path, { replace: fixed });
  const isActive = (s) => !['new'].includes(activeRef) && (activeRef === s.id || (s.key && activeRef === s.key)) && /\/(records|form|record)/.test(pathname);

  return (
    <Root $fixed={fixed}>
      <Brand>
        <Logo>
          <Boxes size={18} strokeWidth={2} />
        </Logo>
        <div style={{ flex: 1 }}>
          <Text $variant="title" style={{ color: t.navText }}>
            Tstruct Builder
          </Text>
          <Text $variant="caption" style={{ color: t.navMuted }}>
            Lite
          </Text>
        </div>
      </Brand>

      <div style={{ padding: `0 ${t.spacing.lg}px ${t.spacing.md}px` }}>
        <Button title="New struct" icon={Plus} fullWidth onPress={() => go('/structs/new')} testID="new-struct" />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: t.spacing.md }}>
        <NavLink testID="nav-overview" icon={LayoutDashboard} label="Overview" active={pathname === '/'} onPress={() => go('/')} />
        <NavLink testID="nav-options" icon={SlidersHorizontal} label="Options" active={pathname.startsWith('/options')} onPress={() => go('/options')} />
        <NavLink testID="nav-definitions" icon={Settings2} label="Definitions" active={pathname === '/structs' || pathname === '/structs/new' || pathname.endsWith('/edit')} onPress={() => go('/structs')} />
      </div>

      <SearchBox>
        <Search size={15} strokeWidth={1.9} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search structs" aria-label="Search structs" />
        {q ? (
          <button type="button" aria-label="Clear search" onClick={() => setQ('')} style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', color: 'inherit', display: 'flex' }}>
            <X size={14} />
          </button>
        ) : null}
      </SearchBox>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `${t.spacing.lg}px ${t.spacing.lg}px ${t.spacing.sm}px` }}>
        <Text $variant="label" style={{ color: t.navMuted, letterSpacing: 0.6 }}>
          STRUCTS
        </Text>
        {structs ? (
          <Text $variant="caption" style={{ color: t.navMuted }}>
            {structs.length}
          </Text>
        ) : null}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: t.spacing.lg }}>
        {structs === null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: t.spacing.md, padding: `0 ${t.spacing.lg}px` }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} $height={28} />
            ))}
          </div>
        ) : null}
        {error ? (
          <div style={{ padding: `0 ${t.spacing.lg}px`, display: 'flex', flexDirection: 'column', gap: t.spacing.sm }}>
            <Text $variant="small" $color="danger">
              {error}
            </Text>
            <div>
              <Button title="Retry" variant="secondary" size="sm" onPress={refresh} />
            </div>
          </div>
        ) : null}
        {structs && !error && structs.length === 0 ? (
          <Text $variant="small" style={{ color: t.navMuted, padding: `0 ${t.spacing.lg}px` }}>
            No structs yet — create one
          </Text>
        ) : null}
        {structs && structs.length > 0 && shown.length === 0 ? (
          <Text $variant="small" style={{ color: t.navMuted, padding: `0 ${t.spacing.lg}px` }}>
            No structs match "{q}"
          </Text>
        ) : null}
        {shown.map((s, i) => (
          <NavLink key={s.id} index={i} testID={`nav-struct-${s.name}`} icon={Table2} label={s.name} active={isActive(s)} badge={s.recordCount || undefined} onPress={() => go(`/structs/${s.id}/records`)} />
        ))}
      </div>

      <Foot>
        <Text $variant="caption" style={{ color: t.navMuted }}>
          Theme: {preference}
        </Text>
        <IconButton icon={ModeIcon} label={`Switch theme (now ${preference})`} color={t.navMuted} hoverBg={t.navHover} onPress={() => setPreference(NEXT[preference])} testID="theme-toggle" />
      </Foot>
    </Root>
  );
}
