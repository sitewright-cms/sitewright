import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { createApp } from '../src/http/app.js';
import { createDb, runMigrations } from '../src/db/client.js';
import { makeHarness, type Harness } from './harness.js';

let harness: Harness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe('liveness + readiness probes', () => {
  it('GET /health is a pure liveness ping (200, no DB touch)', async () => {
    harness = await makeHarness();
    const res = await harness.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('GET /ready confirms the DB is reachable (200)', async () => {
    harness = await makeHarness();
    const res = await harness.app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('GET /ready returns 503 (no error detail) when the DB is unreachable', async () => {
    // Boot a real app, then SEVER the DB by closing the underlying libsql client so the readiness
    // query rejects — the failure branch that drives orchestrator drain decisions.
    const file = join(tmpdir(), `sw-ready-${randomUUID()}.db`);
    const { db, client } = await createDb(`file:${file}`);
    await runMigrations(db);
    const app = await createApp({ db });
    await app.ready();
    client.close();
    try {
      const res = await app.inject({ method: 'GET', url: '/ready' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ ok: false }); // generic — no DB error detail leaked
    } finally {
      await app.close();
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
    }
  });
});

describe('HSTS header follows the secure-cookie (TLS) posture', () => {
  it('emits Strict-Transport-Security when served over HTTPS (secureCookies on)', async () => {
    harness = await makeHarness({ secureCookies: true });
    const res = await harness.app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000');
  });

  it('omits Strict-Transport-Security on a plain-HTTP deployment (secureCookies off)', async () => {
    harness = await makeHarness({ secureCookies: false });
    const res = await harness.app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('NEVER emits HSTS on a served client site — subdomain host (independent/plain-HTTP TLS)', async () => {
    // A `<slug>.<sitesDomain>` request must not get HSTS even with secureCookies on: that subdomain's TLS
    // is independent (may be plain-HTTP / not covered by the app cert) and pinning it would hard-break it.
    harness = await makeHarness({ secureCookies: true, sitesDomain: 'example.test' });
    const res = await harness.app.inject({
      method: 'GET',
      url: '/',
      headers: { host: 'shopco.example.test' },
    });
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('NEVER emits HSTS on a served client site — /sites/<slug>/ path form', async () => {
    harness = await makeHarness({ secureCookies: true });
    const res = await harness.app.inject({ method: 'GET', url: '/sites/shopco/' });
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });
});
