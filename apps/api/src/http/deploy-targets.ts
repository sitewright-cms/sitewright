import { rm } from 'node:fs/promises';
import { newId } from '../id.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DeployTargetSchema, isSshRepoUrl, gitRepoHost, type DeployTarget, type EncryptedSecret } from '@sitewright/schema';
import { encryptSecret, decryptSecret } from '../crypto/secret.js';
import { deploySite, type DeployConfig } from '../publish/adapters.js';
import { deployGit, type GitDeployConfig } from '../publish/git-deploy.js';
import { deployGitSsh, type GitSshDeployConfig } from '../publish/git-ssh-deploy.js';
import { PublishError } from '../publish/build.js';
import { JsonDataError } from '../publish/json-data.js';
import type { ContentRepository } from '../repo/content.js';
import type { ProjectContext } from '../repo/context.js';
import type { ApiKeyCapability } from '../db/schema.js';

const CreateDeployTargetBody = z
  .object({
    name: z.string().min(1).max(120),
    protocol: z.enum(['local', 'ftp', 'ftps', 'sftp', 'git']),
    // ── Remote-transport fields (FTP/FTPS/SFTP) ──
    host: z.string().min(1).max(255).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    user: z.string().min(1).max(255).optional(),
    password: z.string().min(1).max(1024).optional(),
    privateKey: z.string().min(1).max(16384).optional(), // SFTP or git-SSH private-key CONTENTS (PEM/OpenSSH)
    passphrase: z.string().min(1).max(1024).optional(),
    remoteDir: z.string().min(1).max(1024).optional(),
    // SFTP host-key fingerprint, OR a git-SSH `known_hosts` host-key line (for pinning).
    hostFingerprint: z.string().min(1).max(1024).optional(),
    // ── Local Hosting serve options ──
    previewToken: z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/, 'previewToken must be url-safe').optional(),
    minifyHtml: z.boolean().optional(),
    // ── git fields ──
    repoUrl: z.string().min(1).max(2048).optional(),
    branch: z.string().min(1).max(255).optional(),
    token: z.string().min(1).max(1024).optional(), // HTTPS personal-access token (http(s) repoUrl)
  })
  // FTP/FTPS/SFTP need a host + user.
  .refine((b) => (b.protocol !== 'ftp' && b.protocol !== 'ftps' && b.protocol !== 'sftp') || (!!b.host && !!b.user), {
    message: 'host and user are required for an FTP/FTPS/SFTP target',
    path: ['host'],
  })
  // …and a credential (password or key).
  .refine((b) => (b.protocol !== 'ftp' && b.protocol !== 'ftps' && b.protocol !== 'sftp') || b.password !== undefined || b.privateKey !== undefined, {
    message: 'a password or a private key is required',
    path: ['password'],
  })
  // A private key is only meaningful for SFTP or git (over SSH).
  .refine((b) => b.privateKey === undefined || b.protocol === 'sftp' || b.protocol === 'git', {
    message: 'a private key requires the SFTP or git protocol',
    path: ['privateKey'],
  })
  // git needs a repoUrl + branch, plus a token (http(s) remote) OR a private key (ssh remote).
  .refine(
    (b) => {
      if (b.protocol !== 'git') return true;
      if (!b.repoUrl || !b.branch) return false;
      return isSshRepoUrl(b.repoUrl) ? !!b.privateKey : !!b.token;
    },
    { message: 'a git target needs a branch and either a token (https remote) or a private key (ssh remote)', path: ['repoUrl'] },
  );

/** The secret blob stored (encrypted) for a target — FTP/SFTP credentials, or a git token. */
interface TargetCreds {
  password?: string;
  privateKey?: string;
  passphrase?: string;
  token?: string;
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
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && ('password' in obj || 'privateKey' in obj || 'token' in obj)) {
      return obj as TargetCreds;
    }
  } catch {
    /* legacy: the secret was the plaintext password itself */
  }
  return { password: raw };
}

/** Build the transient DeployConfig for a saved REMOTE target (decrypting its credentials at use).
 *  Only called for a non-`local` target — the schema guarantees host/user/secret are present there. */
function targetToConfig(target: DeployTarget, key: Buffer): DeployConfig {
  const creds = decodeCreds(target.secret!, key);
  return {
    protocol: target.protocol as DeployConfig['protocol'],
    host: target.host!,
    port: target.port,
    user: target.user!,
    ...(creds.password ? { password: creds.password } : {}),
    ...(creds.privateKey ? { privateKey: creds.privateKey } : {}),
    ...(creds.passphrase ? { passphrase: creds.passphrase } : {}),
    remoteDir: target.remoteDir ?? '/',
    hostFingerprint: target.hostFingerprint,
  };
}

/** Build the transient GitDeployConfig for a saved `git` target (decrypting its token at use).
 *  Only called for a `git` target — the schema guarantees repoUrl/branch/secret are present. */
function targetToGitConfig(target: DeployTarget, key: Buffer): GitDeployConfig {
  const { token } = decodeCreds(target.secret!, key);
  // A corrupted/legacy secret without a token would otherwise push with empty creds → a confusing 401.
  if (!token) throw new Error('git deploy target has no stored token — re-save it with a new token');
  return { repoUrl: target.repoUrl!, branch: target.branch!, token };
}

/** Build the transient GitSshDeployConfig for a saved SSH `git` target (decrypting its key at use).
 *  `hostFingerprint` carries the optional pinned `known_hosts` host-key line for a git-SSH target. */
function targetToGitSshConfig(target: DeployTarget, key: Buffer): GitSshDeployConfig {
  const { privateKey, passphrase } = decodeCreds(target.secret!, key);
  if (!privateKey) throw new Error('git deploy target has no stored private key — re-save it with a new key');
  return {
    repoUrl: target.repoUrl!,
    branch: target.branch!,
    privateKey,
    ...(passphrase ? { passphrase } : {}),
    ...(target.hostFingerprint ? { hostKey: target.hostFingerprint } : {}),
  };
}

/** The host to SSRF-check for a target: the repo host for `git` (http(s) or ssh), the server host else. */
function deployHostOf(target: DeployTarget): string {
  return target.protocol === 'git' ? gitRepoHost(target.repoUrl!) : target.host!;
}

type ProjectReq = FastifyRequest<{ Params: { projectId: string } }>;

export interface DeployTargetDeps {
  resolveProject: (
    req: ProjectReq,
    access: ApiKeyCapability | 'session-only',
  ) => Promise<{ ctx: ProjectContext; project: { id: string; slug: string } }>;
  contentRepo: ContentRepository;
  encryptionKey: Buffer;
  /** Per-project deploy lock, shared with the ad-hoc deploy route. */
  activeDeploys: Set<string>;
  assertDeployHostAllowed: (host: string) => void;
  isWriter: (ctx: ProjectContext) => boolean;
  /** Build the site fresh into a temp dir at deploy time, returning its path (caller removes it). */
  buildForDeploy: (ctx: ProjectContext, projectId: string) => Promise<string>;
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
  run: (onProgress: (e: unknown) => void) => Promise<unknown>,
  logCtx: Record<string, unknown>,
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
    const result = await run((e) => send('progress', e));
    send('done', { deployed: result });
  } catch (err) {
    log.error({ ...logCtx, errMsg: err instanceof Error ? err.message : String(err) }, 'streaming deploy failed');
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
      // At most one Local Hosting target per project — it is THE local-serving config (findLocalTarget
      // picks one), so a second would silently shadow the first's serve options.
      if (body.protocol === 'local') {
        const existing = (await contentRepo.list(ctx, 'deploy_target')) as DeployTarget[];
        if (existing.some((t) => t.protocol === 'local')) {
          return reply.code(409).send({ error: 'a Local Hosting target already exists for this project' });
        }
      }
      // SSRF-check the destination host: the server host for FTP/SFTP, the repo host for git. (A local
      // target has no host to check.)
      if (body.protocol === 'ftp' || body.protocol === 'ftps' || body.protocol === 'sftp') {
        assertDeployHostAllowed(body.host!);
      } else if (body.protocol === 'git') {
        let repoHost: string;
        try {
          repoHost = gitRepoHost(body.repoUrl!);
        } catch {
          return reply.code(400).send({ error: 'repoUrl must be a valid http(s) or ssh URL' });
        }
        assertDeployHostAllowed(repoHost);
      }
      const id = newId();
      // A `local` (Local Hosting) target has no host/credentials — only serve options; a remote
      // target carries the encrypted credentials + the validated host.
      const target = DeployTargetSchema.parse(
        body.protocol === 'local'
          ? {
              id,
              name: body.name,
              protocol: 'local',
              ...(body.previewToken ? { previewToken: body.previewToken } : {}),
              ...(body.minifyHtml ? { minifyHtml: true } : {}),
            }
          : body.protocol === 'git'
            ? {
                id,
                name: body.name,
                protocol: 'git',
                repoUrl: body.repoUrl,
                branch: body.branch,
                // SSH remote → encrypt the private key (+ passphrase) and keep the optional pinned host
                // key; HTTPS remote → encrypt the token.
                ...(isSshRepoUrl(body.repoUrl!) && body.hostFingerprint ? { hostFingerprint: body.hostFingerprint } : {}),
                secret: isSshRepoUrl(body.repoUrl!)
                  ? encodeCreds(
                      { privateKey: body.privateKey, ...(body.passphrase ? { passphrase: body.passphrase } : {}) },
                      encryptionKey,
                    )
                  : encodeCreds({ token: body.token }, encryptionKey),
              }
            : {
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
            },
      );
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
      if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      await contentRepo.remove(ctx, 'deploy_target', req.params.id);
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
      // Claim the per-project deploy slot before any async I/O to close the race.
      if (activeDeploys.has(project.id)) {
        return reply.code(409).send({ error: 'a deploy is already in progress for this project' });
      }
      activeDeploys.add(project.id);
      try {
        // Domain errors (404 missing target / 403 host not allowed) propagate to the
        // global handler — not the deploy 502 below.
        const target = (await contentRepo.get(ctx, 'deploy_target', req.params.id)) as DeployTarget;
        if (target.protocol === 'local') {
          return reply.code(400).send({ error: 'a Local Hosting target is published via the Publish action, not deployed here' });
        }
        assertDeployHostAllowed(deployHostOf(target));
        // Build the site FRESH (build-at-deploy-time — no prior publish needed); a build failure
        // (bad route graph / json_data URL) is author-correctable → 409.
        let dir: string;
        try {
          dir = await deps.buildForDeploy(ctx, project.id);
        } catch (err) {
          if (err instanceof PublishError || err instanceof JsonDataError) {
            return reply.code(409).send({ error: err.message });
          }
          throw err;
        }
        try {
          const result =
            target.protocol === 'git'
              ? isSshRepoUrl(target.repoUrl!)
                ? await deployGitSsh(dir, targetToGitSshConfig(target, encryptionKey))
                : await deployGit(dir, targetToGitConfig(target, encryptionKey))
              : await deploySite(dir, targetToConfig(target, encryptionKey));
          return reply.send({ deployed: result });
        } catch (err) {
          app.log.error(
            { host: deployHostOf(target), protocol: target.protocol, errMsg: err instanceof Error ? err.message : String(err) },
            'saved-target deploy failed',
          );
          return reply.code(502).send({ error: 'deploy failed: could not connect or transfer to the target' });
        } finally {
          await rm(dir, { recursive: true, force: true });
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
      if (activeDeploys.has(project.id)) {
        return reply.code(409).send({ error: 'a deploy is already in progress for this project' });
      }
      activeDeploys.add(project.id);
      try {
        // Preflight (these can still send a normal JSON error — we have not hijacked yet).
        const target = (await contentRepo.get(ctx, 'deploy_target', req.params.id)) as DeployTarget;
        if (target.protocol === 'local') {
          return reply.code(400).send({ error: 'a Local Hosting target is published via the Publish action, not deployed here' });
        }
        assertDeployHostAllowed(deployHostOf(target));
        // Build the site FRESH before hijacking, so a build error is a normal JSON 409 (not an SSE frame).
        let dir: string;
        try {
          dir = await deps.buildForDeploy(ctx, project.id);
        } catch (err) {
          if (err instanceof PublishError || err instanceof JsonDataError) {
            return reply.code(409).send({ error: err.message });
          }
          throw err;
        }
        // Stream the transport: a git push (over SSH or HTTPS), or an FTP/SFTP upload. Each forwards its
        // progress events.
        const run =
          target.protocol === 'git'
            ? isSshRepoUrl(target.repoUrl!)
              ? (onProgress: (e: unknown) => void) => deployGitSsh(dir, targetToGitSshConfig(target, encryptionKey), (p) => onProgress(p))
              : (onProgress: (e: unknown) => void) => deployGit(dir, targetToGitConfig(target, encryptionKey), (p) => onProgress(p))
            : (onProgress: (e: unknown) => void) => deploySite(dir, targetToConfig(target, encryptionKey), undefined, (p) => onProgress(p));
        try {
          // All checks passed → hijack + stream to completion (lock held until the stream ends).
          await streamDeploy(reply, run, { host: deployHostOf(target), protocol: target.protocol }, app.log);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      } finally {
        activeDeploys.delete(project.id);
      }
    },
  );
}
