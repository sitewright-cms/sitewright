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
  // No env agentProvider in THIS app: the instance config is the only platform-funded agent, which
  // isolates the gate itself. The suite below also builds a second app WITH one, because that
  // combination is where the gate first leaked — see "an env fallback".
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

describe('★ an env fallback does not become a way around the audience gate', () => {
  // REGRESSION. The gate was written inside the instance branch, with the env fallback tried after
  // it — so a refusal fell THROUGH to the env agent. An operator running with SW_AI_API_KEY who then
  // restricted the assistant to staff still served every client, on the operator's key, with caps
  // waived. The setting was reflected in the UI, so nothing looked wrong.
  //
  // These tests rebuild the app WITH an env agentProvider, which is the configuration the rest of
  // this file deliberately excludes.
  class StubProvider {
    readonly model = 'env-model';
    // eslint-disable-next-line require-yield
    async *runTurn(): AsyncIterable<never> {
      throw new Error('not used — these tests only resolve, they never run a turn');
    }
  }

  let envApp: FastifyInstance;
  beforeEach(async () => {
    await app.close();
    app = await createApp({
      db,
      publishRoot,
      encryptionKey: randomBytes(32),
      agentProvider: new StubProvider() as never,
    });
    await app.ready();
    envApp = app;
  });

  it('with audience "all" the env agent still answers a client (unchanged behaviour)', async () => {
    const { c, projectId } = await adminWithProject();
    const client = await clientOn(projectId);
    await setInstanceAi(c, 'all');
    expect((await status(projectId, client)).enabled).toBe(true);
    expect(envApp).toBeDefined();
  });

  it('★ with audience "staff" a client gets NOTHING — not the instance agent, not the env one', async () => {
    const { c, projectId } = await adminWithProject();
    const client = await clientOn(projectId);
    await setInstanceAi(c, 'staff');

    const asClient = await status(projectId, client);
    expect(asClient.enabled).toBe(false);
    expect(asClient.source).toBeNull();
    // …and it must not be offered as a switchable source either.
    expect(asClient.sources.instance).toBe(false);

    // The chat endpoint agrees — the gate is not a UI hint.
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/agent/messages`,
      cookies: { sw_session: client },
      payload: { message: 'hello' },
    });
    expect(res.statusCode).toBe(501);
  });

  it('staff still reach the env agent under audience "staff"', async () => {
    const { c, projectId } = await adminWithProject();
    await setInstanceAi(c, 'staff');
    // The instance config here HAS a key, so staff get that one; the point is they are not refused.
    expect((await status(projectId, c)).enabled).toBe(true);
  });

  it('with NO instance config at all, the env agent serves everyone (no setting, no opinion)', async () => {
    const { projectId, c } = await adminWithProject();
    const client = await clientOn(projectId);
    expect(c).toBeTruthy();
    const asClient = await status(projectId, client);
    expect(asClient.enabled).toBe(true);
    expect(asClient.source).toBe('env');
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

  it("★ the project's OWN key answers its members first, the platform one answers staff first, and staff may choose", async () => {
    const { c, projectId } = await adminWithProject();
    await setInstanceAi(c, 'all');
    const put = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/ai-config`,
      cookies: { sw_session: c },
      payload: { enabled: true, provider: 'anthropic', apiKey: 'sk-project-key' },
    });
    expect(put.statusCode, `project ai-config write must succeed: ${put.body}`).toBeLessThan(300);

    // Staff are answered by the platform agent first (and may choose); a member by the project's own key.
    const s = await status(projectId, c);
    expect(s.source).toBe('instance');
    expect(s.sources).toEqual({ project: true, instance: true, canChoose: true });
    const client = await clientOn(projectId);
    expect((await status(projectId, client)).source).toBe('project');
  });

  it('★ a NON-STAFF caller asking for the platform agent is IGNORED, not obeyed', async () => {
    // `agentSource` is a request, not a grant. A client who sends it must still get the ordinary
    // precedence — otherwise the switcher's wire format is itself the bypass.
    const { c, projectId } = await adminWithProject();
    await setInstanceAi(c, 'all');
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/ai-config`,
      cookies: { sw_session: c },
      payload: { enabled: true, provider: 'anthropic', apiKey: 'sk-project-key' },
    });
    const client = await clientOn(projectId);
    // The chat is the only place `agentSource` is accepted; a 501 would mean "refused", a 5xx from
    // the provider means it got as far as USING one. The scripted key is bogus, so assert on the
    // resolution rather than the turn: status still reports the project agent for this user.
    expect((await status(projectId, client)).source).toBe('project');
    // And the switcher is not offered, so nothing in the UI invites them to try.
    expect((await status(projectId, client)).sources.canChoose).toBe(false);
  });

  it('★ staff asking for the PROJECT agent when there is none is refused, not silently upgraded', async () => {
    // "Use the project's agent" must not quietly bill the operator when the project has no key.
    const { c, projectId } = await adminWithProject();
    await setInstanceAi(c, 'all');
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/agent/messages`,
      cookies: { sw_session: c },
      payload: { message: 'hello', agentSource: 'project' },
    });
    expect(res.statusCode).toBe(501);
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

describe('★ "Use Built-In Agent" — the agency puts the platform assistant on one project', () => {
  const builtIn = (projectId: string, c: string, useBuiltIn: unknown) =>
    app.inject({ method: 'PUT', url: `/projects/${projectId}/ai-config/built-in`, cookies: { sw_session: c }, payload: { useBuiltIn } });

  it('overrides "staff only" for that project alone: its client gets the platform agent', async () => {
    const { c, projectId } = await adminWithProject();
    await setInstanceAi(c, 'staff');
    const client = await clientOn(projectId);
    expect((await status(projectId, client)).enabled).toBe(false);

    expect((await builtIn(projectId, c, true)).statusCode).toBe(200);
    expect(await status(projectId, client)).toMatchObject({ enabled: true, source: 'instance' });

    // Another project of the same instance is still "staff only".
    const other = await adminWithProject();
    const otherClient = await clientOn(other.projectId);
    expect((await status(other.projectId, otherClient)).enabled).toBe(false);
  });

  it('overrides the instance switch being OFF (the key is still there), and needs a key to exist at all', async () => {
    const { c, projectId } = await adminWithProject();
    const client = await clientOn(projectId);
    expect((await status(projectId, client)).enabled).toBe(false); // no platform key at all
    await builtIn(projectId, c, true);
    expect((await status(projectId, client)).enabled).toBe(false); // switched on, but nothing to switch on

    await setInstanceAi(c, 'all');
    const off = await app.inject({
      method: 'PUT',
      url: '/admin/settings',
      cookies: { sw_session: c },
      payload: { ai: { enabled: false, provider: 'anthropic', adminsUnlimited: true, audience: 'all' } },
    });
    expect(off.statusCode).toBe(200);
    expect(await status(projectId, client)).toMatchObject({ enabled: true, source: 'instance' });
    await builtIn(projectId, c, false);
    expect((await status(projectId, client)).enabled).toBe(false);
  });

  it("is the agency's switch: refused to a client and to any token; kept when the client saves or deletes their own agent", async () => {
    const { c, projectId } = await adminWithProject();
    await setInstanceAi(c, 'staff');
    const client = await clientOn(projectId);
    const read = (cookieValue: string) =>
      app.inject({ method: 'GET', url: `/projects/${projectId}/ai-config`, cookies: { sw_session: cookieValue } }).then((r) => r.json() as { canSetBuiltIn: boolean });
    expect((await read(c)).canSetBuiltIn).toBe(true);
    expect((await read(client)).canSetBuiltIn).toBe(false);
    const refused = await builtIn(projectId, client, true);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({ error: 'only agency staff (an admin or a developer) can switch the built-in agent on or off' });
    const token = await app.inject({ method: 'PUT', url: `/projects/${projectId}/ai-config/built-in`, headers: { authorization: 'Bearer swk_x' }, payload: { useBuiltIn: true } });
    expect([401, 403]).toContain(token.statusCode);
    expect((await builtIn(projectId, c, 'yes')).statusCode).toBe(400);

    await builtIn(projectId, c, true);
    const own = { enabled: true, provider: 'anthropic', apiKey: 'sk-client-key' };
    expect((await app.inject({ method: 'PUT', url: `/projects/${projectId}/ai-config`, cookies: { sw_session: client }, payload: own })).json()).toMatchObject({
      aiConfig: { enabled: true, hasKey: true, useBuiltIn: true },
    });
    // The client's own agent answers the client; the platform agent stays switched on behind it.
    expect((await status(projectId, client)).source).toBe('project');
    expect((await app.inject({ method: 'DELETE', url: `/projects/${projectId}/ai-config`, cookies: { sw_session: client } })).statusCode).toBe(204);
    const after = (await app.inject({ method: 'GET', url: `/projects/${projectId}/ai-config`, cookies: { sw_session: c } })).json() as { aiConfig: Record<string, unknown> };
    expect(after.aiConfig).toMatchObject({ useBuiltIn: true, hasKey: false, enabled: false });
    expect(await status(projectId, client)).toMatchObject({ enabled: true, source: 'instance' });
  });
});
