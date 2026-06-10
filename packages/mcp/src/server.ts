import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PageSchema, DEFAULT_AGENT_INSTRUCTIONS } from '@sitewright/schema';
import { SitewrightApiError, type Capability, type SitewrightClient } from './client.js';
import type { BridgeAuth, PendingLogin, ScopeHolder } from './auth.js';

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

function toolError(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Builds an MCP server for a Sitewright project. The bridge may start UNAUTHENTICATED (the CLI
 * boots on a URL alone and the user logs in on demand), so the full content toolset is always
 * advertised and each call is gated at runtime: not-connected → tell the agent to use `login`;
 * missing capability → say which one is needed. The API remains the real enforcement boundary —
 * this gating just gives the agent a clear, actionable message instead of a raw 401/403.
 */
export function createSitewrightMcpServer(client: SitewrightClient, holder: ScopeHolder, auth: BridgeAuth): McpServer {
  const server = new McpServer(
    { name: 'sitewright', version: '0.0.0' },
    // Admin-overridable instructions (instance settings → agent panel), resolved by the API into
    // `scope.agentInstructions`. When the bridge starts unauthenticated we don't have the scope yet,
    // so fall back to the built-in default (a re-launched, already-authenticated bridge gets the override).
    { instructions: holder.scope?.agentInstructions ?? DEFAULT_AGENT_INSTRUCTIONS },
  );

  /** Gate a content tool on (connected ∧ capability); returns an actionable message otherwise. */
  const gate =
    <A>(cap: Capability | null, fn: (args: A) => Promise<unknown>) =>
    async (args: A): Promise<ToolResult> => {
      const scope = holder.scope;
      if (!scope) {
        return toolError('Not connected. Use the `login` tool, approve in your browser, then retry this action.');
      }
      if (cap && !scope.capabilities.includes(cap)) {
        return toolError(
          `Your connection to project ${scope.projectId} (role ${scope.role}) lacks the “${cap}” capability — re-connect with the right scope via the \`login\` tool.`,
        );
      }
      return run(() => fn(args));
    };

  // ---------------------------------------------------------------- auth + orientation (always on)
  // Lazy-login state (interactive bridges only): the in-flight device grant (so repeated login
  // calls don't start duplicate grants) and the last failure (so get_scope can tell the agent
  // whether a login is pending, was denied/expired, or hasn't started).
  let loginInFlight: PendingLogin | null = null;
  let lastLoginError: string | null = null;

  server.registerTool(
    'get_scope',
    { description: 'Show whether this agent is connected and, if so, the project, role, and capabilities. Call this first.' },
    async () => {
      if (holder.scope) {
        // Don't echo the (large) agent instructions — they're delivered via the MCP `instructions` field.
        const rest = { ...holder.scope };
        delete rest.agentInstructions;
        return ok({ authenticated: true, ...rest });
      }
      return ok({
        authenticated: false,
        login_status: loginInFlight ? 'awaiting_approval' : lastLoginError ? 'failed' : 'not_started',
        ...(lastLoginError ? { last_error: lastLoginError } : {}),
        hint: loginInFlight
          ? 'A login is pending — ask the user to finish approving in their browser, then call get_scope again.'
          : 'Use the `login` tool to connect this agent to a project.',
      });
    },
  );

  // Kick off a device-flow login: returns the verification URL + code to show the user NOW, and
  // resolves the project scope in the background once they approve. Re-introspects on success so
  // the content tools start working (the agent polls get_scope to confirm). De-duplicated: a second
  // call while a grant is pending returns the SAME code instead of starting another grant.
  const startLogin = async (switchProject: boolean): Promise<ToolResult> => {
    if (!auth.interactive) {
      return toolError('This connection uses a fixed token; re-authentication and project switching are not available.');
    }
    if (loginInFlight) {
      return ok({
        status: 'awaiting_approval',
        verification_url: loginInFlight.verificationUrl,
        user_code: loginInFlight.userCode,
        expires_in: loginInFlight.expiresIn,
        message: `A login is already pending — ask the user to finish approving at ${loginInFlight.verificationUrl} (code ${loginInFlight.userCode}), then call get_scope.`,
      });
    }
    try {
      const pending = await auth.beginLogin();
      loginInFlight = pending;
      lastLoginError = null;
      // Background: when approved + persisted, refresh our scope. A denial/expiry (or a failed
      // post-login introspect) is recorded in lastLoginError so get_scope can report it. Always
      // settle loginInFlight in finally — no unhandled rejection, no stuck "pending" state.
      pending.completion
        .then(async () => {
          try {
            holder.scope = await client.introspect();
          } catch (err) {
            lastLoginError = err instanceof Error ? err.message : 'could not resolve the project after login';
          }
        })
        .catch((err) => {
          lastLoginError = err instanceof Error ? err.message : 'login was denied or expired';
        })
        .finally(() => {
          loginInFlight = null;
        });
      return ok({
        status: 'awaiting_approval',
        verification_url: pending.verificationUrl,
        user_code: pending.userCode,
        expires_in: pending.expiresIn,
        message:
          `Ask the user to open ${pending.verificationUrl}, sign in, ` +
          `${switchProject ? 'pick the project to switch to' : 'pick the project'}, enter the code ${pending.userCode}, ` +
          `and approve — and to keep that tab open to watch your changes live. Then call get_scope to confirm before continuing.`,
      });
    } catch (err) {
      return toolError(`Could not start login: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  server.registerTool(
    'login',
    { description: 'Connect this agent to a Sitewright project. Returns a URL + code for the user to approve in their browser.' },
    () => startLogin(false),
  );

  server.registerTool(
    'switch_project',
    {
      description:
        'Re-authenticate to connect to a DIFFERENT project (project scope is fixed per connection). Returns a URL + code to approve.',
    },
    () => startLogin(true),
  );

  // ---------------------------------------------------------------- reads (content:read)
  server.registerTool(
    'list_pages',
    { description: 'List the project’s pages.' },
    gate(null, () => client.listContent('page')),
  );

  server.registerTool(
    'get_page',
    {
      description:
        'Get one page by id. For code-first pages the design is in the `source` field; `root` is a legacy placeholder.',
      inputSchema: { id: z.string() },
    },
    gate(null, ({ id }) => client.getContent('page', id)),
  );

  server.registerTool(
    'list_content',
    { description: 'List all entities of a content kind.', inputSchema: { kind: GENERIC_KIND } },
    gate(null, ({ kind }) => client.listContent(kind)),
  );

  server.registerTool(
    'get_content',
    { description: 'Get one content entity by kind + id.', inputSchema: { kind: GENERIC_KIND, id: z.string() } },
    gate(null, ({ kind, id }) => client.getContent(kind, id)),
  );

  server.registerTool(
    'preview_page',
    {
      description:
        'Render a (possibly unsaved) page to a full HTML document and return it, so you can check your work. Does not save.',
      inputSchema: { page: PageSchema },
    },
    gate(null, ({ page }) => client.preview(page)),
  );

  server.registerTool(
    'get_publish_status',
    { description: 'Read the project’s latest published release (or null if never published).' },
    gate(null, () => client.publishStatus()),
  );

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
    gate('content:read', ({ formId, limit, offset }) => client.listSubmissions({ formId, limit, offset })),
  );

  server.registerTool(
    'list_stock_providers',
    {
      description:
        'List the configured stock-image providers and whether each is available (openverse needs no key; unsplash/pexels need an instance-admin key).',
    },
    gate('content:read', () => client.stockProviders()),
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
    gate('content:read', ({ provider, query, page }) => client.stockSearch(provider, query, page ?? 1)),
  );

  // ---------------------------------------------------------------- writes (content:write)
  server.registerTool(
    'put_page',
    { description: 'Create or replace a page. The page id is taken from page.id.', inputSchema: { page: PageSchema } },
    gate('content:write', ({ page }) => client.putContent('page', page.id, page)),
  );

  server.registerTool(
    'delete_page',
    { description: 'Delete a page by id.', inputSchema: { id: z.string() } },
    gate('content:write', ({ id }) => client.deleteContent('page', id).then(() => ({ deleted: id }))),
  );

  server.registerTool(
    'put_content',
    {
      description: 'Create or replace a content entity of the given kind. `data` must match that kind’s schema.',
      inputSchema: { kind: GENERIC_KIND, id: z.string(), data: z.unknown() },
    },
    gate('content:write', ({ kind, id, data }) => client.putContent(kind, id, data)),
  );

  server.registerTool(
    'delete_content',
    { description: 'Delete a content entity by kind + id.', inputSchema: { kind: GENERIC_KIND, id: z.string() } },
    gate('content:write', ({ kind, id }) => client.deleteContent(kind, id).then(() => ({ deleted: `${kind}/${id}` }))),
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
    gate('content:write', ({ provider, id, alt }) => client.importStock(provider, id, alt)),
  );

  // ---------------------------------------------------------------- publish (publish)
  // NB: `deploy` is intentionally NOT exposed as a tool — pushing to a customer's external webspace
  // (FTP/SFTP credentials) from an autonomous agent is out of scope; deploy stays human-driven.
  server.registerTool(
    'publish_project',
    { description: 'Build the project’s static site from current saved content.' },
    gate('publish', () => client.publish()),
  );

  return server;
}
