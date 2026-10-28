import { createHash, createHmac } from 'node:crypto';
import { googleAccessToken, type GoogleServiceAccountKey } from '../webmaster/google.js';
import { isRecord, requestJson, WebmasterError, type WebmasterIo } from '../webmaster/request.js';
import type { Interval } from './occupancy.js';
import { mergeIntervals } from './ics-read.js';
import { addDays, localDateOf, zonedToInstant } from './zoned.js';
import { bookingText, wholeDays } from './feed.js';
import type { ClaimRow } from './claims.js';
import type { BookingConfig } from '@sitewright/schema';

/**
 * A GOOGLE CALENDAR, through the platform's ONE service account (the one Search Console uses): the business shares
 * its calendar with the account's address ("Make changes to events"), and the calendar's busy times are read and
 * its bookings written with the account's own token. No user signs in, nothing per business is stored but the
 * calendar's id.
 *
 * ★ Read like every outside calendar, failing CLOSED: a calendar that cannot be read in full is unreadable, never
 * free. Google expands recurring events itself (`singleEvents`). The bookings we wrote (iCalUID `<claim>@<project>`)
 * are skipped, so a booking never blocks its own time twice.
 * ★ A booking's event has an id made from the booking (`eventIdFor`), so putting it again updates it and taking it
 * out finds it, whatever happened in between.
 */

export const GOOGLE_CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'] as const;
const API = 'https://www.googleapis.com/calendar/v3';
const SERVICE = 'Google Calendar';

export const GOOGLE_CALENDAR_LIMITS = {
  /** Events asked for per page (Google's most). */
  pageSize: 2_500,
  /** Pages read for one calendar: past this the reading is incomplete, so unreadable. */
  pages: 20,
  /**
   * Calls to Google Calendar at once, across the instance. Every project shares the one service account and its
   * quota: one project with many big calendars must not use it all up for the others.
   */
  concurrent: 4,
} as const;

let running = 0;
const waiting: Array<() => void> = [];
/** Runs `fn` in one of the instance's few Google Calendar slots; a finished call hands its slot to the next. */
async function inSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running < GOOGLE_CALENDAR_LIMITS.concurrent) running += 1;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

/** A calendar id: an address-like id (`name@group.calendar.google.com`, a person's address), as Google shows it. */
export const GOOGLE_CALENDAR_ID_RE = /^[A-Za-z0-9._%+-]{1,200}@[A-Za-z0-9.-]{1,200}$/;

const cal = (calendarId: string): string => `${API}/calendars/${encodeURIComponent(calendarId)}`;

/** What Google said, in words the business can act on. The service account's address is the one to share with. */
function refusal(status: number, json: unknown, serviceAccount: string): string {
  const reasons = isRecord(json) && isRecord(json.error) && Array.isArray(json.error.errors) ? json.error.errors : [];
  const reason = reasons.map((e) => (isRecord(e) ? String(e.reason ?? '') : '')).join(' ');
  if (/accessNotConfigured|SERVICE_DISABLED/.test(reason) || /has not been used|is disabled/.test(JSON.stringify(json))) {
    return 'the Google Calendar API is not enabled for the platform’s Google Cloud project: ask the platform’s administrator';
  }
  if (status === 404) return `the calendar is not shared with ${serviceAccount}, or its id is wrong`;
  if (status === 403) return `${serviceAccount} may see the calendar but not change it: share it with “Make changes to events”`;
  if (status === 429) return 'Google is limiting requests; it is tried again shortly';
  return `Google answered ${status}`;
}

async function call(
  key: GoogleServiceAccountKey,
  io: WebmasterIo,
  url: string,
  init: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown },
): Promise<{ status: number; json: unknown }> {
  const send = async (token: string) =>
    requestJson(
      SERVICE,
      url,
      {
        method: init.method,
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      },
      io,
    );
  return inSlot(async () => {
    const first = await send(await googleAccessToken(key, io, new Date(), { scopes: GOOGLE_CALENDAR_SCOPES }));
    // A kept token Google no longer takes: once more with a new one.
    return first.status === 401 && io.tokens ? send(await googleAccessToken(key, io, new Date(), { scopes: GOOGLE_CALENDAR_SCOPES })) : first;
  });
}

/**
 * Whether the service account can reach the calendar; its name and description if so (the description carries the
 * project's proof that the calendar is its own, see the routes). Only reads (a calendar's details).
 */
export async function checkGoogleCalendar(
  key: GoogleServiceAccountKey,
  io: WebmasterIo,
  calendarId: string,
): Promise<{ ok: true; name: string; description: string } | { ok: false; error: string }> {
  try {
    const r = await call(key, io, cal(calendarId), { method: 'GET' });
    if (r.status !== 200) return { ok: false, error: refusal(r.status, r.json, key.clientEmail) };
    return {
      ok: true,
      name: isRecord(r.json) && typeof r.json.summary === 'string' ? r.json.summary : calendarId,
      description: isRecord(r.json) && typeof r.json.description === 'string' ? r.json.description : '',
    };
  } catch (err) {
    return { ok: false, error: err instanceof WebmasterError ? err.message : 'Google could not be reached' };
  }
}

function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** An RFC 3339 instant Google answers with, or NaN. */
const instant = (s: unknown): number => (typeof s === 'string' ? Date.parse(s) : NaN);

/** A whole day `YYYY-MM-DD` at midnight on `timeZone`'s clock, or NaN. */
function dayStart(s: unknown, timeZone: string): number {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return zonedToInstant({ y, m, d }, 0, timeZone);
}

/**
 * The calendar's busy times overlapping [from, to), merged. `timeZone`: for all-day events, when the calendar does
 * not say its own. `ownUidSuffix`: our own bookings' iCalUIDs end so, and are skipped.
 */
export async function readGoogleCalendar(
  key: GoogleServiceAccountKey,
  io: WebmasterIo,
  calendarId: string,
  opts: { from: number; to: number; timeZone: string; ownUidSuffix: string },
): Promise<{ ok: true; intervals: Interval[]; events: number } | { ok: false; error: string }> {
  const out: Interval[] = [];
  let events = 0;
  let pageToken: string | undefined;
  try {
    for (let page = 0; page < GOOGLE_CALENDAR_LIMITS.pages; page += 1) {
      const q = new URLSearchParams({
        timeMin: new Date(opts.from).toISOString(),
        timeMax: new Date(opts.to).toISOString(),
        singleEvents: 'true',
        showDeleted: 'false',
        maxResults: String(GOOGLE_CALENDAR_LIMITS.pageSize),
        fields: 'timeZone,nextPageToken,items(status,transparency,iCalUID,creator,start,end)',
        ...(pageToken ? { pageToken } : {}),
      });
      const r = await call(key, io, `${cal(calendarId)}/events?${q}`, { method: 'GET' });
      if (r.status !== 200 || !isRecord(r.json)) return { ok: false, error: refusal(r.status, r.json, key.clientEmail) };
      const zone = typeof r.json.timeZone === 'string' && validZone(r.json.timeZone) ? r.json.timeZone : opts.timeZone;
      const items = Array.isArray(r.json.items) ? r.json.items : [];
      for (const item of items) {
        if (!isRecord(item)) continue;
        events += 1;
        if (item.status === 'cancelled' || item.transparency === 'transparent') continue;
        // Our own booking: its UID AND made by the platform's account (an invitation from outside can carry any UID).
        const creator = isRecord(item.creator) && typeof item.creator.email === 'string' ? item.creator.email.toLowerCase() : '';
        if (typeof item.iCalUID === 'string' && item.iCalUID.endsWith(opts.ownUidSuffix) && creator === key.clientEmail.toLowerCase()) continue;
        const start = isRecord(item.start) ? item.start : {};
        const end = isRecord(item.end) ? item.end : {};
        const s = start.dateTime !== undefined ? instant(start.dateTime) : dayStart(start.date, zone);
        const e = end.dateTime !== undefined ? instant(end.dateTime) : dayStart(end.date, zone);
        // ★ An event we cannot place is an event we cannot rule out: the calendar is unreadable, not free.
        if (!Number.isFinite(s) || !Number.isFinite(e)) return { ok: false, error: 'the calendar has an event that could not be read' };
        if (e > s && e > opts.from && s < opts.to) out.push({ start: Math.max(s, opts.from), end: Math.min(e, opts.to) });
      }
      pageToken = typeof r.json.nextPageToken === 'string' && r.json.nextPageToken ? r.json.nextPageToken : undefined;
      if (!pageToken) return { ok: true, intervals: mergeIntervals(out), events };
    }
    return { ok: false, error: 'the calendar has more events than can be read' };
  } catch (err) {
    return { ok: false, error: err instanceof WebmasterError ? err.message : 'Google could not be reached' };
  }
}

/** The event id a booking has in Google: lower-case base32hex (Google's alphabet, `0-9a-v`) of a hash of it. */
export function eventIdFor(projectId: string, claimId: string): string {
  const bytes = createHash('sha256').update(`${projectId}:${claimId}`).digest();
  const alphabet = '0123456789abcdefghijklmnopqrstuv';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  // The last bits, padded.
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

/** A booking as Google wants it. */
export interface GoogleEvent {
  id: string;
  iCalUID: string;
  summary: string;
  description?: string;
  status: 'confirmed' | 'tentative';
  start: { dateTime: string } | { date: string };
  end: { dateTime: string } | { date: string };
}

/** The outcome of a write, as the calendar-write pass reads it. */
export type GoogleWrite = { ok: true } | { ok: false; error: string; final: boolean };

/** Puts the event in: updates the booking's event if it is there (or was taken out), else adds it. */
export async function putGoogleEvent(key: GoogleServiceAccountKey, io: WebmasterIo, calendarId: string, event: GoogleEvent): Promise<GoogleWrite> {
  try {
    const url = `${cal(calendarId)}/events/${event.id}`;
    const body = { ...event, transparency: 'opaque' };
    let r = await call(key, io, url, { method: 'PUT', body });
    if (r.status === 404) r = await call(key, io, `${cal(calendarId)}/events`, { method: 'POST', body });
    return writeOutcome(r, key, false);
  } catch (err) {
    return { ok: false, error: err instanceof WebmasterError ? err.message : 'Google could not be reached', final: false };
  }
}

/** Takes the booking's event out. Not there (any more) is done. */
export async function deleteGoogleEvent(key: GoogleServiceAccountKey, io: WebmasterIo, calendarId: string, eventId: string): Promise<GoogleWrite> {
  try {
    const r = await call(key, io, `${cal(calendarId)}/events/${eventId}`, { method: 'DELETE' });
    return writeOutcome(r, key, true);
  } catch (err) {
    return { ok: false, error: err instanceof WebmasterError ? err.message : 'Google could not be reached', final: false };
  }
}

function writeOutcome(r: { status: number; json: unknown }, key: GoogleServiceAccountKey, deleting: boolean): GoogleWrite {
  if (r.status >= 200 && r.status < 300) return { ok: true };
  if (deleting && (r.status === 404 || r.status === 410)) return { ok: true };
  // Not shared (any more), shared read-only, the API switched off: the business (or the platform) has to act.
  const final = r.status === 403 || r.status === 404;
  return { ok: false, error: refusal(r.status, r.json, key.clientEmail), final };
}

const ymd = (d: { y: number; m: number; d: number }): string => `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;

/** A booking as its Google event: the same title and details as everywhere, whole days for a rental by the day. */
export function googleEventFor(projectId: string, claim: Pick<ClaimRow, 'id' | 'state' | 'startAt' | 'endAt' | 'units' | 'customer' | 'resourceId' | 'offeringId'>, config: BookingConfig | null): GoogleEvent {
  const offering = config?.offerings.find((o) => o.id === claim.offeringId);
  const resource = config?.resources.find((r) => r.id === claim.resourceId);
  const text = bookingText(claim, offering, resource);
  // Google shows some HTML in an event's description: a customer's note is text, never a link or markup.
  const html = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const summary = text.summary;
  const description = html(text.description);
  const start = claim.startAt.getTime();
  const end = claim.endAt.getTime();
  const days = wholeDays(offering, resource);
  return {
    id: eventIdFor(projectId, claim.id),
    iCalUID: `${claim.id}@${projectId}`,
    summary,
    ...(description ? { description } : {}),
    status: claim.state === 'pending' ? 'tentative' : 'confirmed',
    start: days ? { date: ymd(localDateOf(start, resource.timeZone)) } : { dateTime: new Date(start).toISOString() },
    end: days ? { date: ymd(addDays(localDateOf(end - 1, resource.timeZone), 1)) } : { dateTime: new Date(end).toISOString() },
  };
}

/**
 * ★ The code a project proves a Google calendar is its own with: it goes into the calendar's description. The
 * platform's service account is shared by every project, so being shared with it proves nothing about WHICH
 * project's calendar it is; only the calendar's owner can set its description. Made from the project and the
 * platform's secret, so it is the same every time and no other project can know it.
 */
export function googleProofCode(projectId: string, secret: Buffer): string {
  return `booking-${createHmac('sha256', secret).update(`google-calendar:${projectId}`).digest('hex').slice(0, 12)}`;
}
