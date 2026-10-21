import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { parse as secureJsonParse } from 'secure-json-parse';
import { cleanMessage, isRecord, requestJson, WebmasterError, type Json, type WebmasterIo } from './request.js';

/**
 * GOOGLE, as ONE service account for the whole platform: Site Verification proves the platform owns a site, and
 * Search Console reads how it performs. Neither needs a user or a browser: the service account signs a short JWT
 * with its private key and trades it for an access token (RFC 7523).
 *
 * ★ The key file's own `token_uri` is NOT used. A key file is uploaded content, and posting a signed assertion
 * to a URL the file names would let a crafted file make the server call anywhere. Google's endpoint is fixed.
 *
 * https://developers.google.com/identity/protocols/oauth2/service-account#httprest
 */

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/siteverification', 'https://www.googleapis.com/auth/webmasters'] as const;
const SITE_VERIFICATION_LIST = 'https://www.googleapis.com/siteVerification/v1/webResource';
const SEARCH_CONSOLE_SITES = 'https://www.googleapis.com/webmasters/v3/sites';
const TOKEN_LIFETIME_S = 3600;
const SERVICE = 'Google';

/** What is kept of a key file: the four fields signing needs, nothing else from it. */
export interface GoogleServiceAccountKey {
  clientEmail: string;
  privateKey: string;
  privateKeyId: string;
  projectId: string;
}

/** A service account's address: `name@project.iam.gserviceaccount.com` (or a Google-made default account). */
const CLIENT_EMAIL_RE = /^[a-z0-9][a-z0-9._-]{0,99}@[a-z0-9][a-z0-9.-]{0,150}\.gserviceaccount\.com$/i;
const PRIVATE_KEY_ID_RE = /^[a-f0-9]{8,100}$/i;
/** A Google Cloud project id (or a legacy domain-scoped one, `example.com:name`). */
const PROJECT_ID_RE = /^[a-z0-9.:-]{4,100}$/;

const NOT_A_KEY = 'This is not a Google service-account key file: in Google Cloud, open the service account, then Keys → Add key → Create new key → JSON';

/** Reads a downloaded key file. Throws `WebmasterError('invalid')` naming what is wrong; never echoes the file. */
export function parseGoogleKey(text: string): GoogleServiceAccountKey {
  let raw: unknown;
  try {
    raw = secureJsonParse(text, undefined, { protoAction: 'remove', constructorAction: 'remove' });
  } catch {
    throw new WebmasterError(NOT_A_KEY, 'invalid');
  }
  if (!isRecord(raw) || raw.type !== 'service_account') throw new WebmasterError(NOT_A_KEY, 'invalid');
  const clientEmail = typeof raw.client_email === 'string' ? raw.client_email.trim() : '';
  const privateKeyId = typeof raw.private_key_id === 'string' ? raw.private_key_id.trim() : '';
  const projectId = typeof raw.project_id === 'string' ? raw.project_id.trim() : '';
  const privateKey = typeof raw.private_key === 'string' ? raw.private_key : '';
  if (!CLIENT_EMAIL_RE.test(clientEmail)) throw new WebmasterError('The key file has no service-account email', 'invalid');
  if (!PRIVATE_KEY_ID_RE.test(privateKeyId)) throw new WebmasterError('The key file has no key id', 'invalid');
  if (!PROJECT_ID_RE.test(projectId)) throw new WebmasterError('The key file has no Google Cloud project id', 'invalid');
  if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) throw new WebmasterError('The key file has no private key', 'invalid');
  let key: KeyObject;
  try {
    key = createPrivateKey(privateKey);
  } catch {
    throw new WebmasterError('The private key in the key file cannot be read', 'invalid');
  }
  if (key.asymmetricKeyType !== 'rsa') throw new WebmasterError('The private key in the key file is not an RSA key', 'invalid');
  return { clientEmail, privateKey, privateKeyId, projectId };
}

const b64url = (data: Buffer | string): string => Buffer.from(data).toString('base64url');

/** The signed assertion a token is asked for with (exported for its test). */
export function signedAssertion(key: GoogleServiceAccountKey, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: key.privateKeyId }));
  const claims = b64url(
    JSON.stringify({ iss: key.clientEmail, scope: GOOGLE_SCOPES.join(' '), aud: GOOGLE_TOKEN_URL, iat, exp: iat + TOKEN_LIFETIME_S }),
  );
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), createPrivateKey(key.privateKey));
  return `${header}.${claims}.${b64url(signature)}`;
}

/** Trades the key for an access token. */
export async function googleAccessToken(key: GoogleServiceAccountKey, io: WebmasterIo, now = new Date()): Promise<string> {
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signedAssertion(key, now) });
  const { status, json } = await requestJson(
    SERVICE,
    GOOGLE_TOKEN_URL,
    { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: body.toString() },
    io,
  );
  if (status === 200 && isRecord(json) && typeof json.access_token === 'string' && json.access_token) return json.access_token;
  if (status === 429) throw new WebmasterError('Google is limiting requests; try again in a minute', 'rate');
  if (status >= 500) throw new WebmasterError(`Google is unavailable (HTTP ${status})`, 'unavailable');
  if (status === 200) throw new WebmasterError('Google sent a token reply the platform could not read', 'unavailable');
  const code = isRecord(json) ? cleanMessage(json.error) : '';
  if (code === 'invalid_grant') {
    // Most often a key deleted in Google Cloud, a disabled service account, or this server's clock being off.
    throw new WebmasterError("Google refused the key: it may have been deleted, or the service account disabled, in Google Cloud (or this server's clock is wrong)", 'auth');
  }
  throw new WebmasterError(`Google refused the key${code ? ` (${code})` : ` (HTTP ${status})`}`, 'auth');
}

/** Whether a Google API error says the API is switched off for the key's project. */
function isApiDisabled(json: unknown): boolean {
  const error = isRecord(json) && isRecord(json.error) ? json.error : undefined;
  if (!error) return false;
  const reasons = [
    ...(Array.isArray(error.errors) ? error.errors : []),
    ...(Array.isArray(error.details) ? error.details : []),
  ]
    .filter(isRecord)
    .map((e) => e.reason);
  return reasons.includes('accessNotConfigured') || reasons.includes('SERVICE_DISABLED');
}

async function getApi(url: string, token: string, apiName: string, projectId: string, io: WebmasterIo): Promise<Json> {
  const { status, json } = await requestJson(SERVICE, url, { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, io);
  if (status === 200 && isRecord(json)) return json;
  if (status === 403 && isApiDisabled(json)) {
    throw new WebmasterError(`The ${apiName} is not enabled in Google Cloud project ${projectId}: enable it, wait a minute, and test again`, 'disabled');
  }
  if (status === 401 || status === 403) throw new WebmasterError(`Google refused the service account access to the ${apiName} (HTTP ${status})`, 'auth');
  if (status === 429) throw new WebmasterError('Google is limiting requests; try again in a minute', 'rate');
  if (status >= 500) throw new WebmasterError(`Google is unavailable (HTTP ${status})`, 'unavailable');
  throw new WebmasterError(`The ${apiName} answered HTTP ${status}`, 'unavailable');
}

const count = (v: unknown): number => (Array.isArray(v) ? v.filter(isRecord).length : 0);

/**
 * Proves the key works and both APIs are on: a token, the sites the service account has verified, and the sites
 * in its Search Console. Reads only.
 */
export async function testGoogle(key: GoogleServiceAccountKey, io: WebmasterIo, now = new Date()): Promise<string> {
  const token = await googleAccessToken(key, io, now);
  const verified = await getApi(SITE_VERIFICATION_LIST, token, 'Site Verification API', key.projectId, io);
  const sites = await getApi(SEARCH_CONSOLE_SITES, token, 'Google Search Console API', key.projectId, io);
  const v = count(verified.items);
  const s = count(sites.siteEntry);
  return `Connected as ${key.clientEmail} · ${v} site${v === 1 ? '' : 's'} verified · ${s} in Search Console`;
}
