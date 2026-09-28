import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: { port: 8081, strictPort: true },
  resolve: {
    // Lets host-demo.html import the public API exactly like a host app would: import { StructForm } from '@tstruct/react'
    alias: { '@tstruct/react': r('./src/embed/index.js') },
  },
  build: {
    rollupOptions: {
      input: { main: r('./index.html'), 'host-demo': r('./host-demo.html') },
    },
  },
});
