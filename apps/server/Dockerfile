# Nexus API: production image. Build from the REPO ROOT (it needs the pnpm workspace):
#   docker build -f apps/server/Dockerfile -t nexus-api .
# Runs the esbuild bundle (dist/index.js) with plain Node; prod-only node_modules; non-root.
# Migrations are a separate one-shot command (see deploy/README.md):
#   docker run --rm --env-file … nexus-api migrate

ARG NODE_VERSION=20.18.1
ARG PNPM_VERSION=12.4.2

# ---------- build: full workspace install, bundle, then a pruned prod-only copy ----------
FROM node:${NODE_VERSION}-bookworm-slim AS build
ARG PNPM_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@${PNPM_VERSION}
WORKDIR /repo

# Manifests first so the dependency layer is cached across source-only changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @nexus/server...

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @nexus/server exec prisma generate \
 && pnpm --filter @nexus/server build

# Prod-only, self-contained node_modules (no symlinks back into the workspace).
RUN pnpm --filter @nexus/server deploy --prod --legacy /out \
 && cd /out && ./node_modules/.bin/prisma generate --schema prisma/schema.prisma \
 && rm -rf src build.mjs Dockerfile

# ---------- runtime ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=4000 TRUST_PROXY=true
WORKDIR /app
COPY --from=build --chown=node:node /out ./
COPY --from=build --chown=node:node /repo/apps/server/dist ./dist
COPY --chown=node:node apps/server/docker-entrypoint.sh /usr/local/bin/nexus
RUN chmod 755 /usr/local/bin/nexus
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "nexus"]
CMD ["serve"]
