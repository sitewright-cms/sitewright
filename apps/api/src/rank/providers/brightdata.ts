import { parse as secureJsonParse } from 'secure-json-parse';
import { countryOnlyLocations } from './country-locations.js';
import {
  RankProviderError,
  type RankCredentials,
  type RankProvider,
  type RankProviderIo,
  type RankSearch,
  type SerpEntry,
  type SerpPage,
  type SubmitOutcome,
} from './types.js';

/**
 * Bright Data's SERP API, by Direct API access (`POST https://api.brightdata.com/request`).
 *
 * - ONE request per results page: a Google search URL (`q` first, then `gl`, `hl`, `start`, a city's `uule`,
 *   `brd_mobile`, and `brd_json=1` for Bright Data's parsed results). The answer comes back at once, so `submit`
 *   answers every search `done` (a "live" provider) and the tracker sends a check's next stage in the same pass.
 * - `country` in the request routes the search through a connection in that country, so Google answers as it would
 *   for someone there — the point of this provider: a provider searching from abroad and only TELLING Google the
 *   place (DataForSEO) missed a Namibian company's own #1 result for its name.
 * - Billed per SUCCESSFUL request ($1.50 per 1,000 on pay as you go; 5,000 free requests a month on every account).
 *   A request Bright Data could not run is not billed ("none of the errors in this catalog are billed"); one that came
 *   back but could not be read, or whose reply was lost, may have been, and is booked. No price comes back with a
 *   result: each page is booked at the admin's price per 1,000 (the pay-as-you-go rate unless set).
 * - A city goes in as its canonical name ("the value of column Canonical Name … can be used as a raw string").
 * - A stage stopped partway keeps the pages it read (`cut`), and the check reads on from them on a later pass; a
 *   search never started for an account-wide refusal is `unsent`, its claim given back.
 * - Positions are counted here, page by page, as for Apify: featured snippets first (Google puts them above the
 *   results, and does not repeat the snippet's page among them), then the organic results — Google's own links
 *   (Search, Maps) left out.
 *
 * ★ A message is shown to admins: it never carries the API key, a URL or a response body.
 *
 * https://docs.brightdata.com/products/serp-api/introduction · https://docs.brightdata.com/products/serp-api/parsed-json-results
 */

const API = 'https://api.brightdata.com';
/** The pay-as-you-go price per 1,000 successful requests, used when the admin sets none. */
const DEFAULT_PRICE_PER_1000_USD = 1.5;
const MAX_PRICE_PER_1000_USD = 100;
/** The most searches one `submit` carries: each may read up to five pages, one request each. */
const MAX_BATCH = 10;
/** Searches read at once. Bright Data refuses the same query sent concurrently, and a burst trips its rate limit. */
const CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 30_000;
const ZONE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const WEB_URL_RE = /^https?:\/\//i;
const UNREADABLE = 'Bright Data sent results the platform could not read';

type Json = Record<string, unknown>;
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const records = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isRecord) : []);

/** What an HTTP refusal means for the tracker. Bright Data's own error codes ride in headers the transport does not keep. */
function errorFor(status: number): RankProviderError {
  if (status === 401 || status === 407) return new RankProviderError('Bright Data refused the API key or the zone', 'auth');
  if (status === 402) return new RankProviderError('Bright Data has no funds left for this request; add funds or wait for next month’s free requests', 'funds');
  if (status === 403) return new RankProviderError('Bright Data does not allow this request: check the zone is a SERP API zone, and the account’s balance', 'auth');
  if (status === 429) return new RankProviderError('Bright Data is limiting the request rate; trying again later', 'rate');
  if (status === 400 || status === 404 || status === 422) return new RankProviderError(`Bright Data refused the request (HTTP ${status}): check the zone name`, 'invalid');
  return new RankProviderError(`Bright Data could not run the search (HTTP ${status})`, 'unavailable');
}

/** No answer came, or one that could not be read: the request may have run, and been billed. */
class PossiblyBilled extends RankProviderError {
  constructor(message: string) {
    super(message, 'unavailable');
    this.name = 'PossiblyBilled';
  }
}

/**
 * Account-wide refusals: no further request of the account can do better until an admin acts or time passes. A request
 * refused for itself (HTTP 400: a place Bright Data does not take, say) fails that search alone — one keyword must not
 * stop every other project's.
 */
const accountWide = (e: RankProviderError): boolean => e.kind === 'auth' || e.kind === 'funds' || e.kind === 'rate';

async function call(creds: RankCredentials, method: 'GET' | 'POST', path: string, io: RankProviderIo, body?: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), io.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  // Full parsed results carry thumbnails inline: the large-answer transport, when there is one.
  const fetch = method === 'POST' ? (io.largeFetch ?? io.fetch) : io.fetch;
  let res: Awaited<ReturnType<RankProviderIo['fetch']>>;
  let text: string;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      // ★ The key goes in the header, never the URL: a URL ends up in logs.
      headers: { authorization: `Bearer ${creds.apiKey}`, accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    text = await res.text();
  } catch {
    throw new PossiblyBilled('Bright Data could not be reached');
  } finally {
    clearTimeout(timer);
  }
  if (res.status >= 400) throw errorFor(res.status);
  try {
    return text ? (secureJsonParse(text, undefined, { protoAction: 'remove', constructorAction: 'remove' }) as unknown) : undefined;
  } catch {
    // Taken (2xx), so billed: but nothing to read.
    throw new PossiblyBilled(UNREADABLE);
  }
}

const priceOf = (creds: RankCredentials): number => {
  const p = Number(creds.pricePer1000);
  return creds.pricePer1000 !== undefined && Number.isFinite(p) && p > 0 ? p / 1000 : DEFAULT_PRICE_PER_1000_USD / 1000;
};

/**
 * The Google search URL for one results page of a search. `q` first ("arguments before `q` may result in delays and a
 * lower success rate"); a city as its canonical name, which Bright Data turns into Google's place code.
 * @internal exported for tests
 */
export function searchUrlFor(s: RankSearch, page: number): string {
  const plus = (v: string): string => encodeURIComponent(v).replace(/%20/g, '+');
  const params = [`q=${plus(s.keyword)}`, `gl=${encodeURIComponent(s.location.countryCode.toLowerCase())}`, `hl=${encodeURIComponent(s.languageCode)}`];
  if (page > 1) params.push(`start=${(page - 1) * 10}`);
  if (s.location.name.includes(',')) params.push(`uule=${plus(s.location.name).replace(/%2C/gi, ',')}`);
  if (s.device === 'mobile') params.push('brd_mobile=1');
  params.push('brd_json=1');
  return `https://www.google.com/search?${params.join('&')}`;
}

/**
 * A link to Google Search or Maps itself (the "Map" entry of a local search): no site's result. Google's own sites
 * (support.google.com and the like) are real results for some searches, and are counted.
 */
function isGoogleLink(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/^(www\.|maps\.)?google(\.[a-z]{2,3}){1,2}$/i.test(u.hostname)) return false;
    return u.hostname.toLowerCase().startsWith('maps.') || /^\/(search|maps)(\/|$)/.test(u.pathname);
  } catch {
    return false;
  }
}

/** The parsed results, whether the answer is the results themselves or Bright Data's `{ body }` wrapper around them. */
function resultsOf(answer: unknown): Json | null {
  if (!isRecord(answer)) return null;
  if (Array.isArray(answer.organic)) return answer;
  const inner = str(answer.body);
  if (!inner) return null;
  try {
    const parsed = secureJsonParse(inner, undefined, { protoAction: 'remove', constructorAction: 'remove' }) as unknown;
    return isRecord(parsed) && Array.isArray(parsed.organic) ? parsed : null;
  } catch {
    return null;
  }
}

/** One results page's links, in Google's order: featured snippets, then organic results (a snippet's page not twice). */
function linksOf(results: Json): Array<{ kind: SerpEntry['kind']; url: string }> {
  const out: Array<{ kind: SerpEntry['kind']; url: string }> = [];
  const snippets = records(results.featured_snippets).flatMap((f) => {
    const url = str(f.link);
    return url && WEB_URL_RE.test(url) ? [url] : [];
  });
  for (const url of snippets) out.push({ kind: 'featured_snippet', url });
  const organic = records(results.organic).sort((a, b) => (num(a.global_rank) ?? 0) - (num(b.global_rank) ?? 0));
  for (const r of organic) {
    const url = str(r.link);
    if (!url || !WEB_URL_RE.test(url) || isGoogleLink(url) || snippets.includes(url)) continue;
    out.push({ kind: 'organic', url });
  }
  return out;
}

/** Google has a page after this one: its parsed pagination says so. Without pagination, assumed while results came. */
function hasNextPage(results: Json): boolean {
  const p = results.pagination;
  if (!isRecord(p)) return true;
  return num(p.next_page) !== undefined || num(p.next_page_start) !== undefined || str(p.next_page_link) !== undefined;
}

type SearchResult =
  /** Its pages read — all of them, or (`page.cut`) those before a failure partway. */
  | { state: 'done'; page: SerpPage; billedPages: number }
  | { state: 'failed'; error: string; billedPages: number }
  /** Its first request was refused for the whole account: nothing was sent or billed for it. */
  | { state: 'refused'; error: RankProviderError }
  /** Never started: an account-wide refusal stopped the rest. */
  | { state: 'unsent' };

/** Reads one search's pages, one request each, stopping where Google serves no more. */
async function readSearch(creds: RankCredentials, s: RankSearch, io: RankProviderIo, stop: { error?: RankProviderError }): Promise<SearchResult> {
  const entries: SerpEntry[] = [];
  let organic = 0;
  let snippets = 0;
  let order = 0;
  let pages = 0;
  let end = false;
  let checkedAt: Date | null = null;
  /** The pages read so far, kept: a later pass reads on from them. */
  const partway = (billed: number, read = pages): SearchResult => ({
    state: 'done',
    billedPages: billed,
    page: { checkedAt: checkedAt ?? new Date(), entries, pagesRead: read, cut: true },
  });
  for (let i = 0; i < s.pages && !end; i++) {
    if (stop.error) return pages === 0 ? { state: 'unsent' } : partway(pages);
    let answer: unknown;
    try {
      answer = await call(creds, 'POST', '/request', io, { zone: creds.zone, url: searchUrlFor(s, s.startPage + i), format: 'raw', country: s.location.countryCode.toLowerCase() });
    } catch (err) {
      if (!(err instanceof RankProviderError)) throw err;
      // A lost or unreadable reply may have been billed; a request Bright Data refused or could not run was not.
      const billed = pages + (err instanceof PossiblyBilled ? 1 : 0);
      if (accountWide(err)) stop.error ??= err;
      if (pages > 0) return partway(billed);
      return accountWide(err) ? { state: 'refused', error: err } : { state: 'failed', error: err.message, billedPages: billed };
    }
    pages++;
    const results = resultsOf(answer);
    // Taken and billed, but not results: this page is paid for, not read.
    if (!results) return pages > 1 ? partway(pages, pages - 1) : { state: 'failed', error: UNREADABLE, billedPages: pages };
    checkedAt ??= (() => {
      const general = isRecord(results.general) ? results.general : {};
      const at = Date.parse(str(general.timestamp) ?? '');
      return Number.isFinite(at) ? new Date(at) : new Date();
    })();
    const links = linksOf(results);
    for (const l of links) {
      const position = l.kind === 'organic' ? ++organic : ++snippets;
      entries.push({ kind: l.kind, position, absolutePosition: ++order, url: l.url.slice(0, 2048), domain: '' });
    }
    if (links.length === 0 || !hasNextPage(results)) end = true;
  }
  return { state: 'done', billedPages: pages, page: { checkedAt: checkedAt ?? new Date(), entries, pagesRead: pages, ...(end ? { end: true } : {}) } };
}

function parseCredentials(raw: Readonly<Record<string, string>>): RankCredentials {
  const apiKey = (raw.apiKey ?? '').trim();
  if (!apiKey || apiKey.length > 300 || /\s/.test(apiKey)) throw new RankProviderError('Enter the Bright Data API key', 'invalid');
  const zone = (raw.zone ?? '').trim();
  if (!ZONE_RE.test(zone)) throw new RankProviderError('Enter the SERP API zone’s name: letters, digits, _ and - only', 'invalid');
  const priceRaw = (raw.pricePer1000 ?? '').trim().replace(',', '.');
  if (!priceRaw) return { apiKey, zone };
  const price = Number(priceRaw);
  // Above zero: a free price would leave the monthly budget nothing to count, and real charges past the free requests
  // would then go unchecked.
  if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE_PER_1000_USD) {
    throw new RankProviderError(`The price per 1,000 requests is a number of dollars above 0, up to ${MAX_PRICE_PER_1000_USD}`, 'invalid');
  }
  return { apiKey, zone, pricePer1000: String(price) };
}

export const brightData: RankProvider = {
  id: 'brightdata',
  label: 'Bright Data (SERP API)',
  signupUrl: 'https://brightdata.com/products/serp-api',
  fields: [
    {
      key: 'apiKey',
      label: 'API key',
      type: 'secret',
      required: true,
      help: 'In the SERP API zone’s Overview tab, or Account settings → API keys. Every account gets 5,000 free requests a month; one results page is one request.',
    },
    { key: 'zone', label: 'SERP API zone', type: 'text', required: true, help: 'The zone’s name as it appears in the control panel, such as serp_api1.' },
    {
      key: 'pricePer1000',
      label: 'Price per 1,000 requests (USD)',
      type: 'text',
      required: false,
      help: `What the budget books per results page. Leave empty for the pay-as-you-go $${DEFAULT_PRICE_PER_1000_USD.toFixed(2)}.`,
    },
  ],
  maxBatch: MAX_BATCH,

  parseCredentials,

  estimateCostUsd(pages, creds) {
    return priceOf(creds) * Math.max(1, pages);
  },

  async submit(creds, searches, io) {
    if (searches.length === 0) return [];
    if (searches.length > MAX_BATCH) throw new RankProviderError(`at most ${MAX_BATCH} searches per request`, 'invalid');
    const price = priceOf(creds);
    const stop: { error?: RankProviderError } = {};
    const results: SearchResult[] = new Array(searches.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < searches.length) {
        const i = next++;
        const s = searches[i]!;
        // The country goes into the URL and routes the search: anything but an ISO code is not sent.
        results[i] = /^[A-Z]{2}$/i.test(s.location.countryCode)
          ? await readSearch(creds, s, io, stop)
          : { state: 'failed', error: 'the keyword’s country is not an ISO code', billedPages: 0 };
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, searches.length) }, worker));
    // Refused for the whole account before anything was sent or billed: the request as a whole, so the tracker gives
    // every claim back and shows the admin why.
    if (stop.error && results.every((r) => r.state === 'refused' || r.state === 'unsent')) throw stop.error;
    return searches.map((s, i): SubmitOutcome => {
      const r = results[i]!;
      if (r.state === 'done') return { checkId: s.checkId, state: 'done', page: r.page, costUsd: price * r.billedPages };
      if (r.state === 'failed') return { checkId: s.checkId, state: 'failed', error: r.error, costUsd: price * r.billedPages };
      return { checkId: s.checkId, state: 'unsent', error: r.state === 'refused' ? r.error.message : (stop.error?.message ?? 'not sent') };
    });
  },

  // Every search is answered at once: nothing is ever queued.
  async collect(_creds, queued) {
    return queued.map((q) => ({ checkId: q.checkId, state: 'failed' as const, error: 'Bright Data answers at once: there is nothing to collect' }));
  },

  async account(creds, io) {
    // The zone first: a key that works for the account but names a missing zone would fail every search.
    try {
      await call(creds, 'GET', `/zone/status?zone=${encodeURIComponent(creds.zone ?? '')}`, io);
    } catch (err) {
      if (err instanceof RankProviderError && err.kind === 'invalid') {
        throw new RankProviderError(`Bright Data has no SERP API zone named “${creds.zone}” for this key`, 'invalid');
      }
      throw err;
    }
    // The balance needs an account-level key; a key limited to its zone still searches, so its absence is no failure.
    try {
      const balance = await call(creds, 'GET', '/customer/balance', io);
      return { balanceUsd: isRecord(balance) ? (num(balance.balance) ?? null) : null };
    } catch {
      return { balanceUsd: null };
    }
  },

  async searchLocations(_creds, countryCode, query) {
    return countryOnlyLocations(countryCode, query);
  },
};
