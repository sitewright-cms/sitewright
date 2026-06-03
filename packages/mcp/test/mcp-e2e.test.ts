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
  let projectId = '';

  beforeAll(async () => {
    const url = BASE_URL!;
    const stamp = Date.now();
    const reg = await fetch(`${url}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `mcp-${stamp}@e2e.test`, password: 'pw-secret-1', orgName: `MCP ${stamp}` }),
    });
    const cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const proj = await fetch(`${url}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'MCP Site', slug: `mcp-${stamp}` }),
    });
    projectId = ((await proj.json()) as { project: { id: string } }).project.id;
    const keyRes = await fetch(`${url}/projects/${projectId}/api-keys`, {
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

  it('exposes capability-appropriate tools, authors a code-first page, reads and previews it', async () => {
    const mcp = await connectBridge();
    const tools = (await mcp.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['get_scope', 'put_page', 'preview_page', 'publish_project']));

    // A code-first page: the design lives in `source` (Handlebars + Tailwind), root is a placeholder.
    const page = {
      id: 'home',
      path: '/',
      title: 'Hallo Welt',
      root: { id: 'root', type: 'Section' },
      source: '<main class="p-8"><h1 class="text-3xl font-bold">Hallo {{ company.name }}</h1></main>',
    };
    const put = (await mcp.callTool({ name: 'put_page', arguments: { page } })) as TextResult;
    expect(put.isError).toBeFalsy();

    const got = (await mcp.callTool({ name: 'get_page', arguments: { id: 'home' } })) as TextResult;
    expect(got.content[0]!.text).toContain('Hallo Welt');

    const prev = (await mcp.callTool({ name: 'preview_page', arguments: { page } })) as TextResult;
    expect(prev.content[0]!.text).toContain('Hallo'); // the source rendered

    await mcp.close();
  });

  // The headline capability: a generic agent (any provider) connects via a project token and
  // builds a complete single-page site — Corporate Identity, a brand-themed DaisyUI page, then
  // publishes — and the LIVE static site reflects it. No model key needed; the agent is the client.
  it('builds a complete single-page site: identity → DaisyUI page → publish → live', async () => {
    const mcp = await connectBridge();

    // 1. Set the Corporate Identity (brand). `primary` themes DaisyUI components.
    const settings = {
      identity: { name: 'Windhoek Plumbing Co', colors: { primary: '#0a6cba' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    };
    const setId = (await mcp.callTool({
      name: 'put_content',
      arguments: { kind: 'settings', id: 'settings', data: settings },
    })) as TextResult;
    expect(setId.isError).toBeFalsy();

    // 2. Author a code-first DaisyUI landing page (brand binding + a client-editable region).
    const source = [
      '<div class="navbar bg-base-100 shadow-sm">',
      '  <a class="btn btn-ghost text-xl" href="/">{{ company.name }}</a>',
      '</div>',
      '<div class="hero min-h-[50vh] bg-base-200">',
      '  <div class="hero-content text-center">',
      '    <div class="max-w-xl">',
      '      <h1 class="text-4xl font-bold">{{edit "headline" "Reliable plumbing in Windhoek"}}</h1>',
      '      <p class="py-4 text-base-content/70">{{edit "sub" "24/7 emergency plumbing, leak repairs, and installations."}}</p>',
      '      <a class="btn btn-primary" href="/contact">{{edit "cta" "Book a plumber"}}</a>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join('\n');
    const page = { id: 'home', path: '/', title: 'Windhoek Plumbing', root: { id: 'root', type: 'Section' }, source };
    const put = (await mcp.callTool({ name: 'put_page', arguments: { page } })) as TextResult;
    expect(put.isError).toBeFalsy();

    // 3. Preview reflects the bound brand name.
    const prev = (await mcp.callTool({ name: 'preview_page', arguments: { page } })) as TextResult;
    expect(prev.content[0]!.text).toContain('Windhoek Plumbing Co');

    // 4. Publish.
    const pub = (await mcp.callTool({ name: 'publish_project', arguments: {} })) as TextResult;
    expect(pub.isError).toBeFalsy();

    // 5. The LIVE static site is the brand-themed DaisyUI page the agent built.
    const liveHtml = await (await fetch(`${BASE_URL}/sites/${projectId}/`)).text();
    expect(liveHtml).toContain('Windhoek Plumbing Co'); // {{ company.name }}
    expect(liveHtml).toContain('Reliable plumbing in Windhoek'); // {{edit}} default
    expect(liveHtml).toContain('class="btn btn-primary"'); // DaisyUI component in the output
    const liveCss = await (await fetch(`${BASE_URL}/sites/${projectId}/styles.css`)).text();
    expect(liveCss).toMatch(/\.btn/); // DaisyUI compiled into the shared sheet
    expect(liveCss).toContain('#0a6cba'); // brand color present…
    expect(liveCss).not.toContain('oklch(45% 0.24 277.023)'); // …and DaisyUI's default primary is gone (robust to color serialization)

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
    const proj = await fetch(`${url}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'RO', slug: `ro-${stamp}` }),
    });
    const projectId = ((await proj.json()) as { project: { id: string } }).project.id;
    const keyRes = await fetch(`${url}/projects/${projectId}/api-keys`, {
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
