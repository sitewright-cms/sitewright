import { parse as secureJsonParse } from 'secure-json-parse';
import {
  RankProviderError,
  type CollectOutcome,
  type RankCredentials,
  type RankProvider,
  type RankProviderIo,
  type RankSearch,
  type SerpEntry,
  type SubmitOutcome,
} from './types.js';
import { countryOnlyLocations } from './country-locations.js';
import { isGoogleSearchLink, resultUrl } from './google-links.js';

/**
 * Apify's official Google Search Results Scraper (`apify/google-search-scraper`), as an alternative to DataForSEO.
 *
 * - Searches that share every setting (country, place, language, device, depth) go into ONE actor run: its `queries`
 *   input takes one search per line. The run is STARTED by `submit` and READ by `collect` once it has finished.
 * - The actor writes one dataset record per results page (about ten results) and reads `maxPagesPerQuery` of them;
 *   Google may serve fewer, and `pagesRead` says how many came back. A check asks for a few pages at a time
 *   (`RankSearch.startPage`/`pages`). The actor has no offset of its own, so a later stage is sent as a Google search
 *   URL with Google's `start` — measured 2026-11-17, `…&start=10` returned page 2 alone, charged as one page. The
 *   actor numbers that record page 1 (the tracker counts on from the pages before) and files it under the URL's
 *   keyword (`searchQuery.term` "website development namibia"), so it is matched like any other.
 * - Google's own links among the results (its "Map" entry for local searches, `google.com/search?…&udm=…`, which the
 *   actor lists as an organic result) are not results for any site, and are not counted: they put every position
 *   after them one too high.
 * - Pay per event: each scraped results page is charged ("from $1.80 / 1,000", $3.50 on the listing's base rate),
 *   with no charge for platform usage. What the run reports it cost (`usageTotalUsd`, "what you actually pay", or its
 *   per-event `eventUsage`, whichever is more) replaces the estimate booked at sending, shared out among the run's
 *   searches by the pages each one took — never below the cheapest plan's rate for those pages, and never above the
 *   run's cap. Every run is capped (`maxTotalChargeUsd`) at twice its estimate, or at the least cap Apify accepts
 *   ($0.50, its `pricingInfo.minimalMaxTotalChargeUsd`) when that is more: a run that misbehaves is stopped there.
 * - Places: the country goes in as `countryCode`; a place inside it (a Google canonical name such as
 *   `Windhoek,Khomas Region,Namibia`, the form keywords are stored in) as Google's own `uule` location code. Apify has
 *   no list of places, so its location picker offers the country only.
 *
 * ★ Every answer is read defensively, as for DataForSEO: nothing in a reply the account was charged for may throw.
 *
 * https://apify.com/apify/google-search-scraper · https://docs.apify.com/api/v2
 */

const API = 'https://api.apify.com/v2';
const ACTOR = 'apify~google-search-scraper';
/** USD per results page, for the budget check before a run starts. The listing's base rate: plans pay less. */
const PRICE_PER_PAGE_USD = 0.0035;
/**
 * The least a results page is booked at, whatever a run reports: under the cheapest plan's $1.80 per 1,000. A run that
 * reported only platform usage (cents) must not make the month's budget think the searches were nearly free.
 */
const MIN_PRICE_PER_PAGE_USD = 0.0015;
/** A run may cost at most this many times its estimate before Apify stops it. */
const RUN_CHARGE_CAP = 2;
/**
 * The least cap Apify accepts for a run: a lower `maxTotalChargeUsd` is refused outright ("Maximum cost per run is less
 * than the allowed minimum of $0.50"), so a run of a few searches is capped here instead.
 */
const MIN_RUN_CAP_USD = 0.5;
/** The longest a run may take, in seconds: a hundred searches of ten pages finish well inside it. */
const RUN_TIMEOUT_SECS = 3600;
/** The most searches one `submit` may carry (one run per group of settings within it). */
const MAX_BATCH = 100;
/** Dataset records read per request: ten pages for each of two searches, well inside the transport's cap. */
const DATASET_PAGE = 20;
/** Records read per run at most: a hundred searches of ten pages, and slack. */
const DATASET_MAX = 1200;
/**
 * A finished run's figures settle a few seconds after it ends ("the first response after completion can still show
 * preliminary stats, costs, and event counts"): read it once it has been finished this long.
 */
const SETTLE_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 30_000;

/** An Apify object id (runs, datasets): 17 letters and digits. Checked before it goes into a URL path. */
const ID_RE = /^[A-Za-z0-9]{17}$/;
const WEB_URL_RE = /^https?:\/\//i;
const UNREADABLE = 'Apify sent a reply the platform could not read';
const RUNNING = new Set(['READY', 'RUNNING', 'TIMING-OUT', 'ABORTING']);
const ENDED = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED']);

type Json = Record<string, unknown>;
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const records = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isRecord) : []);

/** A provider message, cut down to something safe to store and show: one line, bounded. */
function cleanMessage(raw: unknown): string {
  // eslint-disable-next-line no-control-regex -- deliberately stripping the C0 range
  const text = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() : '';
  return text.slice(0, 200);
}

/** What an HTTP refusal means for the tracker. Apify answers `{ error: { type, message } }`. */
function errorFor(status: number, body: unknown): RankProviderError {
  const err = isRecord(body) && isRecord(body.error) ? body.error : {};
  const type = str(err.type) ?? '';
  const said = cleanMessage(err.message);
  const detail = said ? ` (${said})` : ` (HTTP ${status})`;
  if (status === 401) return new RankProviderError('Apify refused the API token', 'auth');
  // Before the credit check: a rate limit's type (`rate-limit-exceeded`) also reads as a limit.
  if (status === 429) return new RankProviderError('Apify is limiting the request rate; trying again later', 'rate');
  if (status === 402 || /usage|credit|payment/i.test(type)) {
    return new RankProviderError(`Apify has no credit left for this run; add credit or raise the usage limit${detail}`, 'funds');
  }
  if (status === 403) return new RankProviderError(`Apify does not allow this token to run the Google Search Results Scraper${detail}`, 'auth');
  if (status >= 500) return new RankProviderError(`Apify is unavailable (HTTP ${status})`, 'unavailable');
  return new RankProviderError(`Apify refused the request${detail}`, 'invalid');
}

async function call(creds: RankCredentials, method: 'GET' | 'POST', path: string, io: RankProviderIo, body?: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), io.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let res: Awaited<ReturnType<RankProviderIo['fetch']>>;
  let text: string;
  try {
    res = await io.fetch(`${API}${path}`, {
      method,
      // ★ The token goes in the header, never the URL: a URL ends up in logs.
      headers: { authorization: `Bearer ${creds.token}`, accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    text = await res.text();
  } catch {
    throw new RankProviderError('Apify could not be reached', 'unavailable');
  } finally {
    clearTimeout(timer);
  }
  let parsed: unknown;
  try {
    parsed = text ? secureJsonParse(text, undefined, { protoAction: 'remove', constructorAction: 'remove' }) : undefined;
  } catch {
    if (res.status >= 400) throw errorFor(res.status, undefined);
    throw new RankProviderError(`${UNREADABLE} (HTTP ${res.status})`, 'unavailable');
  }
  if (res.status >= 400) throw errorFor(res.status, parsed);
  return parsed;
}

/** Apify's `{ data: … }` envelope. */
const dataOf = (env: unknown): Json => (isRecord(env) && isRecord(env.data) ? env.data : {});

/** A keyword as the actor reports it back: what a dataset record is matched on. */
const termOf = (raw: string): string => raw.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

function varint(n: number): Buffer {
  const out: number[] = [];
  let v = n;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v) byte |= 0x80;
    out.push(byte);
  } while (v);
  return Buffer.from(out);
}

/**
 * Google's `uule` location code for a canonical place name — the protobuf Google itself sends (role 2, producer 32,
 * the name in field 4), base64-encoded after `w+`. `Berlin` gives the well-known `w+CAIQICIGQmVybGlu`.
 * @internal exported for tests
 */
export function uuleFor(canonicalName: string): string {
  const name = Buffer.from(canonicalName, 'utf8');
  return `w+${Buffer.concat([Buffer.from([0x08, 0x02, 0x10, 0x20, 0x22]), varint(name.length), name]).toString('base64')}`;
}

/** A country alone is the bare country name; anything more specific carries the country after commas. */
const placeOf = (s: RankSearch): string => (s.location.name.includes(',') ? s.location.name : '');

/**
 * A later stage's search, as the Google search URL the actor accepts in place of a keyword: Google's own `start` offset
 * (results, ten a page), the country, language and place. `q` first, the order Google itself writes.
 */
function searchUrlOf(term: string, s: RankSearch): string {
  const q = encodeURIComponent(term).replace(/%20/g, '+');
  const place = placeOf(s);
  const uule = place ? `&uule=${encodeURIComponent(uuleFor(place))}` : '';
  return `https://www.google.com/search?q=${q}&gl=${encodeURIComponent(s.location.countryCode.toLowerCase())}&hl=${encodeURIComponent(s.languageCode)}&start=${(s.startPage - 1) * 10}${uule}`;
}

/** The actor's input for one group of searches that share their settings. */
function runInput(group: RankSearch[]): Json {
  const s = group[0]!;
  const terms = [...new Set(group.map((g) => termOf(g.keyword)))];
  const place = placeOf(s);
  const first = s.startPage <= 1;
  return {
    // The first page by keyword (the actor sets the place); later pages by URL (its place goes in the URL).
    queries: (first ? terms : terms.map((t) => searchUrlOf(t, s))).join('\n'),
    countryCode: s.location.countryCode.toLowerCase(),
    languageCode: s.languageCode,
    ...(first && place ? { locationUule: uuleFor(place) } : {}),
    mobileResults: s.device === 'mobile',
    maxPagesPerQuery: Math.max(1, s.pages),
    includeUnfilteredResults: false,
    saveHtml: false,
    saveHtmlToKeyValueStore: false,
    maximumLeadsEnrichmentRecords: 0,
  };
}

/** Searches grouped by every setting the actor takes once per run. */
function groupsOf(searches: readonly RankSearch[]): RankSearch[][] {
  const groups = new Map<string, RankSearch[]>();
  for (const s of searches) {
    const key = JSON.stringify([s.location.countryCode, placeOf(s), s.languageCode, s.device, s.startPage, s.pages]);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.values()];
}

const estimate = (pages: number): number => PRICE_PER_PAGE_USD * Math.max(1, pages);

/** The most a run of `terms` searches of `pages` pages may be charged: twice its estimate, never under Apify's least cap. */
const runCapOf = (pages: number, terms: number): number => Math.max(MIN_RUN_CAP_USD, RUN_CHARGE_CAP * estimate(pages) * terms);

/**
 * A queued search's reference: the run, how many checks share its term in that run (two projects tracking the same
 * search are one query), and the term its results are filed under. The share count travels with each check, so each
 * books its part of the term's cost whichever pass collects it.
 */
const refOf = (runId: string, shares: number, keyword: string): string => `${runId}:${shares}:${termOf(keyword)}`;
const REF_RE = /^([A-Za-z0-9]{17}):([1-9][0-9]{0,2}):(.{1,200})$/s;
function parseRef(ref: string): { runId: string; shares: number; term: string } | null {
  const m = REF_RE.exec(ref);
  return m ? { runId: m[1]!, shares: Number(m[2]), term: m[3]! } : null;
}

/** The results pages of one run, by term: each term's records in page order. */
async function readDataset(creds: RankCredentials, datasetId: string, io: RankProviderIo): Promise<Map<string, Json[]>> {
  const byTerm = new Map<string, Json[]>();
  for (let offset = 0; offset < DATASET_MAX; offset += DATASET_PAGE) {
    // `omit`, not `fields`: how the actor names a featured snippet is not documented, and a field list would drop it.
    // Not `clean`: it drops empty records, and a page that comes back short would end the paging early.
    const params = new URLSearchParams({
      format: 'json',
      omit: 'html,websiteContent,aiModeResult,relatedQueries,paidResults,paidProducts,peopleAlsoAsk',
      offset: String(offset),
      limit: String(DATASET_PAGE),
    });
    const items = records(await call(creds, 'GET', `/datasets/${datasetId}/items?${params}`, io));
    for (const item of items) {
      const query = isRecord(item.searchQuery) ? item.searchQuery : {};
      const term = str(query.term);
      if (!term) continue;
      const key = termOf(term);
      byTerm.set(key, [...(byTerm.get(key) ?? []), item]);
    }
    if (items.length < DATASET_PAGE) break;
  }
  for (const pages of byTerm.values()) pages.sort((a, b) => pageNumber(a) - pageNumber(b));
  return byTerm;
}

const pageNumber = (item: Json): number => num(isRecord(item.searchQuery) ? item.searchQuery.page : undefined) ?? 1;

/**
 * A featured snippet's link, wherever the record carries one. ★ Measured 2026-11-17: no record had a snippet field,
 * not even on searches that usually show one (Google showed an AI Overview, `aiOverview`, instead), so these names are
 * a guess that costs nothing when absent.
 */
function snippetUrls(item: Json): string[] {
  const out: string[] = [];
  for (const s of [item.featuredSnippet, ...(Array.isArray(item.featuredSnippets) ? item.featuredSnippets : [])]) {
    const url = isRecord(s) ? str(s.url) : undefined;
    if (url) out.push(url);
  }
  return out;
}

/** Google served nothing past these pages: the last came back empty, or says there is no next page. */
function endOf(pages: readonly Json[]): boolean {
  const last = pages.at(-1);
  if (!last) return true;
  return last.hasNextPage === false || records(last.organicResults).length === 0;
}

/**
 * One search's results pages as entries. Positions are counted here, page after page, rather than taken from the
 * actor. Measured 2026-11-17, the actor numbers on from page to page (page 2 starting at 7 after six results), which
 * gives the same count, but that is not documented. A featured snippet sits above the page's
 * first ordinary result (`absolutePosition` keeps the order on the page); a result the actor types as a snippet counts
 * as one too.
 */
function entriesOf(pages: readonly Json[]): SerpEntry[] {
  const entries: SerpEntry[] = [];
  let organic = 0;
  let snippets = 0;
  let order = 0;
  const push = (kind: SerpEntry['kind'], url: string): void => {
    if (!WEB_URL_RE.test(url)) return;
    const position = kind === 'organic' ? ++organic : ++snippets;
    entries.push({ kind, position, absolutePosition: ++order, url: url.slice(0, 2048), domain: '' });
  };
  for (const page of pages) {
    const snippets = snippetUrls(page);
    for (const link of snippets) push('featured_snippet', resultUrl(link) ?? link);
    for (const r of records(page.organicResults)) {
      const link = str(r.url);
      if (!link || isGoogleSearchLink(link)) continue;
      const snippet = /featured/i.test(str(r.type) ?? '');
      // Google does not repeat a snippet's page among the ordinary results; should the actor list it twice, counting
      // both would push every result after it one place down. Told by the link as given (see Bright Data's `linksOf`).
      if (!snippet && snippets.includes(link)) continue;
      // A result Google wrapped in its own redirect is read by the site it names (see google-links.ts).
      push(snippet ? 'featured_snippet' : 'organic', resultUrl(link, str(r.displayedUrl)) ?? link);
    }
  }
  return entries;
}

/**
 * What a finished run says it cost: the larger of its total (`usageTotalUsd`) and the sum of its per-event charges
 * (`eventUsage`). Measured 2026-11-17, the total carried both (25 pages at $0.0025 and the $0.00005 start: $0.06255),
 * but that is not spelled out, and booking the smaller could let the budget run past what is really spent. Undefined
 * when the run states neither.
 */
function runCharge(run: Json): number | undefined {
  const total = num(run.usageTotalUsd);
  const events = isRecord(run.eventUsage) ? Object.values(run.eventUsage) : Array.isArray(run.eventUsage) ? run.eventUsage : [];
  const perEvent = events.map((e) => (isRecord(e) ? num(e.eventTotalUsd) : undefined)).filter((n): n is number => n !== undefined);
  if (total === undefined && perEvent.length === 0) return undefined;
  return Math.max(0, total ?? 0, perEvent.reduce((a, b) => a + b, 0));
}

/**
 * One check's part of a run's charge: its pages' share of every page the run read, split between the checks that
 * shared the search — held between the cheapest plan's rate and the run's cap. The cap is the one the run reports it
 * was started with (`options.maxTotalChargeUsd`); for a run that does not say, the one it would have been given for the
 * pages it read.
 */
function shareOf(charged: number, pages: number, totalPages: number, shares: number, runCap: number | undefined): number {
  if (totalPages <= 0) return 0;
  const part = pages / totalPages / shares;
  const floor = (MIN_PRICE_PER_PAGE_USD * pages) / shares;
  const cap = runCap !== undefined && runCap > 0 ? runCap : Math.max(MIN_RUN_CAP_USD, RUN_CHARGE_CAP * PRICE_PER_PAGE_USD * totalPages);
  return Math.min(cap * part, Math.max(floor, charged * part));
}

function parseCredentials(raw: Readonly<Record<string, string>>): RankCredentials {
  const token = (raw.token ?? '').trim();
  if (!token || token.length > 200 || /\s/.test(token)) throw new RankProviderError('Enter the Apify API token', 'invalid');
  return { token };
}

export const apify: RankProvider = {
  id: 'apify',
  label: 'Apify (Google Search Results Scraper)',
  signupUrl: 'https://console.apify.com/sign-up',
  fields: [
    {
      key: 'token',
      label: 'API token',
      type: 'secret',
      required: true,
      help: 'Apify Console → Settings → API & Integrations → Personal API tokens. Searches are run by the Google Search Results Scraper and charged to that account per results page. New keywords are tracked by country (Apify has no list of places); keywords already tracked for a city keep it.',
    },
  ],
  maxBatch: MAX_BATCH,

  parseCredentials,

  estimateCostUsd(pages) {
    return estimate(pages);
  },

  async submit(creds, searches, io) {
    if (searches.length === 0) return [];
    if (searches.length > MAX_BATCH) throw new RankProviderError(`at most ${MAX_BATCH} searches per request`, 'invalid');
    const out: SubmitOutcome[] = [];
    // The actor reads a line that starts with an address as a page to open, not a search: never send one.
    const addresses = searches.filter((s) => /^https?:\/\//i.test(s.keyword.trim()));
    for (const s of addresses) out.push({ checkId: s.checkId, state: 'failed', error: 'Apify cannot search for a web address; track it without the http:// part', costUsd: 0 });
    const groups = groupsOf(searches.filter((s) => !addresses.includes(s)));
    if (groups.length === 0) return out;
    /** An account-wide refusal (token, credit): the groups after it are not tried, and fail unsent. */
    let stopped: RankProviderError | undefined;
    for (const [i, group] of groups.entries()) {
      if (stopped) {
        for (const s of group) out.push({ checkId: s.checkId, state: 'failed', error: stopped.message, costUsd: 0 });
        continue;
      }
      const terms = new Set(group.map((g) => termOf(g.keyword)));
      const cap = runCapOf(group[0]!.pages, terms.size);
      const params = new URLSearchParams({ timeout: String(RUN_TIMEOUT_SECS), maxTotalChargeUsd: cap.toFixed(4) });
      let runId: string | undefined;
      try {
        runId = str(dataOf(await call(creds, 'POST', `/acts/${ACTOR}/runs?${params}`, io, runInput(group))).id);
      } catch (err) {
        if (!(err instanceof RankProviderError)) throw err;
        // ★ Thrown only while nothing has gone out, as one request would be: an account refusal (the tracker gives every
        // claim back and shows the admin why), or — when this is the only run — a lost reply (kept as possibly paid).
        // Past that, throwing would make the tracker give back claims for runs already being charged, or book runs never
        // started: each group answers for itself instead.
        const accountWide = err.kind === 'auth' || err.kind === 'funds' || err.kind === 'rate';
        if (i === 0 && (accountWide || groups.length === 1)) throw err;
        // A lost reply may have started the run; any other refusal certainly did not. A started run is charged per page,
        // so it is booked at twice its estimate, not at its cap: Apify's $0.50 least cap is no measure of what it costs.
        const possiblyPaid = err.kind === 'unavailable';
        for (const s of group) out.push({ checkId: s.checkId, state: 'failed', error: err.message, costUsd: possiblyPaid ? RUN_CHARGE_CAP * estimate(s.pages) : 0 });
        if (err.kind === 'auth' || err.kind === 'funds') stopped = err;
        continue;
      }
      if (!runId || !ID_RE.test(runId)) {
        // Taken (2xx) but unreadable: the run may exist, and spend up to its cap.
        for (const s of group) out.push({ checkId: s.checkId, state: 'failed', error: UNREADABLE, costUsd: RUN_CHARGE_CAP * estimate(s.pages) });
        continue;
      }
      const shares = new Map<string, number>();
      for (const s of group) shares.set(termOf(s.keyword), (shares.get(termOf(s.keyword)) ?? 0) + 1);
      for (const s of group) {
        out.push({ checkId: s.checkId, state: 'queued', ref: refOf(runId, shares.get(termOf(s.keyword))!, s.keyword), costUsd: estimate(s.pages) });
      }
    }
    return out;
  },

  async collect(creds, queued, io) {
    const out = new Map<string, CollectOutcome>();
    const byRun = new Map<string, Array<{ checkId: string; term: string; shares: number }>>();
    for (const q of queued) {
      const ref = parseRef(q.ref);
      if (!ref) {
        out.set(q.checkId, { checkId: q.checkId, state: 'failed', error: 'the stored run reference is not one Apify issues' });
        continue;
      }
      byRun.set(ref.runId, [...(byRun.get(ref.runId) ?? []), { checkId: q.checkId, term: ref.term, shares: ref.shares }]);
    }
    for (const [runId, checks] of byRun) {
      const pending = (): void => checks.forEach((c) => out.set(c.checkId, { checkId: c.checkId, state: 'pending' }));
      const failAll = (error: string): void => checks.forEach((c) => out.set(c.checkId, { checkId: c.checkId, state: 'failed', error }));
      try {
        const run = dataOf(await call(creds, 'GET', `/actor-runs/${runId}`, io));
        const status = str(run.status) ?? '';
        if (RUNNING.has(status)) {
          pending();
          continue;
        }
        if (!ENDED.has(status)) {
          failAll(UNREADABLE);
          continue;
        }
        const finishedAt = Date.parse(str(run.finishedAt) ?? '');
        if (Number.isFinite(finishedAt) && Date.now() - finishedAt < SETTLE_MS) {
          pending(); // its charge is still settling
          continue;
        }
        const datasetId = str(run.defaultDatasetId);
        // A run that failed or was stopped may still have read some pages — and was charged for them.
        const pages = datasetId && ID_RE.test(datasetId) ? await readDataset(creds, datasetId, io) : new Map<string, Json[]>();
        const startedAt = Date.parse(str(run.startedAt) ?? '');
        const checkedAt = Number.isFinite(startedAt) ? new Date(startedAt) : new Date();
        const charged = runCharge(run);
        const runCap = num(isRecord(run.options) ? run.options.maxTotalChargeUsd : undefined);
        // The run's charge is for EVERY page it read, whichever of its checks this pass happens to ask about.
        const totalPages = [...pages.values()].reduce((sum, p) => sum + p.length, 0);
        for (const c of checks) {
          const own = pages.get(c.term) ?? [];
          if (own.length === 0) {
            // No pages filed under this term — none read, or filed under a term spelled differently. Either way the
            // estimate booked at sending stays: the run may well have been charged for it.
            const why = status === 'SUCCEEDED' ? 'Apify returned no results pages for this search' : `the Apify run ended ${status.toLowerCase()} before this search was read`;
            out.set(c.checkId, { checkId: c.checkId, state: 'failed', error: why });
            continue;
          }
          const cost = charged === undefined ? {} : { costUsd: shareOf(charged, own.length, totalPages, c.shares, runCap) };
          const page = { checkedAt, entries: entriesOf(own), pagesRead: own.length, ...(endOf(own) ? { end: true } : {}) };
          out.set(c.checkId, { checkId: c.checkId, state: 'done', page, ...cost });
        }
      } catch (err) {
        if (!(err instanceof RankProviderError)) throw err;
        // The account as a whole (token, credit) is the admin's to fix: say so. Anything passing stays queued.
        if (err.kind === 'auth' || err.kind === 'funds') throw err;
        if (err.kind === 'invalid') failAll(err.message);
        else pending();
      }
    }
    return queued.map((q): CollectOutcome => out.get(q.checkId) ?? { checkId: q.checkId, state: 'pending' });
  },

  async account(creds, io) {
    const limits = dataOf(await call(creds, 'GET', '/users/me/limits', io));
    const max = num(isRecord(limits.limits) ? limits.limits.maxMonthlyUsageUsd : undefined);
    const used = num(isRecord(limits.current) ? limits.current.monthlyUsageUsd : undefined);
    return { balanceUsd: max !== undefined && used !== undefined ? Math.max(0, max - used) : null };
  },

  async searchLocations(_creds, countryCode, query) {
    return countryOnlyLocations(countryCode, query);
  },
};
