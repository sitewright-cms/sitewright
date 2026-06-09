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
import { escapeAttr } from './escape.js';
import { iconBody } from './icons.js';
import { resolveDirectives } from './directives.js';

/** Thrown for an unsafe interpolation context, a Handlebars compile error, or a render error. */
export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

/** The whitelisted binding namespaces a template may read. */
export interface TemplateContext {
  company?: Record<string, unknown>;
  website?: Record<string, unknown>;
  page?: Record<string, unknown>;
  /**
   * The current page's direct PARENT as a lean read-only view (`{{ parentPage.path }}`,
   * `{{ parentPage.data.* }}`) — absent for a tree root / home or an orphan. Built by `parentPageView`
   * in @sitewright/core; one level only (no nested `parentPage.parentPage`).
   */
  parentPage?: Record<string, unknown>;
  /** Named values/collections, addressable as `{{ data.* }}` / `{{#each data.* }}`. */
  data?: Record<string, unknown>;
  /**
   * Directly-addressable dataset entries by key: `{{ item.<dataset>.<entryId>.<field> }}` — the
   * keyed twin of the `data.<dataset>` array, for lookups without a loop. Built per-render (and only
   * for the datasets a source references) by `keyedDatasets` in @sitewright/core.
   */
  item?: Record<string, Record<string, unknown>>;
  /** Named partials, included via `{{> name}}`; passed per-render (no global state). */
  partials?: Record<string, string>;
  /** Auto-built navigation menus per slot — `{{#each nav.header}}…{{/each}}` (the skeleton slots + page source). */
  nav?: Record<string, unknown>;
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
}


const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster', 'cite', 'background', 'xlink:href']);
/** Max distinct compiled templates kept in memory (LRU-ish; bounds the worker's heap). */
const COMPILE_CACHE_LIMIT = 200;

// ---------------------------------------------------------------- save-time validation
/**
 * Best-effort HTML-context check over a template's literal text (treating `{{ … }}` as
 * holes). Throws {@link TemplateError} if an OUTPUT mustache sits in a context a single
 * HTML-escaper cannot make safe, if `{{{ raw }}}` is used, or if a URL attribute uses a
 * bare interpolation instead of the `{{sw-url …}}` helper.
 */
export function validateTemplate(source: string): void {
  type Mode = 'body' | 'comment' | 'rawtext' | 'tag';
  let mode: Mode = 'body';
  let rawCloser = '';
  let sub: 'name' | 'preAttr' | 'attrName' | 'afterName' | 'preValue' | 'value' = 'name';
  let attrName = '';
  let quote: '"' | "'" | '' = '';
  // The literal value content before the current point (capped) — used to decide whether
  // a URL attribute's scheme is already fixed by a safe prefix.
  let valuePrefix = '';
  let pendingRaw = '';

  function reject(reason: string): never {
    throw new TemplateError(
      `unsafe template: ${reason}. Bind values only in element text or QUOTED attributes; ` +
        'use the {{sw-url …}} helper for href/src; no <script>, inline on* handlers, {{{ raw }}}, ' +
        'or interpolation in an unquoted attribute, style/<style>, or an HTML comment.',
    );
  }

  // Reject an inline event-handler attribute (no tenant JS) once its name is complete.
  function finishAttrName(): void {
    if (attrName.startsWith('on')) reject(`an inline "${attrName}" event-handler attribute`);
  }

  // Classify the current context for an output mustache, throwing if it is unsafe.
  function checkOutput(inner: string): void {
    if (mode === 'comment' || mode === 'rawtext') reject(`an interpolation in a ${mode === 'rawtext' ? '<style>' : 'comment'} block`);
    if (mode === 'tag') {
      if (sub !== 'value') reject('an interpolation in an unquoted attribute or tag structure');
      if (quote === '') reject('an interpolation in an unquoted attribute value');
      if (attrName.startsWith('on') || attrName === 'style') reject(`an interpolation in the "${attrName}" attribute`);
      if (URL_ATTRS.has(attrName)) {
        const isUrlHelper = /^sw-url(\s|$)/.test(inner);
        if (valuePrefix === '') {
          // The interpolation is the whole value → it must be sanitized by {{sw-url …}}.
          if (!isUrlHelper) reject(`a bare value in the URL attribute "${attrName}" (use {{sw-url …}})`);
        } else if (!/^(#|\/(?!\/)|https?:\/\/)/i.test(valuePrefix)) {
          // A literal prefix only fixes the scheme when it starts with /, #, or http(s)://.
          // `j{{x}}` (→ javascript:) and `//{{x}}` (protocol-relative) are rejected here.
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
      if (close === -1) throw new TemplateError('unclosed "{{" tag');
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
  // {{sw-url page.link}} → scheme-sanitized URL (blocks javascript:/data:/protocol-relative).
  hb.registerHelper('sw-url', (value: unknown) => safeUrl(typeof value === 'string' ? value : ''));
  // {{sw-date page.publishedAt}} → UTC YYYY-MM-DD; {{sw-date x "iso"}} → full ISO; "" if unparseable.
  hb.registerHelper('sw-date', (value: unknown, format?: unknown) => {
    const d = value instanceof Date ? value : new Date(typeof value === 'string' || typeof value === 'number' ? value : NaN);
    if (Number.isNaN(d.getTime())) return '';
    if (format === 'iso') return d.toISOString();
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  });
  // {{sw-icon "arrow-right" "h-5 w-5"}} → inline a built-in Lucide icon as an <svg>. The
  // body comes ONLY from the trusted `iconBody` map (unknown name → empty, NEVER user
  // input), and the optional class string is attribute-escaped — so this emits a
  // SafeString (raw SVG) without ever reflecting tenant markup. Author-supplied DATA is
  // just the icon NAME (a map key) + a class list. Use in element context. A field literally
  // named `icon` (e.g. a card's emoji) is read plainly as `{{icon}}`, never shadowed by this.
  hb.registerHelper('sw-icon', (name: unknown, cls?: unknown) => {
    const body = typeof name === 'string' ? iconBody(name) : undefined;
    if (body === undefined) return new Handlebars.SafeString('');
    const klass = typeof cls === 'string' ? cls : 'h-5 w-5';
    const svg =
      `<svg class="${escapeAttr(klass)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
      `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    return new Handlebars.SafeString(svg);
  });
  // {{sw-truncate text 80}} → clip to N chars with an ellipsis.
  hb.registerHelper('sw-truncate', (value: unknown, max: unknown) => {
    const s = typeof value === 'string' ? value : '';
    const n = typeof max === 'number' && Number.isFinite(max) ? max : 100;
    return s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s;
  });
  // ({{edit}} is RETIRED — editable text is now the `data-sw-text="key"` directive, bound to page.data.)
  //
  // {{#each data.x}}…{{/each}} — the ONE loop helper, dataset-aware. When the iterated value is an
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
  return hb;
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
 * `data.<dataset>`. We detect it structurally (string `id` + string `dataset` + object `values`) so
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
    // the pure built-in logic helpers + our curated sw-url/sw-date/sw-icon/sw-truncate (log removed);
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
  const data = { company: ctx.company, website: ctx.website, page: ctx.page, parentPage: ctx.parentPage, data: ctx.data, item: ctx.item, nav: ctx.nav, markEntries: ctx.markEntries };
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
    // Single store: every directive reads page.data (bare key → top-level prop; `data.<path>` → nested).
    data: ctx.page?.data as Record<string, unknown> | undefined,
    preview: ctx.preview,
  });
  const max = opts.maxOutput ?? DEFAULT_MAX_OUTPUT;
  if (html.length > max) throw new TemplateError('template output exceeded the size limit');
  return html;
}
