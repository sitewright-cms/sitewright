import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
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
import { webmasterSites } from '../db/schema.js';
import { bingRemoveSite, bingSiteCode, bingSubmitSitemap, bingVerifySite } from './bing.js';
import {
  googleRegisterSite,
  googleSetOwners,
  googleSiteToken,
  googleSubmitSitemap,
  googleUnregisterSite,
  type GoogleOwnersChange,
  type GoogleServiceAccountKey,
} from './google.js';
import type { WebmasterRepository } from './repo.js';
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
 *   - `removeAll`: the project is deleted — remove the site from every account it was registered with.
 *
 * ★ Every build keeps the tags of the switched-on search engines, not only the verification deploy: a search engine
 * checks again later, and a site whose tag disappeared loses its verification.
 */

/** How long a step waits for a search engine (several requests each). */
const STEP_TIMEOUT_MS = 30_000;

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
  done: string;
}

type Row = typeof webmasterSites.$inferSelect;

export interface SiteRegistrarDeps {
  db: Database;
  accounts: WebmasterRepository;
  io: WebmasterIo;
  log: { warn: (obj: object, msg: string) => void; info: (obj: object, msg: string) => void };
  now?: () => Date;
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

  /** The platform's account for `service`, or null when there is none or it cannot be read. */
  private async account(service: WebmasterService): Promise<Account | null> {
    let secret: Record<string, string> | null;
    try {
      secret = await this.deps.accounts.getSecret(service);
    } catch {
      return null; // sealed under another SW_ENCRYPTION_KEY: System Settings says so when it is tested
    }
    if (!secret) return null;
    const { io } = this.deps;
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
      done: 'Verified in Bing Webmaster Tools',
    };
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
    const { enabled, siteUrl, account, token, status, detail, verifiedAt, updatedAt, owners, sitemapAt, sitemapOk, sitemapDetail } = row;
    await this.deps.db
      .insert(webmasterSites)
      .values(row)
      .onConflictDoUpdate({
        target: [webmasterSites.projectId, webmasterSites.service],
        set: { enabled, siteUrl, account, token, status, detail, verifiedAt, updatedAt, owners, sitemapAt, sitemapOk, sitemapDetail },
      });
  }

  /** No sitemap submission on record: a new registration starts without one. */
  private static readonly NO_SITEMAP = { sitemapAt: null, sitemapOk: null, sitemapDetail: null } as const;

  /**
   * Whether `row` registered something at a search engine that a removal would have to undo: a tag was fetched — or,
   * for Bing, asked for, since Bing adds the site to the account before it hands out the code.
   */
  private static registered(row: Row | undefined): row is Row {
    return Boolean(row?.siteUrl && (row.token || row.service === 'bing'));
  }

  /**
   * Removes `row`'s site from its account. Something already gone counts as removed; with no account (removed in
   * System Settings) there is nothing the platform can still do, and that is said.
   */
  private async unregister(row: Row): Promise<SiteRegistrationStepResult & { retry: boolean }> {
    const account = await this.account(row.service);
    if (!account) return { ok: true, retry: false, detail: `Not removed from ${NAME[row.service]}: the platform no longer has that account` };
    // One account serves every project: an address another project still registers (a duplicate, an import of the
    // same site) stays — removing it would take that project's registration with it.
    const shared = await this.deps.db
      .select({ projectId: webmasterSites.projectId })
      .from(webmasterSites)
      .where(and(eq(webmasterSites.service, row.service), eq(webmasterSites.siteUrl, row.siteUrl), eq(webmasterSites.account, row.account)));
    if (shared.some((r) => r.projectId !== row.projectId)) {
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
        const account = await this.account(service);
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
      const account = await this.account(service);
      if (!account) return { ok: false, detail: NO_ACCOUNT(service) };
      if (!row.token || row.siteUrl !== siteUrl || row.account !== account.id) return { ok: false, detail: 'No tag for this Production URL yet: start the verification again' };
      let result: SiteRegistrationStepResult;
      let update: Pick<Row, 'status' | 'detail' | 'verifiedAt'>;
      try {
        await withTimeout(account.register(siteUrl), STEP_TIMEOUT_MS, service);
        const done = `${account.done}${await this.shareWithOwners(account, row, siteUrl)}`;
        result = { ok: true, detail: done };
        update = { status: 'verified', detail: done, verifiedAt: this.now() };
        this.deps.log.info({ projectId, service }, 'site registration: verified');
      } catch (err) {
        result = { ok: false, detail: failureText(err) };
        update = { status: 'failed', detail: result.detail, verifiedAt: null };
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
   * property). Never fails the verification; says what happened, as a suffix for its message.
   */
  private async shareWithOwners(account: Account, row: Row, siteUrl: string): Promise<string> {
    if (!account.setOwners || row.owners.length === 0) return '';
    try {
      await withTimeout(account.setOwners(siteUrl, { wanted: row.owners, dropped: [] }), STEP_TIMEOUT_MS, row.service);
      return ` · ${row.owners.length} owner${row.owners.length === 1 ? '' : 's'} given access`;
    } catch (err) {
      return ` · the owners were not given access: ${failureText(err)}`;
    }
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
      const account = await this.account(service);
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
      const account = await this.account('google');
      if (!account?.setOwners) return { ok: false, detail: NO_ACCOUNT('google') };
      if (row.status !== 'verified' || row.siteUrl !== siteUrl || row.account !== account.id) return { ok: false, detail: 'Verify the site with Google first' };
      const dropped = row.owners.filter((o) => !owners.includes(o));
      try {
        await withTimeout(account.setOwners(siteUrl, { wanted: owners, dropped }), STEP_TIMEOUT_MS, 'google');
      } catch (err) {
        return { ok: false, detail: failureText(err) };
      }
      await this.deps.db
        .update(webmasterSites)
        .set({ owners: [...owners], updatedAt: this.now() })
        .where(and(eq(webmasterSites.projectId, projectId), eq(webmasterSites.service, 'google')));
      this.deps.log.info({ projectId, owners: owners.length }, 'site registration: owners set');
      return { ok: true, detail: owners.length ? `${owners.length} owner${owners.length === 1 ? '' : 's'} in Search Console` : 'Only the platform owns the site in Search Console' };
    });
  }

  /**
   * The project is being deleted: remove its site from every account it was registered with, and switch the search
   * engines off (a restored project starts again from the tile). Never throws; what could not be removed is logged.
   */
  removeAll(projectId: string): Promise<void> {
    return this.queued(projectId, async () => {
      for (const row of await this.rows(projectId)) {
        if (SiteRegistrar.registered(row)) {
          const result = await this.unregister(row);
          if (!result.ok) {
            // Switched off, but what it registered is kept: the reap tries the removal again.
            this.deps.log.warn({ projectId, service: row.service, detail: result.detail }, 'site registration: not removed on delete');
            await this.save({ ...row, enabled: false, detail: result.detail, updatedAt: this.now() });
            continue;
          }
        }
        if (row.enabled || row.token || row.owners.length) {
          await this.save({ ...row, enabled: false, siteUrl: '', account: '', token: null, status: 'none', detail: null, verifiedAt: null, updatedAt: this.now(), owners: [], ...SiteRegistrar.NO_SITEMAP });
        }
      }
    }).catch((err: unknown) => {
      this.deps.log.warn({ projectId, errMsg: err instanceof Error ? err.message : String(err) }, 'site registration: removal on delete failed');
    });
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
        return { configured: false, enabled, status: 'failed', detail: NO_ACCOUNT(service), verifiedAt: null, checkedAt: row?.updatedAt.toISOString() ?? null, sitemap: null, owners };
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
