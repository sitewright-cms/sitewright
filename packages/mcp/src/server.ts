import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  PageSchema,
  TemplateSchema,
  SnippetSchema,
  PageTranslationSchema,
  DatasetSchema,
  EntrySchema,
  FormSchema,
  LocaleSchema,
  DEFAULT_AGENT_INSTRUCTIONS,
  COMPONENT_CATALOG,
  AGENT_GUIDES,
  buildCapabilitiesIndex,
  GUIDE_TOPICS,
  SW_HELPERS,
  SW_DIRECTIVES,
  BINDING_NAMESPACES,
  LOOP_VARIABLES,
  StockProviderNameSchema,
  LenientScreenshotViewportNameSchema,
  SCREENSHOT_VIEWPORT_NAMES,
  MediaFolderSchema,
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

// --- put_content "teach on error" -------------------------------------------------------------
// `put_content` deliberately takes an untyped `data` (one tool for eight kinds), so a weaker model
// gets no schema hint and guesses the payload shape wrong. When a write fails validation we append a
// COMPACT, derived top-level shape for that kind, so the model can self-correct instead of flailing.

/** Unwrap optional / nullable / default / effects / branded / readonly wrappers to the underlying type
 *  (public zod v3 API). Any wrapper we don't recognise falls through and is labelled `any` — a degraded
 *  but safe hint, never a crash. */
function unwrapZod(s: z.ZodTypeAny): z.ZodTypeAny {
  if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) return unwrapZod(s.unwrap());
  if (s instanceof z.ZodDefault) return unwrapZod(s.removeDefault());
  if (s instanceof z.ZodEffects) return unwrapZod(s.innerType());
  if (s instanceof z.ZodReadonly) return unwrapZod(s.unwrap());
  if (s instanceof z.ZodBranded) return unwrapZod(s.unwrap());
  return s;
}

/** A short type label for one field. `depth` permits ONE level of nesting so array-of-objects and
 *  object fields expose their keys — e.g. a dataset's `fields: array<{ name, label, type }>`, which is
 *  exactly the item shape a weak model gets wrong — while the cap stops a big schema from exploding. */
function zodTypeLabel(s: z.ZodTypeAny, depth = 1): string {
  const b = unwrapZod(s);
  if (b instanceof z.ZodString) return 'string';
  if (b instanceof z.ZodNumber) return 'number';
  if (b instanceof z.ZodBoolean) return 'boolean';
  if (b instanceof z.ZodEnum) return `enum(${(b.options as string[]).join('|')})`;
  if (b instanceof z.ZodLiteral) return JSON.stringify(b.value);
  if (b instanceof z.ZodArray) return `array<${zodTypeLabel(b.element, depth)}>`;
  if (b instanceof z.ZodRecord) return 'object';
  if (b instanceof z.ZodUnion) return 'union';
  if (b instanceof z.ZodObject) return depth > 0 ? describeObject(b, depth - 1) : 'object';
  return 'any';
}

/** Render a ZodObject's fields as `{ key: type, key?: type, … }`, recursing `depth` more levels. */
function describeObject(obj: z.ZodObject<z.ZodRawShape>, depth: number): string {
  const entries = Object.entries(obj.shape as Record<string, z.ZodTypeAny>);
  return `{ ${entries.map(([k, v]) => `${k}${v.isOptional() ? '?' : ''}: ${zodTypeLabel(v, depth)}`).join(', ')} }`;
}

/** The put_content teach-on-error hint: a schema's top-level fields + ONE nested level. '' if the
 *  schema isn't an object (impossible for the writable kinds today; guarded so a regression is visible). */
function describeShape(schema: z.ZodTypeAny): string {
  const base = unwrapZod(schema);
  return base instanceof z.ZodObject ? describeObject(base, 1) : '';
}

/** The expected `data` shape per writable kind, surfaced on a failed put_content so weak models recover.
 *  Derived from the SAME schemas the server validates against, so it can't drift. `settings` is a
 *  composite validated server-side (identity + website + settings); it is also a full-REPLACE write, so
 *  its hint warns to read-modify-write rather than overwrite blindly. */
const KIND_SHAPES = new Map<string, string>([
  ['page', describeShape(PageSchema)],
  ['template', describeShape(TemplateSchema)],
  ['snippet', describeShape(SnippetSchema)],
  ['translation', describeShape(PageTranslationSchema)],
  ['dataset', describeShape(DatasetSchema)],
  ['entry', describeShape(EntrySchema)],
  ['form', describeShape(FormSchema)],
  [
    'settings',
    'the site settings object (identity, website, seo, shop, effects, translations, …). put_content REPLACES the whole object by default, so READ it first with get_content("settings","settings"), modify, and write the WHOLE thing back — OR pass merge:true to PATCH just the fields you send (e.g. { website: { footer: "…" } }) and leave every other slot untouched.',
  ],
]);

/** A JSON object (not an array, not null) we can safely spread. */
function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** put_content kinds that are path-keyed SINGLETONS with no own `id` field — never inject an id into
 *  their body. Today only `settings`; a set (not a `!== 'settings'` literal) so any future singleton
 *  kind added to GENERIC_KIND doesn't silently acquire an injected id. */
const ID_LESS_PUT_KINDS = new Set<string>(['settings']);

/**
 * Make put_content forgiving for weaker models. Two mistakes recur badly enough to stall a whole run:
 *   1. `data` sent as a JSON *string* instead of an object → "Expected object, received string".
 *   2. The schema requires `data.id` (and, for an entry, `data.dataset`) to be present AND to equal
 *      the `id`/`dataset` args — models omit the "redundant" duplicate → endless "id: Required".
 * So we parse a stringified object and copy `id`/`dataset` into `data` when the model left them out.
 * Anything that isn't a JSON object (or a string that isn't parseable JSON) is returned untouched, so
 * the normal validation error — with its teach-on-error shape hint — still surfaces.
 */
export function normalizePutData(kind: string, id: string, dataset: string | undefined, data: unknown): unknown {
  let obj: unknown = data;
  if (typeof obj === 'string') {
    const trimmed = obj.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return data; // not JSON — let validation speak
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return data;
    }
  }
  if (!isPlainRecord(obj)) return obj;
  const patch: Record<string, unknown> = {};
  if (!ID_LESS_PUT_KINDS.has(kind) && (obj.id === undefined || obj.id === '') && id) patch.id = id;
  if (kind === 'entry' && (obj.dataset === undefined || obj.dataset === '') && dataset) patch.dataset = dataset;
  // A dataset ENTRY's status defaults to 'draft' (EntrySchema) — but a draft entry is INVISIBLE in the
  // PUBLISHED build (it only shows in the drafts-included preview), so an agent that omits status silently
  // authors an empty {{#each}} loop that renders fine in preview then vanishes once the site is published.
  // Agents write content meant to go live: default an OMITTED entry status to 'published'. An explicit
  // 'draft' is untouched (the field is present), so intentional staging still works.
  if (kind === 'entry' && obj.status === undefined) patch.status = 'published';
  return Object.keys(patch).length > 0 ? { ...obj, ...patch } : obj;
}

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
        'The authoring contracts of the first-party interactive components (carousel, tabs, lightbox, modal, banner, form): markers, data-sw-part roles, config attributes, and copy-paste markup skeletons. Optionally filter by type or marker.',
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

  // The capability INDEX — one place that maps every platform feature to WHERE it's documented (components,
  // guides, the {{sw-*}} reference, the write shapes) plus a need→tool lookup. Exists so an agent never
  // concludes a primitive is missing by checking only one discovery tool. Static; no connection needed.
  server.registerTool(
    'get_capabilities',
    {
      description:
        "One INDEX of everything this platform can do and WHERE each is documented: the interactive components, the get_guide topics, the {{sw-*}} reference, how each content kind is written, and a need→tool lookup (e.g. \"ripple\" → get_guide effects, \"collections\" → get_guide datasets). Call this before assuming a capability doesn't exist — coverage is spread across get_components / get_reference / get_guide, so checking just one wrongly reads as unsupported.",
    },
    () => ok(buildCapabilitiesIndex()),
  );

  // On-demand reference guides — the detailed how-to for a feature area, kept OUT of the core
  // instructions (which only list the topics) so the up-front prompt stays small. Static platform
  // text; no connection or capability needed.
  server.registerTool(
    'get_guide',
    {
      description: `Fetch the full how-to for one feature area, on demand (the core instructions list these topics). Call with NO topic to get the index. topic = one of: ${GUIDE_TOPICS.join(', ')}.`,
      inputSchema: { topic: z.string().max(40).optional() },
    },
    ({ topic }: { topic?: string }) => {
      // No topic (or a blank one) → hand back the index instead of erroring, so a model that forgot the
      // argument recovers in one step rather than looping on a validation error.
      if (!topic || !topic.trim()) {
        return ok({
          topics: GUIDE_TOPICS,
          guides: GUIDE_TOPICS.map((t) => ({
            topic: t,
            title: AGENT_GUIDES[t as GuideTopic].title,
            summary: AGENT_GUIDES[t as GuideTopic].summary,
          })),
          note: 'Call get_guide again with one of these `topic` values for the full how-to.',
        });
      }
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
    {
      description:
        "List all entities of a content kind. For kind 'entry' pass `dataset` (a dataset slug) to list ONLY that dataset's entries — an entry id is unique only within its dataset, so an unscoped entry list returns EVERY dataset's rows mixed together.",
      inputSchema: { kind: GENERIC_KIND, dataset: z.string().optional() },
    },
    gate(null, ({ kind, dataset }) => client.listContent(kind, dataset)),
  );

  server.registerTool(
    'get_content',
    {
      description:
        'Get one content entity by kind + id. For an ENTRY also pass `dataset` (its owning dataset slug) — an entry id is only unique WITHIN its dataset, so two datasets can share an id.',
      inputSchema: { kind: GENERIC_KIND, id: z.string(), dataset: z.string().optional() },
    },
    gate(null, ({ kind, id, dataset }) => client.getContent(kind, id, dataset)),
  );

  server.registerTool(
    'list_revisions',
    {
      description:
        "List a content entity's revision history, newest first (id, op, who, when, note). Pair with restore_revision to roll back a bad edit. For an ENTRY also pass `dataset` (its owning dataset slug).",
      inputSchema: { kind: GENERIC_KIND, id: z.string(), dataset: z.string().optional() },
    },
    gate('content:read', ({ kind, id, dataset }) => client.listRevisions(kind, id, dataset)),
  );

  server.registerTool(
    'restore_revision',
    {
      description:
        'Restore a content entity to an earlier revision (its id from list_revisions). Non-destructive: the current version stays in history, and a deleted entity is recreated. For an ENTRY also pass `dataset` (its owning slug) — the same one used with list_revisions.',
      inputSchema: { kind: GENERIC_KIND, id: z.string(), revisionId: z.string(), dataset: z.string().optional() },
    },
    gate('content:write', ({ kind, id, revisionId, dataset }) => client.restoreRevision(kind, id, revisionId, dataset)),
  );

  server.registerTool(
    'preview_page',
    {
      description:
        `Render a (possibly unsaved) page and return screenshots so you can SEE how it looks — check layout, spacing, hierarchy, colour, imagery, and the responsive views, then iterate. Defaults to desktop + mobile at reduced resolution (to save tokens — enough to judge layout); pass viewports (any of: ${SCREENSHOT_VIEWPORT_NAMES.join(', ')}; the everyday words "desktop" and "phone" also work) to check specific breakpoints — e.g. all five for a full responsive sweep. Screenshots are token-heavy: preview at milestones, not after every small edit. Pass includeHtml:true to also get the rendered HTML source. Does not save.`,
      inputSchema: {
        page: PageSchema,
        includeHtml: z.boolean().optional(),
        viewports: z.array(LenientScreenshotViewportNameSchema).optional(),
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
    'compare_to_source',
    {
      description:
        `Screenshot an imported page's BUILD and its ORIGINAL source at the same viewports and return them SIDE-BY-SIDE, so you can see exactly how your build differs from the real site and fix it. Use this after authoring an imported page and ITERATE until the build matches the source — never call a page done from your own render alone; the source pair here is the ground truth. The source is the reference captured at import time (fast + stable); pass refresh:true to re-snapshot the live site if it has changed. The page must have an import source. Pass viewports (any of: ${SCREENSHOT_VIEWPORT_NAMES.join(', ')}) to focus breakpoints.`,
      inputSchema: { pageId: z.string(), viewports: z.array(LenientScreenshotViewportNameSchema).optional(), refresh: z.boolean().optional() },
    },
    async ({ pageId, viewports, refresh }: { pageId: string; viewports?: ScreenshotViewportName[]; refresh?: boolean }): Promise<ToolResult> => {
      if (!holder.scope) return toolError('Not connected. Use the `login` tool, approve in your browser, then retry this action.');
      if (!holder.scope.capabilities.includes('content:read')) {
        return toolError(`Your connection to project ${holder.scope.projectId} lacks the “content:read” capability.`);
      }
      try {
        const res = await client.compareToSource(pageId, viewports?.length ? viewports.join(',') : undefined, refresh);
        const names = Object.keys(res.build) as ScreenshotViewportName[];
        const provenance =
          res.sourceFrom === 'live'
            ? 'Source = rendered from the live site just now.'
            : `Source = the reference captured at import time${res.capturedAt ? ` (${new Date(res.capturedAt).toISOString()})` : ''}; if the live site has since changed, pass refresh:true to re-snapshot.`;
        const content: ContentBlock[] = [
          {
            type: 'text',
            text: `BUILD vs SOURCE for page “${pageId}” (original: ${res.sourceUrl}). ${provenance} For EACH viewport below you get YOUR BUILD then the ORIGINAL. Compare them region by region — header, every section/tile, tabs + their inner media, accordion, footer/sub-footer — and match background, borders, colours, type sizes, layout and content. Fix the differences and run this again. Do NOT call the page faithful from your own render; the source here is the ground truth.`,
          },
        ];
        for (const vp of names) {
          const b = res.build[vp];
          const s = res.source[vp];
          if (b) {
            content.push({ type: 'text', text: `— ${vp} · YOUR BUILD (${b.width}×${b.height}) —` });
            content.push({ type: 'image', data: b.base64, mimeType: b.mimeType });
          }
          if (s) {
            content.push({ type: 'text', text: `— ${vp} · ORIGINAL SOURCE (${s.width}×${s.height}) —` });
            content.push({ type: 'image', data: s.base64, mimeType: s.mimeType });
          }
        }
        if (names.length === 0) {
          content.push({ type: 'text', text: 'No screenshots could be captured (no Chromium on this server, or neither the build nor the source rendered).' });
        }
        return { content };
      } catch (err) {
        if (err instanceof SitewrightApiError) return toolError(`Error ${err.status}: ${err.message}`);
        return toolError(`Error: ${err instanceof Error ? err.message : 'compare failed'}`);
      }
    },
  );

  server.registerTool(
    'fidelity_check',
    {
      description:
        "The OBJECTIVE clone-fidelity gate for an imported page: renders your BUILD and the ORIGINAL source, measures computed styles per element + whole-bar chrome facts, and returns a measured PASS/FAIL — body (font/gradient/coverage) and chrome (position/size/style + skew, font-weight, letter-spacing, radius, shadow, fixed-position, ripple, modals). Use this to TERMINATE the nativize loop: a page is faithful ONLY when this returns pass:true — never from your own render or a screenshot. Runs slower than compare_to_source (it renders both sides live); use compare_to_source to SEE differences, this to PROVE they're gone. The page must have an import source.",
      inputSchema: { pageId: z.string() },
    },
    async ({ pageId }: { pageId: string }): Promise<ToolResult> => {
      if (!holder.scope) return toolError('Not connected. Use the `login` tool, approve in your browser, then retry this action.');
      if (!holder.scope.capabilities.includes('content:read')) {
        return toolError(`Your connection to project ${holder.scope.projectId} lacks the “content:read” capability.`);
      }
      try {
        const r = await client.fidelityCheck(pageId);
        const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
        const lines = [
          `FIDELITY ${r.pass ? 'PASS ✓' : 'FAIL ✗'} for page “${pageId}” (original: ${r.sourceUrl}).`,
          `BODY   ${r.body.pass ? 'pass' : 'FAIL'} — coverage ${pct(r.body.coverage)} (${r.body.matched}/${r.body.orig}), fontMiss ${r.body.fontMiss}, gradFail ${r.body.gradFail}, score ${r.body.score.toFixed(2)}`,
          `CHROME ${r.chrome.pass ? 'pass' : 'FAIL'} — coverage ${pct(r.chrome.coverage)} (${r.chrome.matched}/${r.chrome.orig}), pos ${r.chrome.posOff}, size ${r.chrome.sizeOff}, style ${r.chrome.styleOff}, meta ${r.chrome.metaOff}`,
        ];
        if (r.diffs.body.length) lines.push('', 'BODY diffs:', ...r.diffs.body.map((d) => `  ${d}`));
        if (r.diffs.chrome.length) lines.push('', 'CHROME diffs:', ...r.diffs.chrome.map((d) => `  ${d}`));
        if (r.diffs.meta.length) lines.push('', 'CHROME meta (fixed/ripple/modals):', ...r.diffs.meta.map((d) => `  ${d}`));
        if (!r.pass) lines.push('', 'This page is NOT faithful yet — fix the diffs above (port the ORIGINAL’s measured values) and run fidelity_check again. Do not declare it done until pass ✓.');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err) {
        if (err instanceof SitewrightApiError) return toolError(`Error ${err.status}: ${err.message}`);
        return toolError(`Error: ${err instanceof Error ? err.message : 'fidelity check failed'}`);
      }
    },
  );

  server.registerTool(
    'clone_audit',
    {
      description:
        "The OBJECTIVE clone-acceptance prerequisite — the facts a screenshot can't show and computed-style coverage can't game. fidelity_check only measures computed styles, so it passes a clone whose datasets are duplicated, whose modals were dropped, whose slider is dead, whose fonts don't actually load, or whose mobile menu is missing. clone_audit runs the STRUCTURE + BEHAVIOUR legs and returns PASS/FAIL: STRUCTURE (datasets deduped + named, media out of the imported/ tree, page content editable via data-sw-*), BEHAVIOUR (a live render: sliders enhance, modals present, heading+body fonts actually LOAD, mobile menu reachable at phone width). Its VISUAL leg (body + chrome computed-style) is ADVISORY — reported to steer you (compare_regions), NEVER gated: coverage is blind to casing/dividers/icon-style/sub-band-colour/section-height/repeated-item-count. Passing this is NECESSARY but NOT SUFFICIENT: a page is DONE only when clone_audit passes AND your visual_audit region-by-region side-by-side vs the live original is at zero blocker+major. Slower than fidelity_check (extra live renders). The page must have an import source.",
      inputSchema: { pageId: z.string() },
    },
    async ({ pageId }: { pageId: string }): Promise<ToolResult> => {
      if (!holder.scope) return toolError('Not connected. Use the `login` tool, approve in your browser, then retry this action.');
      if (!holder.scope.capabilities.includes('content:read')) {
        return toolError(`Your connection to project ${holder.scope.projectId} lacks the “content:read” capability.`);
      }
      try {
        const r = await client.cloneAudit(pageId);
        const legName: Record<string, string> = { structure: 'STRUCTURE', behaviour: 'BEHAVIOUR', visual: 'VISUAL' };
        const lines = [`CLONE AUDIT ${r.pass ? 'PASS ✓' : 'FAIL ✗'} — ${r.passed}/${r.total} gating checks for page “${pageId}” (original: ${r.sourceUrl}).`];
        for (const leg of ['structure', 'behaviour', 'visual'] as const) {
          lines.push('', `[${legName[leg]}]`);
          for (const c of r.checks.filter((x) => x.leg === leg)) {
            const status = c.advisory ? (c.pass ? 'ok (advisory)' : 'advisory') : c.pass ? 'pass' : 'FAIL';
            lines.push(`  ${status}  ${c.label}${c.pass && !c.advisory ? '' : ` — ${c.detail}`}`);
          }
        }
        if (!r.pass) lines.push('', 'This clone is NOT done. Fix every FAIL above (compare_regions / compare_to_source to SEE the visual ones; get_guide("import") for how), then run clone_audit again. Do not declare it done until pass ✓.');
        else lines.push('', 'Objective gate (structure + behaviour) passes ✓ — but this is NECESSARY, NOT SUFFICIENT. The page is DONE only when your visual_audit region-by-region side-by-side vs the live original is ALSO at zero blocker+major. The "advisory" computed-style lines (body/chrome) are blind to casing/dividers/icon-style/section-height — do NOT treat them as the done signal; judge the pixels in visual_audit.');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err) {
        if (err instanceof SitewrightApiError) return toolError(`Error ${err.status}: ${err.message}`);
        return toolError(`Error: ${err instanceof Error ? err.message : 'clone audit failed'}`);
      }
    },
  );

  server.registerTool(
    'pagespeed_audit',
    {
      description:
        "Lighthouse PAGE-SPEED + SEO audit of a page, run against a DEPLOY-EQUIVALENT build (minified like Publish, with production cache headers — not the sandboxed draft preview). Returns four category scores 0–100 (performance, accessibility, best-practices, seo), core lab metrics (FCP / LCP / TBT / CLS / Speed Index), and a ranked list of the specific, actionable failing audits (e.g. render-blocking requests, unused/unminified JavaScript, images without dimensions, low-contrast text, non-sequential headings, a missing meta description). Lab-only — no real-user CrUX field data; the performance score is a throttled lab run (directional), while SEO / accessibility / best-practices are deterministic. Use it to check a page before publishing and to get a concrete fix list. `formFactor` defaults to mobile; pass 'desktop' for the desktop profile.",
      inputSchema: { pageId: z.string(), formFactor: z.enum(['mobile', 'desktop']).optional() },
    },
    async ({ pageId, formFactor }: { pageId: string; formFactor?: 'mobile' | 'desktop' }): Promise<ToolResult> => {
      if (!holder.scope) return toolError('Not connected. Use the `login` tool, approve in your browser, then retry this action.');
      if (!holder.scope.capabilities.includes('content:read')) {
        return toolError(`Your connection to project ${holder.scope.projectId} lacks the “content:read” capability.`);
      }
      try {
        const r = await client.pagespeedAudit(pageId, formFactor);
        const pct = (n: number | null): string => (n === null ? '—' : String(n));
        const ms = (n?: number): string => (n === undefined ? '—' : `${Math.round(n)} ms`);
        const lines = [
          `PAGE-SPEED + SEO AUDIT — page “${pageId}” · ${r.formFactor} · Lighthouse ${r.lighthouseVersion}`,
          '',
          `  Performance    ${pct(r.scores.performance)}`,
          `  Accessibility  ${pct(r.scores.accessibility)}`,
          `  Best Practices ${pct(r.scores.bestPractices)}`,
          `  SEO            ${pct(r.scores.seo)}`,
          '',
          `  Metrics: FCP ${ms(r.metrics.firstContentfulPaintMs)} · LCP ${ms(r.metrics.largestContentfulPaintMs)} · TBT ${ms(r.metrics.totalBlockingTimeMs)} · CLS ${(r.metrics.cumulativeLayoutShift ?? 0).toFixed(3)} · Speed Index ${ms(r.metrics.speedIndexMs)}`,
        ];
        if (r.findings.length === 0) {
          lines.push('', 'No failing audits — every scored check passed. ✓');
        } else {
          lines.push('', `Actionable findings (${r.findings.length}), worst first:`);
          for (const f of r.findings) {
            lines.push(`  [${f.category}] ${f.title}${f.displayValue ? ` — ${f.displayValue}` : ''}`);
          }
        }
        lines.push('', 'Note: performance is a throttled LAB score (directional); SEO / accessibility / best-practices are deterministic. No real-user field data.');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err) {
        if (err instanceof SitewrightApiError) return toolError(`Error ${err.status}: ${err.message}`);
        return toolError(`Error: ${err instanceof Error ? err.message : 'pagespeed audit failed'}`);
      }
    },
  );

  server.registerTool(
    'visual_audit',
    {
      description:
        "The VISUAL acceptance gate for a cloned/imported page — the reliable fidelity signal the computed-style scorers (fidelity_check / clone_audit's visual leg) miss (they score fonts/gradients/coverage of TEXT elements and are BLIND to layout, images, section design, and modals; a hollow page scores green). It renders your CLONE and the LIVE original full-page (desktop + mobile) and returns them SIDE-BY-SIDE plus a defect RUBRIC. YOU (this model) judge the pixels against the rubric — the platform runs NO AI, so it works whether or not the project has an AI provider. For every region (header, hero, each section, footer) tag divergences by category (layout|spacing|typography|color|image|component|content|chrome|responsive) and severity (blocker|major|minor); the page is faithful only when there are ZERO blocker + major. It SEES what measurements can't: real rendered fonts (getComputedStyle returns the requested name even when the file never loaded), real images, and layout. Run it as the FINAL visual check on every cloned page and fix every blocker/major before declaring it done — never from your own render alone. The page must have an import source.",
      inputSchema: { pageId: z.string() },
    },
    async ({ pageId }: { pageId: string }): Promise<ToolResult> => {
      if (!holder.scope) return toolError('Not connected. Use the `login` tool, approve in your browser, then retry this action.');
      if (!holder.scope.capabilities.includes('content:read')) {
        return toolError(`Your connection to project ${holder.scope.projectId} lacks the “content:read” capability.`);
      }
      try {
        const r = await client.visualAudit(pageId);
        const names = Object.keys(r.source).length ? Object.keys(r.source) : Object.keys(r.build);
        const content: ContentBlock[] = [
          { type: 'text', text: `VISUAL AUDIT — page “${pageId}” vs the live original (${r.sourceUrl}).\n\n${r.rubric}\n\nBelow, for each viewport: the ORIGINAL then your CLONE.` },
        ];
        for (const vp of names as Array<keyof typeof r.source>) {
          const s = r.source[vp];
          const b = r.build[vp];
          if (s) {
            content.push({ type: 'text', text: `— ${String(vp)} · ORIGINAL (${s.width}×${s.height}) —` });
            content.push({ type: 'image', data: s.base64, mimeType: s.mimeType });
          }
          if (b) {
            content.push({ type: 'text', text: `— ${String(vp)} · YOUR CLONE (${b.width}×${b.height}) —` });
            content.push({ type: 'image', data: b.base64, mimeType: b.mimeType });
          }
        }
        if (names.length === 0) content.push({ type: 'text', text: 'No screenshots could be captured (no Chromium on this server, or neither side rendered).' });
        else content.push({ type: 'text', text: 'Now list every blocker + major defect you see, fix them (put_page), and run visual_audit again until there are none.' });
        return { content };
      } catch (err) {
        if (err instanceof SitewrightApiError) return toolError(`Error ${err.status}: ${err.message}`);
        return toolError(`Error: ${err instanceof Error ? err.message : 'visual audit failed'}`);
      }
    },
  );

  server.registerTool(
    'compare_regions',
    {
      description:
        "HIGH-RESOLUTION visual compare of an imported page's chrome: crops the nav HEADER and FOOTER (or pass regions to limit) of your BUILD and the ORIGINAL, at 2× device scale as lossless WebP, and returns them build-then-original per region. Use it to SEE fine detail that compare_to_source's 1× full-page image smears — gradient stops, skew angles, thin shadows, icon weight, letter-spacing. Pair with fidelity_check (which gives the measured numbers): compare_regions to see WHAT's off, fidelity_check to PROVE it's fixed. The page must have an import source.",
      inputSchema: { pageId: z.string(), regions: z.array(z.enum(['header', 'footer'])).optional() },
    },
    async ({ pageId, regions }: { pageId: string; regions?: Array<'header' | 'footer'> }): Promise<ToolResult> => {
      if (!holder.scope) return toolError('Not connected. Use the `login` tool, approve in your browser, then retry this action.');
      if (!holder.scope.capabilities.includes('content:read')) {
        return toolError(`Your connection to project ${holder.scope.projectId} lacks the “content:read” capability.`);
      }
      try {
        const r = await client.compareRegions(pageId, regions?.length ? regions.join(',') : undefined);
        const content: ContentBlock[] = [{ type: 'text', text: `HIGH-RES chrome compare for page “${pageId}” (original: ${r.sourceUrl}). For each region you get YOUR BUILD then the ORIGINAL at 2× — compare skew angle, gradient (solid vs graded), font weight + letter-spacing, shadow, icon size, spacing. Fix what differs, then run fidelity_check to prove it.` }];
        for (const [name, pair] of Object.entries(r.regions)) {
          if (pair.build) { content.push({ type: 'text', text: `— ${name.toUpperCase()} · YOUR BUILD (${pair.build.width}×${pair.build.height}) —` }); content.push({ type: 'image', data: pair.build.base64, mimeType: pair.build.mimeType }); }
          if (pair.source) { content.push({ type: 'text', text: `— ${name.toUpperCase()} · ORIGINAL (${pair.source.width}×${pair.source.height}) —` }); content.push({ type: 'image', data: pair.source.base64, mimeType: pair.source.mimeType }); }
        }
        if (content.length === 1) content.push({ type: 'text', text: 'No region crops could be captured (no Chromium on this server, or the regions were not found on the page).' });
        return { content };
      } catch (err) {
        if (err instanceof SitewrightApiError) return toolError(`Error ${err.status}: ${err.message}`);
        return toolError(`Error: ${err instanceof Error ? err.message : 'compare regions failed'}`);
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

  server.registerTool(
    'list_media_folders',
    {
      description:
        'List the project’s media FOLDERS (virtual grouping labels — slash-delimited paths, "" = root). Call before organizing assets so you reuse existing folders instead of creating duplicates.',
    },
    gate('content:read', () => client.listMediaFolders()),
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
      description:
        'Create or replace a content entity of the given kind. Args: { kind, id, data } — plus `dataset` (the owning dataset slug) when kind is "entry". For PAGES prefer put_page (fully typed). `data` must match that kind’s schema; you may OMIT `data.id` (and an entry’s `data.dataset`) — they are copied from the `id` / `dataset` args for you. On a mismatch the error names the wrong field AND the expected shape, so read it and retry. To learn a kind’s shape up front, call get_content on an existing entity of that kind, or get_guide. For SETTINGS, pass `merge:true` to PATCH just the fields you send (e.g. only `website.footer`) without resending the whole object — safer than a full replace, which reverts any slot your snapshot missed.',
      inputSchema: {
        kind: GENERIC_KIND,
        id: z.string(),
        dataset: z.string().optional(),
        data: z.unknown(),
        merge: z.boolean().optional().describe('SETTINGS only: deep-merge `data` into the existing settings (patch just the fields you pass) instead of replacing the whole object.'),
      },
    },
    gate('content:write', async ({ kind, id, dataset, data, merge }) => {
      // Weak-model forgiveness: parse a stringified `data` and backfill the id/dataset the schema
      // demands but models routinely omit (see normalizePutData). Keeps a clean payload untouched.
      const normalized = normalizePutData(kind, id, dataset, data);
      try {
        return await client.putContent(kind, id, normalized, { merge });
      } catch (err) {
        // Teach on failure: append the expected top-level shape for this kind so a model that guessed
        // the payload wrong can self-correct next turn instead of looping on the same validation error.
        const hint = KIND_SHAPES.get(kind);
        if (hint !== undefined && hint !== '' && err instanceof SitewrightApiError && err.status === 400) {
          throw new SitewrightApiError(err.status, `${err.message}\nExpected \`data\` shape for kind "${kind}": ${hint}`);
        }
        throw err;
      }
    }),
  );

  server.registerTool(
    'delete_content',
    {
      description:
        'Delete a content entity by kind + id. For an ENTRY also pass `dataset` (its owning dataset slug). Needs the content:delete capability.',
      inputSchema: { kind: GENERIC_KIND, id: z.string(), dataset: z.string().optional() },
    },
    gate('content:delete', ({ kind, id, dataset }) => client.deleteContent(kind, id, dataset).then(() => ({ deleted: `${kind}/${id}` }))),
  );

  server.registerTool(
    'add_language',
    {
      description:
        'Add a translation-target LANGUAGE to the site — the ONLY correct way to do so. In ONE atomic step it registers the locale AND scaffolds an inherited translated page for EVERY existing page (the /<locale>/… subtree; each variant inherits the main language\'s code, so you then only fill in its translated `data`/title). Do NOT add a language by editing settings.locales via put_content — that registers the locale with NO pages. `locale` is a BCP-47 code, e.g. "de" or "pt-BR".',
      inputSchema: { locale: LocaleSchema },
    },
    gate('content:write', ({ locale }) => client.addLocale(locale)),
  );

  server.registerTool(
    'remove_language',
    {
      description:
        'Remove a translation-target language: drops the locale from settings AND cascade-deletes every page in that language\'s /<locale>/… subtree (and prunes its translation-catalog column). The default (main) language cannot be removed. Needs the content:delete capability.',
      inputSchema: { locale: LocaleSchema },
    },
    gate('content:delete', ({ locale }) => client.removeLocale(locale)),
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

  // Media organization — give the agent control over the per-page folder structure (a gallery in
  // its own folder, one-per-page heroes under "Header Images", loose singletons under "Main", …).
  server.registerTool(
    'create_media_folder',
    {
      description:
        'Create an (empty) media folder + any missing ancestors. `path` is a slash-delimited grouping label (segments: letters, digits, space, _ or -), e.g. "About/Gallery". Folders are virtual labels; the file bytes stay where they are.',
      inputSchema: { path: MediaFolderSchema },
    },
    gate('content:write', ({ path }) => client.createMediaFolder(path)),
  );

  server.registerTool(
    'rename_media_folder',
    {
      description:
        'Rename OR move a media folder: re-roots the folder subtree AND re-files every asset under it. `from`/`to` are full folder paths. Fails if `to` already exists.',
      inputSchema: { from: MediaFolderSchema, to: MediaFolderSchema },
    },
    gate('content:write', ({ from, to }) => client.renameMediaFolder(from, to)),
  );

  server.registerTool(
    'move_media',
    {
      description:
        'Move and/or rename a single media asset: `folder` re-files it (use list_media_folders / create_media_folder), `filename` sets its display name. Pass at least one. The asset URL is unchanged.',
      inputSchema: {
        id: z.string(),
        folder: MediaFolderSchema.optional(),
        filename: z.string().min(1).max(255).optional(),
      },
    },
    gate('content:write', ({ id, folder, filename }) => {
      if (folder === undefined && filename === undefined) {
        throw new Error('move_media needs at least one of `folder` or `filename`.');
      }
      return client.updateMedia(id, {
        ...(folder !== undefined ? { folder } : {}),
        ...(filename !== undefined ? { filename } : {}),
      });
    }),
  );

  server.registerTool(
    'delete_media',
    {
      description:
        'Delete a single media asset — it moves to the File Manager Recycle Bin (RECOVERABLE for 90 days, then auto-purged). It is hidden from the media list and EXCLUDED from the next publish (a still-referenced page would then show a broken image on the republished site), so make sure NO page/dataset still references it first (prefer moving an asset to an "Unused" folder if unsure). Use to prune orphaned imported files. Needs the `content:delete` capability (opt-in, not implied by content:write) — if your connection lacks it, ask the user to grant it or remove the asset in the editor.',
      inputSchema: { id: z.string() },
    },
    gate('content:delete', ({ id }) => client.deleteMedia(id)),
  );

  server.registerTool(
    'rename_dataset',
    {
      description:
        "Rename a dataset's slug AND/OR its display name. The slug must be an UNDERSCORE identifier (e.g. `faq_passengers`, NOT `faq-passengers` — it is used as a `dataset.<slug>` Handlebars path). This CASCADES automatically: every entry's `dataset` field and every page/template source's `{{#each dataset.<slug>}}` / `dataset=\"<slug>\"` reference (and any other dataset's reference-field target) is rewritten in one transaction — so nothing breaks. Pass the dataset's ID (not its current slug), the new slug, and (recommended) a human `name` so it doesn't stay the import's generic 'List'/'List 2'. Returns how many entries/pages were updated.",
      inputSchema: { id: z.string(), slug: z.string().min(1).max(120), name: z.string().min(1).max(200).optional() },
    },
    gate('content:write', ({ id, slug, name }) => client.renameDataset(id, slug, name, true)),
  );

  // ---------------------------------------------------------------- publish (publish)
  // NB: `deploy` is intentionally NOT exposed as a tool — pushing to a customer's external webspace
  // (FTP/SFTP credentials) from an autonomous agent is out of scope; deploy stays human-driven.
  server.registerTool(
    'publish_project',
    { description: 'Build the project’s static site from current saved content.' },
    gate('publish', () => client.publish()),
  );

  // A PRE-DEFINED clone workflow, surfaced to the client as an invokable prompt (a slash-command in
  // Claude Code, a prompt in the picker elsewhere) — so a human doesn't paste a long brief and EVERY MCP
  // agent runs the same steps. Self-contained: it drives the deterministic gates (visual_audit that the
  // agent JUDGES + clone_audit), never the agent's own optimistic "looks done".
  server.registerPrompt(
    'clone_site',
    {
      title: 'Clone the imported website',
      description: 'Nativize every imported page into a faithful native Sitewright site (the full clone workflow — no server AI needed; you judge the visual side-by-sides yourself).',
    },
    () => ({ messages: [{ role: 'user', content: { type: 'text', text: CLONE_SITE_WORKFLOW } }] }),
  );

  return server;
}

/** The canonical clone workflow — the pre-defined `clone_site` prompt body. Kept self-contained so any
 *  MCP client (or a human) can run the exact same steps without a hand-written brief. */
export const CLONE_SITE_WORKFLOW = `Clone this imported website into faithful, native Sitewright pages.

1. Call list_pages. Every page whose data carries \`swImport\` is an imported RAW scaffold (foreign Materialize/Bootstrap/FontAwesome markup) that must be rebuilt in native primitives. Read the full rules ONCE: get_guide("import").
2. Work ONE page at a time, home first, so theme tokens / datasets / chrome carry across the site. For each imported page:
   a. compare_to_source(pageId) — SEE the original vs your current build.
   b. Author the body with REAL platform primitives first (get_components / get_reference / widgets / website.effects); only hand-write HTML when nothing fits. Tailwind utilities for layout, correct per-element fonts via CSS vars, {{#each dataset.x}} for repeated lists (named datasets, not "items"), real <dialog data-sw-component="modal"> for modals, a working mobile drawer, and data-sw-* / {{sw-control}} so text stays editable. Do NOT leave the imported foreign markup.
   c. put_page the native source.
   d. visual_audit(pageId) — THE visual terminator. It returns your CLONE vs the LIVE original SIDE-BY-SIDE (desktop + mobile) plus a defect rubric (no server AI — your own vision is the judge). WRITE OUT an explicit region-by-region difference list — header, hero, EACH body section, footer — tagging every divergence category (layout|spacing|typography|color|image|component|content|chrome|responsive) + severity (blocker|major|minor). Do NOT write "looks close" — ENUMERATE. Then FIX every blocker + major: wrong/missing images, wrong layout, a wrong REPEATED-ITEM COUNT (render what the original shows — e.g. one featured item, not all rows), wrong letter-CASING, missing DIVIDER rules, PLAIN-vs-BADGED icons, wrong section HEIGHT/COLOUR, dead components, wrong fonts.
   e. clone_audit(pageId) — the OBJECTIVE prerequisite: fix every STRUCTURE/BEHAVIOUR failure it reports (datasets deduped + named, media out of the imported/ tree, sliders enhance, modals present, fonts actually load, mobile menu reachable at phone width, content editable). Its computed-style number is ADVISORY — do NOT chase it: coverage is blind to casing/dividers/icon-style/section-height, so a green number with visible differences is STILL a fail.
   f. Repeat d–e until your written visual_audit region list reaches ZERO blocker + major AND clone_audit passes. Only THEN set page.data.swImport.rewritten:true and status "published".
3. When every page passes, publish_project.

Never declare a page done from your own render, a screenshot, or a coverage number — judge it against the visual_audit side-by-sides, region by region, to zero blocker+major. If a page is huge, edit it section by section.`;
