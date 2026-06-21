import { describe, it, expect } from 'vitest';
import { LoginThrottle } from '../src/auth/login-throttle.js';

describe('LoginThrottle', () => {
  it('blocks a key only after `max` failures within the window', () => {
    const now = 1_000;
    const t = new LoginThrottle(60_000, () => now);
    for (let i = 0; i < 3; i += 1) {
      expect(t.isBlocked('ip', 3)).toBe(false); // not yet at the cap
      t.recordFailure('ip');
    }
    expect(t.isBlocked('ip', 3)).toBe(true); // 3 failures → blocked
  });

  it('expires the window: failures before the window resets do not carry over', () => {
    let now = 0;
    const t = new LoginThrottle(60_000, () => now);
    for (let i = 0; i < 5; i += 1) t.recordFailure('ip');
    expect(t.isBlocked('ip', 5)).toBe(true);
    now += 60_000; // window elapsed
    expect(t.isBlocked('ip', 5)).toBe(false);
    t.recordFailure('ip'); // a fresh window starts at 1
    expect(t.isBlocked('ip', 5)).toBe(false);
  });

  it('keys are independent', () => {
    const now = 0;
    const t = new LoginThrottle(60_000, () => now);
    for (let i = 0; i < 10; i += 1) t.recordFailure('a');
    expect(t.isBlocked('a', 10)).toBe(true);
    expect(t.isBlocked('b', 10)).toBe(false); // a different IP is unaffected
  });

  it('sweep drops only expired buckets', () => {
    let now = 0;
    const t = new LoginThrottle(60_000, () => now);
    t.recordFailure('old');
    now = 30_000;
    t.recordFailure('new');
    now = 61_000; // 'old' expired, 'new' still live
    t.sweep();
    expect(t.isBlocked('new', 1)).toBe(true); // survived (count 1, window not elapsed)
  });
});
