# Image Map runtime

The source behind `data-sw-component="image-map"`. It is a **fork of Image Map Pro 6.1.11**,
vendored under an extended licence that permits modification and integration into Sitewright.

This is not a normal `vendor-src` target. The others (`carousel`, `lightbox-smartphoto`,
`datetimepicker`) are thin first-party wiring around an MIT npm package that
`scripts/gen-vendor.mjs` pulls from `node_modules` and licence-gates. Here the whole runtime lives
in this directory, so there is no package to gate — `gen-vendor.mjs` gives this target an empty
`libs` list and a `notice` string instead, which becomes the banner embedded in the shipped JS.

```
vendor-src/image-map/
  src/          the runtime (entry point is ../image-map.entry.js)
  shared/       utilities + config import/upgrade, shared with the Studio's data model
  assets/       the stylesheet tree; assets/index.css is the root
```

Module specifiers use three aliases, mapped in the `gen-vendor.mjs` target: `imap/` → `src/`,
`imap-shared/` → `shared/`, `imap-css/` → `assets/`.

Rebuild after any change here — the generated `src/vendor/image-map-runtime.ts` is what ships:

```
pnpm --filter @sitewright/blocks gen:vendor
```

CI runs `gen:vendor:check` (regenerate + `git diff --exit-code`), so an edit here that isn't
regenerated fails the build.

## What was removed

Every one of these is asserted absent from the generated bundle by `test/image-map.test.ts`. If a
future re-vendor restores one, the suite fails rather than the customer's site.

| Removed | Why |
| --- | --- |
| `eval()` of a hotspot's `actions.script` (`run-script` click action) | Tenants supply data, never JavaScript. The published CSP is `default-src 'self'` with no `unsafe-eval`. |
| `loadCustomCode()` — injected the config's `custom_js` as a `<script>` and `custom_css` as a `<style>` into `<body>` | Same invariant. The `custom_code` config key went with it. |
| `onclick="${options.script}"` on a tooltip **Button** | The third execution path, and the easiest to miss — inline JavaScript from the config, rendered into an attribute. A tooltip button is a link. |
| `window.ImageMapPro` — instances, `subscribe`/`trigger`, and a dozen imperative helpers | A published site runs no tenant JS on the document origin, so nothing could call it. Replaced by module-scoped `src/runtime.js`. |
| `window.print = window.debug` + the mobile debug console | Upstream's entry overwrote `window.print()` on every page carrying the runtime. |
| `functionsDeprecated.js`, `hooksDeprecated.js` — the jQuery bridge | No jQuery on Sitewright sites. |
| `squaresContentParser.js`, `import-legacy.js`, and the pre-6.0.0 branch of `parseSettings` | Converters for v5 config formats that cannot reach this platform — configs come from our own Studio, schema-validated. |
| The `*-shape-*`, `open-tooltip-*`, `close-tooltip-*` and `go-to-floor` attribute aliases | Pre-6.0 spellings of the `data-sw-imap-*` API, rewritten onto the modern names at bind time. |
| babel-polyfill / `@babel/preset-env` | esbuild targets `es2018`, matching the other runtimes. This is most of the size difference. |

Result: **284 KB → ~119 KB** minified, plus ~22 KB of CSS.

## What was renamed

- CSS classes and DOM hooks: `imp-*` → `sw-imap-*` (542 tokens).
- The external trigger API: `data-imp-*` → `data-sw-imap-*`.
- Root data attributes: `data-image-map-id` / `-name` → `data-sw-imap-id` / `-name`.
- `UI/objects/impObject.js` → `mapObject.js`; the `IMPObject` base class → `MapObject`.
- The fullscreen overlay's `#sw-imap-fullscreen-container` / `#sw-imap-fullscreen-image-map` are
  now **classes**. An id can only name one element, and an id selector in a shipped stylesheet
  outranks anything a site's own CSS can write.

## What was rewritten

Upstream leaned hard on copy-paste; these collapse it without changing behaviour.

- `api/functions.js` — nine actions each repeating the same 20-line resolve-object → switch-artboard
  → queue-dispatch body. Now two helpers (`objectAction`, `mapAction`) and nine one-liners.
  **184 → 96 lines.**
- `api/html.js` — a hand-written handler pair per attribute, plus the full alias set. Now a
  seven-entry `BINDINGS` table. **591 → 150 lines.**
- `runtime.getMap(name)` — upstream open-coded
  `instances[name] || instances[Object.keys(instances)[0]]` at twenty-odd call sites and used a
  strict lookup at five more. One helper, and a single-map page now works without naming the map.
- `getImageMapWithName` / `getObjectIndexWithTitle` deleted — the first duplicated `getMap` exactly,
  the second indexed a `store.state.objects` array that no longer exists. Neither had a live call
  site; both were only named on import lines.

## Behaviour fixes

Bugs found while porting. Each is a real defect in upstream, not a platform adaptation.

- **`actionQueue.runAction` deadlocked on a rejected action.** It awaited with no `catch`, so one
  rejection left the entry un-popped and every later action queued forever behind it. Now
  `try/finally`.
- **The `data-imp-*` bindings were installed once per map.** `mapInit` fires per map, and the bind
  pass re-queried the whole document each time — on a page with two maps every external trigger
  fired twice. Binding is now idempotent, tracked in a `WeakMap` so no bookkeeping attribute lands
  in the published DOM.
- **The tooltip container was appended to `document.body`.** It now mounts inside the component
  root: several maps can coexist, the site's CSS can reach it, `deinit()` actually cleans it up
  (upstream's `root.innerHTML = ''` left it behind), and nothing of ours leaks into the host page.
- **`follow-link` synthesised a click on a shared document-level `<a>`.** It now navigates via
  `location.assign` / `window.open(…, 'noopener,noreferrer')`, and `safeLinkUrl()` allows only
  `http`, `https`, `mailto` and `tel` — an authored `javascript:` link is inert.
- **The object-list search built a `RegExp` from raw visitor input.** Typing `(` threw a
  SyntaxError and a pattern like `(a+)+$` could hang the tab. The needle is escaped now
  (`escapeRegex`), and search results are HTML-escaped before the highlight span is inserted.
- **Object titles reached the DOM as `innerHTML`** — in the object list, the artboard headings and
  text objects. All three are `textContent` now; a title is a string, not markup.

## The tooltip content builders

`tooltip_content` blocks (Heading / Paragraph / Image / Button / Video / YouTube) are assembled as
HTML strings from the config. Upstream interpolated **everything** raw, which made this the widest
hole in the runtime — and the one nearest to looking harmless. All of it is closed:

- The Button's `onclick` is gone (see above).
- `href`, `<img src>` and every `<video><source src>` go through `safeLinkUrl`; a `javascript:`
  value renders as `#`, an empty `src`, or no `<source>` element at all.
- `other.id` / `other.classes` / `other.css` are escaped before they enter a quoted attribute.
  Unescaped, `" onmouseover="…` closed the attribute and opened a new one.
- The Heading tag is allowlisted (`h1`–`h6`, `p`, `div`). `<${options.heading}>` previously let a
  config name any element, `img src=x onerror=…` included.

A config that attempts all of those at once is exercised in the scratchpad probe
(`tooltip-xss.mjs`) and each removal is asserted in `test/image-map.test.ts`.

### Still to do server-side

Two values remain deliberately unescaped, because being markup is their purpose:

- a block's `text` (rich text: bold, links), and the YouTube block's `embedCode` (an `<iframe>`);
- `UI/objects/svgSingle.js` — `element.innerHTML = options.svg.html`, an imported SVG region.

Neither is reachable by a site VISITOR; both come from the map config, which only an authenticated
editor or agent can write. They should nonetheless be sanitised, and the right layer is
**server-side**: the config passes through a Zod schema on write and the render path on read, where
`sanitize-html` is already a dependency. Sanitising once there beats shipping a sanitiser to every
browser. Do not treat these two as safe until that lands.

## Authoring contract

Documented for agents in `COMPONENT_CATALOG` (`@sitewright/schema`). In short: the marker wraps a
`<script type="application/json" data-sw-part="config">` payload, anything else inside the root is
the no-JS fallback, and page elements elsewhere drive the map through `data-sw-imap-*` attributes.

## Starter templates

Upstream's demo configs and images are **not** in this drop — its editor fetches them from the
vendor's CloudFront at runtime, which a self-hosted install cannot depend on. The five demos are
vendored locally instead:

- configs → `apps/api/assets/imagemaps/templates/<id>.json` (~940 KB total, served on demand)
- images → `apps/api/assets/imagemaps/*.jpg` (only two of the five use one; the rest are pure SVG)
- metadata → `IMAGE_MAP_TEMPLATES` in `@sitewright/schema` (small enough to bundle for a picker)

`POST /projects/:id/imagemaps/from-template` materialises one into a project: it copies the images
into that project's own media library, rewrites the config to point at them, fills in any missing
artboard id, and stores the map. So nothing a project references lives on the platform.

Upstream's 69 country/region SVG maps were deliberately **not** ported.
