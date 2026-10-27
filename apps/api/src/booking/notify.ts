import { RESERVED_TRANSLATION_DEFAULTS, type BookingConfig, type BookingOffering, type Translations } from '@sitewright/schema';
import { resolveTranslations } from '@sitewright/core';
import type { ClaimRow } from './claims.js';
import { bookingMails, type BookingMailKind } from './mails.js';
import type { BookingMailRepository } from './outbox.js';

/**
 * Turns a booking event into its mails and queues them: who the business is, where its site is, which language
 * the customer booked in, and which addresses the business wants told.
 */

/** What the notifier reads from a project's settings. Nothing else of the settings is reachable from here. */
export interface NotifierSettings {
  identity?: { name?: string };
  website?: { siteUrl?: string; translations?: Translations };
  settings?: { defaultLocale?: string; locales?: string[] };
}

/**
 * How many mails one customer address may get from one project in a day. A booking and its cancellation is two,
 * and a visitor who rebooks is three: the cap leaves room for that, and stops the booking form being used to send
 * a stranger a stream of mail from the business's server (anyone can type any address into it).
 */
export const CUSTOMER_MAILS_PER_DAY = 4;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Addresses tracked at once; the oldest are forgotten first. */
const BUDGET_KEYS = 20_000;

/** An address as one mailbox: lower case, and without a `+tag` (`ada+x@example.com` is ada@example.com). */
export function mailboxOf(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  const local = e.slice(0, at).split('+')[0] ?? '';
  return `${local}@${e.slice(at + 1)}`;
}

/** Per project and mailbox, the times its mails were queued in the last day. In memory, like the hourly budget. */
export class CustomerMailBudget {
  private readonly sent = new Map<string, number[]>();

  /** True, and counted, when one more mail may go to this mailbox. */
  take(projectId: string, email: string, now: number): boolean {
    const key = `${projectId}\u0000${mailboxOf(email)}`;
    const recent = (this.sent.get(key) ?? []).filter((t) => now - t < DAY_MS);
    if (recent.length >= CUSTOMER_MAILS_PER_DAY) {
      this.sent.set(key, recent);
      return false;
    }
    this.sent.delete(key);
    this.sent.set(key, [...recent, now]);
    if (this.sent.size > BUDGET_KEYS) this.sent.delete(this.sent.keys().next().value as string);
    return true;
  }
}

/**
 * The site's language for the one the page reported: exactly, then whatever its case, then by its main part
 * (`de-DE` on a site in `de`). Null when the site has none of it.
 */
export function matchLocale(requested: string | undefined, locales: readonly string[]): string | null {
  if (!requested) return null;
  const want = requested.toLowerCase();
  const exact = locales.find((l) => l.toLowerCase() === want);
  if (exact) return exact;
  const main = want.split('-')[0];
  return locales.find((l) => l.toLowerCase() === main) ?? null;
}

export interface BookingNotifierDeps {
  mails: BookingMailRepository;
  readSettings: (projectId: string) => Promise<NotifierSettings | null>;
  /** Where the platform hosts the project's site, for a project with no production URL of its own. */
  hostedSiteUrl: (projectId: string) => Promise<string | null>;
  /** Sends what was just queued, without waiting for the next maintenance pass. */
  kick: () => void;
  log: { warn: (o: unknown, m: string) => void };
  now?: () => number;
  /** Shared by every notifier of the process; one is made when none is given. */
  budget?: CustomerMailBudget;
}

export interface BookingEvent {
  kind: BookingMailKind;
  projectId: string;
  claim: Pick<ClaimRow, 'id' | 'resourceId' | 'startAt' | 'endAt' | 'units' | 'customer' | 'state'>;
  offering: BookingOffering;
  config: BookingConfig;
  /** The booking's signed reference, for the link to its own page. Not for a cancellation. */
  reference?: string;
  /** The language of the page the customer booked on, as the widget reports it. */
  locale?: string;
  /** The business did it: accepted a request, or cancelled from its Bookings tab. */
  by?: 'business';
}

export class BookingNotifier {
  private readonly budget: CustomerMailBudget;

  constructor(private readonly deps: BookingNotifierDeps) {
    this.budget = deps.budget ?? new CustomerMailBudget();
  }

  /** Queues the event's mails and starts sending them. Never throws: the booking stands whatever mail does. */
  async notify(e: BookingEvent): Promise<void> {
    try {
      const now = this.deps.now?.() ?? Date.now();
      const settings = (await this.deps.readSettings(e.projectId)) ?? {};
      const locales = settings.settings?.locales ?? ['en'];
      const ownerLocale = settings.settings?.defaultLocale ?? locales[0] ?? 'en';
      // Only a language the site has: anything else the widget reports is the main one.
      const locale = matchLocale(e.locale, locales) ?? ownerLocale;
      const catalog = resolveTranslations(settings.website?.translations, locale, ownerLocale);
      // eslint-disable-next-line security/detect-object-injection -- reserved keys from the fixed registry
      const t = (key: string): string => (Object.hasOwn(catalog, key) ? catalog[key] : undefined) || RESERVED_TRANSLATION_DEFAULTS[key] || '';
      const base = await this.siteBase(e.projectId, settings);
      const resource = e.config.resources.find((r) => r.id === e.claim.resourceId);
      const statusUrl = base && e.config.statusPath && e.reference ? `${base}${e.config.statusPath}#t=${encodeURIComponent(e.reference)}` : undefined;
      const mails = bookingMails({
        kind: e.kind,
        wasBooked: e.claim.state === 'booked',
        ...(e.by ? { by: e.by } : {}),
        claimId: e.claim.id,
        offering: { name: e.offering.name, mode: e.offering.mode, ...(e.offering.mode === 'days' ? { unit: e.offering.unit } : {}) },
        timeZone: resource?.timeZone ?? 'UTC',
        start: e.claim.startAt.getTime(),
        end: e.claim.endAt.getTime(),
        quantity: e.claim.units,
        customer: e.claim.customer,
        business: { name: settings.identity?.name?.trim() || e.offering.name, ...(e.config.notifyEmail ? { email: e.config.notifyEmail } : {}) },
        resource: { name: resource?.name ?? e.claim.resourceId, ...(resource?.email ? { email: resource.email } : {}) },
        ...(statusUrl ? { statusUrl } : {}),
        // Stable for the booking's life, whatever happens to the site's address meanwhile.
        uidDomain: e.projectId,
        locale,
        ownerLocale,
        t,
        now,
      });
      // The customer's copy goes only while their mailbox has budget left; the business always hears.
      const kept = mails.filter((m) => {
        if (m.role !== 'customer' || this.budget.take(e.projectId, m.recipient, now)) return true;
        this.deps.log.warn({ projectId: e.projectId, kind: e.kind }, 'customer booking mail withheld: that address has had its share today');
        return false;
      });
      const { dropped } = await this.deps.mails.enqueue(e.projectId, kept);
      if (dropped) this.deps.log.warn({ projectId: e.projectId, dropped }, 'booking mails dropped: the project has too many waiting');
      this.deps.kick();
    } catch (err) {
      this.deps.log.warn({ err, projectId: e.projectId, kind: e.kind }, 'booking mails could not be queued');
    }
  }

  /** The business's own site: its production URL, else where the platform hosts it. No trailing slash. */
  private async siteBase(projectId: string, settings: NotifierSettings): Promise<string | null> {
    const raw = settings.website?.siteUrl?.trim() || (await this.deps.hostedSiteUrl(projectId)) || '';
    try {
      const u = new URL(raw);
      return u.protocol === 'https:' || u.protocol === 'http:' ? `${u.origin}${u.pathname}`.replace(/\/+$/, '') : null;
    } catch {
      return null;
    }
  }
}

/**
 * Tells the customers (and the business) of requests that ran out unanswered: what the maintenance sweep hands
 * back. ★ One request's failure never stops the rest, and a project's set-up is read once per pass, not per request.
 * The rows are already gone, so a mail lost here is not retried: logged, not thrown.
 */
export async function notifyLapsed(
  requests: readonly ClaimRow[],
  deps: { readConfig: (projectId: string) => Promise<BookingConfig | null>; notify: (e: BookingEvent) => Promise<void>; log: { warn: (o: unknown, m: string) => void } },
): Promise<number> {
  const configs = new Map<string, Promise<BookingConfig | null>>();
  let told = 0;
  for (const claim of requests) {
    try {
      let config = configs.get(claim.projectId);
      if (!config) {
        config = deps.readConfig(claim.projectId);
        configs.set(claim.projectId, config);
      }
      const set = await config;
      const offering = set?.offerings.find((o) => o.id === claim.offeringId);
      if (!set || !offering) {
        deps.log.warn({ projectId: claim.projectId, offeringId: claim.offeringId }, 'lapsed request not mailed: its offering no longer exists');
        continue;
      }
      await deps.notify({ kind: 'lapsed', projectId: claim.projectId, claim, offering, config: set });
      told += 1;
    } catch (err) {
      deps.log.warn({ err, projectId: claim.projectId }, 'lapsed request not mailed');
    }
  }
  return told;
}
