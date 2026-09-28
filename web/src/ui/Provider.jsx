import React, { useContext, useMemo } from 'react';
import { ThemeContext } from 'styled-components';
import AppThemeProvider, { TstructRoot } from './theme';
import { ToastProvider } from './kit';
import { configure } from '../core/api';

/**
 * Optional wrapper for a host application: configure the data layer once and (optionally) re-brand the UI.
 * Data is stored in the browser (no server): apiUrl / getAuthToken / headers are accepted but ignored.
 *
 *   <TstructProvider user="alice" storageName="crm-tstruct"
 *                    theme={{ primary: '#0a7', gradient: ['#3c9', '#0a7'] }} colorMode="light">
 *     <StructForm struct="leave-request" ... />
 *   </TstructProvider>
 *
 * Every exported component also works WITHOUT this provider (it then creates its own default theme).
 */
export function TstructProvider({ apiUrl, getAuthToken, user, headers, storageName, maxUploadMb, theme, colorMode, children }) {
  // configure synchronously so children's first fetch already uses it (effects of children run before the parent's)
  useMemo(() => {
    const next = {};
    if (apiUrl) next.apiUrl = apiUrl;
    if (getAuthToken) next.getAuthToken = getAuthToken;
    if (user !== undefined) next.user = user;
    if (headers) next.headers = headers;
    if (storageName) next.storageName = storageName;
    if (maxUploadMb) next.maxUploadMb = maxUploadMb;
    configure(next);
    return null;
  }, [apiUrl, getAuthToken, user, headers, storageName, maxUploadMb]);

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
