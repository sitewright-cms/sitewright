// A per-project cached snapshot of `website.jsonDataUrl`, so `{{ website.json_data }}` renders in the
// PREVIEW and not only after a publish.
//
// ★ Why a cache and not just "fetch in preview too". The single-page preview renders ON EVERY KEYSTROKE,
// so a bare fetch there would be a network round trip per character — and worse, an unreachable URL
// costs the full 8s timeout EVERY time, which would freeze the editor rather than merely slow it. That
// is precisely why the preview used to render `json_data` empty. Caching (including caching FAILURES,
// which is the half that actually protects the editor) is what makes previewing the data affordable.
//
// The shape of the guarantee:
//   - `snapshot()`  — never touches the network. Serves what it has and revalidates in the background.
//                     Used by the per-keystroke single-page preview.
//   - `resolve()`   — awaits a cold fetch, coalescing concurrent callers onto one request. Used by the
//                     whole-site preview build (which already blocks) and to WARM the cache on save.
//   - PUBLISH does not come here at all. A published site must never ship a stale snapshot, and a bad
//     URL must fail the publish loudly (409) rather than resolve to whatever preview last saw.
import { fetchJsonData, JsonDataError, type FetchJsonDataOptions } from '../publish/json-data.js';

/** How long a SUCCESSFUL snapshot serves before it is revalidated. */
const OK_TTL_MS = 60_000;
/**
 * How long a FAILED fetch is remembered. Shorter than a success (a fixed URL should start working
 * again promptly) but long enough that a broken URL cannot mean one 8s timeout per render — at this
 * TTL a persistently-dead source costs at most two attempts a minute, whoever is typing.
 */
const ERR_TTL_MS = 30_000;
/**
 * Total cached payload across all projects. A single source may be up to 2 MiB (`fetchJsonData`'s own
 * cap), so an unbounded map on a many-tenant instance is a real leak — this is the hard ceiling, spent
 * least-recently-used-first. Measured in bytes rather than entries because the entry SIZE is the thing
 * that varies by three orders of magnitude.
 */
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

/** What the cache knows about one project's JSON source right now. */
export interface JsonDataSnapshot {
  /** The URL this snapshot came from. A settings change to a different URL invalidates it. */
  url: string;
  /** Epoch ms of the attempt (successful or not). */
  fetchedAt: number;
  /** Serialized size of `data`, and the cache's accounting unit. 0 on a failure. */
  bytes: number;
  /** The parsed payload — present only on success. */
  data?: unknown;
  /** Why the fetch failed, verbatim from `JsonDataError` — present only on failure. */
  error?: string;
}

export interface JsonDataCacheOptions {
  /** Injectable clock (tests). */
  now?: () => number;
  /** Injectable fetcher (tests). Defaults to the real, SSRF-guarded `fetchJsonData`. */
  fetchImpl?: (url: string, options?: FetchJsonDataOptions) => Promise<unknown>;
  okTtlMs?: number;
  errTtlMs?: number;
  maxTotalBytes?: number;
}

/**
 * Bounded, TTL'd, failure-caching snapshot store keyed by project id.
 *
 * Not persisted: it is a cache of somebody else's data, and a cold start simply refills it. The first
 * render after a restart therefore sees no data — which is why settings SAVE warms it, so in practice
 * the warm path is the only one an author meets.
 */
export class JsonDataCache {
  private readonly entries = new Map<string, JsonDataSnapshot>();
  private readonly inflight = new Map<string, Promise<JsonDataSnapshot>>();
  private readonly now: () => number;
  private readonly fetchImpl: (url: string, options?: FetchJsonDataOptions) => Promise<unknown>;
  private readonly okTtlMs: number;
  private readonly errTtlMs: number;
  private readonly maxTotalBytes: number;

  constructor(options: JsonDataCacheOptions = {}) {
    this.now = options.now ?? Date.now;
    this.fetchImpl = options.fetchImpl ?? fetchJsonData;
    this.okTtlMs = options.okTtlMs ?? OK_TTL_MS;
    this.errTtlMs = options.errTtlMs ?? ERR_TTL_MS;
    this.maxTotalBytes = options.maxTotalBytes ?? MAX_TOTAL_BYTES;
  }

  /** Whether `entry` is still within its TTL (successes and failures age differently). */
  private fresh(entry: JsonDataSnapshot): boolean {
    const ttl = entry.error === undefined ? this.okTtlMs : this.errTtlMs;
    return this.now() - entry.fetchedAt < ttl;
  }

  /**
   * The snapshot to render with, WITHOUT ever awaiting the network.
   *
   * A stale entry is served as-is and revalidated in the background (stale-while-revalidate): slightly
   * old data is a far better answer for a preview than a stall, and the next render gets the new value.
   * A cold miss returns `undefined` and starts the warm, so the FIRST render after a restart shows no
   * data and every render after it does.
   *
   * Pass the project's current `website.jsonDataUrl`; `undefined` (no source configured) clears any
   * entry and returns nothing, so removing the URL takes effect at once rather than at the next TTL.
   */
  snapshot(projectId: string, url: string | undefined): JsonDataSnapshot | undefined {
    if (!url) {
      this.entries.delete(projectId);
      return undefined;
    }
    const entry = this.entries.get(projectId);
    if (entry && entry.url === url) {
      // Touch for LRU: a project being actively previewed should not be the one evicted.
      this.entries.delete(projectId);
      this.entries.set(projectId, entry);
      if (!this.fresh(entry)) void this.resolve(projectId, url).catch(() => {});
      return entry;
    }
    // Cold, or the author changed the URL — the old payload belongs to a different source.
    void this.resolve(projectId, url).catch(() => {});
    return undefined;
  }

  /**
   * The snapshot, fetching and awaiting if there is nothing fresh. Concurrent callers for the same
   * project share ONE request — the whole-site preview build and a settings save can easily land
   * together, and two identical outbound fetches would be pure waste.
   *
   * Never rejects: a failure is a snapshot carrying `error`. Callers are preview surfaces, and a
   * preview that 500s because a tenant's JSON host is down is the wrong failure mode — publish is
   * where a bad source is supposed to stop the world.
   */
  async resolve(projectId: string, url: string | undefined): Promise<JsonDataSnapshot | undefined> {
    if (!url) {
      this.entries.delete(projectId);
      return undefined;
    }
    const entry = this.entries.get(projectId);
    if (entry && entry.url === url && this.fresh(entry)) return entry;

    const pending = this.inflight.get(projectId);
    // Only join an in-flight request for the SAME url; one for the previous url would answer the
    // wrong question.
    if (pending) {
      const joined = await pending;
      if (joined.url === url) return joined;
    }

    const attempt = this.fetchSnapshot(url);
    this.inflight.set(projectId, attempt);
    try {
      const next = await attempt;
      this.store(projectId, next);
      return next;
    } finally {
      // Only clear if it is still OURS — a later call for a changed url may have replaced it.
      if (this.inflight.get(projectId) === attempt) this.inflight.delete(projectId);
    }
  }

  /** One fetch attempt, reduced to a snapshot. `JsonDataError`'s message is already author-facing. */
  private async fetchSnapshot(url: string): Promise<JsonDataSnapshot> {
    const fetchedAt = this.now();
    try {
      const data = await this.fetchImpl(url);
      // Sized once here, never per render. `undefined` cannot be stringified; treat it as no payload.
      const serialized = data === undefined ? '' : JSON.stringify(data);
      return { url, fetchedAt, bytes: Buffer.byteLength(serialized ?? ''), data };
    } catch (err) {
      return {
        url,
        fetchedAt,
        bytes: 0,
        error: err instanceof JsonDataError ? err.message : 'JSON data fetch failed',
      };
    }
  }

  /** Insert and spend the byte budget, evicting least-recently-used entries until it fits. */
  private store(projectId: string, entry: JsonDataSnapshot): void {
    this.entries.delete(projectId);
    this.entries.set(projectId, entry);
    let total = 0;
    for (const e of this.entries.values()) total += e.bytes;
    // Map iterates in insertion order, so the front is the least recently touched. Never evict the
    // entry just stored — on an instance whose budget one project can exhaust, evicting it
    // immediately would mean it is re-fetched on every single render.
    for (const [key, e] of this.entries) {
      if (total <= this.maxTotalBytes) break;
      if (key === projectId) continue;
      this.entries.delete(key);
      total -= e.bytes;
    }
  }

  /** Forget a project — call wherever the other per-project in-memory maps are cleared. */
  delete(projectId: string): void {
    this.entries.delete(projectId);
    this.inflight.delete(projectId);
  }

  /** Cached payload total, for tests and diagnostics. */
  get totalBytes(): number {
    let total = 0;
    for (const e of this.entries.values()) total += e.bytes;
    return total;
  }
}
