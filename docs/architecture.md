# Sitewright Architecture & Decisions

This document records the foundational decisions. Each is intentional; revisit via a PR that
updates this file if a decision changes.

> **Authoring building blocks** (Components, Datasets, Snippets, Widgets, Templates, Slots) and how
> coders/agents/end-users compose them: see [`authoring-model.md`](./authoring-model.md). Note that
> D2/D3 below describe the original block-tree model, which has been retired — the platform is now
> code-first (Handlebars `source` + the `data-sw-component`/`data-sw-*` contracts). Likewise D1's Astro
> plan was dropped: publishing is now a **framework-free pure-Node renderer + in-process Tailwind v4**, so
> the whole build runs inside the single container.

## Product

An open-source website development platform for web-development agencies, serving **developers**
(full code/component/dataset control) and **end-users/clients** (guard-railed content editing).

## Decision log

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Static-first, framework-free output** (only the CSS/JS a page uses ships) | Top Lighthouse scores and near-zero runtime cost; CMS data is baked at build time. *(Originally planned on Astro/islands; replaced by a pure-Node HTML renderer + in-process Tailwind v4 so the whole build runs in the single container.)* |
| D2 | **Content = block/component tree as JSON** (typed blocks + per-type schema) with an **HTML/code escape hatch** on custom/leaf blocks | Clean, diffable, AI-writable structure for the visual editor; raw HTML stays contained to leaf nodes so the tree never corrupts. |
| D3 | **Reusable partials** = shared block subtrees referenced by `partialRef` | Edit-once corporate components; per-project identity. |
| D4 | **CMS bindings resolved at build time** | Keeps published sites static while supporting datasets and collection pages. |
| D5 | **AI is Claude-first behind an `AIProvider` interface** | Online (platform API) and offline (CLI) share one provider; OpenAI/Ollama adapters drop in later without rearchitecting. |
| D6 | **Portable single-container default** + pluggable publish adapters | Credible OSS self-host story; adapters target local hosting, FTP/FTPS, SFTP (+ rsync/tar fast paths), and git (HTTPS token or SSH key). |
| D7 | **Single container at best** — SQLite + in-process job queue + local-FS media by default; external Postgres/Redis/S3 are opt-in for scale | Lowest operational footprint; matches the "low server resources" goal. Split out a service only with a documented reason. |
| D8 | **Pull-based release cycle with in-app update banners** | The instance checks for new releases and surfaces an update banner; operators pull on their schedule. No forced auto-update. |

## Monorepo layout

```
packages/
  schema          # Zod schemas + authoring contracts (pages, datasets, brand, instance settings, agent guides)
  core            # pure domain logic: immutable content-tree ops, partial + binding resolution, validation
  blocks          # framework-free renderer + component/effect runtimes (the HTML the preview + publish share)
  image-pipeline  # sharp: AVIF/WebP variants, LQIP, SVG sanitization, favicon/PWA sets
  tailwind        # publish-time Tailwind v4 compiler (minimal, brand-mapped CSS)
  site-import     # a captured external site -> an editable import bundle
  mcp             # MCP stdio bridge for local coding agents
  cli             # `sitewright` CLI (OAuth login + run the MCP bridge)
apps/
  api             # Fastify backend (auth, projects, datasets, media, AI, MCP, render/build/publish)
  editor          # React + Vite editor SPA (code + content editing, live preview, managers)
```

(AI providers live in `apps/api`; there is no separate `ai`/`renderer`/`publish` package — rendering,
Tailwind compilation, and the deploy adapters all run inside `apps/api`.)

## Quality bar (enforced in CI)

TDD with 80%+ coverage, full code review + security review per change, E2E coverage of every
user-facing flow, an integration test harness per major featureset, and CI guards (typecheck, lint,
the coverage gate, a dependency audit, generated-asset drift checks, and a runtime-image render smoke).
See [CONTRIBUTING.md](../CONTRIBUTING.md).
