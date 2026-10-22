import { createHash } from 'node:crypto';
import { and, asc, count, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  registrableSiteUrl,
  sitemapUrlOf,
  WEBMASTER_SERVICES,
  type SiteRegistrationEntry,
  type SiteRegistrationStepResult,
  type SiteRegistrationView,
  type WebmasterService,
} from '@sitewright/schema';
import type { Database } from '../db/client.js';
import { projects, webmasterRemovals, webmasterSites } from '../db/schema.js';
import { newId } from '../id.js';
import { bingRemoveSite, bingSearchStats, bingSiteCode, bingSubmitSitemap, bingVerifySite } from './bing.js';
import {
  googleRegisterSite,
  googleSearchAnalytics,
  googleSetOwners,
  googleSiteToken,
  googleSubmitSitemap,
  googleUnregisterSite,
  type GoogleOwnersChange,
  type GoogleServiceAccountKey,
} from './google.js';
import type { SearchDataSource } from './performance.js';
import type { WebmasterRepository } from './repo.js';
import { bingData, googleReport, type SearchPerformanceData, type SearchPeriod } from './search-data.js';
import { WebmasterError, type WebmasterIo } from './request.js';

/**
 * SITE REGISTRATION — a project's site registered with the platform's ONE Google and ONE Bing account, so no project
 * owner needs a Search Console or Bing account of their own. Agency staff drive every step from the Search engines
 * tile; nothing here runs on its own:
 *
 *   - `setEnabled`: switch a search engine on or off for the project. Off REMOVES the site from that account
 *     (Search Console and the ownership at Google; the site at Bing) before the switch goes off.
 *   - `prepare`: before the verification deploy — each switched-on account's tag for the Production URL (Google
 *     getToken; Bing adds the site, then reads its code). A registration for an older URL is removed first.
 *   - the deploy (the editor runs the project's own deploys), whose builds carry the tags (`tagsForBuild`);
 *   - `verify`: ask one search engine to confirm the tag on the live site (Google: then add it to Search Console,
 *     and give the owners staff chose access to it).
 *   - `submitSitemap`: hand the site's sitemap to a search engine that verified it — the progress window does it
 *     right after verifying, and staff can do it again from the tile.
 *   - `setOwners`: the Google accounts that own the site in Search Console beside the service account.
 *   - `removeOnDelete` / `removeOnPurge`: the project is deleted — remove the site from every account it was registered
 *     with. A removal that does not get through is QUEUED (`webmaster_removals`) and tried again from the hourly sweep
 *     (`retryRemovals`) with the account that registered it: the purge deletes the rows that were the only record.
 *
 * ★ Every build keeps the tags of the switched-on search engines, not only the verification deploy: a search engine
 * checks again later, and a site whose tag disappeared loses its verification.
 */

/** How long a step waits for a search engine (several requests each). */
const STEP_TIMEOUT_MS = 30_000;
/** A queued removal is tried again an hour later, then after twice as long each time, up to a day. */
const REMOVAL_RETRY_MS = 60 * 60_000;
const REMOVAL_RETRY_MAX_MS = 24 * 60 * 60_000;
/** After this long the platform gives up on a removal: a warning in the log names the site to remove by hand. */
const REMOVAL_GIVE_UP_MS = 14 * 24 * 60 * 60_000;
/** Removals queued at most; past it the oldest are given up, with the same warning. */
const MAX_REMOVALS = 1000;
/** Removals tried per sweep at most: each may take a step's whole deadline. */
const REMOVALS_PER_SWEEP = 25;

const retryDelay = (attempts: number): number => Math.min(REMOVAL_RETRY_MS * 2 ** Math.max(0, attempts - 1), REMOVAL_RETRY_MAX_MS);

/**
 * How long Bing's statistics for a site are reused. Bing answers with the site's whole history at once (about two
 * seconds, measured), so the 7-, 28- and 90-day views looked at one after the other are cut from one answer instead of
 * asking three times. Short: each view's numbers are kept an hour anyway; this only bridges the switch between them.
 */
const BING_STATS_TTL_MS = 10 * 60_000;
/** A whole history can be a few hundred KB: only the sites looked at in the last minutes. */
const BING_STATS_MAX = 50;

interface Account {
  /** Which account a tag was made for, so a different key needs a new one. */
  id: string;
  name: string;
  tag: (siteUrl: string) => Promise<string>;
  register: (siteUrl: string) => Promise<void>;
  /** `owners`: the people the platform made owners (Google), who lose that with the site. */
  unregister: (siteUrl: string, owners: readonly string[]) => Promise<string>;
  submitSitemap: (siteUrl: string, sitemapUrl: string) => Promise<void>;
  /** Google only: change the site's Search Console owners; the owners it then lists. */
  setOwners?: (siteUrl: string, change: GoogleOwnersChange) => Promise<string[]>;
  /** The site's search numbers for one period (Statistics → Search performance). */
  searchData: (siteUrl: string, period: SearchPeriod, expectedEnd?: string) => Promise<SearchPerformanceData>;
  done: string;
}

type Row = typeof webmasterSites.$inferSelect;
/** What a removal needs: which site, at which search engine, registered by which account, for which project. */
type Registration = Pick<Row, 'projectId' | 'service' | 'siteUrl' | 'account' | 'owners'>;

export interface SiteRegistrarDeps {
  db: Database;
  accounts: WebmasterRepository;
  io: WebmasterIo;
  log: { warn: (obj: object, msg: string) => void; info: (obj: object, msg: string) => void };
  now?: () => Date;
  /** What reading a site's search numbers goes out with: Bing answers with its whole history at once. Default `io`. */
  dataIo?: WebmasterIo;
  /** Removals queued at most (default 1000). */
  maxRemovals?: number;
}

const NAME: Record<WebmasterService, string> = { google: 'Google', bing: 'Bing' };
const NO_ACCOUNT = (service: WebmasterService): string =>
  `The platform has no ${service === 'google' ? 'Google service account' : 'Bing Webmaster account'}: an instance admin adds it in System Settings → Integrations`;

const failureText = (err: unknown): string => (err instanceof WebmasterError ? err.message : 'the search engine could not be reached');

function withTimeout<T>(work: Promise<T>, ms: number, service: WebmasterService): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WebmasterError(`${NAME[service]} took too long to answer`, 'unavailable')), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** A request that failed because the service could not be reached or was busy: the switch stays where it was. */
const transient = (err: unknown): boolean => !(err instanceof WebmasterError) || err.kind === 'unavailable' || err.kind === 'rate';

export class SiteRegistrar {
  /** Per project, the step in flight: a second one waits for it instead of racing it on the same rows. */
  private readonly queues = new Map<string, Promise<unknown>>();
  /** Bing's statistics per account and site, while they are reused ({@link BING_STATS_TTL_MS}); a failure is not kept. */
  private readonly bingStats = new Map<string, { at: number; stats: ReturnType<typeof bingSearchStats> }>();
  /** A sweep of the queued removals is running: the next one is skipped rather than run beside it. */
  private sweeping = false;

  constructor(private readonly deps: SiteRegistrarDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private queued<T>(projectId: string, work: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(projectId) ?? Promise.resolve()).then(work, work);
    const tail = run.catch(() => undefined);
    this.queues.set(projectId, tail);
    void tail.then(() => {
      if (this.queues.get(projectId) === tail) this.queues.delete(projectId);
    });
    return run;
  }

  /**
   * What one step's requests go out with: the step's own deadline, so a step that timed out stops for real and never
   * finishes behind the next one (which could undo what that one did).
   */
  private stepIo(): WebmasterIo {
    return { ...this.deps.io, deadline: Date.now() + STEP_TIMEOUT_MS };
  }

  /** The platform's account for `service`, or null when there is none or it cannot be read. */
  private async account(service: WebmasterService, stepIo?: WebmasterIo): Promise<Account | null> {
    let secret: Record<string, string> | null;
    try {
      secret = await this.deps.accounts.getSecret(service);
    } catch {
      return null; // sealed under another SW_ENCRYPTION_KEY: System Settings says so when it is tested
    }
    if (!secret) return null;
    const io = stepIo ?? this.deps.io;
    if (service === 'google') {
      const key: GoogleServiceAccountKey = {
        clientEmail: secret.clientEmail ?? '',
        privateKey: secret.privateKey ?? '',
        privateKeyId: secret.privateKeyId ?? '',
        projectId: secret.projectId ?? '',
      };
      if (!key.clientEmail || !key.privateKey) return null;
      return {
        id: key.clientEmail,
        name: 'Google Search Console',
        tag: (siteUrl) => googleSiteToken(key, siteUrl, io, this.now()),
        register: (siteUrl) => googleRegisterSite(key, siteUrl, io, this.now()),
        unregister: (siteUrl, owners) => googleUnregisterSite(key, siteUrl, owners, io, this.now()),
        submitSitemap: (siteUrl, sitemapUrl) => googleSubmitSitemap(key, siteUrl, sitemapUrl, io, this.now()),
        setOwners: (siteUrl, change) => googleSetOwners(key, siteUrl, change, io, this.now()),
        searchData: (siteUrl, period, expectedEnd) => googleReport((queries) => googleSearchAnalytics(key, siteUrl, queries, io, this.now()), period, expectedEnd),
        done: 'Verified and added to Search Console',
      };
    }
    const apiKey = secret.apiKey ?? '';
    if (!apiKey) return null;
    return {
      // A fingerprint, not the key: the row is never a place a secret could be read back from.
      id: createHash('sha256').update(apiKey).digest('hex').slice(0, 16),
      name: 'Bing Webmaster Tools',
      tag: (siteUrl) => bingSiteCode(apiKey, siteUrl, io),
      register: (siteUrl) => bingVerifySite(apiKey, siteUrl, io),
      unregister: (siteUrl) => bingRemoveSite(apiKey, siteUrl, io),
      submitSitemap: (siteUrl, sitemapUrl) => bingSubmitSitemap(apiKey, siteUrl, sitemapUrl, io),
      searchData: async (siteUrl, period) => bingData(await this.bingStatsOf(apiKey, siteUrl, io), period),
      done: 'Verified in Bing Webmaster Tools',
    };
  }

  /** Bing's statistics for the site: the answer from the last hour, else a new one (shared while it is asked). */
  private bingStatsOf(apiKey: string, siteUrl: string, io: WebmasterIo): ReturnType<typeof bingSearchStats> {
    const now = this.now().getTime();
    // A fingerprint of the key, never the key: the map is no place a secret could be read back from.
    const id = `${createHash('sha256').update(apiKey).digest('hex').slice(0, 16)}\n${siteUrl}`;
    const kept = this.bingStats.get(id);
    if (kept && now - kept.at < BING_STATS_TTL_MS) return kept.stats;
    const entry = { at: now, stats: bingSearchStats(apiKey, siteUrl, io) };
    entry.stats.catch(() => {
      if (this.bingStats.get(id) === entry) this.bingStats.delete(id);
    });
    this.bingStats.delete(id);
    this.bingStats.set(id, entry);
    for (const [old, e] of this.bingStats) {
      if (this.bingStats.size <= BING_STATS_MAX && now - e.at < BING_STATS_TTL_MS) break;
      this.bingStats.delete(old);
    }
    return entry.stats;
  }

  private async rows(projectId: string): Promise<Row[]> {
    return this.deps.db.select().from(webmasterSites).where(eq(webmasterSites.projectId, projectId));
  }

  private async row(projectId: string, service: WebmasterService): Promise<Row | undefined> {
    const [row] = await this.deps.db
      .select()
      .from(webmasterSites)
      .where(and(eq(webmasterSites.projectId, projectId), eq(webmasterSites.service, service)));
    return row;
  }

  private async save(row: Row): Promise<void> {
    const { enabled, siteUrl, account, token, status, detail, verifiedAt, updatedAt, owners, ownersDetail, sitemapAt, sitemapOk, sitemapDetail } = row;
    await this.deps.db
      .insert(webmasterSites)
      .values(row)
      .onConflictDoUpdate({
        target: [webmasterSites.projectId, webmasterSites.service],
        set: { enabled, siteUrl, account, token, status, detail, verifiedAt, updatedAt, owners, ownersDetail, sitemapAt, sitemapOk, sitemapDetail },
      });
  }

  /** No sitemap submission on record: a new registration starts without one. */
  private static readonly NO_SITEMAP = { sitemapAt: null, sitemapOk: null, sitemapDetail: null, ownersDetail: null } as const;

  /**
   * Whether `row` registered something at a search engine that a removal would have to undo: a tag was fetched — or,
   * for Bing, asked for, since Bing adds the site to the account before it hands out the code.
   */
  private static registered(row: Row | undefined): row is Row {
    return Boolean(row?.siteUrl && (row.token || row.service === 'bing'));
  }

  /**
   * Whether another project registers the same address with the same account. One account serves every project, so
   * both then share ONE registration at the search engine (one Search Console property): what either does to it —
   * removing it, changing its owners — happens to the other's too.
   */
  private async shared(row: Pick<Row, 'projectId' | 'service' | 'siteUrl' | 'account'>): Promise<boolean> {
    const rows = await this.deps.db
      .select({ projectId: webmasterSites.projectId })
      .from(webmasterSites)
      .where(and(eq(webmasterSites.service, row.service), eq(webmasterSites.siteUrl, row.siteUrl), eq(webmasterSites.account, row.account)));
    return rows.some((r) => r.projectId !== row.projectId);
  }

  /**
   * Removes a registration's site from the account that made it. Something already gone counts as removed.
   *
   * ★ Only THAT account can remove it. Asked with another (the key was replaced in System Settings), Google answers
   * "not an owner" and Bing "not found" — exactly what "already removed" looks like — and the site would be forgotten
   * while still registered with the old account. So with another account, or none, it is NOT removed, and says so.
   */
  private async unregister(row: Registration): Promise<SiteRegistrationStepResult & { retry: boolean }> {
    const account = await this.account(row.service, this.stepIo());
    if (!account || account.id !== row.account) {
      const why = account ? 'it was registered with an account the platform no longer uses' : 'the platform no longer has the account it was registered with';
      return { ok: false, retry: false, detail: `Not removed from ${NAME[row.service]}: ${why}` };
    }
    // An address another project still registers (a duplicate, an import of the same site) stays — removing it would
    // take that project's registration with it.
    if (await this.shared(row)) {
      return { ok: true, retry: false, detail: `Kept at ${NAME[row.service]}: another project registers ${row.siteUrl} too` };
    }
    try {
      return { ok: true, retry: false, detail: await withTimeout(account.unregister(row.siteUrl, row.owners), STEP_TIMEOUT_MS, row.service) };
    } catch (err) {
      return { ok: false, retry: transient(err), detail: `Could not remove ${row.siteUrl} from ${NAME[row.service]}: ${failureText(err)}` };
    }
  }

  /** The tags a build of this project carries: switched-on search engines with a tag for its Production URL. Never throws. */
  async tagsForBuild(projectId: string, rawSiteUrl: string | null | undefined): Promise<Partial<Record<WebmasterService, string>>> {
    const siteUrl = registrableSiteUrl(rawSiteUrl);
    if (!siteUrl) return {};
    try {
      const tags: Partial<Record<WebmasterService, string>> = {};
      for (const row of await this.rows(projectId)) {
        if (!row.enabled || !row.token || row.siteUrl !== siteUrl) continue;
        // A tag made for an account that has since been replaced proves nothing for the new one.
        const account = await this.account(row.service);
        if (account && account.id === row.account) tags[row.service] = row.token;
      }
      return tags;
    } catch (err) {
      this.deps.log.warn({ projectId, errMsg: err instanceof Error ? err.message : String(err) }, 'site registration: tags not read');
      return {};
    }
  }

  /**
   * Switches search engines on or off. Off removes the site from that account first; when the search engine could
   * not be reached the switch stays on (say so, try again), when it refused for good the switch goes off anyway.
   */
  setEnabled(projectId: string, changes: Partial<Record<WebmasterService, boolean>>): Promise<Partial<Record<WebmasterService, SiteRegistrationStepResult>>> {
    return this.queued(projectId, async () => {
      const removed: Partial<Record<WebmasterService, SiteRegistrationStepResult>> = {};
      for (const service of WEBMASTER_SERVICES) {
        // eslint-disable-next-line security/detect-object-injection -- service is a WEBMASTER_SERVICES literal
        const on = changes[service];
        if (on === undefined) continue;
        const row = await this.row(projectId, service);
        const now = this.now();
        if (on) {
          if (row?.enabled) continue;
          await this.save({
            projectId,
            service,
            enabled: true,
            siteUrl: row?.siteUrl ?? '',
            account: row?.account ?? '',
            token: row?.token ?? null,
            status: row?.token ? 'pending' : 'none',
            detail: null,
            verifiedAt: null,
            updatedAt: now,
            owners: row?.owners ?? [],
            ...SiteRegistrar.NO_SITEMAP,
          });
          continue;
        }
        if (!row) continue;
        let result: SiteRegistrationStepResult | undefined;
        if (SiteRegistrar.registered(row)) {
          const { retry, ...outcome } = await this.unregister(row);
          result = outcome;
          // eslint-disable-next-line security/detect-object-injection -- service is a WEBMASTER_SERVICES literal
          removed[service] = outcome;
          // Not reached: the site is still registered, so the switch stays on until a removal gets through.
          if (retry) continue;
          // Refused for good: switched off (no more tags), but what it registered is kept for the delete or the
          // reap to try again.
          if (!outcome.ok) {
            await this.save({ ...row, enabled: false, detail: outcome.detail, updatedAt: now });
            continue;
          }
        }
        await this.save({ ...row, enabled: false, siteUrl: '', account: '', token: null, status: 'none', detail: result?.detail ?? null, verifiedAt: null, updatedAt: now, ...SiteRegistrar.NO_SITEMAP });
      }
      return removed;
    });
  }

  /** Before the verification deploy: each switched-on search engine's tag for the Production URL. */
  prepare(projectId: string, rawSiteUrl: string | null | undefined): Promise<Partial<Record<WebmasterService, SiteRegistrationStepResult>>> {
    return this.queued(projectId, async () => {
      const siteUrl = registrableSiteUrl(rawSiteUrl);
      const results: Partial<Record<WebmasterService, SiteRegistrationStepResult>> = {};
      for (const row of await this.rows(projectId)) {
        if (!row.enabled) continue;
        const service = row.service;
        const set = (r: SiteRegistrationStepResult): void => {
          // eslint-disable-next-line security/detect-object-injection -- service is a WEBMASTER_SERVICES literal
          results[service] = r;
        };
        if (!siteUrl) {
          set({ ok: false, detail: 'Set an https Production URL first' });
          continue;
        }
        const account = await this.account(service, this.stepIo());
        if (!account) {
          set({ ok: false, detail: NO_ACCOUNT(service) });
          continue;
        }
        if (row.token && row.siteUrl === siteUrl && row.account === account.id) {
          set({ ok: true, detail: row.status === 'verified' ? 'Already verified: its tag stays on the site' : 'Tag ready' });
          continue;
        }
        // The Production URL (or the account) changed since: the old registration goes before the new one starts.
        let moved = '';
        if (SiteRegistrar.registered(row) && row.siteUrl !== siteUrl && row.account === account.id) {
          const old = await this.unregister(row);
          // Not removed: stop here rather than forget the old address (the row is the only record of it).
          if (!old.ok) {
            set({ ok: false, detail: `${old.detail}. Try again.` });
            continue;
          }
          moved = ` (${old.detail.startsWith('Kept') ? old.detail : `the old address ${row.siteUrl} was removed`})`;
        }
        const base = { projectId, service, enabled: true, siteUrl, account: account.id, verifiedAt: null, owners: row.owners, ...SiteRegistrar.NO_SITEMAP };
        try {
          const token = await withTimeout(account.tag(siteUrl), STEP_TIMEOUT_MS, service);
          await this.save({ ...base, token, status: 'pending', detail: null, updatedAt: this.now() });
          set({ ok: true, detail: `Tag ready${moved}` });
        } catch (err) {
          const detail = failureText(err);
          await this.save({ ...base, token: null, status: 'failed', detail, updatedAt: this.now() });
          set({ ok: false, detail: `${detail}${moved}` });
        }
      }
      return results;
    });
  }

  /** After the verification deploy: ask one search engine to confirm the tag on the live site. */
  verify(projectId: string, service: WebmasterService, rawSiteUrl: string | null | undefined): Promise<SiteRegistrationStepResult> {
    return this.queued(projectId, async () => {
      const siteUrl = registrableSiteUrl(rawSiteUrl);
      const row = await this.row(projectId, service);
      if (!row?.enabled) return { ok: false, detail: `${NAME[service]} is switched off for this site` };
      if (!siteUrl) return { ok: false, detail: 'Set an https Production URL first' };
      const account = await this.account(service, this.stepIo());
      if (!account) return { ok: false, detail: NO_ACCOUNT(service) };
      if (!row.token || row.siteUrl !== siteUrl || row.account !== account.id) return { ok: false, detail: 'No tag for this Production URL yet: start the verification again' };
      let result: SiteRegistrationStepResult;
      let update: Pick<Row, 'status' | 'detail' | 'verifiedAt' | 'ownersDetail'>;
      try {
        await withTimeout(account.register(siteUrl), STEP_TIMEOUT_MS, service);
        const owners = await this.shareWithOwners(row, siteUrl);
        const done = `${account.done}${owners.note}`;
        result = { ok: true, detail: done };
        update = { status: 'verified', detail: done, verifiedAt: this.now(), ownersDetail: owners.issue };
        this.deps.log.info({ projectId, service }, 'site registration: verified');
      } catch (err) {
        result = { ok: false, detail: failureText(err) };
        update = { status: 'failed', detail: result.detail, verifiedAt: null, ownersDetail: row.ownersDetail };
      }
      await this.deps.db
        .update(webmasterSites)
        .set({ ...update, updatedAt: this.now() })
        .where(and(eq(webmasterSites.projectId, projectId), eq(webmasterSites.service, service), eq(webmasterSites.token, row.token)));
      return result;
    });
  }

  /**
   * Right after Google verified: the owners staff chose get access to the site (again — a new Production URL is a new
   * property). Never fails the verification. `note` is a suffix for its message; `issue` is kept on the row when the
   * owners did NOT get access, so the Sitemap & owners window can say so and offer to try again.
   */
  private async shareWithOwners(row: Row, siteUrl: string): Promise<{ note: string; issue: string | null }> {
    if (row.service !== 'google' || row.owners.length === 0) return { note: '', issue: null };
    let issue: string;
    if (await this.shared({ ...row, siteUrl })) {
      issue = `another project registers ${siteUrl} too, and the two share one Search Console property: set its owners in one project only`;
    } else {
      // Its own deadline: the verification before it may have used most of the step's.
      const account = await this.account('google', this.stepIo());
      if (!account?.setOwners) return { note: '', issue: NO_ACCOUNT('google') };
      try {
        await withTimeout(account.setOwners(siteUrl, { wanted: row.owners, dropped: [] }), STEP_TIMEOUT_MS, row.service);
        return { note: ` · ${row.owners.length} owner${row.owners.length === 1 ? '' : 's'} given access`, issue: null };
      } catch (err) {
        issue = failureText(err);
      }
    }
    return { note: ` · the owners were not given access: ${issue}`, issue: `Not given access: ${issue}` };
  }

  /**
   * Hands the site's sitemap to one search engine that verified it. The progress window does it right after verifying;
   * staff can do it again from the tile (a search engine reads it again when it is submitted again).
   */
  submitSitemap(projectId: string, service: WebmasterService, rawSiteUrl: string | null | undefined): Promise<SiteRegistrationStepResult> {
    return this.queued(projectId, async () => {
      const siteUrl = registrableSiteUrl(rawSiteUrl);
      const sitemapUrl = sitemapUrlOf(siteUrl);
      const row = await this.row(projectId, service);
      if (!row?.enabled) return { ok: false, detail: `${NAME[service]} is switched off for this site` };
      if (!siteUrl || !sitemapUrl) return { ok: false, detail: 'Set an https Production URL first' };
      const account = await this.account(service, this.stepIo());
      if (!account) return { ok: false, detail: NO_ACCOUNT(service) };
      if (row.status !== 'verified' || row.siteUrl !== siteUrl || row.account !== account.id) return { ok: false, detail: `Verify the site with ${NAME[service]} first` };
      let result: SiteRegistrationStepResult;
      try {
        await withTimeout(account.submitSitemap(siteUrl, sitemapUrl), STEP_TIMEOUT_MS, service);
        result = { ok: true, detail: `Sitemap submitted: ${sitemapUrl}` };
        this.deps.log.info({ projectId, service }, 'site registration: sitemap submitted');
      } catch (err) {
        result = { ok: false, detail: failureText(err) };
      }
      // Only onto the registration it was made for: a switch-off or a new tag in between wins.
      await this.deps.db
        .update(webmasterSites)
        .set({ sitemapAt: this.now(), sitemapOk: result.ok, sitemapDetail: result.detail })
        .where(and(eq(webmasterSites.projectId, projectId), eq(webmasterSites.service, service), eq(webmasterSites.token, row.token ?? '')));
      return result;
    });
  }

  /**
   * The Google accounts that own the site in Search Console beside the service account — the whole list; whoever
   * is left out loses the ownership the platform gave. Only once Google verified the site: before that there is
   * nothing to share. Owners anyone added at Google directly are kept.
   */
  setOwners(projectId: string, owners: readonly string[], rawSiteUrl: string | null | undefined): Promise<SiteRegistrationStepResult> {
    return this.queued(projectId, async () => {
      const siteUrl = registrableSiteUrl(rawSiteUrl);
      const row = await this.row(projectId, 'google');
      if (!row?.enabled) return { ok: false, detail: 'Google is switched off for this site' };
      if (!siteUrl) return { ok: false, detail: 'Set an https Production URL first' };
      const account = await this.account('google', this.stepIo());
      if (!account?.setOwners) return { ok: false, detail: NO_ACCOUNT('google') };
      if (row.status !== 'verified' || row.siteUrl !== siteUrl || row.account !== account.id) return { ok: false, detail: 'Verify the site with Google first' };
      // One property for two projects: owners set from one would silently change the other's.
      if (await this.shared(row)) {
        return { ok: false, detail: `Another project registers ${siteUrl} too, and the two share one Search Console property: set its owners in one project only` };
      }
      const dropped = row.owners.filter((o) => !owners.includes(o));
      try {
        await withTimeout(account.setOwners(siteUrl, { wanted: owners, dropped }), STEP_TIMEOUT_MS, 'google');
      } catch (err) {
        return { ok: false, detail: failureText(err) };
      }
      try {
        // Onto the registration it was made for only (the queue keeps another step out; the token says it is this one).
        await this.deps.db
          .update(webmasterSites)
          .set({ owners: [...owners], ownersDetail: null, updatedAt: this.now() })
          .where(and(eq(webmasterSites.projectId, projectId), eq(webmasterSites.service, 'google'), eq(webmasterSites.token, row.token ?? '')));
      } catch (err) {
        // Google has the new owners but the row does not: a later removal would miss the ones added here.
        this.deps.log.warn({ projectId, errMsg: err instanceof Error ? err.message : String(err) }, 'site registration: owners set at Google but not saved');
        throw err;
      }
      this.deps.log.info({ projectId, owners: owners.length }, 'site registration: owners set');
      return { ok: true, detail: owners.length ? `${owners.length} owner${owners.length === 1 ? '' : 's'} in Search Console` : 'Only the platform owns the site in Search Console' };
    });
  }

  /**
   * The project was deleted (soft: it can be restored). Its site leaves every account it is registered with, but the
   * switches and the Google owners STAY: a restored project shows its search engines on and not verified, and Verify
   * now registers the site again and gives the owners access again. A removal that does not get through leaves the
   * row as it is — still registered, which it is — and is queued for the hourly sweep; a restore cancels it.
   * Never throws (it runs in the background of the delete); what fails is logged.
   */
  async removeOnDelete(projectId: string): Promise<void> {
    try {
      await this.queued(projectId, async () => {
        for (const row of await this.rows(projectId)) {
          if (!SiteRegistrar.registered(row)) continue;
          const result = await this.unregister(row);
          if (result.ok) await this.clearRegistration(row, result.detail);
          else await this.queueRemoval(row, result.detail);
        }
      });
    } catch (err) {
      this.deps.log.warn({ projectId, errMsg: err instanceof Error ? err.message : String(err) }, 'site registration: removal on delete failed');
    }
  }

  /**
   * The project is being purged. What is still registered leaves its account now, while the rows still say what it
   * was; what does not get through is queued for the hourly sweep, because the purge deletes the rows and nothing else
   * would remember the site. Throws only when the queue could not be written: the purge must then stop rather than
   * delete the last record of a site that is still registered.
   */
  async removeOnPurge(projectId: string): Promise<void> {
    await this.queued(projectId, async () => {
      for (const row of await this.rows(projectId)) {
        if (!SiteRegistrar.registered(row)) continue;
        const result = await this.unregister(row);
        if (result.ok) await this.dropRemoval(row);
        else await this.queueRemoval(row, result.detail);
      }
    });
  }

  /** A deleted project was restored: the removals still queued for it are cancelled — its rows say what is registered. */
  async restored(projectId: string): Promise<void> {
    try {
      await this.queued(projectId, async () => {
        const cancelled = await this.deps.db.delete(webmasterRemovals).where(eq(webmasterRemovals.projectId, projectId)).returning({ id: webmasterRemovals.id });
        if (cancelled.length) this.deps.log.info({ projectId, cancelled: cancelled.length }, 'site registration: project restored, its sites stay registered');
      });
    } catch (err) {
      this.deps.log.warn({ projectId, errMsg: err instanceof Error ? err.message : String(err) }, 'site registration: queued removals not cancelled on restore');
    }
  }

  /**
   * THE HOURLY SWEEP: the queued removals that are due, each with the account that registered the site. One whose
   * project was restored, or whose address another project registers now, is dropped — the site is theirs. One that
   * keeps failing is tried again later each time and given up after 14 days, with a warning naming the site.
   * Never throws.
   */
  async retryRemovals(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const due = await this.deps.db
        .select({ id: webmasterRemovals.id, projectId: webmasterRemovals.projectId, service: webmasterRemovals.service })
        .from(webmasterRemovals)
        .where(lte(webmasterRemovals.nextAt, this.now()))
        .orderBy(asc(webmasterRemovals.nextAt))
        .limit(REMOVALS_PER_SWEEP);
      for (const removal of due) {
        try {
          // In the project's queue: a restore (or the purge) of the same project waits for it, and it for them.
          await this.queued(removal.projectId, () => this.retryRemoval(removal.id));
        } catch (err) {
          this.deps.log.warn({ projectId: removal.projectId, service: removal.service, errMsg: err instanceof Error ? err.message : String(err) }, 'site registration: a queued removal failed');
        }
      }
    } catch (err) {
      this.deps.log.warn({ errMsg: err instanceof Error ? err.message : String(err) }, 'site registration: queued removals not read');
    } finally {
      this.sweeping = false;
    }
  }

  private async retryRemoval(id: string): Promise<void> {
    const { db, log } = this.deps;
    const [removal] = await db.select().from(webmasterRemovals).where(eq(webmasterRemovals.id, id));
    if (!removal) return; // done meanwhile: the purge got through, or a restore cancelled it
    const where = { projectId: removal.projectId, service: removal.service, siteUrl: removal.siteUrl };
    const [project] = await db.select({ deletedAt: projects.deletedAt }).from(projects).where(eq(projects.id, removal.projectId));
    if (project && !project.deletedAt) {
      await db.delete(webmasterRemovals).where(eq(webmasterRemovals.id, id));
      log.info(where, 'site registration: the project was restored, so its site stays registered');
      return;
    }
    const result = await this.unregister(removal);
    if (result.ok) {
      await db.delete(webmasterRemovals).where(eq(webmasterRemovals.id, id));
      // Still soft-deleted: its row no longer has anything registered (its switches and owners stay for a restore).
      if (project) await this.clearRegistration(removal, result.detail);
      log.info({ ...where, detail: result.detail }, 'site registration: removed on a later try');
      return;
    }
    const now = this.now();
    const attempts = removal.attempts + 1;
    if (now.getTime() - removal.createdAt.getTime() >= REMOVAL_GIVE_UP_MS) {
      await db.delete(webmasterRemovals).where(eq(webmasterRemovals.id, id));
      log.warn({ ...where, account: removal.account, attempts, detail: result.detail }, 'site registration: gave up removing a site after 14 days; remove it at the search engine by hand');
      return;
    }
    await db
      .update(webmasterRemovals)
      .set({ attempts, lastError: result.detail, nextAt: new Date(now.getTime() + retryDelay(attempts)) })
      .where(eq(webmasterRemovals.id, id));
  }

  /** The registration is gone at the search engine: its row forgets it, keeping the switch and the Google owners. */
  private async clearRegistration(reg: Registration, detail: string): Promise<void> {
    await this.deps.db
      .update(webmasterSites)
      .set({ siteUrl: '', account: '', token: null, status: 'none', detail, verifiedAt: null, updatedAt: this.now(), ...SiteRegistrar.NO_SITEMAP })
      .where(
        and(
          eq(webmasterSites.projectId, reg.projectId),
          eq(webmasterSites.service, reg.service),
          eq(webmasterSites.siteUrl, reg.siteUrl),
          eq(webmasterSites.account, reg.account),
        ),
      );
  }

  /** Queues a removal that did not get through (once per site and account: a second failure counts as an attempt). */
  private async queueRemoval(reg: Registration, error: string): Promise<void> {
    const now = this.now();
    const nextAt = new Date(now.getTime() + retryDelay(1));
    const owners = [...reg.owners];
    await this.deps.db
      .insert(webmasterRemovals)
      .values({ id: newId(), projectId: reg.projectId, service: reg.service, siteUrl: reg.siteUrl, account: reg.account, owners, attempts: 1, lastError: error, nextAt, createdAt: now })
      .onConflictDoUpdate({
        target: [webmasterRemovals.service, webmasterRemovals.siteUrl, webmasterRemovals.account],
        set: { projectId: reg.projectId, owners, lastError: error, attempts: sql`${webmasterRemovals.attempts} + 1`, nextAt },
      });
    this.deps.log.warn({ projectId: reg.projectId, service: reg.service, siteUrl: reg.siteUrl, detail: error }, 'site registration: not removed on delete; it will be tried again');
    await this.capRemovals();
  }

  private async dropRemoval(reg: Registration): Promise<void> {
    await this.deps.db
      .delete(webmasterRemovals)
      .where(and(eq(webmasterRemovals.service, reg.service), eq(webmasterRemovals.siteUrl, reg.siteUrl), eq(webmasterRemovals.account, reg.account)));
  }

  /** Keeps the queue bounded: past the cap, the oldest removals are given up, each with a warning naming its site. */
  private async capRemovals(): Promise<void> {
    const { db, log } = this.deps;
    const [total] = await db.select({ n: count() }).from(webmasterRemovals);
    const over = (total?.n ?? 0) - (this.deps.maxRemovals ?? MAX_REMOVALS);
    if (over <= 0) return;
    const oldest = await db.select().from(webmasterRemovals).orderBy(asc(webmasterRemovals.createdAt)).limit(over);
    await db.delete(webmasterRemovals).where(inArray(webmasterRemovals.id, oldest.map((r) => r.id)));
    for (const r of oldest) {
      log.warn({ projectId: r.projectId, service: r.service, siteUrl: r.siteUrl, account: r.account }, 'site registration: gave up removing a site (too many removals waiting); remove it at the search engine by hand');
    }
  }

  /**
   * What the platform's CURRENT account for `service` still holds: sites of live projects registered with it, and sites
   * still being removed (queued, or of a deleted project whose removal has not got through). Removing the account in
   * System Settings would leave every one of them at the search engine with nobody able to take it off.
   */
  async registeredWith(service: WebmasterService): Promise<{ sites: number; pending: number }> {
    const account = await this.account(service);
    if (!account) return { sites: 0, pending: 0 };
    const rows = await this.deps.db
      .select({ row: webmasterSites, deletedAt: projects.deletedAt })
      .from(webmasterSites)
      .innerJoin(projects, eq(projects.id, webmasterSites.projectId))
      .where(and(eq(webmasterSites.service, service), eq(webmasterSites.account, account.id)));
    const queued = await this.deps.db
      .select({ siteUrl: webmasterRemovals.siteUrl })
      .from(webmasterRemovals)
      .where(and(eq(webmasterRemovals.service, service), eq(webmasterRemovals.account, account.id)));
    const registered = rows.filter((r) => SiteRegistrar.registered(r.row));
    const pending = new Set([...queued.map((q) => q.siteUrl), ...registered.filter((r) => r.deletedAt).map((r) => r.row.siteUrl)]);
    return { sites: registered.filter((r) => !r.deletedAt).length, pending: pending.size };
  }

  /**
   * The search engines this project's site has numbers at — switched on and verified for its CURRENT Production URL by
   * the account the platform has NOW — each with what reads them. Asks no search engine; never throws (none, then).
   */
  async searchDataSources(projectId: string, rawSiteUrl: string | null | undefined): Promise<SearchDataSource[]> {
    const siteUrl = registrableSiteUrl(rawSiteUrl);
    if (!siteUrl) return [];
    try {
      const sources: SearchDataSource[] = [];
      for (const row of await this.rows(projectId)) {
        if (!row.enabled || row.status !== 'verified' || row.siteUrl !== siteUrl) continue;
        const account = await this.account(row.service, this.deps.dataIo);
        if (!account || account.id !== row.account) continue;
        sources.push({ service: row.service, siteUrl, accountId: account.id, read: (period, expectedEnd) => account.searchData(siteUrl, period, expectedEnd) });
      }
      return sources.sort((a, b) => WEBMASTER_SERVICES.indexOf(a.service) - WEBMASTER_SERVICES.indexOf(b.service));
    } catch (err) {
      this.deps.log.warn({ projectId, errMsg: err instanceof Error ? err.message : String(err) }, 'search performance: sources not read');
      return [];
    }
  }

  /** What staff see: per search engine, whether it is on, how far it got, and why not. */
  async view(projectId: string, rawSiteUrl: string | null | undefined): Promise<SiteRegistrationView> {
    const siteUrl = registrableSiteUrl(rawSiteUrl);
    const configured = new Set((await this.deps.accounts.list()).map((a) => a.service));
    const rows = await this.rows(projectId);
    const accountIds = new Map<WebmasterService, string | undefined>();
    for (const service of WEBMASTER_SERVICES) {
      if (configured.has(service)) accountIds.set(service, (await this.account(service))?.id);
    }
    const entry = (service: WebmasterService): SiteRegistrationEntry => {
      const row = rows.find((r) => r.service === service);
      const enabled = Boolean(row?.enabled);
      // Switched on, but the platform's account was removed since: staff can still switch it off.
      const owners = service === 'google' ? (row?.owners ?? []) : [];
      if (enabled && !configured.has(service)) {
        return { configured: false, enabled, status: 'failed', detail: NO_ACCOUNT(service), verifiedAt: null, checkedAt: row?.updatedAt.toISOString() ?? null, sitemap: null, owners, ownersIssue: null };
      }
      // A record made for another URL or account says nothing about this one; a just-switched-on row is `none`.
      const current = row && enabled && (row.status === 'none' || (row.siteUrl === siteUrl && row.account === accountIds.get(service))) ? row : undefined;
      return {
        configured: configured.has(service),
        enabled,
        status: enabled ? (current?.status ?? 'none') : 'off',
        detail: current?.detail ?? (!enabled ? (row?.detail ?? null) : null),
        verifiedAt: current?.verifiedAt?.toISOString() ?? null,
        checkedAt: current?.updatedAt.toISOString() ?? null,
        sitemap:
          current?.sitemapAt && current.sitemapOk !== null
            ? { ok: current.sitemapOk, detail: current.sitemapDetail ?? '', at: current.sitemapAt.toISOString() }
            : null,
        owners,
        ownersIssue: service === 'google' ? (current?.ownersDetail ?? null) : null,
      };
    };
    return {
      siteUrl,
      sitemapUrl: sitemapUrlOf(siteUrl),
      notice: siteUrl ? null : rawSiteUrl?.trim() ? 'not-https' : 'no-site-url',
      google: entry('google'),
      bing: entry('bing'),
    };
  }
}
