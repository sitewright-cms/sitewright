import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
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
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../repo/context.js';

const SESSION_COOKIE = 'sw_session';

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
}

export function createApp(opts: AppOptions): FastifyInstance {
  const { db } = opts;
  const signed = Boolean(opts.cookieSecret);
  const projects = new ProjectRepository(db);
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

  app.get('/health', async () => ({ ok: true }));

  return app;
}
