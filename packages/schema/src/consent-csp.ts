// CONSENT MANAGER — third-party gating support: the curated CSP origin bundles per preset, the runtime
// descriptors the auto-injected consent mount bakes into the config, and the per-site CSP builders consumed by
// BOTH the serve-time response header (apps/api app.ts /sites/:slug/*) and the build-time <meta> (build.ts).
//
// SECURITY MODEL (the invariants a reviewer checks): CSP allowlists ORIGINS, never URLs. We add only
// SPECIFIC https origins — NEVER 'unsafe-inline' / 'unsafe-eval' / '*'. The bundles are curated + versioned
// in-repo (an owner picks a preset, never types a URL); a `custom` integration contributes only its own
// https `src` host (+ schema-validated bare-hostname `origins`). The widening is PER-SITE and OPT-IN: a
// site with no integrations gets no widened CSP (it keeps the strict `default-src 'self'` default).

import type { Consent, ConsentIntegration } from './website.js';
import { CONSENT_CATEGORY_VALUES } from './website.js';

type ConsentCategory = (typeof CONSENT_CATEGORY_VALUES)[number];

/** The category an auto-gated author `<iframe>` falls into when it carries no explicit marker / site default. */
export const DEFAULT_EMBED_CATEGORY: ConsentCategory = 'functional';

/** The CSP directives a preset/integration can contribute to (bare hostnames; https:// is prepended later). */
export interface CspOrigins {
  script: string[];
  frame: string[];
  connect: string[];
  img: string[];
  style: string[];
  font: string[];
}

const EMPTY: CspOrigins = { script: [], frame: [], connect: [], img: [], style: [], font: [] };

/**
 * Curated, versioned origin bundles per preset. Maintained in-repo — the owner picks a preset and never
 * types a URL. Bare hostnames (a single leading `*.` wildcard allowed); the builders prepend `https://`.
 */
export const CONSENT_PRESET_ORIGINS: Readonly<Record<'ga4' | 'gtm', CspOrigins>> = {
  ga4: {
    script: ['www.googletagmanager.com'],
    frame: [],
    connect: ['www.google-analytics.com', '*.analytics.google.com', '*.google-analytics.com', 'www.googletagmanager.com'],
    img: ['www.google-analytics.com', 'www.googletagmanager.com'],
    style: [],
    font: [],
  },
  gtm: {
    script: ['www.googletagmanager.com'],
    frame: [],
    connect: ['www.googletagmanager.com', 'www.google-analytics.com', '*.analytics.google.com', '*.google-analytics.com'],
    img: ['www.googletagmanager.com', 'www.google-analytics.com'],
    style: [],
    font: [],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// AUTHOR-CONTENT GATING — any cross-origin author `<iframe>` (an embed: YouTube/Vimeo/Maps/Calendly/…) is
// held click-to-load when the manager is enabled, and a `<script type="text/plain" data-sw-consent="cat">`
// is activated on consent. The publisher derives the per-page CSP from the origins these reference: every
// cross-origin iframe → `frame-src`, every gated script → `script-src`+`connect-src`. (Replaces the curated
// embed-provider list — origin-agnostic, so any provider works without an in-repo allow-list entry.)
//
// The HTML this scans/rewrites is POST-render + POST-sanitize (well-formed, attribute values escaped), so a
// `<iframe\b[^>]*>` match is safe — an escaped `&gt;` carries no raw `>`. Origins are re-validated as bare
// hostnames before they enter a CSP directive (defence-in-depth, identical to the `custom` integration host).

// Quote-AWARE tag matchers: an attribute value in quotes may itself contain a `>` (e.g. a Maps URL), so a
// naive `[^>]*` would truncate the tag and let an iframe slip past the gate. Each alternative starts with a
// distinct char (`"`, `'`, or other) so there is no backtracking ambiguity (no ReDoS).
const IFRAME_TAG_RE = /<iframe\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
const SCRIPT_OPEN_TAG_RE = /<script\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;

/** Read an attribute's value from a tag's inner-attribute string (double-quoted, single-quoted, OR unquoted). */
function attrValue(attrs: string, name: string): string | undefined {
  // eslint-disable-next-line security/detect-non-literal-regexp -- `name` is a fixed internal attribute literal (src / data-sw-consent[-src] — `[a-z-]` only, no regex metacharacters), never user input.
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : undefined;
}

/** True when the tag carries a bare/boolean marker attribute (e.g. `data-sw-consent-skip`). */
function hasFlag(attrs: string, name: string): boolean {
  // eslint-disable-next-line security/detect-non-literal-regexp -- `name` is a fixed internal attribute literal (see attrValue), never user input.
  return new RegExp(`(?:^|\\s)${name}(?=[\\s=>/]|$)`, 'i').test(attrs);
}

/**
 * The external https host an author URL points at, or null for a same-origin/relative URL, a non-https
 * scheme, or a host that isn't a clean bare hostname. Protocol-relative `//host/…` is treated as https.
 */
function externalHttpsHost(src: string | null | undefined): string | null {
  if (!src) return null;
  let u: URL;
  try {
    u = new URL(src, 'https://__sw_local__/'); // relative URLs resolve to the dummy host → skipped below
  } catch {
    return null;
  }
  if (u.hostname === '__sw_local__' || u.protocol !== 'https:') return null;
  return HOST_TOKEN_RE.test(u.host) ? u.host : null;
}

/** The explicit per-iframe override category from a `data-sw-consent="<category>"` marker (raw HTML only). */
function markerCategory(attrs: string): ConsentCategory | null {
  const v = attrValue(attrs, 'data-sw-consent');
  return v && (CONSENT_CATEGORY_VALUES as readonly string[]).includes(v) ? (v as ConsentCategory) : null;
}

/**
 * CSP origins an author HTML body contributes: each cross-origin `<iframe>` (gated or not) → `frame-src`;
 * each gated `<script type="text/plain" data-sw-consent …>` with an https `src` → `script-src`+`connect-src`.
 * Reads both un-gated `src` and the already-gated `data-sw-consent-src` so it is order-independent.
 */
export function authorContentCspOrigins(html: string | null | undefined): Pick<CspOrigins, 'frame' | 'script' | 'connect'> {
  const frame = new Set<string>();
  const script = new Set<string>();
  const connect = new Set<string>();
  if (typeof html === 'string' && html.length > 0) {
    for (const m of html.matchAll(IFRAME_TAG_RE)) {
      const attrs = m[1] ?? '';
      const h = externalHttpsHost(attrValue(attrs, 'src') ?? attrValue(attrs, 'data-sw-consent-src'));
      if (h) frame.add(h);
    }
    for (const m of html.matchAll(SCRIPT_OPEN_TAG_RE)) {
      const attrs = m[1] ?? '';
      if (!/type\s*=\s*("text\/plain"|'text\/plain')/i.test(attrs) || !hasFlag(attrs, 'data-sw-consent')) continue;
      const h = externalHttpsHost(attrValue(attrs, 'src'));
      if (h) {
        script.add(h);
        connect.add(h);
      }
    }
  }
  return { frame: [...frame], script: [...script], connect: [...connect] };
}

/**
 * Neutralize cross-origin author `<iframe>`s so they don't load until consent: move `src` → a held
 * `data-sw-consent-src` and stamp the gating category (`data-sw-consent="x"` override, else `defaultCategory`).
 * Same-origin/relative iframes, an explicit `data-sw-consent-skip` opt-out, and already-gated iframes pass
 * through untouched. Caller invokes this ONLY when the consent manager is enabled (consent off → iframes load
 * normally, their origin still allow-listed via {@link authorContentCspOrigins}). Idempotent.
 */
export function gateAuthorIframes(html: string, opts: { defaultCategory?: ConsentCategory } = {}): string {
  if (typeof html !== 'string' || !/<iframe\b/i.test(html)) return html;
  const def = opts.defaultCategory ?? DEFAULT_EMBED_CATEGORY;
  return html.replace(IFRAME_TAG_RE, (full, attrs: string) => {
    if (hasFlag(attrs, 'data-sw-consent-skip') || hasFlag(attrs, 'data-sw-consent-src')) return full; // opt-out / already gated
    const src = attrValue(attrs, 'src');
    if (!src || !externalHttpsHost(src)) return full; // same-origin / relative / non-https → leave as-is
    const cat = markerCategory(attrs) ?? def;
    const stripped = attrs.replace(/\s+src\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '');
    // `src` may be SINGLE-quoted or unquoted (raw `website.head`/import HTML isn't attribute-escaped), so it can
    // carry a `"`. Re-embedding it in a DOUBLE-quoted attribute requires escaping `"` → `&quot;` (the only
    // breakout char here) so it can't open a new attribute (e.g. onload=/style=). NOT escaping `&` — that would
    // double-encode an already-escaped `&amp;` from rendered rich content and corrupt the URL.
    return `<iframe${stripped} data-sw-consent-src="${src.replace(/"/g, '&quot;')}" data-sw-consent-cat="${cat}">`;
  });
}

/** How the runtime loads one integration: a self-origin bootstrap (ga4/gtm) + an external `src`, or a plain script. */
export interface ConsentIntegrationRuntime {
  /** Stable id (de-dupe key + the data attribute on the injected <script>). */
  id: string;
  /** The gating category. */
  cat: 'functional' | 'analytics' | 'marketing';
  /** ga4 (gtag) | gtm (Tag Manager) | script (a plain external <script src>). */
  kind: 'ga4' | 'gtm' | 'script';
  /** The external script URL to inject (always https; for ga4/gtm it's the gtag/gtm loader). */
  src: string;
  /** ga4/gtm measurement/container id (for the self-origin bootstrap consent.js runs). */
  mid?: string;
  /** Load async (default true). */
  async: boolean;
}

/** A bare hostname with an optional port — no ';'/space/',' (those would break out of a CSP directive). */
const HOST_TOKEN_RE = /^[a-z0-9.-]+(:\d+)?$/i;
/** A bare hostname OR a single leading `*.` wildcard (the shape `origins`/`frameOrigins` allow) — no CSP separators. */
const CSP_HOST_TOKEN_RE = /^(?:\*\.)?[a-z0-9.-]+$/i;

const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.host : null;
  } catch {
    return null;
  }
};

/** The runtime descriptor the consent mount bakes into the config for one integration. */
export function integrationRuntimeInfo(i: ConsentIntegration): ConsentIntegrationRuntime | null {
  const preset = i.preset ?? 'custom';
  if (preset === 'ga4' && i.measurementId)
    return { id: i.id, cat: i.category, kind: 'ga4', mid: i.measurementId, src: `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(i.measurementId)}`, async: true };
  if (preset === 'gtm' && i.measurementId)
    return { id: i.id, cat: i.category, kind: 'gtm', mid: i.measurementId, src: `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(i.measurementId)}`, async: true };
  if (preset === 'custom' && i.src && hostOf(i.src)) return { id: i.id, cat: i.category, kind: 'script', src: i.src, async: i.async !== false };
  return null; // an invalid integration contributes nothing (defence-in-depth over the schema)
}

/** The runtime descriptors for all valid integrations (what the helper bakes; the runtime injects on consent). */
export function consentRuntimeIntegrations(consent: Consent | undefined): ConsentIntegrationRuntime[] {
  return (consent?.integrations ?? []).map(integrationRuntimeInfo).filter((x): x is ConsentIntegrationRuntime => x !== null);
}

/**
 * Aggregate, deduped CSP origins. The REGISTRY integrations (script-src/connect-src, plus a script SDK's
 * own `frameOrigins` for an injected widget iframe) are gated on `consent.enabled`; the `extraOrigins`
 * (an author page's cross-origin iframes → frame-src and gated scripts → script/connect, from
 * {@link authorContentCspOrigins}) are added independently — a held iframe still needs its frame-src origin
 * whether or not the manager is enabled.
 */
export function consentCspOrigins(consent: Consent | undefined, extraOrigins: Partial<CspOrigins> = {}): CspOrigins {
  const acc: Record<keyof CspOrigins, Set<string>> = { script: new Set(), frame: new Set(), connect: new Set(), img: new Set(), style: new Set(), font: new Set() };
  const mergeBundle = (b: Partial<CspOrigins>): void => (Object.keys(acc) as (keyof CspOrigins)[]).forEach((k) => (b[k] ?? []).forEach((h) => acc[k].add(h)));
  mergeBundle(extraOrigins);
  for (const i of consent?.enabled === true ? consent.integrations ?? [] : []) {
    const preset = i.preset ?? 'custom';
    mergeBundle(preset === 'ga4' || preset === 'gtm' ? CONSENT_PRESET_ORIGINS[preset] : EMPTY);
    if (preset === 'custom') {
      const h = i.src ? hostOf(i.src) : null;
      // Re-validate the extracted host as a bare hostname(+optional port) before it enters the CSP — a
      // ';'/space/',' (from a parseable-but-malformed URL like `https://evil.com;`) must never break out
      // of the directive. No injection risk either way (browsers ignore an invalid token), but stay clean.
      if (h && HOST_TOKEN_RE.test(h)) acc.script.add(h);
    }
    // The advanced `origins` cover a script's own fan-out (CDN / websocket) → script-src + connect-src.
    // Re-validate each as a bare/wildcard host before it enters the CSP (defence-in-depth over the schema's
    // CSP_HOST_RE — a bad value from a direct DB write / restored backup can't break out of the directive).
    for (const o of i.origins ?? []) {
      if (!CSP_HOST_TOKEN_RE.test(o)) continue;
      acc.script.add(o);
      acc.connect.add(o);
    }
    // `frameOrigins` cover a script SDK that injects its OWN widget <iframe> (e.g. a chat bubble) → frame-src.
    for (const o of i.frameOrigins ?? []) if (CSP_HOST_TOKEN_RE.test(o)) acc.frame.add(o);
  }
  return {
    script: [...acc.script],
    frame: [...acc.frame],
    connect: [...acc.connect],
    img: [...acc.img],
    style: [...acc.style],
    font: [...acc.font],
  };
}

const hasAny = (o: CspOrigins): boolean => (Object.values(o) as string[][]).some((a) => a.length > 0);
const https = (hosts: string[]): string => hosts.map((h) => `https://${h}`).join(' ');

/**
 * The widened response-header CSP for a consent-enabled site WITH integrations, or `undefined` when there
 * is nothing to widen (caller then leaves the strict `default-src 'self'` default in place). Adds ONLY the
 * specific https origins; never 'unsafe-inline'/'unsafe-eval'/'*'. Keeps frame-ancestors 'none'.
 */
export function buildSiteCspHeader(consent: Consent | undefined, extraOrigins: Partial<CspOrigins> = {}): string | undefined {
  const o = consentCspOrigins(consent, extraOrigins);
  if (!hasAny(o)) return undefined;
  const parts = [
    "default-src 'self'",
    `script-src 'self'${o.script.length ? ' ' + https(o.script) : ''}`,
    'img-src \'self\' data: https:',
    `style-src 'self' 'unsafe-inline'${o.style.length ? ' ' + https(o.style) : ''}`,
    `font-src 'self'${o.font.length ? ' ' + https(o.font) : ''}`,
    `connect-src 'self'${o.connect.length ? ' ' + https(o.connect) : ''}`,
  ];
  if (o.frame.length) parts.push(`frame-src 'self' ${https(o.frame)}`); // author embeds (held click-to-load) + SDK widget iframes
  parts.push("object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'");
  return parts.join('; ');
}

/**
 * The baked `<meta http-equiv>` CSP for the published HTML (static-export parity on strict external hosts).
 * Same allow-list as the header MINUS frame-ancestors (a meta CSP ignores it). `undefined` when nothing to widen.
 */
export function buildConsentMetaCsp(consent: Consent | undefined, extraOrigins: Partial<CspOrigins> = {}): string | undefined {
  const header = buildSiteCspHeader(consent, extraOrigins);
  if (!header) return undefined;
  return header
    .split('; ')
    .filter((d) => !d.startsWith('frame-ancestors'))
    .join('; ');
}

/**
 * Reconstruct the response-header CSP for a PUBLISHED page from its own baked `<meta http-equiv>` CSP
 * (the meta is the header minus frame-ancestors). The serve path uses this instead of a per-request
 * settings read, so it costs only a string scan AND is guaranteed consistent with the served HTML. Returns
 * `undefined` when the page has no consent meta (the caller then leaves the strict default in place). The
 * meta content was attribute-escaped at render → decode the standard entities back to a raw header value.
 */
export function siteCspHeaderFromHtml(html: string): string | undefined {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/i.exec(html);
  if (!m || !m[1]) return undefined;
  const decoded = m[1]
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&'); // &amp; LAST so a literal "&amp;" isn't double-decoded
  return `${decoded}; frame-ancestors 'none'`;
}
