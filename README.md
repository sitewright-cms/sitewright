<div align="center">

<img src="./brand/assets/logo-lockup-light.png#gh-light-mode-only" alt="Sitewright" height="60" />
<img src="./brand/assets/logo-lockup-dark.png#gh-dark-mode-only" alt="Sitewright" height="60" />

**Open-source website development platform for web-development agencies.**

A visual + code editor, per-project corporate identity, reusable partials, a built-in CMS, and
integrated AI — producing highly optimized **static** sites (Astro) through a fast publishing
pipeline. Self-hostable in a single container.

[![CI](https://github.com/sitewright-cms/sitewright/actions/workflows/ci.yml/badge.svg)](https://github.com/sitewright-cms/sitewright/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

</div>

> **Status:** actively developed and self-hostable today. Pre-1.0 — APIs and on-disk formats may still change
> between minor versions; see [CHANGELOG.md](./CHANGELOG.md).

## Why Sitewright

Agencies juggle many client sites, each with its own brand, content, and release cadence.
Sitewright is one platform for the whole lifecycle:

- 🎨 **Corporate identity per project** — design tokens (color, type, spacing, logo) compiled to a theme;
  locked for clients, editable by developers.
- 🧱 **Code-first, with a live visual editor** — author in HTML/code with a live preview and in-place editing
  of content regions. **Reusable partials, snippets, and components** keep shared building blocks in sync.
- 🗂️ **CMS / datasets per project** — define collections, bind them into pages, generate collection pages —
  all resolved at build time so the output stays static.
- 🤖 **Integrated AI + agents** — an in-editor AI assistant, plus an **MCP** endpoint so local coding agents
  (e.g. Claude Code) can edit a project's content over a project-scoped key.
- ⚡ **Fast publishing** — incremental Astro builds, an AVIF/WebP image pipeline, atomic deploys, and instant
  rollback. Pluggable publish targets (local/CDN static, SSH/rsync, git).
- 🔎 **Import an existing site** — crawl or upload a site and turn it into an editable Sitewright project.
- 🪶 **Low footprint, high Lighthouse** — static-first output, near-zero runtime cost, one container to host.

## Deploy

Published images are on the GitHub Container Registry:

```bash
docker run -d -p 127.0.0.1:8080:80 -v sw-data:/app/data \
  -e SW_PUBLIC_URL=https://sites.example.com -e TRUST_PROXY=true \
  -e SW_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  ghcr.io/sitewright-cms/sitewright:latest
```

Put a TLS-terminating reverse proxy in front. See **[docs/deployment.md](./docs/deployment.md)** for the full
guide (compose, reverse proxy, first-run, upgrades, backups) and **[docs/environment.md](./docs/environment.md)**
for every configuration variable.

## Monorepo

pnpm + Turborepo. The whole product ships as `apps/api`'s container; the packages are internal (not published
to npm).

| Package | Purpose |
|---|---|
| [`apps/api`](./apps/api) | Fastify backend — REST API, serves the editor SPA, the render/build/publish pipeline, and the MCP endpoint. |
| [`apps/editor`](./apps/editor) | The React visual + code editor (single-page app). |
| [`@sitewright/schema`](./packages/schema) | Zod schemas + authoring contracts for the project format (pages, partials, datasets, brand tokens, instance settings). |
| [`@sitewright/core`](./packages/core) | Pure domain logic — immutable content-tree operations, partial + binding resolution, project validation. |
| [`@sitewright/blocks`](./packages/blocks) | Framework-free component/renderer library — an XSS-safe HTML renderer that mirrors the published Astro output; shared by the editor + live-preview. |
| [`@sitewright/image-pipeline`](./packages/image-pipeline) | Build-time image optimization — responsive AVIF/WebP variants, LQIP placeholders, srcset manifests (sharp). |
| [`@sitewright/tailwind`](./packages/tailwind) | Publish-time Tailwind compiler — scans rendered HTML, emits a minimal brand-mapped stylesheet. |
| [`@sitewright/site-import`](./packages/site-import) | Turns a captured external website (crawl or upload) into an editable Sitewright import bundle. |
| [`@sitewright/mcp`](./packages/mcp) | MCP stdio bridge — exposes a project's content operations as agent tools, authenticated by a project-scoped key. |
| [`@sitewright/cli`](./packages/cli) | The `sitewright` CLI — OAuth login + `sitewright mcp` to run the bridge from stored credentials. |

More design detail: **[docs/architecture.md](./docs/architecture.md)** (decision log),
**[docs/authoring-model.md](./docs/authoring-model.md)** (the building blocks),
**[docs/project-format.md](./docs/project-format.md)** (on-disk format).

## Development

```bash
corepack enable      # provides pnpm (Node >= 22, see .nvmrc)
pnpm install
pnpm verify          # typecheck + lint + test + build
```

Contributions follow a strict quality bar (TDD, full code + security review, E2E). See
**[CONTRIBUTING.md](./CONTRIBUTING.md)**. To cut a release, see **[RELEASING.md](./RELEASING.md)**; to report a
vulnerability, see **[SECURITY.md](./SECURITY.md)**.

## License

[Apache-2.0](./LICENSE)
