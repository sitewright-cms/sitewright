import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  PageSchema,
  DEFAULT_AGENT_INSTRUCTIONS,
  COMPONENT_CATALOG,
  AGENT_GUIDES,
  GUIDE_TOPICS,
  SW_HELPERS,
  SW_DIRECTIVES,
  BINDING_NAMESPACES,
  LOOP_VARIABLES,
  StockProviderNameSchema,
  ScreenshotViewportNameSchema,
  SCREENSHOT_VIEWPORT_NAMES,
  type GuideTopic,
  type ScreenshotViewportName,
} from '@sitewright/schema';
import { SitewrightApiError, type Capability, type SitewrightClient, type PreviewResult } from './client.js';
import type { BridgeAuth, PendingLogin, ScopeHolder } from './auth.js';

/** Content kinds reachable via the generic content tools. The DEDICATED kinds the API blocks from
 *  the generic route (media/mediafolder/deploy_target/project_smtp) are excluded; everything else an
 *  agent can author — including `snippet` (reusable `{{> name}}` fragments). */
const GENERIC_KIND = z.enum([
  'settings',
  'page',
  'template',
  'snippet',
  'translation',
  'dataset',
  'entry',
  'form',
]);

type ContentBlock = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
type ToolResult = { content: ContentBlock[]; isError?: boolean };

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

  // Static platform metadata — the machine-readable authoring contracts of the first-party
  // interactive components (the data-sw-component runtime). No connection or capability
  // needed: this is the same constant the platform itself builds from, so an agent can fetch
  // the exact markup contract instead of guessing from prose.
  server.registerTool(
    'get_components',
    {
      description:
        'The authoring contracts of the first-party interactive components (carousel, tabs, lightbox, modal, cookie-consent, form): markers, data-sw-part roles, config attributes, and copy-paste markup skeletons. Optionally filter by type or marker.',
      inputSchema: { type: z.string().max(100).optional() },
    },
    ({ type }: { type?: string }) => {
      if (type) {
        const wanted = type.toLowerCase();
        const entry = COMPONENT_CATALOG.find((c) => c.type.toLowerCase() === wanted || c.marker === wanted);
        if (!entry) {
          return toolError(
            `Unknown component "${type}" — available: ${COMPONENT_CATALOG.map((c) => `${c.type} (${c.marker})`).join(', ')}.`,
          );
        }
        return ok(entry);
      }
      return ok({ components: COMPONENT_CATALOG });
    },
  );

  // On-demand reference guides — the detailed how-to for a feature area, kept OUT of the core
  // instructions (which only list the topics) so the up-front prompt stays small. Static platform
  // text; no connection or capability needed.
  server.registerTool(
    'get_guide',
    {
      description: `Fetch the full how-to for one feature area, on demand (the core instructions list these topics). topic = one of: ${GUIDE_TOPICS.join(', ')}.`,
      inputSchema: { topic: z.string().max(40) },
    },
    ({ topic }: { topic: string }) => {
      const key = topic.trim().toLowerCase();
      if (!(GUIDE_TOPICS as readonly string[]).includes(key)) {
        return toolError(`Unknown guide "${topic}" — topics: ${GUIDE_TOPICS.join(', ')}.`);
      }
      const guide = AGENT_GUIDES[key as GuideTopic];
      return ok(`# ${guide.title}\n\n${guide.body.trim()}`);
    },
  );

  // The machine-readable authoring REFERENCE for writing a page `source` — the exact vocabulary the
  // engine ships, derived from it (so it can't drift): the {{sw-*}} helpers, the data-sw-* editable
  // directives, the binding namespaces, and the {{#each}} loop variables. Static; no connection needed.
  server.registerTool(
    'get_reference',
    {
      description:
        'The authoring REFERENCE for writing a page `source`: the {{sw-*}} HELPERS, the data-sw-* editable DIRECTIVES, the BINDING namespaces (company / website / page / page.data / pages / dataset / item / nav …), and the {{#each}} LOOP VARIABLES. Derived from the live engine, so it always matches what ships. Optionally pass section = helpers | directives | bindings | loops.',
      inputSchema: { section: z.enum(['helpers', 'directives', 'bindings', 'loops']).optional() },
    },
    ({ section }: { section?: 'helpers' | 'directives' | 'bindings' | 'loops' }) => {
      const all = { helpers: SW_HELPERS, directives: SW_DIRECTIVES, bindings: BINDING_NAMESPACES, loops: LOOP_VARIABLES };
      // eslint-disable-next-line security/detect-object-injection -- `section` is a validated enum key
      return ok(section ? { [section]: all[section] } : all);
    },
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
        'Get one page by id. For code-first pages the design is in the `source` field.',
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
    'list_revisions',
    {
      description:
        "List a content entity's revision history, newest first (id, op, who, when, note). Pair with restore_revision to roll back a bad edit.",
      inputSchema: { kind: GENERIC_KIND, id: z.string() },
    },
    gate('content:read', ({ kind, id }) => client.listRevisions(kind, id)),
  );

  server.registerTool(
    'restore_revision',
    {
      description:
        'Restore a content entity to an earlier revision (its id from list_revisions). Non-destructive: the current version stays in history, and a deleted entity is recreated.',
      inputSchema: { kind: GENERIC_KIND, id: z.string(), revisionId: z.string() },
    },
    gate('content:write', ({ kind, id, revisionId }) => client.restoreRevision(kind, id, revisionId)),
  );

  server.registerTool(
    'preview_page',
    {
      description:
        `Render a (possibly unsaved) page and return screenshots so you can SEE how it looks — check layout, spacing, hierarchy, colour, imagery, and the responsive views, then iterate. Defaults to Full HD + tablet + mobile; pass viewports (any of: ${SCREENSHOT_VIEWPORT_NAMES.join(', ')}) to check specific breakpoints — e.g. all five for a full responsive sweep. Pass includeHtml:true to also get the rendered HTML source. Does not save.`,
      inputSchema: {
        page: PageSchema,
        includeHtml: z.boolean().optional(),
        viewports: z.array(ScreenshotViewportNameSchema).optional(),
      },
    },
    async ({ page, includeHtml, viewports }: { page: unknown; includeHtml?: boolean; viewports?: ScreenshotViewportName[] }): Promise<ToolResult> => {
      if (!holder.scope) {
        return toolError('Not connected. Use the `login` tool, approve in your browser, then retry this action.');
      }
      try {
        const res = await client.preview(page, {
          screenshot: true,
          ...(viewports?.length ? { viewports: viewports.join(',') } : {}),
        });
        const shots = Object.entries(res.screenshots ?? {}).filter(([, s]) => s) as Array<
          [string, NonNullable<PreviewResult['screenshots']>[ScreenshotViewportName]]
        >;
        const content: ContentBlock[] = [];
        if (shots.length > 0) {
          const dims = shots.map(([name, s]) => `${name} ${s!.width}×${s!.height}`).join(', ');
          content.push({
            type: 'text',
            text: `Rendered (${dims}). Look at the screenshot(s) below and judge it like a designer — section rhythm, whitespace, type hierarchy, colour balance, real imagery, and the mobile view — then refine until it reads as flagship-quality.${includeHtml ? '' : ' (Pass includeHtml:true to also get the HTML source.)'}`,
          });
          for (const [, s] of shots) content.push({ type: 'image', data: s!.base64, mimeType: s!.mimeType });
        } else {
          content.push({ type: 'text', text: 'Rendered. Screenshots are unavailable on this server — returning the HTML source so you can check the structure.' });
        }
        if (includeHtml || shots.length === 0) content.push({ type: 'text', text: res.html });
        return { content };
      } catch (err) {
        if (err instanceof SitewrightApiError) return toolError(`Error ${err.status}: ${err.message}`);
        return toolError(`Error: ${err instanceof Error ? err.message : 'preview failed'}`);
      }
    },
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
        provider: StockProviderNameSchema,
        query: z.string().min(1).max(200),
        page: z.number().int().min(1).max(100).optional(),
      },
    },
    gate('content:read', ({ provider, query, page }) => client.stockSearch(provider, query, page ?? 1)),
  );

  server.registerTool(
    'list_media',
    {
      description:
        'List the project’s self-hosted media assets — each with the URL to reference in an <img src> / href, plus kind, dimensions and alt. Optionally filter by kind = image | file | font.',
      inputSchema: { kind: z.enum(['image', 'file', 'font']).optional() },
    },
    gate('content:read', ({ kind }) => client.listMedia(kind)),
  );

  // ---------------------------------------------------------------- writes (content:write)
  // Deletes are gated on `content:delete`, NOT `content:write` — an agent can be allowed to
  // create/update without the irreversible power to remove pages or content.
  server.registerTool(
    'put_page',
    { description: 'Create or replace a page. The page id is taken from page.id.', inputSchema: { page: PageSchema } },
    gate('content:write', ({ page }) => client.putContent('page', page.id, page)),
  );

  server.registerTool(
    'delete_page',
    { description: 'Delete a page by id. Needs the content:delete capability.', inputSchema: { id: z.string() } },
    gate('content:delete', ({ id }) => client.deleteContent('page', id).then(() => ({ deleted: id }))),
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
    {
      description: 'Delete a content entity by kind + id. Needs the content:delete capability.',
      inputSchema: { kind: GENERIC_KIND, id: z.string() },
    },
    gate('content:delete', ({ kind, id }) => client.deleteContent(kind, id).then(() => ({ deleted: `${kind}/${id}` }))),
  );

  server.registerTool(
    'import_stock_image',
    {
      description:
        'Import a stock photo (by provider + id from search_stock_images) into the project. The server downloads, optimizes, and self-hosts it as a media asset with attribution — never a hotlink.',
      inputSchema: {
        provider: StockProviderNameSchema,
        id: z.string().min(1).max(256),
        alt: z.string().max(500).optional(),
      },
    },
    gate('content:write', ({ provider, id, alt }) => client.importStock(provider, id, alt)),
  );

  server.registerTool(
    'import_image',
    {
      description:
        'Import an image into the project from a PUBLIC https URL — the server downloads, optimizes, and self-hosts it (never a hotlink), returning the stored asset (use its `url` in your <img src>). For STOCK photos use search_stock_images + import_stock_image instead.',
      inputSchema: { url: z.string().url().max(2048), folder: z.string().max(1024).optional() },
    },
    gate('content:write', ({ url, folder }) => client.importImageUrl(url, folder)),
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
