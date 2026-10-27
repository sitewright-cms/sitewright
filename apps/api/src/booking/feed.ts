import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { BookingConfig, BookingOffering, BookingResource } from '@sitewright/schema';
import type { Database } from '../db/client.js';
import { bookingFeeds } from '../db/schema.js';
import type { ClaimRow } from './claims.js';
import { ICS_PRODID, icsFold, icsText, icsUtc } from './ics.js';
import { DAY_MS, addDays, localDateOf } from './zoned.js';

/**
 * THE BUSINESS'S BOOKINGS AS A CALENDAR FEED: an iCalendar address its own calendar (Google, Outlook, Apple)
 * subscribes to, so every booking and open request shows there without anyone sending anything.
 *
 * ★ The address is a credential: the feed names customers and their contacts. It carries a long random token,
 * looked up by its SHA-256 (the token itself is not searchable), and kept encrypted so the editor can show the
 * address again. A new address replaces the old one, which stops working at once.
 * ★ The events carry the same UID as the booking's invitations (`<claim>@<project>`): a calendar that also got
 * the invitation, or the reader of this project's own outside calendars, knows them for the same booking.
 * ★ White-label: the product identifier is neutral, and the calendar is named after the business.
 */

export const FEED_LIMITS = {
  /** Bookings shown from this long ago. */
  pastMs: 30 * DAY_MS,
  /** ...to this far ahead (the furthest anything can be booked, and a little). */
  aheadMs: 732 * DAY_MS,
  maxEvents: 5_000,
  /** How often a calendar is asked to fetch it again. Most apps decide for themselves. */
  refresh: 'PT15M',
  /** A fetch is recorded at most this often (it tells the business the subscription works). */
  touchMs: 5 * 60_000,
} as const;

export type FeedRow = typeof bookingFeeds.$inferSelect;

/** A new token: 192 random bits, URL-safe. */
export function newFeedToken(): string {
  return randomBytes(24).toString('base64url');
}

export function feedTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A token as it may appear in an address. Anything else is not looked up at all. */
export const FEED_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

export class BookingFeedRepository {
  constructor(private readonly db: Database) {}

  async get(projectId: string): Promise<FeedRow | undefined> {
    const [row] = await this.db.select().from(bookingFeeds).where(eq(bookingFeeds.projectId, projectId));
    return row;
  }

  async byToken(token: string): Promise<FeedRow | undefined> {
    const [row] = await this.db.select().from(bookingFeeds).where(eq(bookingFeeds.tokenHash, feedTokenHash(token)));
    return row;
  }

  /** The project's feed, with a new token: the previous address stops working. */
  async replace(projectId: string, token: string, encrypted: FeedRow['token'], now: number): Promise<FeedRow> {
    const row: FeedRow = { projectId, tokenHash: feedTokenHash(token), token: encrypted, createdAt: new Date(now), lastFetchedAt: null };
    await this.db
      .insert(bookingFeeds)
      .values(row)
      .onConflictDoUpdate({ target: bookingFeeds.projectId, set: { tokenHash: row.tokenHash, token: row.token, createdAt: row.createdAt, lastFetchedAt: null } });
    return row;
  }

  async remove(projectId: string): Promise<boolean> {
    const gone = await this.db.delete(bookingFeeds).where(eq(bookingFeeds.projectId, projectId)).returning({ id: bookingFeeds.projectId });
    return gone.length > 0;
  }

  /** Records a fetch, at most every few minutes: a calendar polling it is no reason to write on every poll. */
  async touched(projectId: string, now: number): Promise<void> {
    await this.db
      .update(bookingFeeds)
      .set({ lastFetchedAt: new Date(now) })
      .where(
        and(
          eq(bookingFeeds.projectId, projectId),
          or(isNull(bookingFeeds.lastFetchedAt), lt(bookingFeeds.lastFetchedAt, new Date(now - FEED_LIMITS.touchMs))),
        ),
      );
  }
}

const ymd = (d: { y: number; m: number; d: number }): string => `${d.y}${String(d.m).padStart(2, '0')}${String(d.d).padStart(2, '0')}`;

/** The feed's text: one event per booking or open request, the requests marked tentative. */
export function renderBookingFeed(input: {
  projectId: string;
  /** The calendar's name in the subscriber's app: the business's, and the resource's when the feed is for one. */
  calendarName: string;
  config: BookingConfig | null;
  claims: readonly ClaimRow[];
  now: number;
}): string {
  const offerings = new Map((input.config?.offerings ?? []).map((o) => [o.id, o]));
  const resources = new Map((input.config?.resources ?? []).map((r) => [r.id, r]));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${ICS_PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(input.calendarName)}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${FEED_LIMITS.refresh}`,
    `X-PUBLISHED-TTL:${FEED_LIMITS.refresh}`,
  ];
  for (const c of input.claims) {
    lines.push(...bookingEventLines(c, { projectId: input.projectId, offering: offerings.get(c.offeringId), resource: resources.get(c.resourceId), stamp: c.updatedAt.getTime() }));
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

/**
 * One booking as a VEVENT, the same wherever it goes (the feed, a CalDAV calendar): confirmed or tentative, the
 * customer's details in the description, whole days for a rental by the day. Unfolded lines.
 */
export function bookingEventLines(
  c: Pick<ClaimRow, 'id' | 'state' | 'startAt' | 'endAt' | 'units' | 'customer'>,
  ctx: { projectId: string; offering: BookingOffering | undefined; resource: BookingResource | undefined; stamp: number },
): string[] {
  const { offering, resource } = ctx;
  const start = c.startAt.getTime();
  const end = c.endAt.getTime();
  const pending = c.state === 'pending';
  const customer = c.customer ?? {};
  const who = customer.name?.trim() || customer.email?.trim() || 'a customer';
  const description = [
    resource ? `With: ${resource.name}` : '',
    c.units > 1 ? `For: ${c.units}` : '',
    customer.name ? `Name: ${customer.name}` : '',
    customer.email ? `Email: ${customer.email}` : '',
    customer.phone ? `Phone: ${customer.phone}` : '',
    customer.note ? `Note: ${customer.note}` : '',
    pending ? 'A request: accept or decline it in the Bookings tab.' : '',
  ].filter(Boolean);
  const lines = ['BEGIN:VEVENT', `UID:${icsText(`${c.id}@${ctx.projectId}`)}`, `DTSTAMP:${icsUtc(ctx.stamp)}`];
  if (offering?.mode === 'days' && offering.unit === 'day' && resource) {
    // Whole days on the resource's clock, the end date exclusive (as the invitation writes them).
    lines.push(`DTSTART;VALUE=DATE:${ymd(localDateOf(start, resource.timeZone))}`);
    const lastDay = localDateOf(end - 1, resource.timeZone);
    lines.push(`DTEND;VALUE=DATE:${ymd(addDays(lastDay, 1))}`);
  } else {
    lines.push(`DTSTART:${icsUtc(start)}`, `DTEND:${icsUtc(end)}`);
  }
  lines.push('SEQUENCE:0', `STATUS:${pending ? 'TENTATIVE' : 'CONFIRMED'}`, 'TRANSP:OPAQUE', `SUMMARY:${icsText(`${offering?.name ?? 'Booking'}: ${who}${pending ? ' (request)' : ''}`)}`);
  if (description.length) lines.push(`DESCRIPTION:${icsText(description.join('\n'))}`);
  lines.push('END:VEVENT');
  return lines;
}
