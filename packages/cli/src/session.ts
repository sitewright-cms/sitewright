import { loadCredentials, saveCredentials } from './credentials.js';
import { refreshTokens, type FetchLike } from './oauth.js';

/** Refresh when the access token is within this window of expiry. */
const REFRESH_SKEW_MS = 60_000;

/**
 * Returns a valid access token for the issuer, refreshing (and persisting the
 * rotation) when the stored one is at/near expiry. Throws if not logged in.
 */
export async function ensureAccessToken(issuer: string, fetchImpl?: FetchLike): Promise<string> {
  const creds = loadCredentials(issuer);
  if (!creds) {
    throw new Error(`not logged in to ${issuer} — run: sitewright login --url ${issuer}`);
  }
  if (creds.expiresAt - Date.now() > REFRESH_SKEW_MS) return creds.accessToken;
  const next = await refreshTokens({ issuer, refreshToken: creds.refreshToken }, fetchImpl);
  saveCredentials(issuer, next);
  return next.accessToken;
}
