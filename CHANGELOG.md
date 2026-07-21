# Changelog

All notable changes to Sitewright are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The running version of an instance is reported at `GET /version` (baked into the release image; see
[RELEASING.md](RELEASING.md)). While pre-1.0, minor versions may include breaking changes.

## [Unreleased]

### Changed

- **Flat exported media layout** — a published/deployed site now bundles every media asset into a
  single flat `_assets/` directory (`_assets/<alias>-<name>-<size>.<ext>`) instead of one folder per
  asset (`_assets/<id>/…`). SFTP/FTP deploys create one directory instead of one-per-asset, which
  removes a per-asset `mkdir`/`ensureDir` round-trip and speeds up uploads. The `<alias>` is a short,
  stable prefix derived from the asset id, so incremental deploys stay stable after the first publish.
  **Note:** the first publish/deploy after upgrading re-uploads every media file once (their paths
  change) and prunes the old `_assets/<id>/…` files; subsequent deploys are incremental again.
- **Simpler, more robust SFTP deploys** — the SFTP uploader now always uses the direct per-file path
  (concurrent `fastPut`). The SSH capability probe and the tar-over-SSH fast path were removed: the
  flat `_assets/` layout erased the per-directory savings the tar path existed for, and the probe
  added a round trip and could hang on servers that mis-advertise SSH exec. The connection handshake
  timeout was also raised (15s → 60s) so a slow or distant server isn't dropped before the transfer
  starts.

## [0.2.0] — 2026-07-21

An editor UX + authoring-polish pass across the settings, forms, and page-editing surfaces.

### Added

- **Page Audit tab** — the Lighthouse speed + SEO audit moved out of the right-rail side-panel into the
  page editor as a third mode of the Code/Content toggle. It shows the page's SEO head fields, a
  Desktop/Mobile run control, and a PageSpeed-style report: circular category gauges, Core Web Vitals
  metrics with explanatory tooltips, and ranked findings with colour-coded tags + actionable-advice
  tooltips. (Audit findings now also carry Lighthouse's how-to-fix description.)
- **Preview split button** — the Preview button gained a dropdown (like Deploy) with "Preview share
  links", which now open in a dedicated modal.

### Changed

- **Tabbed modals** — the Project Settings modal (General / AI Assistant — per-project AI config moved
  here from Website Settings) and the enlarged System Settings modal (General / Integrations / AI /
  Security / Ops / Agents) are now organized into tabs.
- **Settings menu** — grouped into ADMINISTRATION (admins) and PROJECT sections; **Team → Administrators**
  and **Clients → Project Members** for clarity.
- **Editor polish** — Corporate Identity + Website Settings section headers now read as emphasized
  uppercase bands; Forms rows are fully clickable with the standard gradient-hover + ripple; keyed
  translations in Website Settings are listed alphabetically.
- **Native cart-checkout validation** — the mini-shop order/channel forms use the browser's native
  required/format validation (consistent with the Form component), backed by the server-side check.
- **Example project i18n** — footer/cookie translation keys are grouped by dot-namespacing
  (`footer_studio` → `footer.studio`).

### Removed

- The standalone **Speed & SEO** side-panel (superseded by the Page Audit tab).

## [0.1.0] — 2026-07-20

First tagged release + the production-readiness work.

### Added

- **Release pipeline** — pushing a `vX.Y.Z` tag builds the runtime image and publishes it to GHCR
  (`ghcr.io/sitewright-cms/sitewright:X.Y.Z` + `:latest`), then creates a GitHub Release. The image version
  is baked in and reported at `GET /version`.
- **Liveness + readiness probes** — `GET /health` (process up) and `GET /ready` (DB reachable → 503 on
  failure), plus a Dockerfile `HEALTHCHECK`.
- **Opt-in HSTS** — an admin instance setting (default off) with `includeSubDomains` / `preload` /
  apply-to-served-sites controls.
- **WAL-safe pre-migration DB snapshots** — before applying a pending migration the app snapshots the SQLite
  DB to `<data>/backups/*.pre-migration.bak` so a bad migration can be rolled back; retention is admin-set.
- **Admin ops settings** — server log level (live-applied) and DB backup management (storage sizes + purge).

### Changed

- **Hardened-by-default posture** — `NODE_ENV` defaults to `production` when unset; Secure cookies + the
  `__Host-` prefix + the WebAuthn relying-party are derived from `SW_PUBLIC_URL`.
- **Simplified environment** — one validated config resolver; `SW_DATA_DIR` and `SW_PUBLIC_URL` are the two
  primary knobs (the per-root `MEDIA_ROOT` / `PUBLISH_ROOT` / `PREVIEW_ROOT` / `SOURCE_REF_ROOT` overrides were
  retired).
- **Slow-loris mitigation** — a request-receive timeout on the HTTP server.

[Unreleased]: https://github.com/sitewright-cms/sitewright/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/sitewright-cms/sitewright/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/sitewright-cms/sitewright/releases/tag/v0.1.0
