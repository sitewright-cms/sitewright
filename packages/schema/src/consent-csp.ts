// CONSENT MANAGER — third-party gating support: the curated CSP origin bundles per preset, the runtime
// descriptors the {{sw-consent}} helper bakes into the config, and the per-site CSP builders consumed by
// BOTH the serve-time response header (apps/api app.ts /sites/:slug/*) and the build-time <meta> (build.ts).
//
// SECURITY MODEL (the invariants a reviewer checks): CSP allowlists ORIGINS, never URLs. We add only
// SPECIFIC https origins — NEVER 'unsafe-inline' / 'unsafe-eval' / '*'. The bundles are curated + versioned
// in-repo (an owner picks a preset, never types a URL); a `custom` integration contributes only its own
// https `src` host (+ schema-validated bare-hostname `origins`). The widening is PER-SITE and OPT-IN: a
// site with no integrations gets no widened CSP (it keeps the strict `default-src 'self'` default).

import type { Consent, ConsentIntegration } from './website.js';

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
 * (Embed presets youtube/google-maps are added in the click-to-load PR — their frame-src origins live here.)
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

/** Click-to-load EMBED providers (the iframe needs a `frame-src` origin; the parent CSP doesn't cascade INTO it). */
export const EMBED_PROVIDERS = ['youtube', 'google-maps'] as const;
export type EmbedProvider = (typeof EMBED_PROVIDERS)[number];

/**
 * Curated `frame-src` (+ thumbnail img) origins per embed provider. An <iframe> is its own browsing
 * context, so the provider's INTERNAL fan-out is invisible to the page CSP — each provider needs exactly
 * ONE-ish stable origin. Maintained in-repo; the publisher prepends `https://`.
 */
export const EMBED_PRESET_ORIGINS: Readonly<Record<EmbedProvider, CspOrigins>> = {
  // youtube-nocookie is the embedded player; www.youtube.com is needed because clicking the title/logo in
  // the player navigates THE IFRAME to youtube.com/watch (a same-frame navigation the page CSP governs).
  youtube: { script: [], frame: ['www.youtube-nocookie.com', 'www.youtube.com'], connect: [], img: ['i.ytimg.com'], style: [], font: [] },
  'google-maps': { script: [], frame: ['www.google.com'], connect: [], img: [], style: [], font: [] },
};

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

const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.host : null;
  } catch {
    return null;
  }
};

/** The runtime descriptor the {{sw-consent}} helper bakes into the config for one integration. */
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
 * Aggregate, deduped CSP origins. The REGISTRY integrations (script-src/connect-src) are gated on
 * `consent.enabled`; the EMBED providers (frame-src) are added independently — a {{sw-embed}} is
 * click-to-load and works even without the consent manager, but its iframe still needs a frame-src origin.
 */
export function consentCspOrigins(consent: Consent | undefined, embedProviders: Iterable<EmbedProvider> = []): CspOrigins {
  const acc: Record<keyof CspOrigins, Set<string>> = { script: new Set(), frame: new Set(), connect: new Set(), img: new Set(), style: new Set(), font: new Set() };
  const mergeBundle = (b: CspOrigins): void => (Object.keys(acc) as (keyof CspOrigins)[]).forEach((k) => b[k].forEach((h) => acc[k].add(h)));
  for (const p of embedProviders) mergeBundle(EMBED_PRESET_ORIGINS[p]);
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
    for (const o of i.origins ?? []) {
      acc.script.add(o);
      acc.connect.add(o);
    }
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
export function buildSiteCspHeader(consent: Consent | undefined, embedProviders: Iterable<EmbedProvider> = []): string | undefined {
  const o = consentCspOrigins(consent, embedProviders);
  if (!hasAny(o)) return undefined;
  const parts = [
    "default-src 'self'",
    `script-src 'self'${o.script.length ? ' ' + https(o.script) : ''}`,
    'img-src \'self\' data: https:',
    `style-src 'self' 'unsafe-inline'${o.style.length ? ' ' + https(o.style) : ''}`,
    `font-src 'self'${o.font.length ? ' ' + https(o.font) : ''}`,
    `connect-src 'self'${o.connect.length ? ' ' + https(o.connect) : ''}`,
  ];
  if (o.frame.length) parts.push(`frame-src 'self' ${https(o.frame)}`); // click-to-load embeds (YouTube/Maps)
  parts.push("object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'");
  return parts.join('; ');
}

/**
 * The baked `<meta http-equiv>` CSP for the published HTML (static-export parity on strict external hosts).
 * Same allow-list as the header MINUS frame-ancestors (a meta CSP ignores it). `undefined` when nothing to widen.
 */
export function buildConsentMetaCsp(consent: Consent | undefined, embedProviders: Iterable<EmbedProvider> = []): string | undefined {
  const header = buildSiteCspHeader(consent, embedProviders);
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
