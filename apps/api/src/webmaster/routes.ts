import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  WEBMASTER_ACCOUNT_IN_USE,
  WebmasterAccountsInputSchema,
  WebmasterServiceSchema,
  SiteOwnersInputSchema,
  SiteRegistrationToggleSchema,
  WEBMASTER_SERVICES,
  type SiteRegistrationActionResult,
  type SiteRegistrationPrepareResult,
  type SiteRegistrationToggleResult,
  type SiteRegistrationVerifyResult,
  type SiteRegistrationView,
  type WebmasterAccountInUse,
  type WebmasterAccountsInUse,
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
import type { AccountHolding, SiteRegistrar } from './sites.js';

/**
 * The platform's search engine accounts, for instance admins only (session-only: no token reaches them).
 *
 *   GET  /admin/webmaster-accounts        what is stored: the Google key's email and project, set/unset for Bing
 *   PUT  /admin/webmaster-accounts        store, replace (`{google: {keyFile}}`, `{bing: {apiKey}}`) or remove (null);
 *                                         removing or replacing an account sites are still registered with is refused
 *                                         (409 `account-in-use`, with a count) unless `force: true`
 *   POST /admin/webmaster-accounts/test   try a stored account (`{service}`), reading only
 *
 * ★ A secret goes in and never comes out: no answer carries the private key or the API key, not even masked.
 */

export interface WebmasterRouteDeps {
  repo: WebmasterRepository;
  io: WebmasterIo;
  requireInstanceAdmin: (req: FastifyRequest) => Promise<string>;
  /** What moving off the current account (to `next`, or null = removing it) would leave there; see `SiteRegistrar.heldBy`. */
  heldBy: (service: WebmasterService, next: string | null) => Promise<AccountHolding>;
  /** The account a Bing key about to be saved is: the current one's for a new key of the same Bing user; see `SiteRegistrar.bingAccountFor`. */
  bingAccountFor: (apiKey: string) => Promise<string>;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

const sitesText = (n: number): string => (n === 1 ? '1 site is' : `${n} sites are`);

const LABEL: Record<WebmasterService, string> = { google: 'Google service-account key', bing: 'Bing API key' };
const ACCOUNT: Record<WebmasterService, string> = { google: 'Google service account', bing: 'Bing Webmaster account' };
/** A key file is capped at 16 KB by the schema; the body never needs to be much more than that. */
const PUT_BODY_LIMIT = 64 * 1024;

export function registerWebmasterRoutes(app: FastifyInstance, deps: WebmasterRouteDeps): void {
  const { repo, io, requireInstanceAdmin, heldBy, bingAccountFor, rl } = deps;

  /**
   * Why moving off ONE account is refused, in the shape System Settings then offers: switch the sites off first — or,
   * for a key that no longer works, remove (replace) it anyway, knowing what stays at the old account.
   */
  function inUseText(service: WebmasterService, held: AccountHolding, action: WebmasterAccountInUse['action']): string {
    // eslint-disable-next-line security/detect-object-injection -- service is a WEBMASTER_SERVICES literal
    const [account, label] = [ACCOUNT[service], LABEL[service]];
    const n = held.switchedOn + held.notRemoved;
    const stuck = (lead: string) => `${lead} still registered with ${held.switchedOn ? 'it' : `this ${account}`} although switched off or deleted (the removal did not get through)`;
    const what = [
      held.switchedOn ? `${sitesText(held.switchedOn)} switched on with this ${account}` : '',
      held.notRemoved ? stuck(held.switchedOn ? `${held.notRemoved} more ${held.notRemoved === 1 ? 'is' : 'are'}` : sitesText(held.notRemoved)) : '',
    ]
      .filter(Boolean)
      .join(', and ');
    const anyway = `if the ${label} no longer works, ${action} it anyway`;
    const how = held.switchedOn ? `Switch ${held.switchedOn === 1 ? 'it' : 'them'} off in the Search engines tile first, or, ${anyway}` : `${anyway[0]!.toUpperCase()}${anyway.slice(1)}`;
    // A new key of the same Bing user is no replacement (see `SiteRegistrar.bingAccountFor`): this one was not proved to be.
    const notSame = service === 'bing' && action === 'replace' ? ', and Bing did not confirm the new key is the same Bing user' : '';
    return `${what}${notSame}. ${how}: ${n === 1 ? 'that site stays' : `those ${n} sites stay`} registered at the old account, to be removed there by hand.`;
  }

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
    // Which Bing account the new key is: a new key of the same Bing user carries the current account on — asked even when
    // forced, since the registrations then stay valid instead of needing a new verification.
    const bingAccount = bing ? await bingAccountFor(bing) : undefined;
    // ★ Removing an account — or replacing it with ANOTHER one — while sites are registered with it leaves them at Google
    // or Bing with nobody able to take them off: only the account that registered a site can remove it. Refused with a
    // count unless forced (a key that no longer works can remove nothing anyway). The same account saved again is not
    // a change: Google's is the service account, Bing's the Bing user (the same key, or a new key Bing proves is theirs).
    if (!input.force) {
      const changes: Array<[WebmasterService, string | null]> = [];
      if (input.google === null) changes.push(['google', null]);
      else if (google) changes.push(['google', google.clientEmail]);
      if (input.bing === null) changes.push(['bing', null]);
      else if (bingAccount) changes.push(['bing', bingAccount]);
      // One entry per account in the way, each with its own count and words: a save can remove one and replace the other.
      const accounts: WebmasterAccountInUse[] = [];
      for (const [service, next] of changes) {
        const held = await heldBy(service, next);
        const count = held.switchedOn + held.notRemoved;
        const action = next === null ? 'remove' : 'replace';
        if (count > 0) accounts.push({ service, action, count, error: inUseText(service, held, action) });
      }
      if (accounts.length > 0) {
        const refusal: WebmasterAccountsInUse = {
          error: accounts.map((a) => a.error).join(' '),
          code: WEBMASTER_ACCOUNT_IN_USE,
          count: accounts.reduce((sum, a) => sum + a.count, 0),
          accounts,
        };
        return reply.code(409).send(refusal);
      }
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
      ...(bing && bingAccount ? { bing: { secret: { apiKey: bing, account: bingAccount }, info: {} } } : {}),
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
  /** The website's Production URL as saved (`website.siteUrl`). */
  siteUrlOf: (ctx: ProjectContext) => Promise<string | undefined>;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

/**
 * A project's registration with the platform's search engine accounts — agency staff only, in a session (no token):
 *
 *   GET  /projects/:projectId/search-engines                    on/off, status and messages per search engine
 *   PUT  /projects/:projectId/search-engines                    `{google?, bing?}` on/off; off removes the site there
 *   POST /projects/:projectId/search-engines/prepare            the tags, before the verification deploy
 *   POST /projects/:projectId/search-engines/:service/verify    one search engine confirms the tag on the live site
 *   POST /projects/:projectId/search-engines/:service/sitemap   hand the sitemap to a search engine that verified it
 *   PUT  /projects/:projectId/search-engines/google/owners      `{owners}`: who owns the site in Search Console
 *
 * The verification itself is run by the editor (the Search engines tile): prepare, deploy, then verify each.
 */
export function registerSiteRegistrationRoutes(app: FastifyInstance, deps: SiteRegistrationRouteDeps): void {
  const { registrar, resolveProject, requirePlatformStaff, siteUrlOf, rl } = deps;

  const staff = async (req: FastifyRequest<{ Params: { projectId: string } }>, action: string) => {
    await requirePlatformStaff(req, action);
    const { ctx } = await resolveProject(req, 'session-only');
    return { projectId: ctx.projectId, siteUrl: await siteUrlOf(ctx) };
  };

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/search-engines', { config: rl(60) }, async (req, reply) => {
    const { projectId, siteUrl } = await staff(req, 'see search engine registration');
    return reply.send((await registrar.view(projectId, siteUrl)) satisfies SiteRegistrationView);
  });

  app.put<{ Params: { projectId: string } }>('/projects/:projectId/search-engines', { config: rl(20) }, async (req, reply) => {
    const { projectId, siteUrl } = await staff(req, 'switch search engines on or off');
    const body = SiteRegistrationToggleSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'invalid request' });
    const view = await registrar.view(projectId, siteUrl);
    for (const service of WEBMASTER_SERVICES) {
      // eslint-disable-next-line security/detect-object-injection -- service is a WEBMASTER_SERVICES literal
      if (body.data[service] !== true) continue;
      // eslint-disable-next-line security/detect-object-injection -- service is a WEBMASTER_SERVICES literal
      if (!view[service].configured) return reply.code(409).send({ error: `The platform has no ${service === 'google' ? 'Google service account' : 'Bing Webmaster account'} yet` });
      if (!view.siteUrl) return reply.code(409).send({ error: 'Set an https Production URL first' });
    }
    const removed = await registrar.setEnabled(projectId, body.data);
    return reply.send({ removed, view: await registrar.view(projectId, siteUrl) } satisfies SiteRegistrationToggleResult);
  });

  app.post<{ Params: { projectId: string } }>('/projects/:projectId/search-engines/prepare', { config: rl(10) }, async (req, reply) => {
    const { projectId, siteUrl } = await staff(req, 'verify the site with search engines');
    const results = await registrar.prepare(projectId, siteUrl);
    return reply.send({ results, view: await registrar.view(projectId, siteUrl) } satisfies SiteRegistrationPrepareResult);
  });

  app.post<{ Params: { projectId: string; service: string } }>('/projects/:projectId/search-engines/:service/verify', { config: rl(20) }, async (req, reply) => {
    const { projectId, siteUrl } = await staff(req, 'verify the site with search engines');
    const service = WebmasterServiceSchema.safeParse(req.params.service);
    if (!service.success) return reply.code(404).send({ error: 'no such search engine' });
    const result = await registrar.verify(projectId, service.data, siteUrl);
    return reply.send({ result, view: await registrar.view(projectId, siteUrl) } satisfies SiteRegistrationVerifyResult);
  });

  app.post<{ Params: { projectId: string; service: string } }>('/projects/:projectId/search-engines/:service/sitemap', { config: rl(20) }, async (req, reply) => {
    const { projectId, siteUrl } = await staff(req, 'submit the sitemap to search engines');
    const service = WebmasterServiceSchema.safeParse(req.params.service);
    if (!service.success) return reply.code(404).send({ error: 'no such search engine' });
    const result = await registrar.submitSitemap(projectId, service.data, siteUrl);
    return reply.send({ result, view: await registrar.view(projectId, siteUrl) } satisfies SiteRegistrationActionResult);
  });

  app.put<{ Params: { projectId: string } }>('/projects/:projectId/search-engines/google/owners', { config: rl(20) }, async (req, reply) => {
    const { projectId, siteUrl } = await staff(req, 'choose who owns the site in Search Console');
    const body = SiteOwnersInputSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'invalid request' });
    const result = await registrar.setOwners(projectId, body.data.owners, siteUrl);
    return reply.send({ result, view: await registrar.view(projectId, siteUrl) } satisfies SiteRegistrationActionResult);
  });
}
