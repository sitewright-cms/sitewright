import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { MCP_RL_MAX } from '../src/http/mcp-routes.js';

let app: FastifyInstance;
let db: Database;
let publishRoot: string;
const encryptionKey = randomBytes(32);

beforeEach(async () => {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-mcphttp-'));
  db = await makeTestDb();
  app = await createApp({ db, publishRoot, encryptionKey });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await rm(publishRoot, { recursive: true, force: true });
});

function sessionCookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

/** Register a user, create a project, and mint an owner bearer token for it. */
async function setup(): Promise<{ projectId: string; token: string }> {
  // Project creation is agency-staff-only now; seed the creator as `developer` (agency staff). The
  // register route is invite-only, so seed via the repo, then log in for a session cookie.
  const email = `mcp-${Date.now()}@e2e.test`;
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const cookie = sessionCookie(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: cookie }, payload: { name: 'Site', slug: `mcp-${Date.now()}` } });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  const key = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/api-keys`,
    cookies: { sw_session: cookie },
    payload: { name: 'agent', role: 'owner', capabilities: ['content:read', 'content:write', 'publish'], expiresInDays: 30 },
  });
  const token = (key.json() as { token: string }).token;
  return { projectId, token };
}

const MCP_HEADERS = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' };

type InjectRes = { statusCode: number; headers: Record<string, string | string[] | undefined>; json: () => unknown };

/** POST one JSON-RPC message to /mcp; returns the parsed JSON-RPC response (enableJsonResponse). */
async function mcp(token: string | null, body: Record<string, unknown>): Promise<InjectRes> {
  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { ...MCP_HEADERS, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    payload: body,
  });
  return res as unknown as InjectRes;
}

const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } };

describe('remote MCP transport (/mcp)', () => {
  it('challenges an unauthenticated request with 401 + WWW-Authenticate → protected-resource metadata', async () => {
    const res = await mcp(null, init);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('/.well-known/oauth-protected-resource');
    expect(res.headers['www-authenticate']).toContain('Bearer');
  });

  it('challenges an INVALID bearer token the same way (so the host re-runs OAuth)', async () => {
    const res = await mcp('swk_0000000000000000000000000000000000000000000000000000000000000000', init);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('Bearer');
  });

  it('completes the initialize handshake for a valid bearer token', async () => {
    const { token } = await setup();
    const res = await mcp(token, init);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { result?: { serverInfo?: { name: string } } };
    expect(body.result?.serverInfo?.name).toBe('sitewright');
  });

  it('rejects GET /mcp with 405 (stateless JSON mode offers no SSE stream)', async () => {
    const res = await app.inject({ method: 'GET', url: '/mcp', headers: MCP_HEADERS });
    expect(res.statusCode).toBe(405);
    expect(res.headers['allow']).toContain('POST');
  });

  it("runs get_scope, reporting the token's authenticated project + capabilities", async () => {
    const { token, projectId } = await setup();
    await mcp(token, init);
    const res = await mcp(token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_scope', arguments: {} } });
    expect(res.statusCode).toBe(200);
    const text = (res.json() as { result: { content: Array<{ text: string }> } }).result.content[0]!.text;
    expect(text).toContain('"authenticated": true');
    expect(text).toContain(projectId);
    expect(text).toContain('content:write');
    // The origin this instance is reached at — the base of every address it hands out (the same
    // `publicOrigin` the result rewrite uses; that rewrite is unit-tested in packages/mcp).
    expect(text).toMatch(/"origin": "https?:\/\/[^"]+"/);
  });

  // ---- MEMBER tokens: one connection, several projects ----
  // The whole point of a member token over MCP: an agent connects once, then creates a project and
  // works in it — and in others — by naming the project on each call.
  describe('with a member token', () => {
    async function memberSetup(capabilities: string[]) {
      const email = `mcp-member-${Date.now()}-${Math.random().toString(36).slice(2)}@e2e.test`;
      await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
      const cookie = sessionCookie(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
      const minted = await app.inject({
        method: 'POST',
        url: '/account/member-tokens',
        cookies: { sw_session: cookie },
        payload: { name: 'fleet', expiresInDays: 1, currentPassword: 'Pw-secret-1', capabilities },
      });
      expect(minted.statusCode).toBe(201);
      return { cookie, token: (minted.json() as { token: string }).token };
    }
    let rpcId = 100;
    const call = async (token: string, name: string, args: Record<string, unknown> = {}) => {
      const res = await mcp(token, { jsonrpc: '2.0', id: (rpcId += 1), method: 'tools/call', params: { name, arguments: args } });
      const result = (res.json() as { result?: { content: Array<{ text: string }>; isError?: boolean } }).result;
      return { status: res.statusCode, isError: result?.isError === true, text: result?.content[0]?.text ?? '' };
    };

    it('★ creates a project, writes to it, and to a second one — each call naming its project', async () => {
      const { token, cookie } = await memberSetup(['content:read', 'content:write', 'projects:create']);
      const listed = await mcp(token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
      expect(listed.statusCode).toBe(200);
      const names = (listed.json() as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(['list_projects', 'create_project', 'duplicate_project', 'put_page']));

      const scope = await call(token, 'get_scope');
      expect(scope.text).toContain('"kind": "member"');
      expect(scope.text).not.toContain('projectId');

      const stamp = Date.now();
      const first = JSON.parse((await call(token, 'create_project', { name: 'First', slug: `mcp-first-${stamp}` })).text) as { id: string };
      const second = JSON.parse((await call(token, 'create_project', { name: 'Second', slug: `mcp-second-${stamp}` })).text) as { id: string };
      expect(first.id).not.toBe(second.id);

      const page = (title: string) => ({ id: 'about', path: 'about', title, source: `<section><h1>${title}</h1></section>\n` });
      expect((await call(token, 'put_page', { project: first.id, page: page('About First') })).isError).toBe(false);
      expect((await call(token, 'put_page', { project: second.id, page: page('About Second') })).isError).toBe(false);

      // Each landed where it was sent — read back through the member's own session, not the token.
      const titleOf = async (projectId: string): Promise<string> =>
        ((await app.inject({ method: 'GET', url: `/projects/${projectId}/content/page/about`, cookies: { sw_session: cookie } })).json() as { item: { title: string } }).item.title;
      expect(await titleOf(first.id)).toBe('About First');
      expect(await titleOf(second.id)).toBe('About Second');

      const projects = JSON.parse((await call(token, 'list_projects')).text) as Array<{ id: string }>;
      expect(projects.map((p) => p.id).sort()).toEqual([first.id, second.id].sort());

      const copy = JSON.parse((await call(token, 'duplicate_project', { project: first.id })).text) as { id: string; name: string };
      expect(copy.name).toBe('First (copy)');
      expect(await titleOf(copy.id)).toBe('About First');
    });

    it('★ invites a person and approves the invite without its link — the new account can sign in', async () => {
      const { token } = await memberSetup(['content:read', 'projects:create', 'members:manage', 'members:invite']);
      const stamp = Date.now();
      const project = JSON.parse((await call(token, 'create_project', { name: 'People', slug: `mcp-people-${stamp}` })).text) as { id: string };
      const email = `mcp-invitee-${stamp}@e2e.test`;

      const invited = JSON.parse((await call(token, 'invite_member', { project: project.id, email })).text) as { invite: { id: string }; token: string };
      expect(typeof invited.token).toBe('string');
      const pending = JSON.parse((await call(token, 'list_members', { project: project.id })).text) as { invites: Array<{ id: string; email: string }> };
      expect(pending.invites.map((i) => i.id)).toEqual([invited.invite.id]);

      const approved = JSON.parse((await call(token, 'approve_invite', { project: project.id, inviteId: invited.invite.id })).text) as {
        created: boolean;
        password?: string;
        userId: string;
      };
      expect(approved.created).toBe(true);
      const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: approved.password } });
      expect(login.statusCode).toBe(200);

      const after = JSON.parse((await call(token, 'list_members', { project: project.id })).text) as {
        members: Array<{ userId: string; role: string }>;
        invites: unknown[];
      };
      expect(after.invites).toEqual([]);
      expect(after.members.find((m) => m.userId === approved.userId)?.role).toBe('member');
      // A second approval is a tool error, not a second account.
      const again = await call(token, 'approve_invite', { project: project.id, inviteId: invited.invite.id });
      expect(again.isError).toBe(true);
      expect(again.text).toMatch(/409/);
    });

    it('cannot reach a project its owner cannot, and is told so as a tool error — not a broken connection', async () => {
      const other = await setup(); // someone else's project
      const { token } = await memberSetup(['content:read', 'content:write']);
      const res = await call(token, 'list_pages', { project: other.projectId });
      expect(res.status).toBe(200);
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/404.*project not found/);
      // …and the account tools obey the token's capabilities.
      const denied = await call(token, 'create_project', { name: 'No', slug: `mcp-no-${Date.now()}` });
      expect(denied.isError).toBe(true);
      expect(denied.text).toMatch(/lacks the “projects:create” capability/);
    });

    it('a project tool called without `project` is refused by the schema, before any request is made', async () => {
      const { token } = await memberSetup(['content:read']);
      const res = await mcp(token, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'list_pages', arguments: {} } });
      const body = res.json() as { result?: { isError?: boolean; content: Array<{ text: string }> }; error?: { message: string } };
      const message = body.error?.message ?? body.result?.content[0]?.text ?? '';
      expect(body.error !== undefined || body.result?.isError === true).toBe(true);
      // It is the ARGUMENT that was refused — not some other failure that happens to mention projects.
      expect(message).toMatch(/Invalid arguments for tool list_pages.* at project$/);

      // An id that is not an id never becomes a request either: `..` would otherwise resolve OUT of
      // /projects/<id>/ once the URL is parsed.
      const climbing = await mcp(token, { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'list_pages', arguments: { project: '..' } } });
      const climbed = climbing.json() as { result?: { isError?: boolean; content: Array<{ text: string }> }; error?: { message: string } };
      expect(climbed.error !== undefined || climbed.result?.isError === true).toBe(true);
      expect(climbed.error?.message ?? climbed.result?.content[0]?.text ?? '').toMatch(/Invalid arguments for tool list_pages/);
    });
  });

  it('writes a page through put_page (capability-enforced via the in-process REST path)', async () => {
    const { token, projectId } = await setup();
    await mcp(token, init);
    const page = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' } };
    const res = await mcp(token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'put_page', arguments: { page } } });
    expect(res.statusCode).toBe(200);
    const result = res.json() as { result: { isError?: boolean; content: Array<{ text: string }> } };
    expect(result.result.isError).toBeFalsy();
    // It really landed: the REST API serves it back.
    const got = await app.inject({ method: 'GET', url: `/projects/${projectId}/content/page/home`, headers: { authorization: `Bearer ${token}` } });
    expect(got.statusCode).toBe(200);
  });

  it('sustains a fleet-sized burst (introspect is cached, not re-billed per call)', async () => {
    const { token } = await setup();
    // Two ceilings have bitten here. (1) Before the scope cache, EVERY /mcp POST spent one
    // GET /api-key/self from the same per-token bucket (30/min) — call #31 died as `mcp_unavailable`.
    // (2) The /mcp cap itself was 120/min, and because the bucket is keyed by the BEARER TOKEN it is
    // shared by every agent using that key — roughly two concurrent workers before the rest 429'd mid-run.
    // (3) Raising /mcp alone did NOT fix (2): every tool call re-enters the app in-process on the same
    // bearer, so the CONTENT route's own bucket became the wall instead — MEASURED, list_pages started
    // failing at call ~121 with the 429 surfaced as a TOOL error, the worst shape (an opaque failure the
    // model must interpret, which also counts toward the loop's flail ceiling). `rlAgent` lifts the
    // hot-loop authoring routes for API-key traffic so `/mcp` is the binding limit again.
    // Hence a REST-BACKED tool here, not the cached-introspect get_scope: only list_pages exercises the
    // inner route that actually broke.
    let ok = 0;
    for (let i = 0; i < 150; i++) {
      const res = await mcp(token, { jsonrpc: '2.0', id: i + 10, method: 'tools/call', params: { name: 'list_pages', arguments: {} } });
      if (res.statusCode !== 200) expect.fail(`unexpected status ${res.statusCode} on call ${i + 1}`);
      const body = res.json() as { result?: { isError?: boolean; content?: Array<{ text: string }> } };
      if (body.result?.isError) expect.fail(`tool error on call ${i + 1}: ${body.result.content?.[0]?.text ?? ''}`);
      ok++;
    }
    expect(ok).toBe(150);
    expect(MCP_RL_MAX).toBeGreaterThanOrEqual(600); // the ceiling a parallel-agent fleet needs
  }, 60_000);

  // The positive half of the agent-lane gate (rate-limit.test.ts pins the negative half: a forged bearer
  // never lifts anything). A key earns the lane by AUTHENTICATING, so the very first call is measured at
  // the ordinary cap and every one after it at the raised one.
  it('opens the agent lane only AFTER the key has authenticated', async () => {
    const { token, projectId } = await setup();
    const url = `/projects/${projectId}/content/page`;
    const auth = { authorization: `Bearer ${token}` };

    // A FRESH app has never seen this token: first request → the ordinary route cap.
    const cold = await app.inject({ method: 'GET', url, headers: auth });
    expect(cold.statusCode).toBe(200); // it authenticates HERE, which is what marks it verified
    expect(cold.headers['x-ratelimit-limit']).toBe('120');

    // …and from the next request on, the raised ceiling.
    const warm = await app.inject({ method: 'GET', url, headers: auth });
    expect(warm.headers['x-ratelimit-limit']).toBe('600');

    // A DIFFERENT, unissued token gets nothing, even against the same route.
    const forged = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${'swk_' + '1'.repeat(64)}` } });
    expect(forged.headers['x-ratelimit-limit']).toBe('120');
  });

  it('429s as a JSON-RPC envelope once the cap IS reached', async () => {
    const { token } = await setup();
    // The cap must still exist and, when hit, come back as a JSON-RPC error envelope with retry-after —
    // a bare HTTP body surfaces in a stateless MCP host as an undefined RPC error. Exhausting the real
    // bucket means MCP_RL_MAX+1 calls, so this one is deliberately slow; it is derived from the constant
    // rather than a literal so raising the cap can never silently stop testing the envelope.
    let firstLimited: InjectRes | undefined;
    for (let i = 0; i <= MCP_RL_MAX + 1; i++) {
      const res = await mcp(token, { jsonrpc: '2.0', id: i + 10, method: 'tools/call', params: { name: 'get_scope', arguments: {} } });
      if (res.statusCode === 429) { firstLimited = res; break; }
      if (res.statusCode !== 200) expect.fail(`unexpected status ${res.statusCode} on call ${i + 1}`);
    }
    expect(firstLimited, 'expected to reach the /mcp route cap').toBeDefined();
    const body = firstLimited!.json() as {
      jsonrpc: string;
      id: unknown;
      error?: { code: number; message: string; data?: { retryAfterSeconds?: number } };
    };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.error?.code).toBe(-32000);

    // ★ The envelope must state HOW LONG, not point at a header. A model driving these tools sees this
    // body and nothing else; "honor the retry-after header" is unactionable to it, so it retries at once
    // and spends its failure budget re-tripping the same limit.
    const header = Number(firstLimited!.headers['retry-after']);
    expect(header, 'the plugin still sets retry-after').toBeGreaterThan(0);
    const seconds = body.error?.data?.retryAfterSeconds;
    expect(seconds, 'the wait is machine-readable for the host').toBe(header);
    expect(body.error?.message, 'the wait is stated for the model').toContain(`${seconds}s`);
    // And it must read as temporary — a throttle the same call survives, not a rejected request.
    expect(body.error?.message).toMatch(/temporary|will succeed|retry/i);
  }, 120_000);
});

// ---- The GLOBAL snippet/template library, read over MCP ----
// Every guide tells an agent to read a recipe with get_content("snippet","nav-header"). Those recipes
// live in the instance-wide global library (the reserved `__global__` scope), and the only route that
// served it — GET /global/:kind — takes a browser SESSION only. So the documented call 404'd for every
// agent, whichever credential it held. These pin the fallback for BOTH MCP credential kinds.
describe('the global library over MCP', () => {
  let rpcId = 500;
  const call = async (token: string, name: string, args: Record<string, unknown> = {}) => {
    const res = await mcp(token, { jsonrpc: '2.0', id: (rpcId += 1), method: 'tools/call', params: { name, arguments: args } });
    const result = (res.json() as { result?: { content: Array<{ text: string }>; isError?: boolean } }).result;
    return { isError: result?.isError === true, text: result?.content[0]?.text ?? '' };
  };
  async function memberToken(): Promise<{ token: string; projectId: string }> {
    const email = `mcp-glob-${Date.now()}-${Math.random().toString(36).slice(2)}@e2e.test`;
    await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
    const cookie = sessionCookie(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
    const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: cookie }, payload: { name: 'Glob', slug: `mcp-glob-${Date.now()}` } });
    const minted = await app.inject({
      method: 'POST',
      url: '/account/member-tokens',
      cookies: { sw_session: cookie },
      payload: { name: 'agent', expiresInDays: 1, currentPassword: 'Pw-secret-1', capabilities: ['content:read', 'content:write'] },
    });
    expect(minted.statusCode).toBe(201);
    return { token: (minted.json() as { token: string }).token, projectId: (proj.json() as { project: { id: string } }).project.id };
  }

  type GlobalRead = { id: string; name: string; source: string; _global?: { readOnly: boolean; note: string } };

  it('★ get_content("snippet","nav-header") resolves from the global library with a PROJECT KEY', async () => {
    const { token } = await setup();
    expect(token.startsWith('swk_')).toBe(true);
    for (const id of ['nav-header', 'form-custom']) {
      const res = await call(token, 'get_content', { kind: 'snippet', id });
      expect(res.isError, res.text).toBe(false);
      const item = JSON.parse(res.text) as GlobalRead;
      expect(item.name).toBe(id);
      expect(item.source.length).toBeGreaterThan(100);
      // Labelled for what it is, with the way to change it.
      expect(item._global?.readOnly).toBe(true);
      expect(item._global?.note).toContain(`put_content("snippet","${id}"`);
    }
  });

  it('★ …and with a MEMBER TOKEN, naming the project', async () => {
    const { token, projectId } = await memberToken();
    expect(token.startsWith('swm_')).toBe(true);
    const res = await call(token, 'get_content', { project: projectId, kind: 'snippet', id: 'nav-header' });
    expect(res.isError, res.text).toBe(false);
    expect((JSON.parse(res.text) as GlobalRead)._global?.readOnly).toBe(true);
    // A global TEMPLATE too, by its bare id or by the `global:` reference a page uses.
    for (const id of ['landing', 'global:landing']) {
      const tpl = await call(token, 'get_content', { project: projectId, kind: 'template', id });
      expect(tpl.isError, tpl.text).toBe(false);
      const item = JSON.parse(tpl.text) as GlobalRead;
      expect(item.id).toBe('landing');
      expect(item._global?.note).toContain('template:"global:landing"');
    }
  });

  it('a PROJECT snippet of the same name wins — read back unlabelled, exactly as render resolves it', async () => {
    const { token } = await setup();
    // The override an agent naturally writes: the global read, edited and written back WHOLE. The
    // `_global` label must not be stored with it.
    const global = JSON.parse((await call(token, 'get_content', { kind: 'snippet', id: 'nav-header' })).text) as GlobalRead;
    const put = await call(token, 'put_content', { kind: 'snippet', id: 'nav-header', data: { ...global, source: '<div>mine</div>' } });
    expect(put.isError, put.text).toBe(false);
    const item = JSON.parse((await call(token, 'get_content', { kind: 'snippet', id: 'nav-header' })).text) as GlobalRead;
    expect(item.source).toBe('<div>mine</div>');
    expect(item._global).toBeUndefined();
  });

  it('an id in NEITHER scope is still a plain 404, and other kinds never fall back', async () => {
    const { token } = await setup();
    const missing = await call(token, 'get_content', { kind: 'snippet', id: 'no-such-recipe' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/^Error 404/);
    const page = await call(token, 'get_content', { kind: 'page', id: 'nav-header' });
    expect(page.isError).toBe(true);
    expect(page.text).toMatch(/^Error 404/);
  });

  it('list_content stays the project\'s own plain array; its description says where the recipes are', async () => {
    const { token } = await setup();
    expect(JSON.parse((await call(token, 'list_content', { kind: 'snippet' })).text)).toEqual([]); // a new project has none of its own
    const listed = await mcp(token, { jsonrpc: '2.0', id: (rpcId += 1), method: 'tools/list', params: {} });
    const tools = (listed.json() as { result: { tools: Array<{ name: string; description?: string }> } }).result.tools;
    const desc = tools.find((t) => t.name === 'list_content')?.description ?? '';
    expect(desc).toContain('nav-header');
    expect(desc).toContain('get_content(kind, id)');
  });

  it('a GLOBAL TEMPLATE written back whole as a project template does not keep the `_global` label', async () => {
    const { token, projectId } = await setup();
    const global = JSON.parse((await call(token, 'get_content', { kind: 'template', id: 'landing' })).text) as GlobalRead;
    expect(global._global?.readOnly).toBe(true);
    const put = await call(token, 'put_content', { kind: 'template', id: 'landing', data: { ...global, source: '<section>mine</section>' } });
    expect(put.isError, put.text).toBe(false);
    // Stored without the label (read straight from the REST API, not through the labelling tool)…
    const stored = await app.inject({ method: 'GET', url: `/projects/${projectId}/content/template/landing`, headers: { authorization: `Bearer ${token}` } });
    expect(stored.statusCode).toBe(200);
    const item = (stored.json() as { item: Record<string, unknown> }).item;
    expect(item.source).toBe('<section>mine</section>');
    expect(item).not.toHaveProperty('_global');
    // …and the project copy is what get_content now returns, unlabelled.
    expect((JSON.parse((await call(token, 'get_content', { kind: 'template', id: 'landing' })).text) as GlobalRead)._global).toBeUndefined();
  });

  it('the project-scoped REST reads take every credential kind; the session-only /global route is unchanged', async () => {
    const { token, projectId } = await setup();
    const bearer = { authorization: `Bearer ${token}` };
    const one = await app.inject({ method: 'GET', url: `/projects/${projectId}/global/snippet/nav-header`, headers: bearer });
    expect(one.statusCode).toBe(200);
    expect((one.json() as { item: { name: string }; scope: string })).toMatchObject({ item: { name: 'nav-header' }, scope: 'global' });
    const list = await app.inject({ method: 'GET', url: `/projects/${projectId}/global/snippet?summary=1`, headers: bearer });
    expect(list.statusCode).toBe(200);
    const items = (list.json() as { items: Array<{ id: string; source?: string }> }).items;
    expect(items.some((i) => i.id === 'nav-header')).toBe(true);
    expect(items.every((i) => i.source === undefined)).toBe(true); // summary: bodies omitted
    // Read-only, and only the two library kinds.
    expect((await app.inject({ method: 'GET', url: `/projects/${projectId}/global/page/home`, headers: bearer })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: `/projects/${projectId}/global/snippet/nav-header`, headers: bearer, payload: { name: 'x', source: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/projects/${projectId}/global/snippet/nav-header` })).statusCode).toBe(401);
    // The reserved scope is still not a project anyone can address, and a key reaches only its own project.
    expect((await app.inject({ method: 'GET', url: '/projects/__global__/global/snippet/nav-header', headers: bearer })).statusCode).toBe(404);
    const other = await setup();
    expect((await app.inject({ method: 'GET', url: `/projects/${other.projectId}/global/snippet/nav-header`, headers: bearer })).statusCode).toBe(404);
    // The instance-wide route keeps taking a browser session only.
    expect((await app.inject({ method: 'GET', url: '/global/snippet', headers: bearer })).statusCode).toBe(401);
  });
});
