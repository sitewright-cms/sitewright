import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

let db: Database;
let app: FastifyInstance;
let publishRoot: string;

function cookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

async function adminSession(): Promise<string> {
  const email = `admin-${Math.random().toString(36).slice(2)}@e2e.test`;
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'admin' });
  return cookie(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
}

beforeEach(async () => {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-aicfg-'));
  db = await makeTestDb();
  app = await createApp({ db, publishRoot, encryptionKey: randomBytes(32) });
  await app.ready();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
  await rm(publishRoot, { recursive: true, force: true });
});

describe('instance AI settings', () => {
  it('round-trips the ai section, masks the key, and preserves it when omitted', async () => {
    const c = await adminSession();
    const put = await app.inject({
      method: 'PUT',
      url: '/admin/settings',
      cookies: { sw_session: c },
      payload: { ai: { enabled: true, provider: 'anthropic', model: 'claude-haiku-4-5', apiKey: 'sk-secret', defaultProjectMonthlyTokens: 100000, adminsUnlimited: true } },
    });
    expect(put.statusCode).toBe(200);
    const body = put.json() as { settings: { ai: { enabled: boolean; provider: string; model: string; hasApiKey: boolean; defaultProjectMonthlyTokens: number } } };
    expect(body.settings.ai).toMatchObject({ enabled: true, provider: 'anthropic', model: 'claude-haiku-4-5', hasApiKey: true, defaultProjectMonthlyTokens: 100000 });

    // Re-PUT without the key → it's preserved; the model changes.
    const edit = await app.inject({
      method: 'PUT',
      url: '/admin/settings',
      cookies: { sw_session: c },
      payload: { ai: { enabled: true, provider: 'anthropic', model: 'claude-opus-4-8' } },
    });
    const edited = edit.json() as { settings: { ai: { model: string; hasApiKey: boolean } } };
    expect(edited.settings.ai).toMatchObject({ model: 'claude-opus-4-8', hasApiKey: true });

    // `null` clears the whole section.
    const cleared = await app.inject({ method: 'PUT', url: '/admin/settings', cookies: { sw_session: c }, payload: { ai: null } });
    expect((cleared.json() as { settings: { ai?: unknown } }).settings.ai).toBeUndefined();
  });
});

describe('per-project ai-config (BYO)', () => {
  async function ownerProject(): Promise<{ c: string; projectId: string }> {
    const email = `owner-${Math.random().toString(36).slice(2)}@e2e.test`;
    await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
    const c = cookie(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
    const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: c }, payload: { name: 'S', slug: `p-${Date.now()}-${Math.random().toString(36).slice(2)}` } });
    return { c, projectId: (proj.json() as { project: { id: string } }).project.id };
  }

  it('PUT/GET masks the key, preserves it, and DELETE removes it', async () => {
    const { c, projectId } = await ownerProject();
    const url = `/projects/${projectId}/ai-config`;
    const put = await app.inject({
      method: 'PUT',
      url,
      cookies: { sw_session: c },
      payload: { enabled: true, provider: 'openai', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-proj', monthlyTokenLimit: 50000 },
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as { aiConfig: { hasKey: boolean; provider: string } }).aiConfig).toMatchObject({ hasKey: true, provider: 'openai', enabled: true });

    const get = await app.inject({ method: 'GET', url, cookies: { sw_session: c } });
    expect((get.json() as { aiConfig: { hasKey: boolean; model: string } }).aiConfig).toMatchObject({ hasKey: true, model: 'gpt-4o-mini' });
    expect(JSON.stringify(get.json())).not.toContain('sk-proj'); // secret never returned

    // Re-PUT without the key → preserved.
    const edit = await app.inject({ method: 'PUT', url, cookies: { sw_session: c }, payload: { enabled: false, provider: 'openai', model: 'gpt-4o' } });
    expect((edit.json() as { aiConfig: { hasKey: boolean; enabled: boolean } }).aiConfig).toMatchObject({ hasKey: true, enabled: false });

    const del = await app.inject({ method: 'DELETE', url, cookies: { sw_session: c } });
    expect(del.statusCode).toBe(204);
    const gone = await app.inject({ method: 'GET', url, cookies: { sw_session: c } });
    expect((gone.json() as { aiConfig: unknown }).aiConfig).toBeNull();
  });
});

describe('resolveAiProvider precedence', () => {
  // Any real provider call 401s against a stubbed fetch → no network; we assert the resolved model
  // via the `start` SSE frame (emitted before the provider call).
  function stubFetch401(): void {
    vi.stubGlobal('fetch', async () => new Response('unauthorized', { status: 401 }));
  }
  function modelFromFrames(payload: string): string | undefined {
    return /event: start\ndata: {[^}]*"model":"([^"]+)"/.exec(payload)?.[1];
  }

  it('per-project BYO overrides the platform instance config', async () => {
    stubFetch401();
    // Platform (admin) config: model inst-model.
    const admin = await adminSession();
    await app.inject({ method: 'PUT', url: '/admin/settings', cookies: { sw_session: admin }, payload: { ai: { enabled: true, provider: 'anthropic', model: 'inst-model', apiKey: 'sk-inst' } } });
    const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: admin }, payload: { name: 'S', slug: `pr-${Date.now()}` } });
    const projectId = (proj.json() as { project: { id: string } }).project.id;

    // With only the instance config, the assistant uses inst-model.
    const r1 = await app.inject({ method: 'POST', url: `/projects/${projectId}/agent/messages`, cookies: { sw_session: admin }, payload: { message: 'hi' } });
    expect(r1.statusCode).toBe(200);
    expect(modelFromFrames(r1.payload)).toBe('inst-model');
    expect(r1.payload).toContain('event: error'); // 401 from the stubbed provider

    // Add a per-project BYO config with proj-model → it overrides.
    await app.inject({ method: 'PUT', url: `/projects/${projectId}/ai-config`, cookies: { sw_session: admin }, payload: { enabled: true, provider: 'anthropic', model: 'proj-model', apiKey: 'sk-proj' } });
    const r2 = await app.inject({ method: 'POST', url: `/projects/${projectId}/agent/messages`, cookies: { sw_session: admin }, payload: { message: 'hi' } });
    expect(modelFromFrames(r2.payload)).toBe('proj-model');
  });

  it('an enabled-but-keyless BYO config falls through to the platform config (not 501/broken)', async () => {
    stubFetch401();
    const admin = await adminSession();
    await app.inject({ method: 'PUT', url: '/admin/settings', cookies: { sw_session: admin }, payload: { ai: { enabled: true, provider: 'anthropic', model: 'inst-model', apiKey: 'sk-inst' } } });
    const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: admin }, payload: { name: 'S', slug: `pr3-${Date.now()}` } });
    const projectId = (proj.json() as { project: { id: string } }).project.id;
    // BYO enabled but NO apiKey → must not become the provider; falls through to the platform config.
    await app.inject({ method: 'PUT', url: `/projects/${projectId}/ai-config`, cookies: { sw_session: admin }, payload: { enabled: true, provider: 'anthropic', model: 'proj-model' } });
    const r = await app.inject({ method: 'POST', url: `/projects/${projectId}/agent/messages`, cookies: { sw_session: admin }, payload: { message: 'hi' } });
    expect(r.statusCode).toBe(200);
    expect(modelFromFrames(r.payload)).toBe('inst-model'); // fell through to the platform config
  });

  it('rejects a private-host baseUrl (SSRF guard)', async () => {
    const admin = await adminSession();
    const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: admin }, payload: { name: 'S', slug: `pr4-${Date.now()}` } });
    const projectId = (proj.json() as { project: { id: string } }).project.id;
    for (const baseUrl of ['http://169.254.169.254/v1', 'http://localhost:8080/v1', 'http://10.0.0.5/v1']) {
      const res = await app.inject({ method: 'PUT', url: `/projects/${projectId}/ai-config`, cookies: { sw_session: admin }, payload: { enabled: true, provider: 'openai', baseUrl, apiKey: 'k' } });
      expect(res.statusCode).toBe(400);
    }
  });

  it('501s when nothing is configured', async () => {
    const admin = await adminSession();
    const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: admin }, payload: { name: 'S', slug: `pr2-${Date.now()}` } });
    const projectId = (proj.json() as { project: { id: string } }).project.id;
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/agent/messages`, cookies: { sw_session: admin }, payload: { message: 'hi' } });
    expect(res.statusCode).toBe(501);
  });
});
