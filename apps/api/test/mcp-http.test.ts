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
});
