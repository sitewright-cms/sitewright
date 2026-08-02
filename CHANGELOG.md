# Changelog

All notable changes to Sitewright are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The running version of an instance is reported at `GET /version` (baked into the release image; see
[RELEASING.md](RELEASING.md)). While pre-1.0, minor versions may include breaking changes.

## [Unreleased]

## [0.9.0] — 2026-08-02

A ten-site clone run by ten neutral MCP agents. The dominant failure class was again the platform
**describing itself incorrectly** — silent, because the agent then builds on a false belief and the error
only surfaces in the finished clone. This release fixes the nine that cost the most, and repairs an E2E
suite that had rotted against four intentional product changes.

### Fixed

- **`clone_audit`'s clipping check compares against the ORIGINAL.** It measured something real — an
  element cut off by an ancestor's overflow is invisible to `getBoundingClientRect` — but could not tell a
  broken layout from a deliberate bleed, and gating on that ambiguity did real damage. To turn it green,
  agents replaced `<img>` elements with background-image divs (measured: 41 alt texts down to 6 on one
  page, 18 down to 4 on another), swapped an accordion's `max-width:0` slide-open for `display:none`, and
  shrank icons the design intentionally bleeds past a tile edge. Four fidelity regressions, no real defect
  among them; the check had been demoted to advisory as damage control. The missing input was always the
  source: a clip the ORIGINAL also makes is the design being ported. Both sides are now probed and the
  overlap subtracted, pairing on tag + clipped axis because a faithful native port has entirely different
  markup and selectors cannot pair across the two renders. It gates again when a source was probed, and
  stays advisory when there wasn't one — "couldn't look at the original" is not "the original clips
  nothing", and must not produce the same verdict.
- **Flat dataset entry values are folded into `values` instead of being silently stripped.** The guide
  called this "THE #1 MISTAKE", which is an admission that the shape is surprising rather than a defence
  of it. The failure was silent in the worst way: unknown keys were dropped, the row saved as `values:{}`,
  the write reported success, and the loop rendered nothing. `EntrySchema` has a closed envelope, so any
  other top-level key can only be a field value.
- **`list_media_folders` unions the folder records with the paths actually in use.** A folder record
  exists only for a folder someone explicitly created, so this returned almost nothing while the library
  was fully organised — measured on a real project: 1 record against 10 folders holding assets.
- **`POST /preview` renders the STORED page when handed only an id.** It used to render exactly the object
  it was given, so `{ id, path, title }` produced an empty page and an agent asking "show me this page"
  got back just the chrome. The lookup is a fallback, so a stub naming a page that doesn't exist is still
  a 400 rather than escaping as a repo 404.
- **`inspect_source` explains stripped `data-sw-*` attributes** instead of leaving the reader to infer
  their markup was wrong.

### Changed

- **`get_guide` is section-addressable.** The import guide is 54,564 characters — it overflowed the
  tool-output cap, spilled to a file and had to be re-read, at least once per agent. The plain call now
  returns a 2,055-character overview plus a section index, with the detail behind
  `section: pages | chrome | fidelity | verify | cleanup` (or `all`). The split is by extraction, never
  classification: a section claims a block only by matching its opening phrase, so a reworded lead falls
  into the always-returned default rather than vanishing.
- **`list_media` omits inline LQIP data URIs unless `?placeholders=1`.** Measured on a real project:
  28,176 of a 76,287-character response (36%) was base64 placeholder, useful only to a UI painting a
  blur-up thumbnail.
- **A `tabs-vertical` snippet recipe**, plus guide notes on the `:is()` specificity trap and on
  lazy-loading not conflicting with screenshot capture.

### Tests

- **The deployed-instance E2E suite is green again — 19 failures to 0.** Every failure was the suite
  asserting behaviour the platform deliberately stopped having, not a product defect: registration became
  invitation-only (and `e2e-deploy.sh` still flipped a setting that no longer exists, swallowing the
  failure); local hosting is opt-in via a `local` deploy target, so publishing then fetching
  `/sites/<slug>/` 404ed on success; the block-tree renderer was removed in #250, so a `Form` block
  rendered as "Unknown"; media URLs are flat since #708-711 and published assets carry a `?v=` token; and
  the invite peek stopped masking the email on purpose in #465. A new `e2e/helpers.ts` seeds users through
  the real invite → register → accept chain rather than a bypass.

## [0.8.0] — 2026-08-01

A third neutral clone run (advancedtechcc.com) surfaced four defects, three of which were the platform
**misdescribing itself**: the feature worked, the response or the documentation did not. All three failed
SILENTLY — no error, no marker — so the agent shipped a wrong page believing it was right. This release
makes each of them tell the truth.

### Fixed

- **`get_publish_status` advertised a URL it knew was dead.** `url` was returned unconditionally, so a
  project with no deploy target reported a `<slug>.<sitesDomain>` address that 404s — sitting right next
  to `localHosting: false`. The editor gates on that flag; MCP hands the object to an agent verbatim, and
  one duly reported a clone as "published at" an address that had never served anything. `status` is now
  the headline — **`"unpublished"` whenever no deploy target exists**, however many releases were built —
  `url` is non-null ONLY for Local Hosting (the one case where this app is the thing serving), and a
  `reason` says what to do about it.
- **Dataset entries rendered ALPHABETICALLY BY ID.** Entries sort by `order ?? +Infinity`, which is right
  for the editor — drag-reorder stamps every row — but meant rows written over the API all tied at
  infinity and fell back to the id tie-break. Badges came out Advisor→Partner→Silver; nine client logos
  ran a–z. New entries are now numbered in **write order**, a full re-PUT that omits `order` keeps its
  position, and appending to a legacy unordered dataset backfills it first so the new row cannot leapfrog
  its siblings. Drag-and-drop in the editor remains the canonical way to reorder, and still wins.
- **`{{#sw-pick-entry}}` silently rendered NOTHING.** The authoring reference documented
  `{{#sw-pick-entry "dataset" id}}`, but the helper only ever accepted the entries ARRAY — a string is not
  an array, so it fell straight to the `{{else}}` branch with no error and no marker, and two team members
  vanished from a page. The reference is corrected AND the helper now also resolves a bare slug against
  the root dataset map (own-property lookup only), so both forms work.
- **`.loading` killed any authored aspect ratio.** `:is(iframe, img, video, embed, object).loading` is
  specificity **(0,1,1)** — `:is()` takes the specificity of its most specific argument — so it outranked
  every `.aspect-*` utility at (0,1,0). Folding `aspect-ratio: auto` into it (there to undo daisyUI's
  square `.loading`) made an authored `aspect-video` impossible to honour, and a 16/9 lazy embed published
  at the 150px bare-iframe default. The reset now lives in its own rule scoped
  `:not([class*="aspect-"])`, so daisyUI is still neutralised while the author's ratio wins. Measured in a
  browser: 1040×150 → **1040×585 (16 / 9)**, and a `.loading` image with no aspect utility still resets to
  auto.

### Added

- **`previewUrl` on `get_page` and `list_pages`.** There was no way for an agent to SEE a page it had just
  written unless the project happened to have a deploy target. Every page now carries a signed draft
  preview URL that needs no login and no publish. It is composed from `pagePath` — the parent-chain route
  the publisher itself uses — not the page's own last-segment `path`, so a child page resolves to
  `/services/audit` rather than `/audit`; and it is omitted entirely on an instance with no preview root,
  since those routes would not exist there.

## [0.7.0] — 2026-07-31

Cloning a second real site (ost-noack.de) with a neutral, uncoached agent surfaced six new friction
items. This release closes them — and, where the fix could be structural rather than documentary, makes
the failure impossible rather than merely described.

### Changed

- **The sticky-header modes are POSITIONAL only** (`none` / `pinned` / `hide-on-scroll`). The `shrink`
  mode is RETIRED: it condensed `#main-nav .navbar`, so it only ever worked for the stock DaisyUI recipe
  and silently did nothing on a hand-authored header while still appearing to be enabled. The platform
  now ships a scroll effect only when it is STRUCTURE-INDEPENDENT — sliding the whole landmark is,
  condensing is not, because it must know which row collapses. Any visual scroll response is authored
  against `html.sw-scrolled`; the effects guide and editor Library carry a copy-paste recipe, and the
  example project demonstrates it in its own CSS.
  A stored `shrink` STILL PARSES and behaves as `pinned` — removing it from the schema enum would make
  `WebsiteSettingsSchema.parse` reject the whole settings object, not just the header.
- **`html.sw-scrolled` and `--sw-header-h` now ship for EVERY site**, in every mode including a static
  header. The hook used to exist only for the two modes the platform styled itself, so the authors who
  most needed it — anyone with a custom header — were the ones who could not reach it. The spacer,
  anchor offset and fixed positioning stay mode-gated (a static header must not gain a phantom offset).
- **The anchor-rest sync is generic**, no longer gated on one mode: it measures the SCROLLED bar and pins
  `scroll-padding-top` to it, so a hand-authored collapse lands in-page anchors correctly too.
- **Verification tools are ordered rather than presented as peers** — `clone_audit` is step 1,
  `visual_audit` is step 2 and the terminator; `compare_to_source` / `fidelity_check` / `compare_regions`
  are marked SPECIALISED with the condition that justifies each. A real agent had used two of the five
  and ignored the others across 23+ documentation mentions.

### Added

- **`data-sw-text` / `-html` / `-href` / `-src` / `-bg` can bind `website.data.<path>`** — the site-wide
  store — and those leaves are click-to-edit in the preview. Chrome slots (mainNav / footer / bottom) are
  not a page and so had NO editable rich leaf at all: the only non-page store was `data-sw-translate`,
  which is plain text. A clone needing one editable block in a global modal had to shred it into six
  translate keys. Scoped deliberately to `website.data`, so a directive can never address
  `identity.colors` or a deploy secret.
- **`clone_audit` fails on visually CLIPPED elements**, naming the clipper and the percentage lost. This
  is the defect class every natural measurement misses: `getBoundingClientRect` returns the layout box
  whether or not an ancestor clips it, so a half-visible logo reports full size — and when the clipper is
  injected by a component runtime it is absent from the authored source too.

### Fixed

- **DaisyUI's `modal` and `tab` components are no longer shipped** in rendered-site CSS. They collided
  with the platform's own `data-sw-component="modal"` / `"tabs"` primitives, and the collision failed
  SILENTLY: the modal runtime moves the author's classes onto the body it builds, so a DaisyUI `.modal`
  landed there and is `visibility:hidden` without `.modal-open` — which the platform never adds. The
  dialog opened full-viewport with every child invisible and no console error. Excluding the components
  makes those class names inert rather than harmful. The exclusion is surgical: `table` survives.
- **The agent guide no longer claims the runtime measures `--sw-header-h`.** It does not — the token is a
  hardcoded constant sized for the stock recipe. That one false sentence produced the same
  content-behind-the-header bug twice; both author surfaces now say it must be overridden for a taller
  custom header.
- **The carousel's injected `[data-sw-part="container"]` and the edge-arrow `::before` hover overlay are
  documented** in the component catalog — both are invisible in the authored source, so restyling the
  element an author would reach for has no effect.

## [0.6.0] — 2026-07-31

Everything in this release came from one exercise: cloning a real site (business.na) end to end and
logging every place the platform fought back. Twenty-one items were recorded; twenty are fixed here and
in 0.5.0, and one was declined on purpose.

### Added

- **`inspect_source`** — measure the LIVE original: real computed styles, rects and settled markup for the
  selectors you name. The only tool that returns NUMBERS for the source, and the only way to read chrome a
  site builds in JavaScript (the stored import has none). `side:"build"` measures your clone the same way.
- **`patch_page`** and `?merge=1` for pages — send only the fields you are changing. A page write was a
  total replace, so relabelling a nav entry silently wiped `source`, `status`, `order`, `parent` and the
  `data.swImport` marker every fidelity tool depends on.
- **`delete_content_bulk({ kind, ids })`** — up to 200 ids in one call, with a per-id result, so clearing
  up after an import is not one request (and one rate-limit slot) per row.
- **Asynchronous website import.** `import_website` now returns a job id immediately and the crawl runs in
  the background; poll the new **`import_status`** tool. A real crawl takes minutes, so the call used to
  time out client-side while the import went on to succeed on the server — leaving no job id, no progress
  and no safe way to retry.
- **`renderMode: "always"`** on import — render every page, not only one that looks client-rendered. A
  server-rendered site that assembles its header or footer in JavaScript was stored pre-JS, so that chrome
  was simply missing from the import with nothing reporting it.
- **`identity.cssTokens`** — free-form CSS custom properties (`--sw-<key>`) for the values the colour,
  spacing and radius records cannot express: a gradient, an elevation ramp, a shared easing curve. Editable
  in Corporate Identity → CSS tokens, with inline validation.
- **`{{sw-stagger @index [step] [max]}}`** — the per-item reveal delay for a loop. The effects guide has
  always recommended staggering a list, and templates have no arithmetic, so the recipe could not actually
  be written. Capped by default, because a long grid whose last card waits seconds reads as a stuck page.
- **`website.cspOrigins`** — allow-list a third-party origin (a captcha, a font host, a map) without
  enabling the consent manager or planting a decoy tag.
- **`?summary=1`** on content lists — metadata only, with the omitted bodies described. A 22-page site's
  page list was 337 KB, past the tool-output ceiling, which made the first call of a clone impossible.

### Changed

- **Writes answer with a receipt** (`{ kind, id, bytes, created, changed }`) instead of echoing the stored
  entity. A settings write returned ~9 KB every time, including a one-field patch. `changed` is a real
  diff, so an empty list tells you the write was a no-op — something the echo never made obvious.
- **Author `criticalCss` now wins a specificity tie** against the platform component sheets, instead of
  silently losing every one.
- **The scroll-reveal trigger** no longer gates on a fraction of the element, so a tall section reveals on
  time; new `data-sw-offset` moves the line.
- **A named system font is honoured.** A slot set to `Verdana`/`Georgia` was silently dropped to the
  default sans — including slots the importer itself writes, so an imported site's body font came out wrong.
- **`clone_audit`** counts editable directives across the template-resolved source and every composed
  snippet, so a template- or snippet-driven page can pass the gate at all.
- **The site CSP is enforced only where the platform is at risk.** It was baked into every exported page,
  where it protects nobody the platform owns and breaks fonts, analytics and maps.
- **Dataset inference is off by default.** Guessing collections from markup shape produced junk more often
  than real datasets; an agent reading the page authors them far better. Still available behind a flag.
- **`nav.order` is retired.** One page-tree `order` governs the pages list and every menu. The editor's two
  number inputs are gone — they wrote a field that `order` always beat, so typing in them did nothing. A
  legacy value is promoted on the next save, so nothing moves.
- **The importer no longer forces a back-to-top control on.** It is enabled only when the source actually
  had one — otherwise a clone gained a control the original never had, invisible to any screenshot.
- **The imported preloader style is read from the loader itself**, not from the whole site, so a spinning
  ring is no longer imported as a progress bar.
- **The foundation import carries the source's `:root` custom properties** into `criticalCss` under their
  original names, so a declaration copied from the original still resolves.

### Fixed

- **An unknown helper is rejected at save**, naming it and its position. Rendering stays lenient, but the
  marker it emits is invisible inside an attribute — where the missing-arithmetic case landed — so nothing
  reported it.
- **The icon reference contradicted the engine**: it described a bare name as a Lucide line glyph when the
  engine resolves a filled Phosphor glyph, so following the reference got the weight wrong every time.
- **A named font slot, `page.data.swImport`, and omitted settings slots** survive the writes that used to
  drop them.

### Security

- **`identity.cssTokens` values pass a deliberately narrow gate.** Function syntax is permitted so a
  gradient can be a token at all, while anything that could leave the declaration (`;{}<>`, backslash,
  control characters, comment markers, unbalanced parentheses) or fetch a resource (`url()`, `src()`,
  `image-set()`, `element()`, `expression()`, `@import`, vendor prefixes included) is refused. Invisible
  format characters are refused too. One shared predicate backs the schema, the renderer and the importer.
- **Import jobs are readable only within their own project.** Job ids are short and sequential, so the id
  alone is never sufficient, and the polled view is built field by field so internals cannot leak.
- **A bulk delete reports only domain errors.** Anything unexpected is logged and reported generically, so
  a driver message cannot ride out through a per-id result.

## [0.5.0] — 2026-07-28

### Added

- **Animated platform background** — an admin can set a WebGL shader background that renders behind the
  whole editor **and** the login screen (served pre-auth from `GET /auth/config`, so the sign-in page is
  skinned too). The picker keeps its Speed / Intensity / interactive / overlay controls, and a new **AUTO**
  colour token makes a background track the active light/dark theme surface instead of pinning one colour.
- **Project favicon in the editor header** — the top-nav brand mark becomes the open project's favicon
  (with a generic-globe fallback), and the project selector drops the slug and is sized like the tabs. The
  selector list gained the favicon, the live URL, sorting, and more width; a clone now prefills its
  production URL.
- **Smooth in-page scrolling by default**, and the agent reference now enumerates all 15 dataset field
  types so an MCP client can pick the right one without guessing.

### Changed

- **Back-to-top moves to the bottom-right corner**, and a modal's auto-close gained the waves ripple.
- The Clone-with-AI modal was removed — clones run through the MCP `import_website` → `clone_site` tools.

### Fixed

- **A concurrent import retry no longer kills the server** — a double-send in an async route raised
  `ERR_HTTP_HEADERS_SENT` and took the process down.
- **Scroll behaviour, platform-wide** — back-to-top was dead in the preview; scrollspy missed its own
  anchor target and let a nav link pointing at a `<dialog>` or hidden element hijack the active state;
  anchors now rest flush under the shrink header.
- **Lazy `data-src` embeds keep their CSP + consent gating**, and the authoring guides now mandate the
  platform lazy attribute for iframes.

### Security

Findings from a full security review of the platform ([#754]).

- **SSRF with data exfiltration via `media/import-url`** (also reachable as the `import_image` MCP tool).
  The route's guard was a string-level check that never resolved DNS, so any hostname with a private A
  record passed — and the response was stored as a retrievable media asset, making it a read of internal
  services rather than a blind request. It now uses the connect-pinned fetcher (resolve once, reject
  private, connect to the pinned IP, re-guard every redirect hop) that the rest of the codebase already
  used. Refusal reasons are deliberately collapsed so the response can't be an internal-DNS oracle.
- **Rich-text values are sanitized before they reach the editor DOM.** A dataset value can be written by a
  lower-privileged actor (an invited client, an API key, the agent loop) and was loaded into the editor
  with the viewing admin's session; the published-site allowlist now runs there too. The editor CSP had
  been the only barrier.
- **The private-address guard now judges IPv6 forms that embed an IPv4** — NAT64, IPv4-compatible and
  6to4 could smuggle a private v4 past it.
- **Login brute-force protection gained a per-account budget** on top of the per-IP one, bounding a
  rotating-IP attack on a single account. Deliberately loose, so it is a backstop rather than a lockout an
  attacker could weaponise; failed sign-ins remain indistinguishable for known and unknown addresses.
- **Dependencies: 11 advisories (2 high) → 2 (0 high)**, with the audit exemption list emptied — all three
  entries were stale or were plain HIGHs that were simply fixable. Fixes are pinned in `pnpm.overrides` so
  the audit keeps telling the truth; the two remaining are documented with why they are unreachable.

## [0.4.0] — 2026-07-25

### Added

- **Background textures** — a new **Textures** card in the System Library opens a picker over ~396
  transparent, tileable overlay textures. Pick a background colour (a CI token or custom) and a texture,
  then copy the CSS (`background-color: var(--sw-color-*); background-image: url(...)`) onto any element,
  a page `<style>`, or the site-wide critical CSS. Because the textures are transparent, the colour shows
  through, so one asset re-tints with the brand + light/dark theme. The URL resolves in the editor
  previews **and** in exported/deployed static sites (the publish build rewrites it to a self-contained
  `_assets/_textures/` copy and materialises only the referenced textures). MCP agents can find textures
  and get the ready-to-paste CSS via a new **search_textures** tool.

## [0.3.0] — 2026-07-24

### Added

- **Copy media URLs + smarter file icons** — the File Manager now has a one-click **Copy URL** on every
  asset and, for images, a panel of copyable delivery URLs (original + responsive sizes); file rows show
  type-aware icons keyed off the real stored file kind (PDF, font, CSS, JS, video, …), independent of the
  display name. A rename doubles as the image's default **alt** text. Long filenames truncate instead of
  overflowing, and the recycle bin gained an **Empty** action.
- **Version in System Settings** — the System Settings modal header now shows the running instance version
  (from `GET /version`), with a subtle "update available" link to the release notes when a newer version
  exists.
- **Dark mode** — the editor now has a full dark theme with a **light / dark / auto** (follow-OS) switcher
  in the account (person-icon) menu. The choice is remembered per browser and applied before first paint,
  so there's no light flash on load. Every editor surface — the shell, header, panels, drawers, modals,
  forms, inputs, menus, the page/settings/dataset editors, the library, and the page-audit report — was
  given a dark treatment; the configurable brand accent colours, the code editor, and the site previews
  are unchanged. Several low-contrast labels and hints were also darkened in **light** mode for legibility.
- **Upgrade-path guard** — the app stamps the data-migration generation it has applied (in SQLite's
  `PRAGMA user_version`) and, on boot, refuses to start if the instance is *older* than the oldest
  one-time data migration this build still ships (i.e. a required migration was removed in a newer
  release and jumping straight here would silently skip it). Instead of half-migrating, it leaves the
  data untouched and serves a clear maintenance page — in the container logs (`[sitewright/upgrade]`)
  **and** in the browser (a 503 page explaining the stepped-upgrade path). No-op today (nothing has
  been removed); it only ever engages once an old migration is pruned in a future release.

### Changed

- **Short media IDs + single-folder `/media` layout** — a newly-uploaded media asset now gets a short
  6-character id and is stored/served FLAT: `/media/<slug>/<id>-<name>` in the URL and
  `<slug>/<id>-<name>` on disk, so all of a project's assets share one folder instead of one folder per
  asset, and IDs are compact. Raw non-image uploads (a `.js`, `.svg`, `.html`, etc.) are still served
  download-only; only genuine imported scripts/stylesheets/SVGs serve inline (the delivery route now
  dispatches on the asset's stored kind, not its file extension). A one-time boot migration converts
  every EXISTING asset to the flat short-id scheme — moving its on-disk binaries, re-keying its record
  (soft-deleted/recycle-bin state preserved), and rewriting every reference across live content **and**
  revision history — so a project's media is single-folder + short-id everywhere with no mixed shapes.
  The migration is idempotent, snapshots the DB before its first rewrite, and runs before the server
  accepts requests; the first boot after upgrading logs its progress under `[sitewright/migrate]`.
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
- **System Library drawer** — the code-first Library reference was consolidated from a long flat list of
  17 entries into 9 icon-led cards across three labelled groups (Reference · Assets · Builders & Studios),
  with one consistent accent colour per group. The Icons, Brand-icon and Flag galleries are now one tabbed
  "Icons & flags" browser; the effect-directive galleries fold into the SiteWright Components reference. The
  animated-background picker no longer scrolls horizontally and its controls were tidied.

### Security

- **Patched HIGH dependency advisories** — bumped or overrode dependencies flagged with HIGH-severity
  path-traversal or denial-of-service advisories: `@fastify/static` → v10 (route-guard bypass via `..`),
  plus `postcss`, `find-my-way`, `brace-expansion`, `shell-quote`, `js-yaml`, and `fast-uri`.

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

[Unreleased]: https://github.com/sitewright-cms/sitewright/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/sitewright-cms/sitewright/compare/v0.8.0...v0.9.0
[#754]: https://github.com/sitewright-cms/sitewright/pull/754
[0.8.0]: https://github.com/sitewright-cms/sitewright/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/sitewright-cms/sitewright/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/sitewright-cms/sitewright/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/sitewright-cms/sitewright/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/sitewright-cms/sitewright/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/sitewright-cms/sitewright/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/sitewright-cms/sitewright/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/sitewright-cms/sitewright/releases/tag/v0.1.0
