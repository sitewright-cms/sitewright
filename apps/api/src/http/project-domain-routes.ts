import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  MAX_DOMAINS_PER_PROJECT,
  VERIFICATION_TXT_PREFIX,
  normalizeHost,
  reservedHostReason,
  type ProjectDomainRepository,
  type ProjectDomainView,
} from '../repo/project-domains.js';
import { verifyDomainTxt, type TxtLookup } from '../net/dns-verify.js';

const ClaimBody = z.object({ host: z.string().min(1).max(300) });

export interface ProjectDomainDeps {
  domains: ProjectDomainRepository;
  /** Owner-only, session-only project access (a Bearer token must not reach these). */
  requireOwner: (req: FastifyRequest, projectId: string) => Promise<{ userId: string }>;
  /** Platform staff (admin OR developer) — the force-verify escape hatch. Throws otherwise. */
  requireStaff: (req: FastifyRequest, action: string) => Promise<string>;
  /** Hosts the instance itself answers on, read live (the additional list is an admin setting). */
  platformHosts: () => string[];
  /** `SW_SITES_DOMAIN`, already normalized, when subdomain hosting is configured. */
  sitesDomain?: string;
  /** Rebuild the routing map — called after any change that can affect which hosts serve. */
  refreshRoutes: () => Promise<void>;
  /** Injectable for tests; the live one queries DNS. */
  txtLookup?: TxtLookup;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

/** The claim plus the DNS record the operator has to publish — so the UI never has to build it. */
function withInstructions(d: ProjectDomainView) {
  return {
    ...d,
    verified: d.verifiedAt !== null,
    dns: { type: 'TXT', name: `${VERIFICATION_TXT_PREFIX}.${d.host}`, value: d.verificationToken },
  };
}

/**
 * Custom-domain claims for a locally-hosted project.
 *
 * Authorization is deliberately asymmetric. Claiming, releasing and re-pointing a domain is the project
 * OWNER's business — it is their site's address. Force-verifying without DNS proof is PLATFORM STAFF's,
 * because it is the one operation that bypasses the only evidence of ownership the platform has.
 */
export function registerProjectDomainRoutes(app: FastifyInstance, deps: ProjectDomainDeps): void {
  const { domains, requireOwner, requireStaff, platformHosts, sitesDomain, refreshRoutes, rl } = deps;

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/domains', { config: rl(60) }, async (req, reply) => {
    await requireOwner(req, req.params.projectId);
    const items = await domains.listForProject(req.params.projectId);
    return reply.send({ items: items.map(withInstructions) });
  });

  app.post<{ Params: { projectId: string } }>('/projects/:projectId/domains', { config: rl(20) }, async (req, reply) => {
    const { projectId } = req.params;
    const { userId } = await requireOwner(req, projectId);
    const { host: raw } = ClaimBody.parse(req.body);

    const host = normalizeHost(raw);
    if (!host) return reply.code(400).send({ error: `"${raw}" is not a valid hostname` });

    // Hosts the instance owns: claiming one would take the app (or another project's automatic
    // address) offline rather than merely being disallowed. See reservedHostReason.
    const reserved = reservedHostReason(host, {
      platformHosts: platformHosts(),
      ...(sitesDomain ? { sitesDomain } : {}),
    });
    if (reserved) return reply.code(409).send({ error: reserved });

    if ((await domains.countForProject(projectId)) >= MAX_DOMAINS_PER_PROJECT) {
      return reply.code(409).send({ error: `a project can have at most ${MAX_DOMAINS_PER_PROJECT} custom domains` });
    }

    const result = await domains.claim({ projectId, host, createdBy: userId });
    if ('reason' in result) return reply.code(409).send({ error: result.message });
    // A claim never serves anything until it verifies, so the map is unchanged — but a displaced
    // unverified row could in principle have been verified between read and write, so refresh anyway.
    await refreshRoutes();
    req.log.info({ projectId, host, userId }, 'custom domain claimed');
    return reply.code(201).send({ domain: withInstructions(result.domain) });
  });

  /**
   * Check DNS and activate the host if the TXT record is in place.
   *
   * `pending` (the record has not propagated) answers 200 with `verified: false` rather than an error:
   * it is the expected state for the first minutes after an operator edits DNS, and an error would send
   * them re-editing a record that is already correct.
   */
  app.post<{ Params: { projectId: string; id: string } }>('/projects/:projectId/domains/:id/verify', { config: rl(30) }, async (req, reply) => {
    const { projectId, id } = req.params;
    await requireOwner(req, projectId);
    const domain = await domains.getForProject(projectId, id);
    if (!domain) return reply.code(404).send({ error: 'domain not found' });
    if (domain.verifiedAt) return reply.send({ verified: true, domain: withInstructions(domain) });

    const result = await verifyDomainTxt(domain.host, domain.verificationToken, deps.txtLookup);
    if (!result.ok) {
      return reply.send({ verified: false, state: result.state, detail: result.detail, domain: withInstructions(domain) });
    }
    await domains.markVerified(id);
    await refreshRoutes();
    req.log.info({ projectId, host: domain.host }, 'custom domain verified');
    const fresh = await domains.getForProject(projectId, id);
    return reply.send({ verified: true, domain: withInstructions(fresh ?? domain) });
  });

  /**
   * Force-verify without a DNS check — PLATFORM STAFF only.
   *
   * The escape hatch for a domain whose DNS the operator controls out-of-band, or a provider whose TXT
   * records this resolver cannot see. It is staff-only because it is the one call that asserts ownership
   * with no evidence; the audit line records who did it.
   */
  app.post<{ Params: { projectId: string; id: string } }>('/projects/:projectId/domains/:id/force-verify', { config: rl(20) }, async (req, reply) => {
    const { projectId, id } = req.params;
    const userId = await requireStaff(req, 'force-verify a custom domain');
    const domain = await domains.getForProject(projectId, id);
    if (!domain) return reply.code(404).send({ error: 'domain not found' });
    await domains.markVerified(id);
    await refreshRoutes();
    req.log.warn({ projectId, host: domain.host, userId }, 'custom domain FORCE-verified without a DNS check');
    const fresh = await domains.getForProject(projectId, id);
    return reply.send({ verified: true, domain: withInstructions(fresh ?? domain) });
  });

  app.put<{ Params: { projectId: string; id: string } }>('/projects/:projectId/domains/:id/primary', { config: rl(30) }, async (req, reply) => {
    const { projectId, id } = req.params;
    await requireOwner(req, projectId);
    if (!(await domains.setPrimary(projectId, id))) return reply.code(404).send({ error: 'domain not found' });
    // ★ The primary host IS the canonical address: it is what "View live" advertises and what every
    // other verified host 301s to. Without this refresh the map keeps the OLD primary, so the new one
    // redirects to its predecessor — a loop from the visitor's point of view and a wrong advertised URL.
    await refreshRoutes();
    return reply.send({ items: (await domains.listForProject(projectId)).map(withInstructions) });
  });

  app.delete<{ Params: { projectId: string; id: string } }>('/projects/:projectId/domains/:id', { config: rl(30) }, async (req, reply) => {
    const { projectId, id } = req.params;
    await requireOwner(req, projectId);
    const domain = await domains.getForProject(projectId, id);
    if (!(await domains.release(projectId, id))) return reply.code(404).send({ error: 'domain not found' });
    await refreshRoutes();
    req.log.info({ projectId, host: domain?.host }, 'custom domain released');
    return reply.code(204).send();
  });
}
