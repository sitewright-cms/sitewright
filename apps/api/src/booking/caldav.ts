import { find, findAll, okResponses, parseXml, textOf, type XmlNode } from './dav-xml.js';
import { icsUtc } from './ics.js';

/**
 * A CALDAV CALENDAR (RFC 4791): Nextcloud, Fastmail, iCloud, Radicale, Baïkal, SOGo, Zimbra… One account, its
 * calendars found from the server's address, and a calendar's events read for a stretch of time.
 *
 * ★ The transport is the platform's SSRF-guarded HTTPS client (`pinnedFetchDetailed`): public addresses only,
 * connections pinned to the address that was checked, and a request carrying the password never follows a
 * redirect to another origin, nor goes to an address a server names on another (see `sameService`). Credentials
 * are an app password the business makes for this (iCloud requires one).
 */

export interface DavAuth {
  username: string;
  password: string;
}

export type DavResponse = { ok: true; status: number; headers: Record<string, string>; text: string } | { ok: false; error: string };

/** One HTTP exchange with a DAV server. Never throws. */
export type DavTransport = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<DavResponse>;

export interface FoundCalendar {
  url: string;
  name: string;
}

export const CALDAV_LIMITS = {
  /** Calendars listed from one account. */
  calendars: 100,
  /** Steps of discovery (well-known, principal, home, calendars). */
  steps: 4,
} as const;

const XML = 'application/xml; charset=utf-8';

const authHeader = (auth: DavAuth): string => `Basic ${Buffer.from(`${auth.username}:${auth.password}`, 'utf8').toString('base64')}`;

const xmlEscape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A server's answer in words the business can act on. */
function refusal(status: number): string {
  if (status === 401) return 'the server did not accept the username or password (iCloud and Fastmail need an app password)';
  if (status === 403) return 'the server refused this account access to the calendar';
  if (status === 404) return 'there is no calendar at this address';
  return `the calendar server answered ${status}`;
}

/** An https URL, or null. A `webcal`/`caldav` address is not a server address (that is an ICS link). */
export function davUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' && u.hostname ? u : null;
  } catch {
    return null;
  }
}

async function propfind(transport: DavTransport, url: string, auth: DavAuth, depth: '0' | '1', props: string): Promise<{ ok: true; root: XmlNode } | { ok: false; error: string; status?: number }> {
  const body = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop>${props}</d:prop></d:propfind>`;
  const res = await transport(url, { method: 'PROPFIND', headers: { authorization: authHeader(auth), depth, 'content-type': XML, accept: 'application/xml, text/xml' }, body });
  if (!res.ok) return res;
  if (res.status !== 207) return { ok: false, error: refusal(res.status), status: res.status };
  try {
    return { ok: true, root: parseXml(res.text) };
  } catch {
    return { ok: false, error: 'the calendar server answered something that is not WebDAV' };
  }
}

const isCalendar = (prop: XmlNode): boolean => {
  const type = find(prop, 'resourcetype');
  return !!type && type.children.some((c) => c.name === 'calendar');
};
/** A calendar that holds events (some servers keep tasks or journals in calendars of their own). */
const holdsEvents = (prop: XmlNode): boolean => {
  const set = find(prop, 'supported-calendar-component-set');
  return !set || set.children.length === 0 || set.children.some((c) => c.name === 'comp' && String(c.attrs.name ?? '').toUpperCase() === 'VEVENT');
};
/**
 * ★ Whether an address a server names is still that service, so the password may go there: the same origin, or
 * one of Apple's iCloud hosts (it hands each account to a host of its own, `pNN-caldav.icloud.com`). A server
 * naming any other host would otherwise have the business's password sent on to it.
 */
export function sameService(from: string, to: string): boolean {
  try {
    const a = new URL(from);
    const b = new URL(to);
    if (b.protocol !== 'https:') return false;
    if (a.origin === b.origin) return true;
    const icloud = (h: string) => h === 'icloud.com' || h.endsWith('.icloud.com');
    return icloud(a.hostname) && icloud(b.hostname);
  } catch {
    return false;
  }
}

const hrefIn = (prop: XmlNode, name: string, base: string): string | null => {
  const el = find(prop, name);
  const href = el ? textOf(find(el, 'href')) : '';
  if (!href) return null;
  try {
    const url = new URL(href, base).href;
    return sameService(base, url) ? url : null;
  } catch {
    return null;
  }
};

/**
 * The account's calendars that hold events, found from a server address (`https://cloud.example`, a principal, a
 * calendar home) or a calendar's own address. RFC 6764: the well-known address first, when given a bare server.
 */
export async function discoverCalendars(transport: DavTransport, serverUrl: string, auth: DavAuth): Promise<{ ok: true; calendars: FoundCalendar[] } | { ok: false; error: string }> {
  const start = davUrl(serverUrl);
  if (!start) return { ok: false, error: 'the server address must start with https://' };
  const props = '<d:resourcetype/><d:displayname/><d:current-user-principal/><c:calendar-home-set/><c:supported-calendar-component-set/>';
  let url = start.pathname === '/' || start.pathname === '' ? new URL('/.well-known/caldav', start).href : start.href;
  let first = await propfind(transport, url, auth, '0', props);
  // No well-known address: the server's root then.
  if (!first.ok && url !== start.href && first.status !== 401) {
    url = start.href;
    first = await propfind(transport, url, auth, '0', props);
  }
  if (!first.ok) return { ok: false, error: first.error };
  const self = okResponses(first.root)[0];
  if (!self) return { ok: false, error: 'the calendar server answered something that is not WebDAV' };
  // Given a calendar's own address.
  if (isCalendar(self.prop)) return { ok: true, calendars: holdsEvents(self.prop) ? [{ url, name: textOf(find(self.prop, 'displayname')) || 'Calendar' }] : [] };

  let home = hrefIn(self.prop, 'calendar-home-set', url);
  if (!home) {
    const principal = hrefIn(self.prop, 'current-user-principal', url);
    if (!principal) return { ok: false, error: 'this address is not a CalDAV server (no calendars were found for the account)' };
    const p = await propfind(transport, principal, auth, '0', '<c:calendar-home-set/>');
    if (!p.ok) return { ok: false, error: p.error };
    const pr = okResponses(p.root)[0];
    home = pr ? hrefIn(pr.prop, 'calendar-home-set', principal) : null;
    if (!home) return { ok: false, error: 'the account has no calendars on this server' };
  }
  const list = await propfind(transport, home, auth, '1', '<d:resourcetype/><d:displayname/><c:supported-calendar-component-set/>');
  if (!list.ok) return { ok: false, error: list.error };
  const calendars: FoundCalendar[] = [];
  for (const r of okResponses(list.root)) {
    if (!isCalendar(r.prop) || !holdsEvents(r.prop)) continue;
    let href: string;
    try {
      href = new URL(r.href, home).href;
    } catch {
      continue;
    }
    if (!sameService(home, href)) continue;
    if (calendars.some((c) => c.url === href)) continue;
    calendars.push({ url: href, name: textOf(find(r.prop, 'displayname')) || decodeURIComponent(href.replace(/\/+$/, '').split('/').pop() ?? '') || 'Calendar' });
    if (calendars.length >= CALDAV_LIMITS.calendars) break;
  }
  return { ok: true, calendars };
}

/**
 * The events of a calendar overlapping [from, to), as ONE iCalendar text the reader takes like any feed: the
 * server picks them (recurring ones included when an occurrence falls in the stretch), we only fold its answers
 * into one calendar. ★ An answer the server could not give in full is unreadable, not empty.
 */
export async function readCalendar(transport: DavTransport, calendarUrl: string, auth: DavAuth, from: number, to: number): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const body =
    `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">` +
    `<d:prop><c:calendar-data/></d:prop>` +
    `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">` +
    `<c:time-range start="${xmlEscape(icsUtc(from))}" end="${xmlEscape(icsUtc(to))}"/>` +
    `</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const res = await transport(calendarUrl, { method: 'REPORT', headers: { authorization: authHeader(auth), depth: '1', 'content-type': XML, accept: 'application/xml, text/xml' }, body });
  if (!res.ok) return res;
  if (res.status !== 207) return { ok: false, error: refusal(res.status) };
  let root: XmlNode;
  try {
    root = parseXml(res.text);
  } catch {
    return { ok: false, error: 'the calendar server answered something that is not WebDAV' };
  }
  // ★ Read in full or not at all: anything that may have left an event out makes the calendar unreadable (its
  // resource busy), never an event fewer (its time free).
  const short = { ok: false as const, error: 'the calendar server could not list all the events' };
  if (!root.children.some((c) => c.name === 'multistatus')) return { ok: false, error: 'the calendar server answered something that is not WebDAV' };
  const parts: string[] = [];
  for (const response of findAll(root, 'response')) {
    // A response's own status: a resource gone meanwhile (404) has no time to block; anything else is a gap.
    const own = response.children.find((c) => c.name === 'status');
    const ownCode = own ? /\s(\d{3})\s/.exec(` ${textOf(own)} `)?.[1] : undefined;
    if (ownCode && ownCode !== '404' && !ownCode.startsWith('2')) return short;
    if (ownCode === '404') continue;
    const data = okResponses({ name: '#root', attrs: {}, children: [response], text: '' })
      .map((r) => find(r.prop, 'calendar-data'))
      .find((d) => d !== undefined);
    // An event listed without its data (refused, or failed) is an event unread.
    if (!data) return short;
    const comps = components(textOf(data));
    if (!comps) return short;
    parts.push(...comps);
  }
  return { ok: true, text: ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//caldav//EN', ...parts, 'END:VCALENDAR', ''].join('\r\n') };
}

/**
 * The components of one iCalendar object (its events and zones), without the calendar around them. ★ Null when
 * the object does not nest properly (an END that closes what it did not open, something left open, a second
 * calendar): a broken object could otherwise swallow the events after it, and their times would read as free.
 */
export function components(ics: string): string[] | null {
  const out: string[] = [];
  const open: string[] = [];
  let calendars = 0;
  for (const line of ics.split(/\r\n|\n|\r/)) {
    const begin = /^BEGIN:(.+)$/i.exec(line);
    const end = /^END:(.+)$/i.exec(line);
    if (begin) {
      const name = begin[1]!.trim().toUpperCase();
      if (open.length === 0 && (name !== 'VCALENDAR' || ++calendars > 1)) return null;
      open.push(name);
      if (open.length >= 2) out.push(line);
    } else if (end) {
      if (open.pop() !== end[1]!.trim().toUpperCase()) return null;
      if (open.length >= 1) out.push(line);
    } else if (open.length >= 2) {
      // A component's property, or a folded continuation of one.
      out.push(line);
    }
  }
  return open.length === 0 ? out : null;
}
