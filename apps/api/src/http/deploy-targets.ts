import { newId } from '../id.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DeployTargetSchema, type DeployTarget, type EncryptedSecret } from '@sitewright/schema';
import { encryptSecret, decryptSecret } from '../crypto/secret.js';
import { deploySite, type DeployConfig, type DeployProgress } from '../publish/adapters.js';
import type { ContentRepository } from '../repo/content.js';
import type { PublishStore } from '../publish/store.js';
import type { ProjectContext } from '../repo/context.js';
import type { ApiKeyCapability } from '../db/schema.js';

const CreateDeployTargetBody = z
  .object({
    name: z.string().min(1).max(120),
    protocol: z.enum(['ftp', 'ftps', 'sftp']),
    host: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65535).optional(),
    user: z.string().min(1).max(255),
    password: z.string().min(1).max(1024).optional(),
    privateKey: z.string().min(1).max(16384).optional(), // SFTP private-key CONTENTS (PEM/OpenSSH)
    passphrase: z.string().min(1).max(1024).optional(),
    remoteDir: z.string().min(1).max(1024).optional(),
    hostFingerprint: z.string().min(1).max(256).optional(),
  })
  .refine((b) => b.password !== undefined || b.privateKey !== undefined, {
    message: 'a password or a private key is required',
    path: ['password'],
  })
  .refine((b) => b.privateKey === undefined || b.protocol === 'sftp', {
    message: 'a private key requires the SFTP protocol',
    path: ['privateKey'],
  });

/** The secret blob stored (encrypted) for a target. */
interface TargetCreds {
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

/** Encrypt the credential blob (password and/or private key + passphrase) as the target's secret. */
function encodeCreds(creds: TargetCreds, key: Buffer): EncryptedSecret {
  return encryptSecret(JSON.stringify(creds), key);
}

/** Decrypt a target's secret → credentials. Back-compat: a legacy secret holding a bare plaintext
 *  password (not JSON) is treated as `{ password }`. */
function decodeCreds(secret: EncryptedSecret, key: Buffer): TargetCreds {
  const raw = decryptSecret(secret, key);
  try {
    const obj: unknown = JSON.parse(raw);
    // Only a credential object (carrying a password or private key) is treated as the blob; any other
    // JSON (or a legacy plaintext password that isn't JSON) falls through to `{ password: raw }`.
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && ('password' in obj || 'privateKey' in obj)) {
      return obj as TargetCreds;
    }
  } catch {
    /* legacy: the secret was the plaintext password itself */
  }
  return { password: raw };
}

/** Build the transient DeployConfig for a saved target (decrypting its credentials at use). */
function targetToConfig(target: DeployTarget, key: Buffer): DeployConfig {
  const creds = decodeCreds(target.secret, key);
  return {
    protocol: target.protocol,
    host: target.host,
    port: target.port,
    user: target.user,
    ...(creds.password ? { password: creds.password } : {}),
    ...(creds.privateKey ? { privateKey: creds.privateKey } : {}),
    ...(creds.passphrase ? { passphrase: creds.passphrase } : {}),
    remoteDir: target.remoteDir,
    hostFingerprint: target.hostFingerprint,
  };
}

type ProjectReq = FastifyRequest<{ Params: { projectId: string } }>;

export interface DeployTargetDeps {
  resolveProject: (
    req: ProjectReq,
    access: ApiKeyCapability | 'session-only',
  ) => Promise<{ ctx: ProjectContext; project: { id: string; slug: string } }>;
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
 * Runs a deploy and STREAMS its progress as Server-Sent Events on the (hijacked) response:
 *   `event: progress` { phase, index, total, file } … then `event: done` { deployed } OR
 *   `event: error` { message }. The caller must have run all preflight checks (auth/lock/release)
 *   BEFORE calling this — once hijacked, only SSE frames are written.
 */
async function streamDeploy(
  reply: { hijack: () => void; raw: import('node:http').ServerResponse },
  siteDir: string,
  config: DeployConfig,
  log: { error: (obj: unknown, msg: string) => void },
): Promise<void> {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no', // disable proxy buffering so frames flush immediately
  });
  const send = (event: string, data: unknown): void => {
    raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  try {
    const result = await deploySite(siteDir, config, undefined, (e: DeployProgress) => send('progress', e));
    send('done', { deployed: result });
  } catch (err) {
    log.error(
      { host: config.host, protocol: config.protocol, errMsg: err instanceof Error ? err.message : String(err) },
      'streaming deploy failed',
    );
    // Generic message — never leak credentials/host internals (parity with the non-streaming route).
    send('error', { message: 'deploy failed: could not connect or transfer to the target' });
  } finally {
    raw.end();
  }
}

/**
 * Registers the saved-deploy-target routes (create/list/delete + deploy-by-id).
 * Credentials are encrypted at rest and never returned to clients.
 */
export function registerDeployTargetRoutes(app: FastifyInstance, deps: DeployTargetDeps): void {
  const { resolveProject, contentRepo, encryptionKey, activeDeploys, assertDeployHostAllowed, isWriter, rl } = deps;

  app.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/deploy-targets',
    { config: rl(20) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'deploy');
      if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const body = CreateDeployTargetBody.parse(req.body);
      assertDeployHostAllowed(body.host);
      const id = newId();
      const target = DeployTargetSchema.parse({
        id,
        name: body.name,
        protocol: body.protocol,
        host: body.host,
        ...(body.port ? { port: body.port } : {}),
        user: body.user,
        remoteDir: body.remoteDir ?? '/',
        ...(body.hostFingerprint ? { hostFingerprint: body.hostFingerprint } : {}),
        secret: encodeCreds(
          {
            ...(body.password ? { password: body.password } : {}),
            ...(body.privateKey ? { privateKey: body.privateKey } : {}),
            ...(body.passphrase ? { passphrase: body.passphrase } : {}),
          },
          encryptionKey,
        ),
      });
      const saved = (await contentRepo.put(ctx, 'deploy_target', id, target)) as DeployTarget;
      return reply.code(201).send({ target: sanitize(saved) });
    },
  );

  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/deploy-targets',
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'deploy');
      // Targets expose infrastructure metadata (host/user) — writers only.
      if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const items = (await contentRepo.list(ctx, 'deploy_target')) as DeployTarget[];
      return reply.send({ items: items.map(sanitize) });
    },
  );

  app.delete<{ Params: { projectId: string; id: string } }>(
    '/projects/:projectId/deploy-targets/:id',
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'deploy');
      await contentRepo.remove(ctx, 'deploy_target', req.params.id); // enforces write role
      return reply.code(204).send();
    },
  );

  // Deploy the published site using a saved target (decrypt password at use).
  app.post<{ Params: { projectId: string; id: string } }>(
    '/projects/:projectId/deploy-targets/:id/deploy',
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
        if ((await store.readRelease(project.slug)) === null) {
          return reply.code(409).send({ error: 'publish the site before deploying' });
        }
        try {
          const result = await deploySite(store.dirFor(project.slug), targetToConfig(target, encryptionKey));
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

  // Streaming variant: same preflight as above, but streams live per-file progress as SSE so the
  // editor's Deploy modal can show a determinate progress bar + errors.
  app.post<{ Params: { projectId: string; id: string } }>(
    '/projects/:projectId/deploy-targets/:id/deploy/stream',
    { config: rl(20) },
    async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'deploy');
      if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const store = deps.publishStore;
      if (!store) return reply.code(503).send({ error: 'publishing is not configured' });
      if (activeDeploys.has(project.id)) {
        return reply.code(409).send({ error: 'a deploy is already in progress for this project' });
      }
      activeDeploys.add(project.id);
      try {
        // Preflight (these can still send a normal JSON error — we have not hijacked yet).
        const target = (await contentRepo.get(ctx, 'deploy_target', req.params.id)) as DeployTarget;
        assertDeployHostAllowed(target.host);
        if ((await store.readRelease(project.slug)) === null) {
          return reply.code(409).send({ error: 'publish the site before deploying' });
        }
        // All checks passed → hijack + stream to completion (lock held until the stream ends).
        await streamDeploy(reply, store.dirFor(project.slug), targetToConfig(target, encryptionKey), app.log);
      } finally {
        activeDeploys.delete(project.id);
      }
    },
  );
}
