import React, { createContext, useContext, useMemo } from 'react';
import styled, { createGlobalStyle, ThemeProvider as StyledProvider } from 'styled-components';
import { buildTheme } from '../core/tokens';
import { useAutoDark } from './hooks';

// Theme is always automatic - light by day, dark by night (useAutoDark) - there is no user-facing
// toggle. `mode` here is read-only, for anything that wants to show the current effective mode.
const ModeContext = createContext({ mode: 'light' });
export const useThemeMode = () => useContext(ModeContext);

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
 * Provides the styled-components theme + light/dark mode.
 *  - mode: 'light' | 'dark' forces a mode (embedding, e.g. to match a host app's theme); otherwise
 *    it follows the time of day automatically (useAutoDark) - there is no manual user toggle.
 *  - overrides: palette overrides so a host can re-brand (see core/tokens.js buildTheme)
 */
export default function AppThemeProvider({ children, mode: forced, overrides }) {
  const autoDark = useAutoDark();
  const mode = forced || (autoDark ? 'dark' : 'light');

  const theme = useMemo(() => buildTheme(mode, overrides), [mode, overrides]);
  const ctx = useMemo(() => ({ mode }), [mode]);

  return (
    <ModeContext.Provider value={ctx}>
      <StyledProvider theme={theme}>{children}</StyledProvider>
    </ModeContext.Provider>
  );
}
