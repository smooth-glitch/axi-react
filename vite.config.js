import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// ── SPA mode ────────────────────────────────────────────────────────────
// `npm run dev` / `npm run build` (AXI_FEATURE unset, or AXI_FEATURE=spa)
// now build the real standalone single-root React app — src/main.jsx →
// App.jsx, output to dist/ as a normal Vite SPA (index.html + hashed
// assets). React/ReactDOM are still marked external and loaded via the same
// CDN <script> tags as the legacy bundles below (see index.html) — that's a
// deliberate choice, not a leftover: this deployment already pins a known
// React 18 UMD build for the whole page, and duplicating it into the app
// bundle would just add ~130KB gzipped for no benefit.
//
// ── Legacy per-feature IIFE mode (AXI_FEATURE=databin|admin|...) ─────────
// Kept for rollback: this is how the 8 features were built before the SPA
// conversion, and AXIBOT/'s hybrid index.html (the previous architecture)
// still loads those exact bundle files. Do not delete — it's the fallback
// path if the SPA needs to be rolled back.
//
// It builds one self-contained IIFE bundle per feature that gets pasted into
// the host platform's script slot, exactly like the existing axi-*.js files
// in AXIBOT/. No <script type="module">, no code-splitting, no import maps.
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

const featureKey = process.env.AXI_FEATURE || 'spa'

// classic, not the default 'automatic', JSX runtime: automatic imports from
// the 'react/jsx-runtime' subpath, which — unlike 'react'/'react-dom'
// themselves — was NOT marked external below, so Rollup bundled its actual
// source into every output. That source's own entry-point dispatcher does an
// internal `process.env.NODE_ENV` check to pick dev vs prod internals;
// `process` doesn't exist in a browser, so every single bundle crashed
// immediately on load with "Uncaught ReferenceError: process is not
// defined" (caught via live testing). classic mode transforms JSX into
// React.createElement(...) calls against the plain `React` global instead —
// already provided via the UMD <script> tag — sidestepping the jsx-runtime
// package (and this whole class of bug) entirely.
const reactPlugin = react({ jsxRuntime: 'classic' })

// react-dom/client has no UMD global of its own — React 18+'s react-dom UMD
// bundle exposes createRoot directly on window.ReactDOM, so it maps to the
// same global as 'react-dom'.
const reactExternals = {
  external: ['react', 'react-dom', 'react-dom/client'],
  globals: { react: 'React', 'react-dom': 'ReactDOM', 'react-dom/client': 'ReactDOM' },
}

export default defineConfig(() => {
  if (featureKey === 'spa') {
    return {
      plugins: [reactPlugin],
      build: {
        outDir: 'dist',
        rollupOptions: {
          external: reactExternals.external,
          output: {
            // Rollup only rewrites externalized imports to `globals` entries
            // for 'iife'/'umd' output — for the default 'es' format (what a
            // Vite SPA normally emits, loaded via <script type="module">),
            // `globals` is silently ignored and the bundle keeps literal
            // `import ... from "react"` statements, which the browser then
            // fails to resolve at runtime ("Failed to resolve module
            // specifier 'react'") since there's no import map for it.
            // Forcing 'iife' here is what actually makes `globals` take
            // effect, resolving react/react-dom to the UMD <script> tags in
            // index.html instead. Safe as a single bundle (no code-splitting
            // concerns) since nothing in src/ uses a dynamic import().
            format: 'iife',
            globals: reactExternals.globals,
          },
        },
      },
    }
  }

  const feature = FEATURES[featureKey]
  if (!feature) {
    throw new Error(`Unknown AXI_FEATURE "${featureKey}". Valid: spa, ${Object.keys(FEATURES).join(', ')}`)
  }

  return {
    plugins: [reactPlugin],
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
        external: reactExternals.external,
        output: {
          globals: reactExternals.globals,
          // Force a predictable CSS filename instead of a hashed one.
          assetFileNames: (info) =>
            info.name && info.name.endsWith('.css') ? `${feature.fileName}.css` : 'assets/[name][extname]',
        },
      },
    },
  }
})
