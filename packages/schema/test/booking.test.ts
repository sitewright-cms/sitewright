import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REFUND_UNTIL_MIN,
  refundsInFull,
  BookingBlockSchema,
  BookingConfigSchema,
  BookingIdSchema,
  BookingOfferingSchema,
  BookingResourceSchema,
  ClockTimeSchema,
  HoursRuleSchema,
  LocalDateSchema,
  LocalDateTimeSchema,
  StartClockSchema,
  TimeZoneSchema,
  clockMinutes,
  isLocalDate,
  isTimeZone,
} from '../src/booking.js';

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => expect(schema.safeParse(v).success, JSON.stringify(v)).toBe(true);
const bad = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => expect(schema.safeParse(v).success, JSON.stringify(v)).toBe(false);

describe('booking building blocks', () => {
  it('ids are short, lower-case and URL-safe', () => {
    for (const v of ['anna', 'room-2', 'a', 'x1']) ok(BookingIdSchema, v);
    for (const v of ['', 'Anna', '-a', 'a-', 'a b', 'a_b', 'x'.repeat(49), '__proto__']) bad(BookingIdSchema, v);
  });

  it('clock times: 00:00–23:59, and 24:00 only as an end', () => {
    for (const v of ['00:00', '09:30', '23:59', '24:00']) ok(ClockTimeSchema, v);
    for (const v of ['9:30', '24:01', '25:00', '12:60', '12:5', '']) bad(ClockTimeSchema, v);
    bad(StartClockSchema, '24:00');
    expect([clockMinutes('00:00'), clockMinutes('09:30'), clockMinutes('24:00')]).toEqual([0, 570, 1440]);
  });

  it('dates and date-times are real calendar dates', () => {
    for (const v of ['2026-07-01', '2028-02-29']) ok(LocalDateSchema, v);
    for (const v of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-7-1', '01.07.2026']) bad(LocalDateSchema, v);
    ok(LocalDateTimeSchema, '2026-07-01T09:30');
    for (const v of ['2026-07-01 09:30', '2026-02-30T09:00', '2026-07-01T24:00', '2026-07-01T09:30:00']) bad(LocalDateTimeSchema, v);
  });

  it('time zones are IANA names the runtime knows, stored by their canonical name', () => {
    for (const v of ['Europe/Berlin', 'Africa/Windhoek', 'America/New_York', 'UTC']) ok(TimeZoneSchema, v);
    for (const v of ['', 'Mars/Olympus', 'CEST+2', 'x'.repeat(65), 5]) bad(TimeZoneSchema, v);
    // One zone, one string: casing variants must not each become a cached formatter of their own.
    expect(TimeZoneSchema.parse('europe/berlin')).toBe('Europe/Berlin');
    expect(TimeZoneSchema.parse('EUROPE/BERLIN')).toBe('Europe/Berlin');
  });

  it('the date and zone guards refuse non-strings rather than throwing', () => {
    expect(isLocalDate(['2026-07-01'])).toBe(false);
    expect(isLocalDate(20260701)).toBe(false);
    expect(isTimeZone({ toString: () => 'UTC' })).toBe(false);
  });

  it('opening hours close after they open', () => {
    ok(HoursRuleSchema, { days: ['mon'], from: '09:00', to: '24:00' });
    bad(HoursRuleSchema, { days: ['mon'], from: '17:00', to: '09:00' });
    bad(HoursRuleSchema, { days: ['mon'], from: '09:00', to: '09:00' });
    bad(HoursRuleSchema, { days: [], from: '09:00', to: '17:00' });
    bad(HoursRuleSchema, { days: ['monday'], from: '09:00', to: '17:00' });
  });

  it('blocks: whole dates, one occasion, or weekly hours, each the right way round', () => {
    ok(BookingBlockSchema, { kind: 'dates', from: '2026-12-24', to: '2026-12-26', note: 'Christmas' });
    ok(BookingBlockSchema, { kind: 'dates', from: '2026-12-24', to: '2026-12-24' });
    bad(BookingBlockSchema, { kind: 'dates', from: '2026-12-26', to: '2026-12-24' });
    ok(BookingBlockSchema, { kind: 'once', start: '2026-07-01T14:00', end: '2026-07-01T15:30' });
    bad(BookingBlockSchema, { kind: 'once', start: '2026-07-01T15:30', end: '2026-07-01T14:00' });
    ok(BookingBlockSchema, { kind: 'weekly', days: ['mon', 'fri'], from: '12:00', to: '13:00' });
    bad(BookingBlockSchema, { kind: 'monthly', days: ['mon'], from: '12:00', to: '13:00' });
  });
});

describe('resources and offerings', () => {
  it('a resource gets a capacity of one and no hours by default', () => {
    const r = BookingResourceSchema.parse({ id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin' });
    expect(r).toMatchObject({ capacity: 1, hours: [], blocks: [] });
    bad(BookingResourceSchema, { id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin', capacity: 0 });
    bad(BookingResourceSchema, { id: 'anna', name: ' ', timeZone: 'Europe/Berlin' });
  });

  it('each mode carries what it needs, with sensible defaults', () => {
    const d = BookingOfferingSchema.parse({ id: 'c', name: 'Consultation', mode: 'duration', durationMin: 45, resourceIds: ['anna'] });
    expect(d).toMatchObject({ confirmation: 'instant', minNoticeMin: 0, maxAdvanceDays: 90, maxQuantity: 1, bufferBeforeMin: 0, bufferAfterMin: 0, chooseResource: false });
    const days = BookingOfferingSchema.parse({ id: 's', name: 'Stay', mode: 'days', resourceIds: ['flat'] });
    expect(days).toMatchObject({ unit: 'night', minUnits: 1, maxUnits: 30, checkIn: '15:00', checkOut: '11:00' });
    const range = BookingOfferingSchema.parse({ id: 'r', name: 'Room', mode: 'range', minMin: 60, maxMin: 240, resourceIds: ['room'] });
    expect(range).toMatchObject({ stepMin: 30 });
    ok(BookingOfferingSchema, { id: 't', name: 'Tour', mode: 'slots', resourceIds: ['g'], slots: [{ days: ['sat'], at: '10:00', durationMin: 90, capacity: 12 }] });
  });

  it('★ refuses unknown keys, so a typo is an error rather than a setting that silently does nothing', () => {
    bad(BookingOfferingSchema, { id: 'c', name: 'C', mode: 'duration', durationMin: 60, maxQuantiy: 3, resourceIds: ['anna'] });
    bad(BookingResourceSchema, { id: 'anna', name: 'Anna', timeZone: 'UTC', colour: 'red' });
    bad(BookingBlockSchema, { kind: 'dates', from: '2026-12-24', to: '2026-12-26', reason: 'x' });
    bad(BookingConfigSchema, { resources: [], offerings: [], extra: true });
  });

  it('a night stay checks out no later than the next guest checks in', () => {
    ok(BookingOfferingSchema, { id: 's', name: 'S', mode: 'days', checkIn: '15:00', checkOut: '11:00', resourceIds: ['flat'] });
    ok(BookingOfferingSchema, { id: 's', name: 'S', mode: 'days', checkIn: '12:00', checkOut: '12:00', resourceIds: ['flat'] });
    bad(BookingOfferingSchema, { id: 's', name: 'S', mode: 'days', checkIn: '11:00', checkOut: '15:00', resourceIds: ['flat'] });
    // Whole days do not use the two times.
    ok(BookingOfferingSchema, { id: 'b', name: 'B', mode: 'days', unit: 'day', checkIn: '11:00', checkOut: '15:00', resourceIds: ['bikes'] });
  });

  it('two slots cannot start at the same time on the same day', () => {
    const slot = (days: string[], at: string) => ({ days, at, durationMin: 60 });
    bad(BookingOfferingSchema, { id: 't', name: 'T', mode: 'slots', resourceIds: ['g'], slots: [slot(['sat'], '10:00'), slot(['sat', 'sun'], '10:00')] });
    ok(BookingOfferingSchema, { id: 't', name: 'T', mode: 'slots', resourceIds: ['g'], slots: [slot(['sat'], '10:00'), slot(['sun'], '10:00')] });
  });

  it('weekly blocks are capped harder than one-off ones', () => {
    const weekly = (n: number) => Array.from({ length: n }, () => ({ kind: 'weekly', days: ['mon'], from: '12:00', to: '13:00' }));
    ok(BookingResourceSchema, { id: 'anna', name: 'Anna', timeZone: 'UTC', blocks: weekly(28) });
    bad(BookingResourceSchema, { id: 'anna', name: 'Anna', timeZone: 'UTC', blocks: weekly(29) });
  });

  it('refuses an offering that cannot work', () => {
    bad(BookingOfferingSchema, { id: 'c', name: 'C', mode: 'duration', durationMin: 2, resourceIds: ['anna'] });
    bad(BookingOfferingSchema, { id: 'c', name: 'C', mode: 'duration', durationMin: 60, resourceIds: [] });
    bad(BookingOfferingSchema, { id: 'r', name: 'R', mode: 'range', minMin: 120, maxMin: 60, resourceIds: ['room'] });
    // A range grid divides the day, so it is the same every day and runs on through midnight.
    bad(BookingOfferingSchema, { id: 'r', name: 'R', mode: 'range', minMin: 70, maxMin: 140, stepMin: 70, resourceIds: ['room'] });
    ok(BookingOfferingSchema, { id: 'r', name: 'R', mode: 'range', minMin: 90, maxMin: 180, stepMin: 90, resourceIds: ['room'] });
    bad(BookingOfferingSchema, { id: 's', name: 'S', mode: 'days', minUnits: 5, maxUnits: 2, resourceIds: ['flat'] });
    bad(BookingOfferingSchema, { id: 't', name: 'T', mode: 'slots', slots: [], resourceIds: ['g'] });
    bad(BookingOfferingSchema, { id: 't', name: 'T', mode: 'slots', slots: [{ days: ['sat'], at: '24:00', durationMin: 60 }], resourceIds: ['g'] });
    bad(BookingOfferingSchema, { id: 'x', name: 'X', mode: 'forever', resourceIds: ['g'] });
    bad(BookingOfferingSchema, { id: 'c', name: 'C', mode: 'duration', durationMin: 60, maxAdvanceDays: 731, resourceIds: ['anna'] });
    bad(BookingOfferingSchema, { id: 'c', name: 'C', mode: 'duration', durationMin: 60, confirmation: 'maybe', resourceIds: ['anna'] });
  });
});

describe('the whole configuration', () => {
  const anna = { id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin' };
  const consult = { id: 'consult', name: 'Consultation', mode: 'duration', durationMin: 60, resourceIds: ['anna'] };

  it('is valid when every offering names resources that exist', () => {
    expect(BookingConfigSchema.parse({ resources: [anna], offerings: [consult] }).offerings).toHaveLength(1);
    expect(BookingConfigSchema.parse({})).toEqual({ resources: [], offerings: [], pow: false, captcha: false });
  });

  it('takes the business’s address and a resource’s calendar address, and nothing that could leave a header', () => {
    ok(BookingConfigSchema, { resources: [{ ...anna, email: 'anna@studio.example' }], offerings: [consult], notifyEmail: 'hello@studio.example' });
    bad(BookingConfigSchema, { notifyEmail: 'not an address' });
    bad(BookingConfigSchema, { notifyEmail: 'hello@studio.example\r\nBcc: x@evil.example' });
    bad(BookingConfigSchema, { resources: [{ ...anna, email: 'anna@studio.example\nBcc: x@evil.example' }] });
    // The reference is added as a fragment, so the status page's path has none of its own.
    ok(BookingConfigSchema, { statusPath: '/my-booking/' });
    bad(BookingConfigSchema, { statusPath: '/my-booking/#top' });
  });

  it('refuses duplicate ids and offerings pointing at missing resources, naming the field', () => {
    const dup = BookingConfigSchema.safeParse({ resources: [anna, anna], offerings: [] });
    expect(dup.success).toBe(false);
    expect(dup.error?.issues[0]?.path).toEqual(['resources', 1, 'id']);
    const missing = BookingConfigSchema.safeParse({ resources: [anna], offerings: [{ ...consult, resourceIds: ['anna', 'ben'] }] });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]?.path).toEqual(['offerings', 0, 'resourceIds', 1]);
    bad(BookingConfigSchema, { resources: [anna], offerings: [consult, consult] });
    // One offering, one clock: its resources share a time zone.
    const ny = { id: 'ben', name: 'Ben', timeZone: 'America/New_York' };
    const mixed = BookingConfigSchema.safeParse({ resources: [anna, ny], offerings: [{ ...consult, resourceIds: ['anna', 'ben'] }] });
    expect(mixed.success).toBe(false);
    expect(mixed.error?.issues[0]?.path).toEqual(['offerings', 0, 'resourceIds']);
  });
});

describe('a customer’s refund when cancelling a paid booking', () => {
  const H = 3_600_000;
  it('is in full until the offering’s deadline before the start, and nothing after; a day unless set', () => {
    const start = Date.UTC(2026, 10, 2, 9);
    expect(refundsInFull({}, start, start - 24 * H)).toBe(true);
    expect(refundsInFull({}, start, start - 24 * H + 1)).toBe(false);
    expect(refundsInFull({ refundUntilMin: 60 }, start, start - H)).toBe(true);
    expect(refundsInFull({ refundUntilMin: 60 }, start, start - H + 1)).toBe(false);
    // Zero: refunded right up to the start.
    expect(refundsInFull({ refundUntilMin: 0 }, start, start)).toBe(true);
    // An offering no longer in the set-up keeps the default.
    expect(refundsInFull(undefined, start, start - 25 * H)).toBe(true);
    expect(DEFAULT_REFUND_UNTIL_MIN).toBe(1440);
  });
});
