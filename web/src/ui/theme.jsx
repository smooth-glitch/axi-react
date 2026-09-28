import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import styled, { createGlobalStyle, ThemeProvider as StyledProvider } from 'styled-components';
import { buildTheme } from '../core/tokens';
import { useSystemDark } from './hooks';

const STORAGE_KEY = 'tstruct.theme';
const ModeContext = createContext({ mode: 'light', preference: 'system', setPreference: () => {} });
export const useThemeMode = () => useContext(ModeContext);

const readPref = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || 'light';
  } catch (e) {
    return 'light';
  }
};

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
 *  - mode: 'light' | 'dark' forces a mode (embedding); otherwise the user's saved preference / system setting is used
 *  - overrides: palette overrides so a host can re-brand (see core/tokens.js buildTheme)
 *  - persist: store the light/dark/system preference in localStorage (standalone app only)
 */
export default function AppThemeProvider({ children, mode: forced, overrides, persist = true }) {
  const systemDark = useSystemDark();
  const [preference, setPref] = useState('light');
  useEffect(() => {
    if (persist) setPref(readPref());
  }, [persist]);
  const mode = forced || (preference === 'system' ? (systemDark ? 'dark' : 'light') : preference);

  const setPreference = useCallback(
    (p) => {
      setPref(p);
      if (!persist) return;
      try {
        window.localStorage.setItem(STORAGE_KEY, p);
      } catch (e) {
        /* storage unavailable: preference lasts for this session only */
      }
    },
    [persist]
  );

  const theme = useMemo(() => buildTheme(mode, overrides), [mode, overrides]);
  const ctx = useMemo(() => ({ mode, preference, setPreference }), [mode, preference, setPreference]);

  return (
    <ModeContext.Provider value={ctx}>
      <StyledProvider theme={theme}>{children}</StyledProvider>
    </ModeContext.Provider>
  );
}
