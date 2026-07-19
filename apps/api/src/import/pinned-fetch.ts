// Connect-time-PINNED HTTPS fetch — the rebinding-proof outbound used by the website importer.
//
// The plain `fetch` SSRF guard has a TOCTOU hole: we resolve + check the host, then fetch() re-resolves
// at connect time, so a hostile DNS can answer public-then-private. Here we resolve ONCE, reject if ANY
// resolved IP is private, then connect to a PINNED IP (no second resolution) while keeping the real
// hostname for SNI + cert validation (servername) and the Host header. EVERY resolved address is a
// pinned candidate (IPv4 first, fall through on connect error), so a dual-stack host doesn't fail when
// one address is unreachable. Redirects ARE followed (up to MAX_REDIRECTS), each hop re-resolved +
// re-guarded + re-pinned. Size + timeout bounded. This is what the importer stores response BYTES
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

/** A pinned connect/transport failure (TLS/network error or timeout) — the caller should try the NEXT
 *  resolved address rather than give up, distinguishing it from a definitive HTTP/size failure (null). */
const CONNECT_FAILED = Symbol('pinned-connect-failed');

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
// A realistic modern-browser UA + a broad Accept: many CDNs (e.g. images.pexels.com) answer 403/429 to a
// bare bot UA or a request with no Accept, which silently failed every image self-host. The importer is
// fetching a PUBLIC site the owner chose to clone, so presenting as a normal browser is appropriate.
const DEFAULT_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const DEFAULT_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8';

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
  // Candidate connect addresses, each already private-IP-guarded. A literal-IP host has exactly one; a
  // DNS host contributes EVERY resolved address (rejected wholesale if ANY is private — anti-rebinding).
  let candidates: { ip: string; family: number }[];
  const litFamily = isIP(host);
  if (litFamily) {
    if (isPrivateIp(host)) return null;
    candidates = [{ ip: host, family: litFamily }];
  } else {
    let ips: { address: string; family: number }[];
    try {
      ips = await (opts.resolve ?? defaultResolve)(host);
    } catch {
      return null;
    }
    if (ips.length === 0 || ips.some((r) => isPrivateIp(r.address))) return null;
    // Try EVERY resolved address, IPv4 FIRST: a dual-stack host whose first DNS record is an AAAA would
    // otherwise fail outright in an IPv4-only egress environment — the cause of "every image self-host
    // failed" while the box has (IPv4) internet. Falling through to the next address on a connect error
    // makes the fetch resilient to a single dead/unreachable address.
    candidates = ips.map((r) => ({ ip: r.address, family: r.family })).sort((a, b) => a.family - b.family);
  }

  const port = u.port ? Number(u.port) : 443;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  // Try each pinned candidate in turn. A CONNECT/transport failure falls through to the next address; a
  // real HTTP response (2xx/3xx/4xx/5xx) or an oversize body is DEFINITIVE (the same vhost answers on
  // every address, so retrying can't change it). Real network I/O — exercised by the deploy-time e2e check.
  // (The URL/scheme/private-IP guard above is unit-tested via the injected resolver.)
  /* v8 ignore start */
  for (const cand of candidates) {
    const r = await connectPinned(cand.ip, cand.family, u, host, port, timeoutMs, maxBytes, opts);
    if (r !== CONNECT_FAILED) return r;
    if (opts.signal?.aborted) return null;
  }
  return null;
  /* v8 ignore stop */
}

/* v8 ignore start */
/** A single pinned TLS GET to one address. Resolves to CONNECT_FAILED (transport error/timeout — the
 *  caller should try the next address), a {@link Redirect}, a {@link PinnedResponse} (2xx), or null (a
 *  definitive HTTP-status / oversize / abort failure). */
function connectPinned(
  ip: string,
  family: number,
  u: URL,
  host: string,
  port: number,
  timeoutMs: number,
  maxBytes: number,
  opts: PinnedOptions,
): Promise<PinnedResponse | Redirect | null | typeof CONNECT_FAILED> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: PinnedResponse | Redirect | null | typeof CONNECT_FAILED): void => {
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
        // the real Host for vhost routing + cert identity). UA + Accept default first so callers can
        // still override them (e.g. an image fetch narrowing Accept to image/*).
        headers: { 'user-agent': DEFAULT_UA, accept: DEFAULT_ACCEPT, ...(opts.headers ?? {}), host: u.host },
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
    req.on('error', () => finish(CONNECT_FAILED)); // TLS/network/connect error → try the next address
    req.on('timeout', () => {
      req.destroy();
      finish(CONNECT_FAILED);
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
}
/* v8 ignore stop */
