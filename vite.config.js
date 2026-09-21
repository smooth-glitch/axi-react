import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// This project does NOT produce a normal SPA. It builds one self-contained
// IIFE bundle per feature that gets pasted into the host platform's script
// slot, exactly like the existing axi-*.js files in AXIBOT/. No
// <script type="module">, no code-splitting, no import maps on the host page.
//
// React + ReactDOM are NOT bundled into each feature — they're marked
// `external` and loaded once via CDN <script> tags in AXIBOT/index.html
// (React 19 UMD, exposing window.React / window.ReactDOM), before any
// feature bundle. Without this, every feature would carry its own ~200KB
// (gzipped) copy of React, which compounds fast as more features convert.
//
// Each feature is its own IIFE (a separate global name), so each needs its
// own build pass — that's what FEATURE selects below. Run:
//   npm run build              (builds every feature, one after another)
//   npm run build:databin      (just the Data Bin wizard)
//   npm run build:admin        (just the Admin dashboard)
//   npm run build:promptTemplates
//   npm run build:exportChat
// then copy the matching dist/axi-*.js (+ .css, if present) into AXIBOT/.
const FEATURES = {
  databin: {
    entry: 'src/features/databin/mount.jsx',
    name: 'AxiDataBinWizard',
    fileName: 'axi-databin-wizard',
  },
  admin: {
    entry: 'src/features/admin/mount.jsx',
    name: 'AxiAdminDashboard',
    fileName: 'axi-admin-dashboard-react',
  },
  promptTemplates: {
    entry: 'src/features/promptTemplates/mount.jsx',
    name: 'AxiPromptTemplates',
    fileName: 'axi-prompt-templates-react',
  },
  exportChat: {
    entry: 'src/features/exportChat/mount.jsx',
    name: 'AxiExportChat',
    fileName: 'axi-export-chat-react',
  },
  providerSwitcher: {
    entry: 'src/features/providerSwitcher/mount.jsx',
    name: 'AxiProviderSwitcher',
    fileName: 'axi-provider-switcher-react',
  },
  messageThread: {
    entry: 'src/features/messageThread/mount.jsx',
    name: 'AxiMessageThread',
    fileName: 'axi-message-thread-react',
  },
  systemPromptEditor: {
    entry: 'src/features/systemPromptEditor/mount.jsx',
    name: 'AxiSystemPromptEditor',
    fileName: 'axi-system-prompt-editor-react',
  },
  composer: {
    entry: 'src/features/composer/mount.jsx',
    name: 'AxiComposer',
    fileName: 'axi-composer-react',
  },
}

const featureKey = process.env.AXI_FEATURE || 'databin'
const feature = FEATURES[featureKey]
if (!feature) {
  throw new Error(`Unknown AXI_FEATURE "${featureKey}". Valid: ${Object.keys(FEATURES).join(', ')}`)
}

export default defineConfig({
  // classic, not the default 'automatic', JSX runtime: automatic imports
  // from the 'react/jsx-runtime' subpath, which — unlike 'react'/'react-dom'
  // themselves — was NOT marked external below, so Rollup bundled its actual
  // source into every output. That source's own entry-point dispatcher does
  // an internal `process.env.NODE_ENV` check to pick dev vs prod internals;
  // `process` doesn't exist in a browser, so every single bundle crashed
  // immediately on load with "Uncaught ReferenceError: process is not
  // defined" (caught via live testing). classic mode transforms JSX into
  // React.createElement(...) calls against the plain `React` global instead
  // — already provided via the UMD <script> tag — sidestepping the
  // jsx-runtime package (and this whole class of bug) entirely.
  plugins: [react({ jsxRuntime: 'classic' })],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, feature.entry),
      name: feature.name,
      formats: ['iife'],
      fileName: () => `${feature.fileName}.js`,
    },
    rollupOptions: {
      // react-dom/client has no UMD global of its own — React 18+'s
      // react-dom UMD bundle exposes createRoot directly on window.ReactDOM,
      // so it maps to the same global as 'react-dom'.
      external: ['react', 'react-dom', 'react-dom/client'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react-dom/client': 'ReactDOM',
        },
        // Force a predictable CSS filename instead of a hashed one.
        assetFileNames: (info) =>
          info.name && info.name.endsWith('.css') ? `${feature.fileName}.css` : 'assets/[name][extname]',
      },
    },
  },
})
