import { parse as secureJsonParse } from 'secure-json-parse';
import { countryOnlyLocations } from './country-locations.js';
import { isGoogleSearchLink, opaqueRedirect, resultUrl } from './google-links.js';
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
 *   (Search, Maps) left out, and a result Google wrapped in its own redirect read by the site it names
 *   (`google-links.ts`: measured 2026-11-17, some pages came back with EVERY organic link a `google.com/goto`).
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
const MAX_BATCH = 50;
/**
 * Searches read at once, unless the admin sets another number (up to {@link MAX_CONCURRENCY}). A page takes about three
 * seconds, so ten at once read some 200 pages a minute — far under the 1,000 requests a minute Bright Data allows even
 * an unfunded account. Identical searches are read once (see `submit`): Bright Data refuses the same query sent twice
 * at once.
 */
const DEFAULT_CONCURRENCY = 10;
const MAX_CONCURRENCY = 20;
const DEFAULT_TIMEOUT_MS = 30_000;
const ZONE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const WEB_URL_RE = /^https?:\/\//i;
const UNREADABLE = 'Bright Data sent results the platform could not read';

type Json = Record<string, unknown>;
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const records = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isRecord) : []);

/**
 * A query Bright Data will not try again for 15 seconds, because it just failed or was just sent (its 429s
 * `failed_query_rejected` and `repeat_query_rejected`): that query's trouble alone, not the account's rate.
 */
class QueryRejected extends RankProviderError {
  constructor() {
    super('Bright Data could not run this search just now', 'unavailable');
    this.name = 'QueryRejected';
  }
}

/**
 * What an HTTP refusal means for the tracker. Bright Data's own error codes ride in headers the transport does not keep,
 * so a 429 is told apart by its words — matched, never shown or kept.
 */
function errorFor(status: number, body: string): RankProviderError {
  if (status === 401 || status === 407) return new RankProviderError('Bright Data refused the API key or the zone', 'auth');
  if (status === 402) return new RankProviderError('Bright Data has no funds left for this request; add funds or wait for next month’s free requests', 'funds');
  if (status === 403) return new RankProviderError('Bright Data does not allow this request: check the zone is a SERP API zone, and the account’s balance', 'auth');
  if (status === 429 && /this query (recently failed|cannot be attempted)/i.test(body)) return new QueryRejected();
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

/** An answer that came back but could not be read: possibly billed, and tried again. */
class UnreadableAnswer extends PossiblyBilled {}

/**
 * An EMPTY answer: Bright Data's own failure, reported in headers the transport does not keep. Measured 2026-11-17: HTTP
 * 200, no body, `x-brd-status-code: 502`, `x-brd-error-code: captcha` (Google challenged that exit). Not billed ("none
 * of the errors in this catalog are billed"), and tried again.
 */
class EmptyAnswer extends RankProviderError {
  constructor() {
    super('Bright Data could not run the search (an empty answer)', 'unavailable');
    this.name = 'EmptyAnswer';
  }
}

/**
 * Tries of one page before it fails, and the wait between them. Measured 2026-11-17: some queries came back EMPTY (Google
 * challenged the exit; see {@link EmptyAnswer}) on one request in four or more, then were refused for 15 seconds ("this
 * query recently failed"), and answered properly on a later try. Bright Data's own advice is to wait at least 15 seconds.
 */
const PAGE_TRIES = 3;
const RETRY_WAIT_MS = 16_000;
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
  if (res.status >= 400) throw errorFor(res.status, text);
  if (!text) throw new EmptyAnswer();
  try {
    return secureJsonParse(text, undefined, { protoAction: 'remove', constructorAction: 'remove' }) as unknown;
  } catch {
    // Taken (2xx), so billed: but nothing to read.
    throw new UnreadableAnswer(`${UNREADABLE} (not JSON)`);
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

/**
 * A result's address: its link, or — when Google wrapped it in a redirect — the site it names, and the redirect as
 * `via` when it hides the page. A wrapped result that names no site keeps its link: it still holds its place among the
 * results, it is just no one's to find.
 */
function addressOf(r: Json): Address | undefined {
  const link = str(r.link);
  if (!link || !WEB_URL_RE.test(link)) return undefined;
  const url = resultUrl(link, str(r.display_link)) ?? link;
  const via = url !== link ? opaqueRedirect(link) : undefined;
  return via ? { url, via } : { url };
}

interface Address {
  url: string;
  via?: string;
}

/**
 * One results page's links, in Google's order: featured snippets, then organic results — a snippet's page not twice.
 * Duplicates are told by the link as Google gave it: two wrapped results of one site both read as its home page, and
 * are still two results.
 */
function linksOf(results: Json): Array<Address & { kind: SerpEntry['kind'] }> {
  const out: Array<Address & { kind: SerpEntry['kind'] }> = [];
  const snippetLinks = new Set<string>();
  for (const f of records(results.featured_snippets)) {
    const address = addressOf(f);
    if (!address) continue;
    snippetLinks.add(str(f.link)!);
    out.push({ kind: 'featured_snippet', ...address });
  }
  const organic = records(results.organic).sort((a, b) => (num(a.global_rank) ?? 0) - (num(b.global_rank) ?? 0));
  for (const r of organic) {
    const link = str(r.link);
    if (!link || isGoogleSearchLink(link) || snippetLinks.has(link)) continue;
    const address = addressOf(r);
    if (address) out.push({ kind: 'organic', ...address });
  }
  return out;
}

/**
 * Google has a page after this one, by any sign the parsed pagination gives: a next page, its offset or link, or a later
 * page in its list. Without pagination it is assumed while results came — the check stops only on a clear end.
 */
function hasNextPage(results: Json): boolean {
  const p = results.pagination;
  if (!isRecord(p)) return true;
  if (num(p.next_page) !== undefined || num(p.next_page_start) !== undefined || str(p.next_page_link) !== undefined) return true;
  const current = num(p.current_page) ?? 0;
  return records(p.pages).some((x) => (num(x.page) ?? 0) > current);
}

type SearchResult =
  /** Its pages read — all of them, or (`page.cut`) those before a failure partway. */
  | { state: 'done'; page: SerpPage; billedPages: number }
  /** `retry`: Bright Data could not run it and charged nothing — worth trying again later (see `SubmitOutcome`). */
  | { state: 'failed'; error: string; billedPages: number; retry?: boolean }
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
  const sleep = io.sleep ?? wait;
  /** Answers that came back (so may have been billed) but held no results, and were tried again. */
  let unread = 0;
  for (let i = 0; i < s.pages && !end; i++) {
    if (stop.error) return pages + unread === 0 ? { state: 'unsent' } : partway(pages + unread);
    /** Stopped for an account-wide refusal elsewhere while this page waited to be tried again. */
    const stopped = (): SearchResult =>
      pages > 0 ? partway(pages + unread) : unread > 0 ? { state: 'failed', error: stop.error!.message, billedPages: unread } : { state: 'unsent' };
    let results: Json | null = null;
    for (let attempt = 1; !results; attempt++) {
      if (attempt > 1) {
        await sleep(RETRY_WAIT_MS);
        if (stop.error) return stopped();
      }
      const again = attempt < PAGE_TRIES;
      let answer: unknown;
      try {
        answer = await call(creds, 'POST', '/request', io, { zone: creds.zone, url: searchUrlFor(s, s.startPage + i), format: 'raw', country: s.location.countryCode.toLowerCase() });
      } catch (err) {
        if (!(err instanceof RankProviderError)) throw err;
        // An answer that came back but could not be read may have been billed; an empty one, or a query refused for a
        // moment, was not. All three are tried again after Bright Data's wait.
        if (err instanceof UnreadableAnswer) unread++;
        if (again && (err instanceof UnreadableAnswer || err instanceof EmptyAnswer || err instanceof QueryRejected)) continue;
        // A lost reply may have been billed; a request Bright Data refused or could not run was not.
        const billed = pages + unread + (err instanceof PossiblyBilled && !(err instanceof UnreadableAnswer) ? 1 : 0);
        if (accountWide(err)) stop.error ??= err;
        if (pages > 0) return partway(billed);
        if (billed === 0 && accountWide(err)) return { state: 'refused', error: err };
        // Not run and not charged — an empty answer, a query refused for a moment, Bright Data failing (5xx): later today
        // may go better. A request refused for itself (400) would only be refused again.
        const couldNotRun = err instanceof EmptyAnswer || err instanceof QueryRejected || (err.kind === 'unavailable' && !(err instanceof PossiblyBilled));
        return { state: 'failed', error: err.message, billedPages: billed, ...(couldNotRun && billed === 0 ? { retry: true } : {}) };
      }
      results = resultsOf(answer);
      if (results) break;
      // Taken (2xx), so possibly billed, but no list of results in it: tried again.
      unread++;
      if (again) continue;
      return pages > 0 ? partway(pages + unread) : { state: 'failed', error: `${UNREADABLE} (no list of results)`, billedPages: unread };
    }
    pages++;
    checkedAt ??= (() => {
      const general = isRecord(results.general) ? results.general : {};
      const at = Date.parse(str(general.timestamp) ?? '');
      return Number.isFinite(at) ? new Date(at) : new Date();
    })();
    const links = linksOf(results);
    for (const l of links) {
      const position = l.kind === 'organic' ? ++organic : ++snippets;
      entries.push({ kind: l.kind, position, absolutePosition: ++order, url: l.url.slice(0, 2048), domain: '', ...(l.via ? { via: l.via.slice(0, 2048) } : {}) });
    }
    if (links.length === 0 || !hasNextPage(results)) end = true;
  }
  return { state: 'done', billedPages: pages + unread, page: { checkedAt: checkedAt ?? new Date(), entries, pagesRead: pages, ...(end ? { end: true } : {}) } };
}

function parseCredentials(raw: Readonly<Record<string, string>>): RankCredentials {
  const apiKey = (raw.apiKey ?? '').trim();
  if (!apiKey || apiKey.length > 300 || /\s/.test(apiKey)) throw new RankProviderError('Enter the Bright Data API key', 'invalid');
  const zone = (raw.zone ?? '').trim();
  if (!ZONE_RE.test(zone)) throw new RankProviderError('Enter the SERP API zone’s name: letters, digits, _ and - only', 'invalid');
  const out: Record<string, string> = { apiKey, zone };
  const priceRaw = (raw.pricePer1000 ?? '').trim().replace(',', '.');
  if (priceRaw) {
    const price = Number(priceRaw);
    // Above zero: a free price would leave the monthly budget nothing to count, and real charges past the free requests
    // would then go unchecked.
    if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE_PER_1000_USD) {
      throw new RankProviderError(`The price per 1,000 requests is a number of dollars above 0, up to ${MAX_PRICE_PER_1000_USD}`, 'invalid');
    }
    out.pricePer1000 = String(price);
  }
  const concurrencyRaw = (raw.concurrency ?? '').trim();
  if (concurrencyRaw) {
    const n = Number(concurrencyRaw);
    if (!Number.isInteger(n) || n < 1 || n > MAX_CONCURRENCY) {
      throw new RankProviderError(`Searches at once is a whole number from 1 to ${MAX_CONCURRENCY}`, 'invalid');
    }
    out.concurrency = String(n);
  }
  return out;
}

const concurrencyOf = (creds: RankCredentials): number => {
  const n = Number(creds.concurrency);
  return Number.isInteger(n) && n >= 1 && n <= MAX_CONCURRENCY ? n : DEFAULT_CONCURRENCY;
};

/** What makes two searches the same request: two projects tracking one keyword in one place read it once. */
const requestKey = (s: RankSearch): string =>
  JSON.stringify([s.keyword.trim().toLowerCase(), s.location.name, s.location.countryCode, s.languageCode, s.device, s.startPage, s.pages]);

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
    {
      key: 'zone',
      label: 'SERP API zone',
      type: 'text',
      required: true,
      help: 'The zone’s name as it appears in the control panel, such as serp_api1. In the zone’s Configuration: default data format Full JSON (Light JSON leaves out featured snippets); Google Ads Standard; custom headers and cookies off (with them, failed requests are billed too); asynchronous requests off.',
    },
    {
      key: 'pricePer1000',
      label: 'Price per 1,000 requests (USD)',
      type: 'text',
      required: false,
      help: `What the budget books per results page. Leave empty for the pay-as-you-go $${DEFAULT_PRICE_PER_1000_USD.toFixed(2)}.`,
    },
    {
      key: 'concurrency',
      label: 'Searches at once',
      type: 'text',
      required: false,
      help: `How many searches are read at the same time: more finish a large pass sooner. Leave empty for ${DEFAULT_CONCURRENCY}; at most ${MAX_CONCURRENCY}.`,
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
    // Identical searches (two projects tracking one keyword in one place) are read ONCE, and share what it cost.
    const groups = new Map<string, RankSearch[]>();
    for (const s of searches) groups.set(requestKey(s), [...(groups.get(requestKey(s)) ?? []), s]);
    const requests = [...groups.values()];
    const results: SearchResult[] = new Array(requests.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < requests.length) {
        const i = next++;
        const s = requests[i]![0]!;
        // The country goes into the URL and routes the search: anything but an ISO code is not sent.
        results[i] = /^[A-Z]{2}$/i.test(s.location.countryCode)
          ? await readSearch(creds, s, io, stop)
          : { state: 'failed', error: 'the keyword’s country is not an ISO code', billedPages: 0 };
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrencyOf(creds), requests.length) }, worker));
    // Refused for the whole account before anything was sent or billed: the request as a whole, so the tracker gives
    // every claim back and shows the admin why.
    if (stop.error && results.every((r) => r.state === 'refused' || r.state === 'unsent')) throw stop.error;
    const out = new Map<string, SubmitOutcome>();
    requests.forEach((group, i) => {
      const r = results[i]!;
      const share = (billed: number): number => (price * billed) / group.length;
      for (const s of group) {
        if (r.state === 'done') out.set(s.checkId, { checkId: s.checkId, state: 'done', page: r.page, costUsd: share(r.billedPages) });
        else if (r.state === 'failed') {
          out.set(s.checkId, { checkId: s.checkId, state: 'failed', error: r.error, costUsd: share(r.billedPages), ...(r.retry ? { retry: true } : {}) });
        } else out.set(s.checkId, { checkId: s.checkId, state: 'unsent', error: r.state === 'refused' ? r.error.message : (stop.error?.message ?? 'not sent') });
      }
    });
    return searches.map((s) => out.get(s.checkId)!);
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
