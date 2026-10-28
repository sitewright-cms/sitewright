import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { BookingConfigSchema, type BookingConfig } from '@sitewright/schema';
import { makeTestDb } from './helpers.js';
import { projects, bookingClaims } from '../src/db/schema.js';
import type { Database } from '../src/db/client.js';
import { BookingClaimsRepository, type NewClaim } from '../src/booking/claims.js';
import { decide, runReminders } from '../src/booking/reminders.js';
import type { BookingEvent } from '../src/booking/notify.js';

/**
 * ★ Booking reminders: each booking is reminded once, at its set-up's time before it starts, in the language it was
 * booked in, and never when the set-up has none or it was booked inside the window. One timestamp per booking is all
 * that is kept, and it is set before the mail goes, so two passes send one.
 */

const H = 3_600_000;
const DAY = 24 * H;
const NOW = Date.UTC(2026, 9, 28, 12);

const CONFIG: BookingConfig = BookingConfigSchema.parse({
  resources: [{ id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin' }],
  offerings: [{ id: 'consult', name: 'Consultation', mode: 'duration', durationMin: 60, resourceIds: ['anna'] }],
  remindBeforeMin: 24 * 60,
});

let db: Database;
let projectId: string;
let claims: BookingClaimsRepository;
let told: BookingEvent[];
let config: BookingConfig | null;

beforeEach(async () => {
  db = await makeTestDb();
  projectId = randomUUID();
  await db.insert(projects).values({ id: projectId, name: 'P', slug: `p-${projectId.slice(0, 8)}`, createdAt: new Date() });
  claims = new BookingClaimsRepository(db);
  told = [];
  config = CONFIG;
});

const claim = (start: number, over: Partial<NewClaim> = {}): NewClaim => ({
  projectId,
  resourceId: 'anna',
  offeringId: 'consult',
  state: 'booked',
  start,
  end: start + H,
  busyStart: start,
  busyEnd: start + H,
  units: 1,
  exclusive: false,
  expiresAt: null,
  customer: { name: 'Ada', email: 'ada@example.test' },
  ...over,
});
const pass = (now = NOW, readConfig: (projectId: string) => Promise<BookingConfig | null> = async (p) => (p === projectId ? config : { ...CONFIG, remindBeforeMin: 60 })) =>
  runReminders(
    {
      claims,
      readConfig,
      notify: async (e) => void told.push(e),
      reference: (_p, id) => `ref-${id}`,
      log: { warn: () => undefined },
    },
    now,
  );
const remindedAt = async (id: string) => (await db.select().from(bookingClaims).where(eq(bookingClaims.id, id)))[0]!.remindedAt;

describe('★ booking reminders', () => {
  it('reminds a booking once, at its time before the start, in the language it was booked in, with its page', async () => {
    const soon = await claims.insert(claim(NOW + 20 * H, { locale: 'de' }), NOW - 3 * DAY);
    expect(await pass()).toBe(1);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ kind: 'reminder', projectId, reference: `ref-${soon.id}`, locale: 'de' });
    expect(told[0]!.claim.id).toBe(soon.id);
    expect((await remindedAt(soon.id))?.getTime()).toBe(NOW);
    // Never twice.
    expect(await pass(NOW + H)).toBe(0);
    expect(told).toHaveLength(1);
  });

  it('waits for a booking whose time has not come, then reminds it', async () => {
    const later = await claims.insert(claim(NOW + 3 * DAY), NOW - DAY);
    expect(await pass()).toBe(0);
    expect(await remindedAt(later.id)).toBeNull();
    expect(await pass(NOW + 2 * DAY + H)).toBe(1);
  });

  it('★ decides against a booking made inside the window (its confirmation just went out), and a set-up with none', async () => {
    const lastMinute = await claims.insert(claim(NOW + 5 * H), NOW - H);
    expect(await pass()).toBe(0);
    expect(await remindedAt(lastMinute.id)).not.toBeNull();
    config = { ...CONFIG, remindBeforeMin: undefined };
    const noReminders = await claims.insert(claim(NOW + 10 * H), NOW - 3 * DAY);
    expect(await pass()).toBe(0);
    // Decided, so never looked at again.
    expect(await remindedAt(noReminders.id)).not.toBeNull();
    expect(told).toEqual([]);
  });

  it('reminds only bookings: not a request waiting for an answer, nor a time being paid for', async () => {
    await claims.insert(claim(NOW + 20 * H, { state: 'pending', expiresAt: NOW + 10 * H }), NOW - 3 * DAY);
    await claims.insert(claim(NOW + 20 * H, { state: 'hold', expiresAt: NOW + 10 * H }), NOW - 3 * DAY);
    expect(await pass()).toBe(0);
    expect(told).toEqual([]);
  });

  it('leaves a booking whose set-up could not be read for the next pass', async () => {
    const b = await claims.insert(claim(NOW + 20 * H), NOW - 3 * DAY);
    expect(
      await pass(NOW, async () => {
        throw new Error('database is locked');
      }),
    ).toBe(0);
    expect(await remindedAt(b.id)).toBeNull();
    expect(await pass()).toBe(1);
  });

  it('★ two passes at once send one reminder', async () => {
    await claims.insert(claim(NOW + 20 * H), NOW - 3 * DAY);
    const [a, b] = await Promise.all([pass(), pass()]);
    expect(a + b).toBe(1);
    expect(told).toHaveLength(1);
  });

  it('★ never misses another project’s due reminder behind many bookings not due yet', async () => {
    // Project A reminds an hour before: hundreds of its bookings in the coming days are not due, and start soonest.
    const other = randomUUID();
    await db.insert(projects).values({ id: other, name: 'A', slug: `a-${other.slice(0, 8)}`, createdAt: new Date() });
    const rows = Array.from({ length: 1200 }, (_, i) => ({
      ...claim(NOW + 2 * H + i * 60_000),
      projectId: other,
    }));
    for (const r of rows) await claims.insert(r, NOW - 3 * DAY);
    // This project's booking starts later, but is due now.
    const due = await claims.insert(claim(NOW + 23 * H), NOW - 3 * DAY);
    expect(await pass()).toBe(1);
    expect(told.map((e) => e.claim.id)).toContain(due.id);
    // (A's are not due: only an hour before each.)
    expect(told.filter((e) => e.projectId === other)).toEqual([]);
  });

  it('★ judges a booking by when it BECAME one: a request accepted inside the window gets no reminder on top', async () => {
    const accepted = await claims.insert(claim(NOW + 10 * H, { state: 'pending', expiresAt: NOW + 5 * H }), NOW - 3 * DAY);
    // Accepted an hour ago, inside the day before its start.
    await claims.advance(projectId, accepted.id, 'booked', null, NOW - H);
    expect(await pass()).toBe(0);
    expect(await remindedAt(accepted.id)).not.toBeNull();
  });

  it('looks no further ahead than the longest window, and never at what has started', async () => {
    await claims.insert(claim(NOW + 8 * DAY), NOW - 3 * DAY);
    await claims.insert(claim(NOW - H), NOW - 3 * DAY);
    expect(await claims.dueForReminder(NOW, 7 * DAY, 50)).toEqual([]);
  });
});

describe('decide', () => {
  const at = (startAt: number, bookedAt: number) => ({ offeringId: 'consult', startAt: new Date(startAt), updatedAt: new Date(bookedAt) });
  it('is due from the window’s start, never for an offering gone or a booking made inside it', () => {
    expect(decide(at(NOW + DAY, NOW - DAY), CONFIG, NOW)).toMatchObject({ offering: { id: 'consult' } });
    expect(decide(at(NOW + DAY + 1, NOW - DAY), CONFIG, NOW)).toBe('later');
    expect(decide(at(NOW + DAY, NOW), CONFIG, NOW)).toBe('never');
    expect(decide({ ...at(NOW + DAY, NOW - DAY), offeringId: 'gone' }, CONFIG, NOW)).toBe('never');
    expect(decide(at(NOW + DAY, NOW - DAY), null, NOW)).toBe('never');
  });
});
