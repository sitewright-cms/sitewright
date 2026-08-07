import { randomUUID } from 'node:crypto';

/** Project scope a preview token is bound to (so a token can't be used cross-project). */
export interface PreviewScope {
  projectId: string;
  userId: string;
}

interface PreviewEntry extends PreviewScope {
  html: string;
  expiresAt: number;
}

/** Default token lifetime. Long enough to outlive an editing session's open preview pane: the pane
 *  holds ONE minted URL, so any refetch after expiry (a remount, a browser tab restore, a manual
 *  reload) lands on the route's opaque "Preview expired" 404 with no way back but re-rendering. The
 *  old 120s made that a routine occurrence. Still short — the token is unguessable, bound to
 *  (project, user), and capped by `maxEntries`. */
const DEFAULT_TTL_MS = 15 * 60_000;

export interface PreviewStoreOptions {
  /** How long a token is valid (default {@link DEFAULT_TTL_MS}). */
  ttlMs?: number;
  /** Hard cap on live tokens; oldest are evicted first (default 512). */
  maxEntries?: number;
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
 * In-process by design (single-container model); tokens are unguessable
 * (randomUUID), scope-bound, and expire quickly, so the store stays tiny.
 */
export class PreviewStore {
  private readonly entries = new Map<string, PreviewEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(opts: PreviewStoreOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = opts.maxEntries ?? 512;
    this.now = opts.now ?? Date.now;
  }

  /** Stores a rendered preview for `scope`; returns its opaque token. */
  put(html: string, scope: PreviewScope): string {
    this.sweep();
    const token = randomUUID();
    this.entries.set(token, { html, ...scope, expiresAt: this.now() + this.ttlMs });
    // Cap: Map preserves insertion order, so the first key is the oldest.
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return token;
  }

  /** Returns the html for a valid, unexpired, scope-matching token; else null. */
  get(token: string, scope: PreviewScope): string | null {
    const entry = this.entries.get(token);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(token);
      return null;
    }
    if (entry.projectId !== scope.projectId || entry.userId !== scope.userId) {
      return null;
    }
    return entry.html;
  }

  /** Drops expired entries (called opportunistically on writes). */
  private sweep(): void {
    const t = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= t) this.entries.delete(key);
    }
  }
}
