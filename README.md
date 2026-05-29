<div align="center">

# Sitewright

**Open-source website development platform for web-development agencies.**

A visual + code editor, per-project corporate identity, reusable partials, a built-in CMS, and
integrated AI — producing highly optimized **static** sites (Astro) through a fast publishing
pipeline. Self-hostable in a single container.

[![CI](https://github.com/sitewright-cms/sitewright/actions/workflows/ci.yml/badge.svg)](https://github.com/sitewright-cms/sitewright/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

</div>

> **Status: early development (Phase 0 — foundations).** APIs and formats are not yet stable.

## Why Sitewright

Agencies juggle many client sites, each with its own brand, content, and release cadence.
Sitewright is one platform for the whole lifecycle:

- 🎨 **Corporate identity per project** — design tokens (color, type, spacing, logo) compiled to
  a theme; locked for clients, editable by developers.
- 🧱 **Block-based editor** — a visual canvas over a typed block tree, with an HTML/code escape
  hatch for power users. **Reusable partials** keep shared components in sync.
- 🗂️ **CMS / datasets per project** — define collections, bind them to blocks, generate
  collection pages — all resolved at build time so output stays static.
- 🤖 **Integrated AI** — online via the platform API and offline via the `sitewright` CLI,
  Claude-first behind a provider interface.
- ⚡ **Fast publishing** — incremental Astro builds, AVIF/WebP image pipeline, atomic deploys,
  instant rollback. Pluggable publish targets (static/CDN, Kubernetes, ssh/rsync, git).
- 🪶 **Low footprint, high Lighthouse** — static-first output, near-zero runtime cost, single
  container to self-host.

See **[docs/architecture.md](./docs/architecture.md)** for the decision log and
**[docs/project-format.md](./docs/project-format.md)** for the on-disk project format.

## Monorepo

| Package | Status | Purpose |
|---------|--------|---------|
| [`@sitewright/schema`](./packages/schema) | 🟢 Phase 0 | Zod schemas for the project format (blocks, pages, partials, datasets, brand) |
| `@sitewright/core` | ⚪ planned | Pure domain logic: tree ops, partial + binding resolution |
| `@sitewright/renderer` | ⚪ planned | Project → Astro → optimized static output |
| `@sitewright/ai` | ⚪ planned | `AIProvider` interface + Claude provider |
| `@sitewright/publish` | ⚪ planned | Publish adapters |
| `@sitewright/cli` | ⚪ planned | Offline `sitewright` CLI |
| `apps/api`, `apps/editor` | ⚪ planned | Backend + visual editor |

## Development

```bash
corepack enable      # provides pnpm (Node >= 22, see .nvmrc)
pnpm install
pnpm verify          # typecheck + lint + test + build
```

Contributions follow a strict quality bar (TDD, full code + security review, E2E). See
**[CONTRIBUTING.md](./CONTRIBUTING.md)**.

## License

[Apache-2.0](./LICENSE)
