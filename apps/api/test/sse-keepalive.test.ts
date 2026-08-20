import { describe, it, expect, vi, afterEach } from 'vitest';
import { startSseKeepAlive, SSE_KEEPALIVE_MS } from '../src/http/deploy-targets.js';

/**
 * SSE KEEPALIVE.
 *
 * ★ The bug this closes is not visible in any single component. A deploy has phases that are
 * legitimately silent for a long time — an SSH handshake, reading the remote manifest, creating a
 * remote directory tree one round trip at a time. A reverse proxy reaps an idle connection (nginx's
 * `proxy_read_timeout` defaults to 60s), and when it does THE SERVER DOES NOT NOTICE: the deploy runs
 * to completion, the files land, the manifest is written — and the browser sits on the last frame it
 * ever received. Reported as "it uploads, but it never finishes and never shows success", and
 * confirmed on a real target: the remote manifest already matched 253 of 254 files, so the deploy the
 * user thought had hung had in fact finished.
 */
describe('startSseKeepAlive', () => {
  afterEach(() => vi.useRealTimers());

  it('emits a comment frame while the stream is idle', () => {
    vi.useFakeTimers();
    const frames: string[] = [];
    const idleSince = Date.now() - SSE_KEEPALIVE_MS * 10; // nothing written for a long time
    const ka = startSseKeepAlive((f) => frames.push(f), () => idleSince);
    vi.advanceTimersByTime(SSE_KEEPALIVE_MS * 3);
    ka.stop();
    expect(frames.length).toBeGreaterThanOrEqual(3);
    // A COMMENT frame: two bytes, ignored by every SSE parser, and enough to keep the socket alive.
    expect(new Set(frames)).toEqual(new Set([':\n\n']));
  });

  it('stays SILENT while real events are flowing', () => {
    // Filler on a busy stream would be pure noise — and would mask a genuinely stalled deploy.
    vi.useFakeTimers();
    const frames: string[] = [];
    const ka = startSseKeepAlive((f) => frames.push(f), () => Date.now());
    vi.advanceTimersByTime(SSE_KEEPALIVE_MS * 5);
    ka.stop();
    expect(frames).toEqual([]);
  });

  it('stops when the deploy ends', () => {
    // The interval outlives the request otherwise, writing to a closed socket forever.
    vi.useFakeTimers();
    const frames: string[] = [];
    const ka = startSseKeepAlive((f) => frames.push(f), () => 0);
    vi.advanceTimersByTime(SSE_KEEPALIVE_MS);
    const afterFirst = frames.length;
    ka.stop();
    vi.advanceTimersByTime(SSE_KEEPALIVE_MS * 5);
    expect(frames.length).toBe(afterFirst);
  });

  it('fires well inside the idle timeout it exists to defeat', () => {
    // nginx reaps at 60s by default; a keepalive at or above that would not help.
    expect(SSE_KEEPALIVE_MS).toBeLessThan(60_000 / 2);
  });
});
