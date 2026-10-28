// Bundles the API (and the seed) into dist/ for production. npm dependencies stay external and are
// resolved from node_modules at runtime; the workspace package @nexus/shared (TS source) is inlined.
import { build } from 'esbuild';
import { readFileSync, rmSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@nexus/'));

rmSync('dist', { recursive: true, force: true });
await build({
  entryPoints: { index: 'src/index.ts', seed: 'prisma/seed.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  external,
  logLevel: 'info',
});
