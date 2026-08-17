/**
 * Upload a multi-file drop, one file at a time, without losing the batch to a single refusal.
 *
 * ★ Why this is not just a `for` loop with an `await`. It WAS one, and it had no per-file catch: the
 * first throw ended the batch and every remaining file was never attempted. Measured against a real
 * instance, dropping 60 files stored 30, aborted at #31 with HTTP 429, and left the author a single
 * banner reading "rate limit exceeded — slow down" — no count, no names, and a library holding half
 * their photos with nothing to say which half. The Unused Files bulk delete two files away already got
 * this right; this brings uploads in line.
 *
 * Kept free of React so the retry arithmetic can be tested without a clock or a DOM.
 */

/** How long a single pause may last, whatever the server asks for. */
export const MAX_UPLOAD_WAIT_SECONDS = 90;

/** Backoff for a refusal that carries no `retry-after` (the memory ledger's retryable 503). */
const DEFAULT_WAIT_SECONDS = 3;

/** How many times one file may be re-attempted after a TRANSIENT refusal. */
const DEFAULT_MAX_RETRIES = 3;

/**
 * Statuses worth trying again.
 *
 * `429` is the rate limiter and carries a `retry-after`. `503` is the memory ledger admitting it cannot
 * afford the work right now — it says so in its own message ("this is temporary, retry shortly"), so
 * treating it as a loss would throw away a file the server explicitly asked us to re-send. Everything
 * else (413 too large, 400 malformed, 403) is a decision, not a delay, and retrying only wastes time.
 */
const TRANSIENT = new Set([429, 503]);

export interface UploadBatchResult {
  stored: number;
  /** File names that did not land, in drop order — so the author can see WHICH, not just how many. */
  failed: string[];
}

export interface UploadBatchOptions<T> {
  /** Upload one file. Throws on failure; a thrown `status` / `retryAfterSeconds` drive the retry. */
  upload: (file: T) => Promise<unknown>;
  /** Called after each file settles, so a long drop can show where it is. */
  onProgress?: (done: number, total: number) => void;
  /** Called when a transient refusal pauses the batch, with the seconds about to be waited. */
  onPause?: (seconds: number) => void;
  /** Injected so tests need no real clock. */
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const waitFor = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The seconds to wait before re-attempting, from whatever the failure carried. */
function pauseSeconds(error: unknown): number {
  const asked = (error as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
  const seconds = typeof asked === 'number' && Number.isFinite(asked) && asked > 0 ? asked : DEFAULT_WAIT_SECONDS;
  // ★ Capped. A `retry-after` is server-controlled, and honouring an absurd one literally would freeze
  // the file manager — the author would see "uploading…" and no way to tell it from a hang.
  return Math.min(seconds, MAX_UPLOAD_WAIT_SECONDS);
}

const statusOf = (error: unknown): number | undefined => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
};

/**
 * Upload every file, retrying the transient refusals. Never throws: the result says what landed and
 * what did not, because a partial success the author cannot see is the same as a silent failure.
 */
export async function uploadBatch<T extends { name: string }>(
  files: readonly T[],
  opts: UploadBatchOptions<T>,
): Promise<UploadBatchResult> {
  const sleep = opts.sleep ?? waitFor;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  let stored = 0;
  const failed: string[] = [];

  for (const [index, file] of files.entries()) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await opts.upload(file);
        stored += 1;
        break;
      } catch (error) {
        const status = statusOf(error);
        if (status !== undefined && TRANSIENT.has(status) && attempt < maxRetries) {
          const seconds = pauseSeconds(error);
          opts.onPause?.(seconds);
          await sleep(seconds * 1000);
          continue;
        }
        failed.push(file.name);
        break;
      }
    }
    opts.onProgress?.(index + 1, files.length);
  }

  return { stored, failed };
}
