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

/**
 * Forces a refresh regardless of cached expiry, persisting the rotation. Returns
 * the new access token, or null if not logged in / the refresh fails — used as
 * the bridge's on-401 hook so a long MCP session survives token expiry.
 */
export async function forceRefreshAccessToken(issuer: string, fetchImpl?: FetchLike): Promise<string | null> {
  const creds = loadCredentials(issuer);
  if (!creds) return null;
  try {
    const next = await refreshTokens({ issuer, refreshToken: creds.refreshToken }, fetchImpl);
    saveCredentials(issuer, next);
    return next.accessToken;
  } catch {
    return null; // refresh expired/revoked → surface the original 401 to the caller
  }
}
