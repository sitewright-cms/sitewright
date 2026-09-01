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
| D2 | ~~**Content = block/component tree as JSON**~~ → **a page IS its code**: Handlebars + HTML + Tailwind in `page.source`, or a referenced `template` | *(Superseded.)* The tree was meant to be the AI-writable structure; in practice it was lossy — every hand-written layout had to survive a round-trip through typed blocks. Code-first keeps what the author wrote, and `data-sw-*` bindings mark the parts a client may edit. |
| D3 | ~~**Reusable partials** = block subtrees via `partialRef`~~ → **snippets** (`{{> name}}`) and **templates** (a page renders another page's source) | *(Superseded with D2.)* Same goal — edit once, reuse everywhere — expressed in the templating language instead of a tree reference. |
| D4 | **CMS bindings resolved at build time** | Keeps published sites static while supporting datasets. (A dataset never generates routes: anything that owns a URL is a real page, typically sharing a `template:` ref. Dataset-driven `[param]` route expansion was removed — it never bound the entry into the render context.) |
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
  mcp             # MCP tool surface (shared by the API's remote /mcp); + DEPRECATED stdio bridge
  cli             # `sitewright` CLI (OAuth login); `sitewright mcp` bridge is DEPRECATED
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
