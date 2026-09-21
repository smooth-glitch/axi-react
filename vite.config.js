import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// This project does NOT produce a normal SPA. It builds a single self-contained
// IIFE bundle per feature that gets pasted into the host platform's script slot,
// exactly like the existing axi-*.js files in AXIBOT/. No <script type="module">,
// no code-splitting, no import maps required on the host page.
//
// Run `npm run build` then copy dist/axi-databin-wizard.js (and dist/style.css,
// if present) into the AXIBOT project / the platform's Js + Css slots.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, 'src/features/databin/mount.jsx'),
      name: 'AxiDataBinWizard',
      formats: ['iife'],
      fileName: () => 'axi-databin-wizard.js',
    },
    rollupOptions: {
      output: {
        // Force a predictable CSS filename instead of a hashed one.
        assetFileNames: (info) =>
          info.name && info.name.endsWith('.css') ? 'axi-databin-wizard.css' : 'assets/[name][extname]',
      },
    },
  },
})
