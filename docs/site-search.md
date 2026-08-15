# Site search (ADR + implementation plan)

**Status:** BUILT (Phases 1–4), on branch `feat/site-search`.

| phase | what | where |
|---|---|---|
| 1 | text extraction, index + text emission per locale | `apps/api/src/publish/search-index.ts`, wired in `build.ts` |
| 2 | the `Search` component runtime (query, ranking, snippets) | `packages/blocks/src/search.ts`, registered in `components.ts` |
| 3 | `website.search.foldDiacritics`, keyboard nav, live region, size ceiling | `packages/schema/src/website.ts`, editor settings, `build.ts` |
| 4 | `{{sw-search}}` helper + component-catalog entry | `template.ts`, `component-catalog.ts` |

Shared contract (`packages/blocks/src/search-index-format.ts`) and tokenizer
(`search-tokenize.ts`) live in `@sitewright/blocks` because both the build and the browser need them.
Measurements from Phase 1 are in §10; §4 carries a correction to this document's original tokenizer
requirement.

**Requirement.** A published site needs full-text search over **whole page bodies** (not titles,
headings, or metadata only), including **phrase search**. A result is a **page**: its title, its
description, and a context snippet showing the match — not a rendered preview of the page's content.
Results must be ordered sensibly and predictably (§5). Search covers the site, so it cannot be scoped
to a dataset. Every language the platform supports must work, with no per-language code as a
precondition.

**Decision.** Build it natively: extract a per-page text index during the publish build, emit it as
static JSON beside `sitemap.xml`, and ship a marker-gated `Search` **component** that fetches the index
lazily and renders a result list. **Pagefind is rejected** — see §1.

---

## 1. Why not Pagefind

Pagefind is the strongest off-the-shelf option and solves this problem well *at a scale this platform
does not operate at*. Four findings, in descending weight:

**1.1 The scale argument does not hold.** MEASURED in Phase 1 against the five largest real projects,
by emitting the actual index (§11 has the full table). The largest — 103 pages, one locale — produces
a **162 KB gzipped first fetch** and a 94 KB deferred fetch, i.e. ~1.6 KB gzipped per page for
ranking. Pagefind's chunked index and WASM runtime exist so a 10,000-page site can search without
downloading everything; at ~100 pages the whole corpus is two lazy fetches.

(The pre-implementation estimate here was ~4.5 KB of text per page and "largest site ≈ 40 pages".
Both were wrong: real projects reach 103 pages, and the index is bigger than raw text because it
carries positions. The conclusion held, but only measurement established that.)

**1.2 It breaks sandbox containment.** The build worker runs `--network none`, no mounts, read-only
root, tmpfs scratch, artifact returned over stdout — explicitly so that "even an RCE in a future
untrusted build step is contained" (`apps/api/src/publish/worker-runner.ts:44-52`). Pagefind parses
author-controlled HTML, which *is* an untrusted build step, so it must run **inside** the worker to
preserve that property: a Rust binary bundled into the API image, spawned in a cap-dropped 768 MB
container, with `/pagefind/**` serialized through the stdout artifact. The convenient alternative —
run it in the main API process after `writeArtifact` — silently surrenders the guarantee the sandbox
was built for.

**1.3 WASM is blocked on platform-hosted origins.** Exported sites carry an **inert** `name="sw-csp"`
meta that browsers ignore (`packages/blocks/src/render.ts:417`), so a customer's own host applies no
CSP. But platform origins promote it to a real response header —
`script-src 'self' 'unsafe-inline'` (`apps/api/src/http/app.ts:6394`) — with no `'wasm-unsafe-eval'`.
Pagefind's WASM would therefore work on the deployed site and be **dead in the draft preview and on
`/sites/<slug>/`**. Fixable (the CSP is already scanned per page for form and iframe origins,
`build.ts:1232-1248`) but it is a deliberate policy widening for a dependency we do not otherwise need.

**1.4 Two smaller costs.** Pagefind emits many small chunk files, which is the worst case for the
FTP/SFTP incremental deploy path; and it cannot run in the single-page editor preview at all (it needs
the whole built site), so it would need an exception in `apps/api/test/runtime-parity.test.ts`.

**Where this design converges with Pagefind, stated honestly.** Phrase search needs positions and
context snippets need stored text, so §3.3 carries both — most of what Pagefind's index and fragment
files hold. The remaining differences are real but narrower than they were: no WASM, two files instead
of many, pure-JS extraction inside the existing sandbox. **The three decisive objections (1.2, 1.3,
1.4) are properties of Pagefind's delivery, not of the index format, so none is weakened by this
convergence.** What *is* weakened is the size argument in 1.1 — see §3.3.

**Where this design beats Pagefind:** ranking (§5). Pagefind indexes rendered HTML and must infer
importance from it. This build knows the *authored structure* — which string is the title, which is the
description, which headings exist at which level (`extractHeadings`), how deep a page sits in the tree,
whether it is in the main nav. Those are first-class fields here and guesses there.

**What Pagefind is still better at:** it ships per-language **stemmers**, so a query for a base form
also matches inflections. This design matches at token and prefix level instead (§4) — language-neutral
but recall-weaker for heavily inflected or compounding languages. Stemming stays available as an opt-in
per-locale addition; indexes are already per-locale, so it plugs in without a format change.

---

## 2. What makes the native build tractable

**Chrome exclusion comes for free.** The single most important quality decision in site search is
excluding shared nav/footer text; without it every page matches every navigation term and ranking
collapses. Pagefind needs `data-pagefind-ignore` annotations to achieve this. The build already holds
`bodyHtml`, `mainNavHtml`, `sidebarLeftHtml`, `sidebarRightHtml`, `footerHtml`, `bottomHtml` as
**separate variables** (`apps/api/src/publish/build.ts:1232`), so indexing exactly `bodyHtml` needs no
author annotation and cannot be forgotten on a page.

**Structure comes for free too.** `extractHeadings` (`apps/api/src/render/heading-outline.ts`) already
parses h1–h6 out of built static HTML — pure, dependency-free, written for the SEO audit. Fielded
ranking (§5.2) reuses it rather than adding a second heading parser.

**The index cannot drift from the site.** It is produced by the same pass that renders the HTML, from
the same strings — not by a crawler over the output, and not on a schedule. See §3.7.

**The corpus is small enough to ship whole.** That is the assumption the whole design rests on, and
§3.3 does not treat it as free — measuring it is a Phase 1 exit condition (§8).

---

## 3. The content contract

### 3.1 What is indexed

Per page, exactly:

| source | indexed | why |
|---|---|---|
| `page.title` | **yes**, own field | it is the result label; a title hit should outrank a body hit |
| `page.description` | **yes**, own field | the author's own summary (a flat field — there is no `page.seo` object, `page.ts:36`) |
| h1–h6 within the body | **yes**, own fields by level | authored importance, already extractable |
| remaining text nodes of the rendered `bodyHtml` | **yes** | the requirement |
| `alt` on `<img>` within the body | **yes**, low weight | real content, near-free |
| chrome slots — main nav, both sidebars, footer, bottom | **no** | shared site-wide; indexing them makes every page match every nav term |
| `website.head`, `website.scripts` | no | not content |
| `<script>`, `<style>`, `<svg>`, `<noscript>`, comments | no | not visible text |
| every other attribute — `class`, `href`, `data-*`, `aria-label` | no | markup, not content |

**The corpus is the RENDERED body**, which is what makes this answer the "not everything is a dataset"
objection: a `data-sw-text` directive, a `{{#each}}` over a dataset, a template, a snippet, and
hand-written HTML are all indistinguishable text by the time the index sees them. Nothing needs to be
modelled specially to be searchable.

**In-DOM but not visible at rest is still indexed** — modal bodies, inactive tab panels, off-screen
carousel slides, responsive variants like `hidden lg:flex`. The build works on HTML strings, not a
browser, so there is no computed style to filter on. This is the right default (that content is real
and reachable), but a hit can land on a page where the word is not immediately on screen.

**Pages excluded entirely:** `page.noindex` (the same predicate the sitemap uses, `build.ts:977` — a
page kept out of search engines must not surface in on-site search), `kind:'link'` placeholders (no
route), drafts (already filtered by `publishedPages`), and **raw-fidelity imports** (`page.rawHtml`,
`page.ts:63`) — see below.

**Raw-fidelity pages are not indexed until they are nativized.** DECIDED. Their markup is foreign, with
no separable chrome, so indexing it would reintroduce exactly the ranking collapse §2 avoids — on the
very pages least able to absorb it. Excluding them needs no heuristic and no extraction rules: a page
becomes searchable the moment it is nativized, because it then has a real `bodyHtml` like every other
page and flows through the ordinary path. Nothing in the index knows about imports at all.

The consequence — a partially nativized site has a partially searchable corpus — is correct but must
not be **silent**. The build reports the count of pages skipped for this reason, alongside its existing
publish warnings (`build.ts:1565`), so an author who wonders why a page is unfindable is told, rather
than left to guess.

> **Indexing and hosting the search box are orthogonal.** The `data-sw-component="search"` marker
> decides which pages *render a search box*; it has no bearing on which pages are *findable*. A site
> with one box on `/search` still needs every other page in the corpus, or the box finds nothing. So a
> page that never hosts a box is still a candidate **result** — with the single deliberate exception
> above.

### 3.2 What a result shows

| field | source |
|---|---|
| title | `page.title` |
| link | the page's route path, root-relative (e.g. `/leistungen/`) |
| description line | `page.description`, when set |
| context snippet | text around the best match, with matched terms wrapped in `<mark>` |

Plus a result count for an `aria-live` region. No thumbnail, no date. Ordering is specified in §5.

**Snippet rule:** locate the best match (for a phrase, its start; otherwise the tightest window
containing the most query terms), take ~160 characters around it, trim to token boundaries, and add an
ellipsis where truncated. Matched terms are wrapped in `<mark>`.

> **@security** — the snippet is author content. The runtime must build it with `textContent` plus
> programmatically created `<mark>` elements, **never** by assigning `innerHTML` to a string containing
> stored text. Stored text is extracted at build with tags already removed, so this is defence in
> depth, not the only barrier.

### 3.3 Index format

Phrase search needs token order, snippets need the original text, and fielded ranking (§5.2) needs to
know which field a match came from. Body postings carry ordinals; the short fields carry ordered token
lists (short enough that positions are just the array order).

```jsonc
// search-index.json — fetched on first search
{
  "v": 1,
  "lang": "de",
  "pages": [{
    "u": "/leistungen/",        // route path
    "t": "Leistungen",          // title (display + field)
    "d": "…",                   // description (display + field), optional
    "n": 412,                   // body token count (BM25 length normalization)
    "dep": 1,                   // tree depth, from the parent chain
    "nv": 1,                    // 1 when the page is in the main nav
    "g": 0,                     // duplicate-group id (§5.5)
    "f": {                      // short fields as ordered token lists
      "t":  ["leistungen"],
      "d":  ["wir", "decken", "dächer"],
      "h1": ["unsere", "leistungen"],
      "h2": ["dachdecker", "…"],
      "h4": ["…"]
    }
  }],
  "terms": { "dachdecker": [ [0, [7, 31, 96]], [3, [12]] ] }  // BODY only: term → [pageIndex, ordinals[]][]
}

// search-text.json — fetched once, only when results are first rendered
{
  "v": 1,
  "text":    [ "Wir decken Dächer …" ],   // per page: extracted plain text, whitespace-normalized
  "offsets": [ [0, 4, 11, 18] ]           // per page: body token ordinal → character offset into text[i]
}
```

- **Phrase search** = query tokens at consecutive ordinals on the same page (or consecutive positions
  within one short field).
- **Snippet** = slice `text[i]` around `offsets[i][ordinal]`.
- Ordinals and offsets are delta-encoded; page indices are integers, never repeated URLs.

> ★ **`terms` is assembled as a `Map` and serialized with `Object.fromEntries`.** Terms are author
> words, and `obj['__proto__'] = …` on a plain object does not create an own property — it mutates the
> prototype, so the term vanishes from the emitted JSON with no error anywhere. ICU segments
> `__proto__` as a single word, so a page that merely mentions it (a docs site about templating, say)
> silently lost that term. Regression-tested, and mirrored by a runtime guard in §3.6.

**Two files, deliberately.** Ranking needs only the index; snippets need the text. Splitting defers the
larger payload until there is something to show, and keeps the file *count* at two — so the objection
in §1.4 to Pagefind's many small files still stands. Sharding text per page is a later option.

**Size, MEASURED (§11).** ~1.6 KB gzipped per page for the index and ~0.9 KB for the text, so a
100-page locale costs ~160 KB gzipped on first search and ~90 KB more when results first render. The
per-locale split (§3.4) splits the download too: a visitor fetches only their own locale's pair, so a
three-locale site never pays for the other two.

### 3.4 Emission

Write both files at the site root next to `sitemap.xml` (`build.ts:1530-1537`), using the same
`writeFile(join(tmp, …))` + `bytes +=` accounting so the output cap and release manifest stay accurate.

**One pair per locale** — `search-index.json` / `search-text.json` for the default locale,
`search-index.<locale>.json` / `search-text.<locale>.json` for the rest. Routes are `/<locale>/…` and a
locale variant is its own `Page` carrying its own `locale` (`docs/i18n-content-model.md`; `localeOf` at
`build.ts:646`). A single mixed index would surface one language's results on another language's site.
The runtime picks its pair from `<html lang>`.

### 3.5 Authoring surface — a component, not a body-effect runtime

Register `['Search', { css: SEARCH_CSS, js: SEARCH_JS }]` in the `COMPONENTS` map
(`packages/blocks/src/components.ts:1199`). Components ship a per-**type** chunk (`c-Search.js`) linked
only by the pages that render one, which fits a widget used on one or two pages. `BODY_EFFECT_RUNTIMES`
would ship a site-root script for a site-wide effect — the wrong shape here.

Authored as `data-sw-component="search"` on a container the author owns.

> ★ **If a `{{sw-search}}` helper is added**, it MUST get a row in `REFERENCE_EMBEDS`
> (`components.ts:1305`). A helper emits `data-sw-component` only at *render* time, while the publish
> path scans page **sources** — so an unlisted helper ships **no chunk and no script**, and the failure
> looks like "the box renders but nothing happens", not like an error. `components.test.ts` asserts
> this for every helper.

The author's markup owns the input, the results container, and the empty/no-results states. The runtime
fills the container; it never injects chrome.

### 3.6 Runtime behaviour

- **Lazy, in two steps**: fetch `search-index.json` on first focus/input; fetch `search-text.json` only
  when results are first rendered. A visitor who never searches downloads neither.
- Same-origin `fetch` of static JSON — no WASM, no eval, no third-party origin — so it runs unchanged
  under `script-src 'self'` and requires **no CSP change**.
- Debounced query; a query under 2 characters runs nothing.
- `"quoted text"` is a phrase and acts as a **filter** — non-matching pages are excluded, not demoted.
  Unquoted terms are **tiered, not strict AND** (§5.1).
- Degrade honestly: if the index 404s (e.g. a build predating this feature), leave the box inert rather
  than rendering a broken empty state.

**Two guards Phase 1 uncovered that the runtime MUST honour:**

1. **Resolve result links against the index file's own URL**, never as root-relative paths. The build
   deliberately relativizes internal links so the artifact is portable across a domain root, a
   sub-folder and `/sites/<slug>/` (`relativizeInternalLinks`). `page.u` is stored as the canonical
   route for identity; using it directly as an `href` breaks every link in a sub-folder deployment.
2. **Look terms up with `Object.hasOwn`**, not `terms[query]`. The parsed index is a plain object, so
   a query for `constructor` or `toString` would otherwise return an inherited function and the code
   would try to iterate it as a posting list. (The build side has the mirror-image bug and is fixed —
   see §3.3.)

### 3.7 When the index is built and refreshed

The index is emitted **inside `buildSite`** (`build.ts:565`), in the same pass that renders the HTML —
not by a crawler over the output, not on a schedule, and with no separate indexing step. `buildSite`
has exactly two callers (`runner.ts:20`, `build-worker.ts:50`), so *every* build produces an index:

| build | trigger | freshness |
|---|---|---|
| **Publish** | an explicit publish | the deployed index and the deployed HTML come from the same render, so they cannot drift |
| **Draft preview** | on demand, before serving a preview page — `ensurePreviewBuild` (`app.ts:6503`) compares `previewContentVersion` (timestamp **and** row count, so a DELETE is caught) against the last built version and rebuilds when stale | as fresh as the preview itself |

`ensurePreviewBuild` re-checks a bounded 4 times so a burst of edits cannot spin, and a failed build
arms a cooldown while the previous build keeps being served. Index staleness is therefore exactly equal
to page staleness on both surfaces — there is no independent index lifecycle, and no way for search to
describe a version of the site that is not the one being served.

The cost: the index is rebuilt on every draft-preview rebuild. Extraction is a string pass over HTML
the build has already produced, so it should be small relative to rendering — **should**, not *is*:
worth timing in Phase 1 rather than assuming (§10.4).

---

## 4. Language support

Tokenization is the part that must be language-neutral, and the platform API for it already exists on
both sides of the build:

**`Intl.Segmenter(locale, { granularity: 'word' })`** — ICU word segmentation, present in this repo's
Node 22 runtime (verified) and in every current browser. Verified output:

| locale | input | segmentation |
|---|---|---|
| ja | 東京都の観光案内と地図 | 東京 / 都 / の / 観光 / 案内 / と / 地図 |
| th | ภาษาไทยไม่มีช่องว่าง | ภาษา / ไทย / ไม่มี / ช่อง / ว่าง |
| ar | مرحبا بالعالم | مرحبا / بالعالم |

Scripts with no spaces — Chinese, Japanese, Thai, Khmer — segment correctly with **no per-language
code**. A regex word-split is the fallback where `Intl.Segmenter` is unavailable.

**Normalization**, applied identically at build and query time: NFKC → `toLocaleLowerCase(locale)` →
strip combining marks (NFD + `\p{M}` removal), so `Müller` matches `Muller`. Lowercasing is
locale-aware because it must be — Turkish dotless `ı` is the standard counterexample. Diacritic folding
trades a little precision for recall and is contested where accented letters are distinct letters
(Swedish `å/ä/ö`), so it should be a **per-locale switch defaulting to fold**, not a hardcoded rule.

**Matching**: exact token, plus prefix match on the final query token (search-as-you-type). Inside a
quoted phrase, tokens match exactly and must be consecutive. All dictionary-free and
language-independent.

**Deliberately not included by default: stemming and lemmatization**, which are inherently per-language.
Because indexes are already per-locale (§3.4), a stemmer can be attached to one locale later without
changing the format or any authored markup. Whether any locale needs one is empirical (§10.1). Note
that prefix matching catches the *head* of a compound word but not the tail — a general limitation
across compounding languages that stemming only partly addresses.

**Engine.** `Intl.Segmenter` settles the hard part, so the remaining surface is an inverted index with
positions plus the scoring in §5 — small enough to own. A library (MiniSearch, Orama) would mainly buy
stemmers and fuzzy matching, so adopt one only if §11.1 shows it is needed.

> ★ **CORRECTION (Phase 2).** This section originally required that "the same tokenizer module is
> imported by both the build extractor and the runtime — one source, never a parallel copy". That is
> **not achievable** in this codebase: component runtimes ship as JS **strings** (`BANNER_JS`,
> `CART_JS`, and now `SEARCH_JS`), so the browser half cannot import the TypeScript module the build
> uses. The tokenizer is therefore **deliberately duplicated** between
> `packages/blocks/src/search-tokenize.ts` and the copy inside `SEARCH_JS`.
>
> What makes that safe is a **parity test** — `packages/blocks/test/search-parity.behavior.test.ts`
> lifts the tokenizer out of the shipped runtime string, runs both over one corpus (Latin, Japanese,
> Thai, Arabic, Devanagari, Turkish casing, decomposed and full-width forms, prototype-key words) and
> fails on any divergence. Same remedy the codebase already uses for `runtime-parity.test.ts`: where
> two paths must agree and cannot share code, a test makes drift structurally detectable.

---

## 5. Ranking and ordering

The ordering is a **sort tuple, not a single opaque float**. Tiers first, score inside a tier. That is
what makes the result order explainable to an author who asks "why is that page third?", and testable.

### 5.1 Sort key, in order

1. **Term coverage — how many distinct query terms the page matches, descending.** A page matching 3
   of 3 always ranks above one matching 2 of 3, whatever its score. This replaces strict AND: fewer
   matches still appear, below the full matches, so a three-word query never hits an empty-result cliff.
2. **Relevance score** (§5.2–§5.4), descending.
3. **URL**, lexicographic — a deterministic final tie-break. Never array or insertion order, or two
   builds of unchanged content can present results in different orders.

A quoted phrase is applied earlier and differently: it is a **filter**, not a tier. Pages without the
phrase are excluded from the result set entirely.

### 5.2 Base relevance — fielded BM25

BM25 (k1 ≈ 1.2, b ≈ 0.75) over the body, plus weighted field matches. Length normalization matters
because rendered bodies vary widely — a thin city page and a long docs page are both routine here.

| field | weight | rationale |
|---|---|---|
| title | 8 | the page's own name, and the result label |
| h1 | 5 | the page's stated subject |
| description | 3 | author-written summary |
| h2–h3 | 3 | section subjects |
| h4–h6 | 2 | sub-section subjects |
| body | 1 | baseline |
| `img alt` | 0.5 | supplementary, often decorative |

These are **starting values to be tuned in Phase 3 against real queries**, not derived constants.

### 5.3 Query-dependent multipliers

Bounded, so none can dominate the base score:

- **Phrase adjacency bonus** (unquoted queries): terms appearing adjacently score above terms scattered
  across the page. Positions make this possible.
- **Proximity**: from the smallest window containing all matched terms — ~1.0 when tight, decaying to
  ~0.9 when far apart.
- **Exact beats prefix**: a prefix-matched trailing token contributes ~0.6× an exact match, so typing
  `car` does not let *carpet* outrank a real hit on *car*.
- **Early-occurrence bonus**: small (≤1.05), for a first match near the top of the body.

### 5.4 Structural priors

The platform knows things a crawler must guess. Applied as **small bounded multipliers (roughly
0.9–1.15)**:

- **Depth** — `×0.97^depth` from the parent chain, so top-level pages edge out deep ones.
- **Main-nav membership** — `×1.10`; a page the author put in the nav is a destination.
- **Home page** — `×1.05`.

> ★ **Invariant: priors break ties, they never overturn relevance.** A prior must not let a page with
> clearly weaker textual relevance outrank a stronger one. The obvious failure mode is "the home page
> wins everything". §8 makes this an explicit test rather than a hope, and the bounds above exist to
> enforce it numerically.

### 5.5 Duplicate collapse

**Observed, not hypothetical:** the fleet-run audit found pcservice-vor-ort's source serving
byte-identical documents at `/` and `/shop/`, faithfully reproduced in the clone. Without handling,
every query returns both, and the top of the list is the same page twice.

At build, hash each page's normalized body text; pages sharing a hash form a group (`g` in §3.3). The
runtime shows only the group's canonical member — shallowest path, then nav member, then lexicographic
URL for determinism. Non-canonical members stay in the index, so the decision is reversible and no page
is silently deleted from the corpus.

### 5.6 Signals deliberately not used

- **Popularity / click-through** — a static site has no telemetry, and adding any would change what the
  platform is.
- **Recency** — pages carry no meaningful content date; `publishedAt` is a build timestamp identical
  across the whole site.
- **A manual per-page boost field** — plausible and cheap to add, but it is a schema change plus an
  authoring burden, and it should not be introduced before §10.1's measurement shows the automatic
  ranking is actually insufficient. Left to §10.5.

---

## 6. Invariants this must not break

| invariant | how this design satisfies it |
|---|---|
| Preview DOM equals published DOM | results render into an author-authored container; no injected wrapper |
| Only-used-ships | per-type component chunk, linked per page |
| Build sandbox containment | extraction is pure JS inside the existing worker; no binary, no subprocess |
| Published CSP | no WASM, no eval, same-origin fetch — policy unchanged |
| Preview/publish parity | pure JS, so the single-page preview runs it; keep it OUT of the `runtime-parity.test.ts` allowlist |
| noindex is honoured | shares the sitemap's predicate |
| Author content is never injected as HTML | snippets built via `textContent` + created `<mark>` nodes |
| Result order is deterministic | URL is the final tie-break; no reliance on array order |
| Priors never overturn relevance | bounded multipliers + an explicit test (§5.4, §8) |

---

## 7. Implementation plan

**Phase 1 — extraction + emission (no UI).** Shared tokenizer module in `packages/blocks`; index and
text assembly in `build.ts` reusing `extractHeadings`; both files per locale; duplicate-group hashing;
page exclusions (§3.1) including raw-fidelity, with the skipped-page count reported. Exit conditions:
measured index size and measured build-time cost (§8) — the latter is what the §10.3 draft-preview
decision waits on.

**Phase 2 — component.** `SEARCH_CSS` / `SEARCH_JS` in `packages/blocks/src/search.ts`; register in
`COMPONENTS`; author markup convention; optional `{{sw-search}}` helper **with** its `REFERENCE_EMBEDS`
row. Query parsing (phrases, tiering), the §5 sort tuple, snippet rendering.

**Phase 3 — quality pass.** Tune field weights and prior bounds against real queries per locale;
per-locale folding switches; optional stemming where measured to be needed; empty/no-result states;
keyboard navigation; `aria-live` count.

**Phase 4 — authoring surface.** Editor affordance and a component-catalog entry so an author can drop
a search box without hand-writing markup.

---

## 8. Test plan

Beyond unit tests on the tokenizer and the scorer:

- **Chrome exclusion, asserted structurally**: build a project whose nav contains a distinctive word
  absent from every body, then assert that word returns **zero** results. This is the test that catches
  ranking collapse.
- **Phrase search is exact**: a page containing `alpha beta` and a page containing `beta … alpha` —
  `"alpha beta"` returns only the first, while unquoted `alpha beta` returns both.
- **Coverage tiering**: a page matching all query terms outranks a page matching fewer **even when the
  partial match has a higher raw BM25 score** — the tier must dominate, not merely contribute.
- **Priors never overturn relevance**: a deep, non-nav page with a strong body match must outrank a
  shallow nav page with a weak one. The named failure mode is "the home page wins everything".
- **Determinism**: two builds of unchanged content produce identical result order for the same query.
- **Duplicate collapse**: two pages with identical body text yield one result, and it is the canonical
  URL by the §5.5 rule.
- **Snippet points at the match**: the returned window contains the matched term, and its `<mark>`
  offsets fall inside the returned text.
- **Multi-script coverage**: a CJK page and a Thai page are tokenized and findable by a mid-string
  word — the assertion that the design is language-neutral rather than Latin-only.
- **noindex page never appears** in the emitted index.
- **Raw-fidelity exclusion, both directions**: a `page.rawHtml` page is absent from the index, and the
  same page — once nativized — appears with no code path specific to imports. The second half is the
  one that matters: it asserts nativizing is the *only* thing required to make a page searchable.
- **Locale segmentation**: a term present only in one locale's page returns nothing from another
  locale's index.
- **Tokenizer parity**: identical input through the build extractor and the runtime tokenizer yields
  identical tokens — a property test, not a fixture.
- **Size is a measured number, not an estimate.** §1.1 is an upper bound from stripped HTML; §3.3 is a
  projection. Emit both files for a built fleet project and record actual bytes, raw and gzipped,
  before Phase 2 begins.
- **Build-time cost is measured**, not assumed (§3.7): index assembly as a share of total build time,
  since it runs on every draft-preview rebuild.
- **A helper, if added, ships its chunk** — covered by the existing `components.test.ts` assertion.

---

## 9. Rejected alternatives

- **Pagefind** — §1.
- **Dataset-scoped client-side filter** — searches only what is already a dataset and already on the
  page, and cannot return a list of *pages*. Rejected on the requirement.
- **Server-side search endpoint** — deploy targets are static hosts (rsync/FTP/SFTP/git). The only
  server-side code the platform ever emits is `contact.php`, and only for mail.
- **A page that renders JSON** — impossible: every page renders to `index.html` under its route
  directory (`relPathForSlug`, `build.ts:262`). The extra root files are hard-coded writes in `build.ts`.
- **Uploading `search.js` as media** — closed by design: `kind:'script'` is import-only, and a
  raw-uploaded `.js` is `kind:'file'`, deliberately not served as `text/javascript` (`app.ts:4292`).
- **Indexing on a schedule / by crawling the built output** — would introduce an index lifecycle
  separate from the build, and with it the possibility of search describing a version of the site that
  is not the one being served (§3.7).
- **A single opaque relevance float** — unexplainable and untestable; §5.1 uses an ordered tuple so the
  reason a page ranks where it does can be stated in one sentence.

---

## 10. Phase 1 measurements (2026-08-14)

Measured by emitting the real index for the five largest projects on the shared instance, and by
running the same bundles through two builds of `buildSite` — this branch and `main` — so the
build-time cost is a same-machine A/B rather than an estimate.

### Size

| project | pages | indexed | terms | first fetch (index) | deferred (text) | total gz |
|---|---|---|---|---|---|---|
| forever-living-with-elvi | 103 | 103 | 3,760 | 506.8 K → **162.1 K gz** | 502.2 K → 93.7 K gz | 255.8 K |
| example (3 locales) | 91 | 82 | 5,204 | per locale **25–29 K gz** | per locale 17–21 K gz | 140.8 K |
| rbs | 30 | 30 | 1,632 | 119.4 K → **36.2 K gz** | 126.6 K → 21.7 K gz | 57.8 K |
| kayec | 42 | 26 | 1,741 | 88.7 K → **29.1 K gz** | 69.7 K → 22.2 K gz | 51.3 K |
| burmeister | 19 | 19 | 1,361 | 56.4 K → **19.1 K gz** | 46.1 K → 15.0 K gz | 34.1 K |

**≈1.6 KB gzipped per page** for the index, ≈0.9 KB for the text. The index gzips to ~32% of raw;
the text to ~19% (prose compresses better than integer arrays).

**The per-locale split splits the download.** `example` totals 140.8 K gz across three locales, but a
visitor fetches ONE pair — 25.1 K gz on the English site. The ceiling that matters is the largest
SINGLE locale, not the sum.

**Exclusions verified**, not assumed — indexed count equals indexable count in all five:
`example` 91→82 (3 `kind:'link'` + 6 noindex), `kayec` 42→26 (15 link placeholders + 1 noindex),
the other three excluded nothing.

### Build-time cost (fastest of 7 runs)

| project | baseline | with index | delta | share |
|---|---|---|---|---|
| forever-living-with-elvi | 1781 ms | 1984 ms | +203 ms | 10.2% |
| burmeister | 304 ms | 322 ms | +18 ms | 5.6% |
| example | 1640 ms | 1668 ms | +28 ms | 1.7% |
| kayec | 387 ms | 390 ms | +2 ms | 0.6% |
| rbs | 577 ms | 572 ms | −5 ms | −0.9% (noise floor) |

Cost tracks page count, not authored bytes: the 103-page project pays 10%, everything else ≤6%. At
3 runs the noise produced an impossible negative reading, which is why these are the fastest of 7.

---

## 11. Open questions

1. **Does any locale need stemming**, or is token + prefix matching enough at this corpus size? Decides
   whether a library is adopted at all. Measure with real queries against a built project per locale.
2. **Index size ceiling** — now quantified (§10), still needs a threshold set. At ~1.6 KB gz/page for
   the first fetch, a single locale costs ~160 KB gz at 100 pages, ~320 KB at 200, ~480 KB at 300.
   The largest project today (103 pages) sits comfortably inside that. **Proposal:** warn the author
   past ~250 pages in one locale and shard the text file then; decide the exact number in Phase 3
   against a real large site rather than now.
3. **Draft-preview build cost** (§3.7) — measured (§10): +203 ms on the largest project (10.2% of
   build), ≤6% everywhere else, tracking page count rather than authored size. Ready to decide: the
   numbers argue for keeping the index in preview (search then matches the published site, which is
   the property §3.7 is built around) and revisiting only if a project makes preview rebuilds slow
   enough to feel.
4. **Manual per-page boost** (§5.6): worth a schema field, or does §5.4's automatic prior suffice?
   Decide after Phase 3 tuning, not before.

**Resolved:** results carry the description line **and** a match context snippet (§3.2); phrase search
is **in**, and the format carries the positions it requires (§3.3); ordering is the §5 sort tuple;
raw-fidelity imports are **not indexed until nativized** (§3.1), with the skipped count reported so the
gap is never silent.

**Escape hatch.** Because authored markup only ever references `data-sw-component="search"`, the engine
behind it can be swapped later — including to Pagefind, should a client bring a site large enough to
need it — without touching a single page's content.
