import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, lt, notExists, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { oauthClients, oauthAuthCodes, oauthDeviceCodes, oauthRefreshTokens } from '../db/schema.js';

/** A client-registration validation failure (maps to `invalid_client_metadata`). */
export class OAuthClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthClientError';
  }
}

export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
}

const MAX_REDIRECT_URIS = 5;
const MAX_URI_LENGTH = 2048;
/** Hard cap on total registered clients (open DCR + rotating IPs → disk-exhaustion guard). */
const MAX_TOTAL_CLIENTS = 10_000;
/**
 * How stale the stored `last_used_at` must be before {@link OAuthClientRepository.touch} writes.
 * The stamp only has to order registrations against each other for eviction, so hour granularity is
 * plenty — and it keeps a busy client's hourly token refreshes from being an hourly row write.
 */
export const CLIENT_TOUCH_INTERVAL_MS = 60 * 60 * 1000;
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]', '::1'];

/** `http` on a loopback host (RFC 8252 native apps) — the single source of truth, shared
 * with the CLI client's redirect validator. */
export function isLoopbackHttp(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  return url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname);
}

/**
 * A redirect URI is registrable only if it is `https` (with a real, dotted host),
 * or loopback `http`. No fragments, no userinfo, length-capped. Registered URIs
 * are matched EXACTLY at the authorization endpoint — never by prefix — so this is
 * the open-redirect boundary.
 */
export function isAcceptableRedirectUri(uri: string): boolean {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > MAX_URI_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false; // RFC 7591: no fragment/userinfo
  if (url.protocol === 'https:') return url.hostname.includes('.'); // reject single-label hosts
  return isLoopbackHttp(uri);
}

/**
 * When a registration was last used, falling back to its registration time. NULL means "never
 * presented since it was registered" — read as `created_at` so a client that is mid-flow (registered
 * seconds ago, consent page not yet reached) is never ranked as the most abandoned row in the table.
 */
export const effectiveLastUse: SQL<Date> = sql`coalesce(${oauthClients.lastUsedAt}, ${oauthClients.createdAt})`;

/**
 * True when NOTHING points at the registration — no refresh token, no authorization code, no device
 * code. The boundary for both removal paths (eviction at the cap, and the retention sweep): a row
 * something still references is mid-flow or mid-session, and dropping it would break a live client.
 */
export function clientUnreferenced(db: Database): SQL {
  const none = (table: typeof oauthRefreshTokens | typeof oauthAuthCodes | typeof oauthDeviceCodes): SQL =>
    notExists(db.select({ one: sql`1` }).from(table).where(eq(table.clientId, oauthClients.id)));
  return and(none(oauthRefreshTokens), none(oauthAuthCodes), none(oauthDeviceCodes)) as SQL;
}

/** Store for dynamically-registered OAuth clients (RFC 7591). */
export class OAuthClientRepository {
  private readonly maxTotalClients: number;

  constructor(
    private readonly db: Database,
    opts: { maxTotalClients?: number } = {},
  ) {
    this.maxTotalClients = opts.maxTotalClients ?? MAX_TOTAL_CLIENTS;
  }

  async register(
    input: { name: string; redirectUris: unknown[] },
    now: Date = new Date(),
  ): Promise<OAuthClient> {
    const name = (input.name ?? '').trim();
    if (!name || name.length > 200) throw new OAuthClientError('client_name is required (1–200 chars)');
    if (!Array.isArray(input.redirectUris) || input.redirectUris.length === 0 || input.redirectUris.length > MAX_REDIRECT_URIS) {
      throw new OAuthClientError(`redirect_uris must have 1–${MAX_REDIRECT_URIS} entries`);
    }
    // Validate each element (narrowing unknown → string), building the stored list.
    const uris: string[] = [];
    for (const uri of input.redirectUris) {
      if (typeof uri !== 'string' || !isAcceptableRedirectUri(uri)) {
        throw new OAuthClientError(`invalid redirect_uri: ${typeof uri === 'string' ? uri : '<non-string>'}`);
      }
      uris.push(uri);
    }
    const counted = await this.db.select({ total: sql<number>`count(*)` }).from(oauthClients);
    const over = (counted[0]?.total ?? 0) - this.maxTotalClients + 1;
    if (over > 0 && (await this.evictLeastRecentlyUsed(over)) < over) {
      // Nothing left that is safe to drop: every row at the cap is referenced by a live grant.
      throw new OAuthClientError('client registration is temporarily unavailable');
    }
    const id = `swcid_${randomUUID().replace(/-/g, '')}`;
    await this.db.insert(oauthClients).values({ id, name, redirectUris: uris, createdAt: now });
    return { id, name, redirectUris: uris };
  }

  async get(clientId: string): Promise<OAuthClient | null> {
    const [row] = await this.db.select().from(oauthClients).where(eq(oauthClients.id, clientId));
    if (!row) return null;
    return { id: row.id, name: row.name, redirectUris: row.redirectUris };
  }

  /**
   * Records that `clientId` was just presented at the authorization or token endpoint.
   *
   * ★ WHY A REGISTRATION NEEDS A LAST-USE STAMP AT ALL. Removal used to be keyed on `created_at`,
   * and the only thing that could keep a registration alive was a live grant row — but an agent's
   * refresh chain is capped at an absolute 8h, so between sessions nothing references it. A client
   * used every single day looked exactly like one abandoned the day it registered, and got deleted
   * on a fixed fuse. The resulting dead-end is invisible to the client (see the authorization
   * endpoint's recovery page), so the only real fix is to not create the condition.
   *
   * Written at most once per {@link CLIENT_TOUCH_INTERVAL_MS} via a guarded UPDATE — one statement,
   * so there is no read-then-write race between concurrent authorizations. Unknown id = no rows
   * matched = silent no-op, which is what the authorization endpoint wants (it has already decided
   * to render its error page; a touch must never turn that into a 500).
   */
  async touch(clientId: string, now: Date = new Date()): Promise<void> {
    const staleBefore = new Date(now.getTime() - CLIENT_TOUCH_INTERVAL_MS);
    await this.db
      .update(oauthClients)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(oauthClients.id, clientId),
          or(isNull(oauthClients.lastUsedAt), lt(oauthClients.lastUsedAt, staleBefore)),
        ),
      );
  }

  /**
   * Frees up to `count` slots by deleting the least-recently-used UNREFERENCED registrations, and
   * returns how many it actually removed (fewer than asked = the rest are all referenced).
   *
   * ★ WHY EVICTION RATHER THAN A TIME FUSE. `MAX_TOTAL_CLIENTS` is the guard that matters — a
   * registration is ~150–300 bytes, so the ceiling is a couple of MB of disk, and open DCR is what
   * makes a ceiling necessary at all. A hard ceiling with no eviction path is just a deadline, so
   * #913 added a time-based reap to drain it; but a fuse cannot tell an abandoned registration from
   * an idle one, so it deleted live clients to defend against a hoard that, measured on a real
   * instance, was ONE row. Evicting on demand inverts that: pressure (not the calendar) decides, and
   * the rows that have gone longest without being used go first — which is exactly the spam
   * registrations, since they are never used at all.
   */
  private async evictLeastRecentlyUsed(count: number): Promise<number> {
    const victims = await this.db
      .select({ id: oauthClients.id })
      .from(oauthClients)
      .where(clientUnreferenced(this.db))
      .orderBy(effectiveLastUse)
      .limit(count);
    if (victims.length === 0) return 0;
    await this.db.delete(oauthClients).where(
      inArray(
        oauthClients.id,
        victims.map((v) => v.id),
      ),
    );
    return victims.length;
  }
}
