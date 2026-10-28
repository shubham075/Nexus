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
Seed admin: `admin@nexus.local` — password in `apps/server/.env.example` (`SEED_ADMIN_PASSWORD`). Demo employees `priya|rahul|meera|arjun|sara|vikram|neha|karan|divya@nexus.local` use `SEED_DEMO_PASSWORD`.
The renderer also runs in a normal browser at http://localhost:5183 (web bridge fallback) — basis for the phase-2 web client.

---

## 10. Roadmap
| Phase | Scope |
|-------|-------|
| 1a ✅ built | Monorepo, infra, DAG engine, RBAC, auth, admin hierarchy/roles UI, feed/posts/reactions/comments/reposts/polls, profiles, connections, messaging, notifications |
| 1b ✅ built (needs QA) | Groups, events, articles/newsletters, jobs, search, moderation queue, analytics. Remaining: Windows installer signing + auto-update |
| 1c | SSO (Azure AD / Google), refresh tokens, full-text search, Redis, E2E tests. ✅ signed media URLs, retention purge job, data export |
| 2 (public) | Multi-tenancy (org per tenant), public sign-up, post visibility levels (public/connections/nodes), premium, recommendations ML, web + mobile clients |

---

## 11. Open questions
- Retention policy for messages and deleted content? **Proposed defaults built (P1 in §1); please confirm**, especially whether messages should expire (e.g. after 2 years) and whether hidden content should be kept longer for HR/legal holds.
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

### 2026-10-28 — phase 1c: signed media, retention, data export
Built: signed media URLs (§8), retention purge job (P1), JSON data export for self and admins (P2), migration `retention_hidden_at`.

Verified (throwaway DB, API on a spare port): upload returns a signed URL; signed GET 200; unsigned, tampered and expired GETs 403; avatar/post media saved from a signed URL are stored canonical and come back re-signed; self export and admin export 200 with all sections; an employee without `users.manage` gets 403 on another user's export; both exports appear in the audit log; `GET /admin/retention` returns the policy; hiding a post sets `hiddenAt`. Unit tests 13/13 (6 new for signatures); typecheck clean.

Not yet covered: a live purge run (the dev machine ran out of memory and Docker stopped during that step; `purgeExpired` is typechecked but unexercised), video seeking after a URL expires, UI click-through of the two export menu items.

---

## 13. Windows installer

```bash
pnpm build:win        # → apps/desktop/release/Nexus-Setup-<version>.exe (NSIS, x64, unsigned)
```
- **Point installs at your server**: put `nexus.config.json` next to `Nexus.exe` (IT-wide) or in `%APPDATA%\Nexus` (per user): `{ "apiUrl": "https://nexus.yourcompany.internal" }`. Falls back to `NEXUS_API_URL`, then `http://localhost:4000`.
- **Unsigned**: Windows SmartScreen shows "unknown publisher" until a code-signing certificate is added (`CSC_LINK` / `CSC_KEY_PASSWORD`).
- **First build on a machine without symlink rights** fails extracting electron-builder's `winCodeSign` (macOS symlinks). Fix once: enable Windows Developer Mode, or extract `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\*.7z` into `winCodeSign-2.6.0` in the same folder (the two symlink errors are harmless).
- Auto-update is not wired yet (phase 1c: `electron-updater` + an internal update feed).
