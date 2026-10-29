import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// Release builds bake the server address in: NEXUS_API_URL=https://nexus.yourcompany.com pnpm build:win (SOT §13).
const bakedApiUrl = process.env.NEXUS_API_URL ?? '';
const bakedUpdateUrl = process.env.NEXUS_UPDATE_URL ?? '';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@nexus/shared'] })],
    define: { __BAKED_API_URL__: JSON.stringify(bakedApiUrl), __BAKED_UPDATE_URL__: JSON.stringify(bakedUpdateUrl) },
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    plugins: [react()],
    server: { port: 5183 },
  },
});
