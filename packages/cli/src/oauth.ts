/** The fixed public client id for the CLI (matches the API's built-in client). */
export const CLI_CLIENT_ID = 'sitewright-cli';

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
  const error = query.get('error');
  if (error) return { error };
  if (query.get('state') !== expectedState) return { error: 'state_mismatch' };
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
    const err =
      json && typeof json === 'object' && 'error' in json && typeof json.error === 'string'
        ? json.error
        : res.statusText || `HTTP ${res.status}`;
    throw new Error(`token request failed: ${err}`);
  }
  const t = json as { access_token: string; refresh_token: string; expires_in: number; scope: string };
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
