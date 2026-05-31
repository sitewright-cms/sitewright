import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { oauthClients } from '../db/schema.js';

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

/** Store for dynamically-registered OAuth clients (RFC 7591). */
export class OAuthClientRepository {
  constructor(private readonly db: Database) {}

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
    if ((counted[0]?.total ?? 0) >= MAX_TOTAL_CLIENTS) {
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
}
