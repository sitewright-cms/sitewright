<div align="center">

<img src="./brand/assets/logo-lockup-light.png#gh-light-mode-only" alt="Sitewright" height="60" />
<img src="./brand/assets/logo-lockup-dark.png#gh-dark-mode-only" alt="Sitewright" height="60" />

**The open-source, self-hostable website platform for agencies.**

Build and run *all* your client sites from one place — author in code with live in-place editing, a built-in
CMS, rich interactive components, and an AI assistant — then publish fast, framework-free static sites.
Coding agents can build and edit your sites too, over MCP.

[![CI](https://github.com/sitewright-cms/sitewright/actions/workflows/ci.yml/badge.svg)](https://github.com/sitewright-cms/sitewright/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/sitewright-cms/sitewright?sort=semver)](https://github.com/sitewright-cms/sitewright/releases)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Image: GHCR](https://img.shields.io/badge/image-ghcr.io-2496ED?logo=docker&logoColor=white)](https://github.com/sitewright-cms/sitewright/pkgs/container/sitewright)

</div>

> **Status:** actively developed and self-hostable today (`v0.1.0`). Pre-1.0 — APIs and on-disk formats may
> change between minor versions; see [CHANGELOG.md](./CHANGELOG.md).

---

## Why Sitewright

Agencies juggle dozens of client sites — each with its own brand, content, forms, languages, and release
cadence. Sitewright is **one platform for the whole lifecycle**, self-hosted in a single container:

- **Code-first, but clients can edit.** Developers author pages in HTML + Tailwind + [DaisyUI](https://daisyui.com);
  mark any element editable and clients change text, images, and links **in place** in a live preview — with no
  access to the code.
- **Batteries included.** A built-in CMS, forms, multilingual, a rich component + motion library, an image
  pipeline, SEO, consent/GDPR, and a real deploy pipeline — not a pile of plugins to assemble.
- **Agent-native.** An in-editor AI assistant builds and edits sites for you, and an **MCP** endpoint lets
  external coding agents (Claude Code, ChatGPT, Cursor…) do the same over a scoped key. Your sites are
  programmable.
- **Fast + cheap to host.** Output is **framework-free static HTML** — only the CSS/JS a page actually uses is
  shipped, so simple pages carry near-zero JavaScript.
- **Yours to run.** One container, one volume. Hardened by default, versioned releases, automatic
  pre-upgrade DB snapshots. No SaaS lock-in.

## Deploy in one command

```bash
docker run -d -p 127.0.0.1:8080:80 -v sw-data:/app/data \
  -e SW_PUBLIC_URL=https://sites.example.com -e TRUST_PROXY=true \
  -e SW_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  ghcr.io/sitewright-cms/sitewright:latest
```

Put a TLS reverse proxy in front and you're live. Full guide → **[docs/deployment.md](./docs/deployment.md)**
· every setting → **[docs/environment.md](./docs/environment.md)**.

## Features

### ✍️ Authoring
- **Code-first pages** — each page is HTML + Tailwind + DaisyUI; the code *is* the page (no lossy block tree).
- **Live in-place editing** — mark elements with `data-sw-*` and clients edit text, rich HTML, links, images,
  and backgrounds directly in a **live WYSIWYG preview**, safely (no code access).
- **Reusable building blocks** — components, snippets (a ~25-recipe cookbook to copy and own), full-page
  templates, data-backed widgets, and site-wide chrome slots (nav / footer / sidebars).
- **Dual-mode editor** — a full code editor (CodeMirror) *or* a client-safe content editor, with a searchable
  Library rail (components, icons, animations, button/parallax/SVG builders, Google-font gallery) and
  desktop/mobile preview.

### 🧩 Interactive components & motion
- **First-party components** — carousel/slider (Embla), tabs, lightbox gallery, native `<dialog>` modals,
  dismissible banners, forms, a date/time/range picker, and **WebGL shader backgrounds** (30 presets). All
  accessible and degrade to usable HTML without JS.
- **Motion & effects** — scroll/entrance animations, multi-layer parallax, **SVG draw-on + morph animation**
  (with a visual studio), curated nav & button effect libraries, sticky-header modes, scrollspy, a page
  preloader, click ripples, back-to-top, and opt-in light/dark themes.

### 🗂️ Built-in CMS
- **Typed datasets** — collections with 15 field types (incl. nested list/object, references, media), edited
  in a data panel and **click-to-edit in the preview**.
- **Dynamic pages** — a `[param]` route over a dataset expands into one static detail page per entry at build.
- **Safe by design** — rename a dataset and the slug cascades across every loop and reference in one
  transaction.

### 🌍 Multilingual
- **Translate by inheritance** — add a language and Sitewright scaffolds translated pages that inherit the
  master's code; edit the layout once and every language updates.
- **Key-first catalog** — shared UI strings via `{{sw-translate}}`, per-locale content, `hreflang` alternates,
  and localized datasets.

### 🖼️ Media, fonts & performance
- **Responsive images** — AVIF/WebP with `srcset`, blur-up LQIP, no-CLS intrinsic sizes, on-demand thumbnails,
  materialized minimally at publish.
- **Vectors & icons** — SVG kept as sanitized first-class vector; ~1,865 Lucide icons, ~270 brand logos, ~250
  country flags — all inlined.
- **Fonts** — self-hosted uploads *and* Google Fonts downloaded + self-hosted (never a CDN); a full
  favicon/PWA icon set generated from one master.
- **Lean CSS** — publish-time Tailwind v4 emits only the classes you use, brand tokens as first-class
  utilities, one cacheable stylesheet.

### 🚀 Publish, deploy & host
- **Framework-free static output** — only-used-ships CSS/JS, atomic publish, a portable self-contained
  artifact (runs at a domain root, a subfolder, or locally).
- **Deploy anywhere** — local hosting, FTP/FTPS, SFTP (with rsync/tar fast paths), and git (HTTPS token or SSH
  key) — via a wizard, with **encrypted** secrets, SSRF guards, and **live streamed progress**.
- **Incremental delta deploys** — a content-hash manifest uploads only what changed, with a tar-over-SSH fast
  path, transport compression, and immutable `?v=` cache-busting.
- **Always-on preview** — a whole-site draft preview rebuilt on change, plus revocable share links for
  stakeholders.
- **Self-host client sites** — serve them in-container at `<slug>.<your-domain>` (origin-isolated so author JS
  runs safely) or via a `/sites/<slug>/` path.

### 🔎 SEO & 🔒 privacy
- **SEO built in** — per-page Open Graph, Twitter cards, canonical + `hreflang`, `sitemap.xml`, `robots.txt`,
  and schema.org Organization JSON-LD.
- **Insights** — an in-editor **Lighthouse** speed + SEO audit (also an API route and an agent tool).
- **Consent Manager** — auto-gates third-party iframes *and* analytics scripts by consent category and
  derives a **tight per-site Content-Security-Policy** (never `unsafe-inline`/`*`) — GDPR-friendly by construction.

### 🤖 AI & agents
- **On-page AI assistant** — a server-side agent loop drives ~45 authoring tools to build and edit the site
  live (bring the platform key, or a per-project key).
- **MCP, everywhere** — a remote OAuth MCP endpoint (ChatGPT, Claude.ai) *and* a local `sitewright-mcp` stdio
  bridge (Claude Code, Cursor, Cline, Windsurf, Gemini CLI) let coding agents edit a project over a scoped key.
- **Import & clone** — crawl or upload an existing site into an editable project (self-hosting its images +
  fonts, extracting brand identity); AI-assisted nativize with objective fidelity audits.

### 👥 Agency, accounts & ops
- **Multi-tenant** — per-project corporate identity/branding; **white-label** the whole admin panel.
- **Client access** — invite-only registration and one-time, project-scoped client invites (edit-only, no
  email infra required).
- **Hardened auth** — MFA/TOTP, passkeys/WebAuthn, OIDC SSO, and project-scoped API keys.
- **Safety net** — project-wide version history + restore across pages, datasets, and settings; a 90-day
  media recycle bin; automatic WAL-safe DB snapshots before every upgrade.
- **Self-host ops** — one System Settings panel (SMTP, AI, OIDC, branding, HSTS, log level, backups), `/health`
  + `/ready` probes, structured logs, and versioned GHCR releases with an in-app update banner.

## Monorepo

pnpm + Turborepo. The whole product ships as `apps/api`'s container; the packages are internal (not published
to npm).

| Package | Purpose |
|---|---|
| [`apps/api`](./apps/api) | Fastify backend — REST API, serves the editor SPA, the render/build/publish pipeline, and the MCP endpoint. |
| [`apps/editor`](./apps/editor) | The React visual + code editor (single-page app). |
| [`@sitewright/schema`](./packages/schema) | Zod schemas + authoring contracts (pages, datasets, brand tokens, instance settings, the component catalog + agent guides). |
| [`@sitewright/core`](./packages/core) | Pure domain logic — immutable content-tree ops, partial + binding resolution, collection-page expansion, project validation. |
| [`@sitewright/blocks`](./packages/blocks) | Framework-free renderer + component/effect runtimes — the XSS-safe HTML that the live preview and the published site share. |
| [`@sitewright/image-pipeline`](./packages/image-pipeline) | Image optimization — AVIF/WebP variants, LQIP, SVG sanitization, favicon/PWA sets (sharp). |
| [`@sitewright/tailwind`](./packages/tailwind) | Publish-time Tailwind v4 compiler — scans rendered HTML, emits a minimal brand-mapped stylesheet. |
| [`@sitewright/site-import`](./packages/site-import) | Turns a captured external site (crawl or upload) into an editable Sitewright import bundle. |
| [`@sitewright/mcp`](./packages/mcp) | MCP stdio bridge — exposes a project's authoring tools to local coding agents over a scoped key. |
| [`@sitewright/cli`](./packages/cli) | The `sitewright` CLI — OAuth login + `sitewright mcp` to run the bridge from stored credentials. |

Deeper design docs: **[architecture](./docs/architecture.md)** · **[authoring model](./docs/authoring-model.md)**
· **[project format](./docs/project-format.md)**.

## Development

```bash
corepack enable      # provides pnpm (Node >= 22, see .nvmrc)
pnpm install
pnpm verify          # typecheck + lint + test + build
```

Contributions follow a strict quality bar (TDD, full code + security review, E2E) — see
**[CONTRIBUTING.md](./CONTRIBUTING.md)**. To cut a release, see **[RELEASING.md](./RELEASING.md)**; to report a
vulnerability, see **[SECURITY.md](./SECURITY.md)**.

## License

[Apache-2.0](./LICENSE)
