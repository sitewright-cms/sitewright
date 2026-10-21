import { BING_API_KEY_RE } from '@sitewright/schema';
import { cleanMessage, isRecord, requestJson, WebmasterError, type WebmasterIo } from './request.js';

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

/** Proves the key works: the sites on the account. Reads only. */
export async function testBing(apiKey: string, io: WebmasterIo): Promise<string> {
  const url = `${API}/GetUserSites?apikey=${encodeURIComponent(apiKey)}`;
  const { status, json } = await requestJson(SERVICE, url, { method: 'GET', headers: { accept: 'application/json' } }, io);
  if (status === 200 && isRecord(json) && (Array.isArray(json.d) || json.d === null)) {
    const sites = Array.isArray(json.d) ? json.d.filter(isRecord) : [];
    const verified = sites.filter((s) => s.IsVerified === true).length;
    return `Connected · ${sites.length} site${sites.length === 1 ? '' : 's'} on the account, ${verified} verified`;
  }
  const code = isRecord(json) && typeof json.ErrorCode === 'number' ? json.ErrorCode : undefined;
  if (code !== undefined && AUTH_CODES.has(code)) throw new WebmasterError('Bing refused the API key', 'auth');
  if (status === 429 || (code !== undefined && RATE_CODES.has(code))) throw new WebmasterError('Bing is limiting requests; try again in a minute', 'rate');
  if (status === 401 || status === 403) throw new WebmasterError('Bing refused the API key', 'auth');
  if (status >= 500) throw new WebmasterError(`Bing is unavailable (HTTP ${status})`, 'unavailable');
  // A service message could quote the request; the key never reaches an admin's screen that way.
  const said = isRecord(json) ? cleanMessage(json.Message).split(apiKey).join('…') : '';
  throw new WebmasterError(`Bing answered HTTP ${status}${said ? ` (${said})` : ''}`, 'unavailable');
}
