import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MCP_TOOL_CATALOG, DEFAULT_AGENT_INSTRUCTIONS } from '@sitewright/schema';
import { createSitewrightMcpServer } from '../src/server.js';
import { SitewrightClient, SitewrightApiError, isMemberScope, type FetchLike, type MemberScope, type ProjectScope } from '../src/client.js';
import { staticAuth } from '../src/auth.js';

// MEMBER-TOKEN MODE, driven end to end: a real SitewrightClient over a recording fetch, behind a real
// MCP server and client. What matters here is which PROJECT each request lands on, so the assertions
// are on the URLs the client actually asks for — a fake client would only prove the wiring calls it.

interface Call {
  method: string;
  url: string;
  body?: unknown;
  headers: Record<string, string>;
}

function recordingFetch(respond: (call: Call) => { status?: number; body?: unknown; delayMs?: number } = () => ({})) {
  const calls: Call[] = [];
  const impl: FetchLike = async (input, init) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: input.replace('https://cms.test', ''),
      headers: Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
      ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) as unknown } : {}),
    };
    calls.push(call);
    const { status = 200, body = { items: [] }, delayMs = 0 } = respond(call);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    return { ok: status >= 200 && status < 300, status, statusText: '', text: async () => JSON.stringify(body) };
  };
  return { impl, calls };
}

const member = (capabilities: MemberScope['capabilities']): MemberScope => ({ kind: 'member', capabilities });
const FULL = member(['content:read', 'content:write', 'projects:create']);
const projectScope: ProjectScope = { kind: 'project', projectId: 'only', role: 'owner', capabilities: ['content:read', 'content:write'] };

async function connect(scope: MemberScope | ProjectScope, respond?: Parameters<typeof recordingFetch>[0]) {
  const fetch = recordingFetch(respond);
  const client = new SitewrightClient('https://cms.test', async () => 'swm_tok', fetch.impl);
  client.primeScope(scope);
  const server = createSitewrightMcpServer(client, { scope }, staticAuth('swm_tok'));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const mcp = new Client({ name: 'test', version: '0' });
  await mcp.connect(clientSide);
  return { mcp, calls: fetch.calls, client };
}

const text = (res: Awaited<ReturnType<Client['callTool']>>): string => (res.content as Array<{ text: string }>)[0]!.text;

describe('member-token mode — the tool surface', () => {
  it('adds the account tools and a required `project` argument to every project tool, and to no other', async () => {
    const { mcp } = await connect(FULL);
    const tools = (await mcp.listTools()).tools;
    const required = (name: string): string[] => ((tools.find((t) => t.name === name)?.inputSchema as { required?: string[] }).required ?? []);
    const properties = (name: string): string[] => Object.keys((tools.find((t) => t.name === name)?.inputSchema as { properties?: object }).properties ?? {});

    // Everything a project key offers, plus the three that only make sense across an account.
    expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_CATALOG.map((t) => t.name), 'create_project', 'duplicate_project', 'list_projects'].sort());

    // A tool that already took arguments keeps them and gains `project`; one that took none gains it too.
    expect(required('put_page')).toEqual(expect.arrayContaining(['page', 'project']));
    expect(required('list_pages')).toEqual(['project']);
    expect(required('publish_project')).toContain('project');
    // Not about one project → no `project` argument at all.
    for (const free of ['get_scope', 'login', 'switch_project', 'get_guide', 'get_reference', 'get_components', 'get_capabilities', 'search_icons', 'search_textures', 'list_projects', 'create_project']) {
      expect(properties(free), free).not.toContain('project');
    }
    // duplicate_project names its SOURCE project itself.
    expect(required('duplicate_project')).toEqual(['project']);

    // The first thing the agent is told is how this connection differs.
    const instructions = mcp.getInstructions() ?? '';
    expect(instructions.startsWith('THIS CONNECTION USES A MEMBER TOKEN.')).toBe(true);
    expect(instructions).toContain(DEFAULT_AGENT_INSTRUCTIONS);
  });

  it('★ leaves a PROJECT key exactly as it was — no account tools, no `project` argument, no preface', async () => {
    const { mcp, calls } = await connect(projectScope);
    const tools = (await mcp.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(MCP_TOOL_CATALOG.map((t) => t.name).sort());
    expect(Object.keys((tools.find((t) => t.name === 'list_pages')?.inputSchema as { properties?: object }).properties ?? {})).not.toContain('project');
    expect(mcp.getInstructions()).toBe(DEFAULT_AGENT_INSTRUCTIONS);

    await mcp.callTool({ name: 'list_pages', arguments: {} });
    expect(calls.at(-1)?.url).toMatch(/^\/projects\/only\/content\/page/);
  });

  it('get_scope says it is a member token and what to do about it', async () => {
    const { mcp } = await connect(FULL);
    const scope = JSON.parse(text(await mcp.callTool({ name: 'get_scope', arguments: {} }))) as Record<string, unknown>;
    expect(scope).toMatchObject({ authenticated: true, kind: 'member', capabilities: ['content:read', 'content:write', 'projects:create'] });
    expect(scope).not.toHaveProperty('projectId');
    expect(scope.hint).toMatch(/list_projects/);
  });
});

describe('member-token mode — every call names its project', () => {
  it('sends each call to the project it named, and nothing is remembered between calls', async () => {
    const { mcp, calls } = await connect(FULL);
    await mcp.callTool({ name: 'list_pages', arguments: { project: 'alpha' } });
    await mcp.callTool({ name: 'put_page', arguments: { project: 'beta', page: { id: 'home', path: '', title: 'Home' } } });
    const [first, second] = calls;
    expect(first).toMatchObject({ method: 'GET' });
    expect(first?.url).toMatch(/^\/projects\/alpha\/content\/page/);
    expect(second?.method).toBe('PUT');
    expect(second?.url).toMatch(/^\/projects\/beta\/content\/page\/home/);
    // `project` addressed the call; it is not part of what was written.
    expect(second?.body).not.toHaveProperty('project');
  });

  it('★ two calls in flight at once do not swap projects', async () => {
    // A slow first call must still land on ITS project after a second call has started and finished.
    const { mcp, calls } = await connect(FULL, (call) => ({ delayMs: call.url.includes('/alpha/') ? 40 : 0 }));
    await Promise.all([
      mcp.callTool({ name: 'list_pages', arguments: { project: 'alpha' } }),
      mcp.callTool({ name: 'list_pages', arguments: { project: 'beta' } }),
      mcp.callTool({ name: 'list_pages', arguments: { project: 'gamma' } }),
    ]);
    expect(calls.map((c) => c.url.split('/')[2]).sort()).toEqual(['alpha', 'beta', 'gamma']);
    // And a multi-request tool keeps its project across its own awaits while others interleave.
    calls.length = 0;
    await Promise.all([
      mcp.callTool({ name: 'put_page', arguments: { project: 'alpha', page: { id: 'a', path: 'a', title: 'A' } } }),
      mcp.callTool({ name: 'put_page', arguments: { project: 'beta', page: { id: 'b', path: 'b', title: 'B' } } }),
    ]);
    for (const c of calls) {
      const project = c.url.split('/')[2];
      expect(c.url).toContain(project === 'alpha' ? '/page/a' : '/page/b');
    }
  });

  it('refuses a call that names no project before anything is sent', async () => {
    const { mcp, calls } = await connect(FULL);
    const res = await mcp.callTool({ name: 'list_pages', arguments: {} });
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('★ `project` must be an id — it can never be used to climb out of /projects/<id>/', async () => {
    const { mcp, calls, client } = await connect(FULL);
    // `.` and `..` are the dangerous ones: percent-encoding leaves a dot alone, and a URL parser
    // resolves `/projects/../content/page` to `/content/page` — a different route, with the bearer.
    for (const project of ['..', '.', '../admin/users?x=', 'a/b', 'a?b=1', 'a#b', 'a%2Fb', ' ', '']) {
      const viaTool = await mcp.callTool({ name: 'list_pages', arguments: { project } }).catch((e: unknown) => ({ isError: true, thrown: e }));
      expect(viaTool.isError, `tool: ${JSON.stringify(project)}`).toBe(true);
      const viaDuplicate = await mcp.callTool({ name: 'duplicate_project', arguments: { project } }).catch((e: unknown) => ({ isError: true, thrown: e }));
      expect(viaDuplicate.isError, `duplicate: ${JSON.stringify(project)}`).toBe(true);
      // …and the client refuses on its own, for a caller that is not the MCP server.
      await expect(client.withProject(project, () => client.listContent('page')), `client: ${JSON.stringify(project)}`).rejects.toMatchObject({ status: 400 });
      await expect(client.duplicateProject(project)).rejects.toMatchObject({ status: 400 });
    }
    expect(calls).toHaveLength(0);
    // A real id (base62, or an older UUID) goes straight through.
    await mcp.callTool({ name: 'list_pages', arguments: { project: 'E1BzwGMijBMa' } });
    await mcp.callTool({ name: 'list_pages', arguments: { project: '3f2b8c1e-7a4d-4e2a-9b1c-0d5e6f7a8b9c' } });
    expect(calls.map((c) => c.url.split('/')[2])).toEqual(['E1BzwGMijBMa', '3f2b8c1e-7a4d-4e2a-9b1c-0d5e6f7a8b9c']);
  });

  it('surfaces the server’s refusal for a project the member cannot reach', async () => {
    const { mcp } = await connect(FULL, () => ({ status: 404, body: { error: 'project not found' } }));
    const res = await mcp.callTool({ name: 'list_pages', arguments: { project: 'not-mine' } });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/404.*project not found/);
  });
});

describe('member-token mode — the account tools', () => {
  const PROJECTS = [{ id: 'alpha', name: 'Alpha', slug: 'alpha', role: 'owner' }];

  it('lists, creates and duplicates projects through the account routes', async () => {
    const { mcp, calls } = await connect(FULL, (call) =>
      call.method === 'GET' ? { body: { projects: PROJECTS } } : { status: 201, body: { project: { id: 'new1', name: 'New', slug: 'new', role: 'owner' } } },
    );
    expect(JSON.parse(text(await mcp.callTool({ name: 'list_projects', arguments: {} })))).toEqual(PROJECTS);
    expect(calls.at(-1)).toMatchObject({ method: 'GET', url: '/projects' });

    const made = JSON.parse(text(await mcp.callTool({ name: 'create_project', arguments: { name: 'New', slug: 'new' } }))) as { id: string };
    expect(made.id).toBe('new1');
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: '/projects', body: { name: 'New', slug: 'new' } });

    await mcp.callTool({ name: 'duplicate_project', arguments: { project: 'alpha' } });
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: '/projects/alpha/duplicate' });
  });

  it('gates them on the token’s own capabilities, and says where a missing one comes from', async () => {
    const { mcp, calls } = await connect(member(['content:write']));
    for (const [name, args, cap] of [
      ['list_projects', {}, 'content:read'],
      ['create_project', { name: 'N', slug: 'n' }, 'projects:create'],
      ['duplicate_project', { project: 'alpha' }, 'projects:create'],
    ] as const) {
      const res = await mcp.callTool({ name, arguments: args });
      expect(res.isError).toBe(true);
      expect(text(res)).toBe(`Your member token lacks the “${cap}” capability — it has to be minted with it (Account → Access keys).`);
    }
    expect(calls).toHaveLength(0);
    // A project tool refuses the same way, without naming a project it does not have.
    const readOnly = await connect(member(['content:read']));
    const write = await readOnly.mcp.callTool({ name: 'put_page', arguments: { project: 'alpha', page: { id: 'home', path: '', title: 'Home' } } });
    expect(write.isError).toBe(true);
    expect(text(write)).toMatch(/^Your member token lacks the “content:write” capability/);
    expect(readOnly.calls).toHaveLength(0);
  });
});

describe('SitewrightClient — member scope', () => {
  it('a project request with no project named is refused locally, with what to do', async () => {
    const fetch = recordingFetch();
    const client = new SitewrightClient('https://cms.test', async () => 'swm_tok', fetch.impl);
    client.primeScope(FULL);
    const err = await client.listContent('page').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SitewrightApiError);
    expect((err as SitewrightApiError).status).toBe(400);
    expect((err as SitewrightApiError).message).toMatch(/member token.*pass `project`/);
    expect(fetch.calls).toHaveLength(0);

    await client.withProject('alpha', () => client.listContent('page'));
    expect(fetch.calls[0]?.url).toMatch(/^\/projects\/alpha\//);
  });

  it('★ a PROJECT key cannot be pointed at another project by withProject', async () => {
    const fetch = recordingFetch();
    const client = new SitewrightClient('https://cms.test', async () => 'swk_tok', fetch.impl);
    client.primeScope(projectScope);
    await client.withProject('someone-elses', () => client.listContent('page'));
    expect(fetch.calls[0]?.url).toMatch(/^\/projects\/only\//);
  });

  it('★ keeps the project across an await while another call runs — it is per call, not per client', async () => {
    const fetch = recordingFetch();
    const client = new SitewrightClient('https://cms.test', async () => 'swm_tok', fetch.impl);
    client.primeScope(FULL);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // The path is built AFTER the sleep. With a project held in a shared field, `alpha` would wake up
    // to find `beta` (set later) and ask for the wrong project; async-local state cannot be overwritten.
    await Promise.all([
      client.withProject('alpha', async () => {
        await sleep(30);
        return client.listContent('page');
      }),
      client.withProject('beta', async () => {
        await sleep(5);
        return client.listContent('page');
      }),
      client.withProject('gamma', async () => client.listContent('page')),
    ]);
    expect(fetch.calls.map((c) => c.url.split('/')[2])).toEqual(['gamma', 'beta', 'alpha']);
    // Outside any call there is no project left over.
    await expect(client.listContent('page')).rejects.toMatchObject({ status: 400 });
  });

  it('★ never sends one project’s version token to another project’s page of the same id', async () => {
    // Both projects have a page `home`. The If-Match token a read arms belongs to THAT project's page.
    const fetch = recordingFetch((call) => (call.method === 'GET' ? { body: { item: { id: 'home', title: 'Alpha' }, version: 'v-alpha-1' } } : { body: { item: { id: 'home' }, version: 'v-next' } }));
    const client = new SitewrightClient('https://cms.test', async () => 'swm_tok', fetch.impl);
    client.primeScope(FULL);
    const page = { id: 'home', path: '', title: 'Home' };

    await client.withProject('alpha', () => client.getContent('page', 'home'));
    await client.withProject('beta', () => client.putContent('page', 'home', page));
    await client.withProject('alpha', () => client.putContent('page', 'home', page));

    const [read, betaWrite, alphaWrite] = fetch.calls;
    expect(read?.url).toMatch(/^\/projects\/alpha\/content\/page\/home/);
    expect(betaWrite?.url).toMatch(/^\/projects\/beta\/content\/page\/home/);
    expect(betaWrite?.headers).not.toHaveProperty('if-match');
    // The guard still works where it should: alpha's write carries what alpha's read returned.
    expect(alphaWrite?.headers['if-match']).toBe('v-alpha-1');
  });

  it('tells the two scopes apart, treating a scope with no `kind` as a project key', () => {
    expect(isMemberScope(FULL)).toBe(true);
    expect(isMemberScope(projectScope)).toBe(false);
    // What an older server answers: no `kind` at all.
    expect(isMemberScope({ projectId: 'p', role: 'owner', capabilities: [] })).toBe(false);
  });
});
