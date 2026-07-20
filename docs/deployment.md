# Deployment

Sitewright ships as a **single self-contained container** — the API, the visual editor, the render/build
pipeline, and a slimmed headless Chromium, over one persistent data directory. This guide covers running it
in production behind TLS.

For the full list of configuration variables see [environment.md](environment.md); to cut/publish a release
image see [../RELEASING.md](../RELEASING.md).

## Prerequisites

- A host with Docker.
- A domain and a **TLS-terminating reverse proxy** in front (Caddy, nginx, Traefik, a cloud LB, …). The
  container itself serves plain HTTP on port 80; the proxy handles HTTPS. TLS is required in production —
  Secure cookies and WebAuthn/passkeys only work over HTTPS.

## Quick start (`docker run`)

```bash
# One-time: a key that encrypts stored secrets at rest (deploy targets, SMTP, OIDC, MFA…). Keep it safe.
export SW_ENCRYPTION_KEY="$(openssl rand -base64 32)"

docker run -d --name sitewright \
  -p 127.0.0.1:8080:80 \
  -v sw-data:/app/data \
  -e SW_PUBLIC_URL=https://sites.example.com \
  -e TRUST_PROXY=true \
  -e SW_ENCRYPTION_KEY="$SW_ENCRYPTION_KEY" \
  --restart unless-stopped \
  ghcr.io/sitewright-cms/sitewright:latest
```

Point your reverse proxy at `127.0.0.1:8080`. That's it — the app runs migrations, seeds a first admin, and
starts serving.

**Why these values:**

- `-v sw-data:/app/data` — the one persistent volume (DB + media + published sites + backups). Back this up.
- `SW_PUBLIC_URL` (https) — turns on Secure cookies + the `__Host-` prefix and sets the WebAuthn origin.
- `TRUST_PROXY=true` — so per-IP rate limits and the login brute-force throttle key on the **real** client IP
  (via `X-Forwarded-For`) rather than the proxy's. Only set this when a proxy is actually in front.
- Publishing to `127.0.0.1:8080` keeps the plain-HTTP port off the public internet — only the proxy is exposed.

## docker-compose

```yaml
services:
  sitewright:
    image: ghcr.io/sitewright-cms/sitewright:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:80"
    environment:
      SW_PUBLIC_URL: https://sites.example.com
      TRUST_PROXY: "true"
      SW_ENCRYPTION_KEY: ${SW_ENCRYPTION_KEY}   # from a .env file / secret store — never commit it
    volumes:
      - sw-data:/app/data
    healthcheck:
      # The image also defines its own HEALTHCHECK against /ready; this mirrors it for compose UIs.
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      start_period: 60s

volumes:
  sw-data:
```

## Reverse proxy (TLS)

The proxy terminates HTTPS and forwards to the container's port 80, passing `X-Forwarded-*` headers.

**Caddy** (automatic Let's Encrypt) is the least fuss:

```
sites.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

**nginx** — forward the forwarded-for/proto headers so `TRUST_PROXY` can do its job:

```nginx
server {
    server_name sites.example.com;
    # ... your listen/ssl_certificate directives ...
    client_max_body_size 210m;   # allow large project-import uploads
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Hosting client sites on subdomains (optional):** set `SW_SITES_DOMAIN=sites.example.com` and give the proxy
a wildcard cert + `*.sites.example.com` route to the same container; each published site is then served at
`<slug>.sites.example.com`. (The `/sites/<slug>/` path form always works without any of this.)

## First run

- A first admin is seeded on boot: `admin@sitewright.example` / `123456` unless you set `SW_ADMIN_EMAIL` /
  `SW_ADMIN_PASSWORD`. In production you're **forced to change** the default password on first login.
- Registration is **invite-only** — further users are invited from the editor; there's no public sign-up.
- Reconfigure everything else (SMTP, AI, OIDC, branding, HSTS, log level, backups) from **System Settings**.

## Health checks

| Endpoint | Meaning |
|---|---|
| `GET /health` | Liveness — the process is up (no DB touch). |
| `GET /ready` | Readiness — the DB is reachable + migrated (`503` until it is). Point your load balancer here. |
| `GET /version` | The running release, e.g. `{"current":"0.1.0", ...}`. |

## Upgrades

Pull a newer tag and recreate the container against the **same volume**:

```bash
docker pull ghcr.io/sitewright-cms/sitewright:0.2.0
docker stop sitewright && docker rm sitewright
docker run -d --name sitewright ... ghcr.io/sitewright-cms/sitewright:0.2.0   # same -v / -e as before
```

Migrations run automatically on start. **Before applying a pending migration the app writes a WAL-safe
snapshot of the database** to `<SW_DATA_DIR>/backups/*.pre-migration.bak`, so a bad upgrade can be rolled
back. Retention + a manual purge live in **System Settings → Storage & backups**.

## Backups & restore

Everything durable is under the data volume (`/app/data`): the SQLite DB (`sitewright.db` + its `-wal`/`-shm`
sidecars), `media/`, `sites/`, and `backups/`.

- **Database** (WAL-safe): don't `cp` the `.db` file alone (the `-wal` sidecar makes a bare copy corrupt).
  Use `sqlite3 /app/data/sitewright.db ".backup /path/out.db"`, or snapshot the whole volume while the
  container is stopped.
- **Restore** (app stopped): copy a `.bak`/dump over `sitewright.db`, delete the `-wal`/`-shm` sidecars, start.

## Notes

- **Multi-instance:** the app is single-container by design (in-process render pool, preview store, rate-limit
  + login-throttle state). Running multiple replicas needs a shared DB, an RWX volume, a pinned
  `COOKIE_SECRET`, and sticky sessions — not a supported configuration yet.
- **HSTS** is an opt-in admin setting (off by default) — enable it in System Settings only once the origin is
  reliably on HTTPS.
