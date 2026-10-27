import { and, count, eq, gt, inArray, isNotNull, isNull, lt, lte, or } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { bookingClaims } from '../db/schema.js';
import { newId } from '../id.js';
import type { Busy } from './occupancy.js';
import { DAY_MS } from './zoned.js';

/**
 * THE BOOKING CLAIMS TABLE: the little the platform keeps about bookings (see `bookingClaims` in
 * schema.ts). Every row ends, and a per-project cap refuses new ones beyond a limit.
 */

export type ClaimState = 'hold' | 'pending' | 'booked';

export const BOOKING_CLAIM_LIMITS = {
  /** Ledger bookings one project may hold. A small business takes far fewer; this bounds a runaway. */
  bookedPerProject: 5000,
  /**
   * Holds and requests not yet confirmed, per project and per resource. Counted apart from bookings, and far
   * lower, so a script holding times it never books cannot block a site's real bookings, nor one busy
   * resource every other.
   */
  unconfirmedPerProject: 300,
  unconfirmedPerResource: 50,
  /** How long a ledger booking is kept after it ends: long enough to look back on, short enough to forget. */
  ledgerRetentionMs: 7 * DAY_MS,
  /** Rows one sweep pass deletes per statement, so a backlog never holds the write lock for long. */
  sweepBatch: 500,
} as const;

export interface NewClaim {
  readonly projectId: string;
  readonly resourceId: string;
  readonly offeringId: string;
  readonly state: ClaimState;
  readonly start: number;
  readonly end: number;
  /** What it occupies: the booking and its buffers. */
  readonly busyStart: number;
  readonly busyEnd: number;
  /** Seats or units the booking takes: its quantity (not the nights of a stay). */
  readonly units: number;
  readonly exclusive: boolean;
  /** When a hold or a request lapses. Null for a ledger booking. */
  readonly expiresAt: number | null;
  readonly customer: Readonly<Record<string, string>>;
}

export type ClaimRow = typeof bookingClaims.$inferSelect;

/** A claim still in force at `now`: a booking, or a hold or request that has not lapsed. */
const live = (now: number) => or(isNull(bookingClaims.expiresAt), gt(bookingClaims.expiresAt, new Date(now)));

/**
 * ★ Writes (`insert`, `advance`, `remove`) belong to `BookingService`, which runs each one in the
 * project's queue with the clock read inside it. Called from anywhere else they race a claim.
 */
export class BookingClaimsRepository {
  constructor(private readonly db: Database) {}

  /**
   * What the project's live claims occupy on `resourceIds` between `from` and `to`, per resource, in the
   * engine's terms. A slot booking is `exclusive`: it shares seats only with its own slot.
   */
  async busy(projectId: string, resourceIds: readonly string[], from: number, to: number, now: number): Promise<Map<string, Busy[]>> {
    const out = new Map<string, Busy[]>(resourceIds.map((id) => [id, []]));
    if (resourceIds.length === 0) return out;
    // Only what the engine needs: never the customers' details on a public availability request.
    const rows = await this.db
      .select({
        resourceId: bookingClaims.resourceId,
        offeringId: bookingClaims.offeringId,
        busyStart: bookingClaims.busyStart,
        busyEnd: bookingClaims.busyEnd,
        units: bookingClaims.units,
        exclusive: bookingClaims.exclusive,
      })
      .from(bookingClaims)
      .where(
        and(
          eq(bookingClaims.projectId, projectId),
          inArray(bookingClaims.resourceId, [...resourceIds]),
          gt(bookingClaims.busyEnd, new Date(from)),
          lt(bookingClaims.busyStart, new Date(to)),
          live(now),
        ),
      );
    for (const r of rows) {
      out.get(r.resourceId)?.push({
        start: r.busyStart.getTime(),
        end: r.busyEnd.getTime(),
        units: r.units,
        offeringId: r.offeringId,
        ...(r.exclusive ? { exclusive: true } : {}),
      });
    }
    return out;
  }

  /** Holds and requests still in force, for the project or one of its resources. */
  async countUnconfirmed(projectId: string, now: number, resourceId?: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(bookingClaims)
      .where(
        and(
          eq(bookingClaims.projectId, projectId),
          ...(resourceId !== undefined ? [eq(bookingClaims.resourceId, resourceId)] : []),
          inArray(bookingClaims.state, ['hold', 'pending']),
          gt(bookingClaims.expiresAt, new Date(now)),
        ),
      );
    return row?.n ?? 0;
  }

  /** Ledger bookings the project holds, ended ones included until the sweep forgets them. */
  async countBooked(projectId: string): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(bookingClaims).where(and(eq(bookingClaims.projectId, projectId), eq(bookingClaims.state, 'booked')));
    return row?.n ?? 0;
  }

  async insert(claim: NewClaim, now: number): Promise<ClaimRow> {
    const at = new Date(now);
    const row = {
      id: newId(24),
      projectId: claim.projectId,
      resourceId: claim.resourceId,
      offeringId: claim.offeringId,
      state: claim.state,
      startAt: new Date(claim.start),
      endAt: new Date(claim.end),
      busyStart: new Date(claim.busyStart),
      busyEnd: new Date(claim.busyEnd),
      units: claim.units,
      exclusive: claim.exclusive,
      expiresAt: claim.expiresAt === null ? null : new Date(claim.expiresAt),
      customer: { ...claim.customer },
      createdAt: at,
      updatedAt: at,
    };
    await this.db.insert(bookingClaims).values(row);
    return row;
  }

  async get(projectId: string, id: string): Promise<ClaimRow | undefined> {
    const [row] = await this.db.select().from(bookingClaims).where(and(eq(bookingClaims.projectId, projectId), eq(bookingClaims.id, id)));
    return row;
  }

  /**
   * Moves a claim on (a hold or request becomes a ledger booking, a request's hold is extended). Only a
   * claim that has not lapsed moves: a request accepted a minute after its hold ran out has lost its time.
   */
  async advance(projectId: string, id: string, state: ClaimState, expiresAt: number | null, now: number): Promise<boolean> {
    const rows = await this.db
      .update(bookingClaims)
      .set({ state, expiresAt: expiresAt === null ? null : new Date(expiresAt), updatedAt: new Date(now) })
      .where(and(eq(bookingClaims.projectId, projectId), eq(bookingClaims.id, id), live(now)))
      .returning({ id: bookingClaims.id });
    return rows.length > 0;
  }

  async remove(projectId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(bookingClaims)
      .where(and(eq(bookingClaims.projectId, projectId), eq(bookingClaims.id, id)))
      .returning({ id: bookingClaims.id });
    return rows.length > 0;
  }

  /**
   * Forgets what has ended: lapsed holds and requests, and ledger bookings past their retention. Run by
   * the maintenance sweep; the customers' details go with the rows. In batches, so a backlog never holds
   * the write lock in one long statement; what a pass leaves, the next one takes.
   */
  async sweep(now: number, retentionMs: number = BOOKING_CLAIM_LIMITS.ledgerRetentionMs, maxBatches = 20): Promise<{ lapsed: number; ended: number }> {
    const lapsedWhere = and(isNotNull(bookingClaims.expiresAt), lte(bookingClaims.expiresAt, new Date(now)));
    const endedWhere = and(isNull(bookingClaims.expiresAt), lt(bookingClaims.busyEnd, new Date(now - retentionMs)));
    return { lapsed: await this.deleteInBatches(lapsedWhere, maxBatches), ended: await this.deleteInBatches(endedWhere, maxBatches) };
  }

  private async deleteInBatches(where: ReturnType<typeof and>, maxBatches: number): Promise<number> {
    let total = 0;
    for (let i = 0; i < maxBatches; i += 1) {
      const ids = (await this.db.select({ id: bookingClaims.id }).from(bookingClaims).where(where).limit(BOOKING_CLAIM_LIMITS.sweepBatch)).map((r) => r.id);
      if (ids.length === 0) break;
      await this.db.delete(bookingClaims).where(inArray(bookingClaims.id, ids));
      total += ids.length;
      if (ids.length < BOOKING_CLAIM_LIMITS.sweepBatch) break;
    }
    return total;
  }
}
