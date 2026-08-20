// Sitewright's code-first template renderer — Handlebars, hardened.
//
// We use Handlebars (a standard language AI agents know, and our authors know) but lock
// it down for SEMI-TRUSTED, code-authoring tenants. The TEMPLATE is author-written; the
// bound VALUES (datasets / page content) are untrusted. Handlebars HTML-escapes `{{ }}`
// values, but — like every text template language — it is NOT context-aware, so we add:
//   1. `validateTemplate`: a best-effort HTML-context scanner (ported from the earlier
//      no-eval engine) that REJECTS interpolation in the un-escapable contexts (unquoted
//      attribute, `<script>`/`<style>`, event-handler/`style` attribute, HTML comment),
//      bans `{{{ raw }}}`, and requires the `{{sw-url …}}` helper inside URL attributes.
//   2. strict runtime config: prototype access OFF (where Handlebars' RCE CVEs lived),
//      only our curated helpers, partials passed per-render (no global cross-tenant state).
//   3. a bounded compiled-template cache (so repeat renders skip the `new Function` step).
//
// The remaining hard limits (CPU/time/memory/output) are enforced by the isolated render
// worker that runs this — see apps/api/src/render. This module is pure + synchronous.
import Handlebars from 'handlebars';
import { safeUrl } from './url.js';
import { escapeAttr, escapeHtml, jsonForScript } from './escape.js';
import { renderSearchBox } from './search.js';
import { renderIconSvg, FLAG_PREFIX } from './icon-render.js';
import { resolveDirectives } from './directives.js';
import { markEntry } from './entry-marker.js';
import { sanitizeRichHtml } from './sanitize-rich.js';

/**
 * Ceiling for ONE on-page data island, in bytes of serialized JSON.
 *
 * An island is inlined into the HTML of every page that renders it and is re-sent on every visit — it
 * is never cached separately the way a fetched file is. 256 KiB is the same ceiling the platform puts
 * on other authored blobs, and it is comfortably above a page-sized list while staying far below the
 * point where a page stops being a page. Past it the right answer is a `website.dataFiles` entry,
 * which ships once and is cached.
 */
export const MAX_JSON_DATA_BYTES = 256 * 1024;

/**
 * Unwraps dataset ENTRY ENVELOPES to the flat rows a template actually sees.
 *
 * ★ `dataset.products` is an array of `{id, dataset, status, order, values:{…}}` records, but inside
 * `{{#each dataset.products}}` an author writes `{{name}}`, not `{{values.name}}` — the engine
 * flattens. Serializing the raw records would hand a script a DIFFERENT shape from the one the same
 * page renders from, and would publish the internal machinery (`status`, `order`, the storage id) into
 * the page as a bonus. An integration test through a real publish is what caught this; the shape looks
 * fine in isolation.
 *
 * Conservative: only an array whose every element carries a `values` OBJECT is unwrapped, so an
 * ordinary list that happens to have a `values` field is left alone.
 */
function flattenEntryEnvelopes(value: unknown): unknown {
  if (!Array.isArray(value) || value.length === 0) return value;
  const isEnvelope = (row: unknown): row is { values: Record<string, unknown> } =>
    typeof row === 'object' &&
    row !== null &&
    !Array.isArray(row) &&
    typeof (row as { values?: unknown }).values === 'object' &&
    (row as { values?: unknown }).values !== null &&
    !Array.isArray((row as { values?: unknown }).values);
  return value.every(isEnvelope) ? value.map((row) => (row as { values: Record<string, unknown> }).values) : value;
}

/**
 * Keeps only `fields` from each row of a list, supporting DOTTED PATHS.
 *
 * ★ Without this the helper is unusable for the case it exists for. A page-tree child row carries its
 * whole `data` object, so `pages.news._attributes.children` serializes to 1.25 MB for 488 posts — five
 * times over the island cap — while the four fields a card actually renders are a tenth of that. A
 * template cannot project an object (Handlebars has no map/pick), so without `fields=` the only way out
 * is to store a second, slimmer copy of the list in the database, which is precisely the "workaround
 * that IS the bug report" shape.
 *
 * A dotted path keeps its SHAPE — `data.date` lands at `{data:{date}}`, not `{"data.date"}` — so the
 * reading script sees the same structure the template does.
 */
function projectFields(value: unknown, fields: readonly string[]): unknown {
  if (!Array.isArray(value)) return pickPaths(value, fields);
  return value.map((row) => pickPaths(row, fields));
}

function pickPaths(row: unknown, fields: readonly string[]): unknown {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return row;
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    // ★ `description:130` — a LENGTH LIMIT per field. An island should carry what the page SHOWS and
    // no more: these cards truncate the summary to 130 characters, so shipping the full text is pure
    // waste. Measured on a real archive: 488 posts are 250 KB with full descriptions (over the cap and
    // refused) and 176 KB truncated to exactly what renders.
    // Only a trailing `:<digits>` is a limit. Anything else is part of the NAME, so a field that
    // genuinely contains a colon still resolves, and a typo behaves like any other unknown field
    // (dropped) rather than being special-cased into something surprising.
    const limitMatch = /^(.*):(\d+)$/.exec(field);
    const path = limitMatch ? limitMatch[1]! : field;
    const limit = limitMatch ? Number(limitMatch[2]) : 0;
    const hasLimit = limit > 0;
    const segs = path.split('.').filter(Boolean);
    if (segs.length === 0) continue;
    let src: unknown = row;
    let ok = true;
    for (const seg of segs) {
      if (typeof src !== 'object' || src === null || !Object.prototype.hasOwnProperty.call(src, seg)) { ok = false; break; }
      // eslint-disable-next-line security/detect-object-injection -- own-property-guarded, author-declared path
      src = (src as Record<string, unknown>)[seg];
    }
    if (!ok) continue;
    // Rebuild the path so the emitted shape mirrors the source's.
    let cursor = out;
    for (let i = 0; i < segs.length - 1; i += 1) {
      const seg = segs[i]!;
      // eslint-disable-next-line security/detect-object-injection -- own-property-guarded above
      const next = cursor[seg];
      if (typeof next !== 'object' || next === null) cursor[seg] = {};
      // eslint-disable-next-line security/detect-object-injection -- just assigned
      cursor = cursor[seg] as Record<string, unknown>;
    }
    if (hasLimit && typeof src === 'string' && src.length > limit) {
      // Break on a word boundary where there is one, so the island reads like the rendered card
      // rather than stopping mid-word.
      src = `${src.slice(0, limit).replace(/\s+\S*$/, '')}…`;
    }
    // eslint-disable-next-line security/detect-object-injection -- author-declared leaf name
    cursor[segs[segs.length - 1]!] = src;
  }
  return out;
}

/**
 * The first credential-shaped key anywhere in `value`, or `undefined`.
 *
 * NARROW ON PURPOSE. `key` and `id` are ordinary field names — the shop's own channels use `key` — so
 * matching them would break real data and teach authors to route around the guard. Only names that are
 * credentials in every codebase are matched, at any depth, on the key rather than the value (a secret
 * is recognizable by what it is called, not by what it looks like).
 */
function findSecretKey(value: unknown, depth = 0): string | undefined {
  if (depth > 8 || value === null || typeof value !== 'object') return undefined;
  const SECRET = /^(pass(word|phrase)?|secret|.*secret|api[-_]?key|access[-_]?token|refresh[-_]?token|private[-_]?key|client[-_]?secret|authorization|credentials?)$/i;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(value) && SECRET.test(k)) return k;
    const nested = findSecretKey(v, depth + 1);
    if (nested) return nested;
  }
  return undefined;
}
import {
  renderImageMapMarkup,
  resolveImageMapEmbeds,
  unknownImageMapMessage,
  type RenderImageMap,
} from './image-map-embed.js';
import { resolveFormEmbeds, resolveFormId, renderFormMarkup, unknownFormMessage, type RenderForm } from './form-embed.js';
import { addComponentBlockMarkers } from './components.js';
import { applyParallaxStaticState } from './parallax.js';
import { selectFolderAssets, projectFolderItem, type FolderKind, type RenderMedia } from './folder.js';
import { buildSwImage } from './image-helper.js';
import { classifyControlTarget, controlCurrentValue, controlOptions, isControlAs, parseSelectOptions, CONTROL_AS_VALUES } from './control.js';
import {
  type CaptchaRenderConfig, RESERVED_TRANSLATION_DEFAULTS,
  SHOP_CHOICE_FIELD_TYPES, SHOP_OPTIONS_KEY_SUFFIX, parseShopFieldOptions } from '@sitewright/schema';

/** Thrown for an unsafe interpolation context, a Handlebars compile error, or a render error. */
export class TemplateError extends Error {
  /** 1-based source position of the offending construct, when the safety scanner knows it. */
  readonly line?: number;
  readonly column?: number;
  constructor(message: string, position?: { line: number; column: number }) {
    // Surface the position IN the message too (it rides through every wrapper — preview, publish,
    // the agent — and the editor parses it for a gutter marker); the structured fields stay for
    // any consumer that wants them without re-parsing.
    super(position ? `${message} (line ${position.line}, column ${position.column})` : message);
    this.name = 'TemplateError';
    this.line = position?.line;
    this.column = position?.column;
  }
}

/** 1-based line/column OF the character at `index` within `source` — locates a validation failure
 * for the author (column is 1 + the count of non-newline chars on its line before `index`). */
function lineCol(source: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const end = Math.min(index, source.length);
  for (let k = 0; k < end; k += 1) {
    if (source.charCodeAt(k) === 10 /* \n */) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

/** The whitelisted binding namespaces a template may read. */
export interface TemplateContext {
  company?: Record<string, unknown>;
  website?: Record<string, unknown>;
  page?: Record<string, unknown>;
  /**
   * Cross-page DIRECT access by slug path — `{{ pages.services.seo._attributes.data.<key> }}` reads
   * ANOTHER page's fields. Rooted at the current page's locale HOME and walked by bare slug; a node's OWN
   * fields (title/slug/path/locale/image/description/data/children/template/code) live under `_attributes`
   * so any slug is legal and never collides. Built REFERENCED-ONLY + same-locale by `pagesContext` in
   * @sitewright/core (no payload unless the source names `pages`). A top-level author binding.
   */
  pages?: Record<string, unknown>;
  /**
   * The current page's direct PARENT as a lean read-only view — a TRANSPORT input that is merged into
   * the page object and exposed to templates as `{{ page.parent.path }}` / `{{ page.parent.data.* }}`
   * (NOT a top-level `parentPage` binding anymore). Absent for a tree root / home or an orphan. Built by
   * `parentPageView` in @sitewright/core; one level only (no nested `page.parent.parent`).
   */
  parentPage?: Record<string, unknown>;
  /** Named collections (datasets), addressable as `{{ dataset.* }}` / `{{#each dataset.* }}`. */
  dataset?: Record<string, unknown>;
  /**
   * Directly-addressable dataset entries by key: `{{ item.<dataset>.<entryId>.<field> }}` — the
   * keyed twin of the `dataset.<dataset>` array, for lookups without a loop. Built per-render (and only
   * for the datasets a source references) by `keyedDatasets` in @sitewright/core.
   */
  item?: Record<string, Record<string, unknown>>;
  /** Named partials, included via `{{> name}}`; passed per-render (no global state). */
  partials?: Record<string, string>;
  /** Auto-built navigation menus per slot — `{{#each nav.header}}…{{/each}}` (the skeleton slots + page source). */
  nav?: Record<string, unknown>;
  /** Project media (slim projection) for `{{#sw-folder "path"}}` — image galleries / file lists. */
  media?: readonly RenderMedia[];
  /** Site-wide image delivery: true → `{{sw-image}}` emits a `<picture>` with an AVIF tier (else WebP). */
  imageAvif?: boolean;
  /**
   * PREVIEW render flag for the `data-sw-*` directive pass: keep the marker attributes so the editor
   * bridge can make leaves click-to-edit. Absent on PUBLISH (markers are stripped).
   */
  preview?: boolean;
  /**
   * PREVIEW-ONLY: when true, the dataset-aware `{{#each}}` helper stamps `data-sw-entry` /
   * `data-sw-dataset` onto each iteration's own root element(s) so the editor can open that entry's
   * editor on click. Never set on publish — the loop is then byte-identical to a plain `{{#each}}`.
   */
  markEntries?: boolean;
  /**
   * PUBLIC form definitions + precomputed submission endpoints, keyed by form id — consumed by the
   * `{{sw-form}}` helper and the `data-sw-form` resolution pass (form-embed.ts). Everything here is
   * render-safe by definition (`toPublicForm` strips recipient/subject) and template-readable via
   * `{{forms.*}}`. Pure data — the context crosses the render-pool's JSON IPC. ABSENT → the surface
   * doesn't support forms ({{sw-form}} renders '', the pass is a no-op).
   */
  forms?: Record<string, RenderForm>;
  /**
   * Stored IMAGE MAPS keyed by entity id — consumed by the `{{sw-imagemap}}` helper and the
   * `data-sw-imagemap` resolution pass (image-map-embed.ts). Pure data; the context crosses the
   * render-pool's JSON IPC. ABSENT → the surface doesn't support image maps ({{sw-imagemap}}
   * renders '', the pass is a no-op) — the same posture as `forms`.
   */
  imageMaps?: Record<string, RenderImageMap>;
  /** Instance hCaptcha site key (public) — rendered into platform-routed forms that opt in. */
  /** The PROJECT's captcha provider + site key; absent → captcha-flagged forms stay inert. */
  captcha?: CaptchaRenderConfig;
  /**
   * Page-relative path to the site root (e.g. '' at the root, '../../' two levels deep; preview
   * passes ''). Used by the form-embed pass for the page-relative `contact.php` endpoint.
   */
  siteRoot?: string;
}


// `data-src`/`data-bg` mirror `src`/`background`: the lazy-load runtime copies them into
// `src` / `background-image`, so an INTERPOLATED value must be scheme-fixed by {{sw-url …}} or a
// safe literal prefix (the data behind it — page.data, dataset entries — is editable by any
// project member, lower-trust than the template author). `data-full` likewise becomes a lightbox
// item's `href` (the full-size image) when the runtime wraps a bare <img> — same single-URL rule.
// `data-srcset` is intentionally absent — and so is plain `srcset` (neither is in this set): both
// carry a comma-separated `url descriptor` list that doesn't fit the single-URL prefix rule, and a
// bad scheme there only fails an image fetch (never executes). Don't add `srcset`/`data-srcset`
// here without first reworking the gate to validate each list entry.
const URL_ATTRS = new Set([
  'href', 'src', 'action', 'formaction', 'poster', 'cite', 'background', 'xlink:href', 'data-src', 'data-bg', 'data-full',
]);
/** Max distinct compiled templates kept in memory (LRU-ish; bounds the worker's heap). */
const COMPILE_CACHE_LIMIT = 200;

// ---------------------------------------------------------------- save-time validation
/**
 * Best-effort HTML-context check over a template's literal text (treating `{{ … }}` as
 * holes). Throws {@link TemplateError} if an OUTPUT mustache sits in a context a single
 * HTML-escaper cannot make safe, if `{{{ raw }}}` is used, or if a URL attribute uses a
 * bare interpolation instead of the `{{sw-url …}}` helper.
 */
/**
 * The HTML5 landmark elements the page SKELETON owns — it emits each one once, with a fixed unique
 * id, around the matching slot or the page body (see `slotLandmark` / `<main id="page-content">` in
 * render.ts). Author content (page sources, skeleton slots, snippets, templates) must NOT use these
 * elements, or the document would carry duplicate landmarks. Each entry's message names the element,
 * says why it's reserved, and suggests the neutral replacement.
 */
const SKELETON_LANDMARKS = new Map<string, string>([
  ['nav', 'the skeleton owns the navigation landmark <nav id="main-nav">. For the SITE-WIDE header shown on every page, put your <div>/<ul> markup in the website.mainNav setting (put_content("settings",…)); for a nav group inside ONE page, use a <div>/<ul> here'],
  ['main', 'the skeleton already wraps every page body in <main id="page-content"> — use a <div> or <section> for your content'],
  ['footer', 'the skeleton owns the footer landmark <footer id="footer">. For the SITE-WIDE footer shown on every page, put your <div> markup in the website.footer setting (put_content("settings",…)) — NOT a page or template; for footer-style content inside ONE page, use a <div> here'],
  ['aside', 'the skeleton owns the sidebar landmarks <aside id="sidebar-left"> / <aside id="sidebar-right">. For a SITE-WIDE sidebar, put your <div> markup in the website.sidebarLeft / website.sidebarRight setting; for an aside inside ONE page, use a <div> here'],
]);

/**
 * Find the first SKELETON-OWNED landmark element (`<nav>`/`<main>`/`<footer>`/`<aside>`) in a fragment —
 * the platform wraps each chrome slot + the page body in one, so authored slot/page content must not
 * repeat them. Returns the tag + a fix hint, or null. Comment + `<script>`/`<style>` bodies are ignored
 * (a `<footer>` there is not a real element). This is the landmark-only subset of {@link validateTemplate}
 * — used to reject landmarks in chrome SLOTS at save WITHOUT also rejecting their (separately handled)
 * scripts, so the lenient-preview / strict-publish flow for other slot issues is preserved.
 */
export function findSkeletonLandmark(source: string): { tag: string; hint: string } | null {
  const stripped = source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '');
  const m = /<(nav|main|footer|aside)(?=[\s/>])/i.exec(stripped);
  if (!m) return null;
  const tag = (m[1] as string).toLowerCase();
  return { tag, hint: SKELETON_LANDMARKS.get(tag) ?? '' };
}

/**
 * Verdict cache for {@link validateTemplate}: `null` = passed, a {@link TemplateError} = the rejection
 * to re-throw. The scan is a pure function of the source string, so replaying its verdict is equivalent
 * to re-running it — and a REJECTION is cached too, so a hit can never silently become a pass.
 *
 * ★ Why: the scan runs on every render, plus once per partial per render. A collection page renders the
 * same source once per entry, so an 800-route build re-scanned identical strings until this was ~8% of
 * total build time (CPU profile, after the clean-css memoization).
 */
const validateCache = new Map<string, TemplateError | null>();
const VALIDATE_CACHE_LIMIT = 300;
/**
 * Byte ceiling for the cache. The KEY is the whole template source (up to 256 KB each), so an
 * entry-count limit alone would let 300 large pages retain ~76 MB in a process whose whole memory
 * budget is derived from a container limit. Evicting on bytes keeps the ceiling knowable.
 */
const VALIDATE_CACHE_MAX_BYTES = 4 * 1024 * 1024;

/** Cache counters for tests: `scans` = real validations run, `size` = live entries, `bytes` = retained. */
export function validateTemplateStats(): { scans: number; size: number; bytes: number } {
  return { scans: validateScans, size: validateCache.size, bytes: validateCacheBytes };
}
let validateScans = 0;
let validateCacheBytes = 0;

export function validateTemplate(source: string): void {
  const cached = validateCache.get(source);
  if (cached !== undefined) {
    if (cached) throw cached;
    return;
  }
  let verdict: TemplateError | null = null;
  try {
    validateTemplateUncached(source);
  } catch (err) {
    // Only OUR rejection is a cacheable verdict. Anything else (an unexpected runtime fault) is not a
    // judgement about the source, so it propagates uncached rather than being pinned for every later call.
    if (!(err instanceof TemplateError)) throw err;
    verdict = err;
  }
  // A source larger than the whole budget is never cached — decide that BEFORE evicting, or the loop
  // empties the cache to make room for something it then declines to store.
  if (source.length > VALIDATE_CACHE_MAX_BYTES) {
    if (verdict) throw verdict;
    return;
  }
  // FIFO eviction on BOTH bounds — entry count and retained bytes.
  while (validateCache.size >= VALIDATE_CACHE_LIMIT || validateCacheBytes + source.length > VALIDATE_CACHE_MAX_BYTES) {
    const oldest = validateCache.keys().next();
    if (oldest.done) break; // nothing left to evict: this source alone exceeds the budget
    validateCacheBytes -= oldest.value.length;
    validateCache.delete(oldest.value);
  }
  validateCache.set(source, verdict);
  validateCacheBytes += source.length;
  if (verdict) throw verdict;
}

function validateTemplateUncached(source: string): void {
  validateScans += 1;
  type Mode = 'body' | 'comment' | 'rawtext' | 'tag';
  let mode: Mode = 'body';
  let rawCloser = '';
  let sub: 'name' | 'preAttr' | 'attrName' | 'afterName' | 'preValue' | 'value' = 'name';
  let attrName = '';
  let attrNameStart = 0; // source index of the current attribute name's first char (for precise reporting)
  let quote: '"' | "'" | '' = '';
  // The literal value content before the current point (capped) — used to decide whether
  // a URL attribute's scheme is already fixed by a safe prefix.
  let valuePrefix = '';
  let pendingRaw = '';

  function reject(reason: string, atIndex: number = i): never {
    throw new TemplateError(
      `unsafe template: ${reason}. Bind values only in element text or QUOTED attributes; ` +
        'use the {{sw-url …}} helper for href/src; no <script>, inline on* handlers, {{{ raw }}}, ' +
        'or interpolation in an unquoted attribute, style/<style>, or an HTML comment.',
      lineCol(source, atIndex),
    );
  }

  // Reject an inline event-handler attribute (no tenant JS) once its name is complete — pointing at
  // the attribute name itself (not the `=`/`>` that closed it).
  function finishAttrName(): void {
    if (attrName.startsWith('on')) reject(`an inline "${attrName}" event-handler attribute`, attrNameStart);
  }

  // Classify the current context for an output mustache, throwing if it is unsafe.
  function checkOutput(inner: string): void {
    if (mode === 'comment' || mode === 'rawtext') reject(`an interpolation in a ${mode === 'comment' ? 'comment' : rawCloser === '</script' ? '<script>' : '<style>'} block`);
    if (mode === 'tag') {
      if (sub !== 'value') reject('an interpolation in an unquoted attribute or tag structure');
      if (quote === '') reject('an interpolation in an unquoted attribute value');
      // Only inline event handlers stay forbidden (they execute JS). A QUOTED `style` attribute is
      // allowed: the value is HTML-escaped (no tag/attribute breakout) and inline CSS can't run script,
      // so per-row values like style="color:{{color}}" are fine. (A `<style>` ELEMENT body stays blocked
      // above — that content isn't escaped.)
      if (attrName.startsWith('on')) reject(`an interpolation in the "${attrName}" event-handler attribute`);
      if (URL_ATTRS.has(attrName)) {
        const isUrlHelper = /^sw-url(\s|$)/.test(inner);
        if (valuePrefix === '') {
          // The interpolation is the whole value → it must be sanitized by {{sw-url …}}.
          if (!isUrlHelper) reject(`a bare value in the URL attribute "${attrName}" (use {{sw-url …}})`);
        } else if (!/^(#|\/(?!\/)|https?:\/\/|mailto:|tel:)/i.test(valuePrefix)) {
          // A literal prefix only fixes the scheme when it's a known-inert one: /, #, http(s)://, or the
          // non-executable mailto:/tel: schemes. `j{{x}}` (→ javascript:) and `//{{x}}` stay rejected.
          reject(`an interpolation in URL attribute "${attrName}" whose scheme is not fixed by a safe prefix`);
        }
      }
    }
  }

  function endTag(): Mode {
    const next: Mode = pendingRaw ? 'rawtext' : 'body';
    rawCloser = pendingRaw ? `</${pendingRaw}` : '';
    pendingRaw = '';
    return next;
  }

  let i = 0;
  while (i < source.length) {
    if (source.startsWith('{{{', i)) reject('raw output {{{ }}} is not allowed');
    if (source.startsWith('{{', i)) {
      const close = source.indexOf('}}', i + 2);
      if (close === -1) throw new TemplateError('unclosed "{{" tag', lineCol(source, i));
      const inner = source.slice(i + 2, close).trim();
      // Structural/comment/partial/inverse mustaches do not directly emit an escaped value.
      if (!/^[#/!>^]|^else\b/.test(inner)) checkOutput(inner);
      i = close + 2;
      continue;
    }
    // eslint-disable-next-line security/detect-object-injection -- i is a bounded scan index
    const ch = source[i] as string;
    if (mode === 'comment') {
      if (ch === '>' && source.startsWith('-->', i - 2)) mode = 'body';
    } else if (mode === 'rawtext') {
      if (ch === '<' && source.slice(i, i + rawCloser.length).toLowerCase() === rawCloser) mode = 'body';
    } else if (mode === 'body') {
      if (source.startsWith('<!--', i)) {
        mode = 'comment';
        i += 4;
        continue;
      }
      if (ch === '<') {
        const m = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(source.slice(i));
        if (m) {
          const name = (m[1] as string).toLowerCase();
          const isClose = source[i + 1] === '/';
          // Author JS is allowed: a <script> element's body is scanned as RAWTEXT (like <style>, see
          // pendingRaw below) so its `<`/tags don't confuse the parser, and an {{interpolation}} inside
          // it is rejected (no Handlebars-into-JS injection — author JS reads server data from data-*
          // attributes). Author scripts run only on the ISOLATED published origin (the user's own server
          // / the <slug> subdomain / the sandboxed preview) — never the cookie-bearing app origin.
          // Skeleton-owned landmark elements (<nav>/<main>/<footer>/<aside>) are declared once by
          // the platform with a unique id around each slot/the page body — author content must not
          // repeat them. The message names the element + the reserved id(s) and suggests the fix.
          const landmarkHint = isClose ? undefined : SKELETON_LANDMARKS.get(name);
          if (landmarkHint !== undefined) {
            throw new TemplateError(`unsafe template: a <${name}> element is not allowed — ${landmarkHint}.`, lineCol(source, i));
          }
          mode = 'tag';
          sub = 'preAttr';
          attrName = '';
          quote = '';
          pendingRaw = !isClose && (name === 'style' || name === 'script') ? name : '';
          i += m[0].length;
          continue;
        }
      }
    } else if (sub === 'value') {
      if (quote === '' ? /[\s>]/.test(ch) : ch === quote) {
        if (ch === '>') mode = endTag();
        else sub = 'preAttr';
        attrName = '';
        quote = '';
      } else if (valuePrefix.length < 16) {
        valuePrefix += ch; // accumulate the literal prefix (capped) for the URL-scheme check
      }
    } else {
      if (ch === '>') {
        finishAttrName();
        mode = endTag();
      } else if (ch === '/') {
        /* self-closing slash */
      } else if (/\s/.test(ch)) {
        if (sub === 'attrName') {
          finishAttrName();
          sub = 'afterName';
        }
      } else if (ch === '=') {
        if (sub === 'attrName' || sub === 'afterName') {
          finishAttrName();
          sub = 'preValue';
        }
      } else if (sub === 'preValue') {
        valuePrefix = '';
        if (ch === '"' || ch === "'") {
          sub = 'value';
          quote = ch;
        } else {
          sub = 'value';
          quote = '';
        }
      } else if (sub === 'preAttr' || sub === 'afterName') {
        sub = 'attrName';
        attrName = ch.toLowerCase();
        attrNameStart = i; // first char of this attribute name
      } else if (sub === 'attrName') {
        attrName += ch.toLowerCase();
      }
    }
    i += 1;
  }
}

// ---------------------------------------------------------------- hardened Handlebars
/** Two-digit zero-pad. */
function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * A bound value read as a NUMBER, or `undefined` when it is not one — the shared coercion behind every
 * arithmetic / windowing helper.
 *
 * Numeric STRINGS count, because that is how numbers actually arrive: a `page.data` key, a
 * `{{sw-control … as="number"}}` binding and a dataset field are all JSON text as often as they are
 * numbers, and `{{sw-limit posts page.data.per_page}}` has to work either way.
 *
 * Everything else — including `true`, `null`, an object, and the EMPTY string — is `undefined`, i.e.
 * "absent". That distinction is the point: absent lets each helper choose its own safe fallback (0 for a
 * sum, "leave the list alone" for a count) instead of every missing value silently becoming 0.
 *
 * ★ A Handlebars helper is always handed its options object as the last argument, so an omitted
 * optional parameter arrives here as that object → `undefined` → the default. That is why no helper
 * below needs to count its arguments.
 */
function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * The result of any arithmetic helper: a finite number, or 0.
 *
 * ★ NEVER NaN or Infinity. These values are written into attributes (`data-sw-delay`, a page number in
 * an href), where the literal text `NaN` is invisible garbage that nothing reports — the same failure
 * mode that made `{{multiply @index 90}}` so expensive to find. 0 is wrong too, but it is wrong
 * VISIBLY, and it can't corrupt a URL.
 */
function finiteNumber(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/** A windowing helper's input: the array itself, or an empty list for anything that is not one. */
function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** An integer COUNT/INDEX argument, or `undefined` when absent — `Math.trunc` so "2.5" can't half-slice. */
function asCount(value: unknown): number | undefined {
  const n = asNumber(value);
  return n === undefined ? undefined : Math.trunc(n);
}

/**
 * A non-empty translated string for a RESERVED catalog key, read from the pre-resolved per-locale map
 * `website.t` (own-property + proto-guarded). Empty/missing → '' so the caller's fallback chain applies.
 * The mini-shop cart helpers use this to localize their built-in labels from `website.translations`
 * (the reserved `cart.*` keys — see @sitewright/schema's RESERVED_TRANSLATION_GROUPS for the full set)
 * without a per-page hash override.
 */
function reservedTr(root: { website?: { t?: Record<string, unknown> } }, key: string): string {
  const t = root.website?.t;
  if (t && Object.prototype.hasOwnProperty.call(t, key)) {
    // eslint-disable-next-line security/detect-object-injection -- own-property guarded (hasOwnProperty); key is a reserved cart_* literal or a shop.<identifier> derived key, never a bare proto name
    const v = t[key];
    if (typeof v === 'string' && v !== '') return v;
  }
  return '';
}

/**
 * Builds an isolated Handlebars instance with ONLY our curated helpers. Tenants use these;
 * they cannot register their own (that would be the arbitrary-code surface). Add helpers
 * here to extend the language — this is the `{{ date }}` / `{{ url }}` extensibility point.
 */
function createInstance(): typeof Handlebars {
  const hb = Handlebars.create();
  // Drop the built-in {{log}} helper — it writes to stdout (an info-disclosure path for
  // bound values). The remaining built-ins (if/unless/each/with/lookup) are pure logic.
  // Our content helpers are ALL `sw-`-prefixed so they never shadow a dataset FIELD of the
  // same bare name (a field `url`/`date`/`icon` is read plainly as {{url}}/{{date}}/{{icon}}).
  hb.unregisterHelper('log');
  // GRACEFUL unknown-helper handling. Handlebars THROWS "Missing helper: x" when an inline call
  // `{{x arg}}` (or `{{x k=v}}`) names a helper that isn't registered — a mistyped or retired helper
  // (e.g. the old {{sw-embed}}) would otherwise 400 the WHOLE page render over a single authoring typo,
  // which forced manual recovery in the clone/author loop. Instead render a visible, inert HTML comment
  // so the rest of the page renders and the mistake is DISCOVERABLE in the output. The name is stripped
  // to an identifier so it can't break out of the comment. A BARE `{{missingField}}` (no params) is left
  // untouched → renders empty, exactly as `strict:false` already does (so optional dataset/page fields
  // that are undefined still render nothing, not a comment). validateTemplate still runs at save time.
  hb.registerHelper('helperMissing', function helperMissing(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as { name?: string; hash?: Record<string, unknown> } | undefined;
    const calledAsHelper = args.length > 1 || (options?.hash != null && Object.keys(options.hash).length > 0);
    if (!calledAsHelper) return undefined; // bare {{missingField}} → empty (unchanged non-strict behaviour)
    const name = String(options?.name ?? '').replace(/[^\w.:-]/g, '').slice(0, 64);
    return new Handlebars.SafeString(`<!-- sw:unknown-helper ${name} -->`);
  });
  // {{sw-url page.link}} → scheme-sanitized URL (blocks javascript:/data:/protocol-relative).
  hb.registerHelper('sw-url', (value: unknown) => safeUrl(typeof value === 'string' ? value : ''));
  // {{sw-date page.publishedAt}} → UTC YYYY-MM-DD; {{sw-date x "iso"}} → full ISO; {{sw-date x "YYYY"}} → year.
  // A NOW value — the literal "now" or a bare {{sw-date}} (no first arg) — renders the CURRENT date, so
  // {{sw-date "now" "YYYY"}} always emits the current year (e.g. a © line). "" if the value is unparseable.
  // Named LOCALE formats — `medium` (21. Aug. 2026 / 21 Aug 2026), `long` (21. August 2026), `short`
  // (21.08.2026 / 21/08/2026). Added because the only outputs were ISO, so a German page printed
  // `2026-01-13` at its reader and every project worked around it by storing a second, pre-formatted
  // label field per locale. The locale is the PAGE's (publish + preview both project `page.locale`),
  // overridable with `locale='de'`. Rendered through Intl with a fixed UTC time zone so the same
  // instant never renders as two different days depending on where the render ran.
  const NAMED_DATE_FORMATS: Readonly<Record<string, Intl.DateTimeFormatOptions>> = {
    short: { day: '2-digit', month: '2-digit', year: 'numeric' },
    medium: { day: 'numeric', month: 'short', year: 'numeric' },
    long: { day: 'numeric', month: 'long', year: 'numeric' },
  };
  const formatDateFor = (d: Date, style: string, locale: string): string => {
    const opts = NAMED_DATE_FORMATS[style as keyof typeof NAMED_DATE_FORMATS];
    // A bare `en` resolves to en-US, which is MONTH-first. Every other locale the platform ships is
    // day-first, so a bilingual site would print "21. August 2026" beside "August 21, 2026" and read as
    // broken. Bare `en` therefore means en-GB; a US site asks for it explicitly with locale='en-US'.
    if (locale === 'en') locale = 'en-GB';
    try {
      return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(d);
    } catch {
      // An unknown/malformed locale tag must not take the page down with it.
      return new Intl.DateTimeFormat('en', { ...opts, timeZone: 'UTC' }).format(d);
    }
  };
  hb.registerHelper('sw-date', (value: unknown, format?: unknown, options?: unknown) => {
    // A bare {{sw-date}} hands the Handlebars options object as the FIRST arg; treat that (or the explicit
    // "now" sentinel) as "current date". A missing/unparseable field value stays blank (→ '') — it must NOT
    // become today, so `{{sw-date page.nope}}` still renders nothing.
    const isOptions = (v: unknown): boolean => typeof v === 'object' && v !== null && !(v instanceof Date) && 'hash' in v;
    const wantsNow = value === 'now' || isOptions(value);
    // Narrow before new Date(): new Date(null) coerces null→0→the 1970 epoch, so a null/boolean/other
    // field must fall through to Invalid Date → '' (a null date field renders blank, not "1970-01-01").
    const d = wantsNow
      ? new Date()
      : value instanceof Date
        ? value
        : typeof value === 'string' || typeof value === 'number'
          ? new Date(value)
          : new Date(NaN);
    if (Number.isNaN(d.getTime())) return '';
    const fmt = typeof format === 'string' ? format : '';
    if (fmt === 'iso') return d.toISOString();
    if (fmt === 'YYYY') return String(d.getUTCFullYear());
    if (Object.prototype.hasOwnProperty.call(NAMED_DATE_FORMATS, fmt)) {
      // `{{sw-date x 'medium'}}` puts the options object in the THIRD slot; `{{sw-date x}}` puts it in
      // the second, which is why the ISO paths above never look at it.
      const opts = (typeof format === 'string' ? options : format) as Handlebars.HelperOptions | undefined;
      const hash = (opts?.hash ?? {}) as Record<string, unknown>;
      const root = (opts?.data?.root ?? {}) as { page?: { locale?: unknown } };
      const locale =
        (typeof hash.locale === 'string' && hash.locale) || (typeof root.page?.locale === 'string' && root.page.locale) || 'en';
      return formatDateFor(d, fmt, locale);
    }
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  });
  // {{sw-icon "arrow-right" "h-5 w-5"}} → inline a built-in icon as an <svg>. A bare name is a
  // Lucide (stroke) glyph; a `brand:<slug>` name is a brand/social logo (a single FILL path,
  // currentColor so it themes with text color). The markup comes ONLY from the trusted icon maps
  // (unknown name → empty, NEVER user input) and the class string is attribute-escaped — so this
  // emits a SafeString (raw SVG) without ever reflecting tenant markup. Author-supplied DATA is just
  // the icon NAME (a map key) + a class list. Use in element context. A field literally named `icon`
  // (e.g. a card's emoji) is read plainly as `{{icon}}`, never shadowed by this.
  // {{sw-icon "name" "css-class"}} → inline an icon as an <svg>. "name" is a PHOSPHOR icon; an optional
  // ":weight" suffix picks the weight (thin|light|regular|bold|fill|duotone), DEFAULT fill —
  // {{sw-icon "gear"}} is a filled gear, {{sw-icon "gear:bold"}} a bold one. `brand:<slug>` is a
  // simple-icons filled logo (unchanged), and `flag:<cc>` a FULL-COLOR country flag (`flag:de-circle`
  // for the round one) — ONE helper for every set the platform ships, so an author picks an icon by
  // NAME and never has to know which library it came from. RESOLUTION per name: Phosphor(name) →
  // Lucide-name→Phosphor alias → Lucide OUTLINE fallback — so a familiar/agent-written Lucide name
  // still renders (as its Phosphor twin where mapped, else a Lucide outline), never an invisible 0×0
  // gap. The emitted <svg> carries size-less class HOOKS `sw-icon sw-icon-<name> sw-icon-<weight>`
  // (weight is `lucide` for a fallback, `sw-icon-flag-<cc> sw-icon-flag-rect|circle` for a flag) so a
  // site can style by name/weight while authored + CSS-owned sizing still wins. Bodies come ONLY from
  // the trusted build-time icon maps, never tenant markup; author DATA is just the name + class (both
  // attribute-escaped). viewBox is 256 for Phosphor, 24 for brand + the Lucide fallback, the flag
  // set's own for a flag.
  // {{sw-search placeholder="Search the site" limit=8}} → the standard search box. The author may
  // instead hand-write [data-sw-part="input"] + [data-sw-part="results"] to own the layout.
  hb.registerHelper('sw-search', function swSearch(options?: Handlebars.HelperOptions) {
    const hash = (options && options.hash) as Record<string, unknown> | undefined;
    const str = (k: string): string | undefined => (typeof hash?.[k] === 'string' ? (hash[k] as string) : undefined);
    const num = (k: string): number | undefined => (typeof hash?.[k] === 'number' ? (hash[k] as number) : undefined);
    return new Handlebars.SafeString(
      renderSearchBox({
        placeholder: str('placeholder'),
        label: str('label'),
        empty: str('empty'),
        class: str('class'),
        limit: num('limit'),
      }),
    );
  });
  hb.registerHelper('sw-icon', (name: unknown, cls?: unknown) =>
    new Handlebars.SafeString(typeof name === 'string' ? renderIconSvg(name, typeof cls === 'string' ? cls : undefined) : ''),
  );
  // {{sw-flag "de" "h-4"}} → a FULL-COLOR country flag. A bare alpha-2 code is the rectangular 4:3 flag;
  // a `<code>-circle` name is the circular variant. This is the helper to WRITE for a flag, and the only
  // one that works for a DYNAMIC code without building a string (sw-concat can, but a map is the better shape), so
  // `{{sw-flag (lookup @root.website.data.locale_flags locale)}}` over a stored `{ en: "gb" }` map is
  // the language-switcher idiom, and nothing can express it through a prefixed name.
  //
  // {{sw-icon "flag:de"}} renders the same thing, because `flag:<code>` is how a flag is spelled as an
  // ICON NAME — which is what the icon PICKER stores and therefore what a dataset `icon` field, an
  // image-map hotspot or a nav placeholder carries. The two are one renderer: same artwork, same
  // accessible name, same per-shape default size. Reach for sw-flag when writing a flag by hand;
  // `flag:` exists so a picked NAME can be a flag.
  hb.registerHelper('sw-flag', (name: unknown, cls?: unknown) =>
    new Handlebars.SafeString(
      typeof name === 'string' ? renderIconSvg(`${FLAG_PREFIX}${name}`, typeof cls === 'string' ? cls : undefined) : '',
    ),
  );
  // {{sw-label}} inside {{#each nav.*}} → the nav item's render-ready label. A link placeholder's
  // rich name (HTML + icon helpers) and a page title are both pre-rendered into `labelHtml` by
  // `decorateNav`; this emits it as a SafeString (the markup is already validated/escaped there), so
  // templates avoid the forbidden `{{{`. Falls back to the escaped plain `label`. Use in element
  // context, e.g. `<a ...>{{sw-label}}</a>`.
  hb.registerHelper('sw-label', function swLabel(this: unknown) {
    const item = (this ?? {}) as { labelHtml?: unknown; label?: unknown };
    if (typeof item.labelHtml === 'string') return new Handlebars.SafeString(item.labelHtml);
    return new Handlebars.SafeString(Handlebars.escapeExpression(typeof item.label === 'string' ? item.label : ''));
  });
  // {{sw-html entry.answer}} → emit a stored HTML value (a dataset `richtext` field, nested page.data
  // HTML, …) as sanitized HTML. This is the ONE way a template renders stored markup — `{{{ raw }}}` is
  // banned, and the `data-sw-html` directive only binds top-level page.data. The value passes
  // `sanitizeRichHtml` (the exact sanitizer behind the data-sw-html sink — broad safe HTML incl.
  // https-sandboxed iframe embeds; script/on*/data-* always stripped), so lower-trust content (dataset
  // entries are member-editable) never reaches the page unsanitized. Non-strings render nothing. Use in
  // element context. (Renamed from {{sw-rich}} for clarity — it accepts any safe HTML, not just rich text.)
  hb.registerHelper('sw-html', (value: unknown) => new Handlebars.SafeString(typeof value === 'string' ? sanitizeRichHtml(value) : ''));
  // Pick ONE dataset entry by id (the id a {{sw-control as="dataset-item"}} stores), defaulting to the
  // FIRST when the selection is unset/unknown — lets a Widget (e.g. the hero slider) render a chosen
  // config out of several. DUAL-MODE:
  //   • BLOCK — {{#sw-pick-entry dataset.<slug> @root.page.data.<key>}}…{{/sw-pick-entry}} — renders the
  //     block with the entry's VALUES as context (+ @entry={id,dataset,status}); empty dataset → the
  //     {{else}}/nothing. In PREVIEW (`root.markEntries`) it MARKS the block's own root element(s) with
  //     data-sw-entry / data-sw-dataset (using the envelope's id+dataset) so a click in the editor opens
  //     THAT entry — the same affordance the dataset-aware {{#each}} gives each row.
  //   • SUBEXPRESSION — {{#with (sw-pick-entry …)}} — returns the entry's VALUES (no marker).
  // Accepts entry envelopes ({id,values}) OR a plain values array (uses the element as-is) so it's
  // robust across render + test contexts.
  hb.registerHelper('sw-pick-entry', function swPickEntry(entries: unknown, selectedId: unknown, options?: Handlebars.HelperOptions) {
    const block = options && typeof options.fn === 'function' ? options : undefined;
    // A STRING first argument is the dataset SLUG — {{#sw-pick-entry "team" "t1_ada"}}. The authoring
    // reference documented exactly this form for a long time while the helper only ever accepted the
    // entries ARRAY, so following the docs produced an empty non-array, fell straight through to the
    // {{else}} branch below, and rendered NOTHING — no error, no marker comment, no clue. Resolving the
    // slug against the root `dataset` map makes the documented form work rather than merely correcting the
    // doc. Own-property lookup only, so `__proto__`/`constructor` can never name a dataset.
    if (typeof entries === 'string') {
      const all = (options?.data?.root as { dataset?: Record<string, unknown> } | undefined)?.dataset;
      const resolved =
        all && typeof all === 'object' && Object.prototype.hasOwnProperty.call(all, entries)
          ? all[entries]
          : undefined;
      entries = Array.isArray(resolved) ? resolved : [];
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return block ? (typeof block.inverse === 'function' ? block.inverse(undefined) : '') : undefined;
    }
    const byId =
      typeof selectedId === 'string' && selectedId
        ? entries.find((e) => e && typeof e === 'object' && (e as { id?: unknown }).id === selectedId)
        : undefined;
    const chosen = (byId ?? entries[0]) as { id?: unknown; dataset?: unknown; status?: unknown; values?: unknown };
    const values = chosen && typeof chosen === 'object' && 'values' in chosen ? chosen.values : chosen;
    if (!block) return values; // subexpression mode → just the values
    const frame = Handlebars.createFrame(block.data ?? {});
    if (chosen && typeof chosen === 'object') frame.entry = { id: chosen.id, dataset: chosen.dataset, status: chosen.status };
    const body = block.fn(values, { data: frame });
    const root = (block.data?.root ?? {}) as { markEntries?: boolean };
    // PREVIEW: mark so a click opens this entry's editor (publish has markEntries=false → untouched).
    if (root.markEntries && typeof chosen?.id === 'string' && typeof chosen?.dataset === 'string') {
      return new Handlebars.SafeString(markEntry(body, chosen.id, chosen.dataset));
    }
    return new Handlebars.SafeString(body);
  });
  // {{sw-stagger @index 90 [max]}} → the reveal DELAY in ms for item `@index` of a loop: `index * step`,
  // capped at `max` (default 600ms). The effects guide has always recommended staggering a list by an
  // increasing `data-sw-delay`, but inside `{{#each}}` there was no way to DERIVE one — the engine had no
  // arithmetic at all, so `{{multiply @index 90}}` emitted the literal text `<!-- sw:unknown-helper multiply -->`
  // into the attribute. General arithmetic exists now (below), but this stays the helper to reach for: the
  // CAP is the part authors get wrong, and `{{sw-min (sw-mul @index 90) 600}}` is the same thing spelled worse.
  //
  // The CAP is the point of the third argument: without it a 40-item grid delays its last card by 3.6s, so
  // the "animation" reads as a broken page. Everything past the cap simply lands together.
  hb.registerHelper('sw-stagger', (index: unknown, step: unknown, max: unknown) => {
    const i = typeof index === 'number' && Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
    const s = typeof step === 'number' && Number.isFinite(step) ? Math.max(0, Math.floor(step)) : 100;
    // A Handlebars helper called with fewer args still receives the options hash last, so a non-number
    // `max` means "not supplied" → the default cap.
    const cap = typeof max === 'number' && Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 600;
    return Math.min(i * s, cap);
  });
  // {{sw-truncate text 80}} → clip to N chars with an ellipsis.
  hb.registerHelper('sw-truncate', (value: unknown, max: unknown) => {
    const s = typeof value === 'string' ? value : '';
    const n = typeof max === 'number' && Number.isFinite(max) ? max : 100;
    return s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s;
  });

  // ── LIST WINDOWING. `{{#each}}` is all-or-nothing, which made a PAGINATED ARCHIVE inexpressible: a
  // news section with 800+ posts as child pages had no way to render "posts 10-19" on page 2. These
  // return a windowed ARRAY, so they are written in subexpression position and compose with each other
  // and with everything `{{#each}}` already does — including the dataset-entry flattening, because a
  // window of entries is still an array of entries.
  //
  // ★ Shared rule: a MISSING count leaves the list intact instead of emptying it. `{{sw-limit posts
  // page.data.per_page}}` with `per_page` unset renders an obviously-too-long list — visibly wrong, and
  // fixable. Had it rendered nothing, the page would read as "no posts yet" and the author would have no
  // way to tell a configuration slip from an empty section. An EXPLICIT 0 still means 0.

  // {{#each (sw-slice list 10 20)}} → the [start, end) window, exactly Array.prototype.slice: the one
  // meaning the name already has for every author and every agent. A NEGATIVE index counts from the end,
  // so "the latest three" is {{#each (sw-slice posts -3)}}. Omit `end` to run to the end of the list.
  hb.registerHelper('sw-slice', (value: unknown, start: unknown, end: unknown) => {
    const list = asList(value);
    const from = asCount(start) ?? 0;
    const to = asCount(end);
    return to === undefined ? list.slice(from) : list.slice(from, to);
  });
  // {{#each (sw-limit list 6)}} → the first N. {{#each (sw-offset list 6)}} → everything AFTER the first
  // N. Compose them for an arbitrary window — `(sw-limit (sw-offset posts 20) 10)` is items 21-30 — or
  // reach for {{sw-paginate}}, which is that same window written as a page number.
  //
  // ★ Unlike {{sw-slice}}, a NEGATIVE count here is 0, not an index from the end: these two take a
  // COUNT ("how many"), where slice takes a POSITION. `(sw-offset list -3)` is therefore the whole list,
  // not "all but the last three" — write that as `(sw-slice list 0 -3)`.
  hb.registerHelper('sw-limit', (value: unknown, count: unknown) => {
    const list = asList(value);
    const n = asCount(count);
    if (n === undefined) return list; // ★ absent count → intact, never empty
    return list.slice(0, Math.max(0, n));
  });
  hb.registerHelper('sw-offset', (value: unknown, count: unknown) => {
    const list = asList(value);
    const n = asCount(count);
    if (n === undefined) return list; // ★ absent count → intact, never empty
    return list.slice(Math.max(0, n));
  });
  // {{#each (sw-paginate list page.data.page_no 10)}} → page N of `per`-sized pages, 1-BASED, matching
  // the page number an author writes and a visitor reads. Page 0/negative/missing is page 1; a page past
  // the end is empty (which is what lets an archive template be shared by every page of the archive).
  //
  // Named `sw-paginate`, not `sw-page`, because `page` is a top-level BINDING namespace — `{{sw-page …}}`
  // next to `{{page.title}}` reads like a typo for one of them.
  hb.registerHelper('sw-paginate', (value: unknown, pageNo: unknown, per: unknown) => {
    const list = asList(value);
    const size = asCount(per);
    if (size === undefined || size <= 0) return list; // ★ absent/nonsense size → intact, never empty
    const n = Math.max(1, asCount(pageNo) ?? 1);
    const from = (n - 1) * size;
    return list.slice(from, from + size);
  });
  // {{sw-length list}} → how many. An array's/string's length, an object's own-key count, else 0 — so
  // "{{sw-length posts}} articles" and a page COUNT (below) never render NaN or an empty gap. Pair it
  // with {{page.childrenTotal}}, which reports the true child count even when the listing was capped.
  hb.registerHelper('sw-length', function swLength(this: unknown, ...args: unknown[]) {
    // Handlebars always appends its options object, so a bare {{sw-length}} has length 1 (no value).
    const value = args.length > 1 ? args[0] : undefined;
    if (Array.isArray(value) || typeof value === 'string') return value.length;
    if (typeof value === 'object' && value !== null) return Object.keys(value).length;
    return 0;
  });

  // ── DATA SHAPING. `sw-slice`/`sw-limit` window a list by POSITION. That is all the engine could do,
  // and "the events that are still ahead" is not a position: a homepage "Coming up" column rendered the
  // first four rows by insertion order — seven months in the past — because no helper could compare a
  // date at all (`sw-lt`/`sw-gt` are number-only, and ISO dates are strings). These four add the
  // predicate/ordering/grouping layer, on the same rules as the windowing helpers: they take a list, they
  // return a NEW list, and anything that is not a list is an empty list rather than junk.

  /** A row's readable shape: a dataset ENTRY exposes its fields under `values`, a plain object is itself. */
  const rowOf = (row: unknown): Record<string, unknown> =>
    isEntry(row) ? (row.values as Record<string, unknown>) : typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {};
  /** Own-property field read — a field name can never reach `__proto__`/`constructor`. */
  const fieldOf = (row: unknown, field: unknown): unknown => {
    if (typeof field !== 'string' || field === '') return undefined;
    const o = rowOf(row);
    return Object.prototype.hasOwnProperty.call(o, field) ? o[field] : undefined;
  };
  /** ONE definition of "missing", shared by the comparator and by sw-sort's ordering guarantee. A blank
   *  dataset field arrives as '' and a JSON default as null; treating only `undefined` as absent put
   *  those rows FIRST on a descending sort, which reads as data loss. */
  const isMissing = (v: unknown): boolean => v === undefined || v === null || v === '';
  /** An ISO date or date-time: `2026-08-21`, `2026-08-21T09:00`, `…T09:00:00.000Z`. */
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
  /**
   * Compare two values the way the AUTHOR means them, not the way they happen to be typed. Both numeric
   * → numeric (so 9 < 10, which a string compare gets wrong); otherwise string order, which is exactly
   * right for the ISO dates the platform stores. Missing values sort LAST rather than scattering.
   *
   * ★ Two ISO values are compared at the COARSER of their two granularities. The platform stores both
   * `2026-08-21` and `2026-08-21T09:00`, and comparing those as raw strings makes the SHORTER one always
   * sort first — so `gte` against a date-only bound silently accepted every time on that day while `lt`
   * silently rejected them all, and which you got depended on how the value happened to be typed. Taking
   * the shorter operand's granularity makes "a date-only side means the whole day" a stated rule instead
   * of an accident. Ordinary text is untouched — this is gated on the ISO shape, so `apple` and `apples`
   * still differ.
   */
  const compareValues = (a: unknown, b: unknown): number => {
    if (isMissing(a)) return isMissing(b) ? 0 : 1;
    if (isMissing(b)) return -1;
    const na = asNumber(a);
    const nb = asNumber(b);
    if (na !== undefined && nb !== undefined) return na === nb ? 0 : na < nb ? -1 : 1;
    let sa = String(a);
    let sb = String(b);
    if (ISO_DATE_RE.test(sa) && ISO_DATE_RE.test(sb) && sa.length !== sb.length) {
      const n = Math.min(sa.length, sb.length);
      sa = sa.slice(0, n);
      sb = sb.slice(0, n);
    }
    return sa === sb ? 0 : sa < sb ? -1 : 1;
  };
  /** The literal `now` resolves to today's ISO DATE — so "still ahead" is day-granular and anything
   *  happening today still counts as ahead for the whole day (which is what a calendar means). The
   *  coarser-granularity rule above is what makes that hold against stored times. */
  const resolveOperand = (v: unknown): unknown => (v === 'now' ? new Date().toISOString().slice(0, 10) : v);

  // {{#each (sw-where dataset.events 'starts' 'gte' 'now')}} → the rows whose FIELD satisfies OP against
  // VALUE. Ops: eq ne lt gt lte gte has (substring / list membership). The op may be omitted for `eq`,
  // which is the common case. An UNKNOWN op matches NOTHING — a filter that silently degraded to "match
  // everything" would look like it worked while showing the unfiltered list.
  const WHERE_OPS: Readonly<Record<string, (a: unknown, b: unknown) => boolean>> = {
    eq: (a, b) => compareValues(a, b) === 0,
    ne: (a, b) => compareValues(a, b) !== 0,
    lt: (a, b) => a !== undefined && compareValues(a, b) < 0,
    gt: (a, b) => a !== undefined && compareValues(a, b) > 0,
    lte: (a, b) => a !== undefined && compareValues(a, b) <= 0,
    gte: (a, b) => a !== undefined && compareValues(a, b) >= 0,
    has: (a, b) =>
      Array.isArray(a)
        ? a.some((x) => compareValues(x, b) === 0)
        : typeof a === 'string' && typeof b === 'string' && a.includes(b),
  };
  hb.registerHelper('sw-where', function swWhere(this: unknown, ...args: unknown[]) {
    const rest = args.slice(0, -1);
    const [list, field, a, b] = rest;
    // Three operands = (field, op, value); two = (field, value) with an implied `eq`.
    const op = rest.length >= 4 ? String(a) : 'eq';
    const want = resolveOperand(rest.length >= 4 ? b : a);
    const test = Object.prototype.hasOwnProperty.call(WHERE_OPS, op) ? WHERE_OPS[op] : undefined;
    if (!test) return [];
    return asList(list).filter((row) => test(fieldOf(row, field), want));
  });

  // {{#each (sw-sort page.children 'data.date' 'desc')}} → a NEW list ordered by FIELD. Never mutates the
  // input: the same list is rendered again elsewhere on the page, and an in-place sort would silently
  // reorder it there too.
  hb.registerHelper('sw-sort', function swSort(this: unknown, ...args: unknown[]) {
    const [list, field, dir] = args.slice(0, -1);
    const sign = String(dir ?? 'asc').toLowerCase() === 'desc' ? -1 : 1;
    return [...asList(list)].sort((x, y) => {
      const c = compareValues(fieldOf(x, field), fieldOf(y, field));
      // Missing values stay LAST in both directions — flipping them to the front on `desc` would read
      // as data loss rather than as ordering.
      if (c === 0) return 0;
      const xm = isMissing(fieldOf(x, field));
      const ym = isMissing(fieldOf(y, field));
      if (xm !== ym) return xm ? 1 : -1;
      return c * sign;
    });
  });

  // {{#each (sw-group dataset.events 'month')}}<h3>{{key}}</h3>{{#each items}}…{{/each}}{{/each}}
  // → [{key, items}] in FIRST-SEEN order, so the caller controls ordering by sorting first. Rows with no
  // value for the field are dropped rather than collected under an empty key.
  hb.registerHelper('sw-group', function swGroup(this: unknown, ...args: unknown[]) {
    const [list, field] = args.slice(0, -1);
    const out: Array<{ key: string; items: unknown[] }> = [];
    const index = new Map<string, { key: string; items: unknown[] }>();
    for (const row of asList(list)) {
      const raw = fieldOf(row, field);
      if (raw === undefined || raw === null || raw === '') continue;
      const key = String(raw);
      let bucket = index.get(key);
      if (!bucket) {
        bucket = { key, items: [] };
        index.set(key, bucket);
        out.push(bucket);
      }
      bucket.items.push(row);
    }
    return out;
  });

  // {{#each (sw-split product.sizes ',')}} → a delimited FIELD as a list.
  //
  // A dataset holds a size run, a tag list or a set of options as one text field, because that is what
  // an author can type and edit in a cell. Without this there is no way to loop it: the template can
  // print the whole string or nothing, so a shop that wanted one "add to cart" button PER SIZE had to
  // choose between a single button that orders an unknown size and 180 rows in the dataset. The
  // separator defaults to a comma; each piece is trimmed and empties are dropped, so trailing
  // separators and "a, b,, c" behave.
  hb.registerHelper('sw-split', (value: unknown, separator?: unknown) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    const sep = typeof separator === 'string' && separator !== '' ? separator : ',';
    return value.split(sep).map((part) => part.trim()).filter((part) => part !== '');
  });

  // {{sw-includes page.data.tags 'sport'}} → membership in a list, or substring in a string. Returns a
  // BOOLEAN for {{#if}}. Anything else is false.
  hb.registerHelper('sw-includes', (haystack: unknown, needle: unknown) => {
    if (Array.isArray(haystack)) return haystack.some((x) => compareValues(x, needle) === 0);
    return typeof haystack === 'string' && typeof needle === 'string' && haystack.includes(needle);
  });

  // ── STRING BUILDING. Handlebars has no `+`, so an author could not build "/news-" + n. The observed
  // outcome was never a compile error — it was a HARD-CODED literal: a paginated archive shipped
  // href="/news-{{sw-add n 1}}", a ROOT path that no locale prefix reaches, so every translated archive
  // page linked into the default-language one.

  // {{sw-concat '/news-' (sw-add page.data.page_no 1)}} → the arguments joined. null/undefined contribute
  // NOTHING (rather than the text "undefined", which is what a bare {{a}}{{b}} would give you in an
  // attribute). Returns a plain string → HTML-escaped, so it is safe in text and attribute position.
  hb.registerHelper('sw-concat', function swConcat(this: unknown, ...args: unknown[]) {
    return args
      .slice(0, -1)
      .filter((v) => v !== null && v !== undefined)
      .map((v) => String(v))
      .join('');
  });

  // {{sw-default page.data.subtitle website.data.tagline 'Untitled'}} → the first argument that is
  // actually present. Absence is null/undefined/'' ONLY: 0 and false are values a template means to
  // print, and the JS `||` idiom that swallows them is the bug this helper exists to avoid.
  hb.registerHelper('sw-default', function swDefault(this: unknown, ...args: unknown[]) {
    for (const v of args.slice(0, -1)) if (v !== null && v !== undefined && v !== '') return v;
    return '';
  });

  // {{sw-join page.data.tags ' · '}} → a list as text, separator defaulting to ", ". Reading a FIELD off
  // each row is a NAMED argument: {{sw-join dataset.staff ', ' field='name'}}.
  // ★ field is named, not positional, because sw-where/sw-sort/sw-group all put the field SECOND. An
  // author carrying that habit over writes {{sw-join staff 'name' ', '}}; positionally that reads 'name'
  // as the separator and ', ' as the field, no row has a ', ' field, every value is dropped and the
  // helper renders EMPTY — a silent blank where a staff list should be.
  hb.registerHelper('sw-join', function swJoin(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const [list, sep] = args.slice(0, -1);
    const hash = (options?.hash ?? {}) as Record<string, unknown>;
    const field = typeof hash.field === 'string' ? hash.field : undefined;
    const separator = typeof sep === 'string' ? sep : ', ';
    return asList(list)
      .map((row) => (field === undefined ? row : fieldOf(row, field)))
      .filter((v) => v !== null && v !== undefined && String(v) !== '')
      .map((v) => String(v))
      .join(separator);
  });

  // ── ARITHMETIC. The engine had none, and said so in its own docs; {{sw-stagger}} exists because one
  // multiplication was needed badly enough to ship as a purpose-built helper. Pagination needs several
  // more (an offset from a page number, a page COUNT from a total), so the general operations now exist.
  // Every one of them returns a finite number or 0 — see finiteNumber() for why that matters.
  //
  // Two-argument operations, table-driven so they cannot drift apart in their coercion or guards.
  // Division and remainder by zero are 0, not Infinity/NaN.
  const BINARY_MATH: Readonly<Record<string, (a: number, b: number) => number>> = {
    'sw-add': (a, b) => a + b,
    'sw-sub': (a, b) => a - b,
    'sw-mul': (a, b) => a * b,
    'sw-div': (a, b) => (b === 0 ? 0 : a / b),
    'sw-mod': (a, b) => (b === 0 ? 0 : a % b),
  };
  for (const [name, op] of Object.entries(BINARY_MATH)) {
    hb.registerHelper(name, (a: unknown, b: unknown) => finiteNumber(op(asNumber(a) ?? 0, asNumber(b) ?? 0)));
  }
  // Numeric COMPARISON — `{{#if (sw-lt page.data.page_no total_pages)}}` is what makes a "next page" link
  // conditional, and there was no `<` of any kind (only the strict eq/ne). Deliberately NUMBER-only: a
  // non-numeric operand is FALSE rather than falling back to string order, where "10" < "9" is true and
  // the answer would depend on how the value happened to be typed.
  const COMPARISONS: Readonly<Record<string, (a: number, b: number) => boolean>> = {
    'sw-lt': (a, b) => a < b,
    'sw-gt': (a, b) => a > b,
    'sw-lte': (a, b) => a <= b,
    'sw-gte': (a, b) => a >= b,
  };
  for (const [name, op] of Object.entries(COMPARISONS)) {
    hb.registerHelper(name, (a: unknown, b: unknown) => {
      const x = asNumber(a);
      const y = asNumber(b);
      return x !== undefined && y !== undefined && op(x, y);
    });
  }
  // {{sw-ceil (sw-div total 10)}} → the number of pages. Rounding is three helpers rather than a hash
  // option because "round up" is what an author searches the reference for.
  hb.registerHelper('sw-ceil', (value: unknown) => finiteNumber(Math.ceil(asNumber(value) ?? 0)));
  hb.registerHelper('sw-floor', (value: unknown) => finiteNumber(Math.floor(asNumber(value) ?? 0)));
  // {{sw-round x [decimals]}} → nearest integer, or to N decimals (capped at 10 — past that the scaling
  // factor stops being exact and the extra digits are noise).
  hb.registerHelper('sw-round', (value: unknown, decimals: unknown) => {
    const n = asNumber(value) ?? 0;
    const places = Math.min(Math.max(asCount(decimals) ?? 0, 0), 10);
    const factor = 10 ** places;
    return finiteNumber(Math.round(n * factor) / factor);
  });
  // {{sw-min a b …}} / {{sw-max a b …}} → across any number of arguments; non-numeric ones are ignored,
  // and no numeric argument at all is 0 (Math.min() alone would be Infinity).
  for (const [name, pick] of [
    ['sw-min', Math.min],
    ['sw-max', Math.max],
  ] as const) {
    hb.registerHelper(name, function swMinMax(this: unknown, ...args: unknown[]) {
      // Drop the trailing options object; whatever remains are the operands.
      const nums = args.slice(0, -1).map(asNumber).filter((n): n is number => n !== undefined);
      return nums.length === 0 ? 0 : finiteNumber(pick(...nums));
    });
  }
  // {{#unless (sw-blank value)}} → does `value` have NO visible content? Returns a BOOLEAN. True when the
  // value is missing/non-string, OR when stripping its HTML tags (and decoding &nbsp;) leaves no
  // non-whitespace text AND it embeds no media element (img/svg/iframe/video/picture/audio/hr) that would
  // render on its own. Lets a template OMIT a wrapper around an empty optional richtext field — e.g. the
  // hero-slider hides a slide's caption pill when the caption is blank, including the
  // `<p></p>`/`<p><br></p>`/whitespace residue a cleared WYSIWYG editor can leave behind (which a plain
  // `{{#if}}` would treat as truthy). Resolved server-side (publish + preview), so no empty box ever ships.
  hb.registerHelper('sw-blank', (value: unknown) => {
    if (typeof value !== 'string') return true;
    // A media/void element renders with no text of its own → not blank. The `[\s/>]` boundary (vs `\b`)
    // keeps `<svg-icon>` — a no-output custom element — from counting as the `svg` media tag.
    if (/<(?:img|svg|iframe|video|picture|audio|hr)[\s/>]/i.test(value)) return false;
    // Strip tags with a LINEAR single pass — `/<[^>]*>/g` backtracks quadratically on adversarial input
    // (many unclosed `<`), and `value` is a member-editable richtext field, so a crafted caption could
    // otherwise stall the render worker (DoS).
    let text = '';
    let inTag = false;
    for (let i = 0; i < value.length; i += 1) {
      const ch = value[i];
      if (ch === '<') inTag = true;
      else if (ch === '>') inTag = false;
      else if (!inTag) text += ch;
    }
    return text.replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, ' ').trim() === '';
  });
  // {{#if (eq a b)}} / {{#if (ne a b)}} — strict (===) equality / inequality SUBEXPRESSION helpers, for
  // conditional rendering without a custom helper (Handlebars has no built-in comparison). Loose by design
  // about types: numbers/strings compare by value via ===, so compare like-with-like. Returns a boolean,
  // so it composes inside {{#if}}/{{#unless}} and attribute interpolation (e.g. class="{{#if (eq path
  // page.path)}}active{{/if}}"). A render that references a NON-registered helper hard-fails (HTTP 400);
  // these cover the common comparison need so authors don't reach for one that doesn't exist.
  hb.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  hb.registerHelper('ne', (a: unknown, b: unknown) => a !== b);
  // {{sw-json value}} → the value pretty-printed as JSON (2-space indent) — object/array/string/number/bool.
  // For INSPECTING/DEBUGGING data (e.g. <pre>{{sw-json page.data}}</pre>) — the output is HTML-escaped, so it
  // is NOT valid for a <script type="application/ld+json"> block (the quotes become &quot;); use it to read,
  // not to emit machine-parsed JSON. Prefixed like every other CONTENT helper so it can never shadow a
  // dataset field literally named `json` (that field stays readable as {{json}}).
  // The return is a plain string → HTML-ESCAPED, so it's safe in any text/attribute position. `{{sw-json}}`
  // with no value (or an unstringifiable/circular value) → ''; output is length-capped so a large object
  // can't blow up the response. Compose with {{#each}} etc. as usual.
  hb.registerHelper('sw-json', function swJson(this: unknown, ...args: unknown[]) {
    // Handlebars always appends the options object, so a bare `{{sw-json}}` has length 1 (no value).
    const value = args.length > 1 ? args[0] : undefined;
    if (value === undefined) return '';
    try {
      const out = JSON.stringify(value, null, 2);
      if (typeof out !== 'string') return ''; // e.g. a function/symbol → JSON.stringify returns undefined
      return out.length > 100_000 ? `${out.slice(0, 100_000)}\n…(truncated)` : out;
    } catch {
      return ''; // circular / non-serializable
    }
  });
  // {{sw-json-data value id="products"}} → the value as an INERT on-page data island:
  //   <script type="application/json" id="products">[…]</script>
  //
  // The counterpart to {{sw-json}} above: that one HTML-ESCAPES for a human to read in a <pre>; this
  // one emits a machine-parseable island for a script to read with
  // `JSON.parse(document.getElementById('products').textContent)`.
  //
  // ★ It emits the WHOLE ELEMENT and cannot be written any other way. `checkOutput` rejects every
  // interpolation inside a <script> body (mode 'rawtext'), because a script body is raw text where a
  // value could close the tag — so `<script>{{sw-json x}}</script>` is a template error by design.
  // Emitting the element from the helper is what keeps that rule intact: the payload goes through
  // `jsonForScript`, so `</script>`, `<!--` and U+2028/9 are unrepresentable in the output.
  //
  // type="application/json" is INERT — the browser never executes it. The helper deliberately offers no
  // way to emit `text/javascript`, and never assigns to a global: a data island is data.
  // `type="application/ld+json"` is allowed for author-written structured data, which is the one other
  // thing a <script> data island is legitimately used for.
  //
  // REFUSALS (each emits an HTML COMMENT naming the reason — visible in view-source and in the build
  // output, never a silent empty element):
  //   · the AMBIENT namespaces — `website`, `settings`, `pages`, `dataset` as a whole — are refused by
  //     IDENTITY (===) against the render root. Two reasons, both load-bearing: `website` carries the
  //     form endpoint, which the platform deliberately keeps OUT of markup as spam protection
  //     (window.__swf), and `pages` is the self-referential page tree whose own JSON.stringify has
  //     already thrown in production. Pass a projection — `dataset.products`, `page.data.tiles` — not
  //     the namespace.
  //   · a key that LOOKS like a credential anywhere in the value (password/secret/apiKey/token/…).
  //     Narrow on purpose: a bare `key` is a legitimate field name (the shop's channels use it), so
  //     only credential-shaped names are matched.
  //   · anything unserializable (cycle/function/BigInt), and anything over MAX_JSON_DATA_BYTES.
  hb.registerHelper('sw-json-data', function swJsonData(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const hash = (options?.hash ?? {}) as Record<string, unknown>;
    const value = args.length > 1 ? args[0] : undefined;
    const refuse = (why: string): Handlebars.SafeString =>
      new Handlebars.SafeString(`<!-- sw-json-data: ${escapeHtml(why)} -->`);

    if (value === undefined) return refuse('no value given');

    const id = typeof hash.id === 'string' ? hash.id : '';
    // The id is how the reading script finds the island, so it must be a plain token — not a place to
    // smuggle attribute syntax.
    if (!/^[A-Za-z][\w-]{0,63}$/.test(id)) return refuse('id= must be a name like "products" (letter, then letters/digits/-/_)');

    const type = typeof hash.type === 'string' ? hash.type : 'application/json';
    if (type !== 'application/json' && type !== 'application/ld+json') {
      return refuse('type= must be application/json or application/ld+json');
    }

    const root = (options.data?.root ?? {}) as Record<string, unknown>;
    for (const ambient of ['website', 'settings', 'pages', 'dataset'] as const) {
      // eslint-disable-next-line security/detect-object-injection -- fixed literal list
      if (value === root[ambient]) {
        return refuse(`refusing to serialize the whole "${ambient}" namespace — pass a projection like dataset.products`);
      }
    }

    // Serialize what the TEMPLATE sees, not the storage record — see flattenEntryEnvelopes.
    let payload = flattenEntryEnvelopes(value);
    // `fields="title,path,data.date"` narrows each row BEFORE the size check, which is the only reason
    // a page-tree listing fits in an island at all.
    const rawFields = typeof hash.fields === 'string' ? hash.fields : '';
    const fields = rawFields.split(',').map((f) => f.trim()).filter(Boolean);
    if (fields.length > 0) payload = projectFields(payload, fields);

    const secret = findSecretKey(payload);
    if (secret) return refuse(`refusing a value containing a credential-shaped key ("${secret}")`);

    const json = jsonForScript(payload);
    if (json === undefined) return refuse('value is not serializable (circular, function, or BigInt)');
    if (json.length > MAX_JSON_DATA_BYTES) {
      // ★ LOUD, never truncated. Half a data island is worse than none: the reading script gets valid
      // JSON that is quietly missing rows, which looks like missing content rather than a size problem.
      return refuse(`value is ${json.length} bytes, over the ${MAX_JSON_DATA_BYTES}-byte limit — emit it as a data file (website.dataFiles) and fetch it instead`);
    }
    return new Handlebars.SafeString(`<script type="${type}" id="${escapeAttr(id)}">${json}</script>`);
  });
  // {{sw-translate "key"}} / {{sw-translate "key" default="…"}} → the localized string for the current
  // page locale, from the project translation catalog (website.translations). The render projection
  // pre-resolves the catalog per page-locale into `website.t` (a flat key→string map, defaultLocale
  // fallback already applied — see @sitewright/core resolveTranslations), so this is a trivial lookup.
  // A missing/empty key falls back to `default=` then to ''. Output is ESCAPED (plain-string return),
  // so it's safe in text or attribute position. Pure render-time — works in publish + preview (incl.
  // the script-blocked preview). This REPLACES the old `{{lookup (lookup website.data.strings …) …}}`.
  hb.registerHelper('sw-translate', function swTranslate(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const key = typeof args[0] === 'string' ? args[0] : '';
    const hash = (options?.hash ?? {}) as Record<string, unknown>;
    const fallback = typeof hash.default === 'string' ? hash.default : '';
    if (!key) return fallback;
    const root = (options.data?.root ?? {}) as { website?: { t?: Record<string, unknown> } };
    const t = root.website?.t;
    if (t && Object.prototype.hasOwnProperty.call(t, key)) {
      // eslint-disable-next-line security/detect-object-injection -- own-property-guarded key
      const v = t[key];
      if (typeof v === 'string' && v !== '') return v;
    }
    return fallback;
  });
  // {{#if (sw-active path)}}active{{/if}} → is `path` the page being rendered, OR an ancestor of it?
  // Returns a BOOLEAN (use in #if), comparing the given route to the current page's full route
  // (`@root.page.path`). Default = the ACTIVE TRAIL: a parent/dropdown route lights up while you are
  // on one of its children (so `/services` is active on `/services/web-design`). Pass `exact=true`
  // for the current page ONLY. Both routes are root-relative (e.g. "/about"); trailing slashes are
  // ignored and a HOME route — the root "/" or, on a translated page, the locale home ("/es") —
  // only ever matches itself (never every page). No JS — resolved server-side (publish + preview).
  hb.registerHelper('sw-active', function swActive(this: unknown, target: unknown, options: Handlebars.HelperOptions) {
    if (typeof target !== 'string' || target === '') return false;
    // A nav PLACEHOLDER (kind:'link') is a link/group item, not the current page — never mark it
    // active, even when its `path` matches the current URL (`this` is the nav item inside {{#each nav.*}}).
    if (this && typeof this === 'object' && (this as { placeholder?: unknown }).placeholder === true) return false;
    const root = options?.data?.root as { page?: { path?: unknown; locale?: unknown; defaultLocale?: unknown } } | undefined;
    const current = typeof root?.page?.path === 'string' ? root.page.path : '';
    const norm = (p: string) => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);
    const t = norm(target);
    const c = norm(current);
    if (t === c) return true;
    // Accept both the boolean `exact=true` and the quoted-string `exact="true"` forms.
    if (options?.hash?.exact === true || options?.hash?.exact === 'true') return false;
    // Active trail: the current page is a descendant of `target` — EXCEPT when `target` is a home
    // route, which is every page's ancestor and would stay lit site-wide. That is "/" and, on a
    // NON-DEFAULT-locale page, the locale home: only non-default locales live under "/<locale>/…",
    // so their Home link ("/es") prefixes the entire locale tree. `page.locale` alone can't decide
    // (it is the RESOLVED locale — the default on unprefixed pages too), so the guard also requires
    // it to differ from `page.defaultLocale`: an ordinary page that merely looks like a locale
    // prefix (a content page at "/es" on a default-locale site) keeps its trail.
    const locale = typeof root?.page?.locale === 'string' ? root.page.locale : '';
    const defaultLocale = typeof root?.page?.defaultLocale === 'string' ? root.page.defaultLocale : '';
    if (t === '/' || (locale !== '' && locale !== defaultLocale && t === `/${locale}`)) return false;
    return c.startsWith(`${t}/`);
  });
  // ── MINI SHOP helpers (front-end cart). Both emit a SafeString carrying ESCAPED `data-sw-cart-*`
  // markers the first-party cart.js runtime reads — markers can't come from author HTML (the sanitizer
  // strips custom data-* there). The product DATA is escaped; the elements carry no behavior (cart.js
  // wires clicks). Prices are NON-AUTHORITATIVE (a front-end inquiry, not a charge). See blocks/cart.ts.
  //
  // {{sw-add-to-cart sku=id name=title price=price image=img label="Add" class="btn btn-outline"}} →
  // an "add to cart" <button>. `price` is coerced to a finite, non-negative number (canonical numeric
  // string; unknown/negative → 0). A bare key (sku, else name) is required or nothing is emitted. With
  // no `class=`, the button defaults to the vendored `btn btn-primary`; pass `class=` to override.
  hb.registerHelper('sw-add-to-cart', function swAddToCart(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const h = (options?.hash ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
    const root = (options.data?.root ?? {}) as { website?: { shop?: { enabled?: unknown }; t?: Record<string, unknown> } };
    // Gated by the master switch: with the shop OFF (website.shop.enabled !== true) the cart is disabled
    // site-wide, so this button renders nothing — even if the helper is still in the template source.
    if (root.website?.shop?.enabled !== true) return new Handlebars.SafeString('');
    const sku = str(h.sku);
    const name = str(h.name);
    const key = sku || name;
    if (!key) return new Handlebars.SafeString('');
    const priceNum = Number(h.price);
    const price = Number.isFinite(priceNum) && priceNum >= 0 ? String(priceNum) : '0';
    // Label precedence: explicit hash → translation catalog (reserved `cart.add`, localized per page
    // locale) → built-in English default (RESERVED_TRANSLATION_DEFAULTS).
    const label = str(h.label) || reservedTr(root, 'cart.add') || RESERVED_TRANSLATION_DEFAULTS['cart.add']!;
    let attrs = `data-sw-cart-add data-sku="${escapeAttr(key)}" data-name="${escapeAttr(name || key)}" data-price="${escapeAttr(price)}"`;
    const img = str(h.image);
    if (img) {
      const safe = safeUrl(img); // blocks javascript:/data:/protocol-relative → '#'
      if (safe && safe !== '#') attrs += ` data-image="${escapeAttr(safe)}"`;
    }
    // Default to the vendored .btn (btn-primary); an explicit `class=` overrides it per-button.
    const cls = str(h.class) || 'btn btn-sm';
    attrs += ` class="${escapeAttr(cls)}"`;
    return new Handlebars.SafeString(`<button type="button" ${attrs}>${escapeHtml(label)}</button>`);
  });
  // {{sw-cart}} → the cart MOUNT: a single <div data-sw-cart> carrying the currency + submission
  // channels (read from `website.shop`) as escaped data-* attributes. cart.js (shipped only when this
  // marker is present) builds the floating button + drawer from it. Drop it ONCE per site (e.g. the
  // footer slot) so it is on every page.
  //
  // i18n: a bare {{sw-cart}} AUTO-LOCALIZES — ALL display text resolves per page-locale from the
  // translation catalog (website.translations): the drawer strings + currency symbol/code via reserved
  // cart_* keys, and each channel/field LABEL via its `shop.<key>` key. So a locale variant needs no
  // per-page wiring. Precedence per drawer string: hash override → catalog (cart_*) → built-in English
  // default (RESERVED_TRANSLATION_DEFAULTS — one source of truth, also the editor's ghost rows). Settings
  // (website.shop) holds only non-text STRUCTURE (enabled, currency position/decimals, channel config).
  hb.registerHelper('sw-cart', function swCart(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const h = (options.hash ?? {}) as Record<string, unknown>;
    const root = (options.data?.root ?? {}) as { website?: { shop?: Record<string, unknown>; t?: Record<string, unknown> }; company?: Record<string, unknown> };
    const shop = (root.website?.shop ?? {}) as Record<string, unknown>;
    // Gated by the master switch (mirrors {{sw-add-to-cart}}): shop OFF (enabled !== true) → no cart
    // mount at all, so cart.js is never shipped (it loads only when this marker is present).
    if (shop.enabled !== true) return new Handlebars.SafeString('');
    const currency = (shop.currency ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
    // A catalog string by key (reserved cart_* OR a free `shop.<key>`), floored to the registry default
    // when the key is reserved (a non-reserved key has no default → '' floor). One source of truth.
    // eslint-disable-next-line security/detect-object-injection -- key is a literal/derived shop key; RESERVED_TRANSLATION_DEFAULTS is a frozen const registry (missing key → undefined → '')
    const tr = (key: string): string => reservedTr(root, key) || RESERVED_TRANSLATION_DEFAULTS[key] || '';
    let attrs = 'data-sw-cart';
    // Currency SYMBOL + CODE are translatable (reserved keys); position + decimals are non-text settings.
    attrs += ` data-currency-symbol="${escapeAttr(tr('cart.currency_symbol'))}"`;
    attrs += ` data-currency-code="${escapeAttr(tr('cart.currency_code'))}"`;
    if (currency.position === 'after') attrs += ` data-currency-pos="after"`;
    if (typeof currency.decimals === 'number') attrs += ` data-currency-decimals="${escapeAttr(String(currency.decimals))}"`;
    // Drawer-string precedence per key: explicit hash → translation catalog (reserved cart_* key, localized
    // per page locale) → built-in English default (RESERVED_TRANSLATION_DEFAULTS, the single source of
    // truth). The default floor makes every label always resolve, so a bare {{sw-cart}} auto-localizes from
    // website.translations with zero per-page wiring and an untranslated locale falls back to English.
    const rt = tr; // alias for the reserved cart_* drawer strings below
    attrs += ` data-cart-title="${escapeAttr(str(h.title) || tr('cart.title'))}"`;
    attrs += ` data-toggle-label="${escapeAttr(str(h.toggle) || rt('cart.toggle'))}"`;
    attrs += ` data-note="${escapeAttr(str(h.note) || tr('cart.note'))}"`;
    attrs += ` data-added-label="${escapeAttr(str(h.added) || rt('cart.added'))}"`;
    attrs += ` data-empty-label="${escapeAttr(str(h.empty) || rt('cart.empty'))}"`;
    attrs += ` data-total-label="${escapeAttr(str(h.total) || rt('cart.total'))}"`;
    attrs += ` data-clear-label="${escapeAttr(str(h.clear) || rt('cart.clear'))}"`;
    attrs += ` data-sent-label="${escapeAttr(str(h.sent) || rt('cart.sent'))}"`;
    // The word a ticked `checkbox` order field contributes to the message ("Gift wrap: Yes").
    attrs += ` data-yes-label="${escapeAttr(str(h.yes) || rt('cart.yes'))}"`;
    // The order-message lead-in ({{sw-cart}} → cart.js prepends it to the deep-link order summary). The
    // "Hi <brand> — " greeting connective in cart.js stays fixed; this lead sentence localizes.
    attrs += ` data-order-lead="${escapeAttr(str(h.orderLead) || rt('cart.order_lead'))}"`;
    // The merchant's brand/business name (the always-present Corporate Identity `name`, projected into the
    // render ctx as `company`) — cart.js uses it for the email greeting ("Hi <brand> — I'd like to order:").
    // Emitted only when present, so a no-args {{sw-cart}} with no identity stays byte-identical.
    // The captcha provider + PUBLIC site key, stamped on the mount so cart.js can render the widget
    // for a channel that asks for one. Present only when a channel does (see resolveShopChannels).
    const shopCaptcha = (shop.captcha ?? null) as { provider?: unknown; siteKey?: unknown } | null;
    if (shopCaptcha && str(shopCaptcha.provider) && str(shopCaptcha.siteKey)) {
      attrs += ` data-captcha-provider="${escapeAttr(str(shopCaptcha.provider))}"`;
      attrs += ` data-captcha-sitekey="${escapeAttr(str(shopCaptcha.siteKey))}"`;
    }
    const company = (root.company ?? {}) as Record<string, unknown>;
    const brand = str(company.name);
    if (brand) attrs += ` data-brand="${escapeAttr(brand)}"`;
    // A channel/field LABEL is translatable: it lives in the catalog under `shop.<key>`, resolved per
    // page-locale here. No catalog entry → the bare key as a visible fallback (so it's never blank).
    const shopLabel = (key: string): string => (key ? reservedTr(root, `shop.${key}`) || key : '');
    // Project a channel's buyer-input fields to ONLY {label,type,required} (defence-in-depth over the
    // schema); an absent/empty list returns undefined so JSON.stringify drops the key (byte-stable).
    const projFields = (f: unknown): Array<Record<string, unknown>> | undefined => {
      if (!Array.isArray(f) || f.length === 0) return undefined;
      const out = f
        .map((x): Record<string, unknown> | null => {
          if (!x || typeof x !== 'object') return null;
          const fx = x as Record<string, unknown>;
          const key = str(fx.key);
          const type = fx.type;
          // A CHOICE field (select/radio) carries its options, resolved per locale from the sibling
          // catalog key `shop.<key>.options` (a comma-separated list). Emitted only when the type needs
          // them AND at least one parses, so a mis-typed or empty row leaves the JSON byte-stable and the
          // runtime falls back to a plain text input rather than rendering an empty <select>.
          const options =
            typeof type === 'string' && (SHOP_CHOICE_FIELD_TYPES as readonly string[]).includes(type)
              ? parseShopFieldOptions(key ? reservedTr(root, `shop.${key}${SHOP_OPTIONS_KEY_SUFFIX}`) : '')
              : [];
          // `required` only when truthy (mirrors the model.ts projection) — keeps the JSON minimal/explicit.
          return {
            // The KEY travels as `name`: a deep-link channel only needs the label (it writes
            // "Label: value" into a URL), but the ORDER form posts these as real inputs, and an
            // input with no name submits nothing at all — the field would render and silently not
            // arrive.
            name: key,
            label: shopLabel(key),
            type,
            ...(fx.required ? { required: true } : {}),
            ...(options.length ? { options } : {}),
          };
        })
        .filter((x): x is Record<string, unknown> => x !== null);
      return out.length ? out : undefined;
    };
    // Project channels to ONLY the fields the runtime needs (defence-in-depth over the schema), resolving
    // each channel's translatable label (`shop.<key>`), then JSON-encode into an escaped attribute
    // (cart.js JSON.parses it; undefined props are dropped).
    const channels = Array.isArray(shop.channels) ? (shop.channels as Array<Record<string, unknown>>) : [];
    const clean = channels
      .map((c): Record<string, unknown> | null => {
        if (!c || typeof c !== 'object') return null;
        const label = shopLabel(str(c.key));
        if (c.kind === 'whatsapp') return { kind: 'whatsapp', label, number: c.number, intro: c.intro, fields: projFields(c.fields) };
        if (c.kind === 'mailto') return { kind: 'mailto', label, email: c.email, subject: c.subject, fields: projFields(c.fields) };
        if (c.kind === 'payment') return { kind: 'payment', label, urlTemplate: c.urlTemplate };
        // The form channel carries its form ID, never the resolved URL: cart.js assembles the address
        // from the encoded blob (window.__swf), so the endpoint stays out of this attribute — it used to
        // ship the full `/f/…` URL in `data-channels` for any scraper to read. `endpoint` is still what
        // the render projection resolves, and its presence is what proves the channel is dispatchable.
        // The form channel carries its resolved form ID + its own buyer FIELDS, never the endpoint URL:
        // cart.js assembles the address from the encoded blob (window.__swf), so it stays out of this
        // attribute. `captcha` is a flag; the provider + site key ride on the mount, not per channel.
        if (c.kind === 'form') {
          return typeof c.endpoint === 'string' && typeof c.formId === 'string'
            ? { kind: 'form', label, formId: c.formId, fields: projFields(c.fields), ...(c.captcha ? { captcha: true } : {}) }
            : null;
        }
        return null;
      })
      .filter((c): c is Record<string, unknown> => c !== null);
    if (clean.length) {
      // Unicode-escape the markup-significant chars dom-serializer leaves RAW in an attribute value
      // (`<`/`>`/`&`), so the channels JSON survives the resolveDirectives parse→serialize round-trip
      // (which runs on any page containing data-sw-) intact, valid, and byte-stable.
      const channelsJson = JSON.stringify(clean).replace(/[<>&]/g, (c) => `\\u00${c.charCodeAt(0).toString(16)}`);
      attrs += ` data-channels="${escapeAttr(channelsJson)}"`;
    }
    return new Handlebars.SafeString(`<div ${attrs}></div>`);
  });
  // (The CONSENT MANAGER banner mount is AUTO-INJECTED by the publish pipeline whenever
  // website.consent.enabled — there is no `{{sw-consent}}` helper. See consentMountMarkup + renderDocument.)
  // {{sw-consent-settings [label="…"] [class="…"]}} → a button that RE-OPENS the consent preferences
  // (e.g. a footer "Cookie settings" link for GDPR withdrawal). Gated on website.consent.enabled. Carries
  // data-sw-consent-open, which the consent.js runtime delegates. The label localizes (consent.settings).
  hb.registerHelper('sw-consent-settings', function swConsentSettings(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const h = (options?.hash ?? {}) as Record<string, unknown>;
    const root = (options.data?.root ?? {}) as { website?: { consent?: Record<string, unknown>; t?: Record<string, unknown> } };
    if ((root.website?.consent as Record<string, unknown> | undefined)?.enabled !== true) return new Handlebars.SafeString('');
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    const label = str(h.label) || reservedTr(root, 'consent.settings') || RESERVED_TRANSLATION_DEFAULTS['consent.settings'] || 'Cookie settings';
    const cls = str(h.class);
    const classAttr = escapeAttr(cls || 'sw-consent-link');
    return new Handlebars.SafeString(`<button type="button" data-sw-consent-open class="${classAttr}">${escapeHtml(label)}</button>`);
  });
  // {{sw-theme-toggle [label="…"] [class="…"]}} → a light/dark toggle button for the OPT-IN themes
  // feature (Settings → Website → enable themes). It carries both a sun + a moon icon;
  // CSS (THEME_TOGGLE_CSS) shows the one for the active theme, so the icon is correct with or without
  // JS, and the `data-sw-theme-toggle` marker ships the no-flash + click runtime (THEME_TOGGLE_JS).
  // Gated by the master switch: with themes OFF (no dark palette, no runtime) it renders
  // nothing, even if the helper stays in the template. Drop it ONCE in the nav/header slot. The
  // accessible label localizes: explicit hash → reserved `theme.toggle` catalog key → English default.
  hb.registerHelper('sw-theme-toggle', function swThemeToggle(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const h = (options?.hash ?? {}) as Record<string, unknown>;
    const root = (options.data?.root ?? {}) as { website?: { enableThemes?: unknown; t?: Record<string, unknown> } };
    if (root.website?.enableThemes !== true) return new Handlebars.SafeString('');
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    const label =
      str(h.label) || reservedTr(root, 'theme.toggle') || RESERVED_TRANSLATION_DEFAULTS['theme.toggle'] || 'Toggle dark mode';
    const cls = str(h.class);
    const classAttr = cls ? `sw-theme-toggle ${cls}` : 'sw-theme-toggle';
    // Sun/moon come from the shared icon renderer (Phosphor fill); the `sw-tt-*` class is the CSS picker
    // hook that shows the right glyph per theme. The renderer's class hooks compose with sw-tt-*.
    return new Handlebars.SafeString(
      `<button type="button" class="${escapeAttr(classAttr)}" data-sw-theme-toggle ` +
        `aria-label="${escapeAttr(label)}" aria-pressed="false" title="${escapeAttr(label)}">` +
        `${renderIconSvg('sun', 'sw-tt-sun')}${renderIconSvg('moon', 'sw-tt-moon')}</button>`,
    );
  });
  // {{sw-form "contact" class="card p-8"}} → the COMPLETE markup of a stored form definition
  // (fields/labels/placeholders/select options, submit button, success/error parts), styled by the
  // first-party FORM_CSS and wired by FORM_JS. The wrapper carries `data-sw-form="<id>"` and NO
  // endpoint — the form-embed pass (after render) injects the mode-correct `data-sw-endpoint`,
  // redirect, honeypot, and hCaptcha widget, for helper-emitted and hand-authored forms alike.
  // Locale-aware: on a `de` page, "contact" resolves the form `contact-de` when it exists (the
  // dataset suffix convention). Unknown id → loud render error; a surface with NO forms map
  // (e.g. the snippet hover preview) renders '' (forms unsupported there, not an authoring error).
  hb.registerHelper('sw-form', function swForm(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const id = typeof args[0] === 'string' ? args[0] : '';
    const root = (options.data?.root ?? {}) as { forms?: Record<string, RenderForm>; page?: { locale?: unknown } };
    if (!root.forms) return new Handlebars.SafeString('');
    const locale = typeof root.page?.locale === 'string' ? root.page.locale : undefined;
    const resolvedId = resolveFormId(id, locale, root.forms);
    if (resolvedId === undefined) throw new Error(unknownFormMessage(id, locale));
    const hash = (options.hash ?? {}) as Record<string, unknown>;
    const cls = typeof hash.class === 'string' && hash.class !== '' ? { class: hash.class } : {};
    // resolveFormId only returns ids it verified present (own-property, proto-guarded).
    // eslint-disable-next-line security/detect-object-injection -- verified own-property key
    return new Handlebars.SafeString(renderFormMarkup(resolvedId, root.forms[resolvedId]!, cls));
  });
  // {{sw-imagemap "floor-plan" class="rounded-xl"}} → the complete markup of a stored image map:
  // the `data-sw-component="image-map"` wrapper, a no-JS fallback <img> taken from the first
  // artboard, and the map CONFIG as a `<script type="application/json">` data block. The config's
  // three authored-markup values (tooltip text, a YouTube embedCode, an SVG region's html) are
  // sanitized on the way out. Unknown id → loud render error; a surface with NO imageMaps map
  // renders '' (image maps unsupported there, not an authoring error) — mirrors {{sw-form}}.
  hb.registerHelper('sw-imagemap', function swImageMap(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const id = typeof args[0] === 'string' ? args[0] : '';
    const root = (options.data?.root ?? {}) as { imageMaps?: Record<string, RenderImageMap> };
    if (!root.imageMaps) return new Handlebars.SafeString('');
    const map = Object.prototype.hasOwnProperty.call(root.imageMaps, id) ? root.imageMaps[id] : undefined;
    if (!map) throw new Error(unknownImageMapMessage(id));
    const hash = (options.hash ?? {}) as Record<string, unknown>;
    const cls = typeof hash.class === 'string' && hash.class !== '' ? { class: hash.class } : {};
    // `preview` carries the map's id into the markup, so the editor can open it in the Studio.
    const previewing = Boolean((options.data?.root as { preview?: unknown } | undefined)?.preview);
    return new Handlebars.SafeString(renderImageMapMarkup(map, { ...cls, preview: previewing }));
  });
  // ({{edit}} is RETIRED — editable text is now the `data-sw-text="key"` directive, bound to page.data.)
  //
  // {{#each dataset.x}}…{{/each}} — the ONE loop helper, dataset-aware. When the iterated value is an
  // array of DATASET ENTRIES, each iteration's context is the entry's FIELDS (`entry.values`) — so a
  // template reads `{{title}}`, not `{{values.title}}` — and the entry envelope is exposed on the
  // data frame as `@entry` (id/dataset/status). In PREVIEW (`root.markEntries`) each row's own root
  // element carries `data-sw-entry` / `data-sw-dataset` so the editor can open THAT entry's editor on
  // click — NOT an injected wrapper, which would change the row's position in its parent's layout and
  // make the preview disagree with the published page (see entry-marker.ts); a row that cannot carry
  // the markers itself still falls back to the wrapper.
  // OUTSIDE preview nothing is added at all, so publish output is byte-identical to a plain loop. ANY
  // non-entry value (objects, nav menus, plain arrays) falls through to Handlebars' stock `#each`
  // unchanged — `{{else}}`, `@index/@first/@last/@key`, block params, and `../` all keep working.
  const builtinEach = hb.helpers.each as Handlebars.HelperDelegate;
  hb.registerHelper('each', function each(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const context = args[0];
    // ALL-OR-NOTHING: only an array whose EVERY element is an entry takes the dataset path. A mixed or
    // malformed array (or empty — which routes to the built-in {{else}}) falls through to stock #each.
    if (Array.isArray(context) && context.length > 0 && context.every(isEntry)) {
      const root = (options.data?.root ?? {}) as { markEntries?: boolean };
      let out = '';
      for (let i = 0; i < context.length; i += 1) {
        // eslint-disable-next-line security/detect-object-injection -- i is a bounded loop index
        const entry = context[i] as EntryLike;
        const frame = Handlebars.createFrame(options.data ?? {});
        frame.index = i;
        frame.key = i;
        frame.first = i === 0;
        frame.last = i === context.length - 1;
        // The envelope metadata lives on @entry — NEVER merged into the field namespace, so a field
        // named `id`/`dataset`/`status` can't be shadowed by it.
        frame.entry = { id: entry.id, dataset: entry.dataset, status: entry.status };
        const body = options.fn(entry.values, { data: frame, blockParams: [entry.values, i] });
        out += root.markEntries ? markEntry(body, entry.id, entry.dataset) : body;
      }
      return new Handlebars.SafeString(out);
    }
    // Not a dataset → the stock #each (handles objects, iterables, empty {{else}}, @key, etc.).
    return (builtinEach as (...a: unknown[]) => unknown).apply(this, args);
  });

  // {{#sw-folder "path" kind="image|file|all" recursive=false sort="name|name-desc"}}…{{else}}…{{/sw-folder}}
  // Iterates a project MEDIA FOLDER (images by default), filed under "path" — a subfolder path like
  // "documents/projectA", or a variable (e.g. `{{#sw-folder page.data.gallery_folder}}`). Each iteration
  // binds the asset as `this` (url/filename/kind/alt/width/height) plus @index/@first/@last; an empty
  // folder routes to {{else}}. Server-render only (plain <img>/<a>); media comes from the render context.
  hb.registerHelper('sw-folder', function swFolder(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const hash = (options.hash ?? {}) as Record<string, unknown>;
    const root = (options.data?.root ?? {}) as { media?: readonly RenderMedia[] };
    const assets = selectFolderAssets(Array.isArray(root.media) ? root.media : [], args[0], {
      kind: hash.kind === 'file' || hash.kind === 'all' ? (hash.kind as FolderKind) : 'image',
      recursive: hash.recursive === true,
      sort: hash.sort === 'name-desc' ? 'name-desc' : 'name',
    });
    if (assets.length === 0) return typeof options.inverse === 'function' ? options.inverse(this) : '';
    let out = '';
    for (let i = 0; i < assets.length; i += 1) {
      // eslint-disable-next-line security/detect-object-injection -- i is a bounded loop index
      const item = projectFolderItem(assets[i]!);
      const frame = Handlebars.createFrame(options.data ?? {});
      frame.index = i;
      frame.first = i === 0;
      frame.last = i === assets.length - 1;
      out += options.fn(item, { data: frame, blockParams: [item, i] });
    }
    return new Handlebars.SafeString(out);
  });

  // {{sw-control target="page.title|page.image|page.description|<page.data key>"
  //   as="text|textarea|url|number|color|date|image|file|select|folder|dataset" [options="a,b,c"] label="…"}}
  // A content-editor-ONLY control: renders an editable chip (shown only in content mode, wired by the
  // preview bridge; STRIPPED on publish by resolveDirectives) that sets a whitelisted page attribute or
  // a page.data value from inside the preview — e.g. the page title, the OG image, a gallery FOLDER name
  // (for {{#sw-folder}}), or a DATASET name (for {{#each}}). Emits a marker the bridge upgrades.
  // An unknown `as`, or as="select" without `options`, THROWS (fails loud) rather than silently
  // degrading to a text box — a degraded control is worse than a clear authoring error.
  hb.registerHelper('sw-control', function swControl(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const hash = (options.hash ?? {}) as Record<string, unknown>;
    const rawTarget = typeof hash.target === 'string' ? hash.target : '';
    const target = classifyControlTarget(rawTarget);
    if (!target) return new Handlebars.SafeString(''); // invalid/disallowed target → render nothing
    const root = (options.data?.root ?? {}) as Parameters<typeof controlCurrentValue>[1];
    // Fail loud on an unknown `as` (omitting it still defaults to text); the old silent coercion hid
    // typos like as="number"/"select" the bridge could not honor.
    const rawAs = hash.as;
    if (rawAs !== undefined && rawAs !== '' && !isControlAs(rawAs)) {
      throw new Error(`sw-control: unknown as="${String(rawAs)}" — use one of: ${CONTROL_AS_VALUES.join(', ')}`);
    }
    const as = isControlAs(rawAs) ? rawAs : 'text';
    const label = typeof hash.label === 'string' && hash.label ? hash.label : rawTarget;
    const current = controlCurrentValue(target, root);
    // Dropdown options: as="select" → author-provided `options="a,b,c"` (REQUIRED — an empty list is
    // an authoring error); as="folder"/"dataset" → derived from the page's media folders / datasets.
    let opts: string[];
    if (as === 'select') {
      opts = parseSelectOptions(hash.options);
      if (opts.length === 0) {
        throw new Error('sw-control: as="select" requires a non-empty options="a, b, c" list');
      }
    } else {
      // as="dataset-item" needs the dataset slug (which entries to list); folder/dataset ignore it.
      opts = controlOptions(as, root, typeof hash.dataset === 'string' ? hash.dataset : undefined);
    }
    let attrs =
      `data-sw-control="${escapeAttr(rawTarget)}" data-sw-control-as="${escapeAttr(as)}"` +
      ` data-sw-control-label="${escapeAttr(label)}" data-sw-control-value="${escapeAttr(current)}"`;
    if (opts.length) attrs += ` data-sw-control-options="${escapeAttr(JSON.stringify(opts))}"`;
    return new Handlebars.SafeString(`<span ${attrs}>⚙ ${escapeHtml(label)}: ${escapeHtml(current || '—')}</span>`);
  });

  // {{sw-image url [alt=] [sizes=] [class=] [loading=eager] [fetchpriority=high] [format=avif]
  //            [lightbox=true] [caption=]}}
  // Responsive image for a PROJECT image (a delivery `/media/<slug>/<id>/<name>` url, or a
  // {{#sw-folder}}/dataset item's `url`): emits an <img> with a WebP srcset + intrinsic width/height
  // (no CLS) + a blur-up LQIP + loading=lazy. `format=avif` (or the project's AVIF delivery setting)
  // emits a <picture> with an AVIF source above the WebP one. `loading=eager` marks an above-the-fold
  // hero — it also gets fetchpriority=high (LCP hint) unless `fetchpriority=` overrides it. An
  // external/unknown url degrades to a plain lazy <img>. The server serves each ?size on demand; publish
  // materializes referenced files.
  //
  // `lightbox=true` wraps the result in the `<a href><img>` pair a Lightbox gallery item needs, with
  // the href on the LARGEST variant while the thumbnail keeps its own srcset — so a grid paints small
  // files and the viewer still opens full detail. Pair it with `sizes=` (e.g.
  // `sizes="(min-width:640px) 33vw, 100vw"`), or the `100vw` default makes each thumbnail fetch the
  // largest rung and the page carries full-size images it never displays.
  hb.registerHelper('sw-image', function swImage(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const hash = (options.hash ?? {}) as Record<string, unknown>;
    const first = args[0];
    const url =
      typeof first === 'string'
        ? first
        : first && typeof first === 'object' && typeof (first as { url?: unknown }).url === 'string'
          ? (first as { url: string }).url
          : '';
    if (!url) return new Handlebars.SafeString('');
    const root = (options.data?.root ?? {}) as { media?: readonly RenderMedia[]; imageAvif?: boolean };
    const media = Array.isArray(root.media) ? root.media : [];
    const html = buildSwImage(url, media, {
      ...(typeof hash.alt === 'string' ? { alt: hash.alt } : {}),
      ...(typeof hash.class === 'string' ? { className: hash.class } : {}),
      ...(typeof hash.sizes === 'string' ? { sizes: hash.sizes } : {}),
      loading: hash.loading === 'eager' ? 'eager' : 'lazy',
      ...(hash.fetchpriority === 'high' || hash.fetchpriority === 'low' || hash.fetchpriority === 'auto'
        ? { fetchpriority: hash.fetchpriority }
        : {}),
      format: hash.format === 'avif' || root.imageAvif === true ? 'avif' : 'webp',
      // `editable="key"` marks the emitted <img> as a replaceable editable leaf. Only a non-empty
      // string counts, so `editable=false` / `editable=""` stay off rather than binding an empty key.
      ...(typeof hash.editable === 'string' && hash.editable ? { editable: hash.editable } : {}),
      ...(hash.lightbox === true || hash.lightbox === 'true' ? { lightbox: true } : {}),
      ...(typeof hash.caption === 'string' ? { caption: hash.caption } : {}),
    });
    return new Handlebars.SafeString(html);
  });

  return hb;
}

/**
 * EVERY Handlebars helper name the engine registers (built-ins we keep + our additions), sorted. Used by
 * the namespace-hygiene test to guarantee no NEW bare (non-`sw-`) content helper ever ships undocumented —
 * every emitter must be `sw-`-prefixed (so it can't shadow a data field and so it's pinned into SW_HELPERS).
 */
export function registeredHelperNames(): string[] {
  return Object.keys(createInstance().helpers).sort();
}

/**
 * The custom `sw-*` Handlebars helper names the engine registers — the canonical, single-source list
 * the Template reference (apps/editor/src/views/library/reference.ts) must document. A test pins the
 * docs to this set so a new/renamed/removed helper can't silently leave the reference stale.
 */
export function registeredSwHelpers(): string[] {
  return registeredHelperNames().filter((name) => name.startsWith('sw-'));
}

/** Every registered helper name, cached — `registeredHelperNames()` builds a whole Handlebars instance. */
let helperNameSet: Set<string> | null = null;

/** One `{{name …}}` call naming a helper the engine does not register, with its position in the source. */
export interface UnknownHelperUse {
  name: string;
  line: number;
  column: number;
  /** True when the call sits inside a tag (an attribute value) — where the render-time marker is INVISIBLE. */
  inAttribute: boolean;
}

/**
 * Find `{{someHelper arg}}` calls naming a helper that does not exist.
 *
 * This is a SAVE-TIME check, deliberately NOT part of {@link validateTemplate} — that runs on every
 * render, and turning an unknown helper into a render failure is precisely what the graceful
 * `helperMissing` fallback exists to prevent (one retired helper must not 400 a whole page). So: strict
 * where the author can still fix it, lenient where it would only break a visitor's page.
 *
 * It exists because the render-time fallback is only *discoverable* in body text. Inside an attribute
 * (`data-sw-delay="{{multiply @index 90}}"`) the emitted `<!-- … -->` marker is not a comment at all —
 * it is attribute garbage, invisible in the page and reported by nothing. That is a real bug that
 * shipped: the effects guide recommends staggering a loop, templates had no arithmetic at the time, and
 * the resulting `{{multiply}}` was only ever found by grepping the built artifact. Arithmetic exists now
 * — as `sw-mul`, not `multiply` — so the near-miss NAME is if anything a likelier mistake than before.
 *
 * A mustache counts as a CALL only when it has arguments — a bare `{{name}}` is a data path (missing →
 * empty, unchanged), and `{{#block}}` / `{{>partial}}` / `{{^inverse}}` / `{{!comment}}` are skipped.
 * Subexpressions `(name …)` are checked too.
 */
export function findUnknownHelpers(source: string): UnknownHelperUse[] {
  helperNameSet ??= new Set(registeredHelperNames());
  const known = helperNameSet;
  const out: UnknownHelperUse[] = [];
  const seen = new Set<string>();
  // `name` then at least one argument. Handlebars has no other reading of a path followed by a token,
  // so this can't misfire on a plain binding.
  const CALL = /^([A-Za-z_$][\w$.:-]*)\s+\S/;
  const SUBEXPR = /\(\s*([A-Za-z_$][\w$.:-]*)\s+\S/g;

  let inTag = false;
  let i = 0;
  while (i < source.length) {
    if (source.startsWith('{{', i)) {
      const close = source.indexOf('}}', i + 2);
      if (close === -1) break; // unclosed — validateTemplate reports it properly
      const inner = source.slice(i + 2, close).replace(/^\{/, '').trim();
      if (!/^[#/!>^]|^else\b/.test(inner)) {
        const names = [CALL.exec(inner)?.[1], ...[...inner.matchAll(SUBEXPR)].map((m) => m[1])];
        for (const name of names) {
          if (name === undefined || known.has(name)) continue;
          const key = `${name}@${i}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ name, ...lineCol(source, i), inAttribute: inTag });
        }
      }
      i = close + 2;
      continue;
    }
    const ch = source[i];
    // Coarse tag tracking — enough to tell "inside a tag" from body text. Mustaches never contain a
    // bare `<`/`>` that could desync it (validateTemplate rejects raw output and unquoted attributes).
    if (ch === '<') inTag = true;
    else if (ch === '>') inTag = false;
    i += 1;
  }
  return out;
}

/** The minimal shape of a dataset entry the loop helper recognises (mirrors @sitewright/schema's Entry). */
interface EntryLike {
  id: string;
  dataset: string;
  status?: unknown;
  values: Record<string, unknown>;
}

/**
 * Is `v` a dataset entry? An entry is the envelope `{ id, dataset, values, … }` bound to
 * `dataset.<dataset>`. We detect it structurally (string `id` + string `dataset` + object `values`) so
 * the unified `{{#each}}` can flatten entry fields + emit click-to-edit markers, while plain arrays
 * (nav menus, page.children, translations) fall through to the built-in loop untouched.
 */
function isEntry(v: unknown): v is EntryLike {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.dataset === 'string' && typeof o.values === 'object' && o.values !== null;
}

const HB = createInstance();
const compileCache = new Map<string, Handlebars.TemplateDelegate>();

function compileCached(source: string): Handlebars.TemplateDelegate {
  const hit = compileCache.get(source);
  if (hit) {
    // LRU touch: re-insert to mark most-recently-used.
    compileCache.delete(source);
    compileCache.set(source, hit);
    return hit;
  }
  let compiled: Handlebars.TemplateDelegate;
  try {
    // `strict: false` → a missing path renders empty (not a throw). Helpers available are
    // the pure built-in logic helpers + our curated sw-url/sw-date/sw-icon/sw-flag/sw-label/sw-truncate/sw-add-to-cart/sw-cart (log removed);
    // tenants cannot register their own (no compile/runtime registration is exposed).
    compiled = HB.compile(source, { strict: false, noEscape: false });
  } catch (err) {
    throw new TemplateError(err instanceof Error ? `template compile error: ${err.message}` : 'template compile error');
  }
  if (compileCache.size >= COMPILE_CACHE_LIMIT) {
    const oldest = compileCache.keys().next().value;
    if (oldest !== undefined) compileCache.delete(oldest);
  }
  compileCache.set(source, compiled);
  return compiled;
}

export interface RenderOptions {
  /** Max output bytes; a render exceeding this throws (the worker also caps memory/time). */
  maxOutput?: number;
}

const DEFAULT_MAX_OUTPUT = 1_048_576; // 1 MiB

/**
 * Validates, compiles (cached), and renders a template against a whitelisted context.
 * Prototype access is disabled; only curated helpers + per-render partials are available.
 * Throws {@link TemplateError} on an unsafe context, a compile error, or a render error.
 */
export function renderTemplate(source: string, ctx: TemplateContext = {}, opts: RenderOptions = {}): string {
  validateTemplate(source);
  // Partials are rendered verbatim too — validate each so a malicious `{{> snippet}}`
  // cannot smuggle a <script>/handler/unsafe-context past the main-template check.
  if (ctx.partials) for (const partialSource of Object.values(ctx.partials)) validateTemplate(partialSource);
  const template = compileCached(source);
  // `parentPage` is merged into the page object as `page.parent` (the author binding); it is not a
  // top-level namespace. Only attach when present so a no-parent page keeps `page.parent` undefined.
  const page = ctx.parentPage ? { ...(ctx.page ?? {}), parent: ctx.parentPage } : ctx.page;
  // `preview` rides along so a helper can emit the editor-only markers the directive passes add
  // (today: {{sw-imagemap}} naming its map so a click can open the Studio). Never true on publish.
  const data = { company: ctx.company, website: ctx.website, page, pages: ctx.pages, dataset: ctx.dataset, item: ctx.item, nav: ctx.nav, media: ctx.media, imageAvif: ctx.imageAvif, markEntries: ctx.markEntries, forms: ctx.forms, imageMaps: ctx.imageMaps, preview: ctx.preview };
  let html: string;
  try {
    html = template(data, {
      partials: ctx.partials,
      // Prototype access OFF — this is where Handlebars' historical RCEs lived.
      allowProtoPropertiesByDefault: false,
      allowProtoMethodsByDefault: false,
    });
  } catch (err) {
    // A circular/too-deep {{> partial}} chain overflows the stack — turn it into a clear,
    // bounded error (it is caught here, so the worker is never crashed by it).
    if (err instanceof RangeError) {
      throw new TemplateError('render failed: a circular or too-deeply-nested {{> partial}} include');
    }
    throw new TemplateError(err instanceof Error ? `render error: ${err.message}` : 'render error');
  }
  // Resolve the data-sw-* editable-leaf directives (text/rich bindings; image/bg/link in later
  // PRs) — keeps the marker attributes in preview, strips them on publish. No-op when the
  // rendered fragment contains no directive, so non-editable pages stay byte-identical.
  html = resolveDirectives(html, {
    // Single store: text/html/href/src/bg read page.data (bare key → top-level prop; `data.<path>` → nested).
    data: ctx.page?.data as Record<string, unknown> | undefined,
    // …plus the SITE-WIDE store for a `website.data.<path>` key. Chrome slots (mainNav/footer/bottom)
    // are not a page and have no page.data, so this is the only editable-leaf store reachable from them
    // that can hold RICH html — `data-sw-translate` is plain text.
    websiteData: (ctx.website as { data?: Record<string, unknown> } | undefined)?.data,
    // data-sw-translate reads the project i18n catalog, pre-resolved for this page's locale into website.t.
    t: (ctx.website as { t?: Record<string, unknown> } | undefined)?.t,
    preview: ctx.preview,
  });
  // Resolve `data-sw-form` references (helper-emitted and hand-authored alike) into the
  // mode-correct submission endpoint + redirect/honeypot/hCaptcha — AFTER the directive pass so
  // authored data-sw-text labels inside a form resolve first. No-op without a reference or when
  // the surface provides no forms map. form-embed throws plain Errors (no import cycle) — wrap.
  const pageLocale = ctx.page?.locale;
  try {
    html = resolveFormEmbeds(html, {
      forms: ctx.forms,
      locale: typeof pageLocale === 'string' ? pageLocale : undefined,
      siteRoot: ctx.siteRoot,
      captcha: ctx.captcha,
      preview: ctx.preview,
    });
  } catch (err) {
    throw new TemplateError(err instanceof Error ? err.message : 'form embed failed');
  }
  // Resolve `data-sw-imagemap` references (helper-emitted markup already carries its config, so
  // this pass exists for HAND-AUTHORED carriers) into the component marker + sanitized config
  // block. No-op without a reference or when the surface provides no maps.
  try {
    html = resolveImageMapEmbeds(html, { imageMaps: ctx.imageMaps, preview: ctx.preview });
  } catch (err) {
    throw new TemplateError(err instanceof Error ? err.message : 'image map embed failed');
  }
  // Pair every `data-sw-component="x"` with the `data-sw-block="X"` its stylesheet is keyed on, so
  // source that authored only the component marker still gets the component's CSS (unsized slides /
  // a visible "Slide x of y" live region / inert controls otherwise). No-op without a marker.
  html = addComponentBlockMarkers(html);
  // Bake the FIRST FRAME of every parallax appearance channel (opacity / blur) into the markup, so the
  // un-animated state is the intended look rather than the raw element. The runtime does not run under
  // `prefers-reduced-motion` or without JS, and for those channels "no motion" must not mean "no styling".
  html = applyParallaxStaticState(html);
  const max = opts.maxOutput ?? DEFAULT_MAX_OUTPUT;
  if (html.length > max) throw new TemplateError('template output exceeded the size limit');
  return html;
}
