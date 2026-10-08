import { randomBytes } from 'node:crypto';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { newId } from '../id.js';
import type { Database } from '../db/client.js';
import { projectDomains, projects } from '../db/schema.js';

/** The DNS label a verification TXT record is published under: `_sitewright.<host>`. */
export const VERIFICATION_TXT_PREFIX = '_sitewright';

/** Upper bound on custom domains per project (apex + www + a couple of campaign hosts is the real need). */
export const MAX_DOMAINS_PER_PROJECT = 10;

/** A claimed custom domain as the editor sees it. The token is shown — it belongs in public DNS. */
export interface ProjectDomainView {
  id: string;
  host: string;
  isPrimary: boolean;
  verificationToken: string;
  verifiedAt: Date | null;
  createdAt: Date;
}

/** One verified host → the project serving it. The routing map is built from these. */
export interface VerifiedDomainRoute {
  host: string;
  projectId: string;
  slug: string;
  /** Whether this is the project's canonical host (the one the others redirect to). */
  isPrimary: boolean;
}

/** Why a host cannot be claimed. Each maps to a distinct HTTP status at the route. */
export type DomainRejection =
  | { reason: 'invalid'; message: string }
  | { reason: 'reserved'; message: string }
  | { reason: 'taken'; message: string };

/**
 * Normalize a hostname for storage and comparison: lowercase, trailing dot stripped, no scheme, no
 * port, no path. Returns null for anything that is not a plausible DNS hostname.
 *
 * Deliberately strict about what it ACCEPTS while being forgiving about shape — an operator pasting
 * `https://WWW.Example.com/` means `www.example.com`, and refusing that would be a validation error
 * about nothing. But a wildcard, an IP literal or an underscore label is refused outright: none of them
 * can be a `Host` a browser sends for a real site, so accepting one would store a row that can never
 * match a request.
 */
export function normalizeHost(raw: string | undefined): string | null {
  let value = (raw ?? '').trim().toLowerCase();
  if (!value) return null;
  // Tolerate a pasted URL.
  if (value.includes('://')) {
    try {
      value = new URL(value).hostname;
    } catch {
      return null;
    }
  }
  value = value.replace(/\/.*$/, '').replace(/\.$/, '');
  // A port is never part of a Host we can route on (the proxy terminates on one port).
  if (value.includes(':')) return null;
  if (value.length === 0 || value.length > 253) return null;
  // Reject an IP literal: a certificate cannot be issued for one and no site is addressed that way.
  if (/^[0-9.]+$/.test(value)) return null;
  const labels = value.split('.');
  // At least two labels (a bare `localhost`-style name is not a public site address).
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return null;
  }
  return value;
}

/**
 * Whether a host is one the INSTANCE itself owns and a project therefore may never claim.
 *
 * Two families, and both would be broken rather than merely confusing:
 *
 *  - a platform origin's host — the app answers there, so routing it to a site would take the admin
 *    panel (or an API surface a published site posts to) offline;
 *  - anything inside `<label>.<sitesDomain>` plus the apex — that namespace is already addressed BY
 *    PROJECT SLUG, so a row here would either be shadowed by the slug rewrite or shadow another
 *    project's automatic address. The apex is included because it is the operator's own DNS name.
 */
export function reservedHostReason(
  host: string,
  ctx: { platformHosts?: readonly string[]; sitesDomain?: string },
): string | null {
  if ((ctx.platformHosts ?? []).includes(host)) {
    return `${host} is an address of this platform itself`;
  }
  const sitesDomain = ctx.sitesDomain?.replace(/^\.+|\.+$/g, '').toLowerCase() || undefined;
  if (sitesDomain && (host === sitesDomain || host.endsWith(`.${sitesDomain}`))) {
    return `${host} is inside ${sitesDomain}, where sites are already addressed by their project slug`;
  }
  return null;
}

/** A fresh verification token — url-safe, unguessable, and short enough to paste into a DNS panel. */
export function newVerificationToken(): string {
  return `sw-verify-${randomBytes(16).toString('base64url')}`;
}

/**
 * Custom-domain claims. Verification state lives here; the DNS lookup itself is the caller's job (this
 * repo never touches the network), which keeps the storage rules unit-testable.
 */
export class ProjectDomainRepository {
  constructor(private readonly db: Database) {}

  /** This project's claims, primary first then oldest first. */
  async listForProject(projectId: string): Promise<ProjectDomainView[]> {
    const rows = await this.db
      .select({
        id: projectDomains.id,
        host: projectDomains.host,
        isPrimary: projectDomains.isPrimary,
        verificationToken: projectDomains.verificationToken,
        verifiedAt: projectDomains.verifiedAt,
        createdAt: projectDomains.createdAt,
      })
      .from(projectDomains)
      .where(eq(projectDomains.projectId, projectId));
    return rows.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt.getTime() - b.createdAt.getTime());
  }

  /** One row by id, scoped to a project so a caller cannot touch another tenant's claim. */
  async getForProject(projectId: string, id: string): Promise<ProjectDomainView | null> {
    const [row] = await this.db
      .select({
        id: projectDomains.id,
        host: projectDomains.host,
        isPrimary: projectDomains.isPrimary,
        verificationToken: projectDomains.verificationToken,
        verifiedAt: projectDomains.verifiedAt,
        createdAt: projectDomains.createdAt,
      })
      .from(projectDomains)
      .where(and(eq(projectDomains.id, id), eq(projectDomains.projectId, projectId)));
    return row ?? null;
  }

  /** Whoever currently holds a host, if anyone — including an unverified claim. */
  async findByHost(host: string): Promise<{ id: string; projectId: string; verifiedAt: Date | null } | null> {
    const [row] = await this.db
      .select({ id: projectDomains.id, projectId: projectDomains.projectId, verifiedAt: projectDomains.verifiedAt })
      .from(projectDomains)
      .where(eq(projectDomains.host, host));
    return row ?? null;
  }

  /**
   * Every VERIFIED host whose project is live, for the in-process routing map.
   *
   * ★ Soft-deleted projects are excluded by the join: a soft-deleted project's published site already
   * 404s, and a custom domain that kept serving it would be the one way to reach a project the owner
   * believes is gone. A restore puts the rows back (the map is rebuilt, not patched).
   */
  async listVerifiedRoutes(): Promise<VerifiedDomainRoute[]> {
    return this.db
      .select({ host: projectDomains.host, projectId: projectDomains.projectId, slug: projects.slug, isPrimary: projectDomains.isPrimary })
      .from(projectDomains)
      .innerJoin(projects, eq(projectDomains.projectId, projects.id))
      .where(and(isNotNull(projectDomains.verifiedAt), isNull(projects.deletedAt)));
  }

  /** How many claims a project already holds (the per-project cap is enforced at the route). */
  async countForProject(projectId: string): Promise<number> {
    return (await this.db.select({ id: projectDomains.id }).from(projectDomains).where(eq(projectDomains.projectId, projectId))).length;
  }

  /**
   * Claim a host for a project.
   *
   * ★ An existing UNVERIFIED claim by ANOTHER project is displaced rather than treated as a conflict.
   * Holding an unverified claim proves nothing — it is just a typed-in string — so letting it block the
   * next claimant would turn the feature into a land-grab: the first project to guess a client's domain
   * locks everyone else out of it forever. A VERIFIED claim is a different matter and is refused, because
   * somebody has actually demonstrated DNS control.
   *
   * The displacement and the insert run in ONE transaction so the UNIQUE index can never see both rows.
   */
  async claim(p: { projectId: string; host: string; createdBy: string }, now: Date = new Date()): Promise<{ domain: ProjectDomainView } | DomainRejection> {
    const existing = await this.findByHost(p.host);
    if (existing && existing.projectId === p.projectId) {
      return { reason: 'taken', message: `${p.host} is already claimed by this project` };
    }
    if (existing?.verifiedAt) {
      return { reason: 'taken', message: `${p.host} is verified by another project on this platform — an administrator has to release it first` };
    }
    const row = {
      id: newId(),
      projectId: p.projectId,
      host: p.host,
      // The first host a project claims becomes its primary; later ones are promoted explicitly.
      isPrimary: (await this.countForProject(p.projectId)) === 0,
      verificationToken: newVerificationToken(),
      verifiedAt: null,
      createdBy: p.createdBy,
      createdAt: now,
    };
    await this.db.transaction(async (tx) => {
      if (existing) await tx.delete(projectDomains).where(eq(projectDomains.id, existing.id));
      await tx.insert(projectDomains).values(row);
    });
    // The view omits `createdBy` (an internal audit field, not the claimant's business to re-read).
    return {
      domain: {
        id: row.id,
        host: row.host,
        isPrimary: row.isPrimary,
        verificationToken: row.verificationToken,
        verifiedAt: row.verifiedAt,
        createdAt: row.createdAt,
      },
    };
  }

  /** Records a successful DNS check. Idempotent — re-verifying an already-verified host is a no-op. */
  async markVerified(id: string, now: Date = new Date()): Promise<void> {
    await this.db.update(projectDomains).set({ verifiedAt: now }).where(eq(projectDomains.id, id));
  }

  /**
   * Make one host the project's primary (the address its site calls itself), demoting the others in the
   * same transaction so "exactly one primary" cannot be observed as broken.
   */
  async setPrimary(projectId: string, id: string): Promise<boolean> {
    const target = await this.getForProject(projectId, id);
    if (!target) return false;
    await this.db.transaction(async (tx) => {
      await tx.update(projectDomains).set({ isPrimary: false }).where(eq(projectDomains.projectId, projectId));
      await tx.update(projectDomains).set({ isPrimary: true }).where(eq(projectDomains.id, id));
    });
    return true;
  }

  /**
   * Release a host. If it was the primary and other claims remain, the oldest surviving one is promoted
   * in the same transaction — a project with domains but no primary would leave `servedSiteUrl` with
   * nothing to advertise.
   */
  async release(projectId: string, id: string): Promise<boolean> {
    const target = await this.getForProject(projectId, id);
    if (!target) return false;
    const siblings = (await this.listForProject(projectId)).filter((d) => d.id !== id);
    await this.db.transaction(async (tx) => {
      await tx.delete(projectDomains).where(eq(projectDomains.id, id));
      const heir = siblings[0];
      if (target.isPrimary && heir) {
        await tx.update(projectDomains).set({ isPrimary: true }).where(eq(projectDomains.id, heir.id));
      }
    });
    return true;
  }
}
