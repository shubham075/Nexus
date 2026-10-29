#!/usr/bin/env node
// One-step release bundle (SOT §13): `pnpm release -- --api-url https://nexus.yourcompany.com`
// Produces release/nexus-<version>/ (+ .zip):
//   desktop/  the installer for the intranet download link
//   server/   the files to copy to the server (source for the Docker images, deploy/ with the update feed filled in)
//   INSTALL.md the step-by-step guide (deploy/INSTALL.md)
// Flags: --api-url (or NEXUS_API_URL), --update-url (or NEXUS_UPDATE_URL, optional), --skip-build (reuse apps/desktop/release).
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const apiUrl = (arg('--api-url') ?? process.env.NEXUS_API_URL ?? '').replace(/\/+$/, '');
const updateUrl = arg('--update-url') ?? process.env.NEXUS_UPDATE_URL ?? '';
if (!/^https?:\/\//.test(apiUrl)) {
  console.error('Pass the server address: pnpm release -- --api-url https://nexus.yourcompany.com');
  process.exit(1);
}
if (!apiUrl.startsWith('https://')) console.warn(`! ${apiUrl} is not HTTPS; use it for a local trial only.`);

const { version } = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8'));
const run = (cmd, env = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });

// 1. Installer with the server address baked in.
const built = join(root, 'apps/desktop/release');
if (!args.includes('--skip-build')) {
  rmSync(built, { recursive: true, force: true });
  run('pnpm --filter @nexus/desktop build:win', { NEXUS_API_URL: apiUrl, NEXUS_UPDATE_URL: updateUrl });
}
const setup = `Nexus-Setup-${version}.exe`;
const feedFiles = [setup, `${setup}.blockmap`, 'latest.yml'];
for (const f of feedFiles) if (!existsSync(join(built, f))) throw new Error(`Missing apps/desktop/release/${f}; did the build succeed?`);

// 2. Bundle layout.
const out = join(root, 'release', `nexus-${version}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'desktop'), { recursive: true });
cpSync(join(built, setup), join(out, 'desktop', setup));

// Server: tracked files only (no secrets, node_modules or local data), taken from the working tree.
const tracked = execSync('git ls-files -z', { cwd: root }).toString().split('\0').filter(Boolean);
const serverPaths = /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|\.npmrc|apps\/server\/|apps\/desktop\/|packages\/shared\/|deploy\/)/;
for (const f of tracked) {
  if (!serverPaths.test(f) || !existsSync(join(root, f))) continue;
  mkdirSync(dirname(join(out, 'server', f)), { recursive: true });
  cpSync(join(root, f), join(out, 'server', f));
}
// The API serves deploy/updates/ at /updates/: installed apps update themselves from it.
mkdirSync(join(out, 'server/deploy/updates'), { recursive: true });
for (const f of feedFiles) cpSync(join(built, f), join(out, 'server/deploy/updates', f));
cpSync(join(root, 'deploy/INSTALL.md'), join(out, 'INSTALL.md'));

// 3. Zip with bsdtar (Windows 10+ System32, macOS); Git Bash's GNU tar comes first on PATH and cannot write zips.
const zip = `${out}.zip`;
rmSync(zip, { force: true });
try {
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe') : 'tar';
  execSync(`"${tar}" -a -c -f "${zip}" -C "${join(root, 'release')}" "nexus-${version}"`, { stdio: 'ignore' });
} catch {
  console.warn('! Could not create the .zip; copy the folder instead.');
}

const size = (dir) => readdirSync(dir, { recursive: true }).length;
console.log(`\nRelease ${version} for ${apiUrl}\n  ${out} (${size(out)} files)\n  ${existsSync(zip) ? zip : '(no zip)'}\nNext: follow INSTALL.md.`);
