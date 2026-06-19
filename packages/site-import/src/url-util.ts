// URL classification + normalization shared by the route builder, the page transform, and (by
// contract) the intake adapters. Keeping page/asset keys canonical here is what lets an internal
// link in one page resolve to the FINAL route of the target page, and an <img src> to its hosted ref.

/** Schemes that must never survive into a page source (they can execute / smuggle). */
const UNSAFE_SCHEME = /^(?:javascript|data|vbscript|file):/i;
/** Non-navigational handler schemes kept verbatim (validateTemplate allows literal values). */
const HANDLER_SCHEME = /^(?:mailto|tel|sms):/i;

/** Resolve a possibly-relative reference against a base; null if unparseable. */
export function resolveUrl(ref: string, base: string): string | null {
  try {
    return new URL(ref, base).href;
  } catch {
    return null;
  }
}

/**
 * Canonical PAGE key: an absolute URL reduced to `proto//host/path`, with the fragment and query
 * dropped, `index.html` stripped, duplicate/trailing slashes collapsed, host lowercased. Two URLs
 * that address the same page collapse to one key. Both the crawler (dedupe) and the transform
 * (internal-link lookup) must key pages with this function.
 */
export function normalizePageUrl(absUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(absUrl);
  } catch {
    return null;
  }
  let path = u.pathname.replace(/\/(?:index)\.html?$/i, '/').replace(/\/{2,}/g, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  if (path === '') path = '/';
  return `${u.protocol}//${u.host.toLowerCase()}${path}`;
}

/** Canonical ASSET key: like {@link normalizePageUrl} but the query is KEPT (cache-busting matters). */
export function assetKey(ref: string, base: string): string | null {
  const abs = resolveUrl(ref, base);
  if (!abs) return null;
  try {
    const u = new URL(abs);
    u.hash = '';
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

/** True when `absUrl` is on the same origin as the captured site's base. */
export function sameOrigin(absUrl: string, siteBaseUrl: string): boolean {
  try {
    return new URL(absUrl).origin === new URL(siteBaseUrl).origin;
  } catch {
    return false;
  }
}

/** The site-relative route path (`/`, `/about`, `/services/web-design`) of an internal URL, else null. */
export function routePath(absUrl: string, siteBaseUrl: string): string | null {
  const norm = normalizePageUrl(absUrl);
  if (!norm || !sameOrigin(absUrl, siteBaseUrl)) return null;
  const path = new URL(norm).pathname;
  return path === '' ? '/' : path;
}

export type HrefRewrite =
  | { kind: 'set'; value: string } // replace href with this literal
  | { kind: 'keep' } // leave the (already-literal, scheme-safe) value untouched
  | { kind: 'unsafe' }; // strip → '#'

/**
 * Decide how a link's `href` should be rewritten. `internalRoutes` maps a normalized page URL to the
 * FINAL Sitewright route of that page (so a link points at where the page actually landed, not its raw
 * source path). Internal links to pages we didn't capture fall back to their clean root-relative path.
 */
export function rewriteHref(
  raw: string,
  pageBase: string,
  siteBase: string,
  internalRoutes: ReadonlyMap<string, string>,
): HrefRewrite {
  const value = raw.trim();
  if (value === '' || value.startsWith('#')) return { kind: 'keep' };
  if (UNSAFE_SCHEME.test(value)) return { kind: 'unsafe' };
  if (HANDLER_SCHEME.test(value)) return { kind: 'keep' };
  const abs = resolveUrl(value, pageBase);
  if (!abs) return { kind: 'unsafe' };
  if (sameOrigin(abs, siteBase)) {
    const key = normalizePageUrl(abs);
    const mapped = key ? internalRoutes.get(key) : undefined;
    return { kind: 'set', value: mapped ?? routePath(abs, siteBase) ?? '/' };
  }
  if (/^https?:\/\//i.test(abs)) return { kind: 'set', value: abs };
  return { kind: 'unsafe' };
}

/** Largest-width candidate URL from a `srcset` value (last entry when no width descriptors). */
export function pickFromSrcset(srcset: string): string | undefined {
  const candidates = srcset
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [url, descriptor] = part.split(/\s+/, 2);
      const width = descriptor && /^\d+w$/.test(descriptor) ? parseInt(descriptor, 10) : 0;
      return { url: url ?? '', width };
    })
    .filter((c) => c.url !== '');
  if (candidates.length === 0) return undefined;
  const withWidth = candidates.filter((c) => c.width > 0);
  if (withWidth.length > 0) {
    return withWidth.reduce((a, b) => (b.width > a.width ? b : a)).url;
  }
  return candidates[candidates.length - 1]?.url;
}
