import { describe, it, expect } from 'vitest';
import { BookingCancelLock } from '../src/booking/cancel-lock.js';

/** ★ One cancellation of a booking at a time: the second waits for the first, other bookings do not. */

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { open, opened };
};

describe('BookingCancelLock', () => {
  it('runs the cancellations of one booking one after the other, and of others side by side', async () => {
    const lock = new BookingCancelLock();
    const order: string[] = [];
    const first = gate();
    const a = lock.run('p', 'c1', async () => {
      order.push('a start');
      await first.opened;
      order.push('a end');
      return 'a';
    });
    const b = lock.run('p', 'c1', async () => {
      order.push('b');
      return 'b';
    });
    const other = lock.run('p', 'c2', async () => {
      order.push('other');
      return 'other';
    });
    expect(await other).toBe('other');
    expect(order).toEqual(['a start', 'other']);
    first.open();
    expect(await Promise.all([a, b])).toEqual(['a', 'b']);
    expect(order).toEqual(['a start', 'other', 'a end', 'b']);
  });

  it('lets the next one run after one that failed, and forgets a booking once nothing waits on it', async () => {
    const lock = new BookingCancelLock();
    await expect(lock.run('p', 'c1', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await lock.run('p', 'c1', async () => 'next')).toBe('next');
    await new Promise((r) => setTimeout(r, 0));
    expect(lock.size).toBe(0);
  });

  it('keeps projects apart', async () => {
    const lock = new BookingCancelLock();
    const held = gate();
    const a = lock.run('p1', 'c', () => held.opened);
    expect(await lock.run('p2', 'c', async () => 'free')).toBe('free');
    held.open();
    await a;
  });
});
