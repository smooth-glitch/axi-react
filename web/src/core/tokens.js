// Single source of truth for the visual design. Every component reads from the theme built here
// (styled-components ThemeProvider). No hex codes or magic numbers elsewhere.

const palette = {
  light: {
    mode: 'light',
    // Host app (Sandesh) palette: coral on peach, dark slate text.
    bg: '#fff3eb',
    surface: '#ffffff',
    surfaceAlt: '#fff7f2',
    border: '#f3dccf',
    borderStrong: '#e6c3b0',
    text: '#1f2937',
    textMuted: '#64748b',
    textFaint: '#94a3b8',
    primary: '#ff7a59',
    primaryHover: '#ff6540',
    primaryActive: '#e6532e',
    primaryText: '#ffffff',
    primarySoft: '#ffe2d1',
    peachDeep: '#ffd3bd',
    gradient: ['#ff7a59', '#ff5757'],
    onGradient: '#ffffff',
    danger: '#dc2626',
    dangerSoft: '#fdeceb',
    success: '#059669',
    successSoft: '#e3f6ee',
    warning: '#d97706',
    warningSoft: '#fdf1d8',
    overlay: 'rgba(31, 41, 55, 0.4)',
    skeleton: '#ffe9de',
    skeletonHi: '#fff7f2',
    glass: 'rgba(255, 255, 255, 0.72)',
    glassThick: 'rgba(255, 255, 255, 0.88)',
    glassBorder: 'rgba(255, 255, 255, 0.75)',
    blur: 'blur(28px) saturate(190%)',
    // Navigation: light frosted glass like the host (no dark chrome).
    nav: 'rgba(255, 255, 255, 0.65)',
    navSurface: '#ffffff',
    navHover: 'rgba(255, 122, 89, 0.08)',
    navActive: 'rgba(255, 122, 89, 0.16)',
    navText: '#1f2937',
    navMuted: '#64748b',
    navBorder: 'rgba(255, 211, 189, 0.7)',
  },
  dark: {
    mode: 'dark',
    bg: '#0e1118',
    surface: '#161a23',
    surfaceAlt: '#1d222d',
    border: '#272d3a',
    borderStrong: '#3a4252',
    text: '#eceff4',
    textMuted: '#a3acbb',
    textFaint: '#727b8c',
    primary: '#ff9d5c',
    primaryHover: '#ffb27f',
    primaryText: '#1c0d03',
    primarySoft: '#3a2312',
    gradient: ['#ffb070', '#f57a2c'],
    onGradient: '#ffffff',
    danger: '#ff6b60',
    dangerSoft: '#3a1c1a',
    success: '#3ecf8e',
    successSoft: '#123024',
    warning: '#e6b422',
    warningSoft: '#33290d',
    overlay: 'rgba(0, 0, 0, 0.6)',
    skeleton: '#232936',
    skeletonHi: '#2c3342',
    nav: '#0a0d13',
    navSurface: '#141821',
    navHover: 'rgba(255,255,255,0.06)',
    navActive: 'rgba(255,255,255,0.12)',
    navText: '#d5dae4',
    navMuted: '#7f8899',
    navBorder: 'rgba(255,255,255,0.07)',
    primaryActive: '#ff9d5c',
    peachDeep: '#4a2c1c',
    glass: 'rgba(22, 26, 35, 0.72)',
    glassThick: 'rgba(22, 26, 35, 0.9)',
    glassBorder: 'rgba(255, 255, 255, 0.08)',
    blur: 'blur(28px) saturate(150%)',
  },
};

export const spacing = { none: 0, xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };

export const radius = { sm: 6, md: 10, lg: 16, xl: 24, pill: 9999 };

export const fontFamily = "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// weight keys used by `type` -> CSS font-weight
export const fontWeight = { regular: 400, medium: 500, semibold: 600, bold: 700 };

// size / line-height / weight key
export const type = {
  caption: { size: 12, line: 16, weight: 'regular' },
  small: { size: 13, line: 18, weight: 'regular' },
  body: { size: 14, line: 20, weight: 'regular' },
  bodyStrong: { size: 14, line: 20, weight: 'semibold' },
  label: { size: 12, line: 16, weight: 'semibold' },
  title: { size: 16, line: 22, weight: 'semibold' },
  heading: { size: 20, line: 26, weight: 'semibold' },
  display: { size: 26, line: 32, weight: 'bold' },
};

export const shadow = {
  none: 'none',
  sm: '0 1px 2px rgba(255, 122, 89, 0.1)',
  md: '0 4px 12px rgba(255, 122, 89, 0.16)', // single layer: styled-components cannot parse comma-separated shadows
  lg: '0 12px 32px rgba(230, 83, 46, 0.24)',
  glow: '0 4px 14px rgba(255, 122, 89, 0.38)',
  glowHover: '0 8px 24px rgba(255, 122, 89, 0.5)',
  focus: (color) => `0 0 0 3px ${color}33`,
};

export const layout = {
  sidebarWidth: 288,
  wideBreakpoint: 960, // >= : persistent sidebar + centre pane. Below: sidebar becomes the home screen.
  tableBreakpoint: 720, // centre pane >= : records as a table. Below: stacked cards.
  contentMaxWidth: 1120,
  formMaxWidth: 720,
  fullMaxWidth: 1600, // record forms use (almost) the whole centre pane
  gridTwoCol: 620, // form width >= : 2 columns of fields
  gridThreeCol: 980, // form width >= : 3 columns
  panelWidth: 460, // right-hand drawer
  controlHeight: 40,
};

// durations in ms (framer-motion wants seconds: use motion.s(ms))
export const motion = {
  fast: 120,
  base: 200,
  slow: 320,
  spring: { type: 'spring', damping: 24, stiffness: 300 },
  s: (ms) => ms / 1000,
};

/**
 * Builds the theme object handed to styled-components.
 * overrides lets a host application re-brand the UI: flat palette keys applied to both modes
 * ({ primary: '#0a7', gradient: ['#3c9', '#0a7'] }), and/or per mode ({ dark: { bg: '#000' } }).
 */
export const buildTheme = (mode, overrides = {}) => {
  const { light, dark, ...common } = overrides || {};
  const perMode = (mode === 'dark' ? dark : light) || {};
  return {
    ...palette[mode],
    ...common,
    ...perMode,
    spacing,
    radius,
    fontFamily,
    fontWeight,
    type,
    shadow,
    layout,
    motion,
  };
};

// Deterministic accent per struct name (avatar tint) - a restrained set that works on light and dark.
const AVATAR_KEYS = ['primary', 'success', 'warning', 'danger'];
export const avatarKey = (name = '') => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_KEYS[h % AVATAR_KEYS.length];
};
