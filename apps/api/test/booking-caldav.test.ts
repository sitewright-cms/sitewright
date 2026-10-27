import { describe, it, expect } from 'vitest';
import { components, davUrl, discoverCalendars, readCalendar, sameService, type DavTransport } from '../src/booking/caldav.js';
import { parseXml } from '../src/booking/dav-xml.js';
import { readIcsBusy } from '../src/booking/ics-read.js';

/**
 * A CalDAV account: its calendars found from the server's address, and a calendar's events read for a stretch.
 * The fake server answers as Nextcloud does (`d:`/`cal:` prefixes) and as iCloud does (default namespaces), and
 * keeps a log of what it was asked.
 */

const AUTH = { username: 'anna', password: 'app-pass-1234' };
const BASIC = `Basic ${Buffer.from('anna:app-pass-1234').toString('base64')}`;

type Handler = (body: string, headers: Record<string, string>) => { status: number; text?: string };
function server(routes: Record<string, Partial<Record<string, Handler>>>) {
  const log: string[] = [];
  const transport: DavTransport = async (url, init) => {
    log.push(`${init.method} ${url}`);
    if (init.headers.authorization !== BASIC) return { ok: true, status: 401, headers: {}, text: '' };
    const h = routes[url]?.[init.method];
    if (!h) return { ok: true, status: 404, headers: {}, text: '' };
    const r = h(init.body ?? '', init.headers);
    return { ok: true, status: r.status, headers: {}, text: r.text ?? '' };
  };
  return { transport, log };
}

const ms = (inner: string) => `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">${inner}</d:multistatus>`;
const ok = (href: string, prop: string) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${prop}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;

/** Nextcloud: the well-known address, then the principal, then the calendar home. */
const NEXTCLOUD = {
  'https://cloud.example/.well-known/caldav': {
    PROPFIND: () => ({ status: 207, text: ms(ok('/remote.php/dav/', '<d:current-user-principal><d:href>/remote.php/dav/principals/users/anna/</d:href></d:current-user-principal>')) }),
  },
  'https://cloud.example/remote.php/dav/principals/users/anna/': {
    PROPFIND: () => ({ status: 207, text: ms(ok('/remote.php/dav/principals/users/anna/', '<cal:calendar-home-set><d:href>/remote.php/dav/calendars/anna/</d:href></cal:calendar-home-set>')) }),
  },
  'https://cloud.example/remote.php/dav/calendars/anna/': {
    PROPFIND: (_b: string, h: Record<string, string>) => {
      expect(h.depth).toBe('1');
      return {
        status: 207,
        text: ms(
          ok('/remote.php/dav/calendars/anna/', '<d:resourcetype><d:collection/></d:resourcetype>') +
            ok('/remote.php/dav/calendars/anna/personal/', '<d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><d:displayname>Personal</d:displayname><cal:supported-calendar-component-set><cal:comp name="VEVENT"/><cal:comp name="VTODO"/></cal:supported-calendar-component-set>') +
            ok('/remote.php/dav/calendars/anna/tasks/', '<d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><d:displayname>Tasks</d:displayname><cal:supported-calendar-component-set><cal:comp name="VTODO"/></cal:supported-calendar-component-set>') +
            ok('/remote.php/dav/calendars/anna/work%20shifts/', '<d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>'),
        ),
      };
    },
  },
};

describe('finding an account’s calendars', () => {
  it('★ goes from the server’s address to the calendars that hold events', async () => {
    const { transport, log } = server(NEXTCLOUD);
    expect(await discoverCalendars(transport, 'https://cloud.example', AUTH)).toEqual({
      ok: true,
      calendars: [
        { url: 'https://cloud.example/remote.php/dav/calendars/anna/personal/', name: 'Personal' },
        // No name: named after its address. The tasks-only calendar is left out.
        { url: 'https://cloud.example/remote.php/dav/calendars/anna/work%20shifts/', name: 'work shifts' },
      ],
    });
    expect(log).toEqual([
      'PROPFIND https://cloud.example/.well-known/caldav',
      'PROPFIND https://cloud.example/remote.php/dav/principals/users/anna/',
      'PROPFIND https://cloud.example/remote.php/dav/calendars/anna/',
    ]);
  });

  it('takes a calendar’s own address as it is, iCloud’s default namespaces included', async () => {
    const url = 'https://p01-caldav.icloud.com/1234/calendars/home/';
    const { transport } = server({
      [url]: {
        PROPFIND: () => ({
          status: 207,
          text: `<multistatus xmlns="DAV:"><response><href>/1234/calendars/home/</href><propstat><prop><resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype><displayname>Home &amp; Work</displayname></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`,
        }),
      },
    });
    expect(await discoverCalendars(transport, url, AUTH)).toEqual({ ok: true, calendars: [{ url, name: 'Home & Work' }] });
  });

  it('falls back to the server’s root when it has no well-known address', async () => {
    const { transport, log } = server({
      'https://dav.example/': {
        PROPFIND: () => ({ status: 207, text: ms(ok('/', '<cal:calendar-home-set><d:href>/cals/anna/</d:href></cal:calendar-home-set>')) }),
      },
      'https://dav.example/cals/anna/': {
        PROPFIND: () => ({ status: 207, text: ms(ok('/cals/anna/main/', '<d:resourcetype><cal:calendar/></d:resourcetype><d:displayname>Main</d:displayname>')) }),
      },
    });
    expect(await discoverCalendars(transport, 'https://dav.example/', AUTH)).toEqual({ ok: true, calendars: [{ url: 'https://dav.example/cals/anna/main/', name: 'Main' }] });
    expect(log[0]).toBe('PROPFIND https://dav.example/.well-known/caldav');
  });

  it('says what is wrong, in words the business can act on', async () => {
    const { transport } = server(NEXTCLOUD);
    expect(await discoverCalendars(transport, 'https://cloud.example', { username: 'anna', password: 'wrong' })).toEqual({
      ok: false,
      error: 'the server did not accept the username or password (iCloud and Fastmail need an app password)',
    });
    expect(await discoverCalendars(transport, 'http://cloud.example', AUTH)).toMatchObject({ ok: false, error: 'the server address must start with https://' });
    const notDav = server({ 'https://www.example/blog/': { PROPFIND: () => ({ status: 207, text: '<html><body>hello</body></html>' }) } });
    expect(await discoverCalendars(notDav.transport, 'https://www.example/blog/', AUTH)).toMatchObject({ ok: false });
    const down: DavTransport = async () => ({ ok: false, error: 'the calendar server could not be reached' });
    expect(await discoverCalendars(down, 'https://cloud.example', AUTH)).toEqual({ ok: false, error: 'the calendar server could not be reached' });
  });
});

const CAL = 'https://cloud.example/remote.php/dav/calendars/anna/personal/';
const event = (uid: string, start: string, end: string, extra = '') =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nextcloud//EN', extra, 'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20261001T000000Z', start, end, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR']
    .filter(Boolean)
    .join('\r\n');
const ZONE = ['BEGIN:VTIMEZONE', 'TZID:Studio Time', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0100', 'END:STANDARD', 'END:VTIMEZONE'].join('\r\n');

describe('reading a calendar', () => {
  it('★ asks for the stretch, and folds the events into one calendar the reader takes', async () => {
    let asked = '';
    const { transport } = server({
      [CAL]: {
        REPORT: (body, h) => {
          asked = body;
          expect(h.depth).toBe('1');
          return {
            status: 207,
            text: ms(
              ok('/a.ics', `<d:getetag>"1"</d:getetag><cal:calendar-data>${event('a', 'DTSTART:20261028T090000Z', 'DTEND:20261028T100000Z')}</cal:calendar-data>`) +
                ok('/b.ics', `<cal:calendar-data><![CDATA[${event('b', 'DTSTART;TZID=Studio Time:20261029T140000', 'DTEND;TZID=Studio Time:20261029T150000', ZONE)}]]></cal:calendar-data>`) +
                // Gone meanwhile: not an event.
                '<d:response><d:href>/c.ics</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>',
            ),
          };
        },
      },
    });
    const from = Date.UTC(2026, 9, 26);
    const to = Date.UTC(2026, 10, 9);
    const r = await readCalendar(transport, CAL, AUTH, from, to);
    expect(r.ok).toBe(true);
    expect(asked).toContain('<c:time-range start="20261026T000000Z" end="20261109T000000Z"/>');
    const busy = await readIcsBusy((r as { text: string }).text, { from, to, timeZone: 'Europe/Berlin' });
    expect(busy).toEqual({
      ok: true,
      events: 2,
      intervals: [
        { start: Date.UTC(2026, 9, 28, 9), end: Date.UTC(2026, 9, 28, 10) },
        // The calendar's own zone (UTC+1).
        { start: Date.UTC(2026, 9, 29, 13), end: Date.UTC(2026, 9, 29, 14) },
      ],
    });
  });

  it('★ does not read a cut-short answer, or a refusal, as an empty calendar', async () => {
    const cut = server({ [CAL]: { REPORT: () => ({ status: 207, text: ms('<d:response><d:href>/</d:href><d:status>HTTP/1.1 507 Insufficient Storage</d:status></d:response>') }) } });
    expect(await readCalendar(cut.transport, CAL, AUTH, 0, 1)).toEqual({ ok: false, error: 'the calendar server could not list all the events' });
    const gone = server({});
    expect(await readCalendar(gone.transport, CAL, AUTH, 0, 1)).toEqual({ ok: false, error: 'there is no calendar at this address' });
    expect(await readCalendar(gone.transport, CAL, { username: 'x', password: 'y' }, 0, 1)).toMatchObject({ ok: false, error: /username or password/ });
  });

  it('keeps a component whole, its nested parts and folded lines included, and nothing of the calendar around it', () => {
    const text = ['BEGIN:VCALENDAR', 'PRODID:x', ' continued', 'BEGIN:VEVENT', 'SUMMARY:a long', '  title', 'BEGIN:VALARM', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\n');
    expect(components(text)).toEqual(['BEGIN:VEVENT', 'SUMMARY:a long', '  title', 'BEGIN:VALARM', 'END:VALARM', 'END:VEVENT']);
  });

  it('takes https server addresses only', () => {
    expect(davUrl(' https://cloud.example/dav ')?.href).toBe('https://cloud.example/dav');
    expect(davUrl('webcal://cloud.example/x')).toBeNull();
    expect(davUrl('nonsense')).toBeNull();
  });
});

describe('★ the password goes to the account’s own server only', () => {
  it('knows which addresses are still the same service', () => {
    expect(sameService('https://cloud.example/.well-known/caldav', 'https://cloud.example/remote.php/dav/')).toBe(true);
    expect(sameService('https://caldav.icloud.com/', 'https://p42-caldav.icloud.com/1234/calendars/')).toBe(true);
    expect(sameService('https://cloud.example/', 'https://evil.example/collect')).toBe(false);
    expect(sameService('https://cloud.example/', 'http://cloud.example/x')).toBe(false);
    expect(sameService('https://cloud.example/', 'https://cloud.example:8443/x')).toBe(false);
    expect(sameService('https://evil-icloud.com/', 'https://p1-caldav.icloud.com/')).toBe(false);
  });

  it('does not follow a server that names a calendar home, or calendars, on another host', async () => {
    const log: string[] = [];
    const transport: DavTransport = async (url, init) => {
      log.push(`${init.method} ${url}`);
      if (url === 'https://cloud.example/.well-known/caldav') return { ok: true, status: 207, headers: {}, text: ms(ok('/', '<cal:calendar-home-set><d:href>https://evil.example/home/</d:href></cal:calendar-home-set>')) };
      return { ok: true, status: 404, headers: {}, text: '' };
    };
    expect(await discoverCalendars(transport, 'https://cloud.example', AUTH)).toMatchObject({ ok: false });
    expect(log.some((l) => l.includes('evil.example'))).toBe(false);

    const listing = server({
      'https://dav.example/cal/': {
        PROPFIND: () => ({ status: 207, text: ms(ok('/cal/', '<cal:calendar-home-set><d:href>/home/</d:href></cal:calendar-home-set>')) }),
      },
      'https://dav.example/home/': {
        PROPFIND: () => ({ status: 207, text: ms(ok('https://evil.example/stolen/', '<d:resourcetype><cal:calendar/></d:resourcetype>') + ok('/home/mine/', '<d:resourcetype><cal:calendar/></d:resourcetype><d:displayname>Mine</d:displayname>')) }),
      },
    });
    expect(await discoverCalendars(listing.transport, 'https://dav.example/cal/', AUTH)).toEqual({ ok: true, calendars: [{ url: 'https://dav.example/home/mine/', name: 'Mine' }] });
  });
});

describe('★ a partial answer is unreadable, not an event fewer', () => {
  const answer = (text: string, status = 207) => server({ [CAL]: { REPORT: () => ({ status, text }) } }).transport;
  const SHORT = { ok: false, error: 'the calendar server could not list all the events' };

  it('refuses an entry that failed, or came without its data', async () => {
    expect(await readCalendar(answer(ms('<d:response><d:href>/x.ics</d:href><d:status>HTTP/1.1 500 Internal Server Error</d:status></d:response>')), CAL, AUTH, 0, 1)).toEqual(SHORT);
    expect(await readCalendar(answer(ms('<d:response><d:href>/x.ics</d:href><d:propstat><d:prop><cal:calendar-data/></d:prop><d:status>HTTP/1.1 403 Forbidden</d:status></d:propstat></d:response>')), CAL, AUTH, 0, 1)).toEqual(SHORT);
    expect(await readCalendar(answer(ms(ok('/x.ics', '<d:getetag>"1"</d:getetag>'))), CAL, AUTH, 0, 1)).toEqual(SHORT);
  });

  it('refuses a body that is not a multistatus, and an object that does not nest', async () => {
    expect(await readCalendar(answer('<html><body>Sign in</body></html>'), CAL, AUTH, 0, 1)).toEqual({ ok: false, error: 'the calendar server answered something that is not WebDAV' });
    expect(await readCalendar(answer(''), CAL, AUTH, 0, 1)).toMatchObject({ ok: false });
    const broken = ['BEGIN:VCALENDAR', 'END:VCALENDAR', 'BEGIN:VEVENT', 'UID:x', 'END:VEVENT'].join('\r\n');
    expect(await readCalendar(answer(ms(ok('/x.ics', `<cal:calendar-data>${broken}</cal:calendar-data>`))), CAL, AUTH, 0, 1)).toEqual(SHORT);
  });

  it('knows a well-formed object from a broken one', () => {
    expect(components(['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'END:VEVENT', 'END:VCALENDAR'].join('\n'))).toEqual(['BEGIN:VEVENT', 'END:VEVENT']);
    expect(components(['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'END:VCALENDAR'].join('\n'))).toBeNull();
    expect(components(['BEGIN:VCALENDAR', 'BEGIN:VEVENT'].join('\n'))).toBeNull();
    expect(components(['BEGIN:VEVENT', 'END:VEVENT'].join('\n'))).toBeNull();
    expect(components(['BEGIN:VCALENDAR', 'END:VCALENDAR', 'BEGIN:VCALENDAR', 'END:VCALENDAR'].join('\n'))).toBeNull();
  });

  it('refuses a document nested deep enough to exhaust the stack', async () => {
    const deep = '<a>'.repeat(5000) + '</a>'.repeat(5000);
    expect(() => parseXml(deep)).toThrow(/too deep/);
    expect(await readCalendar(answer(ms(deep)), CAL, AUTH, 0, 1)).toMatchObject({ ok: false });
  });
});
