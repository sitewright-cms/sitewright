import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  registrableSiteUrl,
  WEBMASTER_SERVICES,
  type SiteRegistrationEntry,
  type SiteRegistrationView,
  type WebmasterService,
} from '@sitewright/schema';
import type { Database } from '../db/client.js';
import { webmasterSites } from '../db/schema.js';
import { bingSiteCode, bingVerifySite } from './bing.js';
import { googleRegisterSite, googleSiteToken, type GoogleServiceAccountKey } from './google.js';
import type { WebmasterRepository } from './repo.js';
import { WebmasterError, type WebmasterIo } from './request.js';

/**
 * SITE REGISTRATION — registers every published or deployed site with the platform's ONE Google and ONE Bing
 * account, so no project owner needs a Search Console or Bing account of their own.
 *
 *   1. Before a build that goes LIVE (a deploy, or a publish served by Local Hosting at its Site URL), `tagsFor`
 *      returns each account's verification tag for the website's Site URL — fetched once and kept: the same account
 *      and URL always get the same tag — and the build puts them in every page's `<head>`.
 *   2. Once that build is live, `afterDeploy` gets the tags THAT build carried and asks each search engine to verify
 *      the site — Google then makes the service account a verified owner, and the site is added to its Search
 *      Console. A search engine that did not find the tag yet (a cache in front of the host) is asked once more,
 *      `retryMs` later.
 *
 * ★ Nothing here may fail or stall a publish: every error is recorded on the project (and shown to staff), the
 * build goes out without that tag, and the next deploy tries again. Getting a tag is bounded in time; verifying runs
 * after the deploy has answered.
 */

export type SiteTags = Partial<Record<WebmasterService, string>>;

/**
 * After a failed attempt to get a tag, how long builds go without asking again: every ask can delay a build by up to
 * `TAG_TIMEOUT_MS`. Short, because what fixes it (switching an API on in Google Cloud) changes nothing stored here.
 */
export const TAG_RETRY_MS = 10 * 60 * 1000;
/** How long a build waits for a search engine's tag (both are asked side by side). */
const TAG_TIMEOUT_MS = 15_000;
/** When a search engine did not find the tag right after a deploy, how long until it is asked once more. */
const VERIFY_RETRY_MS = 2 * 60 * 1000;

interface Account {
  /** Which account a tag was made for, so a different key gets a new one. */
  id: string;
  tag: (siteUrl: string) => Promise<string>;
  register: (siteUrl: string) => Promise<void>;
  done: string;
}

type Row = typeof webmasterSites.$inferSelect;

export interface SiteRegistrarDeps {
  db: Database;
  accounts: WebmasterRepository;
  io: WebmasterIo;
  log: { warn: (obj: object, msg: string) => void; info: (obj: object, msg: string) => void };
  now?: () => Date;
  /** Overrides `VERIFY_RETRY_MS` (tests); 0 turns the second ask off. */
  verifyRetryMs?: number;
}

const failureText = (err: unknown): string => (err instanceof WebmasterError ? err.message : 'the search engine could not be reached');

function withTimeout<T>(work: Promise<T>, ms: number, service: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WebmasterError(`${service} took too long to answer`, 'unavailable')), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

export class SiteRegistrar {
  /** Per project, the work in flight — getting tags, or verifying. A second one waits for it instead of racing it. */
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(private readonly deps: SiteRegistrarDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Runs `work` after whatever this project already has in flight (both reading and writing its rows). */
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
        tag: (siteUrl) => googleSiteToken(key, siteUrl, io, this.now()),
        register: (siteUrl) => googleRegisterSite(key, siteUrl, io, this.now()),
        done: 'Verified and added to Search Console',
      };
    }
    const apiKey = secret.apiKey ?? '';
    if (!apiKey) return null;
    return {
      // A fingerprint, not the key: the row is never a place a secret could be read back from.
      id: createHash('sha256').update(apiKey).digest('hex').slice(0, 16),
      tag: (siteUrl) => bingSiteCode(apiKey, siteUrl, io),
      register: (siteUrl) => bingVerifySite(apiKey, siteUrl, io),
      done: 'Verified in Bing Webmaster Tools',
    };
  }

  private async rows(projectId: string): Promise<Row[]> {
    return this.deps.db.select().from(webmasterSites).where(eq(webmasterSites.projectId, projectId));
  }

  private async save(row: Row): Promise<void> {
    const { siteUrl, account, token, status, detail, verifiedAt, updatedAt } = row;
    await this.deps.db
      .insert(webmasterSites)
      .values(row)
      .onConflictDoUpdate({
        target: [webmasterSites.projectId, webmasterSites.service],
        set: { siteUrl, account, token, status, detail, verifiedAt, updatedAt },
      });
  }

  /**
   * The verification tags a live build of this project carries. Never throws, and waits at most `TAG_TIMEOUT_MS`
   * (the search engines are asked side by side) — and only the first build for a URL asks at all.
   */
  tagsFor(projectId: string, rawSiteUrl: string | null | undefined): Promise<SiteTags> {
    const siteUrl = registrableSiteUrl(rawSiteUrl);
    if (!siteUrl) return Promise.resolve({});
    // Queued per project: two first builds at once must not both ask, nor the later failure overwrite the tag the
    // earlier one saved.
    return this.queued(projectId, async () => {
      const rows = await this.rows(projectId).catch(() => [] as Row[]);
      const found = await Promise.all(
        WEBMASTER_SERVICES.map(async (service) => {
          try {
            return [service, await this.tagFor(projectId, service, siteUrl, rows.find((r) => r.service === service))] as const;
          } catch (err) {
            this.deps.log.warn({ projectId, service, errMsg: err instanceof Error ? err.message : String(err) }, 'site registration: no verification tag');
            return [service, null] as const;
          }
        }),
      );
      const tags: SiteTags = {};
      for (const [service, tag] of found) {
        // eslint-disable-next-line security/detect-object-injection -- service is a WEBMASTER_SERVICES literal
        if (tag) tags[service] = tag;
      }
      return tags;
    });
  }

  private async tagFor(projectId: string, service: WebmasterService, siteUrl: string, row: Row | undefined): Promise<string | null> {
    const account = await this.account(service);
    if (!account) return null;
    const now = this.now();
    if (row && row.siteUrl === siteUrl && row.account === account.id) {
      if (row.token) return row.token;
      if (now.getTime() - row.updatedAt.getTime() < TAG_RETRY_MS) return null;
    }
    const base = { projectId, service, siteUrl, account: account.id, verifiedAt: null, updatedAt: now };
    try {
      const token = await withTimeout(account.tag(siteUrl), TAG_TIMEOUT_MS, service === 'google' ? 'Google' : 'Bing');
      await this.save({ ...base, token, status: 'pending', detail: null });
      return token;
    } catch (err) {
      await this.save({ ...base, token: null, status: 'failed', detail: failureText(err) });
      return null;
    }
  }

  /**
   * A build is now live: ask each search engine whose tag it carried (`carried`, as `tagsFor` returned it for THAT
   * build) to verify the site. Runs in the background — the deploy has already succeeded, whatever happens here.
   */
  afterDeploy(projectId: string, carried: SiteTags | undefined): void {
    if (!carried || (!carried.google && !carried.bing)) return;
    void this.queued(projectId, () => this.register(projectId, carried, true)).catch((err: unknown) => {
      this.deps.log.warn({ projectId, errMsg: err instanceof Error ? err.message : String(err) }, 'site registration failed');
    });
  }

  /** Everything queued for a project has finished (tests). */
  async settled(projectId: string): Promise<void> {
    await this.queues.get(projectId);
  }

  /** Stops the scheduled second asks (app shutdown). */
  close(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private async register(projectId: string, carried: SiteTags, first: boolean): Promise<void> {
    let missed = false;
    for (const row of await this.rows(projectId)) {
      // Only what the live build carries: a row whose tag differs (a new key or URL saved since) is not on the site.
      if (!row.token || row.token !== carried[row.service] || row.status === 'verified') continue;
      const account = await this.account(row.service);
      if (!account || account.id !== row.account) continue;
      let update: Pick<Row, 'status' | 'detail' | 'verifiedAt'>;
      try {
        await account.register(row.siteUrl);
        update = { status: 'verified', detail: account.done, verifiedAt: this.now() };
        this.deps.log.info({ projectId, service: row.service }, 'site registration: verified');
      } catch (err) {
        update = { status: 'failed', detail: failureText(err), verifiedAt: null };
        if (err instanceof WebmasterError && err.kind === 'unverified') missed = true;
      }
      // Only the row this attempt was for: a new Site URL or key saved meanwhile has its own tag and its own turn.
      await this.deps.db
        .update(webmasterSites)
        .set({ ...update, updatedAt: this.now() })
        .where(
          and(
            eq(webmasterSites.projectId, projectId),
            eq(webmasterSites.service, row.service),
            eq(webmasterSites.siteUrl, row.siteUrl),
            eq(webmasterSites.account, row.account),
            eq(webmasterSites.token, row.token),
          ),
        );
    }
    // A search engine that looked before a cache in front of the host had the new page gets one more look.
    const retryMs = this.deps.verifyRetryMs ?? VERIFY_RETRY_MS;
    if (first && missed && retryMs > 0) {
      const t = setTimeout(() => {
        this.timers.delete(t);
        void this.queued(projectId, () => this.register(projectId, carried, false)).catch(() => undefined);
      }, retryMs);
      t.unref();
      this.timers.add(t);
    }
  }

  /** What staff see: per search engine, whether the site is registered, and why not. */
  async view(projectId: string, rawSiteUrl: string | null | undefined): Promise<SiteRegistrationView> {
    const siteUrl = registrableSiteUrl(rawSiteUrl);
    const configured = new Set((await this.deps.accounts.list()).map((a) => a.service));
    const rows = siteUrl ? await this.rows(projectId) : [];
    const accountIds = new Map<WebmasterService, string | undefined>();
    for (const service of WEBMASTER_SERVICES) {
      if (configured.has(service)) accountIds.set(service, (await this.account(service))?.id);
    }
    const entry = (service: WebmasterService): SiteRegistrationEntry => {
      // A row made for another account (the key was replaced) says nothing about this one.
      const row = rows.find((r) => r.service === service && r.siteUrl === siteUrl && r.account === accountIds.get(service));
      return {
        configured: configured.has(service),
        status: row?.status ?? 'none',
        detail: row?.detail ?? null,
        verifiedAt: row?.verifiedAt?.toISOString() ?? null,
        checkedAt: row?.updatedAt.toISOString() ?? null,
      };
    };
    return {
      siteUrl,
      notice: siteUrl ? null : rawSiteUrl?.trim() ? 'not-https' : 'no-site-url',
      google: entry('google'),
      bing: entry('bing'),
    };
  }
}
