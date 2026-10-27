import { describe, it, expect } from 'vitest';
import { readIcsBusy, mergeIntervals } from '../src/booking/ics-read.js';

/**
 * Reading busy times from an iCalendar feed: what Google, Outlook, Apple and the rental platforms publish.
 * ★ The cases that would book someone into a taken time: a recurring event's occurrences, a moved occurrence,
 * a zone the calendar defines itself, all-day events, floating times, and a calendar too big or too busy to read
 * (unreadable, so its resource is blocked, never read as free).
 */

const cal = (...events: string[]): string => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...events, 'END:VCALENDAR', ''].join('\r\n');
const ev = (...lines: string[]): string => ['BEGIN:VEVENT', `DTSTAMP:20261001T000000Z`, ...lines, 'END:VEVENT'].join('\r\n');
// Monday 26 October 2026 to Monday 9 November 2026. Berlin is on winter time (UTC+1) from 25 October.
const WINDOW = { from: Date.UTC(2026, 9, 26), to: Date.UTC(2026, 10, 9), timeZone: 'Europe/Berlin' };
const read = async (text: string, over: Partial<typeof WINDOW & { ownUidSuffix: string }> = {}) => {
  const r = await readIcsBusy(text, { ...WINDOW, ...over });
  if (!r.ok) throw new Error(r.error);
  return r.intervals;
};
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);

describe('one-off events', () => {
  it('reads a named zone, UTC, a floating time on the resource’s clock, and an all-day date', async () => {
    const busy = await read(
      cal(
        ev('UID:a', 'DTSTART;TZID=Europe/Berlin:20261028T100000', 'DTEND;TZID=Europe/Berlin:20261028T113000'),
        ev('UID:b', 'DTSTART:20261029T150000Z', 'DTEND:20261029T160000Z'),
        ev('UID:c', 'DTSTART:20261030T090000', 'DTEND:20261030T100000'),
        ev('UID:d', 'DTSTART;VALUE=DATE:20261102', 'DTEND;VALUE=DATE:20261103'),
      ),
    );
    expect(busy.map((i) => [iso(i.start), iso(i.end)])).toEqual([
      ['2026-10-28T09:00', '2026-10-28T10:30'],
      ['2026-10-29T15:00', '2026-10-29T16:00'],
      ['2026-10-30T08:00', '2026-10-30T09:00'],
      // The whole local day: midnight to midnight in Berlin.
      ['2026-11-01T23:00', '2026-11-02T23:00'],
    ]);
  });

  it('reads an event given a duration instead of an end, and a date with no end as one day', async () => {
    const busy = await read(cal(ev('UID:a', 'DTSTART;TZID=Europe/Berlin:20261028T100000', 'DURATION:PT45M'), ev('UID:b', 'DTSTART;VALUE=DATE:20261104')));
    expect(busy.map((i) => [iso(i.start), iso(i.end)])).toEqual([
      ['2026-10-28T09:00', '2026-10-28T09:45'],
      ['2026-11-03T23:00', '2026-11-04T23:00'],
    ]);
  });

  it('does not count what does not block: free time, cancelled events, and this project’s own bookings', async () => {
    const busy = await read(
      cal(
        ev('UID:free', 'DTSTART:20261028T100000Z', 'DTEND:20261028T110000Z', 'TRANSP:TRANSPARENT'),
        ev('UID:off', 'DTSTART:20261028T120000Z', 'DTEND:20261028T130000Z', 'STATUS:CANCELLED'),
        ev('UID:claim1@p-1', 'DTSTART:20261028T140000Z', 'DTEND:20261028T150000Z'),
        ev('UID:kept', 'DTSTART:20261028T160000Z', 'DTEND:20261028T170000Z'),
      ),
      { ownUidSuffix: '@p-1' },
    );
    expect(busy.map((i) => iso(i.start))).toEqual(['2026-10-28T16:00']);
  });

  it('keeps only what falls in the window, clipped to it', async () => {
    const busy = await read(cal(ev('UID:a', 'DTSTART:20261025T220000Z', 'DTEND:20261026T020000Z'), ev('UID:b', 'DTSTART:20261201T100000Z', 'DTEND:20261201T110000Z')));
    expect(busy).toEqual([{ start: WINDOW.from, end: Date.UTC(2026, 9, 26, 2) }]);
  });
});

describe('recurring events', () => {
  it('★ expands every occurrence in the window, on local time across the clock change, minus the removed ones', async () => {
    // Every Monday at 09:00 Berlin, from summer time into winter time; one Monday removed.
    const busy = await read(
      cal(
        ev(
          'UID:weekly',
          'DTSTART;TZID=Europe/Berlin:20261005T090000',
          'DTEND;TZID=Europe/Berlin:20261005T100000',
          'RRULE:FREQ=WEEKLY;BYDAY=MO',
          'EXDATE;TZID=Europe/Berlin:20261102T090000',
        ),
      ),
    );
    // 26 October (winter time: 08:00 UTC); 2 November removed; 9 November is the window's end, not in it.
    expect(busy.map((i) => iso(i.start))).toEqual(['2026-10-26T08:00']);
  });

  it('★ honours a moved occurrence and a cancelled one', async () => {
    const busy = await read(
      cal(
        ev('UID:daily', 'DTSTART:20261026T100000Z', 'DTEND:20261026T110000Z', 'RRULE:FREQ=DAILY;COUNT=4'),
        // The second occurrence moved to the afternoon, the third cancelled.
        ev('UID:daily', 'RECURRENCE-ID:20261027T100000Z', 'DTSTART:20261027T150000Z', 'DTEND:20261027T160000Z'),
        ev('UID:daily', 'RECURRENCE-ID:20261028T100000Z', 'DTSTART:20261028T100000Z', 'DTEND:20261028T110000Z', 'STATUS:CANCELLED'),
      ),
    );
    expect(busy.map((i) => iso(i.start))).toEqual(['2026-10-26T10:00', '2026-10-27T15:00', '2026-10-29T10:00']);
  });

  it('★ reads an occurrence moved out of the window as gone, and one moved into it as there', async () => {
    const busy = await read(
      cal(
        ev('UID:weekly', 'DTSTART:20261019T100000Z', 'DTEND:20261019T110000Z', 'RRULE:FREQ=WEEKLY;COUNT=6'),
        // 26 October moved to December; 30 November (after the window) moved into it.
        ev('UID:weekly', 'RECURRENCE-ID:20261026T100000Z', 'DTSTART:20261210T100000Z', 'DTEND:20261210T110000Z'),
        ev('UID:weekly', 'RECURRENCE-ID:20261130T100000Z', 'DTSTART:20261104T100000Z', 'DTEND:20261104T110000Z'),
      ),
    );
    expect(busy.map((i) => iso(i.start))).toEqual(['2026-11-02T10:00', '2026-11-04T10:00']);
  });

  it('★ matches a moved or removed occurrence by its instant, whichever zone names it', async () => {
    // A Berlin series; Outlook-style UTC notation for the removed and the moved occurrence.
    const busy = await read(
      cal(
        ev('UID:w', 'DTSTART;TZID=Europe/Berlin:20261026T090000', 'DTEND;TZID=Europe/Berlin:20261026T100000', 'RRULE:FREQ=DAILY;COUNT=4', 'EXDATE:20261027T080000Z'),
        ev('UID:w', 'RECURRENCE-ID:20261028T080000Z', 'DTSTART:20261028T140000Z', 'DTEND:20261028T150000Z'),
      ),
    );
    expect(busy.map((i) => iso(i.start))).toEqual(['2026-10-26T08:00', '2026-10-28T14:00', '2026-10-29T08:00']);
  });

  it('reads two recurring events that share a UID as two', async () => {
    const busy = await read(
      cal(
        ev('UID:same', 'DTSTART:20261026T080000Z', 'DTEND:20261026T090000Z', 'RRULE:FREQ=DAILY;COUNT=2'),
        ev('UID:same', 'DTSTART:20261026T150000Z', 'DTEND:20261026T160000Z', 'RRULE:FREQ=DAILY;COUNT=2'),
      ),
    );
    expect(busy.map((i) => iso(i.start))).toEqual(['2026-10-26T08:00', '2026-10-26T15:00', '2026-10-27T08:00', '2026-10-27T15:00']);
  });

  it('★ never gives one series another series’ moved occurrence', async () => {
    // ical.js, left to itself, relates every changed occurrence in a calendar to every series, whatever its UID.
    const busy = await read(
      cal(
        ev('UID:a', 'DTSTART:20261026T100000Z', 'DTEND:20261026T110000Z', 'RRULE:FREQ=DAILY;COUNT=3'),
        ev('UID:b', 'DTSTART:20261026T100000Z', 'DTEND:20261026T103000Z', 'RRULE:FREQ=DAILY;COUNT=3'),
        ev('UID:b', 'RECURRENCE-ID:20261027T100000Z', 'DTSTART:20261027T150000Z', 'DTEND:20261027T153000Z'),
      ),
    );
    expect(busy.map((i) => [iso(i.start), iso(i.end)])).toEqual([
      ['2026-10-26T10:00', '2026-10-26T11:00'],
      ['2026-10-27T10:00', '2026-10-27T11:00'],
      ['2026-10-27T15:00', '2026-10-27T15:30'],
      ['2026-10-28T10:00', '2026-10-28T11:00'],
    ]);
  });

  it('counts an occurrence that began before the window and runs into it', async () => {
    // Saturday to Tuesday, every week: the one from 24 October reaches into the window.
    const busy = await read(cal(ev('UID:long', 'DTSTART:20261003T080000Z', 'DTEND:20261006T080000Z', 'RRULE:FREQ=WEEKLY;COUNT=4')));
    expect(busy).toEqual([{ start: WINDOW.from, end: Date.UTC(2026, 9, 27, 8) }]);
  });

  it('★ keeps the last occurrence of a series whose UNTIL is in UTC and its times in a zone east of it', async () => {
    // Outlook and Apple write UNTIL as the last occurrence's own instant: 07:00 UTC is 09:00 in Berlin in June.
    const busy = await read(
      cal(ev('UID:u', 'DTSTART;TZID=Europe/Berlin:20261026T090000', 'DTEND;TZID=Europe/Berlin:20261026T100000', 'RRULE:FREQ=DAILY;UNTIL=20261028T080000Z')),
    );
    expect(busy.map((i) => iso(i.start))).toEqual(['2026-10-26T08:00', '2026-10-27T08:00', '2026-10-28T08:00']);
  });

  it('★ reads a series whose end is written in another zone than its start', async () => {
    const busy = await read(cal(ev('UID:z', 'DTSTART;TZID=Europe/Berlin:20261026T100000', 'DTEND:20261026T100000Z', 'RRULE:FREQ=DAILY;COUNT=2')));
    expect(busy.map((i) => [iso(i.start), iso(i.end)])).toEqual([
      ['2026-10-26T09:00', '2026-10-26T10:00'],
      ['2026-10-27T09:00', '2026-10-27T10:00'],
    ]);
  });

  it('★ reads an extra date (RDATE) on its own clock, and a period with its own end', async () => {
    const busy = await read(
      cal(
        ev(
          'UID:r',
          'DTSTART;TZID=Europe/Berlin:20261026T090000',
          'DTEND;TZID=Europe/Berlin:20261026T100000',
          'RDATE;TZID=America/New_York:20261030T100000',
          'RDATE;VALUE=PERIOD:20261104T120000Z/20261104T150000Z',
        ),
      ),
    );
    expect(busy.map((i) => [iso(i.start), iso(i.end)])).toEqual([
      ['2026-10-26T08:00', '2026-10-26T09:00'],
      ['2026-10-30T14:00', '2026-10-30T15:00'],
      ['2026-11-04T12:00', '2026-11-04T15:00'],
    ]);
  });

  it('★ does not remove an occurrence a removal in another zone only looks like', async () => {
    // 09:00 UTC is 10:00 in Berlin: no occurrence. ical.js alone compares wall clocks and would remove 09:00 Berlin.
    const busy = await read(
      cal(ev('UID:x', 'DTSTART;TZID=Europe/Berlin:20261026T090000', 'DTEND;TZID=Europe/Berlin:20261026T100000', 'RRULE:FREQ=DAILY;COUNT=2', 'EXDATE:20261027T090000Z')),
    );
    expect(busy.map((i) => iso(i.start))).toEqual(['2026-10-26T08:00', '2026-10-27T08:00']);
  });

  it('★ after a "this and future" change, counts the later occurrences at both their old and their new time', async () => {
    const busy = await read(
      cal(
        ev('UID:f', 'DTSTART:20261026T090000Z', 'DTEND:20261026T100000Z', 'RRULE:FREQ=WEEKLY;COUNT=3'),
        ev('UID:f', 'RECURRENCE-ID;RANGE=THISANDFUTURE:20261102T090000Z', 'DTSTART:20261102T150000Z', 'DTEND:20261102T160000Z'),
      ),
      { to: Date.UTC(2026, 10, 10) },
    );
    expect(busy.map((i) => iso(i.start))).toEqual(['2026-10-26T09:00', '2026-11-02T15:00', '2026-11-09T09:00', '2026-11-09T15:00']);
  });

  it('walks an old rule up to the window', async () => {
    // Daily since 2018: a few thousand occurrences before the window starts.
    const busy = await read(cal(ev('UID:old', 'DTSTART:20180101T070000Z', 'DTEND:20180101T073000Z', 'RRULE:FREQ=DAILY')));
    expect(busy).toHaveLength(14);
    expect(iso(busy[0]!.start)).toBe('2026-10-26T07:00');
  });
});

describe('zones the calendar defines itself (Outlook)', () => {
  const WINDOWS_ZONE = [
    'BEGIN:VTIMEZONE',
    'TZID:W. Europe Standard Time',
    'BEGIN:STANDARD',
    'DTSTART:16010101T030000',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'DTSTART:16010101T020000',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
    'END:DAYLIGHT',
    'END:VTIMEZONE',
  ].join('\r\n');

  it('reads a time in a zone only the calendar defines', async () => {
    const busy = await read(cal(WINDOWS_ZONE, ev('UID:o', 'DTSTART;TZID=W. Europe Standard Time:20261028T100000', 'DTEND;TZID=W. Europe Standard Time:20261028T110000')));
    expect(busy.map((i) => iso(i.start))).toEqual(['2026-10-28T09:00']);
  });

  it('★ keeps a calendar’s own zone to that calendar: one tenant cannot redefine a zone for another', async () => {
    const forged = WINDOWS_ZONE.replace('TZID:W. Europe Standard Time', 'TZID:Europe/Paris').replace(/TZOFFSETTO:\+0100/, 'TZOFFSETTO:+0900');
    await read(cal(forged, ev('UID:x', 'DTSTART;TZID=Europe/Paris:20261028T100000', 'DTEND;TZID=Europe/Paris:20261028T110000')));
    // Another calendar naming the real zone still reads it as the real zone.
    const busy = await read(cal(ev('UID:y', 'DTSTART;TZID=Europe/Paris:20261028T100000', 'DTEND;TZID=Europe/Paris:20261028T110000')));
    expect(busy.map((i) => iso(i.start))).toEqual(['2026-10-28T09:00']);
  });
});

describe('what cannot be read', () => {
  it('says so rather than reading nothing', async () => {
    expect(await readIcsBusy('<html>not a calendar</html>', WINDOW)).toMatchObject({ ok: false, error: 'this is not an iCalendar (.ics) file' });
    expect(await readIcsBusy('BEGIN:VCARD\r\nEND:VCARD\r\n', WINDOW)).toMatchObject({ ok: false });
    expect(await readIcsBusy('x'.repeat(5 * 1024 * 1024 + 1), WINDOW)).toMatchObject({ ok: false, error: 'the calendar is larger than 5 MB' });
    // An empty calendar is readable: nothing is busy.
    expect(await readIcsBusy(cal(), WINDOW)).toEqual({ ok: true, intervals: [], events: 0 });
  });
});

describe('★ the budgets', () => {
  it('fails closed on a rule too frequent to walk to the window’s end, rather than reading it as free', async () => {
    const r = await readIcsBusy(cal(ev('UID:m', 'DTSTART:20260101T000000Z', 'DTEND:20260101T000100Z', 'RRULE:FREQ=MINUTELY')), WINDOW);
    expect(r).toEqual({ ok: false, error: 'the calendar has a recurring event too frequent to read' });
  });

  it('★ reads the most events it takes, in a zone it does not define, well within its time', async () => {
    // ical.js looks a zone up in the whole calendar for every date it reads: this took minutes, not milliseconds.
    const many = cal(...Array.from({ length: 20_000 }, (_, i) => ev(`UID:e${i}`, 'DTSTART;TZID=Europe/Berlin:20261028T100000', 'DTEND;TZID=Europe/Berlin:20261028T110000')));
    expect(await readIcsBusy(many, WINDOW)).toEqual({ ok: true, intervals: [{ start: Date.UTC(2026, 9, 28, 9), end: Date.UTC(2026, 9, 28, 10) }], events: 20_000 });
  });

  it('lets other work run while it reads, and gives up after its time budget', async () => {
    const many = cal(...Array.from({ length: 5000 }, (_, i) => ev(`UID:e${i}`, 'DTSTART:20261028T100000Z', 'DTEND:20261028T110000Z')));
    let ran = false;
    setImmediate(() => (ran = true));
    expect(await readIcsBusy(many, WINDOW)).toMatchObject({ ok: true, events: 5000 });
    expect(ran).toBe(true);
    let calls = 0;
    expect(await readIcsBusy(many, { ...WINDOW, now: () => (calls++ === 0 ? 0 : 60_000) })).toEqual({ ok: false, error: 'the calendar is too large to read' });
  });
});

describe('mergeIntervals', () => {
  it('joins overlapping and touching intervals', async () => {
    expect(mergeIntervals([{ start: 5, end: 7 }, { start: 1, end: 3 }, { start: 3, end: 4 }, { start: 6, end: 9 }])).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 9 },
    ]);
  });
});
