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
import { escapeAttr, escapeHtml } from './escape.js';
import { iconBody } from './icons.js';
import { brandIcon } from './brand-icons.js';
import { flagIcon } from './flag-icons.js';
import { resolveDirectives } from './directives.js';
import { sanitizeRichHtml } from './sanitize-rich.js';
import { resolveFormEmbeds, resolveFormId, renderFormMarkup, unknownFormMessage, type RenderForm } from './form-embed.js';
import { addComponentBlockMarkers } from './components.js';
import { selectFolderAssets, projectFolderItem, type FolderKind, type RenderMedia } from './folder.js';
import { buildSwImage } from './image-helper.js';
import { classifyControlTarget, controlCurrentValue, controlOptions, isControlAs, parseSelectOptions, CONTROL_AS_VALUES } from './control.js';
import { RESERVED_TRANSLATION_DEFAULTS } from '@sitewright/schema';

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
   * PREVIEW-ONLY: when true, the dataset-aware `{{#each}}` helper wraps each entry iteration in a
   * `<div data-sw-entry data-sw-dataset>` so the editor can open that entry's editor on click. Never
   * set on publish — the loop is then byte-identical to a plain `{{#each}}` (no wrapper).
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
  /** Instance hCaptcha site key (public) — rendered into platform-routed forms that opt in. */
  hcaptchaSiteKey?: string;
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

export function validateTemplate(source: string): void {
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
    if (mode === 'comment' || mode === 'rawtext') reject(`an interpolation in a ${mode === 'rawtext' ? '<style>' : 'comment'} block`);
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
          // No tenant JS: a <script> element is rejected wherever it appears (including
          // inside an {{#*inline}} partial body, which the scanner walks as literal text).
          if (!isClose && name === 'script') reject('a <script> element');
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
          pendingRaw = !isClose && name === 'style' ? 'style' : '';
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
 * A non-empty translated string for a RESERVED catalog key, read from the pre-resolved per-locale map
 * `website.t` (own-property + proto-guarded). Empty/missing → '' so the caller's fallback chain applies.
 * The mini-shop cart helpers use this to localize their built-in labels from `website.translations`
 * (the reserved `cart_*` keys — see @sitewright/schema's RESERVED_TRANSLATION_GROUPS for the full set)
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
  hb.registerHelper('sw-date', (value: unknown, format?: unknown) => {
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
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  });
  // {{sw-icon "arrow-right" "h-5 w-5"}} → inline a built-in icon as an <svg>. A bare name is a
  // Lucide (stroke) glyph; a `brand:<slug>` name is a brand/social logo (a single FILL path,
  // currentColor so it themes with text color). The markup comes ONLY from the trusted icon maps
  // (unknown name → empty, NEVER user input) and the class string is attribute-escaped — so this
  // emits a SafeString (raw SVG) without ever reflecting tenant markup. Author-supplied DATA is just
  // the icon NAME (a map key) + a class list. Use in element context. A field literally named `icon`
  // (e.g. a card's emoji) is read plainly as `{{icon}}`, never shadowed by this.
  hb.registerHelper('sw-icon', (name: unknown, cls?: unknown) => {
    if (typeof name !== 'string') return new Handlebars.SafeString('');
    const klass = escapeAttr(typeof cls === 'string' ? cls : 'h-5 w-5');
    if (name.startsWith('brand:')) {
      const brand = brandIcon(name.slice('brand:'.length));
      if (!brand) return new Handlebars.SafeString('');
      return new Handlebars.SafeString(
        `<svg class="${klass}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${escapeAttr(brand.path)}"/></svg>`,
      );
    }
    const body = iconBody(name);
    if (body === undefined) return new Handlebars.SafeString('');
    const svg =
      `<svg class="${klass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
      `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    return new Handlebars.SafeString(svg);
  });
  // {{sw-flag "de" "h-4"}} → inline a FULL-COLOR country flag as an <svg>. A bare alpha-2 code is the
  // rectangular 4:3 flag; a `<code>-circle` name is the circular variant (e.g. {{sw-flag "de-circle"}}).
  // Unlike sw-icon these keep their own fills (a flag in currentColor would be a blob), so it is a
  // SEPARATE helper. The markup is ONLY from the trusted, build-time flag set (per-country namespaced
  // ids so flags never collide on a page); an unknown code → empty. The country name is the accessible
  // label + <title>. Use in element context.
  hb.registerHelper('sw-flag', (name: unknown, cls?: unknown) => {
    if (typeof name !== 'string') return new Handlebars.SafeString('');
    const isCircle = name.endsWith('-circle');
    const flag = flagIcon(isCircle ? name.slice(0, -'-circle'.length) : name);
    const shape = flag && (isCircle ? flag.circle : flag.rect);
    if (!flag || !shape) return new Handlebars.SafeString('');
    const klass = escapeAttr(typeof cls === 'string' ? cls : isCircle ? 'h-5 w-5' : 'h-4');
    return new Handlebars.SafeString(
      `<svg class="${klass}" viewBox="${escapeAttr(shape.viewBox)}" role="img" aria-label="${escapeAttr(flag.name)}">` +
        `<title>${Handlebars.escapeExpression(flag.name)}</title>${shape.body}</svg>`,
    );
  });
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
  //     {{else}}/nothing. In PREVIEW (`root.markEntries`) it WRAPS the block in a data-sw-entry /
  //     data-sw-dataset marker (using the envelope's id+dataset) so a click in the editor opens THAT
  //     entry — the same affordance the dataset-aware {{#each}} gives each row.
  //   • SUBEXPRESSION — {{#with (sw-pick-entry …)}} — returns the entry's VALUES (no marker).
  // Accepts entry envelopes ({id,values}) OR a plain values array (uses the element as-is) so it's
  // robust across render + test contexts.
  hb.registerHelper('sw-pick-entry', function swPickEntry(entries: unknown, selectedId: unknown, options?: Handlebars.HelperOptions) {
    const block = options && typeof options.fn === 'function' ? options : undefined;
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
    // PREVIEW: wrap so a click opens this entry's editor (publish has markEntries=false → no wrapper).
    if (root.markEntries && typeof chosen?.id === 'string' && typeof chosen?.dataset === 'string') {
      return new Handlebars.SafeString(`<div data-sw-entry="${escapeAttr(chosen.id)}" data-sw-dataset="${escapeAttr(chosen.dataset)}">${body}</div>`);
    }
    return new Handlebars.SafeString(body);
  });
  // {{sw-truncate text 80}} → clip to N chars with an ellipsis.
  hb.registerHelper('sw-truncate', (value: unknown, max: unknown) => {
    const s = typeof value === 'string' ? value : '';
    const n = typeof max === 'number' && Number.isFinite(max) ? max : 100;
    return s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s;
  });
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
    // Label precedence: explicit hash → translation catalog (reserved `cart_add`, localized per page
    // locale) → built-in English default (RESERVED_TRANSLATION_DEFAULTS).
    const label = str(h.label) || reservedTr(root, 'cart_add') || RESERVED_TRANSLATION_DEFAULTS.cart_add!;
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
    attrs += ` data-currency-symbol="${escapeAttr(tr('cart_currency_symbol'))}"`;
    attrs += ` data-currency-code="${escapeAttr(tr('cart_currency_code'))}"`;
    if (currency.position === 'after') attrs += ` data-currency-pos="after"`;
    if (typeof currency.decimals === 'number') attrs += ` data-currency-decimals="${escapeAttr(String(currency.decimals))}"`;
    // Drawer-string precedence per key: explicit hash → translation catalog (reserved cart_* key, localized
    // per page locale) → built-in English default (RESERVED_TRANSLATION_DEFAULTS, the single source of
    // truth). The default floor makes every label always resolve, so a bare {{sw-cart}} auto-localizes from
    // website.translations with zero per-page wiring and an untranslated locale falls back to English.
    const rt = tr; // alias for the reserved cart_* drawer strings below
    attrs += ` data-cart-title="${escapeAttr(str(h.title) || tr('cart_title'))}"`;
    attrs += ` data-toggle-label="${escapeAttr(str(h.toggle) || rt('cart_toggle'))}"`;
    attrs += ` data-note="${escapeAttr(str(h.note) || tr('cart_note'))}"`;
    attrs += ` data-added-label="${escapeAttr(str(h.added) || rt('cart_added'))}"`;
    attrs += ` data-empty-label="${escapeAttr(str(h.empty) || rt('cart_empty'))}"`;
    attrs += ` data-total-label="${escapeAttr(str(h.total) || rt('cart_total'))}"`;
    attrs += ` data-clear-label="${escapeAttr(str(h.clear) || rt('cart_clear'))}"`;
    attrs += ` data-sent-label="${escapeAttr(str(h.sent) || rt('cart_sent'))}"`;
    // The order-message lead-in ({{sw-cart}} → cart.js prepends it to the deep-link order summary). The
    // "Hi <brand> — " greeting connective in cart.js stays fixed; this lead sentence localizes.
    attrs += ` data-order-lead="${escapeAttr(str(h.orderLead) || rt('cart_order_lead'))}"`;
    // The merchant's brand/business name (the always-present Corporate Identity `name`, projected into the
    // render ctx as `company`) — cart.js uses it for the email greeting ("Hi <brand> — I'd like to order:").
    // Emitted only when present, so a no-args {{sw-cart}} with no identity stays byte-identical.
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
          // `required` only when truthy (mirrors the model.ts projection) — keeps the JSON minimal/explicit.
          return { label: shopLabel(str(fx.key)), type: fx.type, ...(fx.required ? { required: true } : {}) };
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
        // `endpoint` is filled by resolveShopChannels in the render projection (the cart can't build
        // /f/<projectId>/<formId> client-side); a form channel with no resolved endpoint is dropped.
        if (c.kind === 'form') return typeof c.endpoint === 'string' ? { kind: 'form', label, endpoint: c.endpoint } : null;
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
  // data-sw-consent-open, which the consent.js runtime delegates. The label localizes (consent_settings).
  hb.registerHelper('sw-consent-settings', function swConsentSettings(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const h = (options?.hash ?? {}) as Record<string, unknown>;
    const root = (options.data?.root ?? {}) as { website?: { consent?: Record<string, unknown>; t?: Record<string, unknown> } };
    if ((root.website?.consent as Record<string, unknown> | undefined)?.enabled !== true) return new Handlebars.SafeString('');
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    const label = str(h.label) || reservedTr(root, 'consent_settings') || RESERVED_TRANSLATION_DEFAULTS.consent_settings || 'Cookie settings';
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
  // accessible label localizes: explicit hash → reserved `theme_toggle` catalog key → English default.
  hb.registerHelper('sw-theme-toggle', function swThemeToggle(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const h = (options?.hash ?? {}) as Record<string, unknown>;
    const root = (options.data?.root ?? {}) as { website?: { enableThemes?: unknown; t?: Record<string, unknown> } };
    if (root.website?.enableThemes !== true) return new Handlebars.SafeString('');
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    const label =
      str(h.label) || reservedTr(root, 'theme_toggle') || RESERVED_TRANSLATION_DEFAULTS.theme_toggle || 'Toggle dark mode';
    const cls = str(h.class);
    const classAttr = cls ? `sw-theme-toggle ${cls}` : 'sw-theme-toggle';
    // Icons come ONLY from the trusted Lucide map (never tenant input); the `sw-tt-*` class is the CSS
    // picker hook. An absent icon → empty body (button still works) — but sun/moon are stock Lucide.
    const svg = (body: string | undefined, iconClass: string): string =>
      `<svg class="${iconClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
      `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body ?? ''}</svg>`;
    return new Handlebars.SafeString(
      `<button type="button" class="${escapeAttr(classAttr)}" data-sw-theme-toggle ` +
        `aria-label="${escapeAttr(label)}" aria-pressed="false" title="${escapeAttr(label)}">` +
        `${svg(iconBody('sun'), 'sw-tt-sun')}${svg(iconBody('moon'), 'sw-tt-moon')}</button>`,
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
  // ({{edit}} is RETIRED — editable text is now the `data-sw-text="key"` directive, bound to page.data.)
  //
  // {{#each dataset.x}}…{{/each}} — the ONE loop helper, dataset-aware. When the iterated value is an
  // array of DATASET ENTRIES, each iteration's context is the entry's FIELDS (`entry.values`) — so a
  // template reads `{{title}}`, not `{{values.title}}` — and the entry envelope is exposed on the
  // data frame as `@entry` (id/dataset/status). In PREVIEW (`root.markEntries`) each row is wrapped
  // in `<div data-sw-entry data-sw-dataset>` so the editor can open THAT entry's editor on click;
  // OUTSIDE preview there is NO wrapper, so publish output is byte-identical to a plain loop. ANY
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
        out += root.markEntries
          ? `<div data-sw-entry="${escapeAttr(entry.id)}" data-sw-dataset="${escapeAttr(entry.dataset)}">${body}</div>`
          : body;
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

  // {{sw-image url [alt=] [sizes=] [class=] [loading=eager] [format=avif]}}
  // Responsive image for a PROJECT image (a delivery `/media/<slug>/<id>/<name>` url, or a
  // {{#sw-folder}}/dataset item's `url`): emits an <img> with a WebP srcset + intrinsic width/height
  // (no CLS) + a blur-up LQIP + loading=lazy. `format=avif` (or the project's AVIF delivery setting)
  // emits a <picture> with an AVIF source above the WebP one. An external/unknown url degrades to a
  // plain lazy <img>. The server serves each ?size on demand; publish materializes referenced files.
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
      format: hash.format === 'avif' || root.imageAvif === true ? 'avif' : 'webp',
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
  const data = { company: ctx.company, website: ctx.website, page, pages: ctx.pages, dataset: ctx.dataset, item: ctx.item, nav: ctx.nav, media: ctx.media, imageAvif: ctx.imageAvif, markEntries: ctx.markEntries, forms: ctx.forms };
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
      hcaptchaSiteKey: ctx.hcaptchaSiteKey,
      preview: ctx.preview,
    });
  } catch (err) {
    throw new TemplateError(err instanceof Error ? err.message : 'form embed failed');
  }
  // Pair every `data-sw-component="x"` with the `data-sw-block="X"` its stylesheet is keyed on, so
  // source that authored only the component marker still gets the component's CSS (unsized slides /
  // a visible "Slide x of y" live region / inert controls otherwise). No-op without a marker.
  html = addComponentBlockMarkers(html);
  const max = opts.maxOutput ?? DEFAULT_MAX_OUTPUT;
  if (html.length > max) throw new TemplateError('template output exceeded the size limit');
  return html;
}
