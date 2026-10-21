import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  WebmasterAccountsInputSchema,
  WebmasterServiceSchema,
  type SiteRegistrationView,
  type WebmasterAccountsView,
  type WebmasterService,
  type WebmasterTestResult,
} from '@sitewright/schema';
import { parseBingKey, testBing } from './bing.js';
import { parseGoogleKey, testGoogle, type GoogleServiceAccountKey } from './google.js';
import { EncryptionUnavailableError } from '../repo/instance-settings.js';
import type { ProjectContext } from '../repo/context.js';
import type { WebmasterRepository } from './repo.js';
import { WebmasterError, type WebmasterIo } from './request.js';
import type { SiteRegistrar } from './sites.js';

/**
 * The platform's search engine accounts, for instance admins only (session-only: no token reaches them).
 *
 *   GET  /admin/webmaster-accounts        what is stored: the Google key's email and project, set/unset for Bing
 *   PUT  /admin/webmaster-accounts        store, replace (`{google: {keyFile}}`, `{bing: {apiKey}}`) or remove (null)
 *   POST /admin/webmaster-accounts/test   try a stored account (`{service}`), reading only
 *
 * ★ A secret goes in and never comes out: no answer carries the private key or the API key, not even masked.
 */

export interface WebmasterRouteDeps {
  repo: WebmasterRepository;
  io: WebmasterIo;
  requireInstanceAdmin: (req: FastifyRequest) => Promise<string>;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

const LABEL: Record<WebmasterService, string> = { google: 'Google service-account key', bing: 'Bing API key' };
/** A key file is capped at 16 KB by the schema; the body never needs to be much more than that. */
const PUT_BODY_LIMIT = 64 * 1024;

export function registerWebmasterRoutes(app: FastifyInstance, deps: WebmasterRouteDeps): void {
  const { repo, io, requireInstanceAdmin, rl } = deps;

  async function view(): Promise<WebmasterAccountsView> {
    const rows = new Map((await repo.list()).map((r) => [r.service, r]));
    const google = rows.get('google');
    const bing = rows.get('bing');
    return {
      google: {
        configured: Boolean(google),
        clientEmail: google?.info.clientEmail ?? null,
        projectId: google?.info.projectId ?? null,
        updatedAt: google?.updatedAt.toISOString() ?? null,
      },
      bing: { configured: Boolean(bing), updatedAt: bing?.updatedAt.toISOString() ?? null },
    };
  }

  app.get('/admin/webmaster-accounts', { config: rl(60) }, async (req, reply) => {
    await requireInstanceAdmin(req);
    return reply.send(await view());
  });

  app.put('/admin/webmaster-accounts', { config: rl(30), bodyLimit: PUT_BODY_LIMIT }, async (req, reply) => {
    await requireInstanceAdmin(req);
    const parsed = WebmasterAccountsInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return reply.code(400).send({ error: issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'invalid request' });
    }
    const input = parsed.data;
    // Everything is checked BEFORE anything is stored, so a bad Bing key never leaves a new Google key half-saved.
    let google: GoogleServiceAccountKey | undefined;
    let bing: string | undefined;
    try {
      if (input.google) google = parseGoogleKey(input.google.keyFile);
      if (input.bing) bing = parseBingKey(input.bing.apiKey);
    } catch (err) {
      if (err instanceof WebmasterError) return reply.code(400).send({ error: err.message });
      throw err;
    }
    await repo.apply({
      ...(input.google === null ? { google: null } : {}),
      ...(google
        ? {
            google: {
              secret: { clientEmail: google.clientEmail, privateKey: google.privateKey, privateKeyId: google.privateKeyId, projectId: google.projectId },
              info: { clientEmail: google.clientEmail, projectId: google.projectId },
            },
          }
        : {}),
      ...(input.bing === null ? { bing: null } : {}),
      ...(bing ? { bing: { secret: { apiKey: bing }, info: {} } } : {}),
    });
    return reply.send(await view());
  });

  app.post('/admin/webmaster-accounts/test', { config: rl(10) }, async (req, reply) => {
    await requireInstanceAdmin(req);
    const service = WebmasterServiceSchema.safeParse((req.body as { service?: unknown } | undefined)?.service);
    if (!service.success) return reply.code(400).send({ error: 'service is google or bing' });
    let secret: Record<string, string> | null;
    try {
      secret = await repo.getSecret(service.data);
    } catch (err) {
      if (err instanceof EncryptionUnavailableError) throw err;
      // Sealed under another SW_ENCRYPTION_KEY (or damaged): the admin can fix it by entering the key again.
      return reply.send({ ok: false, error: `The stored ${LABEL[service.data]} cannot be read; enter it again` } satisfies WebmasterTestResult);
    }
    if (!secret) return reply.send({ ok: false, error: `No ${LABEL[service.data]} is stored` } satisfies WebmasterTestResult);
    try {
      const detail =
        service.data === 'google'
          ? await testGoogle(
              {
                clientEmail: secret.clientEmail ?? '',
                privateKey: secret.privateKey ?? '',
                privateKeyId: secret.privateKeyId ?? '',
                projectId: secret.projectId ?? '',
              },
              io,
            )
          : await testBing(secret.apiKey ?? '', io);
      return reply.send({ ok: true, detail } satisfies WebmasterTestResult);
    } catch (err) {
      if (err instanceof WebmasterError) return reply.send({ ok: false, error: err.message } satisfies WebmasterTestResult);
      throw err;
    }
  });
}

export interface SiteRegistrationRouteDeps {
  registrar: SiteRegistrar;
  resolveProject: (req: FastifyRequest<{ Params: { projectId: string } }>, access: 'session-only') => Promise<{ ctx: ProjectContext }>;
  /** Session-only agency staff (admin or developer); `action` completes the refusal. */
  requirePlatformStaff: (req: FastifyRequest, action: string) => Promise<string>;
  /** The website's Site URL as saved (`website.siteUrl`). */
  siteUrlOf: (ctx: ProjectContext) => Promise<string | undefined>;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

/**
 *   GET /projects/:projectId/search-engines   whether the site is registered with the platform's Google and Bing
 *                                             accounts, and why not — agency staff (session-only)
 *
 * Registration itself has no route: every publish and deploy does it (see `SiteRegistrar`).
 */
export function registerSiteRegistrationRoutes(app: FastifyInstance, deps: SiteRegistrationRouteDeps): void {
  const { registrar, resolveProject, requirePlatformStaff, siteUrlOf, rl } = deps;
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/search-engines', { config: rl(60) }, async (req, reply) => {
    await requirePlatformStaff(req, 'see search engine registration');
    const { ctx } = await resolveProject(req, 'session-only');
    return reply.send((await registrar.view(ctx.projectId, await siteUrlOf(ctx))) satisfies SiteRegistrationView);
  });
}
