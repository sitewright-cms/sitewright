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

## Outbound network access

Short version: **you cannot lock this container down to an allowlist of destinations, and you should
not try.** You *can* stop it reaching your private network, and that is worth doing.

### Why a destination allowlist does not work here

Fetching arbitrary URLs is a product feature, not an accident. The website importer exists to crawl
a site you name; `import_image` fetches an image URL you give it; deploy targets and per-project SMTP
point at hosts your clients choose. Any allowlist wide enough to keep those working is wide enough to
carry data out of, and a compromised dependency could simply use the importer rather than opening its
own socket. Egress filtering is a real control against a *fixed* set of destinations — this workload
does not have one.

The mitigation that *would* work for that threat is segmentation rather than filtering: run the
fetch-heavy code (the crawler and importer, the highest-SSRF-surface component here) as a separate
low-privilege process or network namespace with no database handle and no secrets, so anything that
compromises it inherits open egress but nothing worth exfiltrating. Today that code runs in-process, so
this is a design change, not a deployment setting — but it is the ceiling worth aiming at, and it is
worth knowing that the private-range block below is not it.

That is separate from serving client sites. Those are served **inbound**, on `/sites/<slug>/` and the
`<slug>.<sitesDomain>` subdomains; rendering them needs no outbound connection at all, because the
visitor's browser fetches whatever the page embeds. Restricting egress does not affect hosting.

### What you should restrict: the private network

On a default install the container has **no legitimate reason to reach a private address**. It stores
everything in SQLite on its own volume — there is no database server, cache, queue, or internal
service it dials. So a connection from this container to `10/8`, `172.16/12`, `192.168/16`, `127/8`,
`169.254/16` (including the cloud metadata endpoint `169.254.169.254`) or their IPv6 equivalents is
either a bug or an attack, and blocking it costs nothing.

**Three optional features do dial private addresses**, and each needs an `ACCEPT` rule ahead of the
denies if you use it. None is on by default:

| Setting | What it dials |
|---|---|
| `DATABASE_URL` | A **remote** libsql server, if you overrode the default `file:` URL. |
| `SW_BUILD_WORKER=true` | The Docker daemon at `DOCKER_HOST`, to run site builds in isolated worker containers. A `tcp://` daemon on your network is private egress. |
| `SW_AI_BASE_URL` | A self-hosted OpenAI-compatible endpoint (llama.cpp, Ollama, vLLM) on your LAN. This env var exists *specifically* to reach one — the admin-facing AI settings reject a private `baseUrl` outright, so the env var is the only way in. |
| **OIDC SSO** with a self-hosted IdP | Discovery and token exchange against the issuer. A private (and plain-`http`) issuer is **deliberately supported** — a Keycloak/Authentik/Zitadel on your LAN is a first-class setup, not a workaround — so these rules *will* break login unless you add an `ACCEPT` for the IdP. It breaks with no hint that a firewall caused it, so add the rule at the same time, not after the first failed login. |

If none of those is configured, the container needs no private egress at all.

For the fetches driven by *tenant* content — the importer, `import_image` — the application already
guards this: they go through a pinned fetcher that resolves the name, refuses private results,
connects to the **resolved IP**, and re-checks every redirect hop. A host-level rule is defence in
depth behind that: a future code path that forgets the guard, or a DNS entry that changes between the
check and the connection, fails at the socket instead of succeeding.

**The exceptions in the table above are not behind that guard**, and the OIDC issuer deliberately is
not — a LAN IdP is a supported configuration, so nothing in the app refuses a private issuer. For
those, your firewall rule is the *only* control, not a second one. That is the intended split: the
guard constrains what *tenants* can make the server fetch, while an instance admin naming an internal
address is trusted configuration.

Implement it in your host firewall's `DOCKER-USER` chain (Docker bypasses `INPUT`/`FORWARD`), matching
on the container's own subnet. Put the container on a dedicated network so the rules have something
stable to match:

```bash
docker network create --subnet 172.28.0.0/24 sw-net
docker run -d --name sitewright --network sw-net ...   # otherwise as in Quick start
```

Then deny that subnet the private destinations, before Docker's own accept rules:

```bash
SUBNET=172.28.0.0/24

for dst in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 127.0.0.0/8 169.254.0.0/16; do
  sudo iptables -I DOCKER-USER -s "$SUBNET" -d "$dst" \
    -j REJECT --reject-with icmp-admin-prohibited
done

# ★ MUST come last, because -I prepends: the container's own subnet sits INSIDE 172.16.0.0/12, so
# without this the loop above also blocks it from talking to anything else on its own network.
# Harmless today with one container, a silent outage the day you add a second (a reverse proxy, a
# mail relay) to sw-net and it can no longer be reached.
sudo iptables -I DOCKER-USER -s "$SUBNET" -d "$SUBNET" -j RETURN

sudo ip6tables -I DOCKER-USER -s <container-v6-subnet> -d fc00::/7 \
  -j REJECT --reject-with icmp6-adm-prohibited          # if IPv6 is enabled
```

`icmp-admin-prohibited` rather than a bare `REJECT` on purpose: it surfaces as `EHOSTUNREACH` instead of
the `ECONNREFUSED` a plain `REJECT` gives, which is indistinguishable from a closed port. Don't rely on
that alone to prove the rule works, though — see below.

### Verifying it, without fooling yourself

A rule that matches nothing is worse than no rule, because you will believe you are protected. Errno
alone will not tell you: `EHOSTUNREACH` also comes from the host having no route, and `ECONNREFUSED`
from a `REJECT` is identical to one from a closed port. **Read the rule counters instead** — they are
unambiguous and do not depend on what happens to be listening.

Pick any private target *other than the container's own gateway*. `DOCKER-USER` is reached from the
**`FORWARD`** chain, and traffic to the bridge's own address (`172.28.0.1`) is destined for the host
itself, so it goes through `INPUT` and these rules never see it — probing the gateway would show no
change even when the rules are working perfectly.

```bash
sudo iptables -Z DOCKER-USER                      # zero the counters
docker exec sitewright node -e "
const s=require('net').connect({port:80,host:'10.99.99.99'});   # any private IP that is not the host
s.setTimeout(3000);
s.on('connect',()=>{console.log('REACHED');s.destroy()});
s.on('timeout',()=>{console.log('timeout');s.destroy()});
s.on('error',e=>console.log(e.code));"
sudo iptables -L DOCKER-USER -n -v | head        # the 10.0.0.0/8 rule's pkts column must be > 0
```

A non-zero packet count on the matching rule is the proof. If every counter is still `0`, the rules are
not seeing this container's traffic — most likely the `-s` subnet does not match the network you
actually started it on (`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' sitewright`).

Then confirm the internet still works, or you have broken the importer, deploys and mail:

```bash
docker exec sitewright node -e "fetch('https://example.com').then(r=>console.log('public',r.status))"
```

**Opt out if you need it.** Some setups legitimately reach the LAN: an internal SMTP relay, or an SFTP
deploy target on your own network. Those need a matching `ACCEPT` rule ahead of the `REJECT`s for that
one host — and note the application's pinned fetcher blocks private addresses regardless, so an
internal *import* source will not work either way.

### Narrowing the two user-configurable egress paths

Independent of any firewall, the app can restrict the destinations your users are allowed to
configure, which is the more precise tool for a shared instance:

| Variable | Effect |
|---|---|
| `SW_DEPLOY_ALLOWED_HOSTS` | Saved deploy targets may only point at these exact hostnames. |
| `SW_SMTP_ALLOWED_HOSTS` | Per-project SMTP may only point at these exact hostnames. |

Both are comma-separated and unset by default (anything allowed). On a multi-tenant instance, set
them. See [environment.md](environment.md).

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
