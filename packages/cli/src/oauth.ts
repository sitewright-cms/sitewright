/** The fixed public client id for the CLI (matches the API's built-in client). */
export const CLI_CLIENT_ID = 'sitewright-cli';

/** A token-endpoint error carrying the RFC 6749/8628 `error` code (e.g. authorization_pending). */
export class OAuthTokenError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OAuthTokenError';
  }
}

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  interval: number;
  expiresIn: number;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Absolute expiry of the access token (ms epoch). */
  expiresAt: number;
  scope: string;
}

/** The slice of `fetch` we use — narrow so it's trivial to mock. */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; statusText: string; text(): Promise<string> }>;

function trimUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Builds the `/oauth/authorize` URL for the loopback + PKCE flow. */
export function buildAuthorizeUrl(opts: {
  issuer: string;
  redirectUri: string;
  challenge: string;
  scope: string;
  state: string;
}): string {
  const q = new URLSearchParams({
    client_id: CLI_CLIENT_ID,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    code_challenge: opts.challenge,
    code_challenge_method: 'S256',
    scope: opts.scope,
    state: opts.state,
  });
  return `${trimUrl(opts.issuer)}/oauth/authorize?${q.toString()}`;
}

/** Parses the loopback callback query: a code (state-verified) or an error. */
export function parseCallback(
  query: URLSearchParams,
  expectedState: string,
): { code: string } | { error: string } {
  // Verify state FIRST — even on error responses — so a co-located process that
  // hits the loopback without the (unguessable) state can't abort the login.
  if (query.get('state') !== expectedState) return { error: 'state_mismatch' };
  const error = query.get('error');
  if (error) return { error };
  const code = query.get('code');
  if (!code) return { error: 'missing_code' };
  return { code };
}

async function tokenRequest(
  issuer: string,
  body: Record<string, string>,
  fetchImpl: FetchLike,
): Promise<TokenSet> {
  const res = await fetchImpl(`${trimUrl(issuer)}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const obj = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
    const code = typeof obj.error === 'string' ? obj.error : 'invalid_request';
    const message = typeof obj.error_description === 'string' ? obj.error_description : code;
    throw new OAuthTokenError(code, message);
  }
  const t = json as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
  if (typeof t.access_token !== 'string' || typeof t.refresh_token !== 'string') {
    throw new Error('token response missing access_token or refresh_token');
  }
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + (t.expires_in ?? 0) * 1000,
    scope: t.scope ?? '',
  };
}

/** Exchanges an authorization code (+ PKCE verifier) for a token set. */
export function exchangeCode(
  opts: { issuer: string; code: string; redirectUri: string; verifier: string },
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<TokenSet> {
  return tokenRequest(
    opts.issuer,
    {
      grant_type: 'authorization_code',
      code: opts.code,
      client_id: CLI_CLIENT_ID,
      redirect_uri: opts.redirectUri,
      code_verifier: opts.verifier,
    },
    fetchImpl,
  );
}

/** Starts the device authorization grant (RFC 8628). */
export async function startDeviceAuthorization(
  opts: { issuer: string; scope: string },
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<DeviceAuthorization> {
  const res = await fetchImpl(`${trimUrl(opts.issuer)}/oauth/device_authorization`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLI_CLIENT_ID, scope: opts.scope }).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    let code = 'invalid_request';
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { error?: string; error_description?: string };
      if (typeof j.error === 'string') {
        code = j.error;
        message = j.error_description ?? j.error;
      }
    } catch {
      /* non-JSON body → keep the status fallback */
    }
    throw new OAuthTokenError(code, message);
  }
  const d = JSON.parse(text) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    verification_uri_complete?: string;
    interval?: number;
    expires_in?: number;
  };
  if (!d.device_code || !d.user_code || !d.verification_uri) {
    throw new OAuthTokenError('invalid_response', 'device authorization response is missing required fields');
  }
  return {
    deviceCode: d.device_code,
    userCode: d.user_code,
    verificationUri: d.verification_uri,
    verificationUriComplete: d.verification_uri_complete,
    interval: d.interval ?? 5,
    expiresIn: d.expires_in ?? 600,
  };
}

/** One poll of the device token endpoint — throws OAuthTokenError (e.g. authorization_pending). */
export function requestDeviceToken(
  opts: { issuer: string; deviceCode: string },
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<TokenSet> {
  return tokenRequest(
    opts.issuer,
    {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: opts.deviceCode,
      client_id: CLI_CLIENT_ID,
    },
    fetchImpl,
  );
}

/** Rotates a refresh token into a fresh token set. */
export function refreshTokens(
  opts: { issuer: string; refreshToken: string },
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<TokenSet> {
  return tokenRequest(
    opts.issuer,
    { grant_type: 'refresh_token', refresh_token: opts.refreshToken, client_id: CLI_CLIENT_ID },
    fetchImpl,
  );
}
