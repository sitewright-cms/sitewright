import { randomUUID } from 'node:crypto';

/** What a ticket is allowed to do — captured when it is MINTED, never re-derived at redeem time. */
export interface UploadTicketScope {
  projectId: string;
  /** The slug the asset is stored under (media paths are slug-keyed). */
  projectSlug: string;
  /** Who minted it, for the audit trail and so a redemption writes as a real user. */
  userId: string;
  /** The virtual media folder the upload lands in (already validated at mint time). */
  folder: string;
  /**
   * When set, redeeming REPLACES this existing asset's bytes instead of creating a new one — the
   * large-file lane for `replace_media`, mirroring how `create_media_upload` is the large-file lane
   * for `upload_media`. Pinned at mint time like every other dimension, so the ticket holder chooses
   * the bytes and nothing else: it cannot be re-pointed at a different asset.
   */
  replaceAssetId?: string;
  /**
   * The alt text the stored asset is born with. Pinned at mint time for the same reason as the folder:
   * the agent describes the file in the authenticated call, and the holder only supplies bytes. Without
   * it every photo uploaded this way landed with no alt, and every `{{#sw-folder}}` gallery built from
   * them shipped `alt=""`.
   */
  alt?: string;
  /**
   * What the file IS, when it turns out to be a font: a raw PUT carries only bytes and a filename, so
   * without this a `Inter-Bold.woff2` was recorded as family "Inter-Bold" at weight 400. Validated at
   * mint (the same bounds as the bearer upload route's query), applied only if the bytes are a font.
   */
  font?: UploadTicketFont;
}

/** Font metadata a ticket may pin (each field optional — an absent one keeps the upload's default). */
export interface UploadTicketFont {
  family?: string;
  weight?: number;
  style?: 'normal' | 'italic';
  fallback?: 'serif' | 'sans-serif' | 'monospace' | 'cursive';
}

interface UploadTicket extends UploadTicketScope {
  expiresAt: number;
}

/**
 * Ticket lifetime. Long enough for an agent to mint, run a curl and retry once on a slow link; short
 * enough that a ticket which leaks into a shell history or a log is worthless by the time anyone reads
 * it. Not user-configurable — a longer window buys nothing, because the agent mints on demand.
 */
const DEFAULT_TTL_MS = 10 * 60_000;

/**
 * Hard cap on live tickets across EVERY project. 1024 rather than the original 256 because tickets now
 * mint in batches of up to 50: at 256, five batches from one project evicted every other tenant's
 * freshly minted ticket. The mint route budgets each project separately (see `liveFor`), so reaching
 * this takes several projects saturating at once. A ticket is a few hundred bytes; 1024 is nothing.
 */
const DEFAULT_MAX_ENTRIES = 1024;

export interface UploadTicketStoreOptions {
  ttlMs?: number;
  /** Hard cap on live tickets; oldest evicted first (default 1024). */
  maxEntries?: number;
  /** Clock injection for tests. */
  now?: () => number;
}

/**
 * Short-lived, single-use tickets that let an AGENT put a LOCAL FILE into a project's media library.
 *
 * ★ WHY THIS EXISTS AT ALL. An MCP agent has files on its own disk and no way to hand them over:
 * `import_image` takes a PUBLIC url (the server fetches it), and the authenticated multipart route
 * needs the bearer token, which the MCP client holds and the model never sees. The remaining option
 * — base64 in a tool argument — fails on arithmetic rather than on principle: the MODEL has to emit
 * those bytes, and a 1MB image is ~370k tokens. A ticket moves the bytes over a channel the model is
 * not part of, so file size stops being a context problem.
 *
 * ★ THE TICKET IS THE CREDENTIAL, so the redeem route takes no session. That is only safe because
 * every dimension is pinned when it is minted — by a caller that HAS already authenticated and passed
 * the `content:write` capability gate:
 *   · unguessable (randomUUID) and never derived from anything the holder controls
 *   · SINGLE-USE — redeeming consumes it, so a replay lands on a 404 like any other unknown token
 *   · short-lived (see DEFAULT_TTL_MS)
 *   · bound to ONE project, ONE user and ONE folder: the holder chooses the bytes, nothing else. It
 *     cannot be pointed at a different project, and it cannot outlive its window.
 * The redeem route caps the body size separately — a ticket is permission to upload, not permission
 * to fill the disk.
 *
 * In-process by design, exactly like {@link PreviewStore}: single-container model, tiny working set,
 * and a restart invalidating tickets is correct rather than a limitation.
 */
export class UploadTicketStore {
  private readonly tickets = new Map<string, UploadTicket>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(opts: UploadTicketStoreOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = opts.now ?? Date.now;
  }

  /** How long a freshly minted ticket lasts, in whole seconds (for telling the agent). */
  get ttlSeconds(): number {
    return Math.round(this.ttlMs / 1000);
  }

  /** Mint a ticket for `scope`; returns its opaque token. */
  put(scope: UploadTicketScope): string {
    this.sweep();
    const token = randomUUID();
    this.tickets.set(token, { ...scope, expiresAt: this.now() + this.ttlMs });
    // Map preserves insertion order, so the first key is the oldest.
    while (this.tickets.size > this.maxEntries) {
      const oldest = this.tickets.keys().next().value;
      if (oldest === undefined) break;
      this.tickets.delete(oldest);
    }
    return token;
  }

  /**
   * CONSUME a ticket: returns its scope and deletes it, so the same token can never be redeemed twice.
   * `undefined` for an unknown, expired or already-used token — the caller must not distinguish those
   * in what it tells the client, or the response becomes an oracle for which tokens ever existed.
   */
  take(token: string): UploadTicketScope | undefined {
    this.sweep();
    const found = this.tickets.get(token);
    if (!found) return undefined;
    this.tickets.delete(token);
    if (found.expiresAt <= this.now()) return undefined;
    return {
      projectId: found.projectId,
      projectSlug: found.projectSlug,
      userId: found.userId,
      folder: found.folder,
      ...(found.replaceAssetId ? { replaceAssetId: found.replaceAssetId } : {}),
      ...(found.alt ? { alt: found.alt } : {}),
      ...(found.font ? { font: found.font } : {}),
    };
  }

  /** Live ticket count (tests + the maintenance sweep). */
  get size(): number {
    this.sweep();
    return this.tickets.size;
  }

  /**
   * Live (unexpired, unredeemed) tickets minted for ONE project — what the mint route budgets a batch
   * against, so a single tenant cannot fill the shared store. A linear scan: the store is bounded by
   * DEFAULT_MAX_ENTRIES, and this runs once per mint, not per ticket.
   */
  liveFor(projectId: string): number {
    this.sweep();
    let n = 0;
    for (const ticket of this.tickets.values()) if (ticket.projectId === projectId) n += 1;
    return n;
  }

  private sweep(): void {
    const t = this.now();
    for (const [token, entry] of this.tickets) {
      if (entry.expiresAt <= t) this.tickets.delete(token);
    }
  }
}
