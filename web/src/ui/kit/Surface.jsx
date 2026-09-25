import React from 'react';
import { motion } from 'framer-motion';
import styled, { keyframes, useTheme } from 'styled-components';
import { AlertCircle } from 'lucide-react';
import { avatarKey } from '../../core/tokens';
import { Text } from './Text';
import { Button } from './Button';

export const Card = styled.div`
  background: ${(p) => p.theme.surface};
  border: 1px solid ${(p) => p.theme.border};
  border-radius: ${(p) => p.theme.radius.xl}px;
  box-shadow: ${(p) => p.theme.shadow.sm};
`;

const BadgeBox = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.xs}px;
  align-self: flex-start;
  padding: ${(p) => p.theme.spacing.xxs}px ${(p) => p.theme.spacing.sm}px;
  border-radius: ${(p) => p.theme.radius.md}px;
  background: ${(p) => (p.$tone === 'neutral' ? p.theme.surfaceAlt : p.theme[`${p.$tone}Soft`])};
  white-space: nowrap;
`;

// tone: neutral | primary | danger | success | warning
export function Badge({ children, tone = 'neutral', icon: IconCmp }) {
  const t = useTheme();
  const fg = tone === 'neutral' ? 'textMuted' : tone;
  return (
    <BadgeBox $tone={tone}>
      {IconCmp ? <IconCmp size={11} color={t[fg]} strokeWidth={2.2} /> : null}
      <Text $variant="label" $color={fg} $inline>
        {children}
      </Text>
    </BadgeBox>
  );
}

const AvatarBox = styled.div`
  width: ${(p) => p.$size}px;
  height: ${(p) => p.$size}px;
  flex: none;
  border-radius: ${(p) => p.theme.radius.lg}px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${(p) => p.theme[`${avatarKey(p.$name)}Soft`] || p.theme.primarySoft};
`;

export function Avatar({ name = '?', size = 32 }) {
  return (
    <AvatarBox $name={name} $size={size}>
      <Text $variant="bodyStrong" $color={avatarKey(name)}>
        {name[0]?.toUpperCase()}
      </Text>
    </AvatarBox>
  );
}

const shimmer = keyframes`
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
`;

// Shimmering placeholder block. Use while data loads instead of a blank screen.
export const Skeleton = styled.div`
  width: ${(p) => (p.$width === undefined ? '100%' : typeof p.$width === 'number' ? `${p.$width}px` : p.$width)};
  height: ${(p) => p.$height || 16}px;
  border-radius: ${(p) => (p.$radius === undefined ? p.theme.radius.md : p.$radius)}px;
  background: linear-gradient(90deg, ${(p) => p.theme.skeleton} 25%, ${(p) => p.theme.skeletonHi} 50%, ${(p) => p.theme.skeleton} 75%);
  background-size: 200% 100%;
  animation: ${shimmer} 1.4s linear infinite;
`;

const EmptyWrap = styled(motion.div)`
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: ${(p) => p.theme.spacing.xxxl}px ${(p) => p.theme.spacing.xl}px;
  gap: ${(p) => p.theme.spacing.sm}px;
`;

const Disc = styled(motion.div)`
  width: 96px;
  height: 96px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: ${(p) => p.theme.spacing.md}px;
  position: relative;
  box-shadow: ${(p) => p.theme.shadow.glow};
  color: ${(p) => p.theme.primary};
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: linear-gradient(135deg, ${(p) => p.theme.gradient[0]}, ${(p) => p.theme.gradient[1]});
    opacity: 0.16;
  }
  & > svg { position: relative; }
`;

// Icon in a soft orange disc that gently floats.
export function EmptyState({ icon: IconCmp, title, message, actionLabel, actionIcon, onAction }) {
  const t = useTheme();
  return (
    <EmptyWrap initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: t.motion.s(t.motion.slow) }}>
      <Disc animate={{ y: [0, -6, 0] }} transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}>
        <IconCmp size={38} strokeWidth={1.6} />
      </Disc>
      <Text $variant="heading" $center>
        {title}
      </Text>
      {message ? (
        <Text $variant="body" $color="textMuted" $center style={{ maxWidth: 380 }}>
          {message}
        </Text>
      ) : null}
      {actionLabel ? (
        <div style={{ marginTop: t.spacing.lg }}>
          <Button title={actionLabel} icon={actionIcon} onPress={onAction} />
        </div>
      ) : null}
    </EmptyWrap>
  );
}

const HoverWrap = styled.div`
  position: relative;
  border-radius: ${(p) => p.theme.radius.xl}px;
  cursor: pointer;
  outline: none;
  transition: transform ${(p) => p.theme.motion.base}ms ease;
  &:hover { transform: translateY(-3px); }
  &:active { transform: scale(0.985); }
  &:focus-visible { box-shadow: 0 0 0 2px ${(p) => p.theme.primary}; }
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: ${(p) => p.theme.radius.xl}px;
    border: 1px solid ${(p) => p.theme.primary};
    box-shadow: ${(p) => p.theme.shadow.lg};
    opacity: 0;
    transition: opacity ${(p) => p.theme.motion.base}ms ease;
  }
  &:hover::after { opacity: 1; }
`;

// Clickable card that lifts on hover (translate + a larger shadow / accent border fading in).
// May contain buttons: it is a plain div (keyboard: Enter/Space), not a <button>.
export function HoverCard({ children, onPress, testID, style }) {
  return (
    <HoverWrap
      data-testid={testID}
      tabIndex={0}
      onClick={onPress}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          onPress?.();
        }
      }}
      style={style}
    >
      <Card>{children}</Card>
    </HoverWrap>
  );
}

const AlertBox = styled(motion.div)`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.md}px;
  padding: ${(p) => p.theme.spacing.md}px ${(p) => p.theme.spacing.lg}px;
  margin-bottom: ${(p) => p.theme.spacing.lg}px;
  border-radius: ${(p) => p.theme.radius.lg}px;
  border: 1px solid ${(p) => p.theme[p.$tone]};
  background: ${(p) => p.theme[`${p.$tone}Soft`]};
`;

export function Alert({ children, tone = 'danger', onRetry }) {
  const t = useTheme();
  if (!children) return null;
  return (
    <AlertBox $tone={tone} role="alert" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: t.motion.s(t.motion.base) }}>
      <AlertCircle size={18} color={t[tone]} strokeWidth={2} style={{ flex: 'none' }} />
      <Text $variant="body" $color={tone} style={{ flex: 1 }}>
        {children}
      </Text>
      {onRetry ? <Button title="Retry" size="sm" variant="secondary" onPress={onRetry} /> : null}
    </AlertBox>
  );
}

const TileBox = styled.div`
  width: ${(p) => p.$size}px;
  height: ${(p) => p.$size}px;
  flex: none;
  border-radius: ${(p) => p.theme.radius.lg}px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${(p) => (p.$tone === 'neutral' ? p.theme.surfaceAlt : p.theme[`${p.$tone}Soft`])};
`;

// Rounded square holding an icon, tinted by a theme tone (primary | success | warning | danger | neutral).
export function IconTile({ icon: IconCmp, tone = 'primary', size = 36 }) {
  const t = useTheme();
  return (
    <TileBox $tone={tone} $size={size}>
      <IconCmp size={Math.round(size * 0.5)} color={tone === 'neutral' ? t.textMuted : t[tone]} strokeWidth={1.9} />
    </TileBox>
  );
}
