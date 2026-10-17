import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSitewrightMcpServer, orderForAgent } from '../src/server.js';
import { SitewrightClient, type FetchLike, type Scope } from '../src/client.js';
import { staticAuth } from '../src/auth.js';

// The shop tools — orders, payment providers, gateway definitions — driven through a REAL client over a
// recording fetch, so the assertions are on the requests that actually leave the bridge.

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

const ORDER = {
  id: 'txn_1',
  projectId: 'shop',
  publicToken: 'tok_BUYER_BEARER',
  catalogDigest: 'digest',
  status: 'paid',
  fulfilment: 'new',
  market: 'ch',
  shipCountry: 'CH',
  buyer: { name: 'Ada' },
  customerEmail: 'ada@example.test',
};

/** Set to make the mail-count route fail, as a flaky dependency would. */
let undeliveredFails = false;

function respond(call: Call): { status?: number; body?: unknown } {
  if (call.url.endsWith('/transactions-undelivered')) {
    return undeliveredFails ? { status: 500, body: { error: 'boom' } } : { body: { notify: 0, receipt: 1, lastError: 'smtp refused' } };
  }
  if (/\/transactions\?|\/transactions$/.test(call.url)) return { body: { items: [ORDER], total: 1 } };
  if (/\/transactions\/[^/]+$/.test(call.url)) return { body: { transaction: ORDER } };
  if (call.url.endsWith('/fulfilment')) return { body: { transaction: { ...ORDER, fulfilment: 'shipped' } } };
  if (call.url.endsWith('/resend')) return { body: { queued: true, kind: 'receipt' } };
  if (call.method === 'DELETE') return { status: 204 };
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
    return { ok: status >= 200 && status < 300, status, statusText: '', text: async () => (status === 204 ? '' : JSON.stringify(body)) };
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
const project = (capabilities: Array<'content:read' | 'content:write' | 'payments:provider:write'>): Scope => ({ kind: 'project', projectId: 'shop', role: 'owner', capabilities });

describe('orders', () => {
  it('list_orders reads the inbox AND the undelivered-mail count, with the buyer\'s order-page token withheld', async () => {
    const { mcp, calls } = await connect(project(['content:read']));
    const res = await mcp.callTool({ name: 'list_orders', arguments: { status: 'paid', limit: 20 } });
    expect(res.isError).toBeFalsy();
    expect(calls.map((c) => `${c.method} ${c.url}`).sort()).toEqual([
      'GET /projects/shop/transactions-undelivered',
      'GET /projects/shop/transactions?status=paid&limit=20',
    ]);
    const body = JSON.parse(text(res)) as { items: Array<Record<string, unknown>>; total: number; undeliveredMail: unknown };
    expect(body.total).toBe(1);
    expect(body.undeliveredMail).toEqual({ notify: 0, receipt: 1, lastError: 'smtp refused' });
    expect(body.items[0]).toMatchObject({ id: 'txn_1', shipCountry: 'CH', market: 'ch', customerEmail: 'ada@example.test' });
    expect(text(res)).not.toContain('tok_BUYER_BEARER');
    expect(body.items[0]).not.toHaveProperty('projectId');
  });

  it('a failed mail count does not cost the agent the orders', async () => {
    undeliveredFails = true;
    try {
      const { mcp } = await connect(project(['content:read']));
      const res = await mcp.callTool({ name: 'list_orders', arguments: {} });
      expect(res.isError).toBeFalsy();
      expect(JSON.parse(text(res))).toMatchObject({ total: 1, undeliveredMail: null });
    } finally {
      undeliveredFails = false;
    }
  });

  it('★ an order id cannot climb out of /transactions/<id>', async () => {
    const { mcp, calls } = await connect(project(['content:read', 'content:write']));
    for (const orderId of ['..', '../resend', 'txn_1/../x', 'a.b']) {
      expect((await mcp.callTool({ name: 'get_order', arguments: { orderId } })).isError, orderId).toBe(true);
      expect((await mcp.callTool({ name: 'resend_order_mail', arguments: { orderId, kind: 'receipt' } })).isError, orderId).toBe(true);
    }
    expect(calls).toEqual([]);
  });

  it('refuses a status the API does not know before any request is made', async () => {
    const { mcp, calls } = await connect(project(['content:read']));
    expect((await mcp.callTool({ name: 'list_orders', arguments: { status: 'shipped' } })).isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it('get_order withholds the token too', async () => {
    const { mcp, calls } = await connect(project(['content:read']));
    const res = await mcp.callTool({ name: 'get_order', arguments: { orderId: 'txn_1' } });
    expect(calls.at(-1)).toMatchObject({ method: 'GET', url: '/projects/shop/transactions/txn_1' });
    expect(text(res)).toContain('"shipCountry": "CH"');
    expect(text(res)).not.toContain('tok_BUYER_BEARER');
  });

  it('set_order_fulfilment and resend_order_mail are writes, and send exactly what they were given', async () => {
    const reader = await connect(project(['content:read']));
    const denied = await reader.mcp.callTool({ name: 'set_order_fulfilment', arguments: { orderId: 'txn_1', to: 'shipped' } });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toMatch(/content:write/);
    expect(reader.calls).toEqual([]);

    const { mcp, calls } = await connect(project(['content:read', 'content:write']));
    const moved = await mcp.callTool({ name: 'set_order_fulfilment', arguments: { orderId: 'txn_1', to: 'shipped', note: 'DHL 123' } });
    expect(calls.at(-1)).toEqual({ method: 'PATCH', url: '/projects/shop/transactions/txn_1/fulfilment', body: { to: 'shipped', note: 'DHL 123' } });
    expect(text(moved)).not.toContain('tok_BUYER_BEARER');
    await mcp.callTool({ name: 'resend_order_mail', arguments: { orderId: 'txn_1', kind: 'receipt' } });
    expect(calls.at(-1)).toEqual({ method: 'POST', url: '/projects/shop/transactions/txn_1/resend', body: { kind: 'receipt' } });
  });

  it('there is no refund tool — money leaving the merchant is a person\'s action', async () => {
    const { mcp } = await connect(project(['content:read', 'content:write']));
    expect((await mcp.listTools()).tools.map((t) => t.name).filter((n) => /refund/.test(n))).toEqual([]);
  });

  it('orderForAgent leaves anything that is not an object alone', () => {
    expect(orderForAgent(undefined)).toBeUndefined();
    expect(orderForAgent('x')).toBe('x');
  });
});

describe('payment providers', () => {
  it('list_payment_providers needs only content:read', async () => {
    const { mcp, calls } = await connect(project(['content:read']));
    expect((await mcp.callTool({ name: 'list_payment_providers', arguments: {} })).isError).toBeFalsy();
    expect(calls.at(-1)).toMatchObject({ method: 'GET', url: '/projects/shop/payment-gateways' });
  });

  it('★ every definition tool is refused without payments:provider:write — and names it', async () => {
    const { mcp, calls } = await connect(project(['content:read', 'content:write']));
    for (const [name, args] of [
      ['list_gateway_definitions', {}],
      ['put_gateway_definition', { gatewayId: 'acme', definition: { name: 'Acme' } }],
      ['fork_gateway_definition', { fromId: 'stripe', id: 'acme' }],
      ['delete_gateway_definition', { gatewayId: 'acme' }],
    ] as const) {
      const res = await mcp.callTool({ name, arguments: args });
      expect(res.isError, name).toBe(true);
      expect(text(res), name).toMatch(/payments:provider:write/);
    }
    expect(calls).toEqual([]);
  });

  it('the definition tools address the INSTANCE-wide routes, with the id taken from gatewayId', async () => {
    const { mcp, calls } = await connect(project(['content:read', 'payments:provider:write']));
    await mcp.callTool({ name: 'list_gateway_definitions', arguments: {} });
    expect(calls.at(-1)).toMatchObject({ method: 'GET', url: '/admin/payment-gateways' });

    // A definition that names a different id is written under gatewayId, never under its own claim.
    await mcp.callTool({ name: 'put_gateway_definition', arguments: { gatewayId: 'acme_pay', definition: { id: 'stripe', name: 'Acme' } } });
    expect(calls.at(-1)).toEqual({ method: 'PUT', url: '/admin/payment-gateways/acme_pay', body: { id: 'acme_pay', name: 'Acme' } });

    // A JSON string is the same definition; a broken one is refused here, before any request.
    await mcp.callTool({ name: 'put_gateway_definition', arguments: { gatewayId: 'acme_pay', definition: '{"name":"Acme 2"}' } });
    expect(calls.at(-1)?.body).toEqual({ name: 'Acme 2', id: 'acme_pay' });
    const before = calls.length;
    const broken = await mcp.callTool({ name: 'put_gateway_definition', arguments: { gatewayId: 'acme_pay', definition: '{"name":' } });
    expect(broken.isError).toBe(true);
    expect(calls.length).toBe(before);

    await mcp.callTool({ name: 'fork_gateway_definition', arguments: { fromId: 'stripe', id: 'stripe_eu', name: 'Stripe EU' } });
    expect(calls.at(-1)).toEqual({ method: 'POST', url: '/admin/payment-gateways/stripe/fork', body: { id: 'stripe_eu', name: 'Stripe EU' } });

    const del = await mcp.callTool({ name: 'delete_gateway_definition', arguments: { gatewayId: 'stripe_eu' } });
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: '/admin/payment-gateways/stripe_eu' });
    expect(JSON.parse(text(del))).toEqual({ deleted: 'stripe_eu' });
  });

  it('refuses a gateway id that cannot be one, before any request', async () => {
    const { mcp, calls } = await connect(project(['payments:provider:write']));
    for (const gatewayId of ['../projects', 'Stripe', 'settings']) {
      expect((await mcp.callTool({ name: 'delete_gateway_definition', arguments: { gatewayId } })).isError, gatewayId).toBe(true);
    }
    expect(calls).toEqual([]);
  });

  it('on a MEMBER token the definition tools take no project — they are instance-wide — while the order tools do', async () => {
    const { mcp, calls } = await connect({ kind: 'member', capabilities: ['content:read', 'payments:provider:write'] });
    const tools = (await mcp.listTools()).tools;
    const props = (name: string): string[] => Object.keys((tools.find((t) => t.name === name)?.inputSchema as { properties?: object }).properties ?? {});
    for (const name of ['list_gateway_definitions', 'put_gateway_definition', 'fork_gateway_definition', 'delete_gateway_definition']) {
      expect(props(name), name).not.toContain('project');
    }
    for (const name of ['list_orders', 'get_order', 'set_order_fulfilment', 'resend_order_mail', 'list_payment_providers']) {
      expect(props(name), name).toContain('project');
    }
    await mcp.callTool({ name: 'list_gateway_definitions', arguments: {} });
    expect(calls.at(-1)?.url).toBe('/admin/payment-gateways');
    await mcp.callTool({ name: 'list_payment_providers', arguments: { project: 'p2' } });
    expect(calls.at(-1)?.url).toBe('/projects/p2/payment-gateways');
  });
});
