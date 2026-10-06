// Plain-browser build of the renderer. The UI talks to a `Platform` adapter, so it also runs
// without Electron (file input + downloads + localStorage). Handy for quick UI iteration/tests.
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
  plugins: [react()],
  server: { port: 5199, strictPort: true, fs: { allow: [resolve(__dirname)] } },
});
