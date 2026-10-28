import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** The renderer alone in a browser (web bridge fallback): UI tests now, the phase-2 web client later. */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
  plugins: [react()],
  server: { port: 5183, strictPort: true },
});
