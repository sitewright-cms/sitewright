import { describe, it, expect } from 'vitest';
import { addDays, compareYmd, datesBetween, exactInstant, formatYmd, localDateOf, offsetAt, parseYmd, weekdayIndex, zonedParts, zonedToInstant } from '../src/booking/zoned.js';

/**
 * Wall-clock ↔ instant. Every expectation is a literal UTC instant, worked out from the zone's published
 * rules, never from the code under test.
 */

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 16) + 'Z';
const at = (date: string, clock: string, tz: string): string => {
  const [h, m] = clock.split(':').map(Number);
  return iso(zonedToInstant(parseYmd(date), h! * 60 + m!, tz));
};

describe('zonedToInstant', () => {
  it('an ordinary time, summer and winter', () => {
    expect(at('2026-07-01', '09:00', 'Europe/Berlin')).toBe('2026-07-01T07:00Z');
    expect(at('2026-01-15', '09:00', 'Europe/Berlin')).toBe('2026-01-15T08:00Z');
    expect(at('2026-07-01', '09:00', 'Asia/Kolkata')).toBe('2026-07-01T03:30Z');
    expect(at('2026-07-01', '09:00', 'Africa/Windhoek')).toBe('2026-07-01T07:00Z');
    expect(at('2026-07-01', '09:00', 'UTC')).toBe('2026-07-01T09:00Z');
  });

  it('★ a time in a spring-forward GAP moves forward past it', () => {
    // Berlin, 29 March 2026: 02:00 CET jumps to 03:00 CEST at 01:00Z. 02:30 does not exist; 03:30 CEST does.
    expect(at('2026-03-29', '02:30', 'Europe/Berlin')).toBe('2026-03-29T01:30Z');
    // New York, 8 March 2026: 02:00 EST jumps to 03:00 EDT at 07:00Z.
    expect(at('2026-03-08', '02:30', 'America/New_York')).toBe('2026-03-08T07:30Z');
    // Lord Howe moves by only 30 minutes (+10:30 → +11:00 at 02:00 local on 4 October 2026): 02:15 → 02:45.
    expect(at('2026-10-04', '02:15', 'Australia/Lord_Howe')).toBe('2026-10-03T15:45Z');
  });

  it('★ a time in a fall-back OVERLAP is the earlier of its two instants', () => {
    // Berlin, 25 October 2026: 03:00 CEST falls back to 02:00 CET at 01:00Z, so 02:30 happens at 00:30Z and 01:30Z.
    expect(at('2026-10-25', '02:30', 'Europe/Berlin')).toBe('2026-10-25T00:30Z');
    // New York, 1 November 2026: 01:30 happens at 05:30Z (EDT) and 06:30Z (EST).
    expect(at('2026-11-01', '01:30', 'America/New_York')).toBe('2026-11-01T05:30Z');
  });

  it('the hours either side of a transition are exact', () => {
    expect(at('2026-03-29', '01:59', 'Europe/Berlin')).toBe('2026-03-29T00:59Z');
    expect(at('2026-03-29', '03:00', 'Europe/Berlin')).toBe('2026-03-29T01:00Z');
    expect(at('2026-10-25', '03:00', 'Europe/Berlin')).toBe('2026-10-25T02:00Z');
  });

  it('24:00 is the next midnight', () => {
    expect(at('2026-07-01', '24:00', 'Europe/Berlin')).toBe('2026-07-01T22:00Z');
    expect(at('2026-12-31', '24:00', 'UTC')).toBe('2027-01-01T00:00Z');
  });

  it('round-trips every quarter hour of both transition days, except the skipped hour', () => {
    for (const date of ['2026-03-29', '2026-10-25']) {
      for (let minute = 0; minute < 1440; minute += 15) {
        const t = zonedToInstant(parseYmd(date), minute, 'Europe/Berlin');
        const p = zonedParts(t, 'Europe/Berlin');
        const skipped = date === '2026-03-29' && minute >= 120 && minute < 180;
        if (skipped) expect(p.hour * 60 + p.minute).toBe(minute + 60);
        else expect([formatYmd(p), p.hour * 60 + p.minute]).toEqual([date, minute]);
      }
    }
  });
});

describe('★ the per-day cache agrees with the exact computation', () => {
  it('on every day of 2026, in zones that change at midnight, by 30 or 45 minutes, or not at all', () => {
    const zones = ['Europe/Berlin', 'America/New_York', 'America/Santiago', 'America/Havana', 'Australia/Lord_Howe', 'Pacific/Chatham', 'Asia/Kathmandu', 'Africa/Windhoek'];
    const minutes = [0, 30, 90, 150, 720, 1439, 1440, 1500];
    let mismatches = 0;
    for (const tz of zones) {
      for (const date of datesBetween(parseYmd('2026-01-01'), parseYmd('2026-12-31'))) {
        for (const minute of minutes) if (zonedToInstant(date, minute, tz) !== exactInstant(date, minute, tz)) mismatches += 1;
      }
    }
    expect(mismatches).toBe(0);
  });
});

describe('zoned helpers', () => {
  it('offsetAt reads the zone at an instant', () => {
    expect(offsetAt(Date.UTC(2026, 6, 1, 12), 'Europe/Berlin')).toBe(2 * 3_600_000);
    expect(offsetAt(Date.UTC(2026, 0, 1, 12), 'Europe/Berlin')).toBe(3_600_000);
    expect(offsetAt(Date.UTC(2026, 6, 1, 12), 'Asia/Kolkata')).toBe(5.5 * 3_600_000);
  });

  it('localDateOf is the date on the local calendar, not in UTC', () => {
    expect(formatYmd(localDateOf(Date.UTC(2026, 6, 1, 23, 30), 'Europe/Berlin'))).toBe('2026-07-02');
    expect(formatYmd(localDateOf(Date.UTC(2026, 6, 1, 3), 'America/New_York'))).toBe('2026-06-30');
  });

  it('dates: weekdays (Monday = 0), arithmetic across months and years, ranges', () => {
    expect(weekdayIndex(parseYmd('2026-07-01'))).toBe(2); // a Wednesday
    expect(weekdayIndex(parseYmd('2026-07-05'))).toBe(6); // a Sunday
    expect(formatYmd(addDays(parseYmd('2026-12-31'), 1))).toBe('2027-01-01');
    expect(formatYmd(addDays(parseYmd('2028-03-01'), -1))).toBe('2028-02-29');
    expect([...datesBetween(parseYmd('2026-02-27'), parseYmd('2026-03-02'))].map(formatYmd)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
    expect(compareYmd(parseYmd('2026-01-01'), parseYmd('2025-12-31'))).toBeGreaterThan(0);
  });
});
