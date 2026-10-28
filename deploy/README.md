# Deploying Nexus (production)

One Linux host (or VM) with Docker runs the whole server side: the API, PostgreSQL, S3-compatible storage, optional Redis, a nightly backup job and Caddy as the HTTPS reverse proxy. Desktop clients connect to `https://<NEXUS_DOMAIN>`.

```
clients ──HTTPS/WSS──▶ caddy :443 ──▶ api :4000 ──▶ postgres
                                         │      ├──▶ s3 (SeaweedFS, or AWS S3 / MinIO)
                                         │      └──▶ redis (optional)
                       backup (cron) ────┴──▶ pg_dump + bucket mirror ──▶ BACKUP_DIR (+ off-site)
```

| File | Purpose |
|------|---------|
| [`apps/server/Dockerfile`](../apps/server/Dockerfile) | Multi-stage API image: esbuild bundle, prod-only `node_modules`, non-root `node` user, `HEALTHCHECK` on `/health/ready` |
| [`apps/server/docker-entrypoint.sh`](../apps/server/docker-entrypoint.sh) | Image commands: `serve` (default), `migrate`, `seed` |
| [`deploy/docker-compose.prod.yml`](docker-compose.prod.yml) | The stack (project name `nexus-prod`, separate from the dev stack) |
| [`deploy/.env.prod.example`](.env.prod.example) | Every setting; copy to `deploy/.env.prod` |
| [`deploy/caddy/Caddyfile`](caddy/Caddyfile) | HTTPS, WebSocket upgrade, `/metrics` blocked, JSON access logs |
| [`deploy/backup/`](backup/) | Backup sidecar image (`backup.sh`, `restore.sh`) |

## 1. What you must provision

| Item | Notes |
|------|-------|
| **Host** | Linux VM, 2 vCPU / 4 GB RAM / 40 GB disk is plenty for < 500 users (D11). Docker Engine 24+ with the compose plugin. |
| **DNS name** | e.g. `nexus.yourcompany.internal` → the host. This is `NEXUS_DOMAIN`. |
| **TLS certificate** | One of: a cert from your company CA (put `fullchain.pem` + `key.pem` in `deploy/caddy/certs/`), Let's Encrypt (host reachable from the internet on 80/443), or Caddy's internal CA (`CADDY_TLS=internal`, then trust its root on clients, see §6). |
| **Firewall** | Inbound 443 (and 80 for redirects/ACME) from the client network. Nothing else needs to be exposed. |
| **Backup storage** | A disk other than the one holding the Docker volumes for `BACKUP_DIR`, and ideally an off-site bucket (`BACKUP_REMOTE`). |
| **Secrets** | `JWT_SECRET`, `POSTGRES_PASSWORD`, `S3_ACCESS_KEY`/`S3_SECRET_KEY`, `MEDIA_URL_SECRET`: `openssl rand -hex 32`. Keep `.env.prod` readable by root only. |
| **Optional** | Managed Postgres (`DATABASE_URL`), AWS S3 / MinIO (`S3_ENDPOINT`), an Entra ID / Google OIDC app (`OIDC_*`), a container registry (`NEXUS_API_IMAGE`), Prometheus + a log collector. |

## 2. First deployment

```bash
git clone https://github.com/shubham075/Nexus.git && cd Nexus
cp deploy/.env.prod.example deploy/.env.prod
chmod 600 deploy/.env.prod
# edit deploy/.env.prod: every CHANGE-ME, NEXUS_DOMAIN, PUBLIC_URL, CADDY_TLS, COMPOSE_PROFILES

alias nexus='docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod'
nexus build                     # API image (and backup image)
nexus up -d                     # postgres → migrate (one-shot) → api → caddy, plus profiles
nexus ps                        # api and caddy "healthy", migrate "exited (0)"
curl -k https://$NEXUS_DOMAIN/health/ready
```

**Migrations** run as the one-shot `migrate` service (`prisma migrate deploy`) before every `up`; the API only starts when it exits 0. Run it on its own with `nexus run --rm migrate`.

**First admin.** On the empty database, run the seed once. It creates the super admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` plus the demo company:

```bash
nexus run --rm api seed
```

Then sign in, change the admin password, rename the root unit and delete/deactivate the demo users (Admin → Employees). The seed refuses to run on a non-empty database.

**Clients.** Put `nexus.config.json` next to `Nexus.exe` (or in `%APPDATA%\Nexus`): `{ "apiUrl": "https://nexus.yourcompany.internal" }` (see the root README).

## 3. Upgrades

```bash
git pull
nexus build api
nexus up -d          # migrate runs first; api is recreated only after migrations succeed
```

Take a manual backup first (`nexus exec backup backup.sh`). With a registry, build and push in CI, set `NEXUS_API_IMAGE=registry/…/nexus-api:<version>` and run `nexus pull && nexus up -d` instead.

Building and publishing the image (for CI):

```bash
docker build -f apps/server/Dockerfile -t registry.yourcompany.internal/nexus-api:$(git rev-parse --short HEAD) .
docker push registry.yourcompany.internal/nexus-api:$(git rev-parse --short HEAD)
```

## 4. Backups and restore

The `backup` profile runs [`backup.sh`](backup/backup.sh) on `BACKUP_CRON` (default 02:30 in `TZ`):

- `db/nexus-<timestamp>.dump`: `pg_dump --format=custom`, verified with `pg_restore --list`; files older than `BACKUP_KEEP_DAYS` are deleted.
- `media/`: `rclone sync` mirror of the bucket; objects deleted or overwritten since the previous run go to `media-changed/<timestamp>/` (also rotated).
- With `BACKUP_REMOTE` set, the dump and the mirror are copied off-site (any rclone remote, configured with `RCLONE_CONFIG_<NAME>_*` vars).
- `last-success` holds the time of the last complete run. Alert if it is older than ~26 h.

Run one now: `nexus exec backup backup.sh`. Logs: `nexus logs backup`.

### Restore (tested, see SOT QA log)

```bash
nexus stop api                                              # nothing writes during the restore
nexus exec backup restore.sh latest --with-media            # or a file name from BACKUP_DIR/db; prompts "restore"
nexus start api
curl -k https://$NEXUS_DOMAIN/health/ready
```

`restore.sh` runs `pg_restore --clean --if-exists --single-transaction` (all or nothing) and, with `--with-media`, copies the mirror back into the bucket (never deletes objects). Add `--yes` to skip the prompt in scripts.

**Restoring onto a new host:** deploy as in §2 with the same `.env.prod` but **don't** run the seed, copy the backup folder to `BACKUP_DIR`, `nexus up -d`, then the restore commands above. The dump is the full schema plus data, so migrations already applied in the dump are recognised by Prisma.

Test a restore every quarter on a scratch host.

## 5. Monitoring and logs

| Endpoint (inside the network: `http://api:4000`) | Use |
|---|---|
| `GET /health/live` | Process is up. Cheap; for restart decisions. |
| `GET /health/ready` (and `/health`) | Postgres `SELECT 1` and a `HeadBucket` on storage, 3 s timeout each. `200 {"ok":true,"checks":{…}}` or `503` naming the failing check. Docker's `HEALTHCHECK` and external uptime monitors use this. Reachable through the proxy too. |
| `GET /metrics` | Prometheus text format when `METRICS_ENABLED=true` (optionally `Authorization: Bearer $METRICS_TOKEN`). `nexus_http_requests_total{method,route,status}`, `nexus_http_request_duration_seconds`, plus Node process metrics (`nexus_process_*`, `nexus_nodejs_*`: heap, event-loop lag, GC). Blocked at the proxy; scrape `api:4000` from a Prometheus container on the `nexus-prod_default` network. |

Suggested alerts: `/health/ready` non-200 for 2 min; 5xx rate > 1 %; p95 latency > 1 s; `last-success` older than 26 h; disk usage of the Docker volumes and `BACKUP_DIR` > 80 %.

**Logs.** The API writes one JSON object per line to stdout (pino; `level`, `time`, `reqId`, `req`, `res`, `responseTime`; `Authorization` headers are redacted). Caddy access logs and backup logs are JSON too. Docker keeps them in `json-file` with rotation (5 × 20 MB per container). `LOG_LEVEL` = `debug|info|warn|error`.

Log shipping options, from least to most setup:
- `nexus logs -f api | jq` on the host.
- Point the Docker daemon (or each service's `logging:`) at your collector: `gelf`, `syslog`, `fluentd`, `awslogs`, `gcplogs`.
- Run a collector (Grafana Alloy / Promtail → Loki, Vector, Fluent Bit → Elasticsearch) reading `/var/lib/docker/containers/*/*-json.log`; the lines are already JSON, so no parsing rules are needed.

## 6. TLS notes

- `CADDY_TLS=internal`: Caddy issues a certificate from its own CA. Export the root with `nexus cp caddy:/data/caddy/pki/authorities/local/root.crt .` and distribute it to clients via Group Policy (Trusted Root Certification Authorities). Electron uses the Windows certificate store.
- Company CA: `CADDY_TLS=/certs/fullchain.pem /certs/key.pem` with the files in `deploy/caddy/certs/` (git-ignored).
- Let's Encrypt: `CADDY_TLS=you@company.com`; the name must resolve publicly and ports 80/443 must be reachable.

Caddy proxies WebSocket upgrades (Socket.IO realtime) without extra configuration, and `request_body max_size 60MB` sits just above the API's 50 MB upload limit.

## 7. Scaling notes

Run **one** API container; it fits the < 500-employee target (D11). The hierarchy DAG and RBAC caches are in memory and are only invalidated on the instance that made the change, so a second replica would serve stale permissions until restarted. Before scaling out (`--scale api=2`, which Caddy would load-balance), the caches need cross-instance invalidation (e.g. Redis pub/sub) in addition to `REDIS_URL` for Socket.IO fan-out.

## 8. Local smoke test of the prod stack

The prod stack can run next to the dev stack (`docker-compose.yml` uses 5434/8334/4000):

```bash
# in deploy/.env.prod: NEXUS_DOMAIN=localhost, PUBLIC_URL=https://localhost:8443, HTTP_PORT=8088, HTTPS_PORT=8443
nexus up -d --build
curl -k https://localhost:8443/health/ready
nexus down            # add -v to also delete the prod volumes
```
