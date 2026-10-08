import type { FastifyRequest } from 'fastify';
import { firstForwardedValue } from '../auth/webauthn.js';

/**
 * The origins this instance answers on, and the rule for deciding which one a given request belongs to.
 *
 * `SW_PUBLIC_URL` is the CANONICAL origin and keeps every job where the answer must be stable no matter
 * who asks: the absolute form endpoint baked into published sites, `security.txt`'s `Canonical`, and the
 * fallback OAuth issuer. Additional origins (an admin instance setting) only widen the places where the
 * right answer is "wherever this request actually arrived" — the OIDC callback base, the OAuth/MCP
 * issuer, and the WebAuthn relying party.
 *
 * ★ Why an allowlist rather than just trusting the Host header. All three of those uses put the value
 * into something durable or security-relevant — a redirect the IdP must match, an issuer a registered
 * client pins, an rpID a passkey binds to. A request-derived value that nobody vetted lets a caller
 * with a spoofed Host steer any of them, so an unrecognized Host falls back to the canonical origin and
 * fails cleanly instead.
 */
export interface PlatformOriginSet {
  /** `SW_PUBLIC_URL`, normalized. Absent when the operator configured no public URL. */
  readonly canonical?: string;
  /** Additional operator-approved origins (`additionalOrigins`), normalized. */
  readonly additional: readonly string[];
}

/** An empty set — no canonical, no additional origins (the default for a bare local instance). */
export const NO_PLATFORM_ORIGINS: PlatformOriginSet = { additional: [] };

/**
 * Canonicalize an origin for COMPARISON: lowercase scheme + host, no path, no trailing slash, and the
 * default port for the scheme removed (so `https://x.test:443` and `https://x.test` are one origin, not
 * two). Returns null for anything that is not an http(s) origin.
 */
export function normalizePlatformOrigin(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const isDefaultPort = (url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80');
  const port = url.port && !isDefaultPort ? `:${url.port}` : '';
  return `${url.protocol}//${url.hostname.toLowerCase()}${port}`;
}

/**
 * The scheme + host a request actually arrived on, preferring the standard forwarded headers.
 *
 * Behind a TLS-terminating proxy the connection to this process is plain HTTP to an internal host, so
 * `req.protocol`/`req.headers.host` describe the proxy→app hop rather than the browser's origin. The
 * forwarded values are shape-checked (not trusted): a spoofed one can only fail to match the allowlist,
 * which falls back to the canonical origin.
 */
export function requestOriginOf(req: FastifyRequest): string | undefined {
  const fwdProto = firstForwardedValue(req.headers['x-forwarded-proto']);
  const protocol = fwdProto === 'http' || fwdProto === 'https' ? fwdProto : req.protocol;
  const fwdHost = firstForwardedValue(req.headers['x-forwarded-host']);
  const host = fwdHost && /^[a-zA-Z0-9.-]+(:\d+)?$/.test(fwdHost) ? fwdHost : req.headers.host;
  if (!host) return undefined;
  return normalizePlatformOrigin(`${protocol}://${host}`) ?? undefined;
}

/**
 * The platform origin a request belongs to: the origin it arrived on when that is one the operator
 * approved, otherwise the canonical origin. Undefined only when neither is available (an instance with
 * no public URL reached by something that sent no Host) — callers then fall back to per-request
 * derivation, which is the pre-allowlist behaviour.
 */
export function resolvePlatformOrigin(req: FastifyRequest, origins: PlatformOriginSet): string | undefined {
  const arrived = requestOriginOf(req);
  if (arrived && (arrived === origins.canonical || origins.additional.includes(arrived))) return arrived;
  return origins.canonical ?? arrived;
}

/** Every origin this instance answers on, canonical first. Used for `security.txt`'s `Canonical` fields. */
export function allPlatformOrigins(origins: PlatformOriginSet): string[] {
  return [...(origins.canonical ? [origins.canonical] : []), ...origins.additional];
}

/**
 * Validate an admin-supplied additional-origin list against the rest of the instance's configuration.
 * Returns a human-readable reason to REFUSE the write, or null when the list is acceptable.
 *
 * Two rules, both of which exist because the failure they prevent is silent:
 *
 * 1. **One scheme.** `secureCookies` (and with it the `Secure` flag, the `__Host-` cookie prefix and
 *    HSTS) is a single instance-wide posture derived from the canonical origin's scheme. An origin on
 *    the other scheme would be served cookies it cannot carry — a login that just never sticks.
 *
 * 2. ★ **Not inside the sites-domain namespace.** A Host ending in `.<sitesDomain>` is rewritten BEFORE
 *    routing into `/sites/<label>/…`, so an origin like `edit.sites.example.com` under sites domain
 *    `sites.example.com` would never reach the app at all — every request to it, the admin panel
 *    included, would be served as a (probably nonexistent) client site. This is the self-capture
 *    lockout, and from a settings form it would be one click with no way back.
 */
export function validateAdditionalOrigins(
  list: readonly string[],
  ctx: { canonical?: string; sitesDomain?: string },
): string | null {
  const canonicalScheme = ctx.canonical ? new URL(ctx.canonical).protocol : undefined;
  const sitesDomain = ctx.sitesDomain?.replace(/^\.+|\.+$/g, '').toLowerCase() || undefined;
  for (const raw of list) {
    const origin = normalizePlatformOrigin(raw);
    if (!origin) return `"${raw}" is not a valid http(s) origin`;
    if (canonicalScheme && new URL(origin).protocol !== canonicalScheme) {
      return `${origin} must use ${canonicalScheme}// to match the instance's public URL — cookies are Secure for the whole instance or for none of it`;
    }
    const host = new URL(origin).hostname;
    if (sitesDomain && host.endsWith(`.${sitesDomain}`)) {
      return `${origin} is inside the hosted-sites domain (.${sitesDomain}), where every request is served as a client site — the app would be unreachable there`;
    }
  }
  return null;
}

/**
 * Normalize + dedupe a validated list, dropping any entry that merely repeats the canonical origin
 * (already answered for) so the stored set and `security.txt` carry each origin exactly once.
 */
export function dedupeAdditionalOrigins(list: readonly string[], canonical?: string): string[] {
  const seen = new Set<string>(canonical ? [canonical] : []);
  const out: string[] = [];
  for (const raw of list) {
    const origin = normalizePlatformOrigin(raw);
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    out.push(origin);
  }
  return out;
}
