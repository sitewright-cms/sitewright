import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { memberTokenCreations, memberTokenProjects, memberTokens, projectMembers, users } from '../src/db/schema.js';
import { addProjectMember, setPlatformRole } from '../src/repo/accounts.js';
import { MemberTokenRepository, MAX_ACTIVE_MEMBER_TOKENS } from '../src/repo/member-tokens.js';
import { GLOBAL_SCOPE_ID, ensureGlobalProject } from '../src/repo/global-library.js';

let h: Harness;
let admin: TestClient;
let dev: TestClient;
let otherDev: TestClient;
let client: TestClient;

type Res = Awaited<ReturnType<TestClient['get']>>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const PAGE = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' } };
const CONTENT = ['content:read', 'content:write'];
/** Every harness account signs up with this password; minting re-authenticates with it. */
const PASSWORD = 'Pw-secret-1';

/** Sends a request authenticated ONLY by a bearer token — no session cookie anywhere near it. */
function withToken(token: string, method: Method, url: string, payload?: unknown): Promise<Res> {
  return h.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: payload as never });
}

async function mint(who: TestClient, capabilities: string[], extra: Record<string, unknown> = {}): Promise<{ token: string; id: string }> {
  const res = await who.post('/account/member-tokens', { name: 'automation', expiresInDays: 30, currentPassword: PASSWORD, capabilities, ...extra });
  if (res.statusCode !== 201) throw new Error(`mint failed (${res.statusCode}): ${res.body}`);
  const body = res.json() as { token: string; key: { id: string } };
  return { token: body.token, id: body.key.id };
}

beforeEach(async () => {
  h = await makeHarness();
  admin = await h.signup({ admin: true });
  dev = await h.signup({ email: 'dev@agency.test' });
  otherDev = await h.signup({ email: 'other@agency.test' });
  client = await h.signup({ email: 'client@customer.test' });
  await setPlatformRole(h.db, dev.userId, 'developer');
  await setPlatformRole(h.db, otherDev.userId, 'developer');
});
afterEach(async () => {
  await h.close();
});

describe('member tokens — management', () => {
  it('a staff member mints a token: shown once, listed redacted, capabilities in canonical order', async () => {
    const res = await dev.post('/account/member-tokens', {
      name: 'fleet',
      expiresInDays: 30,
      currentPassword: PASSWORD,
      capabilities: ['projects:create', 'content:write', 'content:read'],
    });
    expect(res.statusCode).toBe(201);
    const made = res.json() as { token: string; key: Record<string, unknown> };
    expect(made.token.startsWith('swm_')).toBe(true);
    expect(made.key.capabilities).toEqual(['content:read', 'content:write', 'projects:create']);
    expect(made.key.tokenPrefix).toBe(made.token.slice(0, 12));
    expect(JSON.stringify(made.key)).not.toContain(made.token);

    const list = await dev.get('/account/member-tokens');
    expect(list.statusCode).toBe(200);
    const body = list.json() as { items: Array<Record<string, unknown>>; dailyProjectCap: number };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.name).toBe('fleet');
    expect(body.dailyProjectCap).toBe(50);
    // Neither the secret nor its hash ever leaves the server again.
    expect(list.body).not.toContain(made.token);
    expect(list.body).not.toContain('tokenHash');
    const [row] = await h.db.select().from(memberTokens);
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.tokenHash).not.toBe(made.token);
  });

  it('only staff may mint — an invited client is refused, and sees an empty list', async () => {
    const res = await client.post('/account/member-tokens', { name: 'x', expiresInDays: 1, currentPassword: PASSWORD, capabilities: ['content:read'] });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'only agency staff can create member tokens' });
    expect(((await client.get('/account/member-tokens')).json() as { items: unknown[] }).items).toEqual([]);
    expect(await h.db.select().from(memberTokens)).toHaveLength(0);
  });

  it('★ a token can never mint, list or revoke tokens — management is session-only', async () => {
    const { token, id } = await mint(dev, [...CONTENT, 'projects:create']);
    const projectId = await dev.createProject('Site', 'site', { localHosting: false });
    const key = (
      (await dev.post(`/projects/${projectId}/api-keys`, { name: 'k', role: 'owner', expiresInDays: 1, capabilities: CONTENT })).json() as { token: string }
    ).token;

    for (const bearer of [token, key]) {
      for (const res of [
        await withToken(bearer, 'POST', '/account/member-tokens', { name: 'again', expiresInDays: 1, currentPassword: PASSWORD, capabilities: ['content:read'] }),
        await withToken(bearer, 'GET', '/account/member-tokens'),
        await withToken(bearer, 'DELETE', `/account/member-tokens/${id}`),
        // …nor a project key for a project it can reach.
        await withToken(bearer, 'POST', `/projects/${projectId}/api-keys`, { name: 'k2', role: 'owner', expiresInDays: 1, capabilities: CONTENT }),
        await withToken(bearer, 'GET', `/projects/${projectId}/api-keys`),
      ]) {
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'this operation requires an interactive session' });
      }
    }
    expect(await h.db.select().from(memberTokens)).toHaveLength(1);
  });

  it('rejects a token with no capability, an unknown one, or a lifetime over a year', async () => {
    for (const body of [
      { name: 'x', expiresInDays: 30, capabilities: [] },
      { name: 'x', expiresInDays: 30, capabilities: ['instance:admin'] },
      { name: 'x', expiresInDays: 366, capabilities: ['content:read'] },
      { name: '', expiresInDays: 30, capabilities: ['content:read'] },
    ]) {
      expect((await dev.post('/account/member-tokens', { currentPassword: PASSWORD, ...body })).statusCode).toBe(400);
    }
    expect(await h.db.select().from(memberTokens)).toHaveLength(0);
  });

  it('★ minting re-authenticates: a session alone — a stolen one, say — cannot mint a token', async () => {
    const body = { name: 'x', expiresInDays: 30, capabilities: ['content:read'] };
    // No password at all is a malformed request; a wrong one is refused as 403, not 401, so the
    // editor does not sign the member out for a typo.
    expect((await dev.post('/account/member-tokens', body)).statusCode).toBe(400);
    const wrong = await dev.post('/account/member-tokens', { ...body, currentPassword: 'not-the-password' });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toEqual({ error: 'current password is incorrect' });

    // A single-sign-on account has no password to confirm with, and is told what to do about it.
    await h.db.update(users).set({ passwordHash: null }).where(eq(users.id, otherDev.userId));
    const sso = await otherDev.post('/account/member-tokens', { ...body, currentPassword: 'anything' });
    expect(sso.statusCode).toBe(403);
    expect((sso.json() as { error: string }).error).toMatch(/set a password in Account → Password first/);

    expect(await h.db.select().from(memberTokens)).toHaveLength(0);
    expect((await dev.post('/account/member-tokens', { ...body, currentPassword: PASSWORD })).statusCode).toBe(201);
  });

  it('revoking kills the token at once; a second revoke, or someone else’s token, is a 404', async () => {
    const { token, id } = await mint(dev, CONTENT);
    expect((await withToken(token, 'GET', '/projects')).statusCode).toBe(200);

    // Another member cannot revoke it, and cannot tell it exists.
    expect((await otherDev.del(`/account/member-tokens/${id}`)).statusCode).toBe(404);
    expect((await withToken(token, 'GET', '/projects')).statusCode).toBe(200);

    expect((await dev.del(`/account/member-tokens/${id}`)).statusCode).toBe(204);
    const dead = await withToken(token, 'GET', '/projects');
    expect(dead.statusCode).toBe(401);
    expect(dead.json()).toEqual({ error: 'invalid or expired API key' });
    expect((await dev.del(`/account/member-tokens/${id}`)).statusCode).toBe(404);
    expect(((await dev.get('/account/member-tokens')).json() as { items: unknown[] }).items).toEqual([]);
  });

  it(`caps one account at ${MAX_ACTIVE_MEMBER_TOKENS} live tokens, and a revoked one frees a slot`, async () => {
    const repo = new MemberTokenRepository(h.db);
    const expiresAt = new Date(Date.now() + 86_400_000);
    const ids: string[] = [];
    for (let i = 0; i < MAX_ACTIVE_MEMBER_TOKENS; i += 1) {
      ids.push((await repo.create(dev.userId, { name: `t${i}`, capabilities: ['content:read'], expiresAt })).key.id);
    }
    const over = await dev.post('/account/member-tokens', { name: 'one more', expiresInDays: 1, currentPassword: PASSWORD, capabilities: ['content:read'] });
    expect(over.statusCode).toBe(403);
    expect((over.json() as { error: string }).error).toMatch(/already have 25 active member tokens/);

    await repo.revoke(dev.userId, ids[0] as string);
    expect((await dev.post('/account/member-tokens', { name: 'one more', expiresInDays: 1, currentPassword: PASSWORD, capabilities: ['content:read'] })).statusCode).toBe(201);
  });
});

describe('member tokens — reaching projects', () => {
  it('reaches EVERY project its owner can, with no per-project key', async () => {
    const a = await dev.createProject('A', 'a', { localHosting: false });
    const b = await dev.createProject('B', 'b', { localHosting: false });
    const { token } = await mint(dev, CONTENT);
    for (const id of [a, b]) {
      expect((await withToken(token, 'PUT', `/projects/${id}/content/page/home`, PAGE)).statusCode).toBe(200);
      expect((await withToken(token, 'GET', `/projects/${id}/content/page`)).statusCode).toBe(200);
    }
  });

  it('★ access follows the member’s CURRENT membership — granted and withdrawn without touching the token', async () => {
    const theirs = await otherDev.createProject('Theirs', 'theirs', { localHosting: false });
    const { token } = await mint(dev, CONTENT);
    const read = () => withToken(token, 'GET', `/projects/${theirs}/content/page`);

    // Not a member: the project does not exist as far as the token can tell (404, never 403).
    const before = await read();
    expect(before.statusCode).toBe(404);
    expect(before.json()).toEqual({ error: 'project not found' });

    await addProjectMember(h.db, dev.userId, theirs, 'member');
    expect((await read()).statusCode).toBe(200);
    // …at the role held THERE: a `member` is not an owner, whatever the token was minted with.
    const rename = await mint(dev, [...CONTENT, 'projects:rename']);
    const denied = await withToken(rename.token, 'PATCH', `/projects/${theirs}`, { name: 'Mine now' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: 'insufficient role to rename this project' });

    await h.db.delete(projectMembers).where(eq(projectMembers.userId, dev.userId));
    expect((await read()).statusCode).toBe(404);
  });

  it('an instance admin’s token reaches every project, as the admin does', async () => {
    const theirs = await dev.createProject('Dev site', 'dev-site', { localHosting: false });
    const { token } = await mint(admin, CONTENT);
    expect((await withToken(token, 'PUT', `/projects/${theirs}/content/page/home`, PAGE)).statusCode).toBe(200);
  });

  it('capabilities narrow it: a read-only token cannot write or delete', async () => {
    const projectId = await dev.createProject('Site', 'site', { localHosting: false });
    const { token } = await mint(dev, ['content:read']);
    const write = await withToken(token, 'PUT', `/projects/${projectId}/content/page/home`, PAGE);
    expect(write.statusCode).toBe(403);
    expect(write.json()).toEqual({ error: 'this member token lacks the "content:write" capability' });
    expect((await withToken(token, 'DELETE', `/projects/${projectId}/content/page/home`)).statusCode).toBe(403);
    expect((await withToken(token, 'GET', `/projects/${projectId}/content/page`)).statusCode).toBe(200);
  });

  it('★ a token that lacks the capability cannot map which projects its owner reaches', async () => {
    const mine = await dev.createProject('Mine', 'mine', { localHosting: false });
    const theirs = await otherDev.createProject('Theirs', 'theirs', { localHosting: false });
    // No content:read. If the project were looked up first, "403 here, 404 there" would tell a
    // reachable id from an unreachable one; checking the capability first gives one answer for all.
    const { token } = await mint(dev, ['projects:create']);
    const answers = await Promise.all(
      [mine, theirs, 'no-such-project'].map(async (id) => {
        const res = await withToken(token, 'GET', `/projects/${id}/content/page`);
        return { status: res.statusCode, body: res.json() as unknown };
      }),
    );
    expect(answers[0]).toEqual({ status: 403, body: { error: 'this member token lacks the "content:read" capability' } });
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    // …and a refused request leaves no trace of the token on the project.
    await new Promise((r) => setTimeout(r, 50));
    expect(await h.db.select().from(memberTokenProjects)).toHaveLength(0);
  });

  it('refuses a session cookie and a bearer together, an unknown token, and the global library scope', async () => {
    await ensureGlobalProject(h.db);
    const projectId = await dev.createProject('Site', 'site', { localHosting: false });
    const { token } = await mint(admin, CONTENT);

    const both = await dev.inject({ method: 'GET', url: `/projects/${projectId}/content/page`, headers: { authorization: `Bearer ${token}` } });
    expect(both.statusCode).toBe(401);
    const bothOnList = await dev.inject({ method: 'GET', url: '/projects', headers: { authorization: `Bearer ${token}` } });
    expect(bothOnList.statusCode).toBe(401);

    expect((await withToken(`swm_${'0'.repeat(64)}`, 'GET', `/projects/${projectId}/content/page`)).statusCode).toBe(401);
    expect((await withToken(`swm_${'0'.repeat(64)}`, 'GET', '/projects')).statusCode).toBe(401);

    // Even an ADMIN's token: the library is reachable only through its own session-only routes.
    for (const res of [
      await withToken(token, 'GET', `/projects/${GLOBAL_SCOPE_ID}/content/page`),
      await withToken(token, 'GET', `/projects/${GLOBAL_SCOPE_ID}`),
      await withToken(token, 'DELETE', `/projects/${GLOBAL_SCOPE_ID}`),
    ]) {
      expect(res.statusCode).toBe(404);
    }
  });

  it('an expired token stops working, and a soft-deleted project is unreachable', async () => {
    const projectId = await dev.createProject('Site', 'site', { localHosting: false });
    const repo = new MemberTokenRepository(h.db);
    // Minted two days ago with a one-day life: valid when made, expired now.
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    const expired = await repo.create(dev.userId, { name: 'old', capabilities: ['content:read'], expiresAt: new Date(Date.now() - 86_400_000) }, twoDaysAgo);
    expect((await withToken(expired.token, 'GET', `/projects/${projectId}/content/page`)).statusCode).toBe(401);

    const { token } = await mint(dev, CONTENT);
    expect((await withToken(token, 'GET', `/projects/${projectId}/content/page`)).statusCode).toBe(200);
    expect((await dev.del(`/projects/${projectId}`)).statusCode).toBe(204);
    expect((await withToken(token, 'GET', `/projects/${projectId}/content/page`)).statusCode).toBe(404);
    expect((await withToken(token, 'GET', `/projects/${projectId}`)).statusCode).toBe(404);
  });

  it('★ losing staff rights ends the token immediately, and re-promotion does not bring it back', async () => {
    const projectId = await dev.createProject('Site', 'site', { localHosting: false });
    const { token } = await mint(dev, CONTENT);
    const read = () => withToken(token, 'GET', `/projects/${projectId}/content/page`);
    expect((await read()).statusCode).toBe(200);

    // The role alone is enough — nothing has revoked the row yet.
    await setPlatformRole(h.db, dev.userId, null);
    expect((await read()).statusCode).toBe(401);
    const [live] = await h.db.select().from(memberTokens);
    expect(live?.revokedAt).toBeNull();
    await setPlatformRole(h.db, dev.userId, 'developer');
    expect((await read()).statusCode).toBe(200);

    // The admin's "remove from the platform team" action revokes as well, so promoting the same
    // person again later hands back nothing.
    expect((await admin.del(`/admin/users/${dev.userId}`)).statusCode).toBe(204);
    expect((await read()).statusCode).toBe(401);
    await setPlatformRole(h.db, dev.userId, 'developer');
    expect((await read()).statusCode).toBe(401);
    const [revoked] = await h.db.select().from(memberTokens);
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
  });

  it('★ changing the password — or an admin resetting it — revokes the member tokens made with it', async () => {
    const mine = await mint(dev, CONTENT);
    const theirs = await mint(otherDev, CONTENT);
    const works = async (token: string): Promise<number> => (await withToken(token, 'GET', '/projects')).statusCode;
    expect(await works(mine.token)).toBe(200);

    // A password changed to shut someone out has to shut their tokens out too.
    const changed = await dev.put('/account/password', { currentPassword: PASSWORD, newPassword: 'A-brand-new-pw-7' });
    expect(changed.statusCode).toBe(204);
    expect(await works(mine.token)).toBe(401);
    expect(((await dev.get('/account/member-tokens')).json() as { items: unknown[] }).items).toEqual([]);
    // Nobody else's token is touched.
    expect(await works(theirs.token)).toBe(200);

    // An admin reset is the "this account may be compromised" path, and ends them the same way.
    expect((await admin.post(`/admin/users/${otherDev.userId}/password`)).statusCode).toBe(200);
    expect(await works(theirs.token)).toBe(401);
  });

  it('introspects as a member token (no project), while a project key still names its project', async () => {
    const projectId = await dev.createProject('Site', 'site', { localHosting: false });
    const { token } = await mint(dev, ['content:read', 'projects:create']);
    const self = await withToken(token, 'GET', '/api-key/self');
    expect(self.statusCode).toBe(200);
    const body = self.json() as Record<string, unknown>;
    expect(body.kind).toBe('member');
    expect(body.capabilities).toEqual(['content:read', 'projects:create']);
    expect(body).not.toHaveProperty('projectId');
    expect(typeof body.agentInstructions).toBe('string');

    const key = ((await dev.post(`/projects/${projectId}/api-keys`, { name: 'k', role: 'owner', expiresInDays: 1, capabilities: CONTENT })).json() as { token: string }).token;
    const keySelf = (await withToken(key, 'GET', '/api-key/self')).json() as Record<string, unknown>;
    expect(keySelf.kind).toBe('project');
    expect(keySelf.projectId).toBe(projectId);
  });

  it('is turned away from the MCP endpoint with a reason, not a string of failing tool calls', async () => {
    const { token } = await mint(dev, CONTENT);
    const res = await h.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', authorization: `Bearer ${token}` },
      payload: { jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { id: number; error: { message: string } };
    expect(body.id).toBe(7);
    expect(body.error.message).toMatch(/member token is not bound to one project/);
  });
});

describe('member tokens — the project list, and creating projects', () => {
  it('lists what its owner can reach (needs content:read); a project key still cannot list', async () => {
    const mine = await dev.createProject('Mine', 'mine', { localHosting: false });
    await otherDev.createProject('Theirs', 'theirs', { localHosting: false });
    const { token } = await mint(dev, ['content:read']);
    const list = await withToken(token, 'GET', '/projects');
    expect(list.statusCode).toBe(200);
    expect((list.json() as { projects: Array<{ id: string; role: string }> }).projects).toEqual([
      expect.objectContaining({ id: mine, role: 'owner' }),
    ]);
    const one = await withToken(token, 'GET', `/projects/${mine}`);
    expect((one.json() as { project: { id: string } }).project.id).toBe(mine);

    const blind = await mint(dev, ['projects:create']);
    expect((await withToken(blind.token, 'GET', '/projects')).statusCode).toBe(403);
    expect((await withToken(blind.token, 'GET', `/projects/${mine}`)).statusCode).toBe(403);

    const key = ((await dev.post(`/projects/${mine}/api-keys`, { name: 'k', role: 'owner', expiresInDays: 1, capabilities: CONTENT })).json() as { token: string }).token;
    expect((await withToken(key, 'GET', '/projects')).statusCode).toBe(401);
  });

  it('★ creates a project and manages it at once with the SAME token', async () => {
    const { token, id } = await mint(dev, [...CONTENT, 'projects:create']);
    const made = await withToken(token, 'POST', '/projects', { name: 'Fresh', slug: 'fresh' });
    expect(made.statusCode).toBe(201);
    const project = (made.json() as { project: { id: string; role: string } }).project;
    expect(project.role).toBe('owner');

    expect((await withToken(token, 'PUT', `/projects/${project.id}/content/page/about`, { ...PAGE, id: 'about', path: 'about', title: 'About' })).statusCode).toBe(200);
    // The member can open it in the editor too — it is THEIR project, not the token's.
    expect(((await dev.get('/projects')).json() as { projects: Array<{ id: string }> }).projects.map((p) => p.id)).toContain(project.id);
    // Provenance: which token made it — kept in a ledger that does not depend on the project surviving.
    const [made1] = await h.db.select().from(memberTokenCreations).where(eq(memberTokenCreations.projectId, project.id));
    expect(made1?.tokenId).toBe(id);
    expect(made1?.createdAt).toBeInstanceOf(Date);
    // …and the new project lists the token as connected straight away.
    const [row] = await h.db.select().from(memberTokenProjects).where(eq(memberTokenProjects.projectId, project.id));
    expect(row?.tokenId).toBe(id);
  });

  it('needs projects:create — and a project key still cannot create a project at all', async () => {
    const { token } = await mint(dev, CONTENT);
    const denied = await withToken(token, 'POST', '/projects', { name: 'No', slug: 'no' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: 'this member token lacks the "projects:create" capability' });

    const projectId = await dev.createProject('Site', 'site', { localHosting: false });
    const key = ((await dev.post(`/projects/${projectId}/api-keys`, { name: 'k', role: 'owner', expiresInDays: 1, capabilities: CONTENT })).json() as { token: string }).token;
    for (const res of [
      await withToken(key, 'POST', '/projects', { name: 'No', slug: 'no' }),
      await withToken(key, 'POST', `/projects/${projectId}/duplicate`),
      await withToken(key, 'POST', '/projects/import/zip'),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'this operation requires an interactive session' });
    }
  });
});

describe('member tokens — creation is rate-limited as well as capped', () => {
  it('a token asking faster than 30 times a minute is told to slow down; a session keeps its own ceiling', async () => {
    const { token } = await mint(dev, ['projects:create']);
    // Malformed on purpose: the limiter counts requests, so this needs no thirty real projects.
    const statuses: number[] = [];
    for (let i = 0; i < 31; i += 1) statuses.push((await withToken(token, 'POST', '/projects', { name: '' })).statusCode);
    expect(statuses.slice(0, 30).every((s) => s === 400)).toBe(true);
    expect(statuses[30]).toBe(429);
    // The member, signed in, is not sharing that bucket.
    expect((await dev.post('/projects', { name: 'By hand', slug: 'by-hand' })).statusCode).toBe(201);
  });
});

describe('member tokens — the daily project cap', () => {
  beforeEach(async () => {
    await h.close();
    h = await makeHarness({ memberTokenDailyProjectCap: 2 });
    dev = await h.signup({ email: 'dev@agency.test' });
    await setPlatformRole(h.db, dev.userId, 'developer');
  });

  it('stops at the cap with a 429, per token — a session and another token are unaffected', async () => {
    const { token } = await mint(dev, ['projects:create']);
    expect((await withToken(token, 'POST', '/projects', { name: 'One', slug: 'one' })).statusCode).toBe(201);
    expect((await withToken(token, 'POST', '/projects', { name: 'Two', slug: 'two' })).statusCode).toBe(201);
    const third = await withToken(token, 'POST', '/projects', { name: 'Three', slug: 'three' });
    expect(third.statusCode).toBe(429);
    expect(third.json()).toEqual({ error: 'this member token has reached its limit of 2 new projects per 24 hours' });

    expect((await dev.post('/projects', { name: 'By hand', slug: 'by-hand' })).statusCode).toBe(201);
    const second = await mint(dev, ['projects:create']);
    expect((await withToken(second.token, 'POST', '/projects', { name: 'Other', slug: 'other' })).statusCode).toBe(201);
  });

  it('★ holds under concurrency: five simultaneous creations, exactly two get through', async () => {
    const { token } = await mint(dev, ['projects:create']);
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => withToken(token, 'POST', '/projects', { name: `P${n}`, slug: `p${n}` })),
    );
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 201, 429, 429, 429]);
    expect(((await dev.get('/projects')).json() as { projects: unknown[] }).projects).toHaveLength(2);
  });

  it('a creation that never happened costs nothing — and frees its place for the next', async () => {
    const { token } = await mint(dev, ['projects:create', 'content:read']);
    // Refused for a bad body, a taken slug, and an empty upload: none of them made a project.
    expect((await withToken(token, 'POST', '/projects', { name: '' })).statusCode).toBe(400);
    expect((await withToken(token, 'POST', '/projects', { name: 'One', slug: 'one' })).statusCode).toBe(201);
    expect((await withToken(token, 'POST', '/projects', { name: 'Dup', slug: 'one' })).statusCode).toBe(409);
    expect((await withToken(token, 'POST', '/projects/import/zip')).statusCode).toBe(400);
    expect((await withToken(token, 'POST', '/projects', { name: 'Two', slug: 'two' })).statusCode).toBe(201);
    expect((await withToken(token, 'POST', '/projects', { name: 'Three', slug: 'three' })).statusCode).toBe(429);
  });

  it('counts a duplicated project against the same cap, and needs content:read on the source', async () => {
    const source = await dev.createProject('Template', 'template', { localHosting: false });
    const noRead = await mint(dev, ['projects:create']);
    const denied = await withToken(noRead.token, 'POST', `/projects/${source}/duplicate`);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: 'this member token lacks the "content:read" capability' });

    const { token } = await mint(dev, ['projects:create', 'content:read']);
    const copy = await withToken(token, 'POST', `/projects/${source}/duplicate`);
    expect(copy.statusCode).toBe(201);
    const copyId = (copy.json() as { project: { id: string; name: string } }).project;
    expect(copyId.name).toBe('Template (copy)');
    expect((await withToken(token, 'GET', `/projects/${copyId.id}/content/page`)).statusCode).toBe(200);

    // A source the member cannot reach is a 404, and takes nothing from the cap…
    expect((await withToken(token, 'POST', '/projects/does-not-exist/duplicate')).statusCode).toBe(404);
    // …so the second real copy still fits, and the third is the one refused.
    expect((await withToken(token, 'POST', `/projects/${source}/duplicate`)).statusCode).toBe(201);
    expect((await withToken(token, 'POST', `/projects/${source}/duplicate`)).statusCode).toBe(429);
  });
});

describe('member tokens — renaming and deleting projects (opt-in)', () => {
  it('renames only with projects:rename', async () => {
    const projectId = await dev.createProject('Before', 'before', { localHosting: false });
    const plain = await mint(dev, CONTENT);
    const denied = await withToken(plain.token, 'PATCH', `/projects/${projectId}`, { name: 'After' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: 'this member token lacks the "projects:rename" capability' });

    const { token } = await mint(dev, ['projects:rename']);
    const ok = await withToken(token, 'PATCH', `/projects/${projectId}`, { name: 'After', slug: 'after' });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { project: { name: string; slug: string } }).project).toMatchObject({ name: 'After', slug: 'after' });
    // Unreachable projects stay invisible.
    const theirs = await otherDev.createProject('Theirs', 'theirs', { localHosting: false });
    expect((await withToken(token, 'PATCH', `/projects/${theirs}`, { name: 'Taken' })).statusCode).toBe(404);
  });

  it('deletes only with projects:delete — and it is the recoverable soft-delete', async () => {
    const projectId = await dev.createProject('Doomed', 'doomed', { localHosting: false });
    const plain = await mint(dev, [...CONTENT, 'content:delete', 'projects:rename']);
    const denied = await withToken(plain.token, 'DELETE', `/projects/${projectId}`);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: 'this member token lacks the "projects:delete" capability' });

    const { token } = await mint(dev, ['projects:delete']);
    expect((await withToken(token, 'DELETE', `/projects/${projectId}`)).statusCode).toBe(204);
    expect((await withToken(token, 'DELETE', `/projects/${projectId}`)).statusCode).toBe(404);
    // Still restorable by an admin: nothing was reaped.
    const deleted = (await admin.get('/admin/deleted-projects')).json() as { projects: Array<{ id: string }> };
    expect(deleted.projects.map((p) => p.id)).toContain(projectId);
  });
});

describe('member tokens — members and invites (opt-in)', () => {
  it('manages a project’s members and invites only with members:manage', async () => {
    const projectId = await dev.createProject('Site', 'site', { localHosting: false });
    await addProjectMember(h.db, client.userId, projectId, 'member');
    const pending = (await dev.post(`/projects/${projectId}/invites`, { email: 'pending@customer.test' })).json() as { invite: { id: string } };
    const plain = await mint(dev, CONTENT);
    for (const res of [
      await withToken(plain.token, 'GET', `/projects/${projectId}/members`),
      await withToken(plain.token, 'GET', `/projects/${projectId}/invites`),
      await withToken(plain.token, 'DELETE', `/projects/${projectId}/members/${client.userId}`),
      await withToken(plain.token, 'DELETE', `/invites/${pending.invite.id}`),
      // …and it learns nothing about an invite id either way.
      await withToken(plain.token, 'DELETE', '/invites/whatever'),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'this member token lacks the "members:manage" capability' });
    }

    const { token } = await mint(dev, ['members:manage']);
    const members = await withToken(token, 'GET', `/projects/${projectId}/members`);
    expect(members.statusCode).toBe(200);
    expect((members.json() as { members: Array<{ userId: string }> }).members.map((m) => m.userId)).toContain(client.userId);

    const listed = (await withToken(token, 'GET', `/projects/${projectId}/invites`)).json() as { invites: Array<{ id: string }> };
    expect(listed.invites.map((i) => i.id)).toEqual([pending.invite.id]);
    expect((await withToken(token, 'DELETE', `/invites/${pending.invite.id}`)).statusCode).toBe(204);
    expect((await withToken(token, 'DELETE', '/invites/nope')).statusCode).toBe(404);

    expect((await withToken(token, 'DELETE', `/projects/${projectId}/members/${client.userId}`)).statusCode).toBe(204);
    expect((await client.get(`/projects/${projectId}`)).statusCode).toBe(403);
  });

  it('★ CREATING an invite is its own capability — managing members does not quietly mint a login', async () => {
    const projectId = await dev.createProject('Site', 'site', { localHosting: false });
    // An invite becomes a person's own login on the project: not narrowed by the token's capabilities,
    // able to open settings no bearer can, and still there after the token is revoked. So "may remove a
    // member" must not imply it.
    const manage = await mint(dev, [...CONTENT, 'members:manage', 'projects:create', 'projects:delete']);
    const denied = await withToken(manage.token, 'POST', `/projects/${projectId}/invites`, { email: 'me@elsewhere.test' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: 'this member token lacks the "members:invite" capability' });
    expect(((await dev.get(`/projects/${projectId}/invites`)).json() as { invites: unknown[] }).invites).toEqual([]);

    const { token } = await mint(dev, ['members:invite']);
    const invited = await withToken(token, 'POST', `/projects/${projectId}/invites`, { email: 'new@customer.test' });
    expect(invited.statusCode).toBe(201);
    const made = invited.json() as { invite: { id: string; role: string }; token: string };
    expect(made.invite.role).toBe('member'); // never more than a member, whatever the token's owner is
    expect(typeof made.token).toBe('string');
    // Inviting alone does not let it look at, or undo, what is there.
    expect((await withToken(token, 'GET', `/projects/${projectId}/invites`)).statusCode).toBe(403);
    expect((await withToken(token, 'DELETE', `/invites/${made.invite.id}`)).statusCode).toBe(403);
  });

  it('gives a token the same "not found" for an invite it cannot reach as for one that does not exist', async () => {
    const theirs = await otherDev.createProject('Theirs', 'theirs', { localHosting: false });
    const hidden = (await otherDev.post(`/projects/${theirs}/invites`, { email: 'x@customer.test' })).json() as { invite: { id: string } };
    const { token } = await mint(dev, ['members:manage']);
    const unreachable = await withToken(token, 'DELETE', `/invites/${hidden.invite.id}`);
    const absent = await withToken(token, 'DELETE', '/invites/no-such-invite');
    expect(unreachable.statusCode).toBe(404);
    expect(unreachable.json()).toEqual(absent.json());
    expect(unreachable.json()).toEqual({ error: 'invite not found' });
    // The invite is untouched.
    expect(((await otherDev.get(`/projects/${theirs}/invites`)).json() as { invites: Array<{ id: string }> }).invites.map((i) => i.id)).toEqual([hidden.invite.id]);
  });

  it('only on projects the member OWNS, and never on one it cannot reach', async () => {
    const theirs = await otherDev.createProject('Theirs', 'theirs', { localHosting: false });
    const { token } = await mint(dev, ['members:manage', 'members:invite']);
    expect((await withToken(token, 'GET', `/projects/${theirs}/members`)).statusCode).toBe(404);
    await addProjectMember(h.db, dev.userId, theirs, 'member');
    const asMember = await withToken(token, 'POST', `/projects/${theirs}/invites`, { email: 'x@customer.test' });
    expect(asMember.statusCode).toBe(403);
    expect(asMember.json()).toEqual({ error: 'insufficient role for this operation' });
  });

  it('★ never issues a password or touches staff invites — those stay interactive', async () => {
    const projectId = await dev.createProject('Site', 'site', { localHosting: false });
    await addProjectMember(h.db, client.userId, projectId, 'member');
    // An ADMIN's token with everything ticked: still no.
    const { token } = await mint(admin, [...CONTENT, 'members:manage', 'members:invite', 'projects:create', 'projects:delete', 'projects:rename']);
    const invite = (await withToken(token, 'POST', `/projects/${projectId}/invites`, { email: 'new@customer.test' })).json() as { invite: { id: string } };
    const staffInvite = (await admin.post('/admin/invites', { email: 'hire@agency.test' })).json() as { invite: { id: string } };

    for (const res of [
      await withToken(token, 'POST', `/projects/${projectId}/members/${client.userId}/password`),
      await withToken(token, 'POST', `/projects/${projectId}/invites/${invite.invite.id}/approve`),
      await withToken(token, 'POST', '/admin/invites', { email: 'mole@agency.test', role: 'admin' }),
      await withToken(token, 'GET', '/admin/invites'),
      await withToken(token, 'GET', '/admin/users'),
      await withToken(token, 'DELETE', `/admin/users/${dev.userId}`),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'this operation requires an interactive session' });
    }
    // A staff invite is simply not there for a token — it cannot revoke one, or learn that it exists.
    expect((await withToken(token, 'DELETE', `/invites/${staffInvite.invite.id}`)).statusCode).toBe(404);
    expect(((await admin.get('/admin/invites')).json() as { invites: Array<{ id: string }> }).invites.map((i) => i.id)).toContain(staffInvite.invite.id);
  });
});

describe('member tokens — visible on the projects they act on', () => {
  /** recordUse is fire-and-forget; give its write a moment to land. */
  async function connections(who: TestClient, projectId: string): Promise<Array<Record<string, unknown>>> {
    // Generous on purpose: this waits on a background write, and a starved CI runner is slow. It
    // returns as soon as the row is there, so the ceiling costs nothing when things are healthy.
    for (let i = 0; i < 500; i += 1) {
      const items = ((await who.get(`/projects/${projectId}/agent-connections`)).json() as { items: Array<Record<string, unknown>> }).items;
      if (items.some((c) => c.kind === 'member')) return items;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('no member-token connection appeared on the project within 5s');
  }

  it('appears in a project’s agent connections once it has acted there — not before, not elsewhere', async () => {
    const used = await otherDev.createProject('Used', 'used', { localHosting: false });
    const untouched = await otherDev.createProject('Untouched', 'untouched', { localHosting: false });
    await addProjectMember(h.db, dev.userId, used, 'member');
    await addProjectMember(h.db, dev.userId, untouched, 'member');
    await addProjectMember(h.db, client.userId, used, 'member');
    const { token, id } = await mint(dev, CONTENT);

    expect(((await otherDev.get(`/projects/${used}/agent-connections`)).json() as { items: unknown[] }).items).toEqual([]);
    expect((await withToken(token, 'GET', `/projects/${used}/content/page`)).statusCode).toBe(200);

    const [row] = await connections(otherDev, used);
    expect(row).toMatchObject({ id: `member:${id}`, kind: 'member', name: 'automation', role: 'member', owner: 'dev@agency.test', capabilities: CONTENT });
    // A client member sees that automation is attached, but not whose staff account it belongs to.
    const [forClient] = await connections(client, used);
    expect(forClient).toMatchObject({ id: `member:${id}`, kind: 'member' });
    expect(forClient).not.toHaveProperty('owner');
    expect(((await otherDev.get(`/projects/${untouched}/agent-connections`)).json() as { items: unknown[] }).items).toEqual([]);
  });

  it('a member that can no longer reach the project is no longer listed as connected to it', async () => {
    const projectId = await otherDev.createProject('Used', 'used', { localHosting: false });
    await addProjectMember(h.db, dev.userId, projectId, 'member');
    const { token } = await mint(dev, CONTENT);
    await withToken(token, 'GET', `/projects/${projectId}/content/page`);
    expect(await connections(otherDev, projectId)).toHaveLength(1);

    await h.db.delete(projectMembers).where(eq(projectMembers.userId, dev.userId));
    expect(((await otherDev.get(`/projects/${projectId}/agent-connections`)).json() as { items: unknown[] }).items).toEqual([]);
  });

  it('★ only its owner or an instance admin can revoke it from there — not the project’s owner', async () => {
    const projectId = await otherDev.createProject('Shared', 'shared', { localHosting: false });
    await addProjectMember(h.db, dev.userId, projectId, 'member');
    const first = await mint(dev, CONTENT);
    const second = await mint(dev, CONTENT);
    for (const t of [first, second]) await withToken(t.token, 'GET', `/projects/${projectId}/content/page`);
    await connections(otherDev, projectId);

    // otherDev owns the project, but the token is a colleague's and reaches other projects too.
    const denied = await otherDev.del(`/projects/${projectId}/agent-connections/member:${first.id}`);
    expect(denied.statusCode).toBe(403);
    expect((await withToken(first.token, 'GET', '/projects')).statusCode).toBe(200);

    // Its owner may (even as a mere member here); so may an admin.
    expect((await dev.del(`/projects/${projectId}/agent-connections/member:${first.id}`)).statusCode).toBe(204);
    expect((await withToken(first.token, 'GET', '/projects')).statusCode).toBe(401);
    expect((await admin.del(`/projects/${projectId}/agent-connections/member:${second.id}`)).statusCode).toBe(204);
    expect((await withToken(second.token, 'GET', '/projects')).statusCode).toBe(401);
    expect((await admin.del(`/projects/${projectId}/agent-connections/member:${second.id}`)).statusCode).toBe(404);
    // A token cannot do any of this itself.
    const third = await mint(dev, CONTENT);
    expect((await withToken(third.token, 'DELETE', `/projects/${projectId}/agent-connections/member:${third.id}`)).statusCode).toBe(403);
    expect((await withToken(third.token, 'GET', `/projects/${projectId}/agent-connections`)).statusCode).toBe(403);
  });
});
