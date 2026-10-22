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
/**
 * Read AND write: registering a site (getToken, webResource.insert, sites.add) needs both. The test only reads, but
 * asks for the same token the registration will, so a pass means registration is allowed too.
 */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/siteverification', 'https://www.googleapis.com/auth/webmasters'] as const;
const SITE_VERIFICATION_LIST = 'https://www.googleapis.com/siteVerification/v1/webResource';
const SITE_VERIFICATION_TOKEN = 'https://www.googleapis.com/siteVerification/v1/token';
const SEARCH_CONSOLE_SITES = 'https://www.googleapis.com/webmasters/v3/sites';
/**
 * One verified site at Site Verification. Its id is the URL-encoded site URL, and the path takes that id as it is —
 * encoded ONCE. Measured against Google (2026-10-21): encoded twice it answers 400 "The ID for this site is missing
 * or invalid", and a site the account does not own answers 403 "You are not an owner of this site."
 */
const siteResource = (siteUrl: string): string => `${SITE_VERIFICATION_LIST}/${encodeURIComponent(siteUrl)}`;
const searchConsoleSite = (siteUrl: string): string => `${SEARCH_CONSOLE_SITES}/${encodeURIComponent(siteUrl)}`;
const SITE_VERIFICATION = 'Site Verification API';
const SEARCH_CONSOLE = 'Google Search Console API';
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

/** The machine-readable reasons of a Google API error. */
function errorReasons(json: unknown): unknown[] {
  const error = isRecord(json) && isRecord(json.error) ? json.error : undefined;
  if (!error) return [];
  return [...(Array.isArray(error.errors) ? error.errors : []), ...(Array.isArray(error.details) ? error.details : [])].filter(isRecord).map((e) => e.reason);
}

/** Whether a Google API error says the API is switched off for the key's project. */
function isApiDisabled(json: unknown): boolean {
  const reasons = errorReasons(json);
  return reasons.includes('accessNotConfigured') || reasons.includes('SERVICE_DISABLED');
}

/**
 * Whether a 403 is about THE SITE: the account does not own it, or it is not in its Search Console. Measured, both
 * answer reason `forbidden` ("You are not an owner of this site.", "User does not have sufficient permission for
 * site …"). Only that reason counts: Google also answers 403 for a switched-off API, a token without the scope, and
 * quota or rate limits — none of which says the site is gone, and reading one as "not there" would let a removal
 * report success while the site stays registered.
 */
function isNotTheSitesOwner(status: number, json: unknown): boolean {
  return status === 403 && errorReasons(json).includes('forbidden');
}

/** Google's quota and rate refusals, which it may answer with 403 as well as 429. */
const RATE_REASONS = ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded', 'RATE_LIMIT_EXCEEDED'];

/** Google's own message from an error reply, cut down to something safe to show. */
function googleMessage(json: unknown): string {
  return isRecord(json) && isRecord(json.error) ? cleanMessage(json.error.message) : '';
}

async function callApi(
  url: string,
  token: string,
  apiName: string,
  projectId: string,
  io: WebmasterIo,
  init: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: Json } = { method: 'GET' },
): Promise<Json> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' };
  if (init.body) headers['content-type'] = 'application/json';
  const { status, json } = await requestJson(
    SERVICE,
    url,
    { method: init.method, headers, ...(init.body ? { body: JSON.stringify(init.body) } : {}) },
    io,
  );
  if (status === 200 && isRecord(json)) return json;
  // Search Console answers an add or a removal with 204 and no body (and 200 with an empty one).
  if ((init.method === 'PUT' || init.method === 'DELETE') && (status === 204 || status === 200)) return {};
  return apiFailure(status, json, apiName, projectId);
}

/** Words a refused Google API call. */
function apiFailure(status: number, json: unknown, apiName: string, projectId: string): never {
  if (status === 403 && isApiDisabled(json)) {
    throw new WebmasterError(`The ${apiName} is not enabled in Google Cloud project ${projectId}: enable it, wait a minute, and test again`, 'disabled');
  }
  if (status === 429 || (status === 403 && errorReasons(json).some((r) => RATE_REASONS.includes(String(r))))) {
    throw new WebmasterError('Google is limiting requests; try again in a minute', 'rate');
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
  const verified = await callApi(SITE_VERIFICATION_LIST, token, SITE_VERIFICATION, key.projectId, io);
  const sites = await callApi(SEARCH_CONSOLE_SITES, token, SEARCH_CONSOLE, key.projectId, io);
  const v = count(verified.items);
  const s = count(sites.siteEntry);
  return `Connected as ${key.clientEmail} · ${v} site${v === 1 ? '' : 's'} verified · ${s} in Search Console`;
}

/** The `content` of a `<meta name="google-site-verification">` tag: Google's token alphabet, bounded. */
export const GOOGLE_SITE_TOKEN_RE = /^[A-Za-z0-9_-]{8,200}$/;

/**
 * The verification tag for `siteUrl` (an https URL-prefix property), as the `content` of
 * `<meta name="google-site-verification">`. Changes nothing at Google: the same account and URL get the same token.
 */
export async function googleSiteToken(key: GoogleServiceAccountKey, siteUrl: string, io: WebmasterIo, now = new Date()): Promise<string> {
  const token = await googleAccessToken(key, io, now);
  const reply = await callApi(SITE_VERIFICATION_TOKEN, token, SITE_VERIFICATION, key.projectId, io, {
    method: 'POST',
    body: { site: { type: 'SITE', identifier: siteUrl }, verificationMethod: 'META' },
  });
  const tag = typeof reply.token === 'string' ? reply.token : '';
  const content = /content="([^"]*)"/.exec(tag)?.[1] ?? '';
  if (!GOOGLE_SITE_TOKEN_RE.test(content)) throw new WebmasterError('Google sent a verification tag the platform could not read', 'unavailable');
  return content;
}

/**
 * Asks Google to verify `siteUrl` by the tag its home page now carries, which makes the service account a verified
 * owner, then adds the site to the service account's Search Console. Both steps are safe to repeat.
 *
 * Throws `unverified` when Google did not find the tag (the build without it is still live, or the page is not
 * reachable from the internet).
 */
export async function googleRegisterSite(key: GoogleServiceAccountKey, siteUrl: string, io: WebmasterIo, now = new Date()): Promise<void> {
  const token = await googleAccessToken(key, io, now);
  const { status, json } = await requestJson(
    SERVICE,
    `${SITE_VERIFICATION_LIST}?verificationMethod=META`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ site: { type: 'SITE', identifier: siteUrl } }),
    },
    io,
  );
  if (status === 400) {
    // Google's own reason ("The necessary verification token could not be found on your site.") is the useful part.
    const said = googleMessage(json);
    throw new WebmasterError(`Google could not verify ${siteUrl}${said ? `: ${said}` : ''}`, 'unverified');
  }
  if (status !== 200) apiFailure(status, json, SITE_VERIFICATION, key.projectId);
  await callApi(searchConsoleSite(siteUrl), token, SEARCH_CONSOLE, key.projectId, io, { method: 'PUT' });
}

/**
 * A DELETE that may find nothing to delete: true when it removed something, false when it was already gone. `absent`
 * are the statuses that mean "not there" for this API.
 */
async function deleteIfThere(url: string, token: string, apiName: string, projectId: string, io: WebmasterIo, absent: readonly number[] = [404]): Promise<boolean> {
  const { status, json } = await requestJson(SERVICE, url, { method: 'DELETE', headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, io);
  if (status === 200 || status === 204) return true;
  if (absent.includes(status) && (status !== 403 || isNotTheSitesOwner(status, json))) return false;
  return apiFailure(status, json, apiName, projectId);
}

const sameEmail = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The site's Search Console owners and what changes, as staff manage them. */
export interface GoogleOwnersChange {
  /** Who should own the site (besides the service account). */
  wanted: readonly string[];
  /** Who the platform made an owner before and staff removed since: they stop being owners. */
  dropped: readonly string[];
}

/**
 * Makes `wanted` owners of `siteUrl` in Search Console and takes `dropped` off — through Site Verification, whose
 * update sets the WHOLE owner list. So the list sent is Google's current one, changed only where the platform manages
 * it: owners someone else added at Google stay, and so does the service account (it cannot give itself up here).
 * Returns the owners Google lists afterwards, without the service account.
 *
 * Throws `unverified` when the service account does not own the site (nothing to share yet).
 */
export async function googleSetOwners(key: GoogleServiceAccountKey, siteUrl: string, change: GoogleOwnersChange, io: WebmasterIo, now = new Date()): Promise<string[]> {
  const token = await googleAccessToken(key, io, now);
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const read = await requestJson(SERVICE, siteResource(siteUrl), { method: 'GET', headers }, io);
  // 404: Google no longer knows the site at all — not owned either.
  if (isNotTheSitesOwner(read.status, read.json) || read.status === 404) {
    throw new WebmasterError(`The platform does not own ${siteUrl} at Google yet: verify the site first`, 'unverified');
  }
  if (read.status !== 200 || !isRecord(read.json)) return apiFailure(read.status, read.json, SITE_VERIFICATION, key.projectId);
  const resource = read.json;
  const current = Array.isArray(resource.owners) ? resource.owners.filter((o): o is string => typeof o === 'string') : [];
  const others = (list: readonly string[]): string[] => list.filter((o) => !sameEmail(o, key.clientEmail));

  const next = current.filter((o) => !change.dropped.some((d) => sameEmail(d, o)) || change.wanted.some((w) => sameEmail(w, o)));
  for (const w of change.wanted) if (!next.some((o) => sameEmail(o, w))) next.push(w);
  if (!next.some((o) => sameEmail(o, key.clientEmail))) next.push(key.clientEmail);
  if (next.length === current.length && next.every((o) => current.some((c) => sameEmail(c, o)))) return others(current);

  const put = await requestJson(
    SERVICE,
    siteResource(siteUrl),
    { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ id: resource.id, site: resource.site, owners: next }) },
    io,
  );
  if (put.status === 400) {
    // Google's reason is the useful part: an address that is not a Google account, or an owner who verified on their
    // own (their tokens must go before Google lets them be removed).
    const said = googleMessage(put.json);
    throw new WebmasterError(`Google did not change the owners${said ? `: ${said}` : ''}`, 'invalid');
  }
  if (put.status !== 200) return apiFailure(put.status, put.json, SITE_VERIFICATION, key.projectId);
  const listed = isRecord(put.json) && Array.isArray(put.json.owners) ? put.json.owners.filter((o): o is string => typeof o === 'string') : next;
  return others(listed);
}

/**
 * Hands `sitemapUrl` to Search Console for `siteUrl`. Google reads it later, on its own schedule; submitting again
 * asks it to read it again. Throws `unverified` when the site is not in the service account's Search Console.
 */
export async function googleSubmitSitemap(key: GoogleServiceAccountKey, siteUrl: string, sitemapUrl: string, io: WebmasterIo, now = new Date()): Promise<void> {
  const token = await googleAccessToken(key, io, now);
  const { status, json } = await requestJson(
    SERVICE,
    `${searchConsoleSite(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
    { method: 'PUT', headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
    io,
  );
  if (status === 200 || status === 204) return;
  if (isNotTheSitesOwner(status, json)) throw new WebmasterError(`${siteUrl} is not in the platform's Search Console: verify the site first`, 'unverified');
  if (status === 400 || status === 404) {
    const said = googleMessage(json);
    throw new WebmasterError(`Google did not take the sitemap${said ? `: ${said}` : ''}`, 'invalid');
  }
  apiFailure(status, json, SEARCH_CONSOLE, key.projectId);
}

/**
 * Takes `siteUrl` out of the service account's Search Console, and gives up the service account's ownership of it —
 * each step on its own, so one that finds nothing does not stop the other. Something already gone counts as
 * removed. Returns what was done, for staff.
 *
 * `owners` (the people the platform made owners) lose their ownership FIRST: once the service account gives the site
 * up it can no longer take them off. If Google cannot be reached for that, nothing else is done, so the removal can be
 * tried again whole. If Google refuses it for good (an owner who also verified on their own keeps the site until
 * their own tag is gone), the platform still gives the site up, and says the owners stayed.
 *
 * ★ Search Console answers 403, not 404, for a property that is not in the account (a site whose verification
 * failed before it was added), and Site Verification answers 403 for a site the account does not own: both are
 * "not there", unless the reply says the API is switched off.
 * ★ Google can keep a site verified while its tag is still on the live pages (it checks again): the tag goes with
 * the next deploy, since builds carry it only while the search engine is switched on.
 */
export async function googleUnregisterSite(key: GoogleServiceAccountKey, siteUrl: string, owners: readonly string[], io: WebmasterIo, now = new Date()): Promise<string> {
  let ownersGone = 0;
  let ownersKept = '';
  if (owners.length > 0) {
    try {
      const left = await googleSetOwners(key, siteUrl, { wanted: [], dropped: owners }, io, now);
      ownersGone = owners.filter((o) => !left.some((l) => sameEmail(l, o))).length;
    } catch (err) {
      // Not owned (any more): there is nobody the service account could take off.
      if (err instanceof WebmasterError && err.kind === 'invalid') ownersKept = `; the owners were not removed: ${err.message}`;
      else if (!(err instanceof WebmasterError && err.kind === 'unverified')) throw err;
    }
  }
  const token = await googleAccessToken(key, io, now);
  let failure: unknown;
  let listed = false;
  try {
    listed = await deleteIfThere(searchConsoleSite(siteUrl), token, SEARCH_CONSOLE, key.projectId, io, [403, 404]);
  } catch (err) {
    failure = err;
  }
  const owned = await deleteIfThere(siteResource(siteUrl), token, SITE_VERIFICATION, key.projectId, io, [403, 404]);
  if (failure) throw failure;
  const people = `${ownersGone ? ` (${ownersGone} owner${ownersGone === 1 ? '' : 's'} removed)` : ''}${ownersKept}`;
  if (listed && owned) return `Removed from Search Console, and the ownership given up${people}`;
  if (listed) return `Removed from Search Console${people}`;
  return owned ? `Ownership given up (the site was not in Search Console)${people}` : `Nothing to remove at Google${ownersKept}`;
}
