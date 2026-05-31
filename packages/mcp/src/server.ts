import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PageSchema } from '@sitewright/schema';
import { SitewrightApiError, type Capability, type Scope, type SitewrightClient } from './client.js';

/** Content kinds reachable via the generic content tools (media/deploy_target are excluded). */
const GENERIC_KIND = z.enum([
  'settings',
  'page',
  'partial',
  'template',
  'pattern',
  'translation',
  'dataset',
  'entry',
  'form',
]);

const INSTRUCTIONS = `This server exposes ONE Sitewright project's content over MCP.
A Sitewright project is a tree of content entities addressed by (kind, id):
page, partial, template, pattern, translation, dataset, entry, settings.
Pages hold a block tree (\`root\`); reuse comes from partials/templates; data
comes from datasets+entries. Author by reading the relevant entities, editing
them, writing them back, and calling preview_page to see the rendered result.
All writes are validated server-side (schema + tree-safety); you cannot bypass
the project's role/capability limits. Call get_scope first to see what this
token may do.`;

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function ok(value: unknown): ToolResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

/** Runs a tool body, turning an API error into an MCP tool error rather than throwing. */
async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    if (err instanceof SitewrightApiError) {
      return { content: [{ type: 'text', text: `Error ${err.status}: ${err.message}` }], isError: true };
    }
    const message = err instanceof Error ? err.message : 'unknown error';
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
}

/**
 * Builds an MCP server exposing the project's content operations as tools. Tools
 * are registered according to the token's capabilities — a read-only token gets
 * no write/publish tools — so the advertised toolset never exceeds what the
 * server would actually allow.
 */
export function createSitewrightMcpServer(client: SitewrightClient, scope: Scope): McpServer {
  const server = new McpServer(
    { name: 'sitewright', version: '0.0.0' },
    { instructions: INSTRUCTIONS },
  );
  const can = (cap: Capability): boolean => scope.capabilities.includes(cap);

  // --- always available (orientation + reads) ---
  server.registerTool(
    'get_scope',
    { description: 'Show which org/project this token addresses, its role, and its capabilities.' },
    async () => ok(scope),
  );

  server.registerTool(
    'list_pages',
    { description: 'List the project’s pages.' },
    async () => run(() => client.listContent('page')),
  );

  server.registerTool(
    'get_page',
    { description: 'Get one page by id (includes its block tree).', inputSchema: { id: z.string() } },
    async ({ id }) => run(() => client.getContent('page', id)),
  );

  server.registerTool(
    'list_content',
    {
      description: 'List all entities of a content kind.',
      inputSchema: { kind: GENERIC_KIND },
    },
    async ({ kind }) => run(() => client.listContent(kind)),
  );

  server.registerTool(
    'get_content',
    {
      description: 'Get one content entity by kind + id.',
      inputSchema: { kind: GENERIC_KIND, id: z.string() },
    },
    async ({ kind, id }) => run(() => client.getContent(kind, id)),
  );

  server.registerTool(
    'preview_page',
    {
      description:
        'Render a (possibly unsaved) page to a full HTML document and return it, so you can check your work. Does not save.',
      inputSchema: { page: PageSchema },
    },
    async ({ page }) => run(() => client.preview(page)),
  );

  server.registerTool(
    'get_publish_status',
    { description: 'Read the project’s latest published release (or null if never published).' },
    async () => run(() => client.publishStatus()),
  );

  // Submissions carry visitor PII; only advertise the tool to read-capable tokens
  // (the API also enforces content:read, so this keeps the toolset honest).
  if (can('content:read')) {
    server.registerTool(
      'list_submissions',
      {
        description:
          'List form submissions for the project, newest first. Optionally filter by formId and paginate with limit/offset.',
        inputSchema: {
          formId: z.string().optional(),
          limit: z.number().int().min(1).max(200).optional(),
          offset: z.number().int().min(0).optional(),
        },
      },
      async ({ formId, limit, offset }) => run(() => client.listSubmissions({ formId, limit, offset })),
    );

    server.registerTool(
      'list_stock_providers',
      {
        description:
          'List the configured stock-image providers and whether each is available (openverse needs no key; unsplash/pexels need an instance-admin key).',
      },
      async () => run(() => client.stockProviders()),
    );

    server.registerTool(
      'search_stock_images',
      {
        description:
          'Search a stock-image provider for photos. Returns provider-hosted thumbnails to preview; use import_stock_image to bring one into the project.',
        inputSchema: {
          provider: z.enum(['openverse', 'unsplash', 'pexels']),
          query: z.string().min(1).max(200),
          page: z.number().int().min(1).max(100).optional(),
        },
      },
      async ({ provider, query, page }) => run(() => client.stockSearch(provider, query, page ?? 1)),
    );
  }

  // --- writes (only when the token may write) ---
  if (can('content:write')) {
    server.registerTool(
      'put_page',
      {
        description: 'Create or replace a page. The page id is taken from page.id.',
        inputSchema: { page: PageSchema },
      },
      async ({ page }) => run(() => client.putContent('page', page.id, page)),
    );

    server.registerTool(
      'delete_page',
      { description: 'Delete a page by id.', inputSchema: { id: z.string() } },
      async ({ id }) => run(() => client.deleteContent('page', id).then(() => ({ deleted: id }))),
    );

    server.registerTool(
      'put_content',
      {
        description: 'Create or replace a content entity of the given kind. `data` must match that kind’s schema.',
        inputSchema: { kind: GENERIC_KIND, id: z.string(), data: z.unknown() },
      },
      async ({ kind, id, data }) => run(() => client.putContent(kind, id, data)),
    );

    server.registerTool(
      'delete_content',
      {
        description: 'Delete a content entity by kind + id.',
        inputSchema: { kind: GENERIC_KIND, id: z.string() },
      },
      async ({ kind, id }) => run(() => client.deleteContent(kind, id).then(() => ({ deleted: `${kind}/${id}` }))),
    );

    server.registerTool(
      'import_stock_image',
      {
        description:
          'Import a stock photo (by provider + id from search_stock_images) into the project. The server downloads, optimizes, and self-hosts it as a media asset with attribution — never a hotlink.',
        inputSchema: {
          provider: z.enum(['openverse', 'unsplash', 'pexels']),
          id: z.string().min(1).max(256),
          alt: z.string().max(500).optional(),
        },
      },
      async ({ provider, id, alt }) => run(() => client.importStock(provider, id, alt)),
    );
  }

  // --- publish (only when the token may publish) ---
  // NB: `deploy` is intentionally NOT exposed as a tool — pushing to a customer's
  // external webspace (FTP/SFTP credentials) from an autonomous agent is out of
  // scope for the bridge; deploy stays a deliberate, human-driven action.
  if (can('publish')) {
    server.registerTool(
      'publish_project',
      { description: 'Build the project’s static site from current saved content.' },
      async () => run(() => client.publish()),
    );
  }

  return server;
}
