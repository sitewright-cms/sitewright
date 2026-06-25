import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';

/** Fallback Relying Party display name (authenticator/OS passkey UI) when no platform name is set. */
const DEFAULT_RP_NAME = 'SiteWright';

/** A resolved Relying Party: the id (a registrable domain) a passkey binds to, and the exact origin. */
export interface RpConfig {
  rpID: string;
  origin: string;
}

/** A stored credential, in the shape WebAuthn verification needs (public key decoded from base64url). */
export interface StoredCredential {
  id: string;
  publicKey: string; // base64url
  counter: number;
  transports?: string[];
}

/**
 * Resolves the Relying Party from the request — rpID is the host WITHOUT its port (a registrable
 * domain); origin is scheme + host. Explicit env overrides (SW_WEBAUTHN_RP_ID / SW_WEBAUTHN_ORIGIN)
 * win, for deployments behind a proxy where the request host isn't the public one. NOTE: a passkey
 * is bound to its rpID, so one registered on `dind.local:2003` will not authenticate on `localhost`.
 */
export function resolveRp(host: string | undefined, protocol: string, override?: { rpID?: string; origin?: string }): RpConfig {
  const h = (host ?? 'localhost').trim();
  return {
    rpID: override?.rpID ?? h.split(':')[0]!,
    origin: override?.origin ?? `${protocol}://${h}`,
  };
}

/**
 * The first value of a (possibly array / comma-chained) forwarded header. `X-Forwarded-Proto` /
 * `X-Forwarded-Host` can chain through multiple proxies (`https, http`); the LEFTMOST is the original
 * client-facing value. Returns undefined when absent/empty so callers fall back to the connection's
 * own protocol/host.
 *
 * Safe to honor unconditionally for WebAuthn ORIGIN derivation: a spoofed value only makes the
 * server's `expectedOrigin` disagree with the browser's real origin (or sends an rpID the browser
 * rejects as not a suffix of its origin), which fails the spoofer's OWN ceremony — it can never forge
 * or relay a passkey onto another origin. `SW_WEBAUTHN_ORIGIN`/`_RP_ID` remain the authoritative override.
 */
export function firstForwardedValue(v: string | string[] | undefined): string | undefined {
  // For the duplicate-header array form, skip empty leading entries (a misconfigured proxy may emit
  // an empty `X-Forwarded-Proto:` before the real one appends `https`).
  const raw = Array.isArray(v) ? v.find((s) => s.trim() !== '') : v;
  const first = raw?.split(',')[0]?.trim();
  return first ? first : undefined;
}

/** Copies any Uint8Array into one backed by a definite ArrayBuffer (the simplewebauthn helpers and
 *  generic Uint8Array default to ArrayBufferLike, which TS won't narrow to ArrayBuffer). */
function toBufferView(u: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(u.byteLength));
  out.set(u);
  return out;
}

/** base64url-encode a COSE public key (Uint8Array) for storage. */
export function encodePublicKey(publicKey: Uint8Array): string {
  return isoBase64URL.fromBuffer(toBufferView(publicKey));
}

/** A WebAuthn user handle (≤64 bytes) backed by a definite ArrayBuffer, from the user id. */
function userHandle(userId: string): Uint8Array<ArrayBuffer> {
  return toBufferView(isoUint8Array.fromUTF8String(userId));
}

const asTransports = (t?: string[]): AuthenticatorTransportFuture[] | undefined => t as AuthenticatorTransportFuture[] | undefined;

/** Registration options for a new passkey, excluding the user's existing credentials. */
export function registrationOptions(params: {
  rp: RpConfig;
  userId: string;
  userName: string;
  existing: { id: string; transports?: string[] }[];
  /** The platform name shown in the OS/authenticator passkey prompt (defaults to the built-in name). */
  rpName?: string;
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: params.rpName ?? DEFAULT_RP_NAME,
    rpID: params.rp.rpID,
    userName: params.userName,
    userID: userHandle(params.userId),
    attestationType: 'none', // first-party login — no attestation policy needed
    excludeCredentials: params.existing.map((c) => ({ id: c.id, transports: asTransports(c.transports) })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
}

// We request UV ('preferred') but do NOT hard-require it at verify, so roaming security keys that
// only prove presence still work. Identity assurance for those is covered by the password (passkey is
// an ALTERNATIVE first factor) and, when enabled, the TOTP gate on top.
const REQUIRE_USER_VERIFICATION = false;

export function verifyRegistration(params: {
  rp: RpConfig;
  response: RegistrationResponseJSON;
  expectedChallenge: string;
}): Promise<VerifiedRegistrationResponse> {
  return verifyRegistrationResponse({
    response: params.response,
    expectedChallenge: params.expectedChallenge,
    expectedOrigin: params.rp.origin,
    expectedRPID: params.rp.rpID,
    requireUserVerification: REQUIRE_USER_VERIFICATION,
  });
}

/** Authentication options; `allow` scopes to a known user's credentials (empty → discoverable). */
export function authenticationOptions(params: {
  rp: RpConfig;
  allow: { id: string; transports?: string[] }[];
}): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: params.rp.rpID,
    allowCredentials: params.allow.map((c) => ({ id: c.id, transports: asTransports(c.transports) })),
    userVerification: 'preferred',
  });
}

export function verifyAuthentication(params: {
  rp: RpConfig;
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  credential: StoredCredential;
}): Promise<VerifiedAuthenticationResponse> {
  return verifyAuthenticationResponse({
    response: params.response,
    expectedChallenge: params.expectedChallenge,
    expectedOrigin: params.rp.origin,
    expectedRPID: params.rp.rpID,
    credential: {
      id: params.credential.id,
      publicKey: toBufferView(isoBase64URL.toBuffer(params.credential.publicKey)),
      counter: params.credential.counter,
      transports: asTransports(params.credential.transports),
    },
    requireUserVerification: REQUIRE_USER_VERIFICATION,
  });
}
