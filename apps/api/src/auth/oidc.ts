import {
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  discovery,
  None,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  type Configuration,
} from 'openid-client';

/** A decrypted OIDC provider, ready to drive the login flow. */
export interface OidcProviderRuntime {
  id: string;
  issuer: string;
  clientId: string;
  /** Decrypted client secret; undefined for a public (PKCE-only) client. */
  clientSecret?: string;
  scopes: string[];
  /** Use PKCE (S256). When false the flow omits PKCE and relies on state + nonce. */
  usePkce: boolean;
}

/** The per-attempt secrets to persist between the authorize redirect and the callback. */
export interface OidcAuthStart {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** The validated identity claims we rely on. */
export interface OidcClaims {
  /** The token issuer (validated against discovery) — the durable identity key with `sub`. */
  iss: string;
  sub: string;
  email: string | null;
  emailVerified: boolean;
}

/** A recoverable OIDC flow error (surfaced to the user as a generic login error). */
export class OidcError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'OidcError';
  }
}

// Discovered IdP metadata (the .well-known fetch) cached per provider id, keyed by the config that
// produced it (so a changed issuer/clientId/secret re-discovers) with an hourly TTL.
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const discoveryCache = new Map<string, { config: Configuration; key: string; at: number }>();

// `usePkce` is deliberately NOT part of the cache key: it changes nothing about the DISCOVERED config
// (endpoints, JWKS) — PKCE is applied per-request at authorize/exchange time, not at discovery.
function configKey(p: OidcProviderRuntime): string {
  return [p.issuer, p.clientId, p.clientSecret ?? ''].join('\0');
}

async function configFor(p: OidcProviderRuntime, now: number): Promise<Configuration> {
  const key = configKey(p);
  const hit = discoveryCache.get(p.id);
  if (hit && hit.key === key && now - hit.at < DISCOVERY_TTL_MS) return hit.config;
  let server: URL;
  try {
    server = new URL(p.issuer);
  } catch {
    throw new OidcError('config', 'the provider issuer is not a valid URL');
  }
  // Only relax the HTTPS requirement for explicitly-http issuers (local/dev IdPs). This pairs with
  // `OidcIssuerSchema` deliberately permitting private/loopback issuers — a self-hosted IdP on the
  // LAN is a supported deployment, and it is typically served over plain http inside the perimeter.
  // The safety argument is the writer, not the address: only `requireInstanceAdmin` can configure a
  // provider. See the schema's comment before narrowing either half.
  const options = server.protocol === 'http:' ? { execute: [allowInsecureRequests] } : undefined;
  // A confidential client passes its secret (default client_secret_post); a public client uses None.
  const config = p.clientSecret
    ? await discovery(server, p.clientId, p.clientSecret, undefined, options)
    : await discovery(server, p.clientId, undefined, None(), options);
  discoveryCache.set(p.id, { config, key, at: now });
  return config;
}

/** Builds the IdP authorization URL plus the state/nonce/PKCE to persist for the callback. */
export async function startOidcAuth(p: OidcProviderRuntime, redirectUri: string, now: number = Date.now()): Promise<OidcAuthStart> {
  const config = await configFor(p, now);
  const state = randomState();
  const nonce = randomNonce();
  const scope = p.scopes.includes('openid') ? p.scopes.join(' ') : ['openid', ...p.scopes].join(' ');
  const params: Record<string, string> = { redirect_uri: redirectUri, scope, state, nonce };
  // PKCE is opt-out per provider. When off, omit the challenge (state + nonce still bind the callback);
  // `codeVerifier` is returned empty so nothing is persisted and the callback sends no verifier.
  let codeVerifier = '';
  if (p.usePkce) {
    codeVerifier = randomPKCECodeVerifier();
    params.code_challenge = await calculatePKCECodeChallenge(codeVerifier);
    params.code_challenge_method = 'S256';
  }
  const url = buildAuthorizationUrl(config, params);
  return { url: url.href, state, nonce, codeVerifier };
}

/**
 * Completes the callback: exchanges the code (PKCE) and validates the ID token (signature via JWKS,
 * issuer, audience, expiry, and the expected state + nonce) — all enforced by openid-client. Returns
 * the verified claims. Throws {@link OidcError} on any validation failure.
 */
/**
 * What the provider actually objected to, for the log line an operator reads at 2am.
 *
 * A token-endpoint rejection arrives as oauth4webapi's `ResponseBodyError`, whose `message` is the
 * generic "server responded with an error in the response body" — the same sentence for a wrong client
 * secret, a replayed code and a redirect-URI mismatch. The OAuth error CODE and description that
 * distinguish them sit on the error object and were being dropped, so every failure logged identically
 * and told nobody anything. Read duck-typed rather than by importing oauth4webapi: it is a transitive
 * dependency of openid-client, not ours to pin.
 */
export function describeExchangeFailure(err: unknown): string {
  const e = err as { error?: unknown; error_description?: unknown; status?: unknown; message?: unknown };
  const code = typeof e?.error === 'string' ? e.error : undefined;
  if (code) {
    const detail = typeof e.error_description === 'string' ? e.error_description : undefined;
    const status = typeof e.status === 'number' ? ` (HTTP ${e.status})` : '';
    // `invalid_client` = the client id/secret pair the provider has does not match ours; `invalid_grant`
    // = the code was already used, expired, or the clock is off; `redirect_uri_mismatch` = the callback
    // URL differs from the registered one. Naming the code is what makes those three distinguishable.
    return detail ? `${code}: ${detail}${status}` : `${code}${status}`;
  }
  return typeof e?.message === 'string' ? e.message : 'token exchange failed';
}

export async function completeOidcAuth(
  p: OidcProviderRuntime,
  currentUrl: URL,
  checks: { state: string; nonce: string; codeVerifier: string },
  now: number = Date.now(),
): Promise<OidcClaims> {
  const config = await configFor(p, now);
  let claims;
  try {
    // State + nonce are always enforced; the PKCE verifier is sent only when PKCE was used at start
    // (empty ⇒ this provider has PKCE disabled). openid-client permits omitting PKCE given expectedState.
    const tokens = await authorizationCodeGrant(config, currentUrl, {
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      ...(checks.codeVerifier ? { pkceCodeVerifier: checks.codeVerifier } : {}),
    });
    claims = tokens.claims();
  } catch (err) {
    throw new OidcError('exchange', describeExchangeFailure(err), { cause: err });
  }
  if (!claims) throw new OidcError('no_id_token', 'the identity provider did not return an ID token');
  return {
    iss: claims.iss,
    sub: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    emailVerified: claims.email_verified === true,
  };
}
