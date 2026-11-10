import { writeFile } from 'node:fs/promises';

/**
 * Writes a build's page files WHILE the next pages render, instead of each render waiting on the disk.
 *
 * - Bounded: `write` resolves once its write has STARTED, waiting only while `limit` are in flight, so
 *   the HTML held in memory stays bounded however fast pages render.
 * - Ordered per path: a second write to the same path (a page that failed after its file was queued,
 *   now replaced by its error document) lands after the first — never the other way round.
 * - A failed write fails the next `write` and `drain`, so a full disk still fails the build at once.
 */
export class PageWriter {
  private readonly inFlight = new Set<Promise<void>>();
  private readonly lastFor = new Map<string, Promise<void>>();
  private failure: unknown;
  private failed = false;

  constructor(private readonly limit: number) {}

  async write(path: string, data: string): Promise<void> {
    // After a failed write the build is lost: say so at the next page, as an awaited write always did.
    if (this.failed) throw this.failure;
    while (this.inFlight.size >= this.limit) await Promise.race(this.inFlight);
    if (this.failed) throw this.failure;
    const previous = this.lastFor.get(path);
    const task: Promise<void> = (async () => {
      if (previous) await previous;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- callers pass a path confined to the build dir
      await writeFile(path, data, 'utf8');
    })().catch((err: unknown) => {
      if (!this.failed) {
        this.failed = true;
        this.failure = err;
      }
    });
    this.lastFor.set(path, task);
    this.inFlight.add(task);
    void task.finally(() => {
      this.inFlight.delete(task);
      if (this.lastFor.get(path) === task) this.lastFor.delete(path);
    });
  }

  /** Wait for every write; throws the first failure. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all(this.inFlight);
    if (this.failed) throw this.failure;
  }
}
