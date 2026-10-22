import { and, asc, count, eq, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { WebmasterService } from '@sitewright/schema';
import type { Database } from '../db/client.js';
import { projects, webmasterRemovals, webmasterSites } from '../db/schema.js';
import { newId } from '../id.js';

/**
 * THE REMOVAL QUEUE (`webmaster_removals`) — sites the platform could not remove from one of its search engine accounts:
 * when their project was deleted, or when a replaced key left a registration with the old account. `SiteRegistrar`
 * tries each again from the hourly sweep, with the account that registered it; this module keeps the table: when the
 * next try is due, when to give up, and how large it may grow.
 *
 * Giving up never forgets silently: a warning names the site and the account, and a deleted project's row that still
 * held the registration forgets it — otherwise it would count as registered with that account for good.
 */

/** A queued removal is tried again an hour later, then after twice as long each time, up to a day. */
const RETRY_MS = 60 * 60_000;
const RETRY_MAX_MS = 24 * 60 * 60_000;
/** After this long the platform gives up on a removal. */
const GIVE_UP_MS = 14 * 24 * 60 * 60_000;
/** Removals queued at most; past it the oldest are given up. */
const MAX_REMOVALS = 1000;

const NAME: Record<WebmasterService, string> = { google: 'Google', bing: 'Bing' };

/** How long after the `attempts`-th failed try the next one is due. */
export const retryDelay = (attempts: number): number => Math.min(RETRY_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS);

export type Removal = typeof webmasterRemovals.$inferSelect;

/** What a removal needs: which site, at which search engine, registered by which account, for which project. */
export interface Registration {
  projectId: string;
  service: WebmasterService;
  siteUrl: string;
  account: string;
  owners: readonly string[];
}

/** No sitemap submission and no owner problem on record: what a row that holds no registration says. */
export const NO_SITEMAP = { sitemapAt: null, sitemapOk: null, sitemapDetail: null, ownersDetail: null } as const;

/**
 * The registration is gone at the search engine (or given up): the project's row forgets it, keeping its switch and its
 * Google owners. Only a row that still holds THIS registration (same address and account) changes; with `deletedOnly`,
 * only while its project is deleted.
 */
export async function forgetRegistration(db: Database, reg: Registration, detail: string, now: Date, deletedOnly = false): Promise<void> {
  await db
    .update(webmasterSites)
    .set({ siteUrl: '', account: '', token: null, status: 'none', detail, verifiedAt: null, updatedAt: now, ...NO_SITEMAP })
    .where(
      and(
        eq(webmasterSites.projectId, reg.projectId),
        eq(webmasterSites.service, reg.service),
        eq(webmasterSites.siteUrl, reg.siteUrl),
        eq(webmasterSites.account, reg.account),
        deletedOnly ? inArray(webmasterSites.projectId, db.select({ id: projects.id }).from(projects).where(isNotNull(projects.deletedAt))) : undefined,
      ),
    );
}

export interface RemovalQueueDeps {
  db: Database;
  log: { warn: (obj: object, msg: string) => void };
  now: () => Date;
  /** Removals queued at most (default 1000). */
  max?: number;
}

export class RemovalQueue {
  constructor(private readonly deps: RemovalQueueDeps) {}

  /**
   * Queues a removal that did not get through — once per site and account. Queued again (the purge after the delete,
   * say), it counts as one more failed try and backs off FURTHER, never back to an hour.
   */
  async add(reg: Registration, error: string): Promise<void> {
    const now = this.deps.now();
    const owners = [...reg.owners];
    await this.deps.db
      .insert(webmasterRemovals)
      .values({ id: newId(), projectId: reg.projectId, service: reg.service, siteUrl: reg.siteUrl, account: reg.account, owners, attempts: 1, lastError: error, nextAt: new Date(now.getTime() + retryDelay(1)), createdAt: now })
      .onConflictDoUpdate({
        target: [webmasterRemovals.service, webmasterRemovals.siteUrl, webmasterRemovals.account],
        set: {
          projectId: reg.projectId,
          owners,
          lastError: error,
          // Evaluated against the row as it was: `attempts` failed tries so far, so this is retryDelay(attempts + 1).
          attempts: sql`${webmasterRemovals.attempts} + 1`,
          nextAt: sql`${now.getTime()} + MIN(${RETRY_MS} * (1 << MIN(${webmasterRemovals.attempts}, 16)), ${RETRY_MAX_MS})`,
        },
      });
    this.deps.log.warn({ projectId: reg.projectId, service: reg.service, siteUrl: reg.siteUrl, detail: error }, 'site registration: not removed; it will be tried again');
    await this.cap();
  }

  /** The site was removed (or is someone else's now): nothing left to try. */
  async drop(reg: Pick<Registration, 'service' | 'siteUrl' | 'account'>): Promise<void> {
    await this.deps.db
      .delete(webmasterRemovals)
      .where(and(eq(webmasterRemovals.service, reg.service), eq(webmasterRemovals.siteUrl, reg.siteUrl), eq(webmasterRemovals.account, reg.account)));
  }

  async remove(id: string): Promise<void> {
    await this.deps.db.delete(webmasterRemovals).where(eq(webmasterRemovals.id, id));
  }

  async get(id: string): Promise<Removal | undefined> {
    const [row] = await this.deps.db.select().from(webmasterRemovals).where(eq(webmasterRemovals.id, id));
    return row;
  }

  /** The removals due now, the longest-waiting first. */
  async due(limit: number): Promise<Array<Pick<Removal, 'id' | 'projectId' | 'service'>>> {
    return this.deps.db
      .select({ id: webmasterRemovals.id, projectId: webmasterRemovals.projectId, service: webmasterRemovals.service })
      .from(webmasterRemovals)
      .where(lte(webmasterRemovals.nextAt, this.deps.now()))
      .orderBy(asc(webmasterRemovals.nextAt))
      .limit(limit);
  }

  /**
   * ★ Whether a LIVE project's row (`exceptProjectId` aside) registers this address at this search engine — under ANY
   * account. Two Bing keys can belong to one Bing user, who has one site per address: a removal made with either key
   * removes it for both. So no removal runs while a live project holds the address: an old account keeping a stale
   * ownership is acceptable, removing a live registration is not.
   */
  async heldLive(service: WebmasterService, siteUrl: string, exceptProjectId?: string): Promise<boolean> {
    const [row] = await this.deps.db
      .select({ projectId: webmasterSites.projectId })
      .from(webmasterSites)
      .innerJoin(projects, eq(projects.id, webmasterSites.projectId))
      .where(
        and(
          eq(webmasterSites.service, service),
          eq(webmasterSites.siteUrl, siteUrl),
          isNull(projects.deletedAt),
          // Registered: Google once a tag was fetched; Bing as soon as the site was asked for (it adds it first).
          or(isNotNull(webmasterSites.token), eq(webmasterSites.service, 'bing')),
          exceptProjectId ? ne(webmasterSites.projectId, exceptProjectId) : undefined,
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  /**
   * A restored project: its queued removals are cancelled — the ones its rows still hold, whose sites stay registered
   * for it. One it no longer holds (a registration a replaced key left with the old account) stays queued.
   */
  async cancelHeldBy(projectId: string): Promise<number> {
    const held = this.deps.db
      .select({ id: webmasterRemovals.id })
      .from(webmasterRemovals)
      .innerJoin(
        webmasterSites,
        and(
          eq(webmasterSites.projectId, webmasterRemovals.projectId),
          eq(webmasterSites.service, webmasterRemovals.service),
          eq(webmasterSites.siteUrl, webmasterRemovals.siteUrl),
          eq(webmasterSites.account, webmasterRemovals.account),
        ),
      )
      .where(eq(webmasterRemovals.projectId, projectId));
    const cancelled = await this.deps.db.delete(webmasterRemovals).where(inArray(webmasterRemovals.id, held)).returning({ id: webmasterRemovals.id });
    return cancelled.length;
  }

  /** The addresses still queued for removal from one account. */
  async sites(service: WebmasterService, account: string): Promise<string[]> {
    const rows = await this.deps.db
      .select({ siteUrl: webmasterRemovals.siteUrl })
      .from(webmasterRemovals)
      .where(and(eq(webmasterRemovals.service, service), eq(webmasterRemovals.account, account)));
    return rows.map((r) => r.siteUrl);
  }

  /** A try failed: the next one is due later — or, 14 days after the first, the removal is given up. */
  async failed(r: Removal, error: string): Promise<'later' | 'gave-up'> {
    const now = this.deps.now();
    const attempts = r.attempts + 1;
    if (now.getTime() - r.createdAt.getTime() >= GIVE_UP_MS) {
      await this.giveUp(r, error, 'after 14 days');
      return 'gave-up';
    }
    await this.deps.db
      .update(webmasterRemovals)
      .set({ attempts, lastError: error, nextAt: new Date(now.getTime() + retryDelay(attempts)) })
      .where(eq(webmasterRemovals.id, r.id));
    return 'later';
  }

  /**
   * Gives a removal up: the entry goes, a warning names the site and the account to remove it from by hand, and a
   * DELETED project's row that still holds the registration forgets it (a live project's row says what is true).
   */
  private async giveUp(r: Removal, error: string | null, why: string): Promise<void> {
    await this.remove(r.id);
    const detail = `Not removed from ${NAME[r.service]} (gave up ${why}): remove ${r.siteUrl} there by hand`;
    await forgetRegistration(this.deps.db, r, detail, this.deps.now(), true);
    this.deps.log.warn(
      { projectId: r.projectId, service: r.service, siteUrl: r.siteUrl, account: r.account, attempts: r.attempts, detail: error ?? r.lastError },
      `site registration: gave up removing a site ${why}; remove it at the search engine by hand`,
    );
  }

  /** Keeps the queue bounded: past the cap, the oldest removals are given up. */
  private async cap(): Promise<void> {
    const [total] = await this.deps.db.select({ n: count() }).from(webmasterRemovals);
    const over = (total?.n ?? 0) - (this.deps.max ?? MAX_REMOVALS);
    if (over <= 0) return;
    const oldest = await this.deps.db.select().from(webmasterRemovals).orderBy(asc(webmasterRemovals.createdAt)).limit(over);
    for (const r of oldest) await this.giveUp(r, null, '(too many removals waiting)');
  }
}
