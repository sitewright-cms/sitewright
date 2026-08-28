import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Project scope a preview token is bound to (so a token can't be used cross-project). */
export interface PreviewScope {
  projectId: string;
  userId: string;
}

interface PreviewEntry extends PreviewScope {
  /** The document, when this entry is held IN MEMORY. Undefined once spilled to disk. */
  html?: string;
  /** Byte cost of the document, tracked whether it lives in memory or on disk. */
  bytes: number;
  /** True when the body lives at `<spillDir>/<token>.html` instead of in `html`. */
  spilled: boolean;
  expiresAt: number;
}

/** Default token lifetime. Long enough to outlive an editing session's open preview pane: the pane
 *  holds ONE minted URL, so any refetch after expiry (a remount, a browser tab restore, a manual
 *  reload) lands on the route's opaque "Preview expired" 404 with no way back but re-rendering. The
 *  old 120s made that a routine occurrence. Still short — the token is unguessable, bound to
 *  (project, user), and capped by `maxEntries` / `maxBytes`. */
const DEFAULT_TTL_MS = 15 * 60_000;

/**
 * Byte budget for retained documents. THE cap that matters: `maxEntries` counts documents, and a
 * document is anywhere from a few KB to several MB, so a count alone bounds nothing in the unit that
 * actually runs out. Measured on a real instance: 512 entries × 1.28 MB for one ordinary page = a
 * 655 MB ceiling from this store alone, reached in a few hundred previews of ordinary editing.
 *
 * This is the same failure this codebase already fixed once at the admission layer — see
 * memory-budget.ts, "Every guard in the API counts REQUESTS, never bytes… the cost of a request
 * varies from ~0 to 200 MB." This store was the last place still counting the wrong unit.
 */
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

/** How often expired entries are dropped without a write to trigger it. */
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

export interface PreviewStoreOptions {
  /** How long a token is valid (default {@link DEFAULT_TTL_MS}). */
  ttlMs?: number;
  /** Hard cap on live tokens; oldest are evicted first (default 512). */
  maxEntries?: number;
  /** Hard cap on retained BYTES; oldest are evicted first (default {@link DEFAULT_MAX_BYTES}). */
  maxBytes?: number;
  /** Background sweep cadence; 0 disables the timer (default {@link DEFAULT_SWEEP_INTERVAL_MS}). */
  sweepIntervalMs?: number;
  /**
   * When set, documents are written here (`<dir>/<token>.html`) and the process keeps only
   * metadata — so a burst of previews costs disk, which is plentiful and reclaimed on eviction,
   * instead of heap. Unset keeps everything in memory (the historical behaviour), which is what
   * unit tests and any embedded use want.
   */
  spillDir?: string;
  /** Clock injection for tests. */
  now?: () => number;
}

/**
 * Short-lived, in-process store of rendered preview documents, keyed by an opaque
 * token. The editor POSTs a draft to `/preview` (gets a token), then loads the
 * document via `GET /preview/:token` so it can be served as `text/html` under a
 * `Content-Security-Policy: sandbox` (an opaque, isolated origin) — which a
 * `srcDoc` iframe could not achieve (it inherits the editor's CSP).
 *
 * Tokens are unguessable (randomUUID), scope-bound, and expire quickly.
 *
 * ★ WHAT THIS STORE COST BEFORE, because "short-lived" was doing more work than it could carry: it
 * held every rendered document for 15 minutes, capped only by a COUNT, and swept only when written
 * to. So an idle instance released nothing — stop editing and the last few hundred documents stayed
 * resident until something else happened to render. Measured on a live instance: the main process
 * grew ~1.1 MB per preview, linearly, 331 MB → 607 MB over 252 renders, with a full Mark-Compact
 * unable to reclaim any of it (the entries are reachable, so this was retention, not GC laziness).
 * A heap snapshot found exactly one retained document per render, held by this Map.
 *
 * The three guards below each close one part of that: a BYTE budget (a count cannot bound memory),
 * a TIMED sweep (idle must release), and optional SPILL to disk (so the resident cost is metadata
 * regardless of how large the documents are).
 */
export class PreviewStore {
  private readonly entries = new Map<string, PreviewEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly spillDir?: string;
  private readonly now: () => number;
  private readonly sweepTimer?: NodeJS.Timeout;
  /** Running sum of `entry.bytes`, so eviction never walks the map to decide. */
  private bytes = 0;
  /** Serialises spill-dir creation so concurrent puts don't race on mkdir. */
  private spillReady?: Promise<void>;

  constructor(opts: PreviewStoreOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = opts.maxEntries ?? 512;
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.spillDir = opts.spillDir;
    this.now = opts.now ?? Date.now;
    const interval = opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    if (interval > 0) {
      // unref: a cache timer must never be the reason the process stays alive.
      this.sweepTimer = setInterval(() => void this.sweep(), interval);
      this.sweepTimer.unref?.();
    }
  }

  /** Bytes currently retained (memory + spilled). Exposed for the health endpoint and tests. */
  get retainedBytes(): number {
    return this.bytes;
  }

  /** Live token count. Exposed for the health endpoint and tests. */
  get size(): number {
    return this.entries.size;
  }

  /** Stores a rendered preview for `scope`; returns its opaque token. */
  async put(html: string, scope: PreviewScope): Promise<string> {
    await this.sweep();
    const token = randomUUID();
    const bytes = Buffer.byteLength(html, 'utf8');
    const entry: PreviewEntry = { ...scope, bytes, spilled: false, expiresAt: this.now() + this.ttlMs };
    if (this.spillDir) {
      try {
        await this.ensureSpillDir();
        await writeFile(this.spillPath(token), html, 'utf8');
        entry.spilled = true;
      } catch {
        // Disk is unavailable (read-only mount, no space). Falling back to memory keeps the preview
        // WORKING — the byte cap below still bounds what that can cost.
        entry.html = html;
      }
    } else {
      entry.html = html;
    }
    this.entries.set(token, entry);
    this.bytes += bytes;
    await this.evictDown();
    return token;
  }

  /** Returns the html for a valid, unexpired, scope-matching token; else null. */
  async get(token: string, scope: PreviewScope): Promise<string | null> {
    const entry = this.entries.get(token);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      await this.drop(token, entry);
      return null;
    }
    if (entry.projectId !== scope.projectId || entry.userId !== scope.userId) {
      return null;
    }
    if (!entry.spilled) return entry.html ?? null;
    try {
      return await readFile(this.spillPath(token), 'utf8');
    } catch {
      // The file is gone (manual cleanup, a wiped data dir). Treat it as expired rather than
      // serving a 500 — the caller's "Preview expired" path is the honest answer.
      await this.drop(token, entry);
      return null;
    }
  }

  /** Stops the background sweep. Call on shutdown; also keeps test processes from lingering. */
  close(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /** Drops expired entries. Runs on write AND on the timer, so an idle instance still releases. */
  async sweep(): Promise<void> {
    const t = this.now();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= t) await this.drop(token, entry);
    }
  }

  /**
   * Evicts oldest-first until BOTH caps are satisfied (Map preserves insertion order).
   *
   * Never empties the map: a document larger than the WHOLE budget would otherwise evict itself the
   * instant it was stored, so the token the caller just minted would 404 on first use. One
   * over-budget document resident is the lesser evil, and the next put() displaces it.
   */
  private async evictDown(): Promise<void> {
    while (this.entries.size > 1 && (this.entries.size > this.maxEntries || this.bytes > this.maxBytes)) {
      const oldest = this.entries.entries().next().value;
      if (!oldest) break;
      const [token, entry] = oldest;
      await this.drop(token, entry);
    }
  }

  /** Removes one entry and its spilled file, keeping the byte ledger exact. */
  private async drop(token: string, entry: PreviewEntry): Promise<void> {
    if (!this.entries.delete(token)) return; // already gone — never double-subtract
    this.bytes -= entry.bytes;
    if (this.bytes < 0) this.bytes = 0;
    if (entry.spilled) await rm(this.spillPath(token), { force: true }).catch(() => {});
  }

  private spillPath(token: string): string {
    // `token` is always a randomUUID we minted — hex + hyphens, so it cannot traverse.
    return join(this.spillDir as string, `${token}.html`);
  }

  /**
   * Creates the spill dir on first use, CLEARING it first. Tokens live only in this process's map, so
   * anything already on disk belongs to a previous run and is unreachable by definition — without
   * this, every restart would leave its documents behind and the directory would grow without bound.
   */
  private ensureSpillDir(): Promise<void> {
    const dir = this.spillDir as string;
    this.spillReady ??= rm(dir, { recursive: true, force: true })
      .catch(() => {}) // a missing dir is the normal first-boot case
      .then(() => mkdir(dir, { recursive: true }))
      .then(() => undefined);
    return this.spillReady;
  }
}
