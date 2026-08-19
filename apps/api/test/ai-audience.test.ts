import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount, addProjectMember } from '../src/repo/accounts.js';

/**
 * WHO the platform-funded assistant is offered to, and WHICH configuration answers.
 *
 * The instance config spends the operator's own API key. An agency that hands a client a login on a
 * project does not necessarily want to hand them that budget, so the platform assistant can be
 * restricted to STAFF — users holding a platform role (admin/developer) as opposed to a client who
 * only holds a project membership.
 *
 * ★ The gate is enforced on the RESOLVER, not on the button. These tests therefore drive the HTTP
 * surface a client could call directly, not the UI state.
 */

let db: Database;
let app: FastifyInstance;
let publishRoot: string;

function cookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

async function login(email: string): Promise<string> {
  return cookie(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
}

/** A platform ADMIN (the first account is seeded admin-capable) who owns a project. */
async function adminWithProject(): Promise<{ c: string; projectId: string }> {
  const email = `admin-${Math.random().toString(36).slice(2)}@e2e.test`;
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'admin' });
  const c = await login(email);
  const proj = await app.inject({
    method: 'POST',
    url: '/projects',
    cookies: { sw_session: c },
    payload: { name: 'A', slug: `p-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  });
  return { c, projectId: (proj.json() as { project: { id: string } }).project.id };
}

/**
 * A CLIENT: no platform role at all, holding a project membership.
 *
 * `member` is a WRITE role, so the assistant is not withheld for lack of permission — the only thing
 * separating this user from the admin is the absence of a platform role, which is exactly the axis
 * under test.
 */
async function clientOn(projectId: string): Promise<string> {
  const email = `client-${Math.random().toString(36).slice(2)}@e2e.test`;
  const { userId } = await registerAccount(db, email, 'Pw-secret-1');
  await addProjectMember(db, userId, projectId, 'member');
  return login(email);
}

/** Configure the platform-wide assistant with a given audience. */
async function setInstanceAi(c: string, audience: 'all' | 'staff'): Promise<void> {
  const res = await app.inject({
    method: 'PUT',
    url: '/admin/settings',
    cookies: { sw_session: c },
    payload: { ai: { enabled: true, provider: 'anthropic', apiKey: 'sk-test-key', adminsUnlimited: true, audience } },
  });
  // ★ A silently-400ing fixture write is how a vacuous test is born — assert it landed.
  expect(res.statusCode, `admin settings write must succeed: ${res.body}`).toBe(200);
}

const status = async (projectId: string, c: string) =>
  (await app.inject({ method: 'GET', url: `/projects/${projectId}/agent/status`, cookies: { sw_session: c } })).json() as {
    enabled: boolean;
    source: string | null;
    sources: { project: boolean; instance: boolean; canChoose: boolean };
  };

beforeEach(async () => {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-audience-'));
  db = await makeTestDb();
  // No env agentProvider: the ONLY platform-funded agent here is the instance config, so the
  // audience gate is what decides, with no env fallback quietly answering in its place.
  app = await createApp({ db, publishRoot, encryptionKey: randomBytes(32) });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await rm(publishRoot, { recursive: true, force: true });
});

describe('platform assistant audience', () => {
  it('audience "all": both staff and a client get the assistant', async () => {
    const { c, projectId } = await adminWithProject();
    const client = await clientOn(projectId);
    await setInstanceAi(c, 'all');

    expect((await status(projectId, c)).enabled).toBe(true);
    expect((await status(projectId, client)).enabled).toBe(true);
  });

  it('★ audience "staff": the client loses the assistant, the admin keeps it', async () => {
    const { c, projectId } = await adminWithProject();
    const client = await clientOn(projectId);
    await setInstanceAi(c, 'staff');

    expect((await status(projectId, c)).enabled).toBe(true);
    const asClient = await status(projectId, client);
    expect(asClient.enabled).toBe(false);
    expect(asClient.source).toBeNull();
  });

  it('★ the gate holds on the CHAT endpoint, not just the status probe', async () => {
    // A client who never sees the button can still POST. The resolver refuses, so the answer is the
    // same 501 as an unconfigured instance rather than a turn billed to the operator.
    const { c, projectId } = await adminWithProject();
    const client = await clientOn(projectId);
    await setInstanceAi(c, 'staff');

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/agent/messages`,
      cookies: { sw_session: client },
      payload: { message: 'hello' },
    });
    expect(res.statusCode).toBe(501);
  });

  it('defaults to "all" so an existing instance is unchanged by the upgrade', async () => {
    const { c, projectId } = await adminWithProject();
    const client = await clientOn(projectId);
    // Written WITHOUT an audience — exactly what a pre-upgrade row looks like.
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/settings',
      cookies: { sw_session: c },
      payload: { ai: { enabled: true, provider: 'anthropic', apiKey: 'sk-test-key', adminsUnlimited: true } },
    });
    expect(res.statusCode).toBe(200);
    expect((await status(projectId, client)).enabled).toBe(true);
  });
});

describe('which agent answers', () => {
  it('a project with no key of its own falls through to the platform agent', async () => {
    const { c, projectId } = await adminWithProject();
    await setInstanceAi(c, 'all');
    const s = await status(projectId, c);
    expect(s.source).toBe('instance');
    expect(s.sources.project).toBe(false);
    // Nothing to switch between, so no switcher.
    expect(s.sources.canChoose).toBe(false);
  });

  it("★ the project's OWN key wins over the platform one, and staff may then choose", async () => {
    const { c, projectId } = await adminWithProject();
    await setInstanceAi(c, 'all');
    const put = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/ai-config`,
      cookies: { sw_session: c },
      payload: { enabled: true, provider: 'anthropic', apiKey: 'sk-project-key' },
    });
    expect(put.statusCode, `project ai-config write must succeed: ${put.body}`).toBeLessThan(300);

    const s = await status(projectId, c);
    expect(s.source).toBe('project'); // precedence: the project's own budget, not the operator's
    expect(s.sources).toEqual({ project: true, instance: true, canChoose: true });
  });

  it('a CLIENT is never offered the choice, even with both configured', async () => {
    const { c, projectId } = await adminWithProject();
    await setInstanceAi(c, 'all');
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/ai-config`,
      cookies: { sw_session: c },
      payload: { enabled: true, provider: 'anthropic', apiKey: 'sk-project-key' },
    });
    const client = await clientOn(projectId);

    const s = await status(projectId, client);
    expect(s.enabled).toBe(true); // the project's own agent still serves them
    expect(s.source).toBe('project');
    expect(s.sources.canChoose).toBe(false);
  });
});
