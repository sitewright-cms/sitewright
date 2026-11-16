import { GateFullError, TenantShareError } from './fair-gate.js';

/**
 * The instance's slots for whole-site builds.
 *
 * - **An explicit build** (publish, deploy, a site zip) does not wait behind a queue of draft previews:
 *   while both kinds wait, freed slots ALTERNATE between them, so an explicit build waits for at most one
 *   preview build — and a preview can never be starved by a stream of explicit builds either.
 *   MEASURED: with ONE build slot (a 1.5 GiB instance building on a worker thread) and six agents' edits
 *   queuing previews, the median publish waited 145 s behind them; put first in line, 2.3 s.
 * - **Fair between projects.** Explicit builds take turns by project (round-robin), and one project may
 *   have at most `maxQueuedPerProject` of them waiting — past that it gets the gates' retryable 503
 *   (TenantShareError). A site zip needs only read access, so without this one member could queue builds
 *   at the head of the line for everyone. Previews need no scheduler of their own: a project has at most
 *   one preview build queued (app.ts coalesces them), so first-come first-served is round-robin.
 * - A build WAITS rather than being refused; `maxQueued` is only a backstop, past which the caller gets a
 *   retryable 503 (GateFullError).
 */
export type SiteBuildKind = 'publish' | 'preview';

export class SiteBuildSlots {
  private running = 0;
  /** Explicit builds waiting, per project, in the order the projects first queued (round-robin). */
  private readonly explicit = new Map<string, Array<() => void>>();
  private explicitWaiting = 0;
  private readonly previews: Array<() => void> = [];
  /** Which lane the last handed-over slot went to, so the two alternate while both wait. */
  private lastWasExplicit = false;

  constructor(
    private readonly limit: number,
    private readonly maxQueued = 1024,
    private readonly maxQueuedPerProject = 4,
  ) {}

  /** Builds running / waiting right now. Test seam. */
  get active(): number {
    return this.running;
  }
  get waiting(): number {
    return this.explicitWaiting + this.previews.length;
  }

  async run<T>(kind: SiteBuildKind, project: string, fn: () => Promise<T>): Promise<T> {
    if (this.running < Math.max(1, this.limit)) {
      this.running += 1;
    } else {
      if (this.waiting >= this.maxQueued) throw new GateFullError('site builds');
      if (kind === 'publish' && (this.explicit.get(project)?.length ?? 0) >= this.maxQueuedPerProject) {
        throw new TenantShareError('site builds');
      }
      // The slot is HANDED to us by release(): `running` stays counted across the hand-off, so a newcomer
      // can never slip in between and run one over the limit.
      await new Promise<void>((resolve) => {
        if (kind === 'preview') {
          this.previews.push(resolve);
          return;
        }
        const queue = this.explicit.get(project);
        if (queue) queue.push(resolve);
        else this.explicit.set(project, [resolve]);
        this.explicitWaiting += 1;
      });
    }
    try {
      return await fn();
    } finally {
      const next = this.next();
      if (next) next();
      else this.running -= 1;
    }
  }

  /** The waiter the freed slot goes to: alternating lanes while both wait, round-robin among projects. */
  private next(): (() => void) | undefined {
    const explicitFirst = this.explicitWaiting > 0 && (this.previews.length === 0 || !this.lastWasExplicit);
    if (explicitFirst) {
      const [project, queue] = this.explicit.entries().next().value as [string, Array<() => void>];
      const waiter = queue.shift()!;
      this.explicitWaiting -= 1;
      // To the back of the rotation: the next explicit build is another project's, if one waits.
      this.explicit.delete(project);
      if (queue.length > 0) this.explicit.set(project, queue);
      this.lastWasExplicit = true;
      return waiter;
    }
    const preview = this.previews.shift();
    if (preview) this.lastWasExplicit = false;
    return preview;
  }
}
