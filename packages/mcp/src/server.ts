import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  PageSchema,
  IdSchema,
  PagePatchSchema,
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
  sectionGuide,
  resolveSection,
  buildCapabilitiesIndex,
  GUIDE_TOPICS,
  SW_HELPERS,
  SW_DIRECTIVES,
  BINDING_NAMESPACES,
  LOOP_VARIABLES,
  StockProviderNameSchema,
  StockSearchProviderSchema,
  LenientScreenshotViewportNameSchema,
  SCREENSHOT_VIEWPORT_NAMES,
  MediaFolderSchema,
  type GuideTopic,
  type ScreenshotViewportName,
} from '@sitewright/schema';
import { searchIcons, searchTextures, textureCss } from '@sitewright/blocks';
import { SitewrightApiError, MCP_INLINE_UPLOAD_MAX_BYTES, MCP_INLINE_UPLOAD_MAX_B64_CHARS, type Capability, type SitewrightClient, type PreviewResult, type CloneRunResult, type ImportWebsiteResult, type ImportJobView } from './client.js';
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
  'imagemap',
]);

// --- put_content "teach on error" -------------------------------------------------------------
// `put_content` deliberately takes an untyped `data` (one tool for eight kinds), so a weaker model
// gets no schema hint and guesses the payload shape wrong. When a write fails validation we append a
// COMPACT, derived top-level shape for that kind, so the model can self-correct instead of flailing.

/** Unwrap optional / nullable / default / prefault / readonly / transform wrappers to the underlying
 *  type (public zod v4 API). Any wrapper we don't recognise falls through and is labelled `any` — a
 *  degraded but safe hint, never a crash.
 *
 *  Two zod 3 branches are GONE rather than renamed, which is easy to mistake for something lost:
 *  `.refine()` and `.brand()` no longer wrap at all in zod 4 — a refined/branded string reports
 *  `def.type === 'string'` directly, so there is nothing left to unwrap. `ZodEffects` and
 *  `ZodBranded` do not exist. `.transform()` now produces a `ZodPipe`, whose INPUT side is the shape
 *  a caller has to supply — which is what these hints describe — so that is the side we follow.
 *  `removeDefault()` became `unwrap()`. */
function unwrapZod(s: z.ZodTypeAny): z.ZodTypeAny {
  // zod 4's `unwrap()` is typed as returning the CORE `$ZodType`, not the classic `ZodType` this
  // module works in, so each hop needs the narrowing cast. Same value at runtime.
  const inner = (v: unknown): z.ZodTypeAny => v as z.ZodTypeAny;
  if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) return unwrapZod(inner(s.unwrap()));
  if (s instanceof z.ZodDefault || s instanceof z.ZodPrefault) return unwrapZod(inner(s.unwrap()));
  if (s instanceof z.ZodReadonly) return unwrapZod(inner(s.unwrap()));
  if (s instanceof z.ZodPipe) {
    // A pipe is two different shapes depending on how it was built, and these hints describe what a
    // CALLER has to send:
    //   `.transform()` / `z.preprocess()` → the IN side is the real input shape.
    //   `guard.pipe(schema)`              → the IN side is a bare validator (`z.any()`), and the
    //                                       real shape is the OUT side. `safeRecord` is built this
    //                                       way, so following IN blindly labelled every record field
    //                                       `any` instead of `object`.
    // Follow IN unless it carries no information, then fall back to OUT.
    const from = inner(s.def.in);
    const uninformative = from instanceof z.ZodAny || from instanceof z.ZodUnknown;
    return unwrapZod(uninformative ? inner(s.def.out) : from);
  }
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
  // `element` is typed as the core `$ZodType` in zod 4, same narrowing as in `unwrapZod`.
  if (b instanceof z.ZodArray) return `array<${zodTypeLabel(b.element as z.ZodTypeAny, depth)}>`;
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

/** Render the website-import report as a readable next-step summary (the `import_website` tool result). */
function summarizeImport(r: ImportWebsiteResult): string {
  // The async start: a job id, not a result. Say so plainly, or a model reads "ok:true" as "finished"
  // and starts nativizing pages that do not exist yet.
  if (typeof r.jobId === 'string') {
    return [
      `IMPORT STARTED (job ${r.jobId}) — it is running in the background and takes MINUTES on a real site.`,
      `Poll import_status({ jobId: "${r.jobId}" }) every ~30s until status is "done" (or "failed"). Do NOT re-run import_website — a second import of the same URL would duplicate the work.`,
      'When it is done, its report tells you what landed; then read get_guide("import") once and nativize.',
    ].join('\n');
  }
  const warnings = Array.isArray(r.warnings) ? r.warnings : [];
  // State the MODE up front. Foundation (the default) puts a GENERIC platform nav/footer in the chrome
  // slots — it does NOT carry the source's header over — and the guide's "start from the default nav"
  // advice is written for the other path. An agent that had to infer this called it the single most
  // expensive misdirection in its run.
  const scaffolded = warnings.some((w) => typeof w === 'string' && w.includes('foundation mode replaces it'));
  return [
    `WEBSITE IMPORTED ✓ — ${r.pagesImported ?? 0} page(s) imported (${r.mediaSelfHosted ?? 0} media asset(s) self-hosted).`,
    scaffolded
      ? 'CHROME: the slots hold a GENERIC platform nav + footer, NOT the original\'s. Author website.mainNav/footer from the source yourself.'
      : '',
    'These are RAW imported scaffolds (each page carries `data.swImport`). NOW NATIVIZE them: read get_guide("import") once, then rebuild each page with native primitives, judging against visual_audit region-by-region, and publish_project when clone_audit + visual_audit pass. Do NOT ask the user to paste HTML — the import already captured the live page.',
    warnings.length ? `Importer notes (${warnings.length}): ${warnings.slice(0, 8).join(' | ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Render an async import job's state for the poller. */
function summarizeImportJob(j: ImportJobView): string {
  if (j.status === 'running') {
    const last = j.progress.at(-1);
    // Elapsed used to be Math.round(ms/60_000), so it read "1m" for everything between 30s and 90s
    // and looked FROZEN — an agent reported five consecutive polls all showing the same figure while
    // real minutes passed, and stopped trusting the tool. Show seconds until a minute has actually
    // passed, then m+s.
    const secs = Math.max(0, Math.round((Date.now() - j.startedAt) / 1000));
    const elapsed = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
    const seen = j.progressCount ?? j.progress.length;
    return (
      `IMPORT RUNNING (${elapsed} elapsed, ${seen} progress line${seen === 1 ? '' : 's'})${last ? ` — ${last}` : ''}. ` +
      `Call import_status again with waitMs:30000 and since:${seen} — that BLOCKS until it actually moves ` +
      'instead of returning the same line, so do NOT poll in a loop and do NOT start a second import.'
    );
  }
  if (j.status === 'failed') return `IMPORT FAILED — ${j.error ?? 'unknown error'}. Check the URL, then you may retry import_website.`;
  return summarizeImport({ ok: true, ...(j.report ?? {}) } as ImportWebsiteResult);
}

/** Render the autonomous clone run's verdict as a readable per-page summary (the `ai_clone` tool result). */
function summarizeCloneRun(r: CloneRunResult): string {
  const lines = [
    `AI CLONE ${r.ok ? 'COMPLETE ✓' : 'FINISHED ✗'} — ${r.passed}/${r.total} imported pages passed the acceptance gate (model: ${r.model}).`,
    '',
  ];
  for (const p of r.pages) {
    lines.push(`  ${p.passed ? '✓' : '✗'}  ${p.label} (page ${p.pageId}) — ${p.passed ? 'passed' : 'NOT passed'} in ${p.rounds} round(s)`);
  }
  lines.push(
    '',
    r.ok
      ? 'Every imported page passed and the site was published.'
      : 'Some pages did not reach the gate within their round budget — re-run ai_clone, or open each failing page and drive its remaining defects to zero with visual_audit + clone_audit.',
  );
  return lines.join('\n');
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

  // Find icon names for {{sw-icon "name"}}. Static (no connection needed). Accepts MULTIPLE terms at once
  // (comma- OR whitespace-separated) → one match group per term. Searches Phosphor names, the Lucide→
  // Phosphor aliases, and Lucide keyword tags, so a familiar term ("settings", "cog", "trash") finds the
  // right Phosphor icon. Returns native Phosphor names — use them as {{sw-icon "name"}} (fill by default;
  // add ":bold"/":duotone"/etc. for a weight).
  server.registerTool(
    'search_icons',
    {
      description:
        'Find icon names for {{sw-icon "name"}} (Phosphor, filled by default; add a ":weight" suffix like ":bold" or ":duotone"). Pass ONE OR MORE search terms, comma- or whitespace-separated (e.g. "settings, trash cart") — returns matching Phosphor names per term. Searches names, Lucide-name aliases, and keyword synonyms.',
      inputSchema: { query: z.string().min(1).max(200), limit: z.number().int().min(1).max(48).optional() },
    },
    ({ query, limit }: { query: string; limit?: number }) => {
      const results = searchIcons(query, limit ?? 24);
      if (!results.length) return toolError('Provide one or more search terms (comma- or whitespace-separated).');
      return ok({ results });
    },
  );

  // Find transparent background TEXTURES (tileable PNG overlays, e.g. paper, fabric, noise, denim). Static
  // (no connection needed). Each match carries ready-to-paste CSS: the colour comes from `background-color`
  // (a var(--sw-color-*) CI token), so one texture works over any brand colour; the url auto-resolves in the
  // editor previews AND exported sites. Apply the CSS on any element's `style`, a page `<style>`, or
  // website.criticalCss.
  server.registerTool(
    'search_textures',
    {
      description:
        'Find transparent background TEXTURES (tileable PNG overlays — paper, fabric, noise, denim, grid…) to set as an element background. Pass ONE OR MORE terms, comma- or whitespace-separated (e.g. "paper, fabric denim") — returns matching texture names per term, each with ready-to-paste CSS. The colour comes from `background-color` (a var(--sw-color-*) CI token), so one texture works over any brand colour; the url resolves in preview AND exported sites. Drop the CSS on an element `style`, a page `<style>`, or website.criticalCss.',
      inputSchema: { query: z.string().min(1).max(200), limit: z.number().int().min(1).max(48).optional() },
    },
    ({ query, limit }: { query: string; limit?: number }) => {
      const results = searchTextures(query, limit ?? 24).map((g) => ({
        term: g.term,
        matches: g.matches.map((name) => ({ name, css: textureCss(name) })),
      }));
      if (!results.length) return toolError('Provide one or more search terms (comma- or whitespace-separated).');
      return ok({ results });
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
      description: `Fetch the full how-to for one feature area, on demand (the core instructions list these topics). Call with NO topic to get the index. topic = one of: ${GUIDE_TOPICS.join(', ')}. A LONG guide is split into sections: calling it plain returns the overview plus a section index, and you then re-call with section = one of those keys (or section "all" for the whole thing).`,
      inputSchema: { topic: z.string().max(40).optional(), section: z.string().max(40).optional() },
    },
    ({ topic, section }: { topic?: string; section?: string }) => {
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
      const head = `# ${guide.title}`;

      // A short guide is served whole — a second round-trip costs more than the bytes it saves.
      const sections = sectionGuide(key, guide.body);
      if (sections.length === 0) return ok(`${head}\n\n${guide.body.trim()}`);

      const want = resolveSection(sections, section);
      if (want.unknown) {
        return toolError(
          `Unknown section "${want.unknown}" of guide "${key}" — sections: ${sections
            .map((s) => s.key)
            .join(', ')}, or "all" for the whole guide.`,
        );
      }
      if (want.all) return ok(`${head}\n\n${guide.body.trim()}`);
      if (want.match) {
        return ok(`${head} — section "${want.match.key}"\n\n${want.match.blocks.join('\n\n')}`);
      }

      // No section asked for: the overview, plus what else is available and how big it is. The index
      // is part of the RESPONSE rather than the tool description because it is derived from the body.
      const overview = sections[0];
      const index = sections
        .slice(1)
        .map((s) => `  - ${s.key} (~${Math.round(s.chars / 100) / 10}k chars) — ${s.summary}`)
        .join('\n');
      return ok(
        `${head}\n\n${overview?.blocks.join('\n\n') ?? ''}\n\n` +
          `── THIS GUIDE CONTINUES. The above is the overview; the detail is in these sections, ` +
          `fetched one at a time with get_guide({ topic: "${key}", section: "…" }):\n${index}\n` +
          `  - all (~${Math.round(guide.body.length / 100) / 10}k chars) — every section at once.\n` +
          `Read the section for the step you are on. Porting a page start-to-finish uses all of them.`,
      );
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
    {
      description:
        'List the project’s pages. Returns METADATA only by default (id/path/title/status/nav/parent/order/template/…): a page’s Handlebars `source` and `data` store are omitted and described under `_summary` instead, because a full listing of a real site runs to hundreds of KB and blows the tool-output limit. Call get_page for the body of the ONE page you need. Pass includeSource:true only if you genuinely need every page’s code at once (it will be large). On a large site narrow with `q` (searches title/path/description) or page with `limit`/`offset` instead of listing everything. Each page carries a `previewUrl` — a signed DRAFT preview of that page that needs no login. That is how you (or the user) LOOK at a page: it works with no deploy target, which most projects have none of.',
      inputSchema: {
        includeSource: z.boolean().optional(),
        q: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(500).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    gate(
      null,
      ({ includeSource, q, limit, offset }: { includeSource?: boolean; q?: string; limit?: number; offset?: number }) =>
        client.listContent('page', undefined, { summary: !includeSource, q, limit, offset }),
    ),
  );

  server.registerTool(
    'get_page',
    {
      description:
        'Get one page by id. For code-first pages the design is in the `source` field. The response also carries `previewUrl` — a signed DRAFT preview of this page that needs no login and works with no deploy target.',
      inputSchema: { id: z.string() },
    },
    gate(null, ({ id }) => client.getContent('page', id)),
  );

  server.registerTool(
    'list_content',
    {
      description:
        "List all entities of a content kind. For kind 'entry' pass `dataset` (a dataset slug) to list ONLY that dataset's entries — an entry id is unique only within its dataset, so an unscoped entry list returns EVERY dataset's rows mixed together. Pass summary:true to omit the heavy body fields (source / data / values) and get a `_summary` descriptor instead — do that when you only need to see WHAT exists, since a full list of source-bearing entities can exceed the output limit. `q` SEARCHES (case-insensitive substring over the id, title, path, description and an entry's values) and `limit`/`offset` page through the result with a `total`; all of these compose with `dataset`, so a collection of thousands of rows is reachable without ever pulling the whole kind.",
      inputSchema: {
        kind: GENERIC_KIND,
        dataset: z.string().optional(),
        summary: z.boolean().optional(),
        q: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(500).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    gate(
      null,
      ({ kind, dataset, summary, q, limit, offset }: { kind: string; dataset?: string; summary?: boolean; q?: string; limit?: number; offset?: number }) =>
        client.listContent(kind, dataset, { summary, q, limit, offset }),
    ),
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
        `Render a (possibly unsaved) page and return screenshots so you can SEE how it looks — check layout, spacing, hierarchy, colour, imagery, and the responsive views, then iterate. Defaults to desktop + mobile at reduced resolution (to save tokens — enough to judge layout); pass viewports (any of: ${SCREENSHOT_VIEWPORT_NAMES.join(', ')}; the everyday words "desktop" and "phone" also work) to check specific breakpoints — e.g. all five for a full responsive sweep. Screenshots are token-heavy: preview at milestones, not after every small edit. Pass includeHtml:true to also get the rendered HTML source (heavy — it includes the whole compiled stylesheet). Does not save. To preview a page you have ALREADY SAVED, pass only its id as page:{id:"home"} — the stored page is loaded and rendered, so you never resend its source.`,
      inputSchema: {
        // A SAVED page may be named by id alone — the route loads the stored page and renders it. The
        // description has promised that since the stored-page fallback landed; the schema still demanded
        // `path` and `title`, so the documented call validation-errored on its first use. `.strict()`
        // keeps the stub unambiguous: exactly `{id}` is a reference, anything richer is a full page and
        // is validated as one.
        page: z.union([z.object({ id: IdSchema }).strict(), PageSchema]),
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
          content.push({ type: 'text', text: 'No screenshots came back for either side. If other screenshot tools are working, this is not a missing browser \u2014 check that the page and its source URL both render.' });
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
        // The n/a count is part of the headline on purpose: a check that passed because the page has no
        // slider / no modal / no nav verified nothing, and hiding that inside the total made "8/8" read
        // as much stronger evidence than five actual checks.
        const naNote = r.na ? `, ${r.na} n/a (nothing on the page to check)` : '';
        const lines = [`CLONE AUDIT ${r.pass ? 'PASS ✓' : 'FAIL ✗'} — ${r.passed}/${r.total} gating checks${naNote} for page “${pageId}” (original: ${r.sourceUrl}).`];
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
        "Lighthouse PAGE-SPEED + SEO audit of a page, run against a DEPLOY-EQUIVALENT build (minified like Publish, with production cache headers — not the sandboxed draft preview). Returns four category scores 0–100 (performance, accessibility, best-practices, seo), core lab metrics (FCP / LCP / TBT / CLS / Speed Index), and a ranked list of the specific, actionable failing audits (e.g. render-blocking requests, unused/unminified JavaScript, images without dimensions, low-contrast text, non-sequential headings, a missing meta description). Each finding lists the CONCRETE files/elements to fix and their estimated byte/time savings, and the report includes the page's H1–H6 heading-structure outline with recommendations (missing or duplicate H1, skipped heading levels, empty headings). Lab-only — no real-user CrUX field data; the performance score is a throttled lab run (directional), while SEO / accessibility / best-practices are deterministic. Use it to check a page before publishing and to get a concrete fix list. `formFactor` defaults to mobile; pass 'desktop' for the desktop profile.",
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
        const kib = (bytes: number): string => `${Math.round(bytes / 1024)} KiB`;
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
            const saving =
              f.overallSavingsBytes !== undefined && f.overallSavingsBytes > 0
                ? ` — est. save ${kib(f.overallSavingsBytes)}`
                : f.overallSavingsMs !== undefined && f.overallSavingsMs > 0
                  ? ` — est. save ${Math.round(f.overallSavingsMs)} ms`
                  : '';
            lines.push(`  [${f.category}] ${f.title}${f.displayValue ? ` — ${f.displayValue}` : ''}${saving}`);
            // Concrete files/elements to fix (the PageSpeed-style per-resource detail).
            for (const it of f.items ?? []) {
              const cost = [
                it.totalBytes !== undefined ? kib(it.totalBytes) : null,
                it.wastedBytes !== undefined ? `save ${kib(it.wastedBytes)}` : null,
                it.wastedMs !== undefined ? `save ${Math.round(it.wastedMs)} ms` : null,
              ].filter(Boolean);
              lines.push(`      • ${it.url ?? it.label ?? '(item)'}${cost.length ? ` — ${cost.join(', ')}` : ''}`);
            }
            if (f.moreItems) lines.push(`      • …and ${f.moreItems} more`);
          }
        }
        // Heading (h1–h6) structure outline + its SEO/accessibility recommendations.
        if (r.outline) {
          lines.push('', 'Heading structure:');
          if (r.outline.headings.length === 0) {
            lines.push('  (no headings on this page)');
          } else {
            for (const h of r.outline.headings) {
              lines.push(`  ${'  '.repeat(Math.max(0, h.level - 1))}H${h.level}  ${h.text || '(empty)'}${h.issue ? `   ⚠ ${h.issue}` : ''}`);
            }
            if (r.outline.truncated) lines.push(`  …and ${r.outline.truncated} more headings`);
          }
          for (const issue of r.outline.issues) lines.push(`  ⚠ ${issue}`);
        }
        if (r.runWarnings && r.runWarnings.length > 0) {
          lines.push('', 'Lighthouse environment notices (may explain a host-constrained score):');
          for (const w of r.runWarnings) lines.push(`  • ${w}`);
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
        if (names.length === 0) content.push({ type: 'text', text: 'No screenshots came back for either side. If other screenshot tools are working, this is not a missing browser \u2014 check that the page and its source URL both render.' });
        else content.push({ type: 'text', text: 'Now list every blocker + major defect you see, fix them (put_page), and run visual_audit again until there are none.' });
        return { content };
      } catch (err) {
        if (err instanceof SitewrightApiError) return toolError(`Error ${err.status}: ${err.message}`);
        return toolError(`Error: ${err instanceof Error ? err.message : 'visual audit failed'}`);
      }
    },
  );

  server.registerTool(
    'inspect_source',
    {
      description:
        "MEASURE a rendered page — settled markup + REAL computed styles + REAL rects for the CSS selectors you name. This is how you get NUMBERS off the LIVE ORIGINAL (font-size, padding, gap, colour, gradient stops, border-radius, shadow, transform), which the other fidelity tools cannot give you: they all return an image or a comparison score and each needs a built clone first. Use it BEFORE authoring a section — measure, then reproduce those exact values — instead of eyeballing a screenshot. It is also the ONLY way to see chrome a site builds in JAVASCRIPT: the importer stores the PRE-JS body, so such a site's stored page source contains no header/footer markup at all, while this returns what the visitor actually sees. Pass html:true to get the settled outerHTML of each match (scripts/styles stripped) — that is how you recover a JS-built nav's real link list. ::before/::after are reported when they generate a box, so rotated labels / gradient underlines / counters are visible too. side:'build' measures YOUR clone through the same probe, so you can diff numbers directly against the original. Measurements are viewport-dependent — the viewport used is echoed back. KEEP THE RESPONSE SMALL: every node returns ~28 computed properties by default, so a few selectors with html:true can run to tens of thousands of tokens; pass `styles` to name EXACTLY the properties you need (it REPLACES the default set) and only set html:true when you actually need the markup. The page must have an import source.",
      inputSchema: {
        pageId: z.string(),
        selectors: z.array(z.string()).min(1).max(20).describe('CSS selectors to measure, e.g. ["#main-nav a", ".hero h1", "footer"]'),
        styles: z
          .array(z.string())
          .max(40)
          .optional()
          .describe(
            'EXACTLY which CSS properties to return — this REPLACES the ~28-property default set, it does not add to it. ' +
              'Use it to keep the response small: ["font-size","font-weight","color","padding"] returns four properties per ' +
              'node instead of twenty-eight. Omit it to get the full default set (every property a faithful port usually ' +
              'has to match). Naming a property outside the default set works the same way, e.g. ["backdrop-filter","writing-mode"].',
          ),
        html: z.boolean().optional().describe('Also return each match\'s settled outerHTML (scripts/styles stripped, truncated).'),
        viewport: z
          .union([z.enum(['wqhd', 'fullhd', 'laptop', 'tablet', 'mobile']), z.number().int().min(240).max(3840)])
          .optional()
          .describe(
            'Measurement viewport: a name (wqhd 2560 · fullhd 1920 · laptop 1440 (default) · tablet 767 · mobile 390) ' +
              'OR an exact pixel WIDTH. Use a width to measure a breakpoint the names skip — there is nothing between ' +
              '768 and 1440, which is exactly where most frameworks switch, so pass 992 or 1024 to see what actually ' +
              'applies there instead of inferring it from the stylesheet.',
          ),
        side: z.enum(['source', 'build']).optional().describe('Which page to measure: the live original (default) or your build.'),
      },
    },
    async ({ pageId, selectors, styles, html, viewport, side }: { pageId: string; selectors: string[]; styles?: string[]; html?: boolean; viewport?: string | number; side?: 'source' | 'build' }): Promise<ToolResult> => {
      if (!holder.scope) return toolError('Not connected. Use the `login` tool, approve in your browser, then retry this action.');
      if (!holder.scope.capabilities.includes('content:read')) {
        return toolError(`Your connection to project ${holder.scope.projectId} lacks the \u201Ccontent:read\u201D capability.`);
      }
      try {
        const r = await client.inspectSource(pageId, { selectors, ...(styles?.length ? { styles } : {}), ...(html ? { html } : {}), ...(viewport ? { viewport } : {}), ...(side ? { side } : {}) });
        const missing = r.results.filter((x) => x.count === 0).map((x) => x.selector);
        const invalid = r.results.filter((x) => x.count === -1).map((x) => x.selector);
        const notes = [
          `Measured the ${r.side === 'build' ? 'BUILD' : 'LIVE ORIGINAL'} (${r.url}) at ${r.viewport.width}\u00d7${r.viewport.height}; document height ${r.documentHeight}px.`,
          'Every rect/px below is true AT THIS VIEWPORT only \u2014 re-measure at another width before porting responsive rules.',
          invalid.length ? `INVALID selector syntax (count -1): ${invalid.join(', ')}` : '',
          missing.length ? `NO MATCH: ${missing.join(', ')} \u2014 the element may be named differently here, or built by JS under another hook; try a broader selector.` : '',
        ].filter(Boolean);
        return { content: [{ type: 'text', text: `${notes.join('\n')}\n\n${JSON.stringify(r.results, null, 1)}` }] };
      } catch (err) {
        if (err instanceof SitewrightApiError) return toolError(`Error ${err.status}: ${err.message}`);
        return toolError(`Error: ${err instanceof Error ? err.message : 'unknown error'}`);
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
        if (content.length === 1) {
          // Name what was ACTUALLY tried. The old wording blamed "no Chromium on this server, or the
          // regions were not found" — two causes with opposite remedies, and the reader cannot tell
          // which. Chromium is almost always fine (preview_page works), so an agent reads this as "the
          // server can't crop" and stops, when the real problem is a selector that matched nothing.
          const asked = regions?.length ? regions.join(', ') : Object.keys(r.regions).join(', ') || 'the default regions';
          content.push({
            type: 'text',
            text:
              `The page rendered, but none of these regions matched an element: ${asked}. ` +
              'A region name is matched against the page\u2019s own markup — use inspect_source to see what is ' +
              'actually there and pass a selector that exists. (If the render itself had failed you would ' +
              'have got an error instead of this message.)',
          });
        }
        return { content };
      } catch (err) {
        if (err instanceof SitewrightApiError) return toolError(`Error ${err.status}: ${err.message}`);
        return toolError(`Error: ${err instanceof Error ? err.message : 'compare regions failed'}`);
      }
    },
  );

  server.registerTool(
    'get_publish_status',
    {
      description:
        'Read where this project actually stands. `status` is the headline: "unpublished" whenever no deploy target is configured — publishing BUILDS the site, but nothing serves it until a target exists, so there is no live address. `url` is non-null ONLY for Local Hosting; it is null for a remote (FTP/SFTP/Git) target too, because the upload origin is not ours to know. NEVER report a project as live from a `url` alone — check `status`. To SEE the site, use `previewUrl` (a signed draft preview that needs no login), or the per-page `previewUrl` on get_page / list_pages.',
    },
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
        'List the configured stock-image providers and whether each is available (openverse needs no key; unsplash/pexels need an instance-admin key). Only needed to explain a gap — search_stock_images with provider "all" already uses every available one.',
    },
    gate('content:read', () => client.stockProviders()),
  );

  server.registerTool(
    'search_stock_images',
    {
      description:
        'Search stock photos. `provider: "all"` (the default choice) queries every available provider at once and interleaves the results; name one provider to search only that. Each hit carries its own `provider` — pass it back to import_stock_image along with the id. Returns provider-hosted `thumbUrl` (grid) and `previewUrl` (full-size preview); `hasMore` says whether page+1 is worth fetching.',
      inputSchema: {
        provider: StockSearchProviderSchema,
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

/**
   * Accept an object argument that arrived JSON-STRINGIFIED.
   *
   * Two independent clone agents hit the same wall on their first large page write (~12.5KB):
   * `put_page` rejected it with "page — Expected object, received string", the identical payload
   * succeeded when split into a smaller `put_page` + a `patch_page`, and the error named the wrong
   * cause entirely ("your object is a string" rather than anything about size). One reported losing a
   * cycle guessing; the other worked around it permanently.
   *
   * A caller that serialises a big argument instead of nesting it is sending the same data — there is
   * nothing to gain by refusing it. Parse it and hand the result to the SAME schema, so validation is
   * unchanged and a genuinely malformed payload still fails exactly as before.
   */
  // `.nonoptional()` is load-bearing, not decoration. Under zod 4 a `z.preprocess` becomes a pipe
  // whose INPUT side is `unknown`, and `unknown` accepts undefined — so the JSON Schema the MCP SDK
  // publishes drops the argument from `required`. Measured: `put_page` and `patch_page` both went
  // from `required: ["page"]` to `required: []`, telling every agent that the one argument the tool
  // cannot work without is optional. `.nonoptional()` puts it back.
  const objectArg = <T extends z.ZodTypeAny>(schema: T) =>
    z
      .preprocess((v) => {
        if (typeof v !== 'string') return v;
        const s = v.trim();
        if (!s.startsWith('{') || !s.endsWith('}')) return v;
        try {
          return JSON.parse(s);
        } catch {
          return v; // not JSON after all — let the schema report the real problem
        }
      }, schema)
      .nonoptional();

  // ---------------------------------------------------------------- writes (content:write)
  // Deletes are gated on `content:delete`, NOT `content:write` — an agent can be allowed to
  // create/update without the irreversible power to remove pages or content.
  server.registerTool(
    'put_page',
    {
      description:
        'Create or REPLACE a page. The page id is taken from page.id. This is a TOTAL replace — every field you omit is deleted, so only use it when you are writing the whole page. To change a FEW fields (a nav label, the title, one data key) use patch_page instead. Returns a RECEIPT — { kind, id, bytes, created, changed } — not the page; call get_page if you need the stored page back.',
      inputSchema: { page: objectArg(PageSchema) },
    },
    gate('content:write', ({ page }) => client.putContent('page', page.id, page, { receipt: true })),
  );

  server.registerTool(
    'patch_page',
    {
      description:
        'PATCH an existing page: send only the fields you want to change and everything else is kept. Use this instead of put_page for partial edits — put_page REPLACES, so `{id, path, title, nav}` would silently wipe `source`, `status`, `description`, `order`, `parent` and the `data.swImport` import marker every fidelity tool needs. Objects merge key-by-key (so `data:{a:1}` keeps the other data keys); ARRAYS and scalars replace wholesale (so `nav.slots` is set, not appended). Send a field as `null` to CLEAR it (delete-this-key) — omitting a field leaves it unchanged, so `null` is the only way to remove one, e.g. `{id, template:null}` moves a page off its template (`""` is not a valid template ref) and `{id, parent:null}` un-nests it. Clear a single data key the same way: `data:{headline:null}`. CAUTION: a bare `data:null` deletes the WHOLE data object including `data.swImport`, the import marker every fidelity tool needs — clear individual keys instead. The merged page is validated exactly like a full write. 404s if the page does not exist yet — create it with put_page first. Returns a RECEIPT — { kind, id, bytes, created, changed } — not the page: `changed` lists the top-level keys that actually differ, so an EMPTY list means your patch was a no-op (wrong id, or the value was already set). Call get_page if you need the stored page back.',
      inputSchema: { page: objectArg(PagePatchSchema) },
    },
    gate('content:write', ({ page }) => client.putContent('page', page.id, page, { merge: true, receipt: true })),
  );

  server.registerTool(
    'delete_page',
    { description: 'Delete a page by id. Needs the content:delete capability.', inputSchema: { id: z.string() } },
    gate('content:delete', ({ id }) => client.deleteContent('page', id).then(() => ({ deleted: id }))),
  );

  server.registerTool(
    'patch_critical_css',
    {
      description:
        'PARTIAL write of website.criticalCss — add or change site CSS WITHOUT re-sending the whole stylesheet. ' +
        'Pass `block` (a short name like "nav" or "gallery") and that named block is UPSERTED: replaced in place if ' +
        'it already exists, appended if not — so editing the same rule ten times leaves ONE copy, not ten. Omit ' +
        '`block` to plain-append. Send an empty `css` WITH a `block` to delete that block. Returns a receipt ' +
        '({ block, bytes, bytesBefore, blocks, changed }), never the sheet. Use this for every CSS tweak: a full ' +
        'settings write re-transmits the entire stylesheet, which is the single most token-expensive habit in a ' +
        'clone job. put_content(kind:"settings") still works when you genuinely want to replace the whole sheet.',
      inputSchema: {
        css: z.string().max(200_000).describe('The CSS for this write. Empty string + a block name removes that block.'),
        block: z
          .string()
          .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,48}$/)
          .optional()
          .describe('Name this chunk so later writes REPLACE it instead of appending a duplicate.'),
      },
    },
    gate('content:write', ({ css, block }: { css: string; block?: string }) => client.patchCriticalCss(css, block)),
  );

  server.registerTool(
    'put_content',
    {
      description:
        'Create or replace a content entity of the given kind. Args: { kind, id, data } — plus `dataset` (the owning dataset slug) when kind is "entry". For PAGES prefer put_page (fully typed). `data` must match that kind’s schema; you may OMIT `data.id` (and an entry’s `data.dataset`) — they are copied from the `id` / `dataset` args for you. On a mismatch the error names the wrong field AND the expected shape, so read it and retry. To learn a kind’s shape up front, call get_content on an existing entity of that kind, or get_guide. For SETTINGS, pass `merge:true` to PATCH just the fields you send (e.g. only `website.footer`) without resending the whole object — safer than a full replace, which reverts any slot your snapshot missed. Returns a RECEIPT — { kind, id, bytes, created, changed } — instead of echoing the entity (settings alone was ~9 KB per write): `changed` lists the top-level keys that actually differ, so an EMPTY list means the write changed nothing. Use get_content when you need the stored entity.',
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
        return await client.putContent(kind, id, normalized, { merge, receipt: true });
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
    'delete_content_bulk',
    {
      description:
        'Delete MANY entities of one kind in ONE call: { kind, ids:[…] } — plus `dataset` (the owning dataset slug) when kind is "entry". Use this instead of looping delete_content when clearing up after an import (junk datasets, a batch of entries or scaffolded pages): one call instead of N, so you do not burn turns or hit the write rate limit. Up to 200 ids. PARTIAL SUCCESS is normal — each id is attempted on its own and the result is { deleted:[…], failed:[{id,error}], requested }, so an id that is already gone does not abort the rest. Deleting a DATASET also deletes its entries. Everything stays restorable from version history. Needs the content:delete capability.',
      inputSchema: {
        kind: GENERIC_KIND,
        ids: z.array(z.string()).min(1).max(200).describe('The entity ids to delete (duplicates are collapsed).'),
        dataset: z.string().optional().describe('ENTRY only: the owning dataset slug (entry ids are unique only within their dataset).'),
      },
    },
    gate('content:delete', ({ kind, ids, dataset }) => client.deleteContentBulk(kind, ids, dataset)),
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
    'import_website',
    {
      description:
        'Crawl + IMPORT a public https website URL into THIS project — the FIRST step of cloning/nativizing a site. The server fetches and RENDERS the live page(s) itself (executing JS, following an embed/preview wrapper to the real framed site), self-hosts the images + fonts, and creates the imported `swImport` scaffold pages. Call this FIRST whenever you are asked to clone/nativize/reproduce a URL and the project has no imported pages yet; then nativize (get_guide("import") → author → visual_audit → publish_project). NEVER tell the user you cannot fetch websites or ask them to paste HTML — this tool imports the live page for you. Foundation (native scaffold) is on by default.',
      inputSchema: {
        url: z.string().url().max(2048),
        foundation: z.boolean().optional(),
        inferDatasets: z
          .boolean()
          .optional()
          .describe(
            'Guess DATASETS from repeated markup (a card grid → a dataset + one entry per card). Default FALSE and normally leave it so: shape-matching misses a listing whose cards are not identical, names fields after the markup instead of the meaning, and concatenates text split across inline elements — you author better datasets by reading the page. Set true only to see what it would guess.',
          ),
        renderMode: z
          .enum(['auto', 'always'])
          .optional()
          .describe(
            'When to run the headless render. "auto" (default) renders only a page with no content without JS (an SPA shell / embed wrapper). Use "always" when the imported pages come back MISSING chrome the live site clearly has — a header or footer a server-rendered site assembles in JavaScript is invisible to "auto", which sees real content and skips the render. Costs a browser navigation per page.',
          ),
        maxPages: z.number().int().min(1).max(200).optional(),
        maxDepth: z.number().int().min(0).max(5).optional(),
      },
    },
    gate('content:write', ({ url, foundation, inferDatasets, renderMode, maxPages, maxDepth }) =>
      client.importWebsite(url, { foundation, inferDatasets, renderMode, maxPages, maxDepth }).then(summarizeImport),
    ),
  );

  server.registerTool(
    'import_status',
    {
      description:
        'Check a website import started by import_website. Returns its status ("running" | "done" | "failed"), the latest progress line, and — once done — the import report. ' +
        'PASS waitMs (up to 55000) TO WAIT INSTEAD OF POLLING: the call blocks until the job actually moves — a new progress line, or it finishes — so one call replaces a whole poll loop. ' +
        'Feed `since` the `progress lines` count from the previous reply so the wait resumes rather than returning immediately on a line you have already seen. ' +
        'Without waitMs this returns instantly, which is what made earlier runs spin: one agent made 25 status calls plus 7 shell sleeps and spent its first ten minutes waiting. ' +
        'NEVER re-run import_website while a job is running: the second crawl duplicates the work.',
      inputSchema: {
        jobId: z.string().min(1).max(64),
        waitMs: z
          .number()
          .int()
          .min(0)
          // 55s, NOT 60s: at the documented 60000 the MCP transport gave up before the tool could answer, so
          // the maximum the docs advertised was the one value guaranteed to fail. Reported by an agent that
          // had to discover the real ceiling by bisecting.
          .max(55_000)
          .optional()
          .describe('Block up to this many ms waiting for the job to move (max 55000 — the transport gives up beyond that). Use 30000 and just call again if still running.'),
        since: z.number().int().min(0).optional().describe('The progress-line count from your last reply, so the wait resumes.'),
      },
    },
    gate('content:write', ({ jobId, waitMs, since }: { jobId: string; waitMs?: number; since?: number }) =>
      client
        .importStatus(jobId, { ...(waitMs ? { waitMs } : {}), ...(since ? { since } : {}) })
        .then(summarizeImportJob),
    ),
  );

  server.registerTool(
    'import_image',
    {
      description:
        'Import an image into the project from a PUBLIC https URL — the server downloads, optimizes, and self-hosts it (never a hotlink), returning the stored asset (use its `url` in your <img src>). For STOCK photos use search_stock_images + import_stock_image instead. This is the ONLY URL-based import, and it holds an IMAGE to 15MB; a playable video/audio URL (.mp4/.webm/.mov/.m4a…) is allowed up to 200MB. Anything else over the cap answers 413 — that is not a dead end: download the file yourself and send it through create_media_upload (one-shot ticket, up to 200MB). NEVER leave a remote asset hotlinked because an import failed; a hotlinked file breaks when the source site changes.',
      inputSchema: { url: z.string().url().max(2048), folder: z.string().max(1024).optional() },
    },
    gate('content:write', ({ url, folder }) => client.importImageUrl(url, folder)),
  );

  // Upload a LOCAL file. The only media path that does not require the bytes to already be reachable
  // from the server — see the tool description for why it is two steps rather than one.
  server.registerTool(
    'create_media_upload',
    {
      description:
        'Upload a LOCAL file (a logo, a photo, a font, a PDF) into the project media library. Use this when the file is on YOUR disk; use import_image when it is at a public https URL. TWO STEPS: (1) call this to get a one-shot `uploadUrl`, (2) send the file to it yourself, e.g. `curl -T ./logo.png "<uploadUrl>?filename=logo.png"` — always pass ?filename=, since a raw upload carries no name and the stored asset is named from it. The response of THAT request is the stored asset; use its `url` in your markup. The ticket is single-use and expires (see expiresInSeconds), so mint one per file, immediately before sending it. It is deliberately not a single tool call: the bytes would have to pass through this conversation as base64, which for a 1MB image is roughly 370k tokens.',
      inputSchema: { folder: z.string().max(1024).optional() },
    },
    gate('content:write', ({ folder }) => client.createMediaUpload(folder)),
  );

  // The INLINE path for a small file. Deliberately a separate tool from create_media_upload rather
  // than one tool that guesses: the difference between them is a hard cost cliff, and an agent should
  // be choosing it knowingly.
  server.registerTool(
    'upload_media',
    {
      description:
        `Upload a SMALL local file (up to ${Math.round(MCP_INLINE_UPLOAD_MAX_BYTES / 1024)} KB) by sending its bytes INLINE as base64 — an SVG logo, an icon, a favicon. ONE call, no shell needed. For anything bigger use create_media_upload instead: base64 costs ~1.37x the file in characters and roughly a token per 4 characters, so a 1MB image would be ~370k tokens of this conversation, while create_media_upload sends the bytes over a channel that never enters it. \`content_base64\` may be bare base64 or a data: URI. Returns the stored asset — use its \`url\` in your markup.`,
      inputSchema: {
        filename: z.string().min(1).max(200),
        content_base64: z.string().min(1).max(MCP_INLINE_UPLOAD_MAX_B64_CHARS),
        folder: z.string().max(1024).optional(),
      },
    },
    gate('content:write', ({ filename, content_base64, folder }) => client.uploadMediaBase64(filename, content_base64, folder)),
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
    'move_media_bulk',
    {
      description:
        'Re-file MANY media assets into one folder in a single call. Use this instead of looping move_media: ' +
        'reorganising an imported library one asset at a time is one round-trip each (96 calls for one real ' +
        'site, which then hit a rate limit partway and left the library half-filed). Partial success is normal — ' +
        'the result reports { moved, failed, requested, folder } and accounts for every id. Renaming stays on ' +
        'move_media, since a filename is inherently per-asset.',
      inputSchema: {
        ids: z.array(z.string()).min(1).max(200).describe('Asset ids to re-file (max 200).'),
        folder: MediaFolderSchema.describe('Destination folder for all of them.'),
      },
    },
    gate('content:write', ({ ids, folder }: { ids: string[]; folder: string }) => client.moveMediaBulk(ids, folder)),
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
    'transform_image',
    {
      description:
        "Rotate (90/180/270 clockwise) and/or crop an image asset. Rotation is applied FIRST, so `crop` is measured against the image AS TURNED — the same order an editor shows you. By default it edits IN PLACE: the asset id, stored name and URL do not change, so every page/dataset reference keeps working and the change travels with an export — use that to CORRECT a photograph (one stored sideways with no EXIF tag, a scan with a border). It is destructive; the original pixels are gone. Pass `saveAs` to write a NEW asset instead and leave the source untouched — use that when the crop is one USE of a picture rather than a fix to it. SVG is rejected (a vector edit belongs in its markup), as is an animated image.",
      inputSchema: {
        id: z.string(),
        rotate: z.union([z.literal(90), z.literal(180), z.literal(270)]).optional(),
        crop: z
          .object({
            left: z.number().int().min(0),
            top: z.number().int().min(0),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          })
          .optional(),
        format: z.enum(['webp', 'jpeg', 'png']).optional(),
        saveAs: z.object({ filename: z.string().min(1).max(255), folder: MediaFolderSchema.optional() }).optional(),
      },
    },
    gate('content:write', ({ id, rotate, crop, format, saveAs }) => {
      if (rotate === undefined && crop === undefined) {
        throw new Error('transform_image needs at least one of `rotate` or `crop`.');
      }
      return client.transformMedia(id, {
        ...(rotate !== undefined ? { rotate } : {}),
        ...(crop ? { crop } : {}),
        ...(format ? { format } : {}),
        ...(saveAs ? { saveAs } : {}),
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

  // The AUTONOMOUS whole-site clone: kicks off the SERVER-SIDE orchestrator (import → author each page →
  // authoritative gate → iterate → publish) and returns the per-page verdict once it finishes. Requires the
  // project to have an AI provider configured (else the route 501s). A generic MCP agent that IS the model
  // doesn't need this — it can run the `clone_site` prompt workflow itself; this hands the whole loop to the
  // platform's own agent instead.
  server.registerTool(
    'ai_clone',
    {
      description:
        'Autonomously clone/nativize EVERY imported page to the acceptance gate (server-side import→author→gate→iterate→publish). Requires a configured AI provider; a generic MCP agent can instead run the clone_site workflow itself.',
    },
    gate('publish', () => client.cloneSite().then(summarizeCloneRun)),
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
export const CLONE_SITE_WORKFLOW = `Clone this imported website into faithful, native Sitewright pages. Run this WHOLE flow END-TO-END YOURSELF — import → author EVERY page → judge visual_audit region-by-region to zero blocker+major → clone_audit STRUCTURE/BEHAVIOUR pass → publish_project — WITHOUT stopping to ask the user for approval between pages or before publishing. Only pause if you are genuinely blocked (not connected / missing a capability). Keep going until every page passes and the site is published.

1. If you were given a URL to clone and list_pages shows NO \`swImport\` pages (an un-imported/blank project), call import_website(url) FIRST — the server crawls + RENDERS the live site (following an embed/preview wrapper to the real page) and creates the scaffold. NEVER say you can't fetch the URL or ask the user to paste HTML. Then call list_pages: every page whose data carries \`swImport\` is an imported RAW scaffold (foreign Materialize/Bootstrap/FontAwesome markup) that must be rebuilt in native primitives. Read the full rules ONCE: get_guide("import").
2. Work ONE page at a time, home first, so theme tokens / datasets / chrome carry across the site. For each imported page:
   a. compare_to_source(pageId) — SEE the original vs your current build.
   b. Author the body with REAL platform primitives first (get_components / get_reference / widgets / website.effects); only hand-write HTML when nothing fits. Tailwind utilities for layout, correct per-element fonts via CSS vars, {{#each dataset.x}} for repeated lists (named datasets, not "items"), real <dialog data-sw-component="modal"> for modals, a working mobile drawer, and data-sw-* / {{sw-control}} so text stays editable. Do NOT leave the imported foreign markup.
   c. put_page the native source.
   d. visual_audit(pageId) — THE visual terminator. It returns your CLONE vs the LIVE original SIDE-BY-SIDE (desktop + mobile) plus a defect rubric (no server AI — your own vision is the judge). WRITE OUT an explicit region-by-region difference list — header, hero, EACH body section, footer — tagging every divergence category (layout|spacing|typography|color|image|component|content|chrome|responsive) + severity (blocker|major|minor). Do NOT write "looks close" — ENUMERATE. Then FIX every blocker + major: wrong/missing images, wrong layout, a wrong REPEATED-ITEM COUNT (render what the original shows — e.g. one featured item, not all rows), wrong letter-CASING, missing DIVIDER rules, PLAIN-vs-BADGED icons, wrong section HEIGHT/COLOUR, dead components, wrong fonts.
   d2. DOM CROSS-CHECK — the RECURRING misses a screenshot HIDES. A capture does NOT paint lazy iframes or fire scroll effects, so you must ALSO inspect the LIVE original's DOM: load it in a real browser, SETTLE it (scroll top→bottom, wait ~2.5s), then check — NEVER judge these from pixels alone:
       • LAZY IFRAMES / MAPS: a gray/blank band (or "animated dots in an empty band") — most often just ABOVE the footer, at the bottom of <main>, NOT literally inside <footer> — is almost NEVER empty. It is a lazy, referrer-locked Google MAP (or FB/embed) that renders GRAY in every capture. CONFIRM it in the DOM (an <iframe> whose src is a maps/embed host) and REPRODUCE it site-wide (add the <iframe data-src="{{sw-url company.mapUrl}}" class="skeleton loading …"> to the footer slot — data-src, the platform lazy runtime, NOT loading="lazy": native lazy fetches within a huge distance threshold, i.e. at page load). Do NOT delete a band as "empty" without checking the DOM for an iframe first.
       • SHRINK NAV: scroll the original (window.scrollTo(0,700)) and MEASURE #main-nav height at scrollY 0 vs 700 — if it shrinks (a tall logo row collapsing to a thin menu bar, e.g. 152→56px), set website.effects.stickyHeader:"shrink" and match the collapse in criticalCss; then VERIFY the clone header actually shrinks on scroll.
       • MOTION / ENTRANCE EFFECTS: reproduce the original's entrance animations (Animate.css "animated fadeIn", AOS "data-aos", ".wow") with data-sw-animation on the hero + each section.
       • SHADOW DEPTH: read the original's computed box-shadow on cards/panels/floating elements — MATCH the depth (a strong z-depth-3 "0 12px 15px rgba(0,0,0,.24),0 17px 50px rgba(0,0,0,.19)" is common); don't ship a flat clone of a shadowed original.
       Re-verify each fix in a SETTLED clone render (not an unsettled/first-paint capture).
   e. clone_audit(pageId) — the OBJECTIVE prerequisite: fix every STRUCTURE/BEHAVIOUR failure it reports (datasets deduped + named, media out of the imported/ tree, sliders enhance, modals present, fonts actually load, mobile menu reachable at phone width, content editable). Its computed-style number is ADVISORY — do NOT chase it: coverage is blind to casing/dividers/icon-style/section-height, so a green number with visible differences is STILL a fail.
   f. Repeat d–e until your written visual_audit region list reaches ZERO blocker + major AND clone_audit passes. Only THEN set page.data.swImport.rewritten:true and status "published".
3. When every page passes, publish_project.

PACING: tool calls are rate-limited PER TOKEN, and the render-heavy audits are the tightest (a few per
minute each) — space them out, and treat a 429 or a transient "mcp_unavailable"/RPC error as BACKPRESSURE,
not failure: honor the retry-after header, back off (seconds, exponential), and retry the SAME call.

Never declare a page done from your own render, a screenshot, or a coverage number — judge it against the visual_audit side-by-sides, region by region, to zero blocker+major, AND cross-check the settled original DOM (step d2) for the things a screenshot hides: lazy map/embed iframes (reproduce them — a gray pre-footer band is a MAP, not "empty"), scroll-shrink nav, entrance motion, and real shadow depth. If a page is huge, edit it section by section.`;
