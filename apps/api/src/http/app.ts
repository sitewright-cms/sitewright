import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { createSession, revokeSession, validateSession } from '../auth/sessions.js';
import {
  listOrgsForUser,
  login,
  registerAccount,
  tenantContext,
} from '../repo/accounts.js';
import { ProjectRepository } from '../repo/projects.js';
import { ContentRepository, CONTENT_KINDS } from '../repo/content.js';
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
const API_PREFIXES = ['/auth', '/orgs', '/me', '/health'];

function isApiPath(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
const CONTENT_KIND_SET: ReadonlySet<string> = new Set(CONTENT_KINDS);

function parseKind(kind: string): ContentKind {
  if (!CONTENT_KIND_SET.has(kind)) throw new NotFoundError(`unknown content kind: ${kind}`);
  return kind as ContentKind;
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
}

export function createApp(opts: AppOptions): FastifyInstance {
  const { db } = opts;
  const signed = Boolean(opts.cookieSecret);
  const projects = new ProjectRepository(db);
  const contentRepo = new ContentRepository(db);
  const app = Fastify({ logger: opts.logger ?? false });

  app.register(cookie, opts.cookieSecret ? { secret: opts.cookieSecret } : {});

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
      sameSite: 'lax',
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
      sameSite: 'lax',
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
        parseKind(req.params.kind),
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
      await contentRepo.remove(ctx, parseKind(req.params.kind), req.params.entityId);
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
