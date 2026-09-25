import React from 'react';
import styled, { css, keyframes, useTheme } from 'styled-components';

const spin = keyframes`to { transform: rotate(360deg); }`;

const Spinner = styled.span`
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid currentColor;
  border-right-color: transparent;
  animation: ${spin} 0.7s linear infinite;
`;

const variants = {
  primary: css`
    color: ${(p) => p.theme.onGradient};
    background: linear-gradient(135deg, ${(p) => p.theme.gradient[0]}, ${(p) => p.theme.gradient[1]});
    border: 1px solid transparent;
    box-shadow: ${(p) => p.theme.shadow.glow};
    &:hover:not(:disabled) { transform: translateY(-1.5px); box-shadow: ${(p) => p.theme.shadow.glowHover}; }
  `,
  secondary: css`
    color: ${(p) => p.theme.text};
    background: ${(p) => p.theme.surface};
    border: 1px solid ${(p) => p.theme.borderStrong};
    &:hover:not(:disabled) { background: ${(p) => p.theme.surfaceAlt}; }
  `,
  ghost: css`
    color: ${(p) => p.theme.primary};
    background: transparent;
    border: 1px solid transparent;
    &:hover:not(:disabled) { background: ${(p) => p.theme.primarySoft}; }
  `,
  danger: css`
    color: ${(p) => p.theme.danger};
    background: ${(p) => p.theme.surface};
    border: 1px solid ${(p) => p.theme.danger};
    &:hover:not(:disabled) { background: ${(p) => p.theme.dangerSoft}; }
  `,
};

const Btn = styled.button`
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${(p) => p.theme.spacing.sm}px;
  height: ${(p) => (p.$size === 'sm' ? 32 : p.theme.layout.controlHeight)}px;
  padding: 0 ${(p) => (p.$size === 'sm' ? p.theme.spacing.md : p.theme.spacing.lg)}px;
  border-radius: ${(p) => p.theme.radius.lg}px;
  font-size: ${(p) => (p.$size === 'sm' ? p.theme.type.small.size : p.theme.type.body.size)}px;
  font-weight: ${(p) => p.theme.fontWeight.semibold};
  cursor: pointer;
  white-space: nowrap;
  transition: transform ${(p) => p.theme.motion.fast}ms ease, box-shadow ${(p) => p.theme.motion.base}ms ease, background ${(p) => p.theme.motion.fast}ms ease;
  ${(p) => variants[p.$variant]}
  &:active:not(:disabled) { transform: scale(0.97); }
  &:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }
  &:focus-visible { outline: 2px solid ${(p) => p.theme.primary}; outline-offset: 2px; }
  ${(p) => (p.$full ? 'width: 100%;' : '')}
`;

// variant: primary (orange gradient) | secondary | ghost | danger. icon: a lucide icon component.
export function Button({ title, onPress, variant = 'primary', size = 'md', icon: IconCmp, disabled, loading, testID, fullWidth, type = 'button', children, ...rest }) {
  return (
    <Btn type={type} onClick={onPress} disabled={disabled || loading} data-testid={testID} $variant={variant} $size={size} $full={fullWidth} {...rest}>
      {loading ? <Spinner aria-label="Loading" /> : IconCmp ? <IconCmp size={size === 'sm' ? 15 : 17} strokeWidth={2.1} /> : null}
      {title}
      {children}
    </Btn>
  );
}

const IconBtn = styled.button`
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: ${(p) => p.$size}px;
  height: ${(p) => p.$size}px;
  flex: none;
  border: 0;
  border-radius: ${(p) => p.theme.radius.lg}px;
  background: transparent;
  color: ${(p) => p.$color || p.theme.textMuted};
  cursor: pointer;
  transition: background ${(p) => p.theme.motion.fast}ms ease, transform ${(p) => p.theme.motion.fast}ms ease, color ${(p) => p.theme.motion.fast}ms ease;
  &:hover { background: ${(p) => p.$hoverBg || p.theme.surfaceAlt}; ${(p) => (p.$color ? '' : `color: ${p.theme.text};`)} }
  &:active { transform: scale(0.9); }
  &:focus-visible { outline: 2px solid ${(p) => p.theme.primary}; }
`;

export function IconButton({ icon: IconCmp, onPress, label, color, size = 32, iconSize = 18, hoverBg, testID, className, onClick, stop = true }) {
  const theme = useTheme();
  return (
    <IconBtn
      type="button"
      aria-label={label}
      title={label}
      data-testid={testID}
      className={className}
      $size={size}
      $color={color}
      $hoverBg={hoverBg}
      onClick={(e) => {
        if (stop) e.stopPropagation(); // icon buttons inside clickable rows must not trigger the row
        (onPress || onClick)?.(e);
      }}
    >
      <IconCmp size={iconSize} strokeWidth={1.9} color="currentColor" />
    </IconBtn>
  );
}
