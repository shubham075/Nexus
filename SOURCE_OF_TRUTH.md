# Nexus — Source of Truth

> Internal professional social network (LinkedIn-style) desktop application.
> **Phase 1:** internal company use. **Phase 2:** public, multi-tenant release.
> This document is the single source of truth for product scope, architecture and decisions.
> Any change to a decision below must be made here first.

Last updated: 2026-10-28

---

## 1. Decisions log (answered by product owner)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Desktop stack | **Electron + React + TypeScript** (electron-vite, Tailwind) |
| D2 | Backend / data | **Central API server + PostgreSQL**; all desktop clients connect to it |
| D3 | Auth | **Email + password, admin-invited accounts**; optional **OIDC SSO** (Azure AD / Google Workspace) that only matches existing accounts by email — no self sign-up |
| D4 | Hierarchy shape | **Multi-parent DAG** (matrix org); cycles rejected by the engine |
| D5 | Permission inheritance | **Flows down to descendants**; effective permissions = union of all grants on all paths |
| D6 | Phase 1 features | Feed/posts/reactions/comments/reposts, profiles/connections/follow, messaging + notifications, groups/events/articles/jobs |
| D7 | Moderation | **Post freely + report/moderate** (moderators scoped by hierarchy) |
| D8 | Post visibility | **Whole company** (all authenticated employees) in phase 1 |
| D9 | Media storage | **S3-compatible** object storage. Local dev uses **SeaweedFS** (MinIO images are no longer pullable from Docker Hub); any S3 endpoint (MinIO, AWS S3) works via `S3_ENDPOINT` with no code change |
| D10 | Platforms | **Windows first** (NSIS installer), macOS/Linux later |
| D11 | Scale | **< 500 employees** — single API node, in-memory DAG cache |
| D12 | Local infra | **Docker Desktop** — `docker-compose.yml` for Postgres + MinIO |
| D13 | Product name | **Nexus** (placeholder; single constant `APP_NAME` in `packages/shared`) |
| D14 | Membership | Employee may belong to **multiple hierarchy nodes** |
| D15 | RBAC model | **Fixed permission catalog + admin-defined custom roles** |
| D16 | Visual design | **Minimal, premium, neutral palette with light / dark / system theme** — colors are CSS-variable tokens (`index.css`), toggle in the *Me* menu |

Proposed, awaiting product-owner confirmation (built with these defaults, all configurable by env):

| # | Topic | Proposal |
|---|-------|----------|
| P1 | Retention (§11) | Moderator-hidden posts/comments purged **30 days** after hiding; **read** notifications after **90 days**, all notifications after **365 days**; **messages kept forever** (proposal: 2 years once confirmed); audit log kept forever. Daily purge job in the API process. Files of purged posts/messages are deleted when nothing else references them |
| P2 | Data export (§8) | Every employee can download their own data as JSON; admins with `users.manage` can export any employee. Each export is audited (`user.export`) |

Engineering choices (made by the build, can be revisited):

| Topic | Choice | Why |
|-------|--------|-----|
| Monorepo | pnpm workspaces | shared types between server and desktop |
| API | Fastify 4 + Zod | fast, schema-first, small |
| ORM | Prisma 5 | typed client, migrations |
| Realtime | Socket.IO | messaging, notifications, typing indicators |
| Client state | TanStack Query + Zustand | server cache + small UI/auth store |
| DAG UI | React Flow (`@xyflow/react`) + dagre layout | interactive org-graph editor |
| Auth tokens | 15-min JWT access token + rotating refresh token (hashed in DB, one row per sign-in session); both stored by Electron main via `safeStorage` | desktop-friendly, revocable |

---

## 2. Repository layout

```
social_media/
├─ SOURCE_OF_TRUTH.md          ← this file
├─ docker-compose.yml          ← dev: postgres:16 (:5434) + SeaweedFS S3 (:8334)
├─ deploy/                     ← production compose (API image, Postgres, S3, Redis, Caddy, backup) + guide
├─ package.json / pnpm-workspace.yaml
├─ packages/
│  └─ shared/                  ← APP_NAME, permission catalog, DTO types, reaction types
├─ apps/
│  ├─ server/                  ← Fastify API + Socket.IO + Prisma
│  │  ├─ prisma/schema.prisma
│  │  ├─ prisma/seed.ts
│  │  └─ src/
│  │     ├─ dag/               ← DAG engine (cycle detection, ancestors, descendants, topo sort)
│  │     ├─ rbac/              ← permission resolution on top of the DAG
│  │     ├─ routes/            ← auth, users, hierarchy, roles, posts, comments, connections,
│  │     │                       messages, notifications, groups, events, articles, jobs, search, media, reports
│  │     └─ realtime/          ← Socket.IO gateway
│  └─ desktop/                 ← Electron (main, preload) + React renderer
```

---

## 3. Company hierarchy — DAG engine

### 3.1 Concepts
- **OrgNode** — a unit of the company: `COMPANY`, `DIVISION`, `DEPARTMENT`, `TEAM`, `GUILD`, `LOCATION`, `CUSTOM`.
- **OrgEdge** — directed edge `parent → child`. A node can have **many parents** and many children.
- **Root** — exactly one `COMPANY` node with no parents, created at install/seed.
- **Membership** — `(user, node, title, isPrimary)`; a user can be a member of many nodes.

### 3.2 Invariants (enforced server-side)
1. The graph is **acyclic**. Adding edge `P → C` is rejected if `P` is reachable from `C` (DFS over children).
2. No self-edges, no duplicate edges.
3. Every non-root node must have ≥ 1 parent (removing the last parent edge is rejected; delete or re-parent instead).
4. Deleting a node requires it to have no children (or `?cascade=reparent` which attaches its children to its parents).
5. The root node cannot be deleted.

### 3.3 Engine API (`apps/server/src/dag`)
| Function | Purpose |
|----------|---------|
| `wouldCreateCycle(parent, child)` | pre-check before inserting an edge |
| `ancestors(node)` / `descendants(node)` | BFS closure (excluding self) |
| `ancestorsOrSelf(nodes[])` | used by RBAC |
| `topoSort()` | Kahn's algorithm; also used as an integrity check |
| `paths(node)` | all root→node paths (for breadcrumbs in UI) |

The graph is loaded into memory and cached; any hierarchy mutation invalidates the cache (fine for D11 scale).

### 3.4 Admin UI
- Visual graph editor (React Flow, top-down dagre layout).
- Create node, connect/disconnect parent edges (drag handle → handle), rename, delete.
- Side panel per node: members, role grants, breadcrumbs (all paths).

---

## 4. Roles & permissions (RBAC on the DAG)

### 4.1 Permission catalog (fixed, in `packages/shared`)
| Permission | Meaning |
|------------|---------|
| `admin.all` | super-admin — bypasses all checks |
| `hierarchy.manage` | create/edit/delete nodes and edges |
| `roles.manage` | create/edit roles, grant/revoke roles |
| `users.manage` | invite, deactivate users, edit memberships |
| `post.create` | create posts (text, media, polls, documents) |
| `post.moderate` | hide/delete others' posts & comments (scoped) |
| `post.pin` | pin company announcements to top of feed |
| `comment.create` | comment and reply |
| `article.publish` | publish long-form articles / newsletters |
| `group.create` | create groups |
| `group.moderate` | moderate any group (scoped) |
| `event.create` | create company events |
| `job.create` | post internal jobs |
| `job.manage` | view applicants, close jobs (scoped) |
| `report.review` | review reported content (scoped) |
| `analytics.view` | view admin analytics |
| `message.send` | use messaging |

### 4.2 Roles
- Role = name + description + set of permissions. Seeded system roles: **Super Admin**, **HR Admin**, **Manager**, **Moderator**, **Recruiter**, **Employee**. Admin can create custom roles.

### 4.3 Grants
A **RoleGrant** is `(role, node, user?)`:
- **Node grant** (`user = null`): every member of `node` **and of every descendant of `node`** receives the role.
- **User grant** (`user = U`): only `U` receives the role.
- In both cases the grant's **scope** is the sub-DAG rooted at `node`.

### 4.4 Resolution algorithm
```
effectiveGrants(user):
  memberNodes   = nodes user belongs to
  inheritedFrom = ancestorsOrSelf(memberNodes)
  grants = node-grants where grant.node ∈ inheritedFrom
         ∪ user-grants where grant.user = user
  → list of (permission, scopeNode)

can(user, perm, targetNodes?):
  if user.isSuperAdmin or 'admin.all' in perms → true
  if no targetNodes → any grant with perm
  else → exists grant with perm whose scopeNode ∈ ancestorsOrSelf(targetNodes)
```
"Target nodes" of a resource = member nodes of its author (post/comment), the owning node (job/group/event).

Example: *Moderator* user-granted at **Engineering** may moderate posts by anyone in Engineering, Backend Team, Mobile Team (even if Mobile Team also sits under Product), but not posts by Sales.

---

## 5. Feature specification (phase 1)

### 5.1 Identity & profile
- Admin invites user (email, name, node memberships) → temporary password shown once; must change at first login.
- Profile: avatar, cover, headline, about, location, experience (title/company/dates/description), education, skills, **endorsements**, featured posts, org breadcrumbs (from DAG), "Open to" (mentoring, internal mobility).
- Profile views counter ("who viewed your profile").

### 5.2 Network
- **Connect** (request → accept/ignore/withdraw), **Follow** (one-way, auto on connect).
- People You May Know: same nodes, 2nd-degree connections.
- Connection degree badge (1st / 2nd / 3rd+).

### 5.3 Feed & posts
- Post types: text (with @mentions, #hashtags, links), images (multi), video, document (PDF), **poll** (2–4 options, duration), **article share**, **repost** (plain or with thoughts), **celebration** (kudos/welcome/work anniversary).
- **Reactions** (6): Like, Celebrate, Support, Love, Insightful, Funny. One per user per post/comment.
- **Comments**: threaded (1 level of replies), reactions on comments, edit/delete own, mentions.
- Edit / delete own post, **save** post, **copy link**, **report**.
- Pinned announcements (`post.pin`).
- Feed ranking (phase 1): pinned → recency, boosted by connections/follows and engagement.
- Hashtag pages and follow-hashtag.

### 5.4 Messaging
- 1:1 and group conversations, real-time via Socket.IO, unread counts, typing indicator, read receipts, attachments.

### 5.5 Notifications
- Reactions, comments, mentions, connection requests/accepts, messages, group/event invites, job applications, moderation outcomes. Realtime push + desktop native notification (Electron `Notification`). Mark read / all read.

### 5.6 Groups
- Public (anyone in company joins) or private (request to join). Group feed, admins/moderators, rules.

### 5.7 Events
- Online/in-person, time, location/link, cover, organizer node; RSVP (going/interested), attendee list, event posts.

### 5.8 Articles / newsletters
- Long-form rich text with cover image, published by `article.publish`. Newsletter = series users subscribe to.

### 5.9 Jobs (internal mobility)
- Job post (title, node, location, type, description, skills). Apply with note + profile; recruiter (`job.manage`) sees applicants and changes status (applied → reviewing → interview → offer → closed). Save job.

### 5.10 Search
- Global search: people, posts, groups, events, jobs, hashtags, units. Response shape `{ people, posts, groups, events, jobs, hashtags, units }`.
- Phase 1c: Postgres full-text search. `User`, `Skill`, `Post`, `Article`, `Job`, `Group`, `Event` have a generated `search` tsvector (GIN-indexed, migration `full_text_search`) holding both `english` (stemmed: "engineers" finds "engineering") and `simple` (unstemmed) lexemes. Weights: A name/title, B headline/description/skills, C body.
- Queries: every word must match, each as a prefix (`eng` → `eng:*`), so search-as-you-type works; results ordered by `ts_rank` (people: name + headline + skill ranks summed). Articles surface through their feed post. `#tag` also matches posts tagged with a hashtag starting with `tag`. Hashtags and units stay `ILIKE` (small tables, substring match). Code: `apps/server/src/lib/search.ts`.
- Prisma declares the columns as `Unsupported("tsvector")? @default(dbgenerated())` so `migrate dev` sees no drift.

### 5.11 Moderation
- Report post/comment/user with reason → queue visible to users with `report.review` scoped by DAG → actions: dismiss, hide, delete, warn.
- Audit log of admin/moderation actions.

### 5.12 Admin console
- Hierarchy editor, roles editor (permission matrix), grants, users (invite/deactivate/memberships), reports queue, audit log, basic analytics (DAU, posts/day, top hashtags).

---

## 6. Data model (Prisma, abridged)

`User, OrgNode, OrgEdge, Membership, Role, RoleGrant, Profile sections (Experience, Education, Skill, Endorsement), Connection, Follow, Post, PostMedia, Poll, PollOption, PollVote, Reaction, Comment, SavedPost, Hashtag, PostHashtag, Conversation, ConversationMember, Message, Notification, Group, GroupMember, Event, EventRsvp, Article, Job, JobApplication, SavedJob, Report, AuditLog, ProfileView`

Full definition: `apps/server/prisma/schema.prisma` (authoritative for fields).

---

## 7. API conventions
- REST under `/api/v1`, JSON, Zod-validated bodies, `Authorization: Bearer <jwt>`. On `401` the client calls `POST /auth/refresh` once and retries (§8).
- Cursor pagination: `?cursor=<id>&limit=20` → `{ items, nextCursor }`.
- Errors: `{ error: { code, message } }` with proper HTTP status.
- Realtime: Socket.IO namespace `/`, auth via JWT in handshake; rooms `user:<id>`, `conv:<id>`.
- Multiple API instances: set `REDIS_URL` → `@socket.io/redis-adapter` fans events out across instances, and presence lives in Redis (`nexus:presence:<instance>` hashes with a 30 s TTL refreshed every 10 s, listed in `nexus:presence:instances`, so a crashed instance's users go offline). Unset → single instance, in-memory. If `REDIS_URL` is set but unreachable the API fails to start (5 s) rather than silently diverging.
- Events: `notification:new`, `message:new`, `message:read`, `typing`, `presence`.

---

## 8. Security
- bcrypt password hashing (cost 10).
- **Password policy** (`packages/shared/src/password.ts`, enforced server-side): 10–72 characters (bcrypt limit is 72 bytes), with an upper-case letter, a lower-case letter, a digit and a symbol; must differ from the current password. Applied to change-password; admin invite/reset generate temporary passwords that satisfy the same policy. The change-password screen shows the rules live.
- **Sessions & tokens**: every sign-in (password or SSO) creates an `AuthSession` row.
  - Access token: JWT `{ sub, sid }`, lifetime `ACCESS_TOKEN_TTL` (default `15m`). `authenticate` checks the session is not revoked and the user is active on every request, so revocation is immediate.
  - Refresh token: 32 random bytes, only its SHA-256 is stored. `POST /auth/refresh` rotates it (new token, sliding expiry `REFRESH_TOKEN_TTL_DAYS`, default 30). Presenting the previous (already rotated) token is treated as theft and revokes the session.
  - `POST /auth/logout` revokes the session. Password change revokes all *other* sessions; admin password reset and deactivation revoke all sessions. Revoked sessions' sockets are disconnected (room `session:<sid>`).
  - Tokens issued before 1c (no `sid`) are rejected; users sign in once more.
- **Rate limiting** (`@fastify/rate-limit`): global 600 req/min per user (per IP when unauthenticated); `/auth/login` 10/min per IP+email; `/auth/refresh` 30/min per IP; `/auth/change-password` 5/min per user; SSO start/exchange 20/min per IP. `RATE_LIMIT=off` disables (tests only). Behind a reverse proxy set `TRUST_PROXY` so the client IP is used.
- **SSO (OIDC)**, configured by `OIDC_PROVIDERS` + `OIDC_<ID>_*` env (README → "Single sign-on"). Authorization-code flow with PKCE, server is the confidential client; the redirect URI registered at the IdP is `PUBLIC_URL/api/v1/auth/sso/<id>/callback`.
  - Desktop: main process opens the system browser and listens on a one-shot loopback server `http://127.0.0.1:<random port>/callback`; it sends a PKCE challenge to `/auth/sso/<id>/start`. After the IdP callback the server redirects to the loopback URL with a one-time code (2-min lifetime) that the app exchanges, with its verifier, at `POST /auth/sso/exchange` for the normal token pair. Only loopback redirect URIs are accepted (no open redirect).
  - Account match: verified email claim (`email`, or `OIDC_<ID>_EMAIL_CLAIM`, e.g. `preferred_username` for Azure UPNs) against an existing, active user; optional `OIDC_<ID>_ALLOWED_DOMAINS`. Unknown emails are refused — admins still invite. `email_verified: false` is refused.
  - A user who signs in by SSO while still holding an admin-issued temporary password has it retired (random hash, `mustChangePassword` cleared); an admin reset gives them a password again.
  - Password login stays available.
- Electron: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, narrow preload bridge; tokens kept in main process with `safeStorage`.
- All permission checks server-side; UI hides controls only as UX.
- Uploads: type allow-list (image/*, video/mp4, application/pdf), size limits, stored in MinIO with server-generated keys.
- Production (`deploy/`): only the Caddy proxy publishes ports (HTTPS + WSS); Postgres, S3, Redis and the API stay on the internal Docker network; the API image runs as the non-root `node` user; `/metrics` is blocked at the proxy; secrets live in `deploy/.env.prod` (git-ignored).
- **Media URLs are signed** (phase 1c). The database stores canonical URLs (`<PUBLIC_URL>/api/v1/media/<key>`); `GET /media/<key>` requires `?exp=<unix s>&sig=<HMAC-SHA256(key:exp)>` and answers 403 when missing, tampered or expired. A server hook re-signs every media URL in every API response and realtime event (so old rows keep working and `<img>`/`<video>` need no bearer token), and strips signatures from incoming bodies. Secret: `MEDIA_URL_SECRET` (falls back to a key derived from `JWT_SECRET`). Expiry is rounded to `MEDIA_URL_TTL_SECONDS` (default 3600) windows, so a URL is stable (browser-cacheable) for an hour and valid 1–2 h; a page left open longer needs a refetch. Links copied out of the app stop working after that.
- **Retention** (proposal P1): env `RETENTION_HIDDEN_CONTENT_DAYS` (30), `RETENTION_MESSAGE_DAYS` (0 = keep), `RETENTION_READ_NOTIFICATION_DAYS` (90), `RETENTION_NOTIFICATION_DAYS` (365), `RETENTION_AUDIT_LOG_DAYS` (0), `RETENTION_PURGE_EVERY_HOURS` (24, 0 disables). `Post.hiddenAt`/`Comment.hiddenAt` start the clock. `GET /admin/retention` (`users.manage`) shows the policy and last run.
- **Data export** (proposal P2): `GET /users/me/export` (*Me* menu → Export my data) and `GET /admin/users/:id/export` (`users.manage`, Admin → Employees → ⋯). Covers profile, memberships, experience/education/skills, posts, comments, reactions, saved posts, articles, own messages (with conversation participants by name), connections, follows, groups, events, job applications. Audited as `user.export` with `{ self }`.

---

## 9. Running locally
```bash
docker compose up -d          # postgres on :5434, S3 (SeaweedFS) on :8334
cp apps/server/.env.example apps/server/.env
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm dev                      # starts API (:4000) and Electron app
pnpm test                     # DAG engine + RBAC unit tests
```
Production deployment (Docker image, prod compose, backups/restore, health + metrics, log shipping): see [`deploy/README.md`](deploy/README.md).
Seed admin: `admin@nexus.local` — password in `apps/server/.env.example` (`SEED_ADMIN_PASSWORD`). Demo employees `priya|rahul|meera|arjun|sara|vikram|neha|karan|divya@nexus.local` use `SEED_DEMO_PASSWORD`.
The renderer also runs in a normal browser at http://localhost:5183 (web bridge fallback) — basis for the phase-2 web client.

---

## 10. Roadmap
| Phase | Scope |
|-------|-------|
| 1a ✅ built | Monorepo, infra, DAG engine, RBAC, auth, admin hierarchy/roles UI, feed/posts/reactions/comments/reposts/polls, profiles, connections, messaging, notifications |
| 1b ✅ built (needs QA) | Groups, events, articles/newsletters, jobs, search, moderation queue, analytics |
| 1c ✅ built | Realtime/upload QA, API e2e + UI tests, CI, OIDC SSO (Azure AD / Google), refresh tokens, rate limiting, password policy, full-text search, Redis, auto-update + signing readiness, production deployment, signed media URLs, retention purge, data export. Open: code-signing certificate, live SSO round trip, retention defaults (P1) |
| 2 (public) | Multi-tenancy (org per tenant), public sign-up, post visibility levels (public/connections/nodes), premium, recommendations ML, web + mobile clients |

---

## 11. Open questions
- Retention policy for messages and deleted content? **Proposed defaults built (P1 in §1); please confirm**, especially whether messages should expire (e.g. after 2 years) and whether hidden content should be kept longer for HR/legal holds.
- Should managers see reportees' analytics?
- Integration with HRIS (auto-sync hierarchy from HR system)?

---

## 12. QA log

### 2026-10-28 — production deployment stack (phase 1c)
Verified on Docker Desktop 29.1 (Windows), prod stack on 8088/8443 next to the dev stack:
1. `docker build -f apps/server/Dockerfile .` builds (491 MB; esbuild bundle, prod-only deps, runs as `node`).
2. `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d` with profiles s3, redis, backup: postgres → `migrate` (exit 0) → api (healthy) → caddy. `GET https://localhost:8443/health/ready` → 200 with db + storage checks; `/metrics` → 404 through the proxy, served on `api:4000`; Socket.IO polling handshake OK and WebSocket upgrade → 101.
3. `run --rm api seed` created the admin; login and an image upload + fetch through the proxy → 200.
4. Backup/restore drill: `backup.sh` (dump + media mirror) → dropped the database and deleted the uploaded object → `restore.sh latest --with-media --yes` → users/posts/units counts identical (10/7/12), media fetch 200, login 200, `/health/ready` 200; re-running `migrate` reports no pending migrations.
5. Bundle run outside Docker with storage and DB down: `/health/live` 200, `/health/ready` 503 naming both failing checks.

Known limits: one API instance only (DAG/RBAC caches are per process); the bundled S3 is SeaweedFS because MinIO images are no longer published.

### 2026-10-28 — auto-update + code-signing readiness (phase 1c)
Added `electron-updater` 6.3.9 (generic feed from `nexus.config.json` `updateUrl`, else `<apiUrl>/updates/`), "Restart to update" banner, API `GET /updates/*` (`@fastify/static`, `UPDATES_DIR`), `publish` config (latest.yml + blockmap), `CSC_LINK`/`CSC_KEY_PASSWORD` and Azure Trusted Signing (`build:win:azure`) paths; see §13.
Verified: `pnpm typecheck` clean; `electron-vite build` succeeds with electron-updater bundled into `out/main`.
Not yet covered: an end-to-end update (install v0.1.0 → publish v0.1.1 → banner → restart) — needs a packaged NSIS build, which this managed laptop's endpoint security blocks; run it from CI artifacts. Signing untested (no certificate yet).

### 2026-10-28 — phase 1c auth hardening
Built: `AuthSession` model (rotating refresh tokens, hashed), `/auth/refresh`, `/auth/logout`, session check on every request and socket handshake, revocation on password change/reset/deactivation with socket disconnect; `@fastify/rate-limit`; shared password policy with live checklist; OIDC SSO (`/auth/sso/providers`, `/:id/start`, `/:id/callback`, `/exchange`) with desktop loopback flow.

Verified: server + desktop typecheck clean; unit tests for password policy, temp passwords, OIDC env parsing, loopback-only redirects, email-claim mapping. Route tests written (`src/routes/auth.test.ts`, run against the dev DB, skipped when it is down) but **not yet run**: Docker/Postgres was unresponsive during this session. They cover: login → refresh rotation → replay revokes session; logout with refresh token only; change-password policy + other sessions signed out; SSO exchange PKCE check, single use, temp password retired; login rate limit (11th attempt → 429).

Not yet covered: running the route tests above with the DB up, a live Azure AD / Google round trip (needs a tenant + client secret), the Electron loopback listener end to end, and the renderer's transparent refresh in a running app (15-min expiry; set `ACCESS_TOKEN_TTL=1m` to exercise it).

### 2026-10-28 — full click-through + API end-to-end pass
Fixed:
1. Messaging thread crashed the window after sending (effect returned `scrollIntoView()`'s Promise in new Chromium) → effects use block bodies; global `ErrorBoundary` added so one screen can't blank the app.
2. Every API call paid ~200 ms: server bound IPv4 only while Windows resolves `localhost` to `::1` first → server listens on `::` (dual-stack); DB/S3 URLs use `127.0.0.1`.
3. `@mention` dropdown clipped inside modals → rendered in a portal; composer shows `@Name` instead of the raw `@[Name](id)` token.
4. Reaction picker closed while moving the mouse to it → contiguous hover area + open/close delays.
5. Comment box / message box not focused on open; new comments appeared only after refetch → autofocus + optimistic insert.
6. POST actions with an empty JSON body returned 400 → server accepts empty JSON bodies.
7. Failed loads/actions were silent (endless spinner) → global error toasts, retry with backoff (no retry on 401/403/404).
8. `tsx watch` hung on restart (open websockets) → graceful SIGINT/SIGTERM shutdown.
9. Admins couldn't "Easy Apply" to jobs they can manage → only the poster is blocked.
10. Group posts were labelled "Company" → "Group".
11. Analytics chart skipped empty days → 14 days zero-filled; roles list order is deterministic.

Polish: neutral cover/graph/accents, muted avatar palette, compact admin row actions (⋯ menu), responsive page grids and nav (labels hide < 1024 px), no-wrap action buttons, org graph without minimap.

Verified: desktop + server typecheck clean; 7/7 DAG/RBAC unit tests; 45-step API e2e script (jobs, events, articles, polls, reposts, reactions, scoped moderation, reports, connections, invites, hierarchy edges/cycles/last-parent, grants/revoke, group chat, search, analytics, audit) all pass on a fresh seed.

Not yet covered: multi-user realtime in two live Electron windows, file upload via the UI picker, Windows installer build.

### 2026-10-28 — phase 1c: two-user realtime + UI upload pass
Two live clients (Priya at `localhost:5183`, Rahul at `[::1]:5183`; separate origins = separate sessions) against `pnpm dev`.
Fixed:
1. Restarting or briefly losing the API signed users out: boot cleared the stored token on *any* `/auth/me` error → only a rejected token (4xx) signs out; network errors and 5xx (e.g. DB down) retry with backoff.
2. "X is typing…" lingered after X's message arrived, and stacked timers could clear a newer typing state → cleared on the typer's `message:new`, one timer per thread.
3. "Seen" rendered at the end of the thread (under the other person's reply) → shown under my last message.
4. Uploads outside the post composer (message attachment, avatar/cover, event/article covers, article images) failed silently, and `accept="image/*"` let through types the server rejects (SVG, BMP, HEIC) → one allow-list `UPLOAD_TYPES` in `@nexus/shared` used by the server and every picker; `api.upload` rejects other types with a clear message; a global `unhandledrejection` handler toasts API errors from non-React-Query calls. Message file input resets so the same file can be re-sent.

Verified: 1:1 conversation create, realtime delivery both ways, typing indicator, "seen", presence ("Active now"), Messaging and Notifications badges + window-title count update live (@mention notification), image attachment delivered live to the other client, avatar upload updates profile + header, composer image + PDF upload, SVG rejected with a toast. Typecheck clean, 7/7 unit tests.

Not yet covered: native Windows notifications and taskbar badge (Electron-only; web bridge no-ops), group chat in the UI, video upload.

### 2026-10-28 — phase 1c: automated tests + CI
- `apps/server/e2e/api.e2e.ts` (`pnpm test:e2e`): replaces the old out-of-repo Python script. 16 scenarios against a live API: auth, hierarchy invariants (CYCLE/SELF_EDGE/DUPLICATE_EDGE/LAST_PARENT → 409), invite + forced password change, custom role grant/revoke, posts (mentions, hashtags, reactions, one-level replies, edit, save, repost, poll vote change), network, group chat + unread/read, private groups, events, articles/newsletters, jobs pipeline, scoped moderation, search, analytics/audit, media allow-list, deactivation. Each run uses unique names, so it re-runs on the same DB.
- `apps/desktop/e2e/app.spec.ts` (`pnpm test:ui`, Playwright 1.64.1): sign-in form, composer post, and two live clients for realtime messaging (delivery, typing, "seen", picker upload + rejected type, live unread badge). The renderer is served by plain Vite (`pnpm --filter @nexus/desktop dev:web`, `vite.web.config.ts`) so no Electron is needed.
- `.github/workflows/ci.yml`: Ubuntu job (compose Postgres + S3, typecheck, unit, migrate + seed, API e2e, UI tests, report artifact on failure); Windows job on `master` builds the NSIS installer as an artifact (sidesteps the local AV issue in §13; signs when `CSC_LINK` secrets exist).

### 2026-10-28 — phase 1c: full-text search + Redis
Built: tsvector generated columns + GIN indexes (migration `20261028120000_full_text_search`), ranked prefix search in `/search` (shape unchanged), Socket.IO Redis adapter + Redis presence, `redis` service in dev `docker-compose.yml` (host :6381), `REDIS_URL` in `.env.example` (commented = off).

Verified: server typecheck clean; `pnpm test` (unit tests; DB search tests skip without `DATABASE_URL`); `src/lib/search.test.ts` against a migrated DB: 6 ranking/prefix/stemming/hashtag/visibility cases pass; `prisma migrate diff` (schema ↔ DB and ↔ migrations) empty; two API instances (:4101/:4102) on one Redis: message sent via A reached a socket on B, presence on A saw a user connected to B and cleared on disconnect; `/search` on seed data (`eng`, `engineers`, `priya`, `design`, `#`).

Notes: run DB search tests with `DATABASE_URL=… pnpm test`. People search needs every word in one field set (name+headline, or one skill); a mix like "priya react" across name and skill does not match. `GET /users?q=` (mention picker) still uses substring `ILIKE` on purpose (matches mid-name).

### 2026-10-28 — phase 1c: signed media, retention, data export
Built: signed media URLs (§8), retention purge job (P1), JSON data export for self and admins (P2), migration `retention_hidden_at`.

Verified (throwaway DB, API on a spare port): upload returns a signed URL; signed GET 200; unsigned, tampered and expired GETs 403; avatar/post media saved from a signed URL are stored canonical and come back re-signed; self export and admin export 200 with all sections; an employee without `users.manage` gets 403 on another user's export; both exports appear in the audit log; `GET /admin/retention` returns the policy; hiding a post sets `hiddenAt`. Unit tests 13/13 (6 new for signatures); typecheck clean.

Not yet covered: a live purge run (the dev machine ran out of memory and Docker stopped during that step; `purgeExpired` is typechecked but unexercised), video seeking after a URL expires, UI click-through of the two export menu items.

### 2026-10-28 — phase 1c merged into `master`
Merged the five phase 1c branches (deployment, auto-update, search + Redis, media/retention/export, auth) on top of the tests + CI work; migrations `auth_sessions_sso`, `full_text_search`, `retention_hidden_at` applied with `prisma migrate deploy`.
Fixed during the merge:
1. Login rate limit keyed by `ip:email` actually used `ip:` only: `@fastify/rate-limit` runs at `onRequest`, before the body is parsed, so every sign-in behind one office IP shared a single 10/min bucket → the login preset runs at `preHandler`. Verified: 12 failed logins with different emails → all 401; the 11th try on one email → 429.
2. Renderer boot (auth branch) kept the session only when offline; merged with the earlier fix, so 5xx also retries and only 4xx signs out.
3. Messaging UI test typed into the previous thread's box while `/messaging` auto-opened the most recent thread → opens the 1:1 thread by id; waits out the 1.5 s typing-event throttle before checking the indicator.

Verified on merged `master`: typecheck clean; `pnpm test` 31/31 (incl. auth route + search DB tests); `pnpm test:e2e` 16/16; `pnpm test:ui` 3/3 (Edge); `/health` reports db + storage OK.

---

## 13. Windows installer

```bash
pnpm build:win        # → apps/desktop/release/Nexus-Setup-<version>.exe (+ .blockmap, latest.yml); unsigned unless CSC_* set
pnpm build:win:azure  # same, signed with Azure Trusted Signing (electron-builder.azure.yml)
```
- **Point installs at your server**: put `nexus.config.json` next to `Nexus.exe` (IT-wide) or in `%APPDATA%\Nexus` (per user): `{ "apiUrl": "https://nexus.yourcompany.internal", "updateUrl": "https://…/nexus/" }`. Each key is looked up per-user file → exe-side file → env (`NEXUS_API_URL`, `NEXUS_UPDATE_URL`) → default (`http://localhost:4000`; feed = `<apiUrl>/updates/`). `updateUrl` is optional.
- **First build on a machine without symlink rights** fails extracting electron-builder's `winCodeSign` (macOS symlinks). Fix once: enable Windows Developer Mode, or extract `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\*.7z` into `winCodeSign-2.6.0` in the same folder (the two symlink errors are harmless).
- **NSIS step killed (`Exit code: null. Command failed: …\Nexus-Setup-<v>.exe`)**: electron-builder runs the half-built installer once to produce the uninstaller. On managed machines endpoint security can kill that process when Node launches it (it runs fine by hand). Seen 2026-10-28 on 2 of 3 runs; one run passed. Fix: exclude `apps/desktop/release` from AV scanning, or build on CI / a non-managed machine. When this fails, `release/Nexus-Setup-*.exe` is a broken ~200 KB stub, so don't ship it.
- Installer is ~25 MB (no `node_modules` ship; everything is bundled by electron-vite).

### 13.1 Auto-update (`electron-updater`, generic feed)
- Main process (`apps/desktop/src/main/updater.ts`) checks the feed 15 s after start and every 4 h, downloads in the background, then the renderer shows a **"Restart to update"** banner (`UpdateBanner`, via `window.nexus.update`). It never restarts on its own: the update installs when the user clicks the button or the next time they quit Nexus (`autoInstallOnAppQuit`). Dev runs (`!app.isPackaged`) skip updates.
- **Feed** = a folder holding `latest.yml`, `Nexus-Setup-<v>.exe` and `Nexus-Setup-<v>.exe.blockmap`. Chosen hosting: the API serves it at `GET /updates/*` from `UPDATES_DIR` (default `apps/server/updates`, git-ignored) with `@fastify/static` (Range requests for blockmap differential downloads; `latest.yml` is `no-cache`). The route is unauthenticated on purpose; the folder holds only installers. Any static HTTPS server (IIS, nginx, a file share behind HTTP) also works: set `updateUrl` to it.
- `electron-builder.yml` `publish` (generic) only makes electron-builder write `latest.yml`, the blockmap and `app-update.yml`; its URL is a placeholder because the client sets the feed URL at runtime. Builds run with `--publish never`, so nothing is uploaded.

### 13.2 Release process
1. Bump `version` in `apps/desktop/package.json` (semver; the updater only offers higher versions).
2. `pnpm build:win` (or `build:win:azure`, or CI on a `windows-latest` runner).
3. Upload **`latest.yml` last**, after `Nexus-Setup-<v>.exe` and `.blockmap`, into the feed folder (`UPDATES_DIR` on the API host, or your static host). Keep the previous installer for a while so in-flight downloads finish.
4. Clients pick it up within 4 h (or on next launch). New installs: hand out the same `.exe`.

### 13.3 Code signing (unsigned by default)
- **PFX/EV via signtool**: set `CSC_LINK` (path, https URL or base64 of the `.pfx`) and `CSC_KEY_PASSWORD` in the build environment; electron-builder signs the app exe, installer and uninstaller. Nothing to change in config. (EV tokens on a hardware key need `win.signtoolOptions` / a custom `sign` hook instead.)
- **Azure Trusted Signing**: fill `endpoint`, `codeSigningAccountName`, `certificateProfileName` and `win.publisherName` (the certificate's subject CN) in `apps/desktop/electron-builder.azure.yml`, set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (Entra app with the *Trusted Signing Certificate Profile Signer* role), run `pnpm build:win:azure`. Needs PowerShell + the `TrustedSigning` module (electron-builder installs it).
- **CI**: store the PFX as a base64 secret → `CSC_LINK`, password → `CSC_KEY_PASSWORD` (or the three `AZURE_*` secrets); upload `release/latest.yml`, `*.exe`, `*.blockmap` as artifacts, then copy them to the feed. Never commit certificates.
- **How unsigned builds behave**: SmartScreen shows "unknown publisher" on first install; updates still work because `app-update.yml` has no `publisherName`, so `electron-updater` skips the signature check (integrity is only the sha512 in `latest.yml`, so serve the feed over HTTPS). Once a build is signed, its `app-update.yml` records the publisher and that install **rejects any later update that is unsigned or signed by another publisher**. So: switching unsigned → signed is a normal update; never go back to unsigned, and keep the same certificate subject when renewing.
