# Nexus

An internal, LinkedIn-style professional network for your company, delivered as a **Windows desktop app**.
Admins model the company as a **hierarchy DAG** (units may report to several parents), attach **roles & permissions** to units or people, and employees get a full social experience: feed, posts, reactions, comments, profiles, connections, messaging, notifications, groups, events, articles, and internal jobs.

> **Phase 1:** internal company use (current). **Phase 2:** public, multi-tenant release.
> The single source of truth for decisions, architecture and the roadmap is [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md). Read it before changing behaviour.

---

## Contents

1. [Tech stack](#tech-stack)
2. [Repository layout](#repository-layout)
3. [Set up on a new device](#set-up-on-a-new-device)
4. [Daily development](#daily-development)
5. [Demo accounts](#demo-accounts)
6. [Building the Windows installer](#building-the-windows-installer)
7. [Deploying for the company](#deploying-for-the-company)
8. [Project status: phases done / to do](#project-status-phases-done--to-do)
9. [Working on this project with Claude](#working-on-this-project-with-claude)
10. [Troubleshooting](#troubleshooting)

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Desktop shell | Electron 33, electron-vite, electron-builder (NSIS) |
| UI | React 18, TypeScript, Tailwind CSS (CSS-variable tokens, light/dark/system theme), TanStack Query, Zustand, React Flow + dagre (org graph) |
| API | Node 20+, Fastify 4, Zod, Socket.IO (realtime), JWT auth |
| Data | PostgreSQL 16 via Prisma 5 |
| Files | Any S3-compatible store (SeaweedFS locally, MinIO/AWS S3 in prod) |
| Monorepo | pnpm workspaces |

---

## Repository layout

```
.
├─ README.md                 ← you are here
├─ SOURCE_OF_TRUTH.md        ← decisions, architecture, data model, roadmap, QA log
├─ CLAUDE.md                 ← orientation for Claude Code sessions
├─ docker-compose.yml        ← Postgres (:5434) + S3 / SeaweedFS (:8334)
├─ packages/shared/          ← APP_NAME, permission catalog, system roles, shared types
├─ apps/server/              ← Fastify API
│  ├─ prisma/schema.prisma   ← database schema (authoritative)
│  ├─ prisma/seed.ts         ← demo company, hierarchy, roles, users, content
│  └─ src/
│     ├─ dag/                ← hierarchy DAG engine (+ unit tests)
│     ├─ rbac/               ← permission resolution on the DAG
│     ├─ lib/                ← auth, http helpers, storage, realtime, notifications
│     └─ routes/             ← auth, hierarchy, admin, users, network, posts, conversations,
│                              notifications, groups, events, articles, jobs, search, media, reports
└─ apps/desktop/             ← Electron app
   ├─ electron-builder.yml   ← installer config
   ├─ build/icon.ico|png     ← app icon
   └─ src/
      ├─ main/               ← Electron main process (window, secure token storage, notifications)
      ├─ preload/            ← narrow bridge exposed to the UI
      └─ renderer/src/       ← React app (pages/, pages/admin/, components/, lib/)
```

---

## Set up on a new device

### 1. Install prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Git | any recent | `git --version` |
| Node.js | **20 or newer** (developed on 24) | `node -v` |
| pnpm | **10 or newer** (developed on 12) | `pnpm -v` (install: `npm i -g pnpm`) |
| Docker Desktop | running | `docker version` |
| Python 3 (optional) | for the e2e script | `python --version` |

### 2. Clone and install

```bash
git clone https://github.com/shubham075/Nexus.git
cd Nexus
pnpm install
```

pnpm only runs install scripts for packages allowed in `pnpm-workspace.yaml` (`allowBuilds`: Electron, Prisma, esbuild). If it reports *ignored build scripts*, run `pnpm approve-builds --all` and then `pnpm install` again.

### 3. Start the database and file storage

```bash
docker compose up -d
```

This starts **Postgres on port 5434** and **S3-compatible storage (SeaweedFS) on port 8334**. These non-default ports avoid clashing with other local projects. If they're taken on your machine, change the host ports in `docker-compose.yml` and in `apps/server/.env`.

### 4. Configure the API

```bash
cp apps/server/.env.example apps/server/.env
```

The defaults work out of the box for local development. Change `JWT_SECRET` for anything shared.

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection (uses `127.0.0.1`, not `localhost`; see [Troubleshooting](#troubleshooting)) |
| `JWT_SECRET` | Signs login tokens. **Use a long random value outside dev** |
| `PORT`, `PUBLIC_URL` | API port and the public base URL used in media links |
| `S3_*` | Object storage endpoint, bucket and keys |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_DEMO_PASSWORD` | Credentials created by the seed |

### 5. Create the database and demo data

```bash
pnpm db:migrate     # applies prisma/migrations
pnpm db:seed        # demo company, hierarchy, roles, users, posts
```

### 6. Run it

```bash
pnpm dev            # API on :4000 + Electron app (renderer dev server on :5183)
```

The Electron window opens on the sign-in screen. The renderer also works in a normal browser at <http://localhost:5183>, which is handy for quick UI checks (it uses a web fallback for the desktop bridge).

### 7. Verify

```bash
pnpm test           # DAG engine + RBAC unit tests (7 tests)
pnpm typecheck      # all packages
```

---

## Daily development

| Command (from repo root) | What it does |
|--------------------------|--------------|
| `pnpm dev` | API (watch mode) + Electron app together |
| `pnpm dev:server` / `pnpm dev:desktop` | Run one side only |
| `pnpm db:migrate` | Create/apply a migration after editing `schema.prisma` |
| `pnpm db:seed` | Seed an **empty** DB (skips if users exist) |
| `pnpm db:reset` | Drop, re-migrate and re-seed (**destroys local data**) |
| `pnpm test` | Server unit tests |
| `pnpm test:e2e` | API end-to-end suite against the running API (`pnpm dev:server` first; re-runnable on the same DB) |
| `pnpm test:ui` | Playwright UI tests in a browser (starts the API and `dev:web` renderer if not running; `PW_CHANNEL=msedge` uses installed Edge) |
| `pnpm typecheck` | TypeScript across the monorepo |
| `pnpm build:win` | Windows installer → `apps/desktop/release/` |

Conventions:
- **API:** REST under `/api/v1`, Zod-validated bodies, cursor pagination `{ items, nextCursor }`, errors as `{ error: { code, message } }`.
- **Every permission check happens on the server** (`requirePerm`, `assertCan`, `canOverUser`). UI checks (`useCan`) only hide controls.
- **Mentions** are stored as `@[Name](userId)`. The composer shows `@Name`.
- **Theme** colours are CSS variables in `apps/desktop/src/renderer/src/index.css`. Use `zinc-*`, `bg-surface` and `brand-*` so both themes work.
- Change a product decision in `SOURCE_OF_TRUTH.md` **first**, then the code.

---

## Demo accounts

Created by `pnpm db:seed` (passwords come from `apps/server/.env`):

| Email | Role in the demo | Password variable |
|-------|------------------|-------------------|
| `admin@nexus.local` | Super admin | `SEED_ADMIN_PASSWORD` |
| `divya@nexus.local` | HR Admin (manages people, hierarchy, roles) | `SEED_DEMO_PASSWORD` |
| `priya@nexus.local` | VP Engineering, Manager and Moderator scoped to Engineering | `SEED_DEMO_PASSWORD` |
| `vikram@nexus.local` | Recruiter (company-wide) | `SEED_DEMO_PASSWORD` |
| `meera`, `rahul`, `arjun`, `sara`, `neha`, `karan` `@nexus.local` | Employees in different units | `SEED_DEMO_PASSWORD` |

The demo hierarchy includes multi-parent units: **Mobile Squad** reports to both Engineering and Product, and **Security Guild** reports to Engineering and Product.

---

## Building the Windows installer

```bash
pnpm build:win
```

Output: `apps/desktop/release/Nexus-Setup-<version>.exe` (NSIS, x64, about 25 MB). Bump `version` in `apps/desktop/package.json` for each release.

- **First build** downloads Electron and the NSIS tools (a few minutes). Later builds take 1–2 minutes.
- **"Cannot create symbolic link" error:** turn on Windows **Developer Mode**, or see section 13 of `SOURCE_OF_TRUTH.md` for the one-time cache workaround.
- **Unsigned:** SmartScreen warns about an unknown publisher until you add a code-signing certificate (`CSC_LINK`, `CSC_KEY_PASSWORD` env vars).

---

## Deploying for the company

1. **Server:** run `apps/server` on an internal host with Node 20+ (`pnpm --filter @nexus/server start`), a managed PostgreSQL and S3-compatible storage. Set strong `JWT_SECRET` and `PUBLIC_URL` values, then run `npx prisma migrate deploy` in `apps/server`. Put it behind HTTPS (reverse proxy) and allow WebSockets for realtime.
2. **First admin:** run the seed once, or create a super admin in the database. Then sign in and **change the password**. Remove or deactivate the demo users from **Admin → Employees**.
3. **Clients:** install `Nexus-Setup-x.y.z.exe`, then point it at the server by placing this file **next to `Nexus.exe`** (IT-wide) or in `%APPDATA%\Nexus` (per user):
   ```json
   { "apiUrl": "https://nexus.yourcompany.internal" }
   ```
   Lookup order: per-user file → file next to the exe → `NEXUS_API_URL` env var → `http://localhost:4000`.

---

## Project status: phases done / to do

Legend: ✅ done · 🟡 partly done · ⬜ not started

### Phase 1a: foundation ✅
- ✅ pnpm monorepo, Docker infra, Prisma schema and migrations, demo seed
- ✅ Email + password auth, admin-invited accounts, forced password change, JWT stored with OS encryption (Electron `safeStorage`)
- ✅ **Hierarchy DAG engine:** multi-parent units, rejects cycles, self-edges, duplicates and removing a unit's last parent; topological sort, ancestors/descendants, breadcrumb paths (unit-tested)
- ✅ **RBAC:** 17-permission catalog, custom roles, grants per unit or per user, inherited down the DAG, moderation scoped to a sub-tree (unit-tested)
- ✅ Admin console: visual hierarchy editor, roles/permission matrix, employees (invite, deactivate, reset password, effective permissions), audit log, analytics

### Phase 1b: social features ✅ (QA'd 2026-10-28)
- ✅ Feed with ranking and pinned announcements; posts with images, video, PDFs, polls, celebrations, reposts (plain or with thoughts), @mentions, #hashtags, edit/delete, save, report
- ✅ 6 reaction types, threaded comments (one reply level) with reactions
- ✅ Profiles: about, experience, education, skills, endorsements, org breadcrumbs, profile viewers, avatar/cover upload
- ✅ Network: connect / accept / ignore / withdraw, follow, People You May Know, connection degree
- ✅ Realtime messaging (1:1 and group, attachments, typing indicator, "seen"), notification centre, native Windows notifications, unread badges
- ✅ Groups (public/private, join requests, roles), events (RSVP, invites), articles and newsletters, internal jobs (apply, applicant pipeline, saved jobs), global search, moderation queue
- ✅ Minimal premium UI with light / dark / system theme; responsive layout; global error toasts
- ✅ Windows NSIS installer (unsigned) with configurable server URL

### Phase 1c: hardening 🟡 (in progress)
- ✅ Two-user realtime QA (messaging, typing, "seen", presence, unread and notification badges); UI file-picker upload QA (QA'd 2026-10-28, see SOT §12)
- ⬜ Installer build is flaky on locked-down machines (NSIS uninstaller step killed; see SOT §13)
- ✅ Automated tests: API e2e suite in the repo (`pnpm test:e2e`, 16 scenarios), Playwright UI tests (`pnpm test:ui`), GitHub Actions CI (`.github/workflows/ci.yml`: typecheck, unit, API e2e, UI; Windows installer artifact on `master`)
- ⬜ SSO (Azure AD / Google Workspace OIDC), refresh tokens, rate limiting, password policy
- ⬜ Full-text search (Postgres `tsvector`), Redis for Socket.IO fan-out
- ⬜ Auto-update (`electron-updater` + internal feed), code-signing certificate
- ⬜ Authenticated media URLs (currently unguessable but public keys), retention policy, data export
- ⬜ Production deployment guide/scripts (Docker image for the API, backups, monitoring)

### Phase 2: public release ⬜
- ⬜ Multi-tenancy (one org per tenant), public sign-up and company pages
- ⬜ Post visibility levels (public / connections / selected units)
- ⬜ Web client (the renderer already runs in a browser) and mobile clients
- ⬜ Recommendations (feed ranking, PYMK), premium features, macOS/Linux builds

Open product questions are listed in `SOURCE_OF_TRUTH.md` §11.

---

## Working on this project with Claude

This repo is set up so that a **new Claude Code session** (desktop app / GUI, CLI or IDE) on any machine can pick up where the last one stopped:

1. Clone the repo and follow [Set up on a new device](#set-up-on-a-new-device).
2. Open the folder in Claude Code. It automatically reads [`CLAUDE.md`](CLAUDE.md), which points to the source of truth, commands, conventions and gotchas.
3. Start with a prompt such as:
   > Read SOURCE_OF_TRUTH.md and the "Project status" section of README.md, then start phase 1c: *(pick an item)*.
4. When a phase item is finished, tick it in this README **and** update `SOURCE_OF_TRUTH.md` (roadmap §10, QA log §12), so the next device or session sees the true status.

Claude's memory on one device doesn't move to another device, so these two files are the hand-over.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Every request takes ~200 ms on Windows | Use `127.0.0.1` in `DATABASE_URL` / `S3_ENDPOINT`. The API already listens dual-stack (`::`). |
| `P1000 Authentication failed` from Prisma | Another Postgres is on that port. Check `docker ps` and change the host port in `docker-compose.yml` + `.env`. |
| `pull access denied for minio/minio` | MinIO images are no longer on Docker Hub; this repo uses SeaweedFS instead (already configured). |
| pnpm *ignored build scripts* | `pnpm approve-builds --all`, then `pnpm install`. |
| Uploads fail | Is the `s3` container running? The API logs `MinIO not reachable` at startup if storage is down. |
| Blank screen / "Something went wrong on this screen" | Open DevTools (Ctrl+Shift+I in dev) and check the console; the error boundary shows the message. |
| `pnpm db:seed` says "already seeded" | Expected on a non-empty DB; use `pnpm db:reset` to start over (destroys data). |
| Installer build: "Cannot create symbolic link" | Enable Windows Developer Mode or see `SOURCE_OF_TRUTH.md` §13. |
