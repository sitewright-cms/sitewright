import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import {
  MediaAssetSchema,
  PageSchema,
  PageNodeSchema,
  assertWithinTreeDepth,
  type Brand,
  type Entry,
  type MediaAsset,
  type Page,
} from '@sitewright/schema';
import { renderDocument, usedComponentTypes, componentAssets } from '@sitewright/blocks';
import { compileUtilityCss, brandToTailwindTheme } from '@sitewright/tailwind';
import { optimizeImage } from '@sitewright/image-pipeline';
import { buildNav, collectClassNames, type ProjectBundle } from '@sitewright/core';
import type { Database } from '../db/client.js';
import { MediaStorage } from '../media/storage.js';
import { PublishError } from '../publish/build.js';
import { InProcessBuildRunner, type BuildRunner } from '../publish/runner.js';
import { AiProviderError, type AiProvider } from '../ai/provider.js';
import { PublishStore } from '../publish/store.js';
import { PreviewStore } from './preview-store.js';
import { archiveSite, deploySite, DeployConfigSchema } from '../publish/adapters.js';
import { isNewer } from '../version/checker.js';
import { registerDeployTargetRoutes } from './deploy-targets.js';
import { createSession, revokeSession, validateSession } from '../auth/sessions.js';
import {
  listOrgsForUser,
  login,
  registerAccount,
  tenantContext,
} from '../repo/accounts.js';
import { ProjectRepository } from '../repo/projects.js';
import { AiUsageRepository } from '../repo/ai-usage.js';
import {
  ContentRepository,
  CONTENT_KINDS,
  SETTINGS_ENTITY_ID,
  type Settings,
} from '../repo/content.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  type ProjectContext,
} from '../repo/context.js';
import type { ContentKind } from '../db/schema.js';

const SESSION_COOKIE = 'sw_session';
const RL_WINDOW = '1 minute';
/** Per-route rate-limit config for an expensive/sensitive endpoint. */
const rl = (max: number) => ({ rateLimit: { max, timeWindow: RL_WINDOW } });
const IMPORT_BODY_LIMIT = 4 * 1024 * 1024; // 4 MiB for a full project import
const PREVIEW_BODY_LIMIT = 2 * 1024 * 1024; // 2 MiB for a single draft page
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MiB per uploaded image
const WRITE_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);
const API_PREFIXES = ['/auth', '/orgs', '/me', '/health'];

const MEDIA_CONTENT_TYPES = new Map<string, string>([
  ['avif', 'image/avif'],
  ['webp', 'image/webp'],
  ['jpg', 'image/jpeg'],
]);

// Bound concurrent image optimization — each run spawns several sharp encoders,
// so unbounded parallel uploads could saturate CPU/memory on the single
// container. A slot is handed directly to the next waiter on release (never
// over-admitting beyond MAX_CONCURRENT_OPTIMIZE).
const MAX_CONCURRENT_OPTIMIZE = 3;
let activeOptimizations = 0;
const optimizeWaiters: Array<() => void> = [];
async function withOptimizeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeOptimizations < MAX_CONCURRENT_OPTIMIZE) {
    activeOptimizations += 1;
  } else {
    await new Promise<void>((resolve) => optimizeWaiters.push(resolve));
  }
  try {
    return await fn();
  } finally {
    const next = optimizeWaiters.shift();
    if (next) next();
    else activeOptimizations -= 1;
  }
}

function isApiPath(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
const CONTENT_KIND_SET: ReadonlySet<string> = new Set(CONTENT_KINDS);

function parseKind(kind: string): ContentKind {
  if (!CONTENT_KIND_SET.has(kind)) throw new NotFoundError(`unknown content kind: ${kind}`);
  return kind as ContentKind;
}

// Media binaries and deploy-target secrets are managed only through their
// dedicated endpoints — the generic content routes must not read OR write them
// (a generic read of `deploy_target` would otherwise leak the encrypted secret;
// a write could forge a media `url` or an attacker-chosen secret blob).
const DEDICATED_KINDS: ReadonlySet<ContentKind> = new Set(['media', 'deploy_target']);
function parseGenericKind(kind: string): ContentKind {
  const parsed = parseKind(kind);
  if (DEDICATED_KINDS.has(parsed)) {
    throw new ForbiddenError(`${parsed} must be accessed via its dedicated endpoints`);
  }
  return parsed;
}

const RegisterBody = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  orgName: z.string().min(1).max(120),
});
const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});
const AiGenerateBody = z.object({
  instruction: z.string().min(1).max(4000),
  target: z.enum(['blocks', 'copy']).default('copy'),
  // No client-selectable model: the agency operator pins the funded model via
  // SW_AI_MODEL. Quotas meter tokens, not dollars, so letting a caller pick a
  // premium model would let it drain the budget faster within the same cap.
});

/** Start of the current UTC month — the window for monthly AI token quotas. */
function startOfMonthUTC(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const CreateProjectBody = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .max(64)
    // eslint-disable-next-line security/detect-unsafe-regex -- linear (hyphen separator), length-capped by .max()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase alphanumeric with hyphens'),
});

export interface AppOptions {
  db: Database;
  cookieSecret?: string;
  secureCookies?: boolean;
  logger?: boolean;
  /** Absolute path to the built editor SPA to serve at `/` (single-container mode). */
  editorDist?: string;
  /** Absolute path to the media storage root; enables media upload/serve when set. */
  mediaRoot?: string;
  /** Absolute path to the published-sites root; enables publish/serve when set. */
  publishRoot?: string;
  /**
   * Trust `X-Forwarded-For` so `req.ip` is the real client IP behind a reverse
   * proxy (required for correct per-IP rate limiting). `true`, or a CIDR/list of
   * trusted proxy addresses. Leave unset for direct connections.
   */
  trustProxy?: boolean | string | string[];
  /** 32-byte key for encrypting stored secrets (saved deploy-target passwords). */
  encryptionKey?: Buffer;
  /** When set, deploy targets are restricted to these exact hostnames (SaaS SSRF guard). */
  deployAllowedHosts?: string[];
  /** Current running version (for the pull-based update check). */
  version?: string;
  /** Provider of the latest released version tag (cached; null when unavailable). */
  latestVersion?: () => Promise<string | null>;
  /** URL shown in the update banner linking to the latest release. */
  releaseUrl?: string;
  /** Build executor (default: in-process). Swap for an isolated worker in SaaS. */
  buildRunner?: BuildRunner;
  /** Online AI completion provider (agency-funded). Omit to disable the AI endpoints. */
  aiProvider?: AiProvider;
  /** Monthly token quotas for agency-funded metering. Unset/0 = unlimited. */
  aiQuota?: { orgMonthlyTokens?: number; userMonthlyTokens?: number };
}

export async function createApp(opts: AppOptions): Promise<FastifyInstance> {
  const { db } = opts;
  const signed = Boolean(opts.cookieSecret);
  const projects = new ProjectRepository(db);
  const contentRepo = new ContentRepository(db);
  const mediaStorage = opts.mediaRoot ? new MediaStorage(opts.mediaRoot) : undefined;
  const publishStore = opts.publishRoot ? new PublishStore(opts.publishRoot) : undefined;
  // Short-lived store of rendered preview docs, so they can be served (via a token
  // URL) under a `Content-Security-Policy: sandbox` for true WYSIWYG interactivity.
  const previewStore = new PreviewStore();
  const buildRunner = opts.buildRunner ?? new InProcessBuildRunner();
  const aiProvider = opts.aiProvider;
  const aiUsageRepo = new AiUsageRepository(db);
  const aiQuota = opts.aiQuota ?? {};
  const app = Fastify({
    // Redact deploy credentials defensively (Fastify omits bodies by default, but
    // guard against any future body logging).
    logger: opts.logger ? { redact: ['req.body.password', 'req.body.hostFingerprint'] } : false,
    // Behind a reverse proxy, trust X-Forwarded-For so req.ip (the rate-limit key)
    // is the real client IP instead of the proxy's (which would collapse all
    // clients to one bucket).
    trustProxy: opts.trustProxy ?? false,
  });

  // Plugins that integrate per-route (rate-limit hooks `onRoute`) must finish
  // loading BEFORE routes are registered, so these are awaited up front.
  await app.register(cookie, opts.cookieSecret ? { secret: opts.cookieSecret } : {});
  if (mediaStorage) {
    await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 } });
  }

  // Baseline security headers (the API also serves the SPA in single-container mode).
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    // A route may set its OWN Content-Security-Policy (the sandboxed preview-doc,
    // which needs `sandbox allow-scripts` + to be framable by the editor). When it
    // does, don't override its CSP — and skip the default DENY framing too, since
    // that route opts into its own framing policy.
    if (!reply.hasHeader('content-security-policy')) {
      reply.header('x-frame-options', 'DENY');
      reply.header(
        'content-security-policy',
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      );
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof UnauthorizedError) return reply.code(401).send({ error: err.message });
    if (err instanceof ForbiddenError) return reply.code(403).send({ error: err.message });
    if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
    if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: 'invalid request', details: err.flatten() });
    }
    // Tree-depth / range guards reject oversized input.
    if (err instanceof RangeError) return reply.code(400).send({ error: 'input too large' });
    // Upstream AI provider failures are transient/external, not server faults:
    // surface 5xx/429 as 503 (overloaded/retryable) and other 4xx as 502 (bad
    // gateway) — never the raw upstream body (could carry provider detail).
    if (err instanceof AiProviderError) {
      const code = err.upstreamStatus >= 500 || err.upstreamStatus === 429 ? 503 : 502;
      app.log.error(err);
      return reply.code(code).send({ error: 'AI provider unavailable — please try again' });
    }
    // Known library errors that carry their own status: rate-limit (429) and
    // body-too-large (413). Allowlisted (not the whole 4xx range) so a future
    // plugin's error message can't leak through.
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ error: 'rate limit exceeded — slow down' });
    if (status === 413) return reply.code(413).send({ error: 'request body too large' });
    app.log.error(err);
    return reply.code(500).send({ error: 'internal error' });
  });

  function sessionToken(req: FastifyRequest): string | undefined {
    // eslint-disable-next-line security/detect-object-injection -- SESSION_COOKIE is a constant cookie name
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return undefined;
    if (!signed) return raw;
    // When a secret is configured, only accept correctly-signed cookies.
    const unsigned = req.unsignCookie(raw);
    return unsigned.valid ? (unsigned.value ?? undefined) : undefined;
  }

  // Rate limiting: a generous global cap keyed per-user (session) or per-IP, with
  // stricter caps on expensive/sensitive routes (each route sets its own via config).
  // NOTE: behind a reverse proxy, enable Fastify `trustProxy` so req.ip is the real
  // client IP rather than the proxy's.
  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: RL_WINDOW,
    cache: 20_000, // explicit LRU key cap (bounds memory; documents intent)
    keyGenerator: (req) => sessionToken(req) ?? req.ip,
  });

  async function requireUserId(req: FastifyRequest): Promise<string> {
    const token = sessionToken(req);
    const userId = token ? await validateSession(db, token) : null;
    if (!userId) throw new UnauthorizedError('authentication required');
    return userId;
  }

  // Resolves a project context: authenticates, verifies org membership, and
  // confirms the project belongs to that org (404 otherwise). Returns the
  // ProjectContext plus the project record (for export/import identity).
  async function resolveProject(
    req: FastifyRequest<{ Params: { orgId: string; projectId: string } }>,
  ): Promise<{ ctx: ProjectContext; project: Awaited<ReturnType<ProjectRepository['get']>> }> {
    const userId = await requireUserId(req);
    const tenant = await tenantContext(db, userId, req.params.orgId);
    const project = await projects.get(tenant, req.params.projectId);
    return { ctx: { ...tenant, projectId: project.id }, project };
  }

  // Optional SSRF guard for deploy targets (multi-tenant SaaS): when an allow-list
  // is configured, only those exact hosts may be deployed to. Default (self-hosted):
  // any host, trusting the authenticated owner/admin operator.
  function assertDeployHostAllowed(host: string): void {
    const allow = opts.deployAllowedHosts;
    if (!allow || allow.length === 0) return;
    // Normalize for a case-insensitive, FQDN-trailing-dot-insensitive match. A
    // host carrying a `:port` simply won't match a bare entry → rejected (fail closed).
    const normalized = host.trim().toLowerCase().replace(/\.$/, '');
    if (!allow.includes(normalized)) {
      throw new ForbiddenError('deploy target host is not in the allowed list');
    }
  }
  // Serialize deploys per project (shared by ad-hoc and saved-target deploys).
  const activeDeploys = new Set<string>();

  app.post('/auth/register', { config: rl(10) }, async (req, reply) => {
    const body = RegisterBody.parse(req.body);
    const { userId, orgId } = await registerAccount(db, body.email, body.password, body.orgName);
    const { token, expiresAt } = await createSession(db, userId);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: opts.secureCookies ?? false,
      signed,
      expires: expiresAt,
    });
    return reply.code(201).send({ userId, orgId });
  });

  app.post('/auth/login', { config: rl(10) }, async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const userId = await login(db, body.email, body.password);
    const { token, expiresAt } = await createSession(db, userId);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: opts.secureCookies ?? false,
      signed,
      expires: expiresAt,
    });
    return reply.send({ userId });
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = sessionToken(req);
    if (token) await revokeSession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/me', async (req, reply) => {
    const userId = await requireUserId(req);
    return reply.send({ userId, orgs: await listOrgsForUser(db, userId) });
  });

  app.get('/orgs', async (req, reply) => {
    const userId = await requireUserId(req);
    return reply.send({ orgs: await listOrgsForUser(db, userId) });
  });

  app.get<{ Params: { orgId: string } }>('/orgs/:orgId/projects', async (req, reply) => {
    const userId = await requireUserId(req);
    const ctx = await tenantContext(db, userId, req.params.orgId);
    return reply.send({ projects: await projects.list(ctx) });
  });

  app.post<{ Params: { orgId: string } }>('/orgs/:orgId/projects', async (req, reply) => {
    const userId = await requireUserId(req);
    const ctx = await tenantContext(db, userId, req.params.orgId);
    const body = CreateProjectBody.parse(req.body);
    return reply.code(201).send({ project: await projects.create(ctx, body) });
  });

  app.get<{ Params: { orgId: string; id: string } }>(
    '/orgs/:orgId/projects/:id',
    async (req, reply) => {
      const userId = await requireUserId(req);
      const ctx = await tenantContext(db, userId, req.params.orgId);
      return reply.send({ project: await projects.get(ctx, req.params.id) });
    },
  );

  app.delete<{ Params: { orgId: string; id: string } }>(
    '/orgs/:orgId/projects/:id',
    { config: rl(20) },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const ctx = await tenantContext(db, userId, req.params.orgId);
      await projects.remove(ctx, req.params.id);
      // Best-effort on-disk cleanup: the published site + media directories have no
      // DB-level cascade. A failure here must NOT fail the delete (the rows are
      // already gone) — log and continue. Optional chaining no-ops when unconfigured.
      // Log only the error code/message (not the full error, which carries the
      // absolute fs path) to keep internal paths out of the logs.
      const onCleanupError = (what: string) => (err: unknown) =>
        req.log.warn(
          { what, errCode: (err as NodeJS.ErrnoException).code, errMsg: err instanceof Error ? err.message : String(err) },
          'project asset cleanup failed on delete',
        );
      await publishStore?.removeProject(req.params.id).catch(onCleanupError('publish'));
      await mediaStorage?.removeProject(req.params.id).catch(onCleanupError('media'));
      return reply.code(204).send();
    },
  );

  // ---- Project content (tenant + project scoped) ----
  type ContentParams = { orgId: string; projectId: string; kind: string; entityId: string };

  app.get<{ Params: Pick<ContentParams, 'orgId' | 'projectId' | 'kind'> }>(
    '/orgs/:orgId/projects/:projectId/content/:kind',
    async (req, reply) => {
      const { ctx } = await resolveProject(req);
      return reply.send({ items: await contentRepo.list(ctx, parseGenericKind(req.params.kind)) });
    },
  );

  app.get<{ Params: ContentParams }>(
    '/orgs/:orgId/projects/:projectId/content/:kind/:entityId',
    async (req, reply) => {
      const { ctx } = await resolveProject(req);
      const item = await contentRepo.get(ctx, parseGenericKind(req.params.kind), req.params.entityId);
      return reply.send({ item });
    },
  );

  app.put<{ Params: ContentParams }>(
    '/orgs/:orgId/projects/:projectId/content/:kind/:entityId',
    async (req, reply) => {
      const { ctx } = await resolveProject(req);
      const item = await contentRepo.put(
        ctx,
        parseGenericKind(req.params.kind),
        req.params.entityId,
        req.body,
      );
      return reply.send({ item });
    },
  );

  app.delete<{ Params: ContentParams }>(
    '/orgs/:orgId/projects/:projectId/content/:kind/:entityId',
    async (req, reply) => {
      const { ctx } = await resolveProject(req);
      await contentRepo.remove(ctx, parseGenericKind(req.params.kind), req.params.entityId);
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { orgId: string; projectId: string } }>(
    '/orgs/:orgId/projects/:projectId/export',
    async (req, reply) => {
      const { ctx, project } = await resolveProject(req);
      return reply.send(await contentRepo.exportBundle(ctx, project));
    },
  );

  app.post<{ Params: { orgId: string; projectId: string } }>(
    '/orgs/:orgId/projects/:projectId/import',
    { bodyLimit: IMPORT_BODY_LIMIT, config: rl(20) },
    async (req, reply) => {
      const { ctx, project } = await resolveProject(req);
      return reply.send(await contentRepo.importBundle(ctx, project, req.body));
    },
  );

  // Live SSR preview of a draft page. Renders an in-flight (possibly unsaved)
  // page tree to a full, brand-themed, self-contained HTML document using the
  // shared pure renderer. Tenant-scoped; any project member may preview.
  app.post<{ Params: { orgId: string; projectId: string } }>(
    '/orgs/:orgId/projects/:projectId/preview',
    { bodyLimit: PREVIEW_BODY_LIMIT, config: rl(120) },
    async (req, reply) => {
      const { ctx, project } = await resolveProject(req);
      // Guard recursion depth before the recursive Zod parse (untrusted tree).
      assertWithinTreeDepth((req.body as { root?: unknown } | null)?.root);
      const page = PageSchema.parse(req.body);

      // Brand comes from the saved settings singleton; fall back to the project
      // name with default tokens when settings have not been configured yet.
      let brand: Brand = { name: project.name, colors: {} };
      try {
        const settings = (await contentRepo.get(ctx, 'settings', SETTINGS_ENTITY_ID)) as Settings;
        brand = settings.brand;
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
      }

      // Group saved entries by dataset for binding resolution. Drafts are shown
      // in the preview (unlike a published build) so authors see work-in-progress.
      const entries = (await contentRepo.list(ctx, 'entry')) as Entry[];
      const byDataset = new Map<string, Entry[]>();
      for (const entry of entries) {
        byDataset.set(entry.dataset, [...(byDataset.get(entry.dataset) ?? []), entry]);
      }

      // Media powers optimized <picture> in the preview too, via the API-served URLs.
      const media = mediaStorage ? ((await contentRepo.list(ctx, 'media')) as MediaAsset[]) : [];
      // Auto-nav from the saved pages so Nav blocks render their menu in preview
      // (WYSIWYG parity with publish; an unsaved new page isn't in its own nav yet).
      const savedPages = (await contentRepo.list(ctx, 'page')) as Page[];
      const nav = {
        header: buildNav(savedPages, 'header'),
        footer: buildNav(savedPages, 'footer'),
        mobile: buildNav(savedPages, 'mobile'),
      };
      // The preview document is served (via a token URL) under `CSP: sandbox
      // allow-scripts` — an opaque, isolated origin — so styles AND the platform
      // component JS are INLINED to make it self-contained + truly interactive
      // (WYSIWYG). Gather component CSS/JS + utility CSS only when used.
      const classNames = collectClassNames(page.root);
      const { css: componentCss, js: componentJs } = componentAssets(usedComponentTypes(page.root));
      const inlineStyles: string[] = [];
      // Component CSS first, then Tailwind utilities last (so utilities win at
      // equal specificity) — mirrors the publish order (inline component CSS,
      // then the linked utility sheet).
      if (componentCss) inlineStyles.push(componentCss);
      if (classNames.length > 0) {
        inlineStyles.push(await compileUtilityCss([classNames.join(' ')], brandToTailwindTheme(brand)));
      }
      const html = renderDocument(page, {
        brand,
        datasets: Object.fromEntries(byDataset),
        includeDrafts: true,
        media,
        nav,
        mediaUrl: (asset, file) => `/media/${project.id}/${asset.id}/${file}`,
        inlineStyles: inlineStyles.length > 0 ? inlineStyles : undefined,
        inlineScripts: componentJs ? [componentJs] : undefined,
      });
      // Store the rendered doc behind an opaque token; the editor loads it via the
      // GET route below (which serves it under a sandbox CSP). `html` is still
      // returned for API consumers/tests that want it directly.
      const token = previewStore.put(html, { orgId: ctx.orgId, projectId: project.id, userId: ctx.userId });
      return reply.send({ html, token });
    },
  );

  // Serves a previously-rendered preview document for an opaque token. Returned as
  // `text/html` under `Content-Security-Policy: sandbox allow-scripts` — which
  // forces an OPAQUE, isolated origin even on direct navigation, so its scripts
  // (the inlined component behavior) run but cannot read the editor's cookies/
  // session or make credentialed API calls. The editor loads this via the iframe
  // `src` (NOT `srcDoc`), so the document uses THIS CSP rather than inheriting the
  // editor page's stricter one. The token is unguessable, short-lived, and bound
  // to (org, project, user); any member of the project may preview.
  app.get<{ Params: { orgId: string; projectId: string; token: string } }>(
    '/orgs/:orgId/projects/:projectId/preview/:token',
    async (req, reply) => {
      const { ctx, project } = await resolveProject(req);
      const html = previewStore.get(req.params.token, {
        orgId: ctx.orgId,
        projectId: project.id,
        userId: ctx.userId,
      });
      if (html === null) {
        return reply.code(404).type('text/html').send('<!doctype html><title>Preview expired</title>');
      }
      // `sandbox allow-scripts` (no `allow-same-origin`) → opaque origin: scripts
      // run, isolated. SAMEORIGIN framing lets the editor embed it; no third party.
      reply.header('content-security-policy', 'sandbox allow-scripts');
      reply.header('x-frame-options', 'SAMEORIGIN');
      return reply.type('text/html').send(html);
    },
  );

  // ---- Media (upload / list / delete + public serving) ----
  if (mediaStorage) {
    const storage = mediaStorage;

    // Upload an image: validate + optimize (AVIF/WebP/LQIP) + store binaries +
    // record tenant-scoped metadata. The pipeline rejects non-raster/SVG input.
    app.post<{ Params: { orgId: string; projectId: string } }>(
      '/orgs/:orgId/projects/:projectId/media',
      { config: rl(30) },
      async (req, reply) => {
        const { ctx, project } = await resolveProject(req);
        // Reject before reading the (potentially large) upload for non-writers.
        if (!WRITE_ROLES.has(ctx.role)) {
          return reply.code(403).send({ error: 'insufficient role for this operation' });
        }
        const file = await req.file();
        if (!file) return reply.code(400).send({ error: 'no file uploaded' });

        let buffer: Buffer;
        try {
          buffer = await file.toBuffer();
        } catch {
          // @fastify/multipart throws when the per-file size limit is exceeded.
          return reply.code(413).send({ error: 'file exceeds size limit' });
        }
        if (file.file.truncated) {
          return reply.code(413).send({ error: 'file exceeds size limit' });
        }

        const assetId = randomUUID();
        const { assetDir, inputPath } = await storage.stageUpload(project.id, assetId, buffer);
        try {
          const optimized = await withOptimizeSlot(() => optimizeImage(inputPath, assetDir));
          // Temp input is no longer needed once the variants exist.
          await storage.clearUpload(inputPath);
          const asset: MediaAsset = MediaAssetSchema.parse({
            id: assetId,
            filename: file.filename || 'upload',
            format: file.mimetype || 'image/*',
            bytes: buffer.length,
            width: optimized.width,
            height: optimized.height,
            placeholder: optimized.placeholder,
            variants: optimized.variants.map((v) => ({
              format: v.format,
              width: v.width,
              height: v.height,
              path: v.path,
            })),
            fallback: optimized.fallback,
            url: `/media/${project.id}/${assetId}/${optimized.fallback}`,
          });
          const saved = await contentRepo.put(ctx, 'media', assetId, asset);
          return reply.code(201).send({ item: saved });
        } catch (err) {
          // Any failure (bad image, validation, DB) → remove the whole asset dir
          // so no orphaned binaries linger.
          await storage.remove(project.id, assetId);
          if (err instanceof Error && /format|pixel|dimension|size limit/i.test(err.message)) {
            return reply.code(400).send({ error: 'unsupported or invalid image' });
          }
          throw err;
        }
      },
    );

    app.get<{ Params: { orgId: string; projectId: string } }>(
      '/orgs/:orgId/projects/:projectId/media',
      async (req, reply) => {
        const { ctx } = await resolveProject(req);
        return reply.send({ items: await contentRepo.list(ctx, 'media') });
      },
    );

    app.delete<{ Params: { orgId: string; projectId: string; id: string } }>(
      '/orgs/:orgId/projects/:projectId/media/:id',
      async (req, reply) => {
        const { ctx, project } = await resolveProject(req);
        // DB first: a leaked binary (if fs removal fails) is harmless and GC-able,
        // whereas a leaked DB row would block re-creating the same asset id.
        await contentRepo.remove(ctx, 'media', req.params.id);
        try {
          await storage.remove(project.id, req.params.id);
        } catch (err) {
          app.log.error({ err }, 'media binary removal failed after DB delete');
        }
        return reply.code(204).send();
      },
    );

    // Public serving of optimized binaries (published sites are public). The
    // storage layer validates every segment and confines the path to the asset
    // directory, so traversal is impossible.
    app.get<{ Params: { projectId: string; assetId: string; file: string } }>(
      '/media/:projectId/:assetId/:file',
      async (req, reply) => {
        const { projectId, assetId, file } = req.params;
        let bytes: Buffer;
        try {
          bytes = await storage.read(projectId, assetId, file);
        } catch {
          return reply.code(404).send({ error: 'not found' });
        }
        const ext = file.split('.').pop() ?? '';
        const type = MEDIA_CONTENT_TYPES.get(ext) ?? 'application/octet-stream';
        return reply
          .header('cache-control', 'public, max-age=31536000, immutable')
          .type(type)
          .send(bytes);
      },
    );
  }

  // ---- Publishing (build a static site + serve it) ----
  if (publishStore) {
    const store = publishStore;
    // Serialize builds/deploys per project: prevents concurrent operations from
    // racing on the same output directory (and bounds load).
    const activePublishes = new Set<string>();

    // Build/rebuild the project's static site from the current DB content.
    app.post<{ Params: { orgId: string; projectId: string } }>(
      '/orgs/:orgId/projects/:projectId/publish',
      { config: rl(20) },
      async (req, reply) => {
        const { ctx, project } = await resolveProject(req);
        if (!WRITE_ROLES.has(ctx.role)) {
          return reply.code(403).send({ error: 'insufficient role for this operation' });
        }
        if (activePublishes.has(project.id)) {
          return reply.code(409).send({ error: 'a build is already in progress for this project' });
        }
        activePublishes.add(project.id);
        try {
          const exp = await contentRepo.exportBundle(ctx, project);
          const bundle: ProjectBundle = {
            // ExportBundle.project omits formatVersion (it's a format concern, not a
            // DB field); re-add it to satisfy the ProjectBundle.project (Project) type.
            project: { formatVersion: exp.formatVersion, ...exp.project },
            pages: exp.pages,
            partials: exp.partials,
            templates: exp.templates,
            datasets: exp.datasets,
            entries: exp.entries,
          };
          const media = mediaStorage ? ((await contentRepo.list(ctx, 'media')) as MediaAsset[]) : [];
          const release = await buildRunner.run({
            outDir: store.dirFor(project.id),
            bundle,
            publishedAt: new Date().toISOString(),
            media,
            readMedia: mediaStorage
              ? (assetId, file) => mediaStorage.read(project.id, assetId, file)
              : undefined,
          });
          return reply.send({ release, url: `/sites/${project.id}/` });
        } catch (err) {
          // A bad route graph (duplicate slugs, unsafe segment) is author-correctable.
          if (err instanceof PublishError) {
            return reply.code(409).send({ error: err.message });
          }
          throw err;
        } finally {
          activePublishes.delete(project.id);
        }
      },
    );

    app.get<{ Params: { orgId: string; projectId: string } }>(
      '/orgs/:orgId/projects/:projectId/publish',
      async (req, reply) => {
        const { project } = await resolveProject(req);
        return reply.send({ release: await store.readRelease(project.id), url: `/sites/${project.id}/` });
      },
    );

    // Download the published site as a zip artifact (deploy it anywhere at a root).
    // Member-readable: the archive is the already-public published output (also
    // served unauthenticated at /sites/<id>/), so it needs no extra role gate.
    app.get<{ Params: { orgId: string; projectId: string } }>(
      '/orgs/:orgId/projects/:projectId/publish/archive',
      async (req, reply) => {
        const { project } = await resolveProject(req);
        if ((await store.readRelease(project.id)) === null) {
          return reply.code(409).send({ error: 'publish the site before exporting' });
        }
        const zip = await archiveSite(store.dirFor(project.id));
        return reply
          .header('content-disposition', `attachment; filename="${project.slug}-site.zip"`)
          .type('application/zip')
          .send(zip);
      },
    );

    // Deploy the published site to an external target (FTP / FTPS / SFTP). The
    // credentials in the body are used transiently and never persisted or logged.
    app.post<{ Params: { orgId: string; projectId: string } }>(
      '/orgs/:orgId/projects/:projectId/publish/deploy',
      { config: rl(20) },
      async (req, reply) => {
        const { ctx, project } = await resolveProject(req);
        if (!WRITE_ROLES.has(ctx.role)) {
          return reply.code(403).send({ error: 'insufficient role for this operation' });
        }
        if ((await store.readRelease(project.id)) === null) {
          return reply.code(409).send({ error: 'publish the site before deploying' });
        }
        const config = DeployConfigSchema.parse(req.body);
        assertDeployHostAllowed(config.host);
        if (activeDeploys.has(project.id)) {
          return reply.code(409).send({ error: 'a deploy is already in progress for this project' });
        }
        activeDeploys.add(project.id);
        try {
          const result = await deploySite(store.dirFor(project.id), config);
          return reply.send({ deployed: result });
        } catch (err) {
          // Connection/auth/transfer failure against the operator's target server.
          // Log the detail server-side; return a generic message so the response
          // does not leak the target's banner/timing (SSRF oracle reduction).
          // Log only the message (not the raw err object) so a library error that
          // happens to embed connection details can't reach the structured log.
          app.log.error(
            { host: config.host, protocol: config.protocol, errMsg: err instanceof Error ? err.message : String(err) },
            'deploy failed',
          );
          return reply.code(502).send({ error: 'deploy failed: could not connect or transfer to the target' });
        } finally {
          activeDeploys.delete(project.id);
        }
      },
    );

    // Public serving of the published static site (path-safe). HTML pages plus
    // the allowlisted text assets emitted by the builder (the compiled utility
    // sheet); binaries are served via /media.
    app.get<{ Params: { projectId: string; '*': string } }>(
      '/sites/:projectId/*',
      async (req, reply) => {
        const path = req.params['*'] ?? '';
        const asset = await store.readAsset(req.params.projectId, path);
        if (asset !== null) return reply.type(asset.contentType).send(asset.body);
        const html = await store.readHtml(req.params.projectId, path);
        if (html === null) return reply.code(404).type('text/html').send('<h1>404 — not published</h1>');
        return reply.type('text/html').send(html);
      },
    );
  }

  // Saved deploy targets (encrypted credentials) — independent of publish serving.
  if (opts.encryptionKey) {
    registerDeployTargetRoutes(app, {
      resolveProject,
      contentRepo,
      publishStore,
      encryptionKey: opts.encryptionKey,
      activeDeploys,
      assertDeployHostAllowed,
      isWriter: (ctx) => WRITE_ROLES.has(ctx.role),
      rl,
    });
  }

  // ---- AI (online generation — agency-funded, metered, quota-gated) ----
  // Resolves the org+user's month-to-date token usage against the configured caps.
  async function aiQuotaStatus(ctx: ProjectContext): Promise<{
    orgUsed: number;
    userUsed: number;
    orgOver: boolean;
    userOver: boolean;
  }> {
    const since = startOfMonthUTC(new Date());
    const orgUsed = aiQuota.orgMonthlyTokens ? await aiUsageRepo.tokensSince(ctx.orgId, since) : 0;
    const userUsed = aiQuota.userMonthlyTokens
      ? await aiUsageRepo.tokensSince(ctx.orgId, since, ctx.userId)
      : 0;
    return {
      orgUsed,
      userUsed,
      orgOver: Boolean(aiQuota.orgMonthlyTokens) && orgUsed >= (aiQuota.orgMonthlyTokens ?? 0),
      userOver: Boolean(aiQuota.userMonthlyTokens) && userUsed >= (aiQuota.userMonthlyTokens ?? 0),
    };
  }

  app.post<{ Params: { orgId: string; projectId: string } }>(
    '/orgs/:orgId/projects/:projectId/ai/generate',
    { config: rl(30) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req);
      if (!WRITE_ROLES.has(ctx.role)) {
        return reply.code(403).send({ error: 'insufficient role for this operation' });
      }
      if (!aiProvider) return reply.code(501).send({ error: 'AI is not configured' });
      const body = AiGenerateBody.parse(req.body);

      // Enforce monthly token caps BEFORE spending (agency-funded budget). This
      // is check-then-spend, not atomic: concurrent calls that both pass the
      // check can overshoot the cap by ~one completion each. Bounded by rl(30)
      // and a single self-hosted budget owner, so the worst case is a few cents
      // of overshoot per minute — acceptable here. Tighten with a serialized
      // per-org write if ever deployed under external per-tenant billing.
      const quota = await aiQuotaStatus(ctx);
      if (quota.orgOver) {
        return reply.code(429).send({ error: 'organization AI quota exhausted for this month' });
      }
      if (quota.userOver) {
        return reply.code(429).send({ error: 'your AI quota is exhausted for this month' });
      }

      // Token-minimizing contract: blocks → JSON tree; copy → plain text.
      const system =
        body.target === 'blocks'
          ? 'Generate Sitewright page content as ONE JSON object with the block-tree shape {id,type,props?,children?}. Output ONLY JSON — no prose, no code fences. Use semantic blocks; never inline styles.'
          : 'You are a concise corporate-website copywriter. Output plain text only — no markdown.';
      const completion = await aiProvider.complete({ system, prompt: body.instruction });
      await aiUsageRepo.record(ctx.orgId, ctx.userId, ctx.projectId, completion.model, completion.usage);

      let result: { text: string } | { node: unknown } = { text: completion.text };
      if (body.target === 'blocks') {
        try {
          const raw: unknown = JSON.parse(completion.text);
          // Bound recursion BEFORE Zod parses — a pathologically deep tree from
          // the model would otherwise overflow the stack during safeParse.
          assertWithinTreeDepth(raw);
          const parsed = PageNodeSchema.safeParse(raw);
          if (parsed.success) result = { node: parsed.data };
        } catch {
          // Model returned non-JSON or an over-deep tree; fall back to raw text.
        }
      }
      return reply.send({ result, usage: completion.usage, model: completion.model });
    },
  );

  // Month-to-date AI usage + limits (for a usage dashboard). Any org member may read.
  app.get<{ Params: { orgId: string } }>('/orgs/:orgId/ai/usage', async (req, reply) => {
    const userId = await requireUserId(req);
    const tenant = await tenantContext(db, userId, req.params.orgId);
    const since = startOfMonthUTC(new Date());
    // Both queries always run (unlike the generate path, which short-circuits
    // when no cap is set): the dashboard reports actual usage even with no cap.
    const orgUsed = await aiUsageRepo.tokensSince(tenant.orgId, since);
    const userUsed = await aiUsageRepo.tokensSince(tenant.orgId, since, userId);
    return reply.send({
      enabled: Boolean(aiProvider),
      period: 'month',
      org: { used: orgUsed, limit: aiQuota.orgMonthlyTokens ?? null },
      user: { used: userUsed, limit: aiQuota.userMonthlyTokens ?? null },
    });
  });

  app.get('/health', async () => ({ ok: true }));

  // Pull-based update check for the in-app banner. Public + informational.
  app.get('/version', async () => {
    const current = opts.version ?? '0.0.0';
    const latest = opts.latestVersion ? await opts.latestVersion() : null;
    return {
      current,
      latest,
      updateAvailable: latest ? isNewer(latest, current) : false,
      releaseUrl: opts.releaseUrl ?? null,
    };
  });

  // Single-container mode: serve the editor SPA at `/`, with a fallback to
  // index.html for non-API GET routes (client-side navigation / refresh).
  if (opts.editorDist) {
    await app.register(fastifyStatic, { root: opts.editorDist, prefix: '/', wildcard: false });
    // Rate-limit the catch-all so unknown-path probing/enumeration is throttled too.
    app.setNotFoundHandler({ preHandler: app.rateLimit() }, (req, reply) => {
      if (req.method === 'GET' && !isApiPath(req.url)) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not found' });
    });
  }

  return app;
}
