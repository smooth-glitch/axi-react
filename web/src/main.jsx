import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import '@fontsource/plus-jakarta-sans/300.css';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';
import AppThemeProvider, { GlobalStyle } from './ui/theme';
import { ToastProvider } from './ui/kit';
import { StructsProvider } from './studio/StructsContext';
import Shell from './studio/Shell';
import Home from './studio/pages/Home';
import Definitions from './studio/pages/Definitions';
import { EditStruct, NewStruct } from './studio/pages/StructPages';
import { EditRecord, NewRecord, Records } from './studio/pages/RecordPages';
import Embed from './studio/pages/Embed';
import OptionEmbed from './studio/pages/OptionEmbed';
import { OptionBuilderPage, OptionRunPage, OptionsPage } from './studio/pages/OptionPages';

// Route map (same URLs as before the migration):
//   /                                  Overview (or the struct list on narrow screens)
//   /structs                           Definitions
//   /structs/new                       New struct
//   /structs/:id/edit                  Edit definition          (:id may be an id or a key)
//   /structs/:id/records               Records
//   /structs/:id/form                  New record
//   /structs/:id/record/:recordId      Edit record
//   /options                           Options list (standalone feature, unrelated to structs)
//   /options/new                       New option
//   /options/:optionId/edit|run        Edit / run an option
//   /embed/:structRef/form|records     Chrome-less page for iframes
//   /embed/options[/new|/:id/edit|run] Chrome-less Options pages for iframes
createRoot(document.getElementById('root')).render(
  <AppThemeProvider>
    <GlobalStyle />
    <BrowserRouter>
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
    </BrowserRouter>
  </AppThemeProvider>
);
