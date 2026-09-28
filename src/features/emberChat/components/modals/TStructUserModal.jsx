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
import { configure } from "@tstruct/core/api";
import { sandeshSocket } from "../../../../services/sandeshSocket.js";

// Renders the full tstruct studio inside the Sandesh chat app.
// Uses MemoryRouter so navigation stays in-memory and doesn't affect the browser URL.
// Because this code is bundled with the chat app (same port/origin), localStorage
// is shared — the user session set by the chat app is available to api.js automatically.
export default function TStructUserModal({ onClose, currentUser }) {
  // Wire the tstruct API to the host app's already-authenticated socket.
  // useMemo runs synchronously during render — before any child useEffect fires —
  // so listStructs() in StructsProvider already has the socket available on first call.
  useMemo(() => {
    configure({ user: currentUser, socket: sandeshSocket });
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
        {/* Header bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 20px",
            background: "#1a1a2e",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="material-icons" style={{ color: "#7c6af7", fontSize: 22 }}>table_chart</span>
            <span style={{ color: "#fff", fontWeight: 600, fontSize: 15 }}>Org Structures</span>
            <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, marginLeft: 4 }}>Lite TStruct Studio</span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.6)",
              cursor: "pointer",
              fontSize: 22,
              lineHeight: 1,
              padding: "2px 6px",
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Studio body — full tstruct React app rendered inline */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          <AppThemeProvider>
            <GlobalStyle />
            <MemoryRouter>
              <StructsProvider>
                <ToastProvider>
                  <Routes>
                    <Route element={<Shell />}>
                      <Route index element={<Home />} />
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
