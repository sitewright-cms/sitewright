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

/** Enables HSTS on a harness by PUTting the setting as a fresh instance admin. */
async function enableHsts(h: Harness, patch: Record<string, unknown> = {}): Promise<void> {
  const admin = await h.signup({ admin: true });
  const res = await admin.put('/admin/settings', { hsts: { enabled: true, ...patch } });
  if (res.statusCode !== 200) throw new Error(`enable HSTS failed (${res.statusCode}): ${res.body}`);
}

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

describe('HSTS is admin opt-in (off by default)', () => {
  it('does NOT emit HSTS by default, even over HTTPS (secureCookies on)', async () => {
    harness = await makeHarness({ secureCookies: true });
    const res = await harness.app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('emits HSTS once an admin enables it (default max-age, takes effect without restart)', async () => {
    harness = await makeHarness();
    await enableHsts(harness);
    const res = await harness.app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000');
  });

  it('reflects maxAge + includeSubDomains + preload in the header string', async () => {
    harness = await makeHarness();
    await enableHsts(harness, { maxAgeSeconds: 15552000, includeSubDomains: true, preload: true });
    const res = await harness.app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['strict-transport-security']).toBe('max-age=15552000; includeSubDomains; preload');
  });

  it('EXCLUDES served client sites (subdomain + /sites/) unless applyToServedSites', async () => {
    harness = await makeHarness({ sitesDomain: 'example.test' });
    await enableHsts(harness); // applyToServedSites defaults false
    const sub = await harness.app.inject({ method: 'GET', url: '/', headers: { host: 'shopco.example.test' } });
    expect(sub.headers['strict-transport-security']).toBeUndefined();
    const path = await harness.app.inject({ method: 'GET', url: '/sites/shopco/' });
    expect(path.headers['strict-transport-security']).toBeUndefined();
    // ...but the platform origin still gets it.
    const apex = await harness.app.inject({ method: 'GET', url: '/health' });
    expect(apex.headers['strict-transport-security']).toBe('max-age=31536000');
  });

  it('applies HSTS to served sites when applyToServedSites is on', async () => {
    harness = await makeHarness({ sitesDomain: 'example.test' });
    await enableHsts(harness, { applyToServedSites: true });
    const sub = await harness.app.inject({ method: 'GET', url: '/', headers: { host: 'shopco.example.test' } });
    expect(sub.headers['strict-transport-security']).toBe('max-age=31536000');
  });
});
