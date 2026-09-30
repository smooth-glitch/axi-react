import { useMemo } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AppThemeProvider, { GlobalStyle } from "@tstruct/ui/theme";
import { ToastProvider } from "@tstruct/ui/kit";
import { StructsProvider } from "@tstruct/studio/StructsContext";
import Shell from "@tstruct/studio/Shell";
import Home from "@tstruct/studio/pages/Home";
import Definitions from "@tstruct/studio/pages/Definitions";
import { EditStruct, NewStruct } from "@tstruct/studio/pages/StructPages";
import { EditRecord, NewRecord, Records } from "@tstruct/studio/pages/RecordPages";
import { OptionBuilderPage, OptionRunPage, OptionsPage } from "@tstruct/studio/pages/OptionPages";
import { configure } from "@tstruct/core/api";
import { sandeshSocket } from "../../../../services/sandeshSocket.js";
import { sandeshApi } from "../../../../services/sandeshApi.js";

// Renders the full tstruct studio inside the Sandesh chat app.
// Uses MemoryRouter so navigation stays in-memory and doesn't affect the browser URL.
// Because this code is bundled with the chat app (same port/origin), localStorage
// is shared — the user session set by the chat app is available to api.js automatically.
export default function TStructUserModal({ onClose, currentUser, initialPath }) {
  // Wire the tstruct API to the host app's already-authenticated socket.
  // useMemo runs synchronously during render — before any child useEffect fires —
  // so listStructs() in StructsProvider already has the socket available on first call.
  useMemo(() => {
    // apiBase/getToken: file upload/download go over authenticated HTTP, the rest over the shared socket
    configure({ user: currentUser, socket: sandeshSocket, apiBase: sandeshApi.getBaseUrl(), getToken: () => currentUser?.token });
  }, [currentUser]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        display: "flex",
        flexDirection: "column",
        background: "rgba(0,0,0,0.55)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          margin: "32px auto",
          width: "min(1100px, 96vw)",
          height: "calc(100vh - 64px)",
          borderRadius: 16,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 80px rgba(0,0,0,0.4)",
        }}
      >
        {/* Studio body — full tstruct React app rendered inline */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          <AppThemeProvider>
            <GlobalStyle />
            <MemoryRouter initialEntries={[initialPath || "/"]}>
              <StructsProvider>
                <ToastProvider>
                  <Routes>
                    <Route element={<Shell onClose={onClose} />}>
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
                </ToastProvider>
              </StructsProvider>
            </MemoryRouter>
          </AppThemeProvider>
        </div>
      </div>
    </div>
  );
}
