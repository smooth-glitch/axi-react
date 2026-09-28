import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/plus-jakarta-sans/300.css';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';
import AppThemeProvider, { GlobalStyle } from './ui/theme';
import { StudioRoutes } from './StudioApp';

// The standalone studio: its own tab, the real browser URL (`<BrowserRouter>`), the page-level reset
// (`<GlobalStyle>`). See StudioApp.jsx for the route tree itself and for `TstructStudio`, the version of this
// same app meant to be mounted inside another page (e.g. a host application's "open the builder" button).
createRoot(document.getElementById('root')).render(
  <AppThemeProvider>
    <GlobalStyle />
    <BrowserRouter>
      <StudioRoutes />
    </BrowserRouter>
  </AppThemeProvider>
);
