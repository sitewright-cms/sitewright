import type { ClientRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { resolvePublicAddresses, type PinnedOptions } from '../import/pinned-fetch.js';
import type { FetchLike } from './executor.js';

/**
 * THE OUTBOUND FOR EVERY PAYMENT-PROVIDER CALL.
 *
 * ★ A gateway definition names the host the platform calls, and an instance admin — or an agent holding
 * one's `payments:provider:write` key — writes it. The definition lint judges the NAME; this judges where
 * the name LEADS. Without it, a public-looking name with a private address (`10.0.0.10.nip.io`), or a
 * public server answering "302 → http://10.0.0.1/…", has the platform knock on the operator's router,
 * NAS or cloud metadata from inside their network — on every checkout, which any buyer can start.
 *
 * - The host is resolved ONCE and refused if ANY address is private (the shared importer guard). The
 *   socket connects to the checked address — no second lookup at connect time — and keeps the real name
 *   for SNI and the certificate check.
 * - A redirect is NEVER followed: a payment API does not redirect a server-to-server call, and following
 *   one carries the request, keys in its headers, to wherever the answer pointed. A 3xx is returned as a
 *   non-OK status like any other.
 * - The next address is tried only when the connection never came up. Once a request may have been sent,
 *   sending it again elsewhere could open a second session or issue a second refund.
 */

/** A refusal the executor reports as itself. Messages never carry the URL or an address. */
export class ProviderFetchError extends Error {
  constructor(
    message: string,
    readonly kind: 'refused' | 'request' | 'oversize',
  ) {
    super(message);
    this.name = 'ProviderFetchError';
  }
}

export interface ProviderFetchOptions {
  /** Bytes read from one response before giving up. */
  maxBytes?: number;
  /** Socket inactivity backstop. The executor's AbortSignal is the whole-call deadline. */
  timeoutMs?: number;
  /** How long one address may take to come up before the next is tried. */
  connectTimeoutMs?: number;
  /** Injectable resolver (tests); defaults to the real DNS lookup. */
  resolve?: PinnedOptions['resolve'];
  /** @internal test seam — an extra CA to trust (a throwaway test certificate). */
  ca?: string;
  /** @internal test seam — replaces the one-address send, to exercise the fall-through rule. */
  _send?: typeof sendToAddress;
}

type ProviderResponse = Awaited<ReturnType<FetchLike>>;
type ProviderInit = Parameters<FetchLike>[1];

/** The connection never came up, so the request was certainly not sent: the next address may be tried. */
export const NOT_CONNECTED = Symbol('provider-not-connected');

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
// Well inside the executor's 15 s deadline, so a black-holed first address still leaves time for the next.
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const USER_AGENT = 'sitewright';
/**
 * Headers the transport owns. A framing one set by a definition could desynchronise the request, and
 * `accept-encoding` would ask for a compressed body this transport never decodes.
 */
const TRANSPORT_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'upgrade', 'te', 'trailer', 'expect', 'accept-encoding']);
/** Methods that carry a body, so send a zero length when there is none (as `fetch` does). */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

// ★ Worded to be true of BOTH causes — a private address and a name that did not resolve (a DNS outage
// included) — because telling them apart would make the message an oracle for internal names.
const REFUSED = 'the payment provider’s address did not resolve to a public internet address, so it was not called';

/** A transport failure, named like the platform `fetch`'s so the executor's report reads the same. */
function transportError(name: 'AbortError' | 'NetworkError' | 'TimeoutError'): Error {
  const err = new Error('the payment provider could not be reached');
  err.name = name;
  return err;
}

/** Builds the provider transport. The app uses {@link providerFetch}; tests build one with seams. */
export function makeProviderFetch(opts: ProviderFetchOptions = {}): FetchLike {
  const send = opts._send ?? sendToAddress;
  const limits = {
    maxBytes: opts.maxBytes ?? DEFAULT_MAX_BYTES,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    connectTimeoutMs: opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    ...(opts.ca ? { ca: opts.ca } : {}),
  };
  return async (rawUrl, init) => {
    let u: URL;
    try {
      u = new URL(rawUrl);
    } catch {
      throw new ProviderFetchError(REFUSED, 'refused');
    }
    if (u.protocol !== 'https:') throw new ProviderFetchError(REFUSED, 'refused');
    // ★ Private, unresolvable and malformed collapse into ONE refusal, so the message is no oracle for
    // which internal names exist.
    const candidates = await resolvePublicAddresses(u.hostname.replace(/^\[|\]$/g, ''), opts.resolve);
    if (!candidates) throw new ProviderFetchError(REFUSED, 'refused');
    for (const cand of candidates) {
      if (init.signal?.aborted) throw transportError('AbortError');
      const r = await send(cand, u, init, limits);
      if (r !== NOT_CONNECTED) return r;
    }
    throw transportError(init.signal?.aborted ? 'AbortError' : 'NetworkError');
  };
}

/** The production transport. */
export const providerFetch: FetchLike = makeProviderFetch();

/** The request headers: the definition's, minus framing, plus the ones the transport owns. */
function requestHeaders(u: URL, init: ProviderInit): Record<string, string> {
  // The default UA goes FIRST so a definition can still set its own (Node matches names case-blind).
  const headers: Record<string, string> = { 'user-agent': USER_AGENT };
  for (const [name, value] of Object.entries(init.headers)) {
    // eslint-disable-next-line security/detect-object-injection -- a fresh object, and a string assigned to `__proto__` is ignored
    if (!TRANSPORT_HEADERS.has(name.toLowerCase())) headers[name] = value;
  }
  headers.host = u.host;
  if (init.body !== undefined || BODY_METHODS.has(init.method.toUpperCase())) {
    headers['content-length'] = String(Buffer.byteLength(init.body ?? ''));
  }
  return headers;
}

/**
 * One request to one checked address. Resolves to the response, or {@link NOT_CONNECTED} when the TLS
 * session never came up; rejects for any failure after that, because the request may then have arrived.
 */
export function sendToAddress(
  cand: { ip: string; family: number },
  u: URL,
  init: ProviderInit,
  limits: { maxBytes: number; timeoutMs: number; connectTimeoutMs: number; ca?: string },
): Promise<ProviderResponse | typeof NOT_CONNECTED> {
  return new Promise((resolve, reject) => {
    const host = u.hostname.replace(/^\[|\]$/g, '');
    let settled = false;
    let connected = false;
    let req: ClientRequest | undefined;
    let connectTimer: NodeJS.Timeout | undefined = undefined; // set once the request exists
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      init.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    function onAbort(): void {
      req?.destroy();
      settle(() => reject(transportError('AbortError')));
    }
    const lost = (name: 'NetworkError' | 'TimeoutError'): void =>
      settle(() => (connected ? reject(transportError(name)) : resolve(NOT_CONNECTED)));
    const oversize = (): void => settle(() => reject(new ProviderFetchError('the payment provider returned an oversized response', 'oversize')));

    if (init.signal?.aborted) return onAbort();
    try {
      req = httpsRequest(
        {
          hostname: cand.ip, // a literal IP → no DNS at connect time (pinned)
          family: cand.family,
          port: u.port ? Number(u.port) : 443,
          method: init.method,
          path: `${u.pathname}${u.search}`,
          // SNI + the certificate identity check against the REAL name. An IP literal is checked as
          // itself (Node refuses an IP as a TLS server name).
          ...(isIP(host) ? {} : { servername: host }),
          headers: requestHeaders(u, init),
          agent: false, // a fresh socket: no pooled connection reused across names
          timeout: limits.timeoutMs,
          ...(limits.ca ? { ca: limits.ca } : {}),
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (Number(res.headers['content-length'] ?? '0') > limits.maxBytes) {
            res.destroy();
            return oversize();
          }
          const chunks: Buffer[] = [];
          let total = 0;
          res.on('data', (c: Buffer) => {
            total += c.length;
            if (total > limits.maxBytes) {
              res.destroy();
              oversize();
              return;
            }
            chunks.push(c);
          });
          res.on('end', () => {
            // TextDecoder, as `fetch`'s text() does: it drops a leading BOM that JSON.parse would choke on.
            const text = new TextDecoder().decode(Buffer.concat(chunks));
            settle(() => resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(text) }));
          });
          res.on('error', () => lost('NetworkError'));
          res.on('close', () => lost('NetworkError')); // a body cut short; a no-op after 'end'
        },
      );
    } catch {
      // A header value Node refuses (a control character): the definition is at fault, not the network.
      return settle(() => reject(new ProviderFetchError('the request to the payment provider has an invalid header', 'request')));
    }
    req.on('socket', (s) => s.once('secureConnect', () => {
      connected = true;
      clearTimeout(connectTimer);
    }));
    // An address that never answers the handshake is given up on early, while time remains for the next.
    connectTimer = setTimeout(() => {
      req?.destroy();
      lost('TimeoutError');
    }, limits.connectTimeoutMs);
    req.on('error', () => lost('NetworkError'));
    req.on('timeout', () => {
      req?.destroy();
      lost('TimeoutError');
    });
    init.signal?.addEventListener('abort', onAbort, { once: true });
    req.end(init.body);
  });
}
