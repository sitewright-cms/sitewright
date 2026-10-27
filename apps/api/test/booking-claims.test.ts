import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BookingConfigSchema, type BookingConfig } from '@sitewright/schema';
import { makeTestDb } from './helpers.js';
import { projects, bookingClaims } from '../src/db/schema.js';
import type { Database } from '../src/db/client.js';
import { BOOKING_CLAIM_LIMITS, BookingClaimsRepository, type NewClaim } from '../src/booking/claims.js';
import { BOOKING_SERVICE_LIMITS, BookingService, DEFAULT_HOLD_MS } from '../src/booking/service.js';

/**
 * The claims table and the service over it: what the platform keeps about bookings, how it ends, and
 * that two visitors can never both claim the last place.
 */

const H = 3_600_000;
const M = 60_000;
const DAY = 24 * H;
/** Berlin summer time: local `YYYY-MM-DD HH:MM` → instant. */
const at = (s: string): number => Date.parse(`${s.replace(' ', 'T')}:00+02:00`);
const NOW = at('2026-06-30 12:00');

let db: Database;
let projectId: string;
let claims: BookingClaimsRepository;

beforeEach(async () => {
  db = await makeTestDb();
  projectId = randomUUID();
  await db.insert(projects).values({ id: projectId, name: 'P', slug: `p-${projectId.slice(0, 8)}`, createdAt: new Date() });
  claims = new BookingClaimsRepository(db);
});

const claim = (over: Partial<NewClaim> = {}): NewClaim => ({
  projectId,
  resourceId: 'anna',
  offeringId: 'consult',
  state: 'booked',
  start: at('2026-07-01 10:00'),
  end: at('2026-07-01 11:00'),
  busyStart: at('2026-07-01 10:00'),
  busyEnd: at('2026-07-01 11:15'),
  units: 1,
  exclusive: false,
  expiresAt: null,
  customer: { name: 'Ada', email: 'ada@example.test' },
  ...over,
});

describe('BookingClaimsRepository', () => {
  it('reads live claims back as busy stretches, buffers included, per resource', async () => {
    await claims.insert(claim(), NOW);
    await claims.insert(claim({ resourceId: 'ben', exclusive: true, units: 3, offeringId: 'tour' }), NOW);
    const busy = await claims.busy(projectId, ['anna', 'ben', 'carl'], at('2026-07-01 00:00'), at('2026-07-02 00:00'), NOW);
    expect(busy.get('anna')).toEqual([{ start: at('2026-07-01 10:00'), end: at('2026-07-01 11:15'), units: 1, offeringId: 'consult' }]);
    expect(busy.get('ben')).toEqual([{ start: at('2026-07-01 10:00'), end: at('2026-07-01 11:15'), units: 3, offeringId: 'tour', exclusive: true }]);
    expect(busy.get('carl')).toEqual([]);
  });

  it('a lapsed hold no longer occupies anything, and is not counted', async () => {
    await claims.insert(claim({ state: 'hold', expiresAt: NOW + 15 * M }), NOW);
    const window = [at('2026-07-01 00:00'), at('2026-07-02 00:00')] as const;
    expect((await claims.busy(projectId, ['anna'], ...window, NOW)).get('anna')).toHaveLength(1);
    expect(await claims.countUnconfirmed(projectId, NOW)).toBe(1);
    // ★ At the exact instant it lapses, it is already gone: busy, counts, advance and sweep all agree.
    expect((await claims.busy(projectId, ['anna'], ...window, NOW + 15 * M)).get('anna')).toHaveLength(0);
    expect(await claims.countUnconfirmed(projectId, NOW + 15 * M)).toBe(0);
  });

  it('only reads the window, the project and the resources asked about', async () => {
    await claims.insert(claim(), NOW);
    expect((await claims.busy(projectId, ['anna'], at('2026-07-01 11:15'), at('2026-07-02 00:00'), NOW)).get('anna')).toHaveLength(0);
    expect((await claims.busy(randomUUID(), ['anna'], at('2026-07-01 00:00'), at('2026-07-02 00:00'), NOW)).get('anna')).toHaveLength(0);
    expect((await claims.busy(projectId, [], 0, Number.MAX_SAFE_INTEGER, NOW)).size).toBe(0);
  });

  it('★ advances only a claim that has not lapsed: a request accepted too late has lost its time', async () => {
    const held = await claims.insert(claim({ state: 'pending', expiresAt: NOW + H }), NOW);
    expect(await claims.advance(projectId, held.id, 'booked', null, NOW + 30 * M)).toBe(true);
    expect((await claims.get(projectId, held.id))?.state).toBe('booked');
    const late = await claims.insert(claim({ state: 'pending', expiresAt: NOW + H }), NOW);
    expect(await claims.advance(projectId, late.id, 'booked', null, NOW + 2 * H)).toBe(false);
    expect(await claims.advance(randomUUID(), held.id, 'pending', NOW + H, NOW)).toBe(false);
  });

  it('removes within the project only', async () => {
    const c = await claims.insert(claim(), NOW);
    expect(await claims.remove(randomUUID(), c.id)).toBe(false);
    expect(await claims.remove(projectId, c.id)).toBe(true);
    expect(await claims.get(projectId, c.id)).toBeUndefined();
  });

  it('★ the sweep forgets lapsed holds and ended ledger bookings, customers\' details with them', async () => {
    await claims.insert(claim({ state: 'hold', expiresAt: NOW + 15 * M }), NOW);
    await claims.insert(claim({ state: 'pending', expiresAt: NOW + 2 * H }), NOW);
    const ended = await claims.insert(claim({ busyEnd: NOW - BOOKING_CLAIM_LIMITS.ledgerRetentionMs - 1 }), NOW);
    const recent = await claims.insert(claim({ busyEnd: NOW - H }), NOW);
    expect(await claims.sweep(NOW + H)).toEqual({ lapsed: 1, ended: 1 });
    const left = await db.select({ id: bookingClaims.id, state: bookingClaims.state }).from(bookingClaims);
    expect(left.map((r) => r.state).sort()).toEqual(['booked', 'pending']);
    expect(left.some((r) => r.id === ended.id)).toBe(false);
    expect(left.some((r) => r.id === recent.id)).toBe(true);
  });
});

describe('BookingService', () => {
  const config: BookingConfig = BookingConfigSchema.parse({
    resources: [
      { id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin', hours: [{ days: ['wed'], from: '09:00', to: '12:00' }] },
      { id: 'guide', name: 'Guide', timeZone: 'Europe/Berlin', capacity: 4 },
    ],
    offerings: [
      { id: 'consult', name: 'Consultation', mode: 'duration', durationMin: 60, bufferAfterMin: 15, resourceIds: ['anna'] },
      { id: 'tour', name: 'Tour', mode: 'slots', maxQuantity: 4, resourceIds: ['guide'], slots: [{ days: ['wed'], at: '10:00', durationMin: 90 }] },
    ],
  });
  const service = (now = NOW, cfg: BookingConfig | null = config) => new BookingService({ claims, readConfig: async () => cfg, now: () => now });
  const day = [at('2026-07-01 00:00'), at('2026-07-02 00:00')] as const;
  const starts = (a: Awaited<ReturnType<BookingService['availability']>>) => (a?.kind === 'times' ? a.times.map((t) => t.start) : []);

  it('lists what is free, with the claims already made taken out', async () => {
    const s = service();
    expect(starts(await s.availability(projectId, 'consult', ...day))).toEqual([at('2026-07-01 09:00'), at('2026-07-01 10:00'), at('2026-07-01 11:00')]);
    expect(await s.claim(projectId, 'consult', { start: at('2026-07-01 10:00') }, { state: 'booked', customer: {} })).toMatchObject({ ok: true });
    // 10:00 is taken. Its 15-minute buffer reaches into 11:00's hour, and 09:00's own buffer would run into it.
    expect(starts(await s.availability(projectId, 'consult', ...day))).toEqual([]);
  });

  it('writes the claim as the engine placed it: resource, times, buffers, units, the hold’s expiry', async () => {
    const r = await service().claim(projectId, 'consult', { start: at('2026-07-01 09:00') }, { state: 'hold', customer: { name: 'Ada' } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.claim).toMatchObject({ resourceId: 'anna', offeringId: 'consult', state: 'hold', units: 1, exclusive: false, customer: { name: 'Ada' } });
    expect([r.claim.startAt.getTime(), r.claim.endAt.getTime(), r.claim.busyEnd.getTime(), r.claim.expiresAt?.getTime()]).toEqual([
      at('2026-07-01 09:00'),
      at('2026-07-01 10:00'),
      at('2026-07-01 10:15'),
      NOW + DEFAULT_HOLD_MS,
    ]);
  });

  it('slot bookings share their seats and are written as exclusive', async () => {
    const s = service();
    const tour = { start: at('2026-07-01 10:00') };
    const first = await s.claim(projectId, 'tour', { ...tour, quantity: 3 }, { state: 'booked', customer: {} });
    expect(first.ok && first.claim.exclusive).toBe(true);
    expect(await s.claim(projectId, 'tour', { ...tour, quantity: 2 }, { state: 'booked', customer: {} })).toMatchObject({ ok: false, reason: 'taken' });
    expect(await s.claim(projectId, 'tour', { ...tour, quantity: 1 }, { state: 'booked', customer: {} })).toMatchObject({ ok: true });
  });

  it('★ two visitors claiming the last place at the same moment: exactly one gets it', async () => {
    const s = service();
    const req = { start: at('2026-07-01 10:00') };
    const results = await Promise.all(Array.from({ length: 8 }, () => s.claim(projectId, 'consult', req, { state: 'hold', customer: {} })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === 'taken')).toHaveLength(7);
    expect(await claims.countUnconfirmed(projectId, NOW)).toBe(1);
  });

  it('a lapsed hold frees its time again', async () => {
    await service().claim(projectId, 'consult', { start: at('2026-07-01 10:00') }, { state: 'hold', holdMs: 10 * M, customer: {} });
    expect(await service(NOW + 5 * M).claim(projectId, 'consult', { start: at('2026-07-01 10:00') }, { state: 'hold', customer: {} })).toMatchObject({ ok: false, reason: 'taken' });
    expect(await service(NOW + 10 * M).claim(projectId, 'consult', { start: at('2026-07-01 10:00') }, { state: 'hold', customer: {} })).toMatchObject({ ok: true });
  });

  it('an unknown offering, or a project with no booking set-up, is neither listed nor claimed', async () => {
    expect(await service().availability(projectId, 'nope', ...day)).toBeNull();
    expect(await service(NOW, null).availability(projectId, 'consult', ...day)).toBeNull();
    expect(await service().claim(projectId, 'nope', { start: at('2026-07-01 10:00') }, { state: 'booked', customer: {} })).toMatchObject({ ok: false, reason: 'unknown-offering' });
  });

  it('★ a project at its cap of bookings takes no more', async () => {
    const rows = Array.from({ length: BOOKING_CLAIM_LIMITS.bookedPerProject }, (_, i) => row(`c${i}`, 'elsewhere', 'booked', null));
    for (let i = 0; i < rows.length; i += 500) await db.insert(bookingClaims).values(rows.slice(i, i + 500));
    expect(await service().claim(projectId, 'consult', { start: at('2026-07-01 10:00') }, { state: 'booked', customer: {} })).toMatchObject({ ok: false, reason: 'full' });
  });

  it('★ holds nobody confirms cannot block real bookings, nor one resource the others', async () => {
    // A resource's share of unconfirmed holds is used up…
    const held = Array.from({ length: BOOKING_CLAIM_LIMITS.unconfirmedPerResource }, (_, i) => row(`h${i}`, 'anna', 'hold', NOW + H));
    await db.insert(bookingClaims).values(held);
    const s = service();
    expect(await s.claim(projectId, 'consult', { start: at('2026-07-01 10:00') }, { state: 'hold', customer: {} })).toMatchObject({ ok: false, reason: 'full' });
    // …but a booking is still taken, and so is a hold on another resource.
    expect(await s.claim(projectId, 'consult', { start: at('2026-07-01 10:00') }, { state: 'booked', customer: {} })).toMatchObject({ ok: true });
    expect(await s.claim(projectId, 'tour', { start: at('2026-07-01 10:00') }, { state: 'hold', customer: {} })).toMatchObject({ ok: true });
  });

  it('the project as a whole has a cap on unconfirmed holds too', async () => {
    const held = Array.from({ length: BOOKING_CLAIM_LIMITS.unconfirmedPerProject }, (_, i) => row(`h${i}`, `r${i % 20}`, 'pending', NOW + H));
    await db.insert(bookingClaims).values(held);
    expect(await service().claim(projectId, 'consult', { start: at('2026-07-01 10:00') }, { state: 'pending', customer: {} })).toMatchObject({ ok: false, reason: 'full' });
  });

  it('refuses a hold of no length or too long, and customer details that are not a few short fields', async () => {
    const s = service();
    const req = { start: at('2026-07-01 10:00') };
    for (const holdMs of [Number.NaN, 0, 30_000, 8 * DAY, Number.POSITIVE_INFINITY]) {
      expect(await s.claim(projectId, 'consult', req, { state: 'hold', holdMs, customer: {} }), String(holdMs)).toMatchObject({ ok: false, reason: 'invalid' });
    }
    const tooMany = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`f${i}`, 'x']));
    for (const customer of [tooMany, { note: 'x'.repeat(2001) }, { 'bad key': 'x' }, { n: 5 }, ['x'], null]) {
      expect(await s.claim(projectId, 'consult', req, { state: 'booked', customer: customer as never }), JSON.stringify(customer)).toMatchObject({ ok: false, reason: 'invalid' });
    }
    expect(await claims.countBooked(projectId)).toBe(0);
  });

  it('★ past a bound, claims for one project are refused rather than queued for ever', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = new BookingService({ claims, readConfig: async () => (await gate, config), now: () => NOW });
    const pending = Array.from({ length: BOOKING_SERVICE_LIMITS.maxWaiting + 5 }, (_, i) =>
      slow.claim(projectId, 'tour', { start: at('2026-07-01 10:00') }, { state: 'booked', customer: { n: String(i) } }),
    );
    release();
    const results = await Promise.all(pending);
    expect(results.filter((r) => !r.ok && r.reason === 'busy')).toHaveLength(5);
  });

  it('a stay that began two weeks ago and is still running blocks the days it covers', async () => {
    const flat = BookingConfigSchema.parse({
      resources: [{ id: 'flat', name: 'Flat', timeZone: 'Europe/Berlin' }],
      offerings: [{ id: 'stay', name: 'Stay', mode: 'days', resourceIds: ['flat'] }],
    });
    await claims.insert(claim({ resourceId: 'flat', offeringId: 'stay', start: NOW - 14 * DAY, end: NOW + 3 * DAY, busyStart: NOW - 14 * DAY, busyEnd: NOW + 3 * DAY }), NOW);
    expect(await service(NOW, flat).claim(projectId, 'stay', { date: '2026-07-01', units: 1 }, { state: 'booked', customer: {} })).toMatchObject({ ok: false, reason: 'taken' });
    expect(await service(NOW, flat).claim(projectId, 'stay', { date: '2026-07-04', units: 1 }, { state: 'booked', customer: {} })).toMatchObject({ ok: true });
  });

  it('★ far from UTC, a booking overlapping only the end of a stay is still seen', async () => {
    // Pago Pago is UTC−11: the night of 1 July runs 15:00 local (02:00Z on 2 July) to 11:00 local on 2 July (22:00Z).
    const west = BookingConfigSchema.parse({
      resources: [{ id: 'flat', name: 'Flat', timeZone: 'Pacific/Pago_Pago' }],
      offerings: [{ id: 'stay', name: 'Stay', mode: 'days', resourceIds: ['flat'] }],
    });
    const late = Date.parse('2026-07-02T10:00Z');
    await claims.insert(claim({ resourceId: 'flat', offeringId: 'stay', start: late, end: late + 2 * H, busyStart: late, busyEnd: late + 2 * H }), NOW);
    expect(await service(NOW, west).claim(projectId, 'stay', { date: '2026-07-01', units: 1 }, { state: 'booked', customer: {} })).toMatchObject({ ok: false, reason: 'taken' });
  });

  it('★ the owner confirms, extends or releases a claim through the same queue, and a lapsed one stays lapsed', async () => {
    const r = await service().claim(projectId, 'consult', { start: at('2026-07-01 10:00') }, { state: 'pending', holdMs: H, customer: {} });
    const id = r.ok ? r.claim.id : '';
    expect(await service(NOW + 30 * M).extend(projectId, id, 2 * H)).toEqual({ ok: true });
    expect((await claims.get(projectId, id))?.expiresAt?.getTime()).toBe(NOW + 30 * M + 2 * H);
    // At the exact instant it lapses, it can no longer be confirmed, and the time is free for others.
    const lapse = NOW + 30 * M + 2 * H;
    expect(await service(lapse).confirm(projectId, id)).toMatchObject({ ok: false, reason: 'lapsed' });
    expect(await service(lapse).claim(projectId, 'consult', { start: at('2026-07-01 10:00') }, { state: 'booked', customer: {} })).toMatchObject({ ok: true });
    // A fresh request confirms into a booking; a booking is not confirmed twice; release gives the time back.
    const second = await service().claim(projectId, 'tour', { start: at('2026-07-01 10:00') }, { state: 'pending', customer: {} });
    expect(second.ok).toBe(true);
    const sid = second.ok ? second.claim.id : '';
    expect(await service().confirm(projectId, sid)).toEqual({ ok: true });
    expect((await claims.get(projectId, sid))).toMatchObject({ state: 'booked', expiresAt: null });
    expect(await service().confirm(projectId, sid)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await service().release(projectId, sid)).toEqual({ ok: true });
    expect(await service().release(projectId, sid)).toMatchObject({ ok: false, reason: 'unknown-claim' });
    expect(await service().extend(projectId, sid, Number.NaN)).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('the sweep, in batches', () => {
  it('deletes a backlog a batch at a time, and the next pass takes what is left', async () => {
    const n = BOOKING_CLAIM_LIMITS.sweepBatch * 2 + 37;
    const rows = Array.from({ length: n }, (_, i) => row(`l${i}`, 'anna', 'hold', NOW - M));
    for (let i = 0; i < rows.length; i += 500) await db.insert(bookingClaims).values(rows.slice(i, i + 500));
    expect(await claims.sweep(NOW, undefined, 2)).toEqual({ lapsed: BOOKING_CLAIM_LIMITS.sweepBatch * 2, ended: 0 });
    expect(await claims.sweep(NOW, undefined, 2)).toEqual({ lapsed: 37, ended: 0 });
    expect(await db.select().from(bookingClaims)).toHaveLength(0);
  });
});

/** A raw claim row, for filling the table directly. */
function row(id: string, resourceId: string, state: 'hold' | 'pending' | 'booked', expiresAt: number | null) {
  return {
    id,
    projectId,
    resourceId,
    offeringId: 'x',
    state,
    startAt: new Date(NOW + DAY),
    endAt: new Date(NOW + DAY + H),
    busyStart: new Date(NOW + DAY),
    busyEnd: new Date(NOW + DAY + H),
    units: 1,
    exclusive: false,
    expiresAt: expiresAt === null ? null : new Date(expiresAt),
    customer: {},
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
  };
}
