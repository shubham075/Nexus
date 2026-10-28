# Nexus — Source of Truth

> Internal professional social network (LinkedIn-style) desktop application.
> **Phase 1:** internal company use. **Phase 2:** public, multi-tenant release.
> This document is the single source of truth for product scope, architecture and decisions.
> Any change to a decision below must be made here first.

Last updated: 2026-10-27

---

## 1. Decisions log (answered by product owner)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Desktop stack | **Electron + React + TypeScript** (electron-vite, Tailwind) |
| D2 | Backend / data | **Central API server + PostgreSQL**; all desktop clients connect to it |
| D3 | Auth | **Email + password, admin-invited accounts** (SSO later) |
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

Engineering choices (made by the build, can be revisited):

| Topic | Choice | Why |
|-------|--------|-----|
| Monorepo | pnpm workspaces | shared types between server and desktop |
| API | Fastify 4 + Zod | fast, schema-first, small |
| ORM | Prisma 5 | typed client, migrations |
| Realtime | Socket.IO | messaging, notifications, typing indicators |
| Client state | TanStack Query + Zustand | server cache + small UI/auth store |
| DAG UI | React Flow (`@xyflow/react`) + dagre layout | interactive org-graph editor |
| Auth tokens | JWT access token (stored by Electron main via `safeStorage`) | desktop-friendly |

---

## 2. Repository layout

```
social_media/
├─ SOURCE_OF_TRUTH.md          ← this file
├─ docker-compose.yml          ← postgres:16 (:5434) + SeaweedFS S3 (:8334)
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
- Global search: people, posts, groups, events, jobs, hashtags (Postgres `ILIKE` phase 1; full-text/`tsvector` later).

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
- REST under `/api/v1`, JSON, Zod-validated bodies, `Authorization: Bearer <jwt>`.
- Cursor pagination: `?cursor=<id>&limit=20` → `{ items, nextCursor }`.
- Errors: `{ error: { code, message } }` with proper HTTP status.
- Realtime: Socket.IO namespace `/`, auth via JWT in handshake; rooms `user:<id>`, `conv:<id>`.
- Events: `notification:new`, `message:new`, `message:read`, `typing`, `presence`.

---

## 8. Security
- bcrypt password hashing; JWT 7-day access token (refresh tokens in phase 2).
- Electron: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, narrow preload bridge; token kept in main process with `safeStorage`.
- All permission checks server-side; UI hides controls only as UX.
- Uploads: type allow-list (image/*, video/mp4, application/pdf), size limits, stored in MinIO with server-generated keys.

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
Seed admin: `admin@nexus.local` — password in `apps/server/.env.example` (`SEED_ADMIN_PASSWORD`). Demo employees `priya|rahul|meera|arjun|sara|vikram|neha|karan|divya@nexus.local` use `SEED_DEMO_PASSWORD`.
The renderer also runs in a normal browser at http://localhost:5183 (web bridge fallback) — basis for the phase-2 web client.

---

## 10. Roadmap
| Phase | Scope |
|-------|-------|
| 1a ✅ built | Monorepo, infra, DAG engine, RBAC, auth, admin hierarchy/roles UI, feed/posts/reactions/comments/reposts/polls, profiles, connections, messaging, notifications |
| 1b ✅ built (needs QA) | Groups, events, articles/newsletters, jobs, search, moderation queue, analytics. Remaining: Windows installer signing + auto-update |
| 1c (in progress) | ✅ realtime/upload QA, E2E + UI tests, CI. In parallel branches: SSO (Azure AD / Google), refresh tokens, rate limiting, password policy · full-text search, Redis · authenticated media, retention, export · auto-update, signing · production deployment |
| 2 (public) | Multi-tenancy (org per tenant), public sign-up, post visibility levels (public/connections/nodes), premium, recommendations ML, web + mobile clients |

---

## 11. Open questions
- Retention policy for messages and deleted content?
- Should managers see reportees' analytics?
- Integration with HRIS (auto-sync hierarchy from HR system)?

---

## 12. QA log

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

---

## 13. Windows installer

```bash
pnpm build:win        # → apps/desktop/release/Nexus-Setup-<version>.exe (NSIS, x64, unsigned)
```
- **Point installs at your server**: put `nexus.config.json` next to `Nexus.exe` (IT-wide) or in `%APPDATA%\Nexus` (per user): `{ "apiUrl": "https://nexus.yourcompany.internal" }`. Falls back to `NEXUS_API_URL`, then `http://localhost:4000`.
- **Unsigned**: Windows SmartScreen shows "unknown publisher" until a code-signing certificate is added (`CSC_LINK` / `CSC_KEY_PASSWORD`).
- **First build on a machine without symlink rights** fails extracting electron-builder's `winCodeSign` (macOS symlinks). Fix once: enable Windows Developer Mode, or extract `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\*.7z` into `winCodeSign-2.6.0` in the same folder (the two symlink errors are harmless).
- **NSIS step killed (`Exit code: null. Command failed: …\Nexus-Setup-<v>.exe`)**: electron-builder runs the half-built installer once to produce the uninstaller. On managed machines endpoint security can kill that process when Node launches it (it runs fine by hand). Seen 2026-10-28 on 2 of 3 runs; one run passed. Fix: exclude `apps/desktop/release` from AV scanning, or build on CI / a non-managed machine. When this fails, `release/Nexus-Setup-*.exe` is a broken ~200 KB stub, so don't ship it.
- Installer is ~25 MB (no `node_modules` ship; everything is bundled by electron-vite).
- Auto-update is not wired yet (phase 1c: `electron-updater` + an internal update feed).
