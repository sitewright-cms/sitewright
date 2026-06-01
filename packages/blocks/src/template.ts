// Sitewright's code-first template renderer — Handlebars, hardened.
//
// We use Handlebars (a standard language AI agents know, and our authors know) but lock
// it down for SEMI-TRUSTED, code-authoring tenants. The TEMPLATE is author-written; the
// bound VALUES (datasets / page content) are untrusted. Handlebars HTML-escapes `{{ }}`
// values, but — like every text template language — it is NOT context-aware, so we add:
//   1. `validateTemplate`: a best-effort HTML-context scanner (ported from the earlier
//      no-eval engine) that REJECTS interpolation in the un-escapable contexts (unquoted
//      attribute, `<script>`/`<style>`, event-handler/`style` attribute, HTML comment),
//      bans `{{{ raw }}}`, and requires the `{{url …}}` helper inside URL attributes.
//   2. strict runtime config: prototype access OFF (where Handlebars' RCE CVEs lived),
//      only our curated helpers, partials passed per-render (no global cross-tenant state).
//   3. a bounded compiled-template cache (so repeat renders skip the `new Function` step).
//
// The remaining hard limits (CPU/time/memory/output) are enforced by the isolated render
// worker that runs this — see apps/api/src/render. This module is pure + synchronous.
import Handlebars from 'handlebars';
import { safeUrl } from './url.js';

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
  /** Named values/collections, addressable as `{{ data.* }}` / `{{#each data.* }}`. */
  data?: Record<string, unknown>;
  /** Named partials, included via `{{> name}}`; passed per-render (no global state). */
  partials?: Record<string, string>;
}

const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster', 'cite', 'background', 'xlink:href']);
/** Max distinct compiled templates kept in memory (LRU-ish; bounds the worker's heap). */
const COMPILE_CACHE_LIMIT = 200;

// ---------------------------------------------------------------- save-time validation
/**
 * Best-effort HTML-context check over a template's literal text (treating `{{ … }}` as
 * holes). Throws {@link TemplateError} if an OUTPUT mustache sits in a context a single
 * HTML-escaper cannot make safe, if `{{{ raw }}}` is used, or if a URL attribute uses a
 * bare interpolation instead of the `{{url …}}` helper.
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
        'use the {{url …}} helper for href/src; no <script>, inline on* handlers, {{{ raw }}}, ' +
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
        const isUrlHelper = /^url(\s|$)/.test(inner);
        if (valuePrefix === '') {
          // The interpolation is the whole value → it must be sanitized by {{url …}}.
          if (!isUrlHelper) reject(`a bare value in the URL attribute "${attrName}" (use {{url …}})`);
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
  hb.unregisterHelper('log');
  // {{url page.link}} → scheme-sanitized URL (blocks javascript:/data:/protocol-relative).
  hb.registerHelper('url', (value: unknown) => safeUrl(typeof value === 'string' ? value : ''));
  // {{date page.publishedAt}} → UTC YYYY-MM-DD; {{date x "iso"}} → full ISO; "" if unparseable.
  hb.registerHelper('date', (value: unknown, format?: unknown) => {
    const d = value instanceof Date ? value : new Date(typeof value === 'string' || typeof value === 'number' ? value : NaN);
    if (Number.isNaN(d.getTime())) return '';
    if (format === 'iso') return d.toISOString();
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  });
  // {{truncate text 80}} → clip to N chars with an ellipsis.
  hb.registerHelper('truncate', (value: unknown, max: unknown) => {
    const s = typeof value === 'string' ? value : '';
    const n = typeof max === 'number' && Number.isFinite(max) ? max : 100;
    return s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s;
  });
  return hb;
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
    // the pure built-in logic helpers + our curated url/date/truncate (log removed);
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
  const template = compileCached(source);
  const data = { company: ctx.company, website: ctx.website, page: ctx.page, data: ctx.data };
  let html: string;
  try {
    html = template(data, {
      partials: ctx.partials,
      // Prototype access OFF — this is where Handlebars' historical RCEs lived.
      allowProtoPropertiesByDefault: false,
      allowProtoMethodsByDefault: false,
    });
  } catch (err) {
    throw new TemplateError(err instanceof Error ? `render error: ${err.message}` : 'render error');
  }
  const max = opts.maxOutput ?? DEFAULT_MAX_OUTPUT;
  if (html.length > max) throw new TemplateError('template output exceeded the size limit');
  return html;
}
