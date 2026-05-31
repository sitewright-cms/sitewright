import { describe, it, expect, beforeAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

// End-to-end against a live deployed instance: spawns the real built bridge
// (`dist/bin.js`) as a subprocess over stdio, authenticated by a freshly-minted
// project PAT, and drives it like a coding agent would. Skipped unless
// SW_MCP_E2E_URL points at a running instance (so CI / `pnpm test` don't need a
// deploy). Run: SW_MCP_E2E_URL=http://dind.local:2003 vitest run test/mcp-e2e.test.ts
const BASE_URL = process.env.SW_MCP_E2E_URL;
const suite = BASE_URL ? describe : describe.skip;

type TextResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

suite('@sitewright/mcp bridge — end to end', () => {
  let token = '';

  beforeAll(async () => {
    const url = BASE_URL!;
    const stamp = Date.now();
    const reg = await fetch(`${url}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `mcp-${stamp}@e2e.test`, password: 'pw-secret-1', orgName: `MCP ${stamp}` }),
    });
    const cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const { orgId } = (await reg.json()) as { orgId: string };
    const proj = await fetch(`${url}/orgs/${orgId}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'MCP Site', slug: `mcp-${stamp}` }),
    });
    const projectId = ((await proj.json()) as { project: { id: string } }).project.id;
    const keyRes = await fetch(`${url}/orgs/${orgId}/projects/${projectId}/api-keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'mcp-e2e',
        role: 'admin',
        capabilities: ['content:read', 'content:write', 'publish'],
        expiresInDays: 1,
      }),
    });
    token = ((await keyRes.json()) as { token: string }).token;
  });

  async function connectBridge(tok = token): Promise<Client> {
    const binPath = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
    const transport = new StdioClientTransport({
      command: 'node',
      args: [binPath],
      env: { SITEWRIGHT_URL: BASE_URL!, SITEWRIGHT_TOKEN: tok, PATH: process.env.PATH ?? '' },
    });
    const client = new Client({ name: 'e2e', version: '0' });
    await client.connect(transport);
    return client;
  }

  it('exposes capability-appropriate tools, authors a page, reads and previews it', async () => {
    const mcp = await connectBridge();
    const tools = (await mcp.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['get_scope', 'put_page', 'preview_page', 'publish_project']));

    const page = {
      id: 'home',
      path: '/',
      title: 'Hallo Welt',
      root: { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Hallo' } }] },
    };
    const put = (await mcp.callTool({ name: 'put_page', arguments: { page } })) as TextResult;
    expect(put.isError).toBeFalsy();

    const got = (await mcp.callTool({ name: 'get_page', arguments: { id: 'home' } })) as TextResult;
    expect(got.content[0]!.text).toContain('Hallo Welt');

    const prev = (await mcp.callTool({ name: 'preview_page', arguments: { page } })) as TextResult;
    expect(prev.content[0]!.text).toContain('Hallo');

    await mcp.close();
  });

  it('hides write tools and rejects writes for a read-only token', async () => {
    const url = BASE_URL!;
    const stamp = Date.now();
    // A second project + a read-only key.
    const reg = await fetch(`${url}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `mcpro-${stamp}@e2e.test`, password: 'pw-secret-1', orgName: `MCPRO ${stamp}` }),
    });
    const cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const { orgId } = (await reg.json()) as { orgId: string };
    const proj = await fetch(`${url}/orgs/${orgId}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'RO', slug: `ro-${stamp}` }),
    });
    const projectId = ((await proj.json()) as { project: { id: string } }).project.id;
    const keyRes = await fetch(`${url}/orgs/${orgId}/projects/${projectId}/api-keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'ro', role: 'member', capabilities: ['content:read'], expiresInDays: 1 }),
    });
    const roToken = ((await keyRes.json()) as { token: string }).token;

    const mcp = await connectBridge(roToken);
    const tools = (await mcp.listTools()).tools.map((t) => t.name);
    expect(tools).not.toContain('put_page');
    expect(tools).not.toContain('publish_project');
    await mcp.close();
  });
});
