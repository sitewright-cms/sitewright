import { describe, it, expect } from 'vitest';
import { readIcsIsolated } from '../src/booking/ics-isolated.js';
import { readIcsBusy } from '../src/booking/ics-read.js';

/**
 * ★ A feed is read in a worker thread, stopped at a deadline: ical.js can loop forever inside ONE call (a rule
 * whose dates never come), which on the server's own thread froze every tenant's requests.
 */

const cal = (...lines: string[]): string =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:x', 'DTSTAMP:20261001T000000Z', ...lines, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
const WINDOW = { from: Date.UTC(2026, 9, 26), to: Date.UTC(2026, 10, 9), timeZone: 'Europe/Berlin' };

describe('reading in a worker', () => {
  it('reads what the reader reads', async () => {
    const text = cal('DTSTART;TZID=Europe/Berlin:20261005T090000', 'DTEND;TZID=Europe/Berlin:20261005T100000', 'RRULE:FREQ=WEEKLY;BYDAY=MO');
    const isolated = await readIcsIsolated(text, WINDOW);
    expect(isolated).toMatchObject({ ok: true, events: 1 });
    expect(isolated).toEqual(await readIcsBusy(text, WINDOW));
  });

  it('says what the reader says of a feed it cannot read', async () => {
    expect(await readIcsIsolated('<html></html>', WINDOW)).toEqual({ ok: false, error: 'this is not an iCalendar (.ics) file' });
  });

  it('★ stops a reading stuck inside ical.js, fails closed, and the server keeps answering meanwhile', async () => {
    // 30 February never comes: ical.js's iterator loops forever looking for it.
    const stuck = cal('DTSTART;TZID=Europe/Berlin:20260101T090000', 'DTEND;TZID=Europe/Berlin:20260101T100000', 'RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30');
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 50);
    const started = Date.now();
    const result = await readIcsIsolated(stuck, WINDOW, { timeoutMs: 1_500, heapMb: 64, concurrent: 2 });
    clearInterval(timer);
    expect(result).toEqual({ ok: false, error: 'the calendar took too long to read' });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(ticks).toBeGreaterThan(10);
  });

  it('runs no more readings at once than allowed; the others wait their turn', async () => {
    const stuck = cal('DTSTART:20260101T090000Z', 'DTEND:20260101T100000Z', 'RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30');
    const limits = { timeoutMs: 600, heapMb: 64, concurrent: 1 };
    const started = Date.now();
    await Promise.all([readIcsIsolated(stuck, WINDOW, limits), readIcsIsolated(stuck, WINDOW, limits)]);
    // One after the other: at least two deadlines.
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_150);
  });
});
