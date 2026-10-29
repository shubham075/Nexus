# Installing Nexus on your company server

This bundle has three parts:

| Folder | What it is | Where it goes |
|---|---|---|
| `server/` | The API, database, file storage and web app, run as Docker containers | The server |
| `server/deploy/updates/` | The auto-update feed (installer + `latest.yml` + `.blockmap`) | Already in place; served at `https://<your domain>/updates/` |
| `desktop/Nexus-Setup-<version>.exe` | The Windows app for employees (the server address is built in) | Your intranet download page |

The reference guide is [`server/deploy/README.md`](README.md) (operations, backups, monitoring, TLS). This page is the short path.

## 1. Prepare the server (IT)

The containers are **Linux** containers. On Windows Server, run them in a **Linux VM on Hyper-V** (Ubuntu 24.04 LTS, 4 vCPU, 8 GB RAM, 100 GB disk, plus a separate disk or share for backups). Docker Desktop with WSL2 also works, but it needs a paid licence for companies over 250 employees or over $10M revenue.

In the VM:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # log out and back in
```

Network:
- DNS records (public, since users connect from the internet) pointing to the server's public IP: `nexus.yourcompany.com` (API, desktop app) and `app.nexus.yourcompany.com` (web app).
- Inbound **80 and 443** forwarded to the VM (80 is needed for the Let's Encrypt certificate). WebSockets must pass through any company proxy or WAF.
- Outbound **587 or 465** to your mail server.

## 2. Copy and configure

Copy the `server/` folder to the VM (WinSCP, `scp`, or a share), e.g. to `/opt/nexus`. Then:

```bash
cd /opt/nexus
cp deploy/.env.prod.example deploy/.env.prod && chmod 600 deploy/.env.prod
openssl rand -hex 32            # run once per secret below
nano deploy/.env.prod
```

Set at least:
- `NEXUS_DOMAIN=nexus.yourcompany.com` and `PUBLIC_URL=https://nexus.yourcompany.com`
- `CADDY_TLS=` your admin email (automatic Let's Encrypt), or a company certificate (README §6)
- every `CHANGE-ME` (secrets, database password, storage keys)
- `SMTP_URL`, `MAIL_FROM` (invites and password resets are emailed)
- leave `TENANCY` unset: single-company mode, only invited employees can join
- `SEED_DEMO=false`, `SEED_COMPANY_NAME`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`
- `BACKUP_DIR` (the backup disk) and `BACKUP_REMOTE` if you keep off-site copies

## 3. Start

```bash
alias nexus='docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod'
nexus up -d --build             # first build takes a few minutes
nexus ps                        # api and caddy "healthy", migrate "exited (0)"
curl https://nexus.yourcompany.com/health/ready
nexus run --rm api seed         # once: your company and the first admin
```

Sign in at `https://app.nexus.yourcompany.com` with the admin account, **change the password**, build the hierarchy (Admin → Hierarchy) and invite employees.

## 4. Publish the desktop app

Put `desktop/Nexus-Setup-<version>.exe` on the intranet download page. Employees run it, and it connects to your server on its own.

Until the installer is code-signed, Windows SmartScreen shows "Windows protected your PC". Users click **More info → Run anyway**. Signing removes the warning (SOT §13: `CSC_LINK` / `CSC_KEY_PASSWORD`).

## 5. Go-live checks

- [ ] From outside the office: the certificate is valid, and you can sign in on the desktop and web apps
- [ ] An invite email arrives and the link works
- [ ] Posting with an image, chat and notifications arrive live
- [ ] `https://nexus.yourcompany.com/updates/latest.yml` opens
- [ ] The next morning: a backup exists in `BACKUP_DIR`; test a restore once (README §4)
- [ ] Monitoring on `/health/ready`, disk space and backup age (README §5)

## 6. Releasing a new version

On the build PC: bump `version` in `apps/desktop/package.json`, then run `pnpm release -- --api-url https://nexus.yourcompany.com`.

On the server:
1. Copy the new `server/` over the old one. `deploy/.env.prod`, backups and data volumes are untouched.
2. Run `nexus up -d --build`. Migrations run automatically.

Installed apps pick up the new `deploy/updates/` files and offer "Restart to update". Replace the intranet download with the new installer.
