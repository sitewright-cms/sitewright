// Connect-time-PINNED HTTPS fetch — the rebinding-proof outbound used by the website importer.
//
// The plain `fetch` SSRF guard has a TOCTOU hole: we resolve + check the host, then fetch() re-resolves
// at connect time, so a hostile DNS can answer public-then-private. Here we resolve ONCE, reject if ANY
// resolved IP is private, then connect to that PINNED IP (no second resolution) while keeping the real
// hostname for SNI + cert validation (servername) and the Host header. Redirects are refused (a 3xx
// can't be re-pinned safely). Size + timeout bounded. This is what the importer stores response BYTES
// through, so the residual rebinding window the screenshot renderer tolerates is closed here.
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPrivateIp } from '../render/screenshot.js';

export interface PinnedResponse {
  status: number;
  contentType: string;
  bytes: Uint8Array;
}

/** A 3xx hop: the resolved absolute Location to re-fetch (re-pinned + re-guarded on the next hop). */
interface Redirect {
  redirect: string;
}

const MAX_REDIRECTS = 5;

export interface PinnedOptions {
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Injectable resolver (tests); defaults to the real DNS lookup. */
  resolve?: (host: string) => Promise<{ address: string; family: number }[]>;
  /** @internal test seam — override the single-hop fetch to exercise the redirect-follow loop. */
  _fetchOnce?: (url: string, opts: PinnedOptions) => Promise<PinnedResponse | Redirect | null>;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const DEFAULT_UA = 'SitewrightImporter/1.0 (+website import)';

async function defaultResolve(host: string): Promise<{ address: string; family: number }[]> {
  return dnsLookup(host, { all: true });
}

/**
 * Fetch `rawUrl` over https against a pinned, SSRF-validated IP, FOLLOWING up to {@link MAX_REDIRECTS}
 * 3xx hops — each hop is independently resolved + private-IP-guarded + pinned (so a redirect can never
 * escape the SSRF guard or rebind). Returns null on: non-https, a private/unresolvable host, a redirect
 * loop / too many hops, a non-OK transport, or an oversize/timed-out body.
 */
export async function pinnedFetch(rawUrl: string, opts: PinnedOptions = {}): Promise<PinnedResponse | null> {
  const once = opts._fetchOnce ?? pinnedFetchOnce;
  let url = rawUrl;
  const seen = new Set<string>();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (seen.has(url)) return null; // redirect loop
    seen.add(url);
    const r = await once(url, opts);
    if (!r) return null;
    if ('redirect' in r) { url = r.redirect; continue; } // re-pinned + re-guarded on the next iteration
    return r;
  }
  return null; // too many redirects
}

/** One pinned hop: a 2xx PinnedResponse, a {@link Redirect} (3xx with a resolvable Location), or null. */
async function pinnedFetchOnce(rawUrl: string, opts: PinnedOptions = {}): Promise<PinnedResponse | Redirect | null> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;

  const host = u.hostname.replace(/^\[|\]$/g, ''); // unbracket IPv6 literals
  let ip: string;
  let family: number;
  const litFamily = isIP(host);
  if (litFamily) {
    if (isPrivateIp(host)) return null;
    ip = host;
    family = litFamily;
  } else {
    let ips: { address: string; family: number }[];
    try {
      ips = await (opts.resolve ?? defaultResolve)(host);
    } catch {
      return null;
    }
    if (ips.length === 0 || ips.some((r) => isPrivateIp(r.address))) return null;
    ip = ips[0]!.address;
    family = ips[0]!.family;
  }

  const port = u.port ? Number(u.port) : 443;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  // The actual pinned TLS request — real network I/O, exercised by the deploy-time end-to-end check.
  // (Everything above — the URL/scheme/private-IP guard — is unit-tested via the injected resolver.)
  /* v8 ignore start */
  return await new Promise<PinnedResponse | Redirect | null>((resolve) => {
    let done = false;
    const finish = (v: PinnedResponse | Redirect | null): void => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const req = httpsRequest(
      {
        hostname: ip, // a literal IP → no DNS at connect time (pinned)
        family,
        port,
        method: 'GET',
        path: `${u.pathname}${u.search}`,
        servername: host, // SNI + cert identity check against the REAL hostname
        // `host` last so a caller's headers can never override it (the pinned-IP connection must keep
        // the real Host for vhost routing + cert identity).
        headers: { 'user-agent': DEFAULT_UA, ...(opts.headers ?? {}), host: u.host },
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // A 3xx with a Location → hand the RESOLVED target back up to be re-pinned on the next hop (a bare
        // trailing-slash redirect, /foo → /foo/, is the common multi-page case). 1xx/4xx/5xx aren't real
        // content (a 404 error page must not be imported as a real site page).
        if (status >= 300 && status < 400) {
          const loc = res.headers.location;
          res.destroy();
          if (!loc) return finish(null);
          try { return finish({ redirect: new URL(loc, u).href }); } catch { return finish(null); }
        }
        if (status < 200 || status >= 300) {
          res.destroy();
          return finish(null);
        }
        const contentType = String(res.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() || 'application/octet-stream';
        if (Number(res.headers['content-length'] ?? '0') > maxBytes) {
          res.destroy();
          return finish(null);
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (c: Buffer) => {
          total += c.length;
          if (total > maxBytes) {
            res.destroy();
            finish(null);
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => finish({ status, contentType, bytes: new Uint8Array(Buffer.concat(chunks)) }));
        res.on('error', () => finish(null));
      },
    );
    req.on('error', () => finish(null));
    req.on('timeout', () => {
      req.destroy();
      finish(null);
    });
    if (opts.signal) {
      if (opts.signal.aborted) {
        req.destroy();
        finish(null);
      } else {
        opts.signal.addEventListener('abort', () => {
          req.destroy();
          finish(null);
        }, { once: true });
      }
    }
    req.end();
  });
  /* v8 ignore stop */
}
