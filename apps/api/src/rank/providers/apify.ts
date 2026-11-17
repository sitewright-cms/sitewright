import { parse as secureJsonParse } from 'secure-json-parse';
import type { RankLocationOption } from '@sitewright/schema';
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

/**
 * Apify's official Google Search Results Scraper (`apify/google-search-scraper`), as an alternative to DataForSEO.
 *
 * - Searches that share every setting (country, place, language, device, depth) go into ONE actor run: its `queries`
 *   input takes one search per line. The run is STARTED by `submit` and READ by `collect` once it has finished.
 * - The actor writes one dataset record per results page (about ten results), so a depth of 100 asks for ten pages
 *   (`maxPagesPerQuery`); Google may serve fewer, and `pagesRead` says how many came back.
 * - Pay per event: each scraped results page is charged ("from $1.80 / 1,000", $3.50 on the listing's base rate),
 *   with no charge for platform usage. What the run reports it cost (`usageTotalUsd`, "what you actually pay", or its
 *   per-event `eventUsage`, whichever is more) replaces the estimate booked at sending, shared out among the run's
 *   searches by the pages each one took — never below the cheapest plan's rate for those pages, and never above the
 *   run's cap. Every run is capped (`maxTotalChargeUsd`) at twice its estimate, so a misbehaving run cannot spend past
 *   the budget's reach.
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

/** The pages a search asks for: Google serves ten results a page. */
const pagesFor = (depth: number): number => Math.max(1, Math.ceil(depth / 10));

/** The actor's input for one group of searches that share their settings. */
function runInput(group: RankSearch[]): Json {
  const s = group[0]!;
  const terms = [...new Set(group.map((g) => termOf(g.keyword)))];
  // A country alone is the bare country name; anything more specific carries the country after commas.
  const place = s.location.name.includes(',') ? { locationUule: uuleFor(s.location.name) } : {};
  return {
    queries: terms.join('\n'),
    countryCode: s.location.countryCode.toLowerCase(),
    languageCode: s.languageCode,
    ...place,
    mobileResults: s.device === 'mobile',
    maxPagesPerQuery: pagesFor(s.depth),
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
    const key = JSON.stringify([s.location.countryCode, s.location.name.includes(',') ? s.location.name : '', s.languageCode, s.device, pagesFor(s.depth)]);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.values()];
}

const estimate = (depth: number): number => PRICE_PER_PAGE_USD * pagesFor(depth);

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

/** A featured snippet's link, wherever the record carries one. */
function snippetUrls(item: Json): string[] {
  const out: string[] = [];
  for (const s of [item.featuredSnippet, ...(Array.isArray(item.featuredSnippets) ? item.featuredSnippets : [])]) {
    const url = isRecord(s) ? str(s.url) : undefined;
    if (url) out.push(url);
  }
  return out;
}

/**
 * One search's results pages as entries. Positions are counted here, page after page, rather than taken from the
 * actor — whether its numbering restarts on each page is not documented. A featured snippet sits above the page's
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
    for (const url of snippets) push('featured_snippet', url);
    for (const r of records(page.organicResults)) {
      const url = str(r.url);
      if (!url) continue;
      const snippet = /featured/i.test(str(r.type) ?? '');
      // Google does not repeat a snippet's page among the ordinary results; should the actor list it twice, counting
      // both would push every result after it one place down.
      if (!snippet && snippets.includes(url)) continue;
      push(snippet ? 'featured_snippet' : 'organic', url);
    }
  }
  return entries;
}

/**
 * What a finished run says it cost: the larger of its total (`usageTotalUsd`) and the sum of its per-event charges
 * (`eventUsage`) — which of the two carries a pay-per-event actor's charge is not spelled out, and booking the smaller
 * could let the budget run past what is really spent. Undefined when the run states neither.
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
 * shared the search — held between the cheapest plan's rate and the run's cap for those pages.
 */
function shareOf(charged: number, pages: number, totalPages: number, shares: number): number {
  const share = totalPages > 0 ? (charged * pages) / totalPages / shares : 0;
  const floor = (MIN_PRICE_PER_PAGE_USD * pages) / shares;
  const cap = (RUN_CHARGE_CAP * PRICE_PER_PAGE_USD * pages) / shares;
  return Math.min(cap, Math.max(floor, share));
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

  estimateCostUsd(depth) {
    return estimate(depth);
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
      const cap = RUN_CHARGE_CAP * estimate(group[0]!.depth) * terms.size;
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
        // A lost reply may have started the run, which may then spend up to its cap; any other refusal certainly did not.
        const possiblyPaid = err.kind === 'unavailable';
        for (const s of group) out.push({ checkId: s.checkId, state: 'failed', error: err.message, costUsd: possiblyPaid ? RUN_CHARGE_CAP * estimate(s.depth) : 0 });
        if (err.kind === 'auth' || err.kind === 'funds') stopped = err;
        continue;
      }
      if (!runId || !ID_RE.test(runId)) {
        // Taken (2xx) but unreadable: the run may exist, and spend up to its cap.
        for (const s of group) out.push({ checkId: s.checkId, state: 'failed', error: UNREADABLE, costUsd: RUN_CHARGE_CAP * estimate(s.depth) });
        continue;
      }
      const shares = new Map<string, number>();
      for (const s of group) shares.set(termOf(s.keyword), (shares.get(termOf(s.keyword)) ?? 0) + 1);
      for (const s of group) {
        out.push({ checkId: s.checkId, state: 'queued', ref: refOf(runId, shares.get(termOf(s.keyword))!, s.keyword), costUsd: estimate(s.depth) });
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
          const cost = charged === undefined ? {} : { costUsd: shareOf(charged, own.length, totalPages, c.shares) };
          out.set(c.checkId, { checkId: c.checkId, state: 'done', page: { checkedAt, entries: entriesOf(own), pagesRead: own.length }, ...cost });
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
    if (!/^[A-Z]{2}$/.test(countryCode)) throw new RankProviderError('a country is an ISO code such as NA', 'invalid');
    let name: string | undefined;
    try {
      name = new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode);
    } catch {
      name = undefined;
    }
    if (!name || name === countryCode) return [];
    const q = query.trim().toLowerCase();
    const country: RankLocationOption = { name, type: 'Country', countryCode };
    return !q || name.toLowerCase().includes(q) ? [country] : [];
  },
};
