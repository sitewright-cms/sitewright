import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import {
  MediaAssetSchema,
  PageSchema,
  assertWithinTreeDepth,
  type Brand,
  type Entry,
  type MediaAsset,
} from '@sitewright/schema';
import { renderDocument } from '@sitewright/blocks';
import { optimizeImage } from '@sitewright/image-pipeline';
import type { ProjectBundle } from '@sitewright/core';
import type { Database } from '../db/client.js';
import { MediaStorage } from '../media/storage.js';
import { buildSite, PublishError } from '../publish/build.js';
import { PublishStore } from '../publish/store.js';
import { createSession, revokeSession, validateSession } from '../auth/sessions.js';
import {
  listOrgsForUser,
  login,
  registerAccount,
  tenantContext,
} from '../repo/accounts.js';
import { ProjectRepository } from '../repo/projects.js';
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

// Media rows are backed by on-disk binaries, so they must be created/deleted via
// the dedicated /media endpoints — reject generic content writes to keep the row
// and its files consistent (and to prevent a forged media `url`).
function parseWritableKind(kind: string): ContentKind {
  const parsed = parseKind(kind);
  if (parsed === 'media') {
    throw new ForbiddenError('media must be managed via the media endpoints');
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
}

export function createApp(opts: AppOptions): FastifyInstance {
  const { db } = opts;
  const signed = Boolean(opts.cookieSecret);
  const projects = new ProjectRepository(db);
  const contentRepo = new ContentRepository(db);
  const mediaStorage = opts.mediaRoot ? new MediaStorage(opts.mediaRoot) : undefined;
  const publishStore = opts.publishRoot ? new PublishStore(opts.publishRoot) : undefined;
  const app = Fastify({ logger: opts.logger ?? false });

  app.register(cookie, opts.cookieSecret ? { secret: opts.cookieSecret } : {});
  if (mediaStorage) {
    app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 } });
  }

  // Baseline security headers (the API also serves the SPA in single-container mode).
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'same-origin');
    reply.header(
      'content-security-policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
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

  app.post('/auth/register', async (req, reply) => {
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

  app.post('/auth/login', async (req, reply) => {
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
    async (req, reply) => {
      const userId = await requireUserId(req);
      const ctx = await tenantContext(db, userId, req.params.orgId);
      await projects.remove(ctx, req.params.id);
      return reply.code(204).send();
    },
  );

  // ---- Project content (tenant + project scoped) ----
  type ContentParams = { orgId: string; projectId: string; kind: string; entityId: string };

  app.get<{ Params: Pick<ContentParams, 'orgId' | 'projectId' | 'kind'> }>(
    '/orgs/:orgId/projects/:projectId/content/:kind',
    async (req, reply) => {
      const { ctx } = await resolveProject(req);
      return reply.send({ items: await contentRepo.list(ctx, parseKind(req.params.kind)) });
    },
  );

  app.get<{ Params: ContentParams }>(
    '/orgs/:orgId/projects/:projectId/content/:kind/:entityId',
    async (req, reply) => {
      const { ctx } = await resolveProject(req);
      const item = await contentRepo.get(ctx, parseKind(req.params.kind), req.params.entityId);
      return reply.send({ item });
    },
  );

  app.put<{ Params: ContentParams }>(
    '/orgs/:orgId/projects/:projectId/content/:kind/:entityId',
    async (req, reply) => {
      const { ctx } = await resolveProject(req);
      const item = await contentRepo.put(
        ctx,
        parseWritableKind(req.params.kind),
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
      await contentRepo.remove(ctx, parseWritableKind(req.params.kind), req.params.entityId);
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
    { bodyLimit: IMPORT_BODY_LIMIT },
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
    { bodyLimit: PREVIEW_BODY_LIMIT },
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

      const html = renderDocument(page, {
        brand,
        datasets: Object.fromEntries(byDataset),
        includeDrafts: true,
      });
      return reply.send({ html });
    },
  );

  // ---- Media (upload / list / delete + public serving) ----
  if (mediaStorage) {
    const storage = mediaStorage;

    // Upload an image: validate + optimize (AVIF/WebP/LQIP) + store binaries +
    // record tenant-scoped metadata. The pipeline rejects non-raster/SVG input.
    app.post<{ Params: { orgId: string; projectId: string } }>(
      '/orgs/:orgId/projects/:projectId/media',
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
    // Serialize builds per project: prevents two concurrent publishes from
    // racing on the same output directory (and bounds build load).
    const activePublishes = new Set<string>();

    // Build/rebuild the project's static site from the current DB content.
    app.post<{ Params: { orgId: string; projectId: string } }>(
      '/orgs/:orgId/projects/:projectId/publish',
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
            datasets: exp.datasets,
            entries: exp.entries,
          };
          const release = await buildSite({
            outDir: store.dirFor(project.id),
            bundle,
            publishedAt: new Date().toISOString(),
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

    // Public serving of the published static site (path-safe, html only).
    app.get<{ Params: { projectId: string; '*': string } }>(
      '/sites/:projectId/*',
      async (req, reply) => {
        const html = await store.readHtml(req.params.projectId, req.params['*'] ?? '');
        if (html === null) return reply.code(404).type('text/html').send('<h1>404 — not published</h1>');
        return reply.type('text/html').send(html);
      },
    );
  }

  app.get('/health', async () => ({ ok: true }));

  // Single-container mode: serve the editor SPA at `/`, with a fallback to
  // index.html for non-API GET routes (client-side navigation / refresh).
  if (opts.editorDist) {
    app.register(fastifyStatic, { root: opts.editorDist, prefix: '/', wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !isApiPath(req.url)) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not found' });
    });
  }

  return app;
}
