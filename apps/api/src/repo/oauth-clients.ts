import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
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
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]', '::1'];

/**
 * A redirect URI is registrable only if it is `https`, or `http` on a loopback
 * host (RFC 8252 native apps). No fragments; length-capped. Registered URIs are
 * matched EXACTLY at the authorization endpoint — never by prefix — so this is the
 * open-redirect boundary.
 */
export function isAcceptableRedirectUri(uri: string): boolean {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > MAX_URI_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname);
}

/** Store for dynamically-registered OAuth clients (RFC 7591). */
export class OAuthClientRepository {
  constructor(private readonly db: Database) {}

  async register(
    input: { name: string; redirectUris: string[] },
    now: Date = new Date(),
  ): Promise<OAuthClient> {
    const name = (input.name ?? '').trim();
    if (!name || name.length > 200) throw new OAuthClientError('client_name is required (1–200 chars)');
    const uris = input.redirectUris;
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
      throw new OAuthClientError(`redirect_uris must have 1–${MAX_REDIRECT_URIS} entries`);
    }
    for (const uri of uris) {
      if (!isAcceptableRedirectUri(uri)) {
        throw new OAuthClientError(`invalid redirect_uri: ${typeof uri === 'string' ? uri : '<non-string>'}`);
      }
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
