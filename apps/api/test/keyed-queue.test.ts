import { describe, it, expect } from 'vitest';
import { KeyedQueue } from '../src/runtime/keyed-queue.js';

describe('KeyedQueue', () => {
  it('runs one key’s work in order, and counts what is running or waiting', async () => {
    const q = new KeyedQueue();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = q.run('p', async () => {
      await gate;
      order.push('a');
    });
    const b = q.run('p', async () => {
      order.push('b');
    });
    const other = q.run('o', async () => {
      order.push('other');
    });
    expect([q.waiting('p'), q.waiting('o'), q.waiting('none')]).toEqual([2, 1, 0]);
    await other;
    expect(order).toEqual(['other']);
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(['other', 'a', 'b']);
    expect(q.waiting('p')).toBe(0);
  });

  it('a failing piece of work neither stops the next nor leaves the count behind', async () => {
    const q = new KeyedQueue();
    await expect(q.run('p', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(q.run('p', async () => 'next')).resolves.toBe('next');
    expect(q.waiting('p')).toBe(0);
  });
});
