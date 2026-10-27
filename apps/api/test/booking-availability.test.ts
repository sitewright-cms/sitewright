import { describe, it, expect } from 'vitest';
import { BookingOfferingSchema, BookingResourceSchema, type BookingOffering, type BookingResource } from '@sitewright/schema';
import { checkRequest, listAvailability, type Availability, type ListQuery } from '../src/booking/availability.js';
import type { Busy } from '../src/booking/occupancy.js';

/**
 * The availability engine. Results are read back as LOCAL wall-clock strings through Intl directly, so an
 * expectation says what a person at the resource would see ("09:00"), independent of the code under test.
 */

const BERLIN = 'Europe/Berlin';
const WINDHOEK = 'Africa/Windhoek'; // UTC+2, no daylight saving
const H = 3_600_000;
const M = 60_000;

const fmt = new Map<string, Intl.DateTimeFormat>();
function local(ms: number, tz = BERLIN): string {
  let f = fmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    fmt.set(tz, f);
  }
  return f.format(ms);
}
/** Berlin summer time (+2) or Windhoek (+2): local `YYYY-MM-DD HH:MM` → instant. */
const plus2 = (s: string): number => Date.parse(`${s.replace(' ', 'T')}:00+02:00`);

const resource = (r: Partial<BookingResource> & { id: string }): BookingResource =>
  BookingResourceSchema.parse({ name: r.id, timeZone: BERLIN, ...r });
const offering = (o: Record<string, unknown>): BookingOffering => BookingOfferingSchema.parse({ name: 'x', ...o });

const OFFICE = [
  { days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '09:00', to: '12:00' },
  { days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '13:00', to: '17:00' },
];
const anna = resource({ id: 'anna', hours: OFFICE as BookingResource['hours'] });
const ben = resource({ id: 'ben', hours: OFFICE as BookingResource['hours'] });

/** 1 July 2026 is a Wednesday. "Now" is the start of 30 June, so notice and horizon rarely matter. */
const NOW = plus2('2026-06-30 00:00');

function query(o: BookingOffering, extra: Partial<ListQuery> = {}): ListQuery {
  return { offering: o, resources: [anna, ben], busy: new Map(), now: NOW, from: plus2('2026-07-01 00:00'), to: plus2('2026-07-02 00:00'), ...extra };
}
const starts = (a: Availability, tz = BERLIN): string[] => (a.kind === 'times' ? a.times.map((t) => local(t.start, tz).slice(11)) : []);
const busyMap = (entries: Record<string, Busy[]>): Map<string, Busy[]> => new Map(Object.entries(entries));
const span = (from: string, to: string, extra: Partial<Busy> = {}): Busy => ({ start: plus2(from), end: plus2(to), ...extra });

describe('duration: fixed-length appointments', () => {
  const hour = offering({ id: 'consult', mode: 'duration', durationMin: 60, resourceIds: ['anna'] });

  it('one start per length inside the opening hours, none over lunch', () => {
    expect(starts(listAvailability(query(hour)))).toEqual(['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00']);
  });

  it('a finer step offers more starts, never one that would run past closing', () => {
    const o = offering({ id: 'c', mode: 'duration', durationMin: 60, stepMin: 30, resourceIds: ['anna'] });
    expect(starts(listAvailability(query(o)))).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00']);
  });

  it('a busy event removes every start that would overlap it', () => {
    const o = offering({ id: 'c', mode: 'duration', durationMin: 60, stepMin: 30, resourceIds: ['anna'] });
    const busy = busyMap({ anna: [span('2026-07-01 10:15', '2026-07-01 10:45')] });
    expect(starts(listAvailability(query(o, { busy })))).toEqual(['09:00', '11:00', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00']);
  });

  it('buffers keep room before and after, without shortening the appointment', () => {
    const o = offering({ id: 'c', mode: 'duration', durationMin: 60, bufferAfterMin: 15, resourceIds: ['anna'] });
    const busy = busyMap({ anna: [span('2026-07-01 11:00', '2026-07-01 11:30')] });
    // 10:00–11:00 needs 11:00–11:15 free as well.
    expect(starts(listAvailability(query(o, { busy })))).toEqual(['09:00', '13:00', '14:00', '15:00', '16:00']);
  });

  it('closed days offer nothing; a holiday block closes a whole date', () => {
    const weekend = { from: plus2('2026-07-04 00:00'), to: plus2('2026-07-06 00:00') };
    expect(starts(listAvailability(query(hour, weekend)))).toEqual([]);
    const off = resource({ id: 'anna', hours: OFFICE as BookingResource['hours'], blocks: [{ kind: 'dates', from: '2026-07-01', to: '2026-07-01' }] });
    expect(starts(listAvailability(query(hour, { resources: [off] })))).toEqual([]);
  });

  it('one-off and weekly blocks take their hours out', () => {
    const r = resource({
      id: 'anna',
      hours: OFFICE as BookingResource['hours'],
      blocks: [
        { kind: 'once', start: '2026-07-01T14:00', end: '2026-07-01T15:30' },
        { kind: 'weekly', days: ['wed'], from: '09:00', to: '10:00' },
      ],
    });
    expect(starts(listAvailability(query(hour, { resources: [r] })))).toEqual(['10:00', '11:00', '13:00', '16:00']);
  });

  it('notice and horizon: too soon and too far ahead are not offered', () => {
    const soon = offering({ id: 'c', mode: 'duration', durationMin: 60, minNoticeMin: 120, resourceIds: ['anna'] });
    expect(starts(listAvailability(query(soon, { now: plus2('2026-07-01 08:30') })))).toEqual(['11:00', '13:00', '14:00', '15:00', '16:00']);
    const near = offering({ id: 'c', mode: 'duration', durationMin: 60, maxAdvanceDays: 1, resourceIds: ['anna'] });
    expect(starts(listAvailability(query(near, { now: plus2('2026-06-30 12:00') })))).toEqual(['09:00', '10:00', '11:00']);
  });

  it('with several resources, a time is offered while any of them is free, and says which', () => {
    const o = offering({ id: 'c', mode: 'duration', durationMin: 60, resourceIds: ['anna', 'ben'] });
    const busy = busyMap({ anna: [span('2026-07-01 09:00', '2026-07-01 10:00')] });
    const a = listAvailability(query(o, { busy }));
    expect(a.kind === 'times' && a.times[0]).toMatchObject({ resourceIds: ['ben'], seatsLeft: 1 });
    expect(a.kind === 'times' && a.times[1]).toMatchObject({ resourceIds: ['anna', 'ben'], seatsLeft: 2 });
    // The visitor picked Anna: only her times.
    expect(starts(listAvailability(query(o, { busy, resourceId: 'anna' })))[0]).toBe('10:00');
  });

  it('capacity: bookings count their units; a calendar event takes the whole resource', () => {
    const room = resource({ id: 'room', capacity: 2, hours: OFFICE as BookingResource['hours'] });
    const o = offering({ id: 'c', mode: 'duration', durationMin: 60, resourceIds: ['room'] });
    const q = (busy: Busy[]) => listAvailability(query(o, { resources: [room], busy: busyMap({ room: busy }) }));
    const one = q([span('2026-07-01 09:00', '2026-07-01 10:00', { units: 1 })]);
    expect(one.kind === 'times' && one.times[0]).toMatchObject({ seatsLeft: 1 });
    expect(starts(q([span('2026-07-01 09:00', '2026-07-01 10:00', { units: 2 })]))[0]).toBe('10:00');
    expect(starts(q([span('2026-07-01 09:00', '2026-07-01 10:00')]))[0]).toBe('10:00');
  });

  it('★ a booking may run on past midnight when the next day\'s opening continues it', () => {
    const late = resource({ id: 'late', hours: [{ days: ['mon'], from: '20:00', to: '24:00' }, { days: ['tue'], from: '00:00', to: '02:00' }] as BookingResource['hours'] });
    const o = offering({ id: 'l', mode: 'duration', durationMin: 120, stepMin: 60, resourceIds: ['late'] });
    const a = listAvailability({ ...query(o), resources: [late], from: plus2('2026-07-06 00:00'), to: plus2('2026-07-08 00:00') });
    expect(a.kind === 'times' && a.times.map((t) => local(t.start).slice(5))).toEqual(['07-06 20:00', '07-06 21:00', '07-06 22:00', '07-06 23:00', '07-07 00:00']);
    const room = resource({ id: 'room', hours: [{ days: EVERY_DAY, from: '00:00', to: '24:00' }] as BookingResource['hours'] });
    const r = offering({ id: 'r', mode: 'range', minMin: 60, maxMin: 240, resourceIds: ['room'] });
    expect(checkRequest({ ...query(r), resources: [room] }, { start: plus2('2026-07-01 23:00'), end: plus2('2026-07-02 01:00') })).toMatchObject({ ok: true });
  });

  it('★ a running slot takes its resource for other offerings, whatever its seats', () => {
    const guide = resource({ id: 'guide', capacity: 3, hours: OFFICE as BookingResource['hours'] });
    const o = offering({ id: 'walk', mode: 'duration', durationMin: 60, resourceIds: ['guide'] });
    const tourBooking: Busy = { ...span('2026-07-01 10:00', '2026-07-01 11:30'), units: 2, exclusive: true, offeringId: 'tour' };
    const a = listAvailability({ ...query(o), resources: [guide], busy: busyMap({ guide: [tourBooking] }) });
    expect(starts(a)).toEqual(['09:00', '13:00', '14:00', '15:00', '16:00']);
  });

  it('★ daylight saving: starts follow REAL time, and no start lands in the hour that does not exist', () => {
    const night = resource({ id: 'night', hours: [{ days: ['sun'], from: '01:00', to: '04:00' }] });
    const o = offering({ id: 'n', mode: 'duration', durationMin: 30, resourceIds: ['night'] });
    const day = (date: string) =>
      listAvailability({ offering: o, resources: [night], busy: new Map(), now: Date.parse(`${date}T00:00Z`) - 7 * 24 * H, from: Date.parse(`${date}T00:00Z`) - 3 * H, to: Date.parse(`${date}T00:00Z`) + 21 * H });
    // Spring forward (29 March): 01:00–04:00 is only two real hours.
    expect(starts(day('2026-03-29'))).toEqual(['01:00', '01:30', '03:00', '03:30']);
    // Fall back (25 October): four real hours, and 02:00–03:00 happens twice.
    expect(starts(day('2026-10-25'))).toEqual(['01:00', '01:30', '02:00', '02:30', '02:00', '02:30', '03:00', '03:30']);
  });
});

describe('slots: set times with seats', () => {
  const guide = resource({ id: 'guide', capacity: 12, timeZone: WINDHOEK });
  const tour = offering({ id: 'tour', mode: 'slots', maxQuantity: 6, resourceIds: ['guide'], slots: [{ days: ['sat'], at: '10:00', durationMin: 90 }, { days: ['sat', 'sun'], at: '15:00', durationMin: 90, capacity: 4 }] });
  const weekend = { from: plus2('2026-07-04 00:00'), to: plus2('2026-07-06 00:00') };
  const q = (busy: Busy[] = []) => ({ ...query(tour, weekend), resources: [guide], busy: busyMap({ guide: busy }) });

  it('offers each set time on its days, with its own seats', () => {
    const a = listAvailability(q());
    expect(a.kind === 'times' && a.times.map((t) => `${local(t.start, WINDHOEK)} ${t.seatsLeft}`)).toEqual(['2026-07-04 10:00 12', '2026-07-04 15:00 4', '2026-07-05 15:00 4']);
  });

  it('★ bookings on the same slot share its seats; anything else there takes the whole resource', () => {
    const slotStart = plus2('2026-07-04 10:00');
    const same = (units: number): Busy => ({ start: slotStart, end: slotStart + 90 * M, units, offeringId: 'tour' });
    const a = listAvailability(q([same(5), same(6)]));
    expect(a.kind === 'times' && a.times[0]).toMatchObject({ seatsLeft: 1 });
    // A private booking of another offering at 10:30 occupies the guide.
    const other = listAvailability(q([{ start: plus2('2026-07-04 10:30'), end: plus2('2026-07-04 11:30'), units: 1, offeringId: 'private' }]));
    expect(other.kind === 'times' && other.times.map((t) => local(t.start, WINDHOEK))).toEqual(['2026-07-04 15:00', '2026-07-05 15:00']);
  });

  it('a request for more seats than are left is refused; one that fits is placed', () => {
    const slotStart = plus2('2026-07-04 10:00');
    const busy = [{ start: slotStart, end: slotStart + 90 * M, units: 10, offeringId: 'tour' }];
    expect(checkRequest(q(busy), { start: slotStart, quantity: 3 })).toMatchObject({ ok: false, reason: 'taken' });
    expect(checkRequest(q(busy), { start: slotStart, quantity: 2 })).toMatchObject({ ok: true, resourceId: 'guide' });
    expect(checkRequest(q(), { start: slotStart, quantity: 7 })).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('range: the visitor picks start and end', () => {
  const room = resource({ id: 'room', hours: [{ days: ['wed'], from: '08:00', to: '20:00' }] });
  const hire = offering({ id: 'hire', mode: 'range', minMin: 60, maxMin: 240, stepMin: 30, resourceIds: ['room'] });
  const busy = busyMap({ room: [span('2026-07-01 12:00', '2026-07-01 13:00', { units: 1 })] });
  const q = { ...query(hire), resources: [room], busy };

  it('lists the free stretches inside the opening hours', () => {
    const a = listAvailability(q);
    expect(a.kind === 'windows' && a.windows.map((w) => `${local(w.start).slice(11)}–${local(w.end).slice(11)}`)).toEqual(['08:00–12:00', '13:00–20:00']);
  });

  it('checks the length, the clock grid, the opening hours and what is free', () => {
    expect(checkRequest(q, { start: plus2('2026-07-01 10:00'), end: plus2('2026-07-01 12:00') })).toMatchObject({ ok: true, resourceId: 'room' });
    expect(checkRequest(q, { start: plus2('2026-07-01 11:30'), end: plus2('2026-07-01 12:30') })).toMatchObject({ ok: false, reason: 'taken' });
    expect(checkRequest(q, { start: plus2('2026-07-01 10:15'), end: plus2('2026-07-01 11:15') })).toMatchObject({ ok: false, reason: 'not-offered' });
    expect(checkRequest(q, { start: plus2('2026-07-01 07:30'), end: plus2('2026-07-01 09:00') })).toMatchObject({ ok: false, reason: 'not-offered' });
    expect(checkRequest(q, { start: plus2('2026-07-01 10:00'), end: plus2('2026-07-01 10:30') })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkRequest(q, { start: plus2('2026-07-01 08:00'), end: plus2('2026-07-01 13:00') })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkRequest(q, { start: plus2('2026-07-01 10:00') })).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('★ windows are cut to the time grid, and one with no whole booking left in it is not shown', () => {
    const o = offering({ id: 'h', mode: 'range', minMin: 60, maxMin: 60, stepMin: 60, resourceIds: ['room'] });
    const b = busyMap({ room: [span('2026-07-01 09:15', '2026-07-01 10:15'), span('2026-07-01 11:30', '2026-07-01 20:00')] });
    const a = listAvailability({ ...q, offering: o, busy: b });
    expect(a.kind === 'windows' && a.windows.map((w) => `${local(w.start).slice(11)}–${local(w.end).slice(11)}`)).toEqual(['08:00–09:00']);
  });

  it('a window starting before the end of the question is shown whole', () => {
    const o = offering({ id: 'h', mode: 'range', minMin: 120, maxMin: 240, stepMin: 30, resourceIds: ['room'] });
    const b = busyMap({ room: [span('2026-07-01 08:00', '2026-07-01 11:00')] });
    const a = listAvailability({ ...q, offering: o, busy: b, to: plus2('2026-07-01 12:00') });
    expect(a.kind === 'windows' && a.windows.map((w) => `${local(w.start).slice(11)}–${local(w.end).slice(11)}`)).toEqual(['11:00–20:00']);
  });

  it('★ times are whole minutes: a start or end with seconds is refused', () => {
    expect(checkRequest(q, { start: plus2('2026-07-01 10:00') + 30_000, end: plus2('2026-07-01 11:00') + 30_000 })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkRequest(q, { start: plus2('2026-07-01 10:00'), end: plus2('2026-07-01 11:00') + 1 })).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('★ back-to-back bookings never add up: two units are not in use at once', () => {
    const big = resource({ id: 'room', capacity: 2, hours: [{ days: ['wed'], from: '08:00', to: '20:00' }] });
    const two = busyMap({ room: [span('2026-07-01 09:00', '2026-07-01 10:00', { units: 1 }), span('2026-07-01 10:00', '2026-07-01 11:00', { units: 1 })] });
    expect(checkRequest({ ...q, resources: [big], busy: two }, { start: plus2('2026-07-01 09:00'), end: plus2('2026-07-01 11:00') })).toMatchObject({ ok: true });
  });
});

describe('days: rentals by the night or the day', () => {
  const flat = resource({ id: 'flat', timeZone: WINDHOEK });
  const stay = offering({ id: 'stay', mode: 'days', unit: 'night', minUnits: 2, maxUnits: 14, checkIn: '14:00', checkOut: '10:00', resourceIds: ['flat'] });
  // A stay imported from another platform's calendar: 5 July 14:00 – 7 July 10:00.
  const booked = busyMap({ flat: [{ start: plus2('2026-07-05 14:00'), end: plus2('2026-07-07 10:00') }] });
  const q = { ...query(stay), resources: [flat], busy: booked, from: plus2('2026-07-01 00:00'), to: plus2('2026-07-10 00:00') };

  it('lists the free nights', () => {
    const a = listAvailability(q);
    expect(a.kind === 'days' && a.days.map((d) => d.date)).toEqual(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-07', '2026-07-08', '2026-07-09']);
  });

  it('checks a whole stay, check-in to check-out', () => {
    const ok = checkRequest(q, { date: '2026-07-03', units: 2 });
    expect(ok).toMatchObject({ ok: true, resourceId: 'flat' });
    if (ok.ok) expect([local(ok.start, WINDHOEK), local(ok.end, WINDHOEK)]).toEqual(['2026-07-03 14:00', '2026-07-05 10:00']);
    expect(checkRequest(q, { date: '2026-07-04', units: 2 })).toMatchObject({ ok: false, reason: 'taken' });
    expect(checkRequest(q, { date: '2026-07-01', units: 1 })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkRequest(q, { date: '2026-07-01', units: 15 })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkRequest(q, { date: '2026-02-30', units: 2 })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkRequest(q, { start: plus2('2026-07-03 14:00') })).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('★ a stay booked through Sitewright (with units, longer than a day) blocks overlapping stays', () => {
    const stays = busyMap({ flat: [{ start: plus2('2026-07-03 14:00'), end: plus2('2026-07-06 10:00'), units: 1 }] });
    const sq = { ...q, busy: stays };
    expect(checkRequest(sq, { date: '2026-07-05', units: 2 })).toMatchObject({ ok: false, reason: 'taken' });
    expect(checkRequest(sq, { date: '2026-07-01', units: 2 })).toMatchObject({ ok: true });
    expect(checkRequest(sq, { date: '2026-07-06', units: 2 })).toMatchObject({ ok: true });
    const a = listAvailability(sq);
    expect(a.kind === 'days' && a.days.map((d) => d.date).slice(0, 4)).toEqual(['2026-07-01', '2026-07-02', '2026-07-06', '2026-07-07']);
  });

  it('a stay whose check-in has passed is too soon; one beyond the horizon is too far', () => {
    expect(checkRequest({ ...q, now: plus2('2026-07-01 15:00') }, { date: '2026-07-01', units: 2 })).toMatchObject({ ok: false, reason: 'too-soon' });
    expect(checkRequest(q, { date: '2026-12-01', units: 2 })).toMatchObject({ ok: false, reason: 'too-far' });
  });

  it('whole days with units: three bikes out of five leave room for two', () => {
    const bikes = resource({ id: 'bikes', capacity: 5, timeZone: WINDHOEK });
    const hire = offering({ id: 'bike', mode: 'days', unit: 'day', minUnits: 1, maxQuantity: 5, resourceIds: ['bikes'] });
    const busy = busyMap({ bikes: [{ start: plus2('2026-07-02 00:00'), end: plus2('2026-07-03 00:00'), units: 3 }] });
    const bq = { ...query(hire), resources: [bikes], busy };
    expect(checkRequest(bq, { date: '2026-07-02', units: 1, quantity: 3 })).toMatchObject({ ok: false, reason: 'taken' });
    expect(checkRequest(bq, { date: '2026-07-02', units: 1, quantity: 2 })).toMatchObject({ ok: true });
  });
});

const EVERY_DAY = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

describe('listing limits', () => {
  it('★ a listing never covers more than 62 days, however wide the question', () => {
    const always = resource({ id: 'anna', hours: [{ days: EVERY_DAY, from: '09:00', to: '10:00' }] as BookingResource['hours'] });
    const o = offering({ id: 'c', mode: 'duration', durationMin: 60, maxAdvanceDays: 730, resourceIds: ['anna'] });
    const a = listAvailability({ ...query(o), resources: [always], from: plus2('2026-07-01 00:00'), to: plus2('2028-07-01 00:00') });
    expect(a.kind === 'times' && a.times.length).toBe(62);
    expect(a.truncated).toBe(false);
  });

  it('★ a listing cut short at 2000 entries says so', () => {
    const always = resource({ id: 'anna', hours: [{ days: EVERY_DAY, from: '00:00', to: '24:00' }] as BookingResource['hours'] });
    const o = offering({ id: 'c', mode: 'duration', durationMin: 5, maxAdvanceDays: 730, resourceIds: ['anna'] });
    const a = listAvailability({ ...query(o), resources: [always], from: plus2('2026-07-01 00:00'), to: plus2('2026-08-01 00:00') });
    expect(a.kind === 'times' && a.times.length).toBe(2000);
    expect(a.truncated).toBe(true);
  });

  it('nothing before now is listed, and a window that makes no sense lists nothing', () => {
    const hour = offering({ id: 'consult', mode: 'duration', durationMin: 60, resourceIds: ['anna'] });
    const past = listAvailability(query(hour, { now: plus2('2026-07-01 12:30'), from: 0 }));
    expect(starts(past)).toEqual(['13:00', '14:00', '15:00', '16:00']);
    for (const w of [{ from: plus2('2026-07-02 00:00'), to: plus2('2026-07-01 00:00') }, { from: Number.NaN }, { to: Number.POSITIVE_INFINITY }, { now: Number.NaN }]) {
      expect(listAvailability(query(hour, w))).toEqual({ kind: 'times', times: [], truncated: false });
    }
  });

  it('a configuration that skipped validation (a zero-length step) does not spin for ever', () => {
    const broken = { id: 'c', name: 'x', mode: 'duration', durationMin: 0, resourceIds: ['anna'], confirmation: 'instant', minNoticeMin: 0, maxAdvanceDays: 90, maxQuantity: 1, bufferBeforeMin: 0, bufferAfterMin: 0 } as BookingOffering;
    expect(listAvailability(query(broken))).toEqual({ kind: 'times', times: [], truncated: false });
    expect(checkRequest(query(broken), { start: plus2('2026-07-01 09:00') })).toMatchObject({ ok: false, reason: 'not-offered' });
    // …nor offer appointments that last no time at all.
    expect(listAvailability(query({ ...broken, stepMin: 30 } as BookingOffering))).toEqual({ kind: 'times', times: [], truncated: false });
  });
});

describe('★ everything a listing offers, the check accepts', () => {
  const window = { from: plus2('2026-06-29 00:00'), to: plus2('2026-07-06 00:00') };
  const busy = busyMap({ anna: [span('2026-07-01 10:15', '2026-07-01 11:45', { units: 1 })] });

  it('duration and slots', () => {
    for (const o of [
      offering({ id: 'a', mode: 'duration', durationMin: 45, stepMin: 15, bufferAfterMin: 10, resourceIds: ['anna', 'ben'] }),
      offering({ id: 'b', mode: 'slots', resourceIds: ['anna'], slots: [{ days: ['mon', 'wed'], at: '10:30', durationMin: 60 }, { days: ['fri'], at: '16:30', durationMin: 90 }] }),
    ]) {
      const q = query(o, { busy, ...window });
      const a = listAvailability(q);
      expect(a.kind === 'times' && a.times.length).toBeGreaterThan(0);
      for (const t of a.kind === 'times' ? a.times : []) expect(checkRequest(q, { start: t.start }), local(t.start)).toMatchObject({ ok: true });
    }
  });

  it('range windows, at their shortest and longest', () => {
    const o = offering({ id: 'r', mode: 'range', minMin: 60, maxMin: 120, stepMin: 30, resourceIds: ['anna'] });
    const q = query(o, { busy, ...window });
    const a = listAvailability(q);
    for (const w of a.kind === 'windows' ? a.windows : []) {
      expect(checkRequest(q, { start: w.start, end: w.start + 60 * M }), local(w.start)).toMatchObject({ ok: true });
      expect(checkRequest(q, { start: w.end - 60 * M, end: w.end }), local(w.end)).toMatchObject({ ok: true });
    }
  });

  it('single nights', () => {
    const flat = resource({ id: 'flat', timeZone: WINDHOEK });
    const o = offering({ id: 's', mode: 'days', resourceIds: ['flat'] });
    const q = { ...query(o, window), resources: [flat], busy: busyMap({ flat: [{ start: plus2('2026-07-02 15:00'), end: plus2('2026-07-04 11:00') }] }) };
    const a = listAvailability(q);
    expect(a.kind === 'days' && a.days.map((d) => d.date)).toEqual(['2026-06-30', '2026-07-01', '2026-07-04', '2026-07-05']);
    for (const d of a.kind === 'days' ? a.days : []) expect(checkRequest(q, { date: d.date, units: 1 }), d.date).toMatchObject({ ok: true });
  });
});

describe('★ everything a listing offers, the check accepts: across clock changes, zones and odd grids', () => {
  const ALL_DAY = [{ days: EVERY_DAY, from: '00:00', to: '24:00' }] as BookingResource['hours'];
  const weekly = [{ kind: 'weekly' as const, days: ['tue' as const, 'fri' as const], from: '12:00', to: '13:30' }];

  /** Lists `o` over `[from, to)` and checks every offer: each time, and both ends of each window. */
  function agree(o: BookingOffering, resources: BookingResource[], from: number, to: number, busy = new Map<string, Busy[]>()): number {
    const q: ListQuery = { offering: o, resources, busy, now: from - 24 * H, from, to };
    const a = listAvailability(q);
    let n = 0;
    for (const t of a.kind === 'times' ? a.times : []) {
      expect(checkRequest(q, { start: t.start }), `${o.id} ${new Date(t.start).toISOString()}`).toMatchObject({ ok: true });
      n += 1;
    }
    if (o.mode === 'range') {
      for (const w of a.kind === 'windows' ? a.windows : []) {
        expect(checkRequest(q, { start: w.start, end: w.start + o.minMin * M }), `${o.id} ${new Date(w.start).toISOString()}`).toMatchObject({ ok: true });
        expect(checkRequest(q, { start: w.end - o.minMin * M, end: w.end }), `${o.id} ${new Date(w.end).toISOString()}`).toMatchObject({ ok: true });
        n += 1;
      }
    }
    return n;
  }

  for (const [label, from, to] of [
    ['spring forward', Date.parse('2026-03-26T00:00Z'), Date.parse('2026-04-01T00:00Z')],
    ['fall back', Date.parse('2026-10-22T00:00Z'), Date.parse('2026-10-28T00:00Z')],
  ] as const) {
    it(`${label}: a whole-day booking, a buffered one with weekly blocks, a 90-minute grid`, () => {
      const allDay = resource({ id: 'all', hours: ALL_DAY, blocks: weekly });
      const offers = [
        offering({ id: 'day', mode: 'duration', durationMin: 1440, stepMin: 30, resourceIds: ['all'] }),
        offering({ id: 'buf', mode: 'duration', durationMin: 45, stepMin: 15, bufferBeforeMin: 20, bufferAfterMin: 600, resourceIds: ['all'] }),
        offering({ id: 'grid', mode: 'range', minMin: 90, maxMin: 360, stepMin: 90, resourceIds: ['all'] }),
      ];
      for (const o of offers) expect(agree(o, [allDay], from, to), o.id).toBeGreaterThan(0);
    });
  }

  it('two resources in different time zones, in one listing', () => {
    const wind = resource({ id: 'wind', timeZone: WINDHOEK, hours: OFFICE as BookingResource['hours'] });
    const ny = resource({ id: 'ny', timeZone: 'America/New_York', hours: OFFICE as BookingResource['hours'], blocks: weekly });
    const o = offering({ id: 'both', mode: 'duration', durationMin: 50, stepMin: 25, resourceIds: ['wind', 'ny'] });
    expect(agree(o, [wind, ny], Date.parse('2026-10-28T00:00Z'), Date.parse('2026-11-04T00:00Z'))).toBeGreaterThan(0);
  });

  it('★ a long buffer reaches a weekly block two days later: that start is neither offered nor accepted', () => {
    // Wednesday 20:00 + 10 h ends Thursday 06:00; a day of buffer after it runs into Friday's 00:00–06:00 block.
    const r = resource({ id: 'all', hours: ALL_DAY, blocks: [{ kind: 'weekly', days: ['fri'], from: '00:00', to: '06:00' }] });
    const o = offering({ id: 'long', mode: 'duration', durationMin: 600, stepMin: 60, bufferAfterMin: 1440, resourceIds: ['all'] });
    const q: ListQuery = { offering: o, resources: [r], busy: new Map(), now: NOW, from: plus2('2026-07-01 00:00'), to: plus2('2026-07-02 00:00') };
    expect(checkRequest(q, { start: plus2('2026-07-01 20:00') })).toMatchObject({ ok: false, reason: 'taken' });
    expect(starts(listAvailability(q))).not.toContain('20:00');
  });

  it('★ a window after a booking ending in the REPEATED hour starts on the grid after it, not before', () => {
    // 25 October 2026, Berlin: 02:00–03:00 happens twice. The booking ends at the second 02:15 (01:15Z).
    const r = resource({ id: 'all', hours: ALL_DAY });
    const o = offering({ id: 'grid', mode: 'range', minMin: 30, maxMin: 120, stepMin: 30, resourceIds: ['all'] });
    const busy = busyMap({ all: [{ start: Date.parse('2026-10-24T22:00Z'), end: Date.parse('2026-10-25T01:15Z') }] });
    const q: ListQuery = { offering: o, resources: [r], busy, now: Date.parse('2026-10-20T00:00Z'), from: Date.parse('2026-10-24T22:00Z'), to: Date.parse('2026-10-25T22:00Z') };
    const a = listAvailability(q);
    // The second 02:30 (01:30Z): the first grid point after the booking, in real time.
    expect(a.kind === 'windows' && new Date(a.windows[0]!.start).toISOString()).toBe('2026-10-25T01:30:00.000Z');
    expect(checkRequest(q, { start: a.kind === 'windows' ? a.windows[0]!.start : 0, end: Date.parse('2026-10-25T02:00Z') })).toMatchObject({ ok: true });
  });
});

describe('checkRequest: the authority at booking time', () => {
  const hour = offering({ id: 'consult', mode: 'duration', durationMin: 60, minNoticeMin: 60, maxAdvanceDays: 30, resourceIds: ['anna', 'ben'] });
  const q = query(hour, { now: plus2('2026-07-01 08:30') });

  it('places a free time on the first resource with room', () => {
    expect(checkRequest(q, { start: plus2('2026-07-01 10:00') })).toMatchObject({ ok: true, resourceId: 'anna' });
    const busy = busyMap({ anna: [span('2026-07-01 10:00', '2026-07-01 11:00')] });
    expect(checkRequest({ ...q, busy }, { start: plus2('2026-07-01 10:00') })).toMatchObject({ ok: true, resourceId: 'ben' });
    expect(checkRequest({ ...q, busy }, { start: plus2('2026-07-01 10:00'), resourceId: 'anna' })).toMatchObject({ ok: false, reason: 'taken' });
  });

  it('refuses what was never offered, too soon, too far, and unknown resources', () => {
    expect(checkRequest(q, { start: plus2('2026-07-01 10:10') })).toMatchObject({ ok: false, reason: 'not-offered' });
    expect(checkRequest(q, { start: plus2('2026-07-01 12:00') })).toMatchObject({ ok: false, reason: 'not-offered' });
    expect(checkRequest(q, { start: plus2('2026-07-01 09:00') })).toMatchObject({ ok: false, reason: 'too-soon' });
    expect(checkRequest(q, { start: plus2('2026-08-05 10:00') })).toMatchObject({ ok: false, reason: 'too-far' });
    expect(checkRequest(q, { start: plus2('2026-07-01 10:00'), resourceId: 'carl' })).toMatchObject({ ok: false, reason: 'unknown-resource' });
    expect(checkRequest(q, { start: plus2('2026-07-01 10:00'), quantity: 2 })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkRequest(q, { start: Number.NaN })).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('honours the resource the visitor picked for the listing', () => {
    expect(checkRequest({ ...q, resourceId: 'ben' }, { start: plus2('2026-07-01 10:00') })).toMatchObject({ ok: true, resourceId: 'ben' });
  });

  it('refuses a malformed request rather than throwing', () => {
    expect(checkRequest(q, null as never)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkRequest(q, { start: plus2('2026-07-01 10:00') + 1 })).toMatchObject({ ok: false, reason: 'invalid' });
    const stay = offering({ id: 's', mode: 'days', resourceIds: ['anna'] });
    expect(checkRequest(query(stay), { date: ['2026-07-03'], units: 2 } as never)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkRequest(query(stay), { date: '2026-07-03', units: '2' } as never)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkRequest(query(stay), { date: '2026-07-03', units: 2, resourceId: 7 } as never)).toMatchObject({ ok: false, reason: 'unknown-resource' });
  });

  it('a stay too soon on one resource but merely taken on another is reported as taken', () => {
    // Kiritimati is UTC+14, Pago Pago UTC−11: 14:00 on 1 July is long past in one and still ahead in the other.
    const east = resource({ id: 'east', timeZone: 'Pacific/Kiritimati' });
    const west = resource({ id: 'west', timeZone: 'Pacific/Pago_Pago' });
    const o = offering({ id: 's', mode: 'days', checkIn: '14:00', checkOut: '10:00', resourceIds: ['east', 'west'] });
    const busy = busyMap({ west: [{ start: Date.parse('2026-07-01T00:00Z'), end: Date.parse('2026-07-05T00:00Z') }] });
    const now = Date.parse('2026-07-01T12:00Z');
    expect(checkRequest({ offering: o, resources: [east, west], busy, now }, { date: '2026-07-01', units: 1 })).toMatchObject({ ok: false, reason: 'taken' });
  });

  it('an offering whose resources were all deleted cannot be booked', () => {
    expect(checkRequest({ ...q, resources: [] }, { start: plus2('2026-07-01 10:00') })).toMatchObject({ ok: false, reason: 'unknown-resource' });
  });
});
