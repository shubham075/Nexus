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
7. [Deploying for the company](#deploying-for-the-company) (incl. [Single sign-on](#single-sign-on-oidc), [Web client](#web-client))
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
├─ docker-compose.yml        ← dev: Postgres (:5434) + S3 / SeaweedFS (:8334)
├─ deploy/                   ← production: compose stack, Caddy, backups, guide (deploy/README.md)
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
| Docker Desktop | running, with **4 GB+ free RAM** (it stops when the machine runs out) | `docker version` |

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

This starts **Postgres on port 5434**, **S3-compatible storage (SeaweedFS) on port 8334** **Redis on port 6381** (only used when `REDIS_URL` is set) and **Mailpit** (dev inbox: SMTP on 1026, every mail the API sends shows up at http://localhost:8026). These non-default ports avoid clashing with other local projects. If they're taken on your machine, change the host ports in `docker-compose.yml` and in `apps/server/.env`.

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
| `MEDIA_URL_SECRET`, `MEDIA_URL_TTL_SECONDS` | Signs media links (defaults: derived from `JWT_SECRET`, 3600 s) |
| `RETENTION_*` | Purge windows in days for hidden content, messages, notifications, audit log (see SOT §8) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_DEMO_PASSWORD` | Credentials created by the seed |
| `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS` | Access JWT lifetime (default `15m`) and refresh-token idle lifetime in days (default `30`) |
| `TRUST_PROXY` | Set to `true` (or proxy IPs) behind a reverse proxy so rate limits see the real client IP. `RATE_LIMIT=off` disables limits (tests only) |
| `OIDC_PROVIDERS`, `OIDC_<ID>_*` | Optional single sign-on; see [Single sign-on](#single-sign-on-oidc) |

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
pnpm typecheck      # all packages
pnpm test           # unit + DB tests (31: DAG, RBAC, media signatures, password policy, auth routes, search)
pnpm test:e2e       # 16 API scenarios against the running API (keep `pnpm dev` or `pnpm dev:server` running)
pnpm --filter @nexus/desktop exec playwright install chromium   # once per device
pnpm test:ui        # 3 Playwright UI tests (two-user realtime messaging included)
```

On managed laptops where Playwright's Chromium hangs, use the installed Edge: `PW_CHANNEL=msedge pnpm test:ui` (PowerShell: `$env:PW_CHANNEL='msedge'; pnpm test:ui`).

### Picking up work on another device (already cloned)

```bash
git pull
pnpm install                 # new dependencies from other devices
docker compose up -d
pnpm db:migrate              # applies migrations added since your last pull (keeps your data)
pnpm dev
```

- Compare `apps/server/.env` with `apps/server/.env.example` after pulling; copy over any new variables (the defaults work for local dev).
- `pnpm db:reset` if your local database is in a bad state (**destroys local data**, re-seeds the demo company).
- Every push to `master` runs CI (`.github/workflows/ci.yml`), and the Windows installer is attached to the run as the `nexus-installer` artifact.

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

Output in `apps/desktop/release/`: `Nexus-Setup-<version>.exe` (NSIS, x64, about 25 MB), its `.blockmap` and `latest.yml` (the auto-update manifest). Bump `version` in `apps/desktop/package.json` for each release.

- **First build** downloads Electron and the NSIS tools (a few minutes). Later builds take 1–2 minutes.
- **"Cannot create symbolic link" error:** turn on Windows **Developer Mode**, or see section 13 of `SOURCE_OF_TRUTH.md` for the one-time cache workaround.
- **Unsigned by default:** SmartScreen warns about an unknown publisher. To sign, set `CSC_LINK` (the `.pfx`) and `CSC_KEY_PASSWORD` before `pnpm build:win`, or use Azure Trusted Signing with `pnpm --filter @nexus/desktop build:win:azure` (fill in `apps/desktop/electron-builder.azure.yml`, set `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`). Once you ship a signed build, never ship an unsigned one again: signed installs reject unsigned updates. Details: `SOURCE_OF_TRUTH.md` §13.3.
- **Endpoint security** on some managed laptops kills the NSIS step (`Exit code: null`); build on CI (`windows-latest`) instead.

---

## Deploying for the company

Full guide: **[`deploy/README.md`](deploy/README.md)** (what to provision, first deployment, upgrades, backups and restore, monitoring, TLS).

1. **Server:** one Docker host runs the API image ([`apps/server/Dockerfile`](apps/server/Dockerfile)), PostgreSQL, S3-compatible storage, optional Redis, nightly backups and Caddy for HTTPS + WebSockets: copy `deploy/.env.prod.example` to `deploy/.env.prod`, fill in the secrets, then `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d --build`. Migrations run automatically as a one-shot `migrate` service. Health: `/health/ready` (DB + storage), `/health/live`; Prometheus metrics on `api:4000/metrics`.
2. **First admin:** `docker compose … run --rm api seed` once on the empty database (creates `SEED_ADMIN_EMAIL`). Then sign in and **change the password**. Remove or deactivate the demo users from **Admin → Employees**.
3. **Clients:** install `Nexus-Setup-x.y.z.exe`, then point it at the server by placing this file **next to `Nexus.exe`** (IT-wide) or in `%APPDATA%\Nexus` (per user):
   ```json
   { "apiUrl": "https://nexus.yourcompany.internal" }
   ```
   Lookup order: per-user file → file next to the exe → `NEXUS_API_URL` env var → `http://localhost:4000`.
4. **Updates:** clients check `<apiUrl>/updates/` on launch and every 4 hours, download in the background and show a **Restart to update** banner (they never restart on their own). To use another static host add `"updateUrl": "https://files.yourcompany.internal/nexus/"` to `nexus.config.json`.

### Releasing an update
1. Bump `version` in `apps/desktop/package.json`.
2. `pnpm build:win` (signed if `CSC_LINK` / Azure is configured).
3. Copy `Nexus-Setup-<v>.exe` and `Nexus-Setup-<v>.exe.blockmap`, then **`latest.yml` last**, into the API host's `apps/server/updates/` folder (or `UPDATES_DIR`), or to your `updateUrl` host. No server restart needed.

### Single sign-on (OIDC)

Optional. Users still need an account (admins invite them); SSO matches the IdP's verified email to an existing, active Nexus user, and password sign-in keeps working. The app opens the system browser, and the result comes back to the app over a one-shot `http://127.0.0.1:<port>` listener (details in `SOURCE_OF_TRUTH.md` §8).

`PUBLIC_URL` must be the URL users' browsers reach the API on. Register this redirect URI at the IdP (one per provider id):
`<PUBLIC_URL>/api/v1/auth/sso/<id>/callback`, e.g. `https://nexus.yourcompany.internal/api/v1/auth/sso/microsoft/callback`.

**Microsoft Entra ID (Azure AD):** Entra admin centre → App registrations → New registration → single tenant; platform **Web** with the redirect URI above; Certificates & secrets → new client secret.

```env
OIDC_PROVIDERS="microsoft"
OIDC_MICROSOFT_LABEL="Microsoft"
OIDC_MICROSOFT_ISSUER="https://login.microsoftonline.com/<tenant-id>/v2.0"   # tenant-specific, never /common
OIDC_MICROSOFT_CLIENT_ID="<application (client) id>"
OIDC_MICROSOFT_CLIENT_SECRET="<secret value>"
OIDC_MICROSOFT_EMAIL_CLAIM="preferred_username"   # the UPN; use "email" if you add the optional email claim
OIDC_MICROSOFT_ALLOWED_DOMAINS="yourcompany.com"
```

**Google Workspace:** Google Cloud console → APIs & Services → OAuth consent screen (**Internal**) → Credentials → OAuth client ID → **Web application** with the redirect URI above.

```env
OIDC_PROVIDERS="google"             # or "microsoft,google" for both
OIDC_GOOGLE_LABEL="Google"
OIDC_GOOGLE_ISSUER="https://accounts.google.com"
OIDC_GOOGLE_CLIENT_ID="<client id>"
OIDC_GOOGLE_CLIENT_SECRET="<client secret>"
OIDC_GOOGLE_ALLOWED_DOMAINS="yourcompany.com"
```

Restart the API. The sign-in screen then shows **Continue with Microsoft/Google**. An invited user who signs in by SSO before setting a password has their temporary password retired; **Admin → Employees → Reset password** gives them one again.

### Web client
The desktop renderer also runs as a static website (groundwork for phase 2d). In a browser `apps/desktop/src/renderer/src/lib/webBridge.ts` stands in for Electron's preload: tokens in `localStorage` (the phase-2 web choice; the strict CSP below limits who can read them), browser notifications (permission is asked on the first click; denied or unsupported → silently skipped), unread badge in the tab title, no auto-update, and **no SSO buttons** (the loopback flow is desktop-only until a web redirect flow exists).

- **Dev:** `pnpm dev:server`, then `pnpm --filter @nexus/desktop dev:web` → http://localhost:5183 (uses `VITE_API_URL` or `http://localhost:4000`).
- **Build:** `pnpm build:web` → `apps/desktop/dist-web/` (hash routing, relative paths). Preview with `pnpm --filter @nexus/desktop preview:web` (http://localhost:5184).
- **API URL at runtime:** the app fetches `config.json` next to `index.html`, `{ "apiUrl": "https://api.example.com" }`, so one build serves every environment. Without it, the build-time `VITE_API_URL` (or `http://localhost:4000`) is used.
- **Deploy:** the prod compose builds the `web` service from [`deploy/web/Dockerfile`](deploy/web/Dockerfile) (Caddy serving `dist-web` on :8080; it writes `config.json` from `NEXUS_API_URL` = `PUBLIC_URL` at start). The front Caddy serves it at `NEXUS_WEB_DOMAIN` (default `app.<NEXUS_DOMAIN>`, needs its own DNS record/certificate) and the API stays at `NEXUS_DOMAIN`. Caching: `assets/*` (content-hashed) `immutable` for a year, `index.html` `no-cache`, `config.json` `no-store`; unknown paths fall back to `index.html`.
- **CSP** (header from the web container, [`deploy/web/Caddyfile`](deploy/web/Caddyfile)): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src/media-src 'self' data: blob: https:; connect-src 'self' <NEXUS_API_URL>` (an `https:` origin also allows its `wss:` Socket.IO connection), `frame-ancestors 'none'; object-src 'none'`. The looser `<meta>` CSP in `index.html` is for Electron; browsers enforce both, so the header wins.
- **CORS:** the API currently reflects any origin (`@fastify/cors` with `origin: true`); auth is a bearer token, not a cookie, so this does not expose sessions. Before public launch restrict it to the web origin (e.g. a `CORS_ORIGINS` env list) and keep `credentials` off unless refresh tokens move to an httpOnly cookie.

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

### Phase 1c: hardening ✅ (merged 2026-10-28)
- ✅ Two-user realtime QA (messaging, typing, "seen", presence, unread and notification badges); UI file-picker upload QA (QA'd 2026-10-28, see SOT §12)
- ✅ Automated tests: API e2e suite in the repo (`pnpm test:e2e`, 16 scenarios), Playwright UI tests (`pnpm test:ui`), GitHub Actions CI (`.github/workflows/ci.yml`: typecheck, unit, API e2e, UI; Windows installer artifact on `master`)
- ✅ Auth hardening: 15-min access tokens + rotating, revocable refresh tokens (`/auth/refresh`, `/auth/logout`; password change/reset and deactivation revoke sessions), rate limiting, password policy (10+ chars, 4 character classes), OIDC SSO for Azure AD / Google Workspace (unit and DB route tests pass; a live IdP round trip needs a real tenant)
- ✅ Full-text search (Postgres `tsvector` + GIN, `ts_rank`, prefix search-as-you-type), Redis for Socket.IO fan-out + shared presence (opt-in via `REDIS_URL`)
- ✅ Auto-update (`electron-updater` + generic feed served by the API at `/updates/`), "Restart to update" banner, code-signing wiring (PFX or Azure Trusted Signing). Still needed: a real certificate and an end-to-end update test from a CI-built installer
- ✅ Signed, expiring media URLs (HMAC, re-signed on every read); retention purge job (defaults await product-owner confirmation, SOT P1); JSON data export (self + admin, audited)
- ✅ Production deployment guide/scripts: API Docker image, prod compose (Caddy HTTPS/WSS, Postgres, S3, Redis), nightly backups + tested restore, `/health/ready|live`, Prometheus metrics ([`deploy/README.md`](deploy/README.md))

### Still to do before rolling out phase 1 (needs people or accounts, not code)
- ⬜ **Code-signing certificate** (PFX or Azure Trusted Signing) → add as CI secrets `CSC_LINK` / `CSC_KEY_PASSWORD`
- ⬜ **SSO tenant**: register the app in Entra ID / Google Workspace and test a live sign-in ([Single sign-on](#single-sign-on-oidc))
- ⬜ **Product owner**: confirm retention defaults (SOT §1 P1) and data-export scope (P2); answer SOT §11 questions
- ⬜ **End-to-end auto-update test**: install a CI-built v0.1.0, publish v0.1.1 to the feed, check the banner and restart
- ⬜ **Production server**: provision the Docker host, DNS and TLS, then follow [`deploy/README.md`](deploy/README.md)
- ✅ Packaged-build QA (unpacked `--dir` build, 2026-10-29): native notifications fire, taskbar overlay badge (fixed: Windows has no `setBadgeCount`), group chat UI, video upload + playback; also the multi-mode org switcher and the web client against a live API (SOT §12). Still to see by eye on an installed (NSIS) build: the toast and badge themselves, and clicking a toast
- 🟡 Local installer builds can fail on locked-down laptops (endpoint security kills the NSIS step, SOT §13); use the CI artifact

### Phase 2: public release 🟡 (2a done; spec: SOT §14, decisions D20–D23)
- ✅ **2a: tenancy core** (2026-10-29): Organization / OrgMember / OrgDomain, `orgId` on company tables (migration moves existing data into the first org), org-scoped RBAC and DAG caches, active org per request (`X-Org-Id`, `apps/server/src/lib/org.ts`), `TENANCY=single|multi` (default `single`), org switcher in multi mode. 23/23 e2e incl. 6 cross-org tests; seed adds a test-only org `globex`. Posts, articles and people stay global until 2c (SOT §12)
- ⬜ **2b: accounts & companies**: ✅ email service (`lib/mailer.ts` SMTP + `lib/emailTemplates.ts`, Mailpit dev inbox); ⬜ public sign-up + email verification, password reset by email, company creation, domain verification, join policies, company pages + follow, platform admin
- ⬜ **2c: visibility & feed**: post visibility (public / connections / company / units), visibility-aware feed, search, notifications and media
- ⬜ **2d: public surface**: public jobs on company pages, public groups/events, web client deployment, abuse controls
  - ✅ web client groundwork: `pnpm build:web`, runtime `config.json`, browser bridge, `deploy/web` image + `app.<domain>` in the prod compose, CI build ([Web client](#web-client))
  - ⬜ web SSO redirect flow, CORS allow-list, cookie-based refresh tokens
- ⬜ **2e: later**: recommendations, premium, macOS/Linux builds, mobile clients

Phase-1 product decisions are settled (D17–D19, 2026-10-29): messages expire after 2 years; managers see analytics for their own units; no HRIS sync for now.

Open product questions are listed in `SOURCE_OF_TRUTH.md` §11.

---

## Working on this project with Claude

This repo is set up so that a **new Claude Code session** (desktop app / GUI, CLI or IDE) on any machine can pick up where the last one stopped:

1. Clone the repo and follow [Set up on a new device](#set-up-on-a-new-device).
2. Open the folder in Claude Code. It automatically reads [`CLAUDE.md`](CLAUDE.md), which points to the source of truth, commands, conventions and gotchas.
3. Start with a prompt such as:
   > Read SOURCE_OF_TRUTH.md and the "Project status" section of README.md, then start phase 2: *(pick an item)*.

   Phase 2a (tenancy core) is done; continue with 2b (accounts & companies).
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
