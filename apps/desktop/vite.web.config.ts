import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The renderer alone in a browser (web bridge fallback): UI tests (`dev:web`) and the web client
 * (`build:web` → dist-web/). The API URL is read at runtime from dist-web/config.json (see webBridge.ts).
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  // Relative asset paths: the site works from any path prefix; routing is hash-based.
  base: './',
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
  plugins: [react()],
  server: { port: 5183, strictPort: true },
  preview: { port: 5184, strictPort: true },
  build: { outDir: resolve(__dirname, 'dist-web'), emptyOutDir: true },
});
