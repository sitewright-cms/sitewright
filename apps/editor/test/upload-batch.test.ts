import { describe, it, expect, vi } from 'vitest';
import { uploadBatch, MAX_UPLOAD_WAIT_SECONDS } from '../src/lib/upload-batch';

/**
 * Uploading a multi-file drop.
 *
 * ★ The loop this replaces had no per-file catch: the first refusal threw and every remaining file was
 * NEVER ATTEMPTED. Measured against a real instance, dropping 60 files stored 30, aborted at #31 with
 * HTTP 429, and left the author one banner reading "rate limit exceeded — slow down" — no count, no
 * names, and a library holding half their photos with nothing to say which half.
 *
 * Two properties matter and neither is about speed: every file gets its own attempt, and a TRANSIENT
 * refusal (429 with a `retry-after`, or the memory ledger's retryable 503) is waited out rather than
 * counted as a loss.
 */

const file = (name: string) => ({ name });
const err = (status: number, retryAfterSeconds?: number) =>
  Object.assign(new Error(`HTTP ${status}`), { status, retryAfterSeconds });

/** A sleep that records what it was asked to wait, and returns immediately. */
function fakeSleep() {
  const waited: number[] = [];
  return { waited, sleep: async (ms: number) => void waited.push(ms) };
}

describe('uploadBatch', () => {
  it('uploads every file and reports the count', async () => {
    const upload = vi.fn().mockResolvedValue({});
    const res = await uploadBatch([file('a.png'), file('b.png')], { upload });
    expect(res).toEqual({ stored: 2, failed: [] });
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('★ keeps going after a failure, and names what did not land', async () => {
    // The whole point: one bad file must not discard the rest of the drop.
    const upload = vi.fn(async (f: { name: string }) => {
      if (f.name === 'bad.png') throw err(400);
      return {};
    });
    const res = await uploadBatch([file('a.png'), file('bad.png'), file('c.png')], { upload });
    expect(res.stored).toBe(2);
    expect(res.failed).toEqual(['bad.png']);
    expect(upload).toHaveBeenCalledTimes(3); // c.png was still attempted
  });

  it('★ waits out a 429 for exactly as long as the server asked, then retries THAT file', async () => {
    const { waited, sleep } = fakeSleep();
    let attempts = 0;
    const upload = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw err(429, 12);
      return {};
    });
    const res = await uploadBatch([file('a.png')], { upload, sleep });
    expect(res).toEqual({ stored: 1, failed: [] });
    expect(waited).toEqual([12_000]);
  });

  it('retries the memory ledger’s 503 too — it is explicitly transient', async () => {
    const { waited, sleep } = fakeSleep();
    let attempts = 0;
    const upload = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw err(503);
      return {};
    });
    const res = await uploadBatch([file('a.png')], { upload, sleep });
    expect(res.stored).toBe(1);
    expect(waited[0], 'a 503 carries no retry-after, so back off briefly').toBeGreaterThan(0);
  });

  it('does NOT retry a permanent refusal — a 413 is not going to get better', async () => {
    const { waited, sleep } = fakeSleep();
    const upload = vi.fn(async () => {
      throw err(413);
    });
    const res = await uploadBatch([file('huge.mov')], { upload, sleep });
    expect(res.failed).toEqual(['huge.mov']);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(waited).toEqual([]);
  });

  it('★ gives up on a file that keeps being refused, rather than looping forever', async () => {
    const { sleep } = fakeSleep();
    const upload = vi.fn(async () => {
      throw err(429, 1);
    });
    const res = await uploadBatch([file('a.png')], { upload, sleep, maxRetries: 2 });
    expect(res.failed).toEqual(['a.png']);
    expect(upload).toHaveBeenCalledTimes(3); // the first try plus two retries
  });

  it('★ caps a single wait, so an absurd retry-after cannot hang the editor', async () => {
    const { waited, sleep } = fakeSleep();
    let attempts = 0;
    const upload = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw err(429, 86_400); // "come back tomorrow"
      return {};
    });
    await uploadBatch([file('a.png')], { upload, sleep });
    expect(waited).toEqual([MAX_UPLOAD_WAIT_SECONDS * 1000]);
  });

  it('reports progress as files settle, and says when it is waiting', async () => {
    const { sleep } = fakeSleep();
    const progress: Array<[number, number]> = [];
    const paused: number[] = [];
    let attempts = 0;
    const upload = vi.fn(async () => {
      attempts += 1;
      if (attempts === 2) throw err(429, 5);
      return {};
    });
    await uploadBatch([file('a.png'), file('b.png')], {
      upload,
      sleep,
      onProgress: (done, total) => progress.push([done, total]),
      onPause: (seconds) => paused.push(seconds),
    });
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(paused, 'the author should be told the batch is waiting, not that it froze').toEqual([5]);
  });

  it('an empty drop is a no-op', async () => {
    const upload = vi.fn();
    expect(await uploadBatch([], { upload })).toEqual({ stored: 0, failed: [] });
    expect(upload).not.toHaveBeenCalled();
  });
});
