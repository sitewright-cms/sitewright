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
import type { AgentProvider, AgentStreamEvent, AgentTurnRequest } from '../src/ai/agent-provider.js';

// Scripted provider: first turn calls put_page (content:write), then completes.
class ScriptedProvider implements AgentProvider {
  readonly model = 'test-model';
  async *runTurn(req: AgentTurnRequest): AsyncIterable<AgentStreamEvent> {
    const lastIsTool = req.messages.at(-1)?.role === 'tool';
    if (!lastIsTool) {
      yield { type: 'tool_call', id: 't1', name: 'put_page', input: { page: { id: 'home', path: '', title: 'Consented Edit', root: { id: 'r', type: 'Section' } } } };
      yield { type: 'stop', reason: 'tool_use' };
    } else {
      yield { type: 'text_delta', text: 'done' };
      yield { type: 'stop', reason: 'end_turn' };
    }
  }
}

let db: Database;
let app: FastifyInstance;
let publishRoot: string;

function cookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}
async function ownerProject(): Promise<{ c: string; projectId: string }> {
  const email = `owner-${Math.random().toString(36).slice(2)}@e2e.test`;
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const c = cookie(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: c }, payload: { name: 'S', slug: `p-${Date.now()}-${Math.random().toString(36).slice(2)}` } });
  return { c, projectId: (proj.json() as { project: { id: string } }).project.id };
}

beforeEach(async () => {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-consent-'));
  db = await makeTestDb();
  app = await createApp({ db, publishRoot, encryptionKey: randomBytes(32), agentProvider: new ScriptedProvider() });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await rm(publishRoot, { recursive: true, force: true });
});

describe('agent consent grant', () => {
  it('defaults to full autonomy, round-trips a narrowed grant, and reports status', async () => {
    const { c, projectId } = await ownerProject();
    const url = `/projects/${projectId}/agent/grant`;

    // No grant yet → configured:false, full caps pre-checked.
    const initial = await app.inject({ method: 'GET', url, cookies: { sw_session: c } });
    expect(initial.json()).toMatchObject({ configured: false, autonomy: 'full' });
    expect((initial.json() as { capabilities: string[] }).capabilities).toContain('content:write');

    // Narrow it to read-only.
    const put = await app.inject({ method: 'PUT', url, cookies: { sw_session: c }, payload: { capabilities: ['content:read'], autonomy: 'ask' } });
    expect(put.statusCode).toBe(200);
    const saved = await app.inject({ method: 'GET', url, cookies: { sw_session: c } });
    expect(saved.json()).toMatchObject({ configured: true, capabilities: ['content:read'], autonomy: 'ask' });

    // Status reflects the configured (env) provider.
    const status = await app.inject({ method: 'GET', url: `/projects/${projectId}/agent/status`, cookies: { sw_session: c } });
    expect((status.json() as { enabled: boolean }).enabled).toBe(true);
  });

  it('a read-only grant actually blocks a write tool (put_page does not land)', async () => {
    const { c, projectId } = await ownerProject();
    await app.inject({ method: 'PUT', url: `/projects/${projectId}/agent/grant`, cookies: { sw_session: c }, payload: { capabilities: ['content:read'] } });

    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/agent/messages`, cookies: { sw_session: c }, payload: { message: 'change the headline' } });
    expect(res.statusCode).toBe(200);
    // The tool call was made but the gate rejected it (no content:write in the grant).
    expect(res.payload).toContain('event: tool_result');
    // The write did NOT land — the grant clamped the minted token (the home page keeps its seed content).
    const got = await app.inject({ method: 'GET', url: `/projects/${projectId}/content/page/home`, cookies: { sw_session: c } });
    expect(JSON.stringify(got.json())).not.toContain('Consented Edit');
  });

  it('a full grant lets the same write land', async () => {
    const { c, projectId } = await ownerProject();
    await app.inject({ method: 'PUT', url: `/projects/${projectId}/agent/grant`, cookies: { sw_session: c }, payload: { capabilities: ['content:read', 'content:write'] } });
    await app.inject({ method: 'POST', url: `/projects/${projectId}/agent/messages`, cookies: { sw_session: c }, payload: { message: 'change the headline' } });
    const got = await app.inject({ method: 'GET', url: `/projects/${projectId}/content/page/home`, cookies: { sw_session: c } });
    expect(got.statusCode).toBe(200);
    expect(JSON.stringify(got.json())).toContain('Consented Edit');
  });
});
