import React, { useContext, useMemo } from 'react';
import { ThemeContext } from 'styled-components';
import AppThemeProvider, { TstructRoot } from './theme';
import { ToastProvider } from './kit';
import { configure } from '../core/api';

/**
 * Optional wrapper for a host application: configure the API once and (optionally) re-brand the UI.
 *
 *   <TstructProvider apiUrl="https://tstruct.example.com" getAuthToken={() => session.token} user="alice"
 *                    theme={{ primary: '#0a7', gradient: ['#3c9', '#0a7'] }} colorMode="light">
 *     <StructForm struct="leave-request" ... />
 *   </TstructProvider>
 *
 * Every exported component also works WITHOUT this provider (it then creates its own default theme).
 */
export function TstructProvider({ apiUrl, getAuthToken, user, headers, theme, colorMode, children }) {
  // configure synchronously so children's first fetch already uses it (effects of children run before the parent's)
  useMemo(() => {
    const next = {};
    if (apiUrl) next.apiUrl = apiUrl;
    if (getAuthToken) next.getAuthToken = getAuthToken;
    if (user !== undefined) next.user = user;
    if (headers) next.headers = headers;
    configure(next);
    return null;
  }, [apiUrl, getAuthToken, user, headers]);

  return (
    <AppThemeProvider mode={colorMode} overrides={theme} persist={false}>
      <TstructRoot>
        <ToastProvider>{children}</ToastProvider>
      </TstructRoot>
    </AppThemeProvider>
  );
}

// Used by exported components: reuse the surrounding theme when inside a provider, otherwise supply one.
export function Ensure({ children, ...providerProps }) {
  const theme = useContext(ThemeContext);
  return theme ? children : <TstructProvider {...providerProps}>{children}</TstructProvider>;
}
