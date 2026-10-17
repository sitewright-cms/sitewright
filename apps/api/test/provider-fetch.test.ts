import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:https';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import { makeProviderFetch, sendToAddress, NOT_CONNECTED, ProviderFetchError } from '../src/payments/provider-fetch.js';
import { makeCert, type TestCert } from './smtp-server.js';

/**
 * THE PAYMENT-PROVIDER TRANSPORT. A gateway definition names the host; this decides whether that host
 * may be reached at all, and how. Two halves:
 *  - the address guard and the retry rule, through the injected resolver and `_send` (no network);
 *  - the one-address send, over REAL TLS to a local server with a throwaway certificate.
 */

const INIT = { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer sk_test_x' }, body: '{"amount":2498}' };
const ok = { ok: true, status: 200, text: async () => '{}' };

describe('the address guard', () => {
  const refusedFor = async (url: string, resolve?: () => Promise<{ address: string; family: number }[]>) => {
    let sent = 0;
    const fetch = makeProviderFetch({ ...(resolve ? { resolve } : {}), _send: async () => { sent += 1; return ok; } });
    const err = await fetch(url, INIT).then(() => null, (e: unknown) => e);
    return { err, sent };
  };

  it('★★ refuses a public-looking NAME that leads into a private network, without sending anything', async () => {
    // `10.0.0.10.nip.io` resolves to 10.0.0.10 through any public DNS — the name passes every lint.
    for (const address of ['10.0.0.10', '192.168.1.1', '127.0.0.1', '169.254.169.254', '::1', 'fd00::1']) {
      const { err, sent } = await refusedFor('https://10-0-0-10.nip.example/v1/sessions', async () => [{ address, family: address.includes(':') ? 6 : 4 }]);
      expect(err, address).toBeInstanceOf(ProviderFetchError);
      expect((err as ProviderFetchError).kind).toBe('refused');
      expect(sent, address).toBe(0);
    }
  });

  it('★ refuses when ANY address is private — a public answer cannot launder a private one', async () => {
    const { err, sent } = await refusedFor('https://mixed.example/x', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.10', family: 4 },
    ]);
    expect(err).toBeInstanceOf(ProviderFetchError);
    expect(sent).toBe(0);
  });

  it('refuses private literals, plain http, an unparseable URL and an unresolvable name — with ONE message', async () => {
    const results = await Promise.all([
      refusedFor('https://10.0.0.10/x'),
      refusedFor('https://[::1]/x'),
      refusedFor('http://api.example/x', async () => [{ address: '93.184.216.34', family: 4 }]),
      refusedFor('not a url'),
      refusedFor('https://gone.example/x', async () => { throw new Error('ENOTFOUND'); }),
      refusedFor('https://empty.example/x', async () => []),
    ]);
    for (const { err, sent } of results) {
      expect(err).toBeInstanceOf(ProviderFetchError);
      expect(sent).toBe(0);
    }
    // ★ No oracle: which names exist inside, and what they resolve to, never reaches the author.
    expect(new Set(results.map((r) => (r.err as Error).message)).size).toBe(1);
    expect((results[0]!.err as Error).message).not.toMatch(/10\.0\.0\.10|::1|gone\.example/);
  });

  it('★ resolves ONCE and connects to the address it checked (no second lookup to rebind)', async () => {
    let lookups = 0;
    const seen: string[] = [];
    const fetch = makeProviderFetch({
      resolve: async () => { lookups += 1; return [{ address: '2606:4700::1', family: 6 }, { address: '93.184.216.34', family: 4 }]; },
      _send: async (cand, u) => { seen.push(`${cand.ip}|${u.hostname}`); return ok; },
    });
    await fetch('https://api.example/v1/sessions', INIT);
    expect(lookups).toBe(1);
    // IPv4 first, and the NAME rides along for SNI + the certificate.
    expect(seen).toEqual(['93.184.216.34|api.example']);
  });
});

describe('the retry rule', () => {
  const two = async () => [{ address: '93.184.216.34', family: 4 }, { address: '93.184.216.35', family: 4 }];

  it('tries the next address only when the connection never came up', async () => {
    const seen: string[] = [];
    const fetch = makeProviderFetch({
      resolve: two,
      _send: async (cand) => { seen.push(cand.ip); return seen.length === 1 ? NOT_CONNECTED : ok; },
    });
    expect((await fetch('https://api.example/x', INIT)).status).toBe(200);
    expect(seen).toEqual(['93.184.216.34', '93.184.216.35']);
  });

  it('★★ never re-sends a request that may have arrived — a second refund is worse than a failure', async () => {
    const seen: string[] = [];
    const fetch = makeProviderFetch({
      resolve: two,
      _send: async (cand) => { seen.push(cand.ip); throw Object.assign(new Error('x'), { name: 'NetworkError' }); },
    });
    await expect(fetch('https://api.example/refunds', INIT)).rejects.toMatchObject({ name: 'NetworkError' });
    expect(seen).toEqual(['93.184.216.34']);
  });

  it('reports a network failure when no address connects, and an abort as an abort', async () => {
    const down = makeProviderFetch({ resolve: two, _send: async () => NOT_CONNECTED });
    await expect(down('https://api.example/x', INIT)).rejects.toMatchObject({ name: 'NetworkError' });

    const controller = new AbortController();
    controller.abort();
    let sent = 0;
    const aborted = makeProviderFetch({ resolve: two, _send: async () => { sent += 1; return ok; } });
    await expect(aborted('https://api.example/x', { ...INIT, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(sent).toBe(0);
  });
});

const hasOpenssl = spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0;
const PINNED_NAME = 'pinned.invalid';

describe.skipIf(!hasOpenssl)('one request over real TLS', () => {
  let cert: TestCert;
  let server: Server;
  let port: number;
  let handler: (req: IncomingMessage, res: ServerResponse, body: string) => void;
  let received: Array<{ method: string; url: string; headers: IncomingMessage['headers']; rawHeaders: string[]; body: string }>;

  beforeAll(async () => {
    // ★ `pinned.invalid` can never resolve, so a request that reaches the server under that name was
    // sent to the checked ADDRESS — a transport that looked the name up again would fail to connect.
    cert = await makeCert([PINNED_NAME]);
    server = createServer({ key: cert.key, cert: cert.cert }, (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        received.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, rawHeaders: req.rawHeaders, body });
        handler(req, res, body);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  beforeEach(() => {
    received = [];
    handler = (_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"sess_1"}');
  });

  const LOCAL = { ip: '127.0.0.1', family: 4 };
  const at = (path = '/v1/sessions?expand=1', host = PINNED_NAME) => new URL(`https://${host}:${port}${path}`);
  const limits = () => ({ maxBytes: 4096, timeoutMs: 2000, connectTimeoutMs: 2000, ca: cert.cert });

  it('sends the method, path, query, body and the definition’s headers to the pinned address', async () => {
    const res = await sendToAddress(LOCAL, at(), INIT, limits());
    expect(res).not.toBe(NOT_CONNECTED);
    const r = res as Exclude<typeof res, typeof NOT_CONNECTED>;
    expect({ ok: r.ok, status: r.status, text: await r.text() }).toEqual({ ok: true, status: 200, text: '{"id":"sess_1"}' });
    expect(received).toHaveLength(1);
    const got = received[0]!;
    expect(got).toMatchObject({ method: 'POST', url: '/v1/sessions?expand=1', body: '{"amount":2498}' });
    expect(got.headers).toMatchObject({
      host: `${PINNED_NAME}:${port}`,
      authorization: 'Bearer sk_test_x',
      'content-type': 'application/json',
      'content-length': '15',
      'user-agent': 'sitewright',
    });
  });

  it('★ keeps the framing to itself — a definition cannot set Host, length or chunking', async () => {
    const headers = { ...INIT.headers, Host: 'internal.example', 'Content-Length': '1', 'Transfer-Encoding': 'chunked', Connection: 'upgrade', 'Accept-Encoding': 'gzip', 'User-Agent': 'acme-sdk/2' };
    await sendToAddress(LOCAL, at(), { ...INIT, headers }, limits());
    const got = received[0]!;
    expect(got.headers.host).toBe(`${PINNED_NAME}:${port}`);
    expect(got.headers['content-length']).toBe('15');
    expect(got.headers['transfer-encoding']).toBeUndefined();
    // Asked-for compression would arrive as bytes this transport never decodes.
    expect(got.headers['accept-encoding']).toBeUndefined();
    expect(got.body).toBe('{"amount":2498}');
    // A definition's own User-Agent still wins, once.
    expect(got.rawHeaders.filter((h) => h.toLowerCase() === 'user-agent')).toHaveLength(1);
    expect(got.headers['user-agent']).toBe('acme-sdk/2');
  });

  it('sends a zero length on a body-less POST, and none on a GET or DELETE — as `fetch` does', async () => {
    await sendToAddress(LOCAL, at(), { method: 'POST', headers: {} }, limits());
    await sendToAddress(LOCAL, at('/v1/sessions/s_1'), { method: 'GET', headers: {} }, limits());
    await sendToAddress(LOCAL, at('/v1/sessions/s_1'), { method: 'DELETE', headers: {} }, limits());
    expect(received.map((r) => r.headers['content-length'])).toEqual(['0', undefined, undefined]);
  });

  it('drops a leading byte-order mark, as `fetch` does, so the JSON still parses', async () => {
    handler = (_req, res) => res.writeHead(200).end('\uFEFF{"id":"sess_bom"}');
    const r = (await sendToAddress(LOCAL, at(), INIT, limits())) as Exclude<Awaited<ReturnType<typeof sendToAddress>>, typeof NOT_CONNECTED>;
    expect(JSON.parse(await r.text())).toEqual({ id: 'sess_bom' });
  });

  it('★★ never follows a redirect — the 3xx comes back as a status, and nothing else is called', async () => {
    handler = (_req, res) => res.writeHead(307, { location: `https://${PINNED_NAME}:${port}/internal/admin` }).end();
    const r = (await sendToAddress(LOCAL, at(), INIT, limits())) as Exclude<Awaited<ReturnType<typeof sendToAddress>>, typeof NOT_CONNECTED>;
    expect({ ok: r.ok, status: r.status }).toEqual({ ok: false, status: 307 });
    expect(received.map((x) => x.url)).toEqual(['/v1/sessions?expand=1']);
  });

  it('returns an error status with its body, for the executor to judge', async () => {
    handler = (_req, res) => res.writeHead(401).end('{"error":"bad key"}');
    const r = (await sendToAddress(LOCAL, at(), INIT, limits())) as Exclude<Awaited<ReturnType<typeof sendToAddress>>, typeof NOT_CONNECTED>;
    expect({ ok: r.ok, status: r.status, text: await r.text() }).toEqual({ ok: false, status: 401, text: '{"error":"bad key"}' });
  });

  it('stops reading an oversized response, declared or streamed', async () => {
    handler = (_req, res) => res.writeHead(200, { 'content-length': '999999' }).end();
    await expect(sendToAddress(LOCAL, at(), INIT, limits())).rejects.toMatchObject({ kind: 'oversize' });
    handler = (_req, res) => { res.writeHead(200); res.write('x'.repeat(3000)); res.end('y'.repeat(3000)); };
    await expect(sendToAddress(LOCAL, at(), INIT, limits())).rejects.toMatchObject({ kind: 'oversize' });
  });

  it('★ checks the certificate against the NAME — a wrong or untrusted one never connects', async () => {
    expect(await sendToAddress(LOCAL, at('/x', 'pay.example'), INIT, limits())).toBe(NOT_CONNECTED);
    expect(await sendToAddress(LOCAL, at(), INIT, { maxBytes: 4096, timeoutMs: 2000, connectTimeoutMs: 2000 })).toBe(NOT_CONNECTED);
    expect(received).toHaveLength(0);
  });

  it('★ gives up on an address that never finishes the handshake, so the next one gets its turn', async () => {
    // A socket that accepts and then says nothing: no TLS, no request ever sent.
    const sockets = new Set<import('node:net').Socket>();
    const silent = createTcpServer((sock) => { sockets.add(sock); });
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r));
    const silentPort = (silent.address() as AddressInfo).port;
    const started = Date.now();
    const result = await sendToAddress(LOCAL, new URL(`https://${PINNED_NAME}:${silentPort}/x`), INIT, { ...limits(), connectTimeoutMs: 150 });
    expect(result).toBe(NOT_CONNECTED);
    expect(Date.now() - started).toBeLessThan(1500); // the connect limit, not the 2 s inactivity one
    for (const sock of sockets) sock.destroy();
    await new Promise((r) => silent.close(r));
  });

  it('reports a refused connection as never connected', async () => {
    const closed = createServer({ key: cert.key, cert: cert.cert });
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const deadPort = (closed.address() as AddressInfo).port;
    await new Promise((r) => closed.close(r));
    expect(await sendToAddress(LOCAL, new URL(`https://${PINNED_NAME}:${deadPort}/x`), INIT, limits())).toBe(NOT_CONNECTED);
  });

  it('★ a connection dropped AFTER the request went out is a failure, not a retry', async () => {
    handler = (req) => req.socket.destroy();
    await expect(sendToAddress(LOCAL, at(), INIT, limits())).rejects.toMatchObject({ name: 'NetworkError' });
  });

  it('times out a silent server, and stops at an abort', async () => {
    handler = () => undefined; // never answers
    await expect(sendToAddress(LOCAL, at(), INIT, { ...limits(), timeoutMs: 200 })).rejects.toMatchObject({ name: 'TimeoutError' });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await expect(sendToAddress(LOCAL, at(), { ...INIT, signal: controller.signal }, limits())).rejects.toMatchObject({ name: 'AbortError' });
    const already = new AbortController();
    already.abort();
    await expect(sendToAddress(LOCAL, at(), { ...INIT, signal: already.signal }, limits())).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('refuses a header value Node will not send, as the definition’s fault', async () => {
    const err = await sendToAddress(LOCAL, at(), { ...INIT, headers: { 'x-note': 'a\r\nInjected: 1' } }, limits()).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderFetchError);
    expect((err as ProviderFetchError).kind).toBe('request');
    expect(received).toHaveLength(0);
  });
});
