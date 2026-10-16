import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { request, type ClientRequest, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { abortOnClose } from '../src/http/abort-on-close.js';

// abortOnClose must fire when the CLIENT goes away mid-handler — and never otherwise.
//
// These run against a real listening server and a real client socket, because the bug they pin lives in
// Node's own event timing, which app.inject() does not reproduce. On Node ≥16 a POST's IncomingMessage
// (`req.raw`) emits 'close' as soon as its body has been consumed: a listener attached synchronously in
// the handler fired at once (aborting live work for a client that is still waiting), and one attached
// after an `await` (auth, a DB read — every real route) was attached to a stream that had ALREADY closed
// and never fired at all, so a hang-up cancelled nothing. The response (`reply.raw`) closes when the
// connection does or once it has been sent, and `writableFinished` tells those two apart.

interface Probe {
  signal: AbortSignal;
  /** The response object, to check the helper leaves no listener behind. */
  res: ServerResponse;
  /** `close` listeners on the response before the helper attached. */
  closeListenersBefore: number;
}

/** Resolves when `signal` aborts, or with false after `ms` — a wait that cannot hang the test. */
function abortedWithin(signal: AbortSignal, ms: number): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

/**
 * A server (one request per test) whose `/work` handler wires abortOnClose and then holds the request
 * open until it is aborted or released. `late` = the helper is called after an `await`, as every
 * authenticated route does it.
 */
async function serve(): Promise<{
  port: number;
  started: Promise<Probe>;
  release: () => void;
}> {
  app = Fastify();
  let onStart!: (p: Probe) => void;
  const started = new Promise<Probe>((r) => (onStart = r));
  let release!: () => void;
  const releasedP = new Promise<void>((r) => (release = r));
  const work = async (reply: FastifyReply, late: boolean): Promise<{ aborted: boolean }> => {
    if (late) await tick(5); // resolveProject / a DB read: the body has long been consumed by now
    const res = reply.raw;
    const closeListenersBefore = res.listenerCount('close');
    const { signal } = abortOnClose(reply);
    onStart({ signal, res, closeListenersBefore });
    await Promise.race([releasedP, new Promise((r) => signal.addEventListener('abort', r))]);
    return { aborted: signal.aborted };
  };
  app.post<{ Querystring: { late?: string } }>('/work', async (req, reply) => work(reply, req.query.late === '1'));
  app.get<{ Querystring: { late?: string } }>('/work', async (req, reply) => work(reply, req.query.late === '1'));
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { port, started, release };
}

/** Fire a request on its own connection (no keep-alive), and collect the response body if it comes. */
function send(port: number, method: 'GET' | 'POST', path: string): { req: ClientRequest; body: Promise<string> } {
  let req!: ClientRequest;
  const body = new Promise<string>((resolve, reject) => {
    req = request({ host: '127.0.0.1', port, method, path, agent: false, headers: method === 'POST' ? { 'content-type': 'application/json' } : {} }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (text += c));
      res.on('end', () => resolve(text));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
  body.catch(() => {}); // a hung-up request rejects (socket hang up) — that is the point of those tests
  if (method === 'POST') req.end(JSON.stringify({ selectors: ['h1'], pad: 'x'.repeat(2048) }));
  else req.end();
  return { req, body };
}

describe('abortOnClose — over a real socket', () => {
  for (const method of ['POST', 'GET'] as const) {
    for (const late of [false, true]) {
      const shape = late ? 'wired after an await' : 'wired at the top of the handler';
      it(`${method}, ${shape}: a client that hangs up mid-handler aborts the work`, async () => {
        const srv = await serve();
        const { req } = send(srv.port, method, `/work?late=${late ? 1 : 0}`);
        const probe = await srv.started;
        expect(probe.signal.aborted).toBe(false); // the client is still there, waiting
        req.destroy(); // …and now it is not
        expect(await abortedWithin(probe.signal, 2000)).toBe(true);
      });

      it(`${method}, ${shape}: a request that completes never aborts — and leaves no listener behind`, async () => {
        const srv = await serve();
        const { body } = send(srv.port, method, `/work?late=${late ? 1 : 0}`);
        const probe = await srv.started;
        await tick(30); // ample time for a premature 'close' to land while the client is still waiting
        expect(probe.signal.aborted).toBe(false);
        srv.release();
        expect(JSON.parse(await body)).toEqual({ aborted: false });
        // The connection is torn down after the response (no keep-alive): still no abort.
        expect(await abortedWithin(probe.signal, 100)).toBe(false);
        expect(probe.res.listenerCount('close')).toBeLessThanOrEqual(probe.closeListenersBefore);
      });
    }
  }

  it('a client already gone before the helper is called aborts at once (its close will not come again)', async () => {
    app = Fastify();
    let probe!: (s: AbortSignal) => void;
    const signalP = new Promise<AbortSignal>((r) => (probe = r));
    app.post('/slow-auth', async (req, reply) => {
      // e.g. the client timed out during auth: the socket closed before the route got to wire anything.
      await new Promise((r) => req.raw.socket.once('close', r));
      await tick(5);
      probe(abortOnClose(reply).signal);
      return { ok: true };
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const { req } = send(port, 'POST', '/slow-auth');
    await tick(30);
    req.destroy();
    const signal = await signalP;
    expect(signal.aborted).toBe(true);
  });

  it('wires the hang-up onto a controller the route already owns, and hands that one back', async () => {
    // Some routes own a controller with other reasons to fire (a deadline, an explicit cancel).
    app = Fastify();
    const own = new AbortController();
    let started!: () => void;
    const startedP = new Promise<void>((r) => (started = r));
    app.post('/own', async (_req, reply) => {
      expect(abortOnClose(reply, own)).toBe(own);
      started();
      await new Promise((r) => own.signal.addEventListener('abort', r));
      return { ok: true };
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const { req } = send(port, 'POST', '/own');
    await startedP;
    req.destroy();
    expect(await abortedWithin(own.signal, 2000)).toBe(true);
  });
});

describe('abortOnClose — the response-side states a socket cannot stage on demand', () => {
  /** A stand-in for the ServerResponse: the events and the two flags the helper reads. */
  const fakeRaw = (state: { writableFinished: boolean; destroyed: boolean }): EventEmitter & typeof state =>
    Object.assign(new EventEmitter(), state);

  it('a close that lands once the bytes are out (finish not yet delivered) is not a hang-up', () => {
    const raw = fakeRaw({ writableFinished: false, destroyed: false });
    const abort = abortOnClose({ raw: raw as unknown as ServerResponse });
    raw.writableFinished = true;
    raw.emit('close');
    expect(abort.signal.aborted).toBe(false);
  });

  it('called after the response was already sent and closed: nothing to abort', () => {
    const raw = fakeRaw({ writableFinished: true, destroyed: true });
    expect(abortOnClose({ raw: raw as unknown as ServerResponse }).signal.aborted).toBe(false);
  });
});
