import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSitewrightMcpServer } from '../src/server.js';
import { SitewrightClient, type FetchLike, type Scope } from '../src/client.js';
import { staticAuth } from '../src/auth.js';

// The booking tools — the Bookings tab's list and answers, and an offering's free times — driven through a REAL
// client over a recording fetch, so the assertions are on the requests that actually leave the bridge.

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

let answerStatus = 200;

function respond(call: Call): { status?: number; body?: unknown } {
  if (/\/bookings\?view=/.test(call.url)) return { body: { bookings: [{ id: 'b1', state: 'pending' }], total: 1, requests: 1 } };
  if (/\/bookings\/[^/]+\/(accept|decline|cancel)$/.test(call.url)) {
    return answerStatus === 403
      ? { status: 403, body: { error: 'a paid booking is cancelled by a person in the Bookings tab: cancelling it refunds the customer, and no token moves money', reason: 'paid' } }
      : { body: { ok: true, booking: null } };
  }
  if (call.url.includes('/availability?')) return { body: { offering: { id: 'consult' }, kind: 'times', times: [], truncated: false } };
  return { body: { ok: true } };
}

async function connect(scope: Scope) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: input.replace('https://cms.test', ''),
      ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) as unknown } : {}),
    };
    calls.push(call);
    const { status = 200, body } = respond(call);
    return { ok: status >= 200 && status < 300, status, statusText: '', text: async () => JSON.stringify(body) };
  };
  const client = new SitewrightClient('https://cms.test', async () => 'tok', fetch);
  client.primeScope(scope);
  const server = createSitewrightMcpServer(client, { scope }, staticAuth('tok'));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const mcp = new Client({ name: 'test', version: '0' });
  await mcp.connect(clientSide);
  return { mcp, calls };
}

const text = (res: Awaited<ReturnType<Client['callTool']>>): string => (res.content as Array<{ text: string }>)[0]!.text;
const project = (capabilities: Array<'content:read' | 'content:write'>): Scope => ({ kind: 'project', projectId: 'studio', role: 'owner', capabilities });

describe('booking tools', () => {
  it('list_bookings reads the Bookings tab, upcoming unless asked otherwise', async () => {
    const { mcp, calls } = await connect(project(['content:read']));
    expect((await mcp.callTool({ name: 'list_bookings', arguments: {} })).isError).toBeFalsy();
    await mcp.callTool({ name: 'list_bookings', arguments: { view: 'requests' } });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /projects/studio/bookings?view=upcoming', 'GET /projects/studio/bookings?view=requests']);
    expect((await mcp.callTool({ name: 'list_bookings', arguments: { view: 'everything' } })).isError).toBe(true);
  });

  it('answer_booking is a write, and sends exactly the answer it was given', async () => {
    const reader = await connect(project(['content:read']));
    const denied = await reader.mcp.callTool({ name: 'answer_booking', arguments: { id: 'b1', answer: 'accept' } });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toMatch(/content:write/);
    expect(reader.calls).toEqual([]);
    const { mcp, calls } = await connect(project(['content:read', 'content:write']));
    for (const answer of ['accept', 'decline', 'cancel'] as const) await mcp.callTool({ name: 'answer_booking', arguments: { id: 'b1', answer } });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /projects/studio/bookings/b1/accept',
      'POST /projects/studio/bookings/b1/decline',
      'POST /projects/studio/bookings/b1/cancel',
    ]);
  });

  it('★ passes on the refusal to cancel a paid booking, which names the person who can', async () => {
    answerStatus = 403;
    try {
      const { mcp } = await connect(project(['content:read', 'content:write']));
      const res = await mcp.callTool({ name: 'answer_booking', arguments: { id: 'b1', answer: 'cancel' } });
      expect(res.isError).toBe(true);
      expect(text(res)).toContain('cancelled by a person in the Bookings tab');
    } finally {
      answerStatus = 200;
    }
  });

  it('★ a booking id cannot climb out of /bookings/<id>; an offering id is a set-up id', async () => {
    const { mcp, calls } = await connect(project(['content:read', 'content:write']));
    for (const id of ['..', '../x', 'b1/../y', 'a.b']) {
      expect((await mcp.callTool({ name: 'answer_booking', arguments: { id, answer: 'cancel' } })).isError, id).toBe(true);
    }
    for (const offering of ['..', 'Consult', 'a/b']) {
      expect((await mcp.callTool({ name: 'booking_availability', arguments: { offering } })).isError, offering).toBe(true);
    }
    expect(calls).toEqual([]);
  });

  it('booking_availability asks the public listing for the window, from a date, for so many days', async () => {
    const { mcp, calls } = await connect(project(['content:read']));
    await mcp.callTool({ name: 'booking_availability', arguments: { offering: 'consult', from: '2026-11-02T00:00:00Z', days: 3 } });
    const from = Date.UTC(2026, 10, 2);
    expect(calls).toEqual([{ method: 'GET', url: `/b/studio/consult/availability?from=${from}&to=${from + 3 * 86_400_000}` }]);
    const bad = await mcp.callTool({ name: 'booking_availability', arguments: { offering: 'consult', from: 'next tuesday' } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain('not a date');
    expect((await mcp.callTool({ name: 'booking_availability', arguments: { offering: 'consult', days: 40 } })).isError).toBe(true);
  });
});
