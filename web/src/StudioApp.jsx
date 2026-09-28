import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AppThemeProvider, { TstructRoot } from './ui/theme';
import { StructsProvider } from './studio/StructsContext';
import Shell from './studio/Shell';
import Home from './studio/pages/Home';
import Definitions from './studio/pages/Definitions';
import { EditStruct, NewStruct } from './studio/pages/StructPages';
import { EditRecord, NewRecord, Records } from './studio/pages/RecordPages';
import Embed from './studio/pages/Embed';
import OptionEmbed from './studio/pages/OptionEmbed';
import { OptionBuilderPage, OptionRunPage, OptionsPage } from './studio/pages/OptionPages';
import { ToastProvider } from './ui/kit';

// The whole "studio" — sidebar + builder + records + options — as one route tree, independent of how it gets
// mounted. `web/src/main.jsx` renders this standalone (its own tab, `<BrowserRouter>`, the page-level
// `<GlobalStyle>`); `TstructStudio` below renders the exact same tree embedded inside another app. Keeping one
// definition means the two can never drift apart. Route map (unchanged since before this file existed):
//   /                                  Overview (or the struct list on narrow screens)
//   /structs                           Definitions
//   /structs/new                       New struct
//   /structs/:id/edit                  Edit definition          (:id may be an id or a key)
//   /structs/:id/records                Records
//   /structs/:id/form                  New record
//   /structs/:id/record/:recordId      Edit record
//   /options                           Options list (standalone feature, unrelated to structs)
//   /options/new                       New option
//   /options/:optionId/edit|run        Edit / run an option
//   /embed/:structRef/form|records     Chrome-less page for iframes
//   /embed/options[/new|/:id/edit|run] Chrome-less Options pages for iframes
export function StudioRoutes() {
  return (
    <Routes>
      <Route path="/embed/options" element={<OptionEmbed view="list" />} />
      <Route path="/embed/options/new" element={<OptionEmbed view="builder" />} />
      <Route path="/embed/options/:optionId/edit" element={<OptionEmbed view="builder" />} />
      <Route path="/embed/options/:optionId/run" element={<OptionEmbed view="run" />} />
      <Route path="/embed/:structRef/:view" element={<Embed />} />
      <Route
        element={
          <StructsProvider>
            <ToastProvider>
              <Shell />
            </ToastProvider>
          </StructsProvider>
        }
      >
        <Route index element={<Home />} />
        <Route path="options" element={<OptionsPage />} />
        <Route path="options/new" element={<OptionBuilderPage mode="new" />} />
        <Route path="options/:optionId/edit" element={<OptionBuilderPage mode="edit" />} />
        <Route path="options/:optionId/run" element={<OptionRunPage />} />
        <Route path="structs" element={<Definitions />} />
        <Route path="structs/new" element={<NewStruct />} />
        <Route path="structs/:id/edit" element={<EditStruct />} />
        <Route path="structs/:id/records" element={<Records />} />
        <Route path="structs/:id/form" element={<NewRecord />} />
        <Route path="structs/:id/record/:recordId" element={<EditRecord />} />
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  );
}

/**
 * The studio, mountable inside a host application's own page (e.g. a modal). Unlike the standalone app:
 *   - routing is in-memory (`MemoryRouter`), so it never touches the host page's URL / browser history — open it,
 *     click around, close it, and the address bar was never involved;
 *   - it does NOT render the page-level `<GlobalStyle>` (that resets html/body — fine for the app's own tab, not
 *     for a page you're a guest in). Instead it's scoped with `<TstructRoot>`, exactly like the individual
 *     `<StructForm>`/`<RecordList>` components `@tstruct/react` already exports.
 *
 * The host is responsible for giving the element an explicit height (the studio's layout is `height: 100%` all
 * the way down, same as the standalone app inside `html, body, #root`).
 *
 *   <div style={{ height: 600 }}><TstructStudio /></div>
 */
export function TstructStudio({ colorMode, theme, initialPath = '/' } = {}) {
  return (
    <AppThemeProvider mode={colorMode} overrides={theme} persist={false}>
      <TstructRoot style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <MemoryRouter initialEntries={[initialPath]}>
          <StudioRoutes />
        </MemoryRouter>
      </TstructRoot>
    </AppThemeProvider>
  );
}
