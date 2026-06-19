// HTML → faithful literal-HTML page source. The output contains NO Handlebars ({{ }}) — which is the
// whole trick: literal HTML with no mustaches passes `validateTemplate` (its URL-attr/style/unquoted
// checks only run inside a mustache). So we only have to obey the structural rules: no <script>, none
// of the four skeleton landmarks (<nav>/<main>/<footer>/<aside>), no on* handlers, and no stray `{{`.
import { validateTemplate } from '@sitewright/blocks';
import { removeElement, textContent } from 'domutils';
import {
  elements,
  eachTextLike,
  getBody,
  neutralizeMustaches,
  serialize,
  type AnyNode,
  type Document,
  type Element,
} from '../dom.js';
import { assetKey, pickFromSrcset, resolveUrl, rewriteHref, SYNTHETIC_HOST } from '../url-util.js';
import type { ImportDiagnostic, ImportLimits } from '../types.js';

/** Skeleton-owned landmarks the platform declares once — author content must use a neutral element. */
const LANDMARK_TAGS = new Set(['nav', 'main', 'footer', 'aside']);
/** Elements removed outright from a page source (no execution / no foreign embeds we can't self-host). */
const REMOVE_TAGS = new Set(['script', 'noscript', 'template', 'style', 'object', 'embed', 'applet', 'base']);

export interface TransformCtx {
  /** This page's own source URL — the base for resolving its relative references. */
  pageUrl: string;
  /** The captured site's base — classifies internal vs external links. */
  siteBase: string;
  /** normalized page URL → FINAL Sitewright route (so links point where pages actually landed). */
  internalRoutes: ReadonlyMap<string, string>;
  /** asset key → hosted `AssetRef` (`/media/...`). */
  assetMap: ReadonlyMap<string, string>;
  limits: ImportLimits;
}

/** Rewrite an image-bearing URL to its hosted ref; keep an absolute https hotlink; else null (drop). */
function imageRef(raw: string, ctx: TransformCtx): string | null {
  // Inline data:image URIs are already self-contained — keep them verbatim (no hosting needed).
  if (/^data:image\//i.test(raw.trim())) return raw.trim();
  const key = assetKey(raw, ctx.pageUrl);
  if (key && ctx.assetMap.has(key)) return ctx.assetMap.get(key) ?? null;
  const abs = resolveUrl(raw, ctx.pageUrl);
  if (!abs || !/^https:\/\//i.test(abs)) return null;
  // A miss on the synthetic upload host is a dead link (no real server) → drop it, don't "hotlink".
  try {
    if (new URL(abs).host === SYNTHETIC_HOST) return null;
  } catch {
    return null;
  }
  return abs;
}

/** Rewrite every `url(...)` inside an inline style: hosted ref if known, else absolute https, else left. */
function rewriteStyleUrls(style: string, ctx: TransformCtx): string {
  return style.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, _q: string, url: string) => {
    const ref = imageRef(url, ctx);
    return ref ? `url('${ref}')` : whole;
  });
}

/**
 * Mutate a set of nodes (and their descendants) into source-safe literal HTML: rename landmarks, drop
 * forbidden elements, strip on* and data-sw-* attributes, rewrite URLs (links → routes, images → hosted
 * refs), and neutralize stray `{{`. Pushes diagnostics for anything dropped/changed materially.
 */
export function sanitizeForSource(nodes: AnyNode[], ctx: TransformCtx, diags: ImportDiagnostic[]): void {
  // First remove forbidden elements (snapshot, since removeElement mutates the tree).
  for (const el of elements(nodes)) {
    if (REMOVE_TAGS.has(el.name)) {
      if (el.name === 'script') diags.push({ code: 'script-dropped', message: 'inline/external <script> removed', page: ctx.pageUrl });
      else if (el.name === 'style') diags.push({ code: 'style-removed', message: '<style> block removed (CSS hoisted separately)', page: ctx.pageUrl });
      removeElement(el);
    }
  }
  // Then rewrite the survivors.
  for (const el of elements(nodes)) {
    if (LANDMARK_TAGS.has(el.name)) {
      el.name = 'div';
      el.tagName = 'div';
    }
    if (el.name === 'form') {
      el.name = 'div';
      el.tagName = 'div';
      diags.push({ code: 'form-inerted', message: '<form> converted to an inert <div>', page: ctx.pageUrl });
    }
    rewriteElementAttrs(el, ctx, diags);
  }
  // Finally neutralize braces in every text/comment node so no literal {{ survives.
  eachTextLike(nodes, (n) => {
    n.data = neutralizeMustaches(n.data);
  });
}

function rewriteElementAttrs(el: Element, ctx: TransformCtx, diags: ImportDiagnostic[]): void {
  const isImageEl = el.name === 'img';
  const isMediaSource = el.name === 'source' || el.name === 'picture';
  /* eslint-disable security/detect-object-injection -- `name` iterates the element's OWN attribute keys (a plain parsed Record), not attacker-controlled object access */
  for (const name of Object.keys(el.attribs)) {
    const value = el.attribs[name] ?? '';
    // Event handlers + forged platform markers are stripped (on* would even fail validateTemplate).
    if (name.startsWith('on') || name.startsWith('data-sw-')) {
      delete el.attribs[name];
      continue;
    }
    if (name === 'srcset' || name === 'imagesrcset') {
      const pick = pickFromSrcset(value);
      const ref = pick ? imageRef(pick, ctx) : null;
      if (ref && !el.attribs.src && (isImageEl || isMediaSource)) el.attribs.src = ref;
      delete el.attribs[name];
      continue;
    }
    if (name === 'href') {
      const decision = rewriteHref(value, ctx.pageUrl, ctx.siteBase, ctx.internalRoutes);
      if (decision.kind === 'set') el.attribs.href = decision.value;
      else if (decision.kind === 'unsafe') {
        el.attribs.href = '#';
        diags.push({ code: 'unsafe-url-dropped', message: `unsafe href "${truncate(value)}" → #`, page: ctx.pageUrl });
      }
      continue;
    }
    if (name === 'src') {
      if (el.name === 'iframe') {
        const abs = resolveUrl(value, ctx.pageUrl);
        if (abs && /^https:\/\//i.test(abs)) el.attribs.src = abs;
        else removeElement(el);
      } else if (isImageEl || isMediaSource || el.name === 'video' || el.name === 'audio') {
        const ref = el.name === 'video' || el.name === 'audio' ? keepHttps(value, ctx) : imageRef(value, ctx);
        if (ref) el.attribs.src = ref;
        else delete el.attribs.src;
      }
      continue;
    }
    if (name === 'poster') {
      const ref = imageRef(value, ctx);
      if (ref) el.attribs.poster = ref;
      else delete el.attribs.poster;
      continue;
    }
    if (name === 'style') {
      el.attribs.style = neutralizeMustaches(rewriteStyleUrls(value, ctx));
      continue;
    }
    // Any other attribute: just make sure it can't smuggle a mustache.
    el.attribs[name] = neutralizeMustaches(value);
  }
  /* eslint-enable security/detect-object-injection */
}

function keepHttps(raw: string, ctx: TransformCtx): string | null {
  const abs = resolveUrl(raw, ctx.pageUrl);
  return abs && /^https:\/\//i.test(abs) ? abs : null;
}

function truncate(s: string): string {
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

/** The body children to use as the page's content (the <body>, or the whole doc for a bare fragment). */
function contentNodes(doc: Document): AnyNode[] {
  const body = getBody(doc);
  if (body) return body.children;
  // Bare fragment: drop a stray <head>/<html> wrapper if the parser synthesized one.
  return doc.children;
}

/**
 * Keep the longest prefix of top-level children whose serialized bytes fit `maxBytes` (well-formed
 * HTML — never splits an element). O(n): each child is serialized once. `droppedAll` means not even the
 * first child fit, so the caller falls back to text.
 */
function fitSource(nodes: AnyNode[], maxBytes: number): { source: string; truncated: boolean; droppedAll: boolean } {
  const parts = nodes.map((n) => serialize(n));
  const full = parts.join('');
  if (byteLength(full) <= maxBytes) return { source: full, truncated: false, droppedAll: false };
  const kept: string[] = [];
  let total = 0;
  for (const part of parts) {
    const b = byteLength(part);
    if (total + b > maxBytes) break;
    kept.push(part);
    total += b;
  }
  return { source: kept.join(''), truncated: true, droppedAll: kept.length === 0 && parts.length > 0 };
}

function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/**
 * Transform a parsed document's body into a page `source` guaranteed to pass `validateTemplate`.
 * On the rare chance the transform still produces invalid source, falls back to escaped text content.
 */
export function transformBody(doc: Document, ctx: TransformCtx): { source: string; diagnostics: ImportDiagnostic[] } {
  const diagnostics: ImportDiagnostic[] = [];
  const nodes = contentNodes(doc);
  sanitizeForSource(nodes, ctx, diagnostics);
  const maxBytes = ctx.limits.maxSourceBytes;
  const fit = fitSource(nodes, maxBytes);
  let source = fit.source;
  // A single oversized top-level element can't be trimmed by dropping siblings → fall back to text.
  if (fit.droppedAll) {
    source = textFallback(nodes, maxBytes);
    diagnostics.push({ code: 'source-truncated', message: 'oversized page reduced to text to fit the source cap', page: ctx.pageUrl });
  } else if (fit.truncated) {
    diagnostics.push({ code: 'source-truncated', message: 'page trimmed to fit the source size cap', page: ctx.pageUrl });
  }
  try {
    validateTemplate(source);
    return { source, diagnostics };
  } catch {
    diagnostics.push({ code: 'invalid-source-fallback', message: 'transformed source failed validation; fell back to text', page: ctx.pageUrl });
    return { source: textFallback(nodes, maxBytes), diagnostics };
  }
}

/** Escaped, mustache-safe text content of `nodes`, wrapped in a div and shrunk to fit the byte cap. */
function textFallback(nodes: AnyNode[], maxBytes: number): string {
  let text = neutralizeMustaches(escapeHtml(textContent(nodes).trim()));
  const wrap = (t: string): string => `<div class="sw-import-fallback">${t}</div>`;
  while (text.length > 0 && byteLength(wrap(text)) > maxBytes) {
    text = text.slice(0, Math.floor(text.length * 0.9));
  }
  return wrap(text);
}

/**
 * Transform a chrome subtree (header/footer) into a validated skeleton-slot string, capped to the slot
 * byte limit. Returns null if it can't be made valid or doesn't fit — the caller then leaves the chrome
 * inline on each page instead of extracting it.
 */
export function transformFragment(node: Element, ctx: TransformCtx, maxBytes: number): string | null {
  const diags: ImportDiagnostic[] = [];
  sanitizeForSource([node], ctx, diags);
  const html = serialize(node);
  if (byteLength(html) > maxBytes) return null;
  try {
    validateTemplate(html);
    return html;
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
