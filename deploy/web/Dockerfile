# Nexus web client: the renderer built as a static site (pnpm build:web), served by Caddy on :8080.
# Build from the REPO ROOT (it needs the pnpm workspace):
#   docker build -f deploy/web/Dockerfile -t nexus-web .
# Runtime env:
#   NEXUS_API_URL  the API origin browsers use, e.g. https://api.example.com (written to /config.json
#                  at start, so one image serves any environment; also the CSP connect-src)

ARG NODE_VERSION=20.18.1
ARG PNPM_VERSION=12.4.2

# ---------- build ----------
FROM node:${NODE_VERSION}-bookworm-slim AS build
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /repo
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

# Manifests first so the dependency layer is cached across source-only changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/desktop/package.json apps/desktop/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @nexus/desktop...

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/desktop apps/desktop
RUN pnpm --filter @nexus/desktop build:web

# ---------- runtime ----------
FROM caddy:2.8.4-alpine
COPY deploy/web/Caddyfile /etc/caddy/Caddyfile
COPY deploy/web/entrypoint.sh /usr/local/bin/nexus-web
COPY --from=build /repo/apps/desktop/dist-web /srv
RUN chmod 755 /usr/local/bin/nexus-web
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/config.json || exit 1
ENTRYPOINT ["nexus-web"]
