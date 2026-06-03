import type { FetchLike } from './client.js';
import type { StoredCredentials } from './credentials.js';

/** The built-in public client id for the bridge (loopback/device, PKCE, no secret) — see oauth-routes.ts. */
export const CLI_CLIENT_ID = 'sitewright-cli';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/** Scopes requested by default — enough to read, edit, and publish a project. */
export const DEFAULT_SCOPE = 'content:read content:write publish';

/** A login failure (the device flow timed out, was denied, or the server rejected it). */
export class OAuthLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthLoginError';
  }
}

interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  interval?: number;
  expires_in: number;
}

/** POST an `application/x-www-form-urlencoded` body and parse the JSON response (or throw with its error). */
async function postForm(
  fetchImpl: FetchLike,
  url: string,
  fields: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  return { ok: res.ok, status: res.status, body };
}

const errorOf = (body: Record<string, unknown>): string =>
  typeof body.error === 'string' ? body.error : 'unknown_error';

function toCredentials(body: Record<string, unknown>, now: () => number): StoredCredentials {
  // Guard a malformed success body (missing fields): fail loudly here rather than persisting the
  // string "undefined" as a token and surfacing it later as a confusing 401 loop.
  const accessToken = body.access_token;
  const refreshToken = body.refresh_token;
  if (typeof accessToken !== 'string' || !accessToken || typeof refreshToken !== 'string' || !refreshToken) {
    throw new OAuthLoginError('server returned no access/refresh token');
  }
  return {
    accessToken,
    refreshToken,
    scope: typeof body.scope === 'string' ? body.scope : '',
    obtainedAt: new Date(now()).toISOString(),
  };
}

export interface DeviceLoginOptions {
  url: string;
  scope?: string;
  fetchImpl?: FetchLike;
  /** Sleep between polls (injected in tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Clock (injected in tests). */
  now?: () => number;
  /** Shows the user where to approve — the bridge prints this; a GUI could open the URL. */
  notify: (info: { verificationUri: string; verificationUriComplete?: string; userCode: string }) => void;
}

/**
 * Runs the OAuth 2.0 Device Authorization Grant (RFC 8628): requests a user/device code, hands the
 * user a verification URL to approve in their browser (where they sign in and pick the project), and
 * polls the token endpoint until approval. No browser is required on this machine — ideal for an
 * agent/CLI/SSH session. Returns the access + refresh tokens to persist.
 */
export async function deviceLogin(opts: DeviceLoginOptions): Promise<StoredCredentials> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const base = opts.url.replace(/\/+$/, '');
  const scope = opts.scope ?? DEFAULT_SCOPE;

  const start = await postForm(fetchImpl, `${base}/oauth/device_authorization`, {
    client_id: CLI_CLIENT_ID,
    scope,
  });
  if (!start.ok) throw new OAuthLoginError(`device authorization failed: ${errorOf(start.body)}`);
  const auth = start.body as unknown as DeviceAuthResponse;
  opts.notify({
    verificationUri: auth.verification_uri,
    verificationUriComplete: auth.verification_uri_complete,
    userCode: auth.user_code,
  });

  // Poll the token endpoint until approval, denial, or expiry. RFC 8628: back off on `slow_down`.
  let intervalMs = Math.max(1, auth.interval ?? 5) * 1000;
  const deadline = now() + auth.expires_in * 1000;
  for (;;) {
    await sleep(intervalMs); // RFC 8628 §3.5: wait `interval` before each poll (incl. the first)
    if (now() >= deadline) throw new OAuthLoginError('login timed out before approval');
    const poll = await postForm(fetchImpl, `${base}/oauth/token`, {
      grant_type: DEVICE_GRANT,
      device_code: auth.device_code,
      client_id: CLI_CLIENT_ID,
    });
    if (poll.ok) return toCredentials(poll.body, now);
    const error = errorOf(poll.body);
    if (error === 'authorization_pending') continue;
    if (error === 'slow_down') {
      intervalMs = Math.min(intervalMs + 5000, 30_000); // RFC 8628: +5s, capped so a rogue server can't stall forever
      continue;
    }
    if (error === 'access_denied') throw new OAuthLoginError('access was denied');
    if (error === 'expired_token') throw new OAuthLoginError('the code expired before approval');
    throw new OAuthLoginError(`login failed: ${error}`);
  }
}

/**
 * Exchanges a (rotating) refresh token for a fresh access + refresh pair. Used by the bridge's
 * `onUnauthorized` hook when a short-lived access token expires mid-session.
 */
export async function refreshAccess(opts: {
  url: string;
  refreshToken: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}): Promise<StoredCredentials> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const now = opts.now ?? Date.now;
  const base = opts.url.replace(/\/+$/, '');
  const res = await postForm(fetchImpl, `${base}/oauth/token`, {
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: CLI_CLIENT_ID,
  });
  if (!res.ok) throw new OAuthLoginError(`token refresh failed: ${errorOf(res.body)}`);
  return toCredentials(res.body, now);
}
