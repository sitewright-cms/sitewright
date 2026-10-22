import { BING_API_KEY_RE } from '@sitewright/schema';
import { cleanMessage, isRecord, requestJson, WebmasterError, type Json, type WebmasterIo } from './request.js';

/**
 * BING WEBMASTER TOOLS, as ONE account for the whole platform, through its JSON API and an account API key.
 *
 * ★ Bing takes the key in the QUERY STRING (`?apikey=`). The URL is therefore a secret: it is never logged,
 * stored or put in an error — every message here is worded without it.
 *
 * https://learn.microsoft.com/en-us/bingwebmaster/getting-access
 */

const API = 'https://ssl.bing.com/webmaster/api.svc/json';
const SERVICE = 'Bing';

/** Bing's `ApiErrorCode`s that mean the key itself is refused, or the caller is throttled. */
const AUTH_CODES = new Set([3 /* InvalidApiKey */, 6 /* UserBlocked */, 10 /* UserNotFound */, 14 /* NotAuthorized */]);
const RATE_CODES = new Set([4 /* ThrottleUser */, 5 /* ThrottleHost */]);

export function parseBingKey(raw: string): string {
  const key = raw.trim();
  if (!BING_API_KEY_RE.test(key)) {
    throw new WebmasterError('That is not a Bing Webmaster API key: copy it from Bing Webmaster Tools → Settings → API Access', 'invalid');
  }
  return key;
}

/** `TooManySites`, `InvalidUrl` and `AlreadyExists` — the answers to adding a site that are about the site. */
const TOO_MANY_SITES = 9;
const INVALID_URL = 7;
const ALREADY_EXISTS = 12;
/** `NotFound`: the site is not on the account. */
const NOT_FOUND = 11;

const errorCodeOf = (json: unknown): number | undefined => (isRecord(json) && typeof json.ErrorCode === 'number' ? json.ErrorCode : undefined);

/** Words a refused call. */
function bingFailure(status: number, json: unknown, apiKey: string): never {
  const code = errorCodeOf(json);
  if (code !== undefined && AUTH_CODES.has(code)) throw new WebmasterError('Bing refused the API key', 'auth');
  if (status === 429 || (code !== undefined && RATE_CODES.has(code))) throw new WebmasterError('Bing is limiting requests; try again in a minute', 'rate');
  if (status === 401 || status === 403) throw new WebmasterError('Bing refused the API key', 'auth');
  if (status >= 500) throw new WebmasterError(`Bing is unavailable (HTTP ${status})`, 'unavailable');
  // A service message could quote the request; the key never reaches an admin's screen that way.
  const said = isRecord(json) ? cleanMessage(json.Message).split(apiKey).join('…') : '';
  throw new WebmasterError(`Bing answered HTTP ${status}${said ? ` (${said})` : ''}`, 'unavailable');
}

/**
 * One API method. A GET (its `params` in the query string), or a POST of its JSON arguments; the reply's `d` on
 * success.
 */
async function bingCall(
  apiKey: string,
  method: string,
  io: WebmasterIo,
  args?: Json,
  params: Record<string, string> = {},
): Promise<{ ok: true; d: unknown } | { ok: false; status: number; json: unknown }> {
  const query = new URLSearchParams({ ...params, apikey: apiKey });
  const url = `${API}/${method}?${query.toString()}`;
  const { status, json } = await requestJson(
    SERVICE,
    url,
    args
      ? { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(args) }
      : { method: 'GET', headers: { accept: 'application/json' } },
    io,
  );
  if (status === 200 && isRecord(json) && 'd' in json && errorCodeOf(json) === undefined) return { ok: true, d: json.d };
  return { ok: false, status, json };
}

async function userSites(apiKey: string, io: WebmasterIo): Promise<Json[]> {
  const r = await bingCall(apiKey, 'GetUserSites', io);
  if (!r.ok) bingFailure(r.status, r.json, apiKey);
  if (r.d !== null && !Array.isArray(r.d)) throw new WebmasterError('Bing sent a site list the platform could not read', 'unavailable');
  return Array.isArray(r.d) ? r.d.filter(isRecord) : [];
}

/** Proves the key works: the sites on the account. Reads only. */
export async function testBing(apiKey: string, io: WebmasterIo): Promise<string> {
  const sites = await userSites(apiKey, io);
  const verified = sites.filter((s) => s.IsVerified === true).length;
  return `Connected · ${sites.length} site${sites.length === 1 ? '' : 's'} on the account, ${verified} verified`;
}

/** Bing's site URLs compared as the property they name: case-insensitive, with or without the closing `/`. */
const sameSite = (a: unknown, b: string): boolean =>
  typeof a === 'string' && a.trim().toLowerCase().replace(/\/?$/, '/') === b.toLowerCase().replace(/\/?$/, '/');

/** The `content` of a `<meta name="msvalidate.01">` tag. */
export const BING_SITE_CODE_RE = /^[A-Za-z0-9]{8,128}$/;

/**
 * The verification tag for `siteUrl`, as the `content` of `<meta name="msvalidate.01">`. Adds the site to the
 * account (unverified) when it is not there yet — Bing only issues a code for a site it has.
 */
export async function bingSiteCode(apiKey: string, siteUrl: string, io: WebmasterIo): Promise<string> {
  let site = (await userSites(apiKey, io)).find((s) => sameSite(s.Url, siteUrl));
  if (!site) {
    const added = await bingCall(apiKey, 'AddSite', io, { siteUrl });
    if (!added.ok) {
      const code = errorCodeOf(added.json);
      if (code === TOO_MANY_SITES) throw new WebmasterError('The Bing account has reached its limit of sites', 'invalid');
      if (code === INVALID_URL) throw new WebmasterError(`Bing does not accept ${siteUrl} as a site`, 'invalid');
      if (code !== ALREADY_EXISTS) bingFailure(added.status, added.json, apiKey);
    }
    site = (await userSites(apiKey, io)).find((s) => sameSite(s.Url, siteUrl));
    if (!site) throw new WebmasterError(`Bing did not list ${siteUrl} after adding it`, 'unavailable');
  }
  const code = typeof site.AuthenticationCode === 'string' ? site.AuthenticationCode.trim() : '';
  if (!BING_SITE_CODE_RE.test(code)) throw new WebmasterError('Bing sent a verification code the platform could not read', 'unavailable');
  return code;
}

/** Asks Bing to verify `siteUrl` by the tag its home page now carries. Throws `unverified` when Bing did not find it. */
export async function bingVerifySite(apiKey: string, siteUrl: string, io: WebmasterIo): Promise<void> {
  const r = await bingCall(apiKey, 'VerifySite', io, { siteUrl });
  if (!r.ok) bingFailure(r.status, r.json, apiKey);
  if (r.d !== true) throw new WebmasterError(`Bing could not verify ${siteUrl}: it did not find the verification tag on the home page`, 'unverified');
}

/**
 * Hands `sitemapUrl` to Bing for `siteUrl` (`SubmitFeed`). Bing reads it later, on its own schedule. Throws
 * `unverified` when the site is not on the account.
 */
export async function bingSubmitSitemap(apiKey: string, siteUrl: string, sitemapUrl: string, io: WebmasterIo): Promise<void> {
  const r = await bingCall(apiKey, 'SubmitFeed', io, { siteUrl, feedUrl: sitemapUrl });
  if (r.ok) return;
  const code = errorCodeOf(r.json);
  if (code === NOT_FOUND) throw new WebmasterError(`${siteUrl} is not on the platform's Bing account: verify the site first`, 'unverified');
  if (code === INVALID_URL) throw new WebmasterError(`Bing does not accept ${sitemapUrl} as a sitemap`, 'invalid');
  bingFailure(r.status, r.json, apiKey);
}

/** Takes `siteUrl` off the account. A site that is not there counts as removed. */
export async function bingRemoveSite(apiKey: string, siteUrl: string, io: WebmasterIo): Promise<string> {
  const r = await bingCall(apiKey, 'RemoveSite', io, { siteUrl });
  if (!r.ok && errorCodeOf(r.json) !== NOT_FOUND) bingFailure(r.status, r.json, apiKey);
  return 'Removed from Bing Webmaster Tools';
}

/** One day's or one week's numbers, as Bing reports them. `key` is the query or the page (empty for site traffic). */
export interface BingStat {
  /** The day it is for, YYYY-MM-DD in Pacific time (Bing's own dates are Pacific midnights). */
  date: string;
  key: string;
  clicks: number;
  impressions: number;
  /** Average position when shown; null when Bing gives none. */
  position: number | null;
}

/** Bing's WCF date, `/Date(1316156400000-0700)/`: the epoch milliseconds, read as a Pacific day. */
export function bingDay(raw: unknown): string | null {
  const ms = typeof raw === 'string' ? /^\/Date\((-?\d{1,15})(?:[+-]\d{4})?\)\/$/.exec(raw)?.[1] : undefined;
  if (ms === undefined) return null;
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

function stats(d: unknown, keyField: 'Query' | null): BingStat[] {
  if (d !== null && !Array.isArray(d)) throw new WebmasterError('Bing sent statistics the platform could not read', 'unavailable');
  const out: BingStat[] = [];
  for (const item of Array.isArray(d) ? d.filter(isRecord) : []) {
    const date = bingDay(item.Date);
    if (!date) continue;
    const position = typeof item.AvgImpressionPosition === 'number' && Number.isFinite(item.AvgImpressionPosition) && item.AvgImpressionPosition > 0 ? item.AvgImpressionPosition : null;
    out.push({
      date,
      key: keyField && typeof item[keyField] === 'string' ? (item[keyField] as string).slice(0, 2048) : '',
      clicks: count(item.Clicks),
      impressions: count(item.Impressions),
      position,
    });
  }
  return out;
}

/**
 * The site's search traffic at Bing: per day (`GetRankAndTrafficStats`), and per query and per page
 * (`GetQueryStats`, `GetPageStats` — Bing updates those weekly). Bing answers with all the history it keeps; the
 * caller picks the period. Throws `unverified` when the site is not on the account.
 */
export async function bingSearchStats(apiKey: string, siteUrl: string, io: WebmasterIo): Promise<{ daily: BingStat[]; queries: BingStat[]; pages: BingStat[] }> {
  const read = async (method: string, keyField: 'Query' | null): Promise<BingStat[]> => {
    const r = await bingCall(apiKey, method, io, undefined, { siteUrl });
    if (!r.ok) {
      if (errorCodeOf(r.json) === NOT_FOUND) throw new WebmasterError(`${siteUrl} is not on the platform's Bing account: verify the site again`, 'unverified');
      bingFailure(r.status, r.json, apiKey);
    }
    return stats(r.d, keyField);
  };
  const [daily, queries, pages] = await Promise.all([read('GetRankAndTrafficStats', null), read('GetQueryStats', 'Query'), read('GetPageStats', 'Query')]);
  return { daily, queries, pages };
}
