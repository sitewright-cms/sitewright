# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.**

Report it privately through GitHub's private vulnerability reporting: go to the
[Security tab](https://github.com/sitewright-cms/sitewright/security) → **Report a vulnerability**
(or the repository's [advisories page](https://github.com/sitewright-cms/sitewright/security/advisories/new)).
This opens a private channel with the maintainers.

Please include, as far as you can:

- the affected version (from `GET /version`) or commit,
- a description of the issue and its impact,
- steps to reproduce (a minimal proof-of-concept helps), and
- any suggested remediation.

We aim to acknowledge a report within a few days and will keep you updated as we investigate and fix. Please
give us reasonable time to release a fix before any public disclosure, and avoid accessing or modifying other
users' data while testing.

## Supported versions

Sitewright is pre-1.0 and evolving quickly. Security fixes land on `main` and ship in the next tagged release;
we generally do not back-port to older tags. Run a recent release and keep it updated.

## Deploying securely

A few operator responsibilities are worth calling out (see [docs/deployment.md](docs/deployment.md) and
[docs/environment.md](docs/environment.md) for detail):

- **Serve over TLS** behind a reverse proxy, and set `SW_PUBLIC_URL` to your https URL — this turns on Secure
  cookies + the `__Host-` prefix and the correct WebAuthn origin. Set `TRUST_PROXY=true` so abuse throttling
  keys on the real client IP.
- **Set `SW_ENCRYPTION_KEY`** (32-byte base64) to encrypt stored credentials at rest, and keep it out of the
  database/backups (it's env-only by design).
- **Change the default admin password** — in production you're forced to on first login; better still, set
  `SW_ADMIN_PASSWORD` before first boot.
- **Keep the plain-HTTP port private** (bind it to loopback / an internal network); expose only the proxy.
- Registration is invite-only and secrets are redacted from logs by default.
