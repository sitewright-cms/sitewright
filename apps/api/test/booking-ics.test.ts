import { describe, it, expect } from 'vitest';
import { buildIcs, icsFold, icsText, icsUtc, ICS_PRODID } from '../src/booking/ics.js';

/** The calendar object one booking becomes: what calendar clients actually parse. */

const BASE = {
  method: 'REQUEST' as const,
  uid: 'claim-1@studio.example',
  sequence: 0,
  start: Date.UTC(2026, 9, 28, 9, 0),
  end: Date.UTC(2026, 9, 28, 10, 0),
  summary: 'Massage – Ada',
  now: Date.UTC(2026, 9, 27, 18, 30, 5),
};
const lines = (ics: string) => ics.replace(/\r\n /g, '').split('\r\n');

describe('buildIcs', () => {
  it('writes one event with CRLF line endings, in UTC, under a neutral product name', () => {
    const ics = buildIcs({ ...BASE, organizer: { email: 'hello@studio.example', name: 'Studio Nord' }, attendees: [{ email: 'anna@studio.example', name: 'Anna' }] });
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(lines(ics)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:${ICS_PRODID}`,
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:claim-1@studio.example',
      'DTSTAMP:20261027T183005Z',
      'DTSTART:20261028T090000Z',
      'DTEND:20261028T100000Z',
      'SEQUENCE:0',
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'SUMMARY:Massage – Ada',
      'ORGANIZER;CN="Studio Nord":mailto:hello@studio.example',
      'ATTENDEE;CN="Anna";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:anna@studio.example',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ]);
    // ★ White-label: nothing names the platform.
    expect(ics.toLowerCase()).not.toContain('sitewright');
  });

  it('takes a booking back out with CANCEL, a higher sequence and a cancelled status', () => {
    const ics = buildIcs({ ...BASE, method: 'CANCEL', sequence: 1 });
    expect(lines(ics)).toEqual(expect.arrayContaining(['METHOD:CANCEL', 'SEQUENCE:1', 'STATUS:CANCELLED']));
  });

  it('withdraws a published copy by publishing it again, cancelled', () => {
    const ics = buildIcs({ ...BASE, method: 'PUBLISH', sequence: 1, cancelled: true });
    expect(lines(ics)).toEqual(expect.arrayContaining(['METHOD:PUBLISH', 'SEQUENCE:1', 'STATUS:CANCELLED']));
  });

  it('writes whole days as dates, the end date exclusive', () => {
    const ics = buildIcs({ ...BASE, method: 'PUBLISH', allDay: { startDate: '2026-10-28', endDate: '2026-10-31' } });
    expect(lines(ics)).toEqual(expect.arrayContaining(['DTSTART;VALUE=DATE:20261028', 'DTEND;VALUE=DATE:20261031']));
    expect(ics).not.toContain('DTSTART:');
  });

  it('★ keeps every value inside its own line: no field or header can be smuggled in', () => {
    const ics = buildIcs({
      ...BASE,
      summary: 'Massage\r\nATTENDEE:mailto:evil@example.com',
      description: 'Line one\nLine two; with, punctuation \\ and a backslash',
      organizer: { email: 'hello@studio.example', name: 'Studio "Nord"\r\nX-EVIL:1' },
      attendees: [{ email: 'evil@example.com\r\nX-EVIL:1' }, { email: 'not an address' }],
    });
    const all = lines(ics);
    expect(all.filter((l) => l.startsWith('ATTENDEE'))).toEqual([]);
    expect(all.some((l) => l.startsWith('X-EVIL'))).toBe(false);
    expect(all).toContain('SUMMARY:Massage\\nATTENDEE:mailto:evil@example.com');
    expect(all).toContain('DESCRIPTION:Line one\\nLine two\\; with\\, punctuation \\\\ and a backslash');
    expect(all).toContain('ORGANIZER;CN="Studio NordX-EVIL:1":mailto:hello@studio.example');
  });
});

describe('the pieces', () => {
  it('formats instants as UTC basic time', () => {
    expect(icsUtc(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe('20260102T030405Z');
  });

  it('escapes TEXT values', () => {
    expect(icsText('a;b,c\\d\ne\r\nf')).toBe('a\\;b\\,c\\\\d\\ne\\nf');
    // Unicode's own line and paragraph separators, which a lenient parser breaks lines on.
    expect(icsText('a\u2028ATTENDEE:x\u2029b\u0085c')).toBe('a\\nATTENDEE:x\\nb\\nc');
  });

  it('folds at 75 octets and never inside a character', () => {
    const long = `SUMMARY:${'ä'.repeat(60)}`;
    const folded = icsFold(long);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const [i, p] of parts.entries()) {
      expect(Buffer.byteLength(p, 'utf8'), `line ${i}`).toBeLessThanOrEqual(75);
      if (i > 0) expect(p.startsWith(' ')).toBe(true);
    }
    // Unfolding gives back exactly the line, every character whole.
    expect(folded.replace(/\r\n /g, '')).toBe(long);
    expect(icsFold('SHORT:line')).toBe('SHORT:line');
  });
});
