# Sitewright Architecture & Decisions

This document records the foundational decisions. Each is intentional; revisit via a PR that
updates this file if a decision changes.

> **Authoring building blocks** (Components, Datasets, Snippets, Widgets, Templates, Slots) and how
> coders/agents/end-users compose them: see [`authoring-model.md`](./authoring-model.md). Note that
> D2/D3 below describe the original block-tree model, which has been retired — the platform is now
> code-first (Handlebars `source` + the `data-sw-component`/`data-sw-*` contracts).

## Product

An open-source website development platform for web-development agencies, serving **developers**
(full code/component/dataset control) and **end-users/clients** (guard-railed content editing).

## Decision log

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Static-first output via Astro** (islands, zero-JS by default) | Top Lighthouse scores and near-zero runtime cost; CMS data is baked at build time. |
| D2 | **Content = block/component tree as JSON** (typed blocks + per-type schema) with an **HTML/code escape hatch** on custom/leaf blocks | Clean, diffable, AI-writable structure for the visual editor; raw HTML stays contained to leaf nodes so the tree never corrupts. |
| D3 | **Reusable partials** = shared block subtrees referenced by `partialRef` | Edit-once corporate components; per-project identity. |
| D4 | **CMS bindings resolved at build time** | Keeps published sites static while supporting datasets and collection pages. |
| D5 | **AI is Claude-first behind an `AIProvider` interface** | Online (platform API) and offline (CLI) share one provider; OpenAI/Ollama adapters drop in later without rearchitecting. |
| D6 | **Portable single-container default** + pluggable publish adapters | Credible OSS self-host story; adapters target static/CDN, the operator's k8s hosting platform, ssh/rsync, and git. |
| D7 | **Single container at best** — SQLite + in-process job queue + local-FS media by default; external Postgres/Redis/S3 are opt-in for scale | Lowest operational footprint; matches the "low server resources" goal. Split out a service only with a documented reason. |
| D8 | **Pull-based release cycle with in-app update banners** | The instance checks for new releases and surfaces an update banner; operators pull on their schedule. No forced auto-update. |

## Monorepo layout (target)

```
packages/
  schema          # Zod schemas for the project format (this phase)
  core            # pure domain logic: immutable tree ops, partial + binding resolution
  blocks          # block component library (Astro components + registry + per-type schema)
  renderer        # project -> Astro project -> static dist/ (incremental)
  ai              # AIProvider interface + AnthropicProvider + prompt/tool library
  image-pipeline  # sharp: AVIF/WebP, srcset, LQIP, font subsetting
  publish         # PublishAdapter interface + adapters (static/S3, k8s, ssh, git)
  cli             # `sitewright` offline CLI (init/dev/build/publish/ai)
apps/
  api             # Fastify backend (auth, projects, datasets, media, AI proxy, build queue)
  editor          # React + Vite visual editor (canvas, inspector, Monaco, managers)
  web             # Astro marketing + docs (dogfood)
```

## Quality bar (enforced in CI)

TDD with 80%+ coverage, full code review + security review per change, E2E coverage of every
user-facing flow, an integration test harness per major featureset, and CI guards (coverage
gate, Lighthouse budget, etc.). See [CONTRIBUTING.md](../CONTRIBUTING.md).
