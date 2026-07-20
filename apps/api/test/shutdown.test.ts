import { describe, it, expect, vi, afterEach } from 'vitest';
import { runShutdown } from '../src/shutdown.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('runShutdown', () => {
  it('drains the app, closes the DB, and exits 0 on a clean shutdown', async () => {
    const order: string[] = [];
    const close = vi.fn(async () => {
      order.push('close');
    });
    const closeDb = vi.fn(() => order.push('closeDb'));
    const exit = vi.fn((code: number) => order.push(`exit:${code}`));
    const log = vi.fn();

    await runShutdown({ close, closeDb, timeoutMs: 1000, log, exit });

    expect(order).toEqual(['close', 'closeDb', 'exit:0']); // app THEN db THEN exit
    expect(log).not.toHaveBeenCalled();
  });

  it('exits 1 and logs when app.close() rejects (does not touch the DB)', async () => {
    const closeDb = vi.fn();
    const exit = vi.fn();
    const log = vi.fn();

    await runShutdown({
      close: () => Promise.reject(new Error('stuck connection')),
      closeDb,
      timeoutMs: 1000,
      log,
      exit,
    });

    expect(exit).toHaveBeenCalledWith(1);
    expect(closeDb).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('stuck connection'));
  });

  it('still exits 0 when closeDb throws (an already-closed client is not a shutdown failure)', async () => {
    const exit = vi.fn();
    await runShutdown({
      close: () => Promise.resolve(),
      closeDb: () => {
        throw new Error('already closed');
      },
      timeoutMs: 1000,
      log: vi.fn(),
      exit,
    });
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('force-exits 1 if close() hangs past the timeout', async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const log = vi.fn();

    // close() never resolves — the failsafe must fire.
    void runShutdown({ close: () => new Promise<void>(() => {}), closeDb: vi.fn(), timeoutMs: 5000, log, exit });

    expect(exit).not.toHaveBeenCalled(); // nothing yet
    await vi.advanceTimersByTimeAsync(5000);
    expect(exit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('timed out'));
  });

  it('exits exactly once even if close() resolves right after the failsafe fired', async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    let resolveClose!: () => void;
    const close = () => new Promise<void>((r) => (resolveClose = r));

    void runShutdown({ close, closeDb: vi.fn(), timeoutMs: 5000, log: vi.fn(), exit });
    await vi.advanceTimersByTimeAsync(5000); // failsafe wins → exit(1)
    resolveClose(); // the clean close finishes a moment too late
    await Promise.resolve(); // flush the continuation

    expect(exit).toHaveBeenCalledTimes(1); // the late success is a no-op — no second exit
    expect(exit).toHaveBeenCalledWith(1);
  });
});
