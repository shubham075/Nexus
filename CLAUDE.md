# CLAUDE.md: Nexus

Internal LinkedIn-style desktop app (Electron + React) with a Fastify/Prisma API. Company hierarchy is a multi-parent DAG; roles/permissions inherit down it.

## Read first
- `SOURCE_OF_TRUTH.md`: product decisions (D1–D16), architecture, RBAC algorithm, roadmap, QA log. Product changes are made there **first**.
- `README.md` → "Project status": which phases/items are done and what is next.

## Commands (repo root)
- `docker compose up -d`: Postgres :5434, S3 (SeaweedFS) :8334
- `pnpm dev`: API :4000 + Electron (renderer also at http://localhost:5183 in a browser)
- `pnpm test` (DAG/RBAC unit tests), `pnpm typecheck`
- `pnpm db:migrate` after editing `apps/server/prisma/schema.prisma`; `pnpm db:reset` wipes local data
- `pnpm build:win`: installer in `apps/desktop/release/`

## Conventions
- Server enforces every permission (`requirePerm` / `assertCan` / `canOverUser` in `apps/server/src/lib/auth.ts`, `rbac/`). UI `useCan` only hides controls.
- Tenancy (SOT §14): company-scoped routes get the active org with `orgOf(req)` and use the helpers in `apps/server/src/lib/org.ts` (`visibleIn`, `assertNodesInOrg`, `assertOrgMembers`); RBAC calls take it: `can(userId, orgId, perm, nodes?)`.
- After mutating hierarchy, roles, grants or memberships call `invalidateDag(orgId)` / `invalidateRbac(orgId)`.
- New permissions go in `packages/shared/src/permissions.ts` (catalog + groups).
- Routes: Zod `parse()`, cursor pagination via `pageArgs()` / `page()`, errors via `HttpError` helpers.
- UI colours: use `zinc-*`, `bg-surface`, `brand-*` tokens (CSS variables in `index.css`) so light and dark both work. Keep the look minimal and neutral.
- React effects must use block bodies (`useEffect(() => { … })`): newer Chromium returns Promises from DOM methods like `scrollIntoView`, which crashes an expression-bodied effect.
- Mentions are stored as `@[Name](userId)`; `MentionInput` shows `@Name`.

## Gotchas (Windows)
- Use `127.0.0.1`, not `localhost`, in server env URLs (IPv6-first lookup adds ~200 ms).
- pnpm build scripts must be allowed in `pnpm-workspace.yaml` → `allowBuilds`.
- Installer build may need Developer Mode (symlinks); see SOT §13.

## When finishing work
Update the README "Project status" checkboxes and the SOT roadmap/QA log so the next session (possibly on another device) sees the real state.
