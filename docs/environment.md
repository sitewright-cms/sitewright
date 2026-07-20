# Environment variables

Sitewright is designed to run with **almost no configuration**: it auto-seeds an admin, defaults to a
hardened posture, and is reconfigured at runtime from **System Settings** in the editor. In practice you set
two things — where data lives (`SW_DATA_DIR`) and where the instance is reached (`SW_PUBLIC_URL`) — and the
rest is derived or has a safe default.

Everything below is read at startup by the API (`apps/api`). See [deployment.md](deployment.md) for how to
put these together, and `apps/api/.env.example` for a copy-paste starting point.

## The two primary knobs

| Variable | Default | Purpose |
|---|---|---|
| `SW_DATA_DIR` | `./data` (Docker: `/app/data`) | The **one** persistent directory — SQLite DB, media, published sites, preview builds, and pre-migration backups all live under it. Mount a single volume here. |
| `SW_PUBLIC_URL` | — | The public URL the instance is served at (e.g. `https://sites.example.com`). Setting this to an **https** URL turns on Secure cookies + the `__Host-` cookie prefix, becomes the WebAuthn/passkey relying-party origin, and is baked into exported forms as the absolute submission endpoint. Leave unset for a local/plain-HTTP instance. |

## Core

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `production` (when unset/blank) | Only an explicit `development`/`test` opts out of the hardened posture (structured logs, forced default-password change, secure-cookie warnings). |
| `PORT` | `2002` (Docker: `80`) | HTTP listen port. |
| `DATABASE_URL` | `file:<SW_DATA_DIR>/sitewright.db` | Override the DB location (a libsql/SQLite `file:` URL). Normally unset. |
| `TRUST_PROXY` | `false` | Set to `true` (or a comma-separated IP/CIDR allowlist) when behind a reverse proxy, so per-IP rate limits + the login throttle key on the real client IP (via `X-Forwarded-For`) instead of the proxy's. |
| `COOKIE_SECRET` | auto-generated + persisted | The session-cookie signing key. Unset → generated on first boot, persisted, and rotatable from System Settings. Set it to **pin** the key (e.g. to share across replicas). |
| `COOKIE_SECURE` | derived from `SW_PUBLIC_URL` | Override the Secure-cookie flag (`true`/`false`). Normally you don't set this — an https `SW_PUBLIC_URL` turns it on. |
| `LOG_LEVEL` | `info` | Initial pino log level (`fatal`..`trace`). The admin **Log level** setting overrides it live. Only applies when logging is on (production). |

## Secrets & auth

| Variable | Default | Notes |
|---|---|---|
| `SW_ENCRYPTION_KEY` | — | A 32-byte base64 key that encrypts stored credentials at rest (saved deploy targets, project SMTP, OIDC, stock keys, TOTP MFA). **Kept env-only on purpose** — out of the DB, so a DB dump can't decrypt. Without it, those secret-bearing features are disabled; the rest of the app works. Generate with `openssl rand -base64 32`. |
| `SW_ADMIN_EMAIL` | `admin@sitewright.example` | The first-boot admin's email. |
| `SW_ADMIN_PASSWORD` | `123456` (with a loud warning) | The first-boot admin's password. In production the admin is **forced to change** the default on first login; set your own here to skip that. |
| `SW_WEBAUTHN_RP_ID` | derived from `SW_PUBLIC_URL` (else request host) | Override the WebAuthn relying-party id. Set explicitly only when the instance is reached via multiple hostnames. |
| `SW_WEBAUTHN_ORIGIN` | derived from `SW_PUBLIC_URL` (else request host) | Override the WebAuthn origin. |
| `SW_DEPLOY_ALLOWED_HOSTS` | — (all allowed) | Comma-separated SSRF allowlist for saved deploy-target hosts. |
| `SW_SMTP_ALLOWED_HOSTS` | — (all allowed) | Comma-separated SSRF allowlist for per-project SMTP hosts. |

## Hosting extras

| Variable | Default | Notes |
|---|---|---|
| `SW_SITES_DOMAIN` | — (off) | Enables subdomain routing for locally-hosted sites: `<slug>.<SW_SITES_DOMAIN>` serves that site at root (needs wildcard DNS). The `/sites/<slug>/` path form always works regardless. |
| `SW_VERSION` | `0.0.0` | The version reported at `GET /version`. Baked into the release image from the tag (see [../RELEASING.md](../RELEASING.md)); you don't normally set it by hand. |
| `SW_DISABLE_UPDATE_CHECK` | — (check on) | Set to `true` to disable the pull-based new-release check (for air-gapped installs). |

## Online AI (optional, agency-funded)

The in-editor AI features are off unless a global key is set. Usage is metered against monthly token quotas
so no single client drains the budget. Keep the key server-side only.

| Variable | Default | Notes |
|---|---|---|
| `SW_AI_API_KEY` | — (AI off) | The global provider API key that funds in-editor AI. |
| `SW_AI_MODEL` | provider default | Pin the funded model (bounds per-call cost; clients can't override). |
| `SW_AI_PROVIDER` | `anthropic` | `openai` targets any OpenAI-compatible endpoint (with `SW_AI_BASE_URL`); else native Anthropic. |
| `SW_AI_BASE_URL` | — | OpenAI-compatible base URL (only for `SW_AI_PROVIDER=openai`). Validated at boot. |
| `SW_AI_ORG_MONTHLY_TOKENS` / `SW_AI_USER_MONTHLY_TOKENS` / `SW_AI_PROJECT_MONTHLY_TOKENS` | unlimited | Monthly token caps (positive integers; a non-positive/invalid value logs a warning and means unlimited). |

## Advanced tuning

Rarely needed — sensible defaults ship for a single-container instance.

| Variable | Default | Notes |
|---|---|---|
| `SW_RENDER_WORKERS` | `2` | Template render-pool worker count. |
| `SW_RENDER_MEMORY_MB` | `128` | Per-worker V8 heap ceiling. |
| `SW_RENDER_TIMEOUT_MS` | `5000` | Per-render timeout. |
| `SW_RENDER_MAX_RENDERS` | `500` | Recycle a worker after this many renders. |
| `SW_BUILD_WORKER` | — (in-process) | Set to `true` to run site builds in an isolated worker container (multi-tenant SaaS). Requires the Docker CLI + `DOCKER_HOST` and the API image available as the worker image. |
| `SW_BUILD_WORKER_IMAGE` / `SW_BUILD_WORKER_MEMORY` / `SW_BUILD_WORKER_CPUS` | image `sitewright-api` | Worker image + resource limits (only when `SW_BUILD_WORKER=true`). |

## Set by the Docker image (don't override)

`EDITOR_DIST` (path to the built editor SPA, `/app/editor`) and `PLAYWRIGHT_BROWSERS_PATH`
(`/ms-playwright`) are set by `apps/api/Dockerfile`; you don't set these when running the published image.
