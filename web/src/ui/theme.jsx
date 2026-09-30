import React, { useMemo } from 'react';
import styled, { createGlobalStyle, ThemeProvider as StyledProvider } from 'styled-components';
import { buildTheme } from '../core/tokens';

// Page-level reset - only used by the standalone app (an embedded component must not restyle the host page).
export const GlobalStyle = createGlobalStyle`
  *, *::before, *::after { box-sizing: border-box; }
  html, body, #root { height: 100%; }
  body {
    margin: 0;
    font-family: ${(p) => p.theme.fontFamily};
    background: ${(p) => p.theme.bg};
    color: ${(p) => p.theme.text};
    color-scheme: ${(p) => p.theme.mode};
    -webkit-font-smoothing: antialiased;
  }
  button, input, textarea, select { font: inherit; color: inherit; }
`;

// Scope wrapper for embedded components: font, colours and box-sizing apply only inside it.
export const TstructRoot = styled.div`
  font-family: ${(p) => p.theme.fontFamily};
  color: ${(p) => p.theme.text};
  color-scheme: ${(p) => p.theme.mode};
  -webkit-font-smoothing: antialiased;
  box-sizing: border-box;
  & *, & *::before, & *::after { box-sizing: border-box; }
  & button, & input, & textarea { font: inherit; color: inherit; }
`;

/**
 * Provides the styled-components theme (light only).
 *  - overrides: palette overrides so a host can re-brand (see core/tokens.js buildTheme)
 */
export default function AppThemeProvider({ children, overrides }) {
  const theme = useMemo(() => buildTheme(overrides), [overrides]);
  return <StyledProvider theme={theme}>{children}</StyledProvider>;
}
