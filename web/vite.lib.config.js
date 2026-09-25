import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Library build: `npm run build:lib` -> dist-lib/tstruct-react.js (ES module).
// react, react-dom and styled-components stay external so the host app supplies (and shares) them.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-lib',
    emptyOutDir: true,
    lib: { entry: fileURLToPath(new URL('./src/embed/index.js', import.meta.url)), formats: ['es'], fileName: () => 'tstruct-react.js' },
    rollupOptions: { external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', 'styled-components'] },
  },
});
