import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// This project does NOT produce a normal SPA. It builds one self-contained
// IIFE bundle per feature that gets pasted into the host platform's script
// slot, exactly like the existing axi-*.js files in AXIBOT/. No
// <script type="module">, no code-splitting, no import maps on the host page.
//
// Each feature is its own IIFE (a separate global name), so each needs its
// own build pass — that's what FEATURE selects below. Run:
//   npm run build            (builds every feature, one after another)
//   npm run build:databin    (just the Data Bin wizard)
//   npm run build:admin      (just the Admin dashboard)
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
}

const featureKey = process.env.AXI_FEATURE || 'databin'
const feature = FEATURES[featureKey]
if (!feature) {
  throw new Error(`Unknown AXI_FEATURE "${featureKey}". Valid: ${Object.keys(FEATURES).join(', ')}`)
}

export default defineConfig({
  plugins: [react()],
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
      output: {
        // Force a predictable CSS filename instead of a hashed one.
        assetFileNames: (info) =>
          info.name && info.name.endsWith('.css') ? `${feature.fileName}.css` : 'assets/[name][extname]',
      },
    },
  },
})
