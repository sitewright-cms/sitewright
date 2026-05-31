import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DeployTargetSchema, type DeployTarget } from '@sitewright/schema';
import { encryptSecret, decryptSecret } from '../crypto/secret.js';
import { deploySite } from '../publish/adapters.js';
import type { ContentRepository } from '../repo/content.js';
import type { PublishStore } from '../publish/store.js';
import type { ProjectContext } from '../repo/context.js';
import type { ApiKeyCapability } from '../db/schema.js';

const CreateDeployTargetBody = z.object({
  name: z.string().min(1).max(120),
  protocol: z.enum(['ftp', 'ftps', 'sftp']),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).optional(),
  user: z.string().min(1).max(255),
  password: z.string().min(1).max(1024),
  remoteDir: z.string().min(1).max(1024).optional(),
  hostFingerprint: z.string().min(1).max(256).optional(),
});

type ProjectReq = FastifyRequest<{ Params: { orgId: string; projectId: string } }>;

export interface DeployTargetDeps {
  resolveProject: (
    req: ProjectReq,
    access: ApiKeyCapability | 'session-only',
  ) => Promise<{ ctx: ProjectContext; project: { id: string } }>;
  contentRepo: ContentRepository;
  publishStore?: PublishStore;
  encryptionKey: Buffer;
  /** Per-project deploy lock, shared with the ad-hoc deploy route. */
  activeDeploys: Set<string>;
  assertDeployHostAllowed: (host: string) => void;
  isWriter: (ctx: ProjectContext) => boolean;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

/** Public view of a target — never the encrypted secret. */
function sanitize(t: DeployTarget): Record<string, unknown> {
  return Object.fromEntries(Object.entries(t).filter(([k]) => k !== 'secret'));
}

/**
 * Registers the saved-deploy-target routes (create/list/delete + deploy-by-id).
 * Credentials are encrypted at rest and never returned to clients.
 */
export function registerDeployTargetRoutes(app: FastifyInstance, deps: DeployTargetDeps): void {
  const { resolveProject, contentRepo, encryptionKey, activeDeploys, assertDeployHostAllowed, isWriter, rl } = deps;

  app.post<{ Params: { orgId: string; projectId: string } }>(
    '/orgs/:orgId/projects/:projectId/deploy-targets',
    { config: rl(20) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'deploy');
      if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const body = CreateDeployTargetBody.parse(req.body);
      assertDeployHostAllowed(body.host);
      const id = randomUUID();
      const target = DeployTargetSchema.parse({
        id,
        name: body.name,
        protocol: body.protocol,
        host: body.host,
        ...(body.port ? { port: body.port } : {}),
        user: body.user,
        remoteDir: body.remoteDir ?? '/',
        ...(body.hostFingerprint ? { hostFingerprint: body.hostFingerprint } : {}),
        secret: encryptSecret(body.password, encryptionKey),
      });
      const saved = (await contentRepo.put(ctx, 'deploy_target', id, target)) as DeployTarget;
      return reply.code(201).send({ target: sanitize(saved) });
    },
  );

  app.get<{ Params: { orgId: string; projectId: string } }>(
    '/orgs/:orgId/projects/:projectId/deploy-targets',
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'deploy');
      // Targets expose infrastructure metadata (host/user) — writers only.
      if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const items = (await contentRepo.list(ctx, 'deploy_target')) as DeployTarget[];
      return reply.send({ items: items.map(sanitize) });
    },
  );

  app.delete<{ Params: { orgId: string; projectId: string; id: string } }>(
    '/orgs/:orgId/projects/:projectId/deploy-targets/:id',
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'deploy');
      await contentRepo.remove(ctx, 'deploy_target', req.params.id); // enforces write role
      return reply.code(204).send();
    },
  );

  // Deploy the published site using a saved target (decrypt password at use).
  app.post<{ Params: { orgId: string; projectId: string; id: string } }>(
    '/orgs/:orgId/projects/:projectId/deploy-targets/:id/deploy',
    { config: rl(20) },
    async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'deploy');
      if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const store = deps.publishStore;
      if (!store) return reply.code(503).send({ error: 'publishing is not configured' });
      // Claim the per-project deploy slot before any async I/O to close the race.
      if (activeDeploys.has(project.id)) {
        return reply.code(409).send({ error: 'a deploy is already in progress for this project' });
      }
      activeDeploys.add(project.id);
      try {
        // Domain errors (404 missing target / 403 host not allowed) propagate to the
        // global handler — not the deploy 502 below.
        const target = (await contentRepo.get(ctx, 'deploy_target', req.params.id)) as DeployTarget;
        assertDeployHostAllowed(target.host);
        if ((await store.readRelease(project.id)) === null) {
          return reply.code(409).send({ error: 'publish the site before deploying' });
        }
        try {
          const result = await deploySite(store.dirFor(project.id), {
            protocol: target.protocol,
            host: target.host,
            port: target.port,
            user: target.user,
            password: decryptSecret(target.secret, encryptionKey),
            remoteDir: target.remoteDir,
            hostFingerprint: target.hostFingerprint,
          });
          return reply.send({ deployed: result });
        } catch (err) {
          app.log.error(
            { host: target.host, protocol: target.protocol, errMsg: err instanceof Error ? err.message : String(err) },
            'saved-target deploy failed',
          );
          return reply.code(502).send({ error: 'deploy failed: could not connect or transfer to the target' });
        }
      } finally {
        activeDeploys.delete(project.id);
      }
    },
  );
}
