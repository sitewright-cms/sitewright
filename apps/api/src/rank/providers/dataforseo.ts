import { parse as secureJsonParse } from 'secure-json-parse';
import type { RankLocationOption } from '@sitewright/schema';
import {
  RankProviderError,
  type CollectOutcome,
  type RankCredentials,
  type RankProvider,
  type RankProviderIo,
  type SerpEntry,
  type SerpPage,
  type SubmitOutcome,
} from './types.js';

/**
 * DataForSEO's Google Organic SERP API, Standard queue.
 *
 * - A search is POSTED as a task (up to 100 per request) and its results page COLLECTED later by task id — it
 *   usually finishes within minutes, at worst about 45. The results are kept for 30 days, and only posting is
 *   charged, so collecting again costs nothing.
 * - The price is per page of ten results ($0.0006 on the 2026 price list), so a depth of 100 costs ten pages.
 * - The sandbox host answers in the same format with dummy results, free, with the same credentials.
 *
 * ★ Every answer is read defensively: a `null` in an array, a missing field or a body that is not JSON must
 * never throw halfway through reading an answer the account was already charged for.
 *
 * https://docs.dataforseo.com/v3/serp/google/organic/task_post/
 */

const HOSTS = {
  production: 'https://api.dataforseo.com',
  sandbox: 'https://sandbox.dataforseo.com',
} as const;
type Environment = keyof typeof HOSTS;

/** USD per page of ten results, Standard queue. */
const PRICE_PER_PAGE_USD = 0.0006;
const DEFAULT_TIMEOUT_MS = 30_000;
/** The most tasks one POST may carry. */
const MAX_BATCH = 100;
/** Parallel result requests while collecting. */
const COLLECT_CONCURRENCY = 4;

/** Status codes (https://docs.dataforseo.com/v3/appendix/errors/). */
const OK = 20000;
const TASK_CREATED = 20100;
const STILL_RUNNING = new Set([40601, 40602]);

/** A task id, as DataForSEO issues them. Checked before it goes into a URL path. */
const TASK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A result link the editor may show: an ordinary web address, nothing else. */
const WEB_URL_RE = /^https?:\/\//i;
const UNREADABLE = 'DataForSEO sent a reply the platform could not read';

/** A provider message, cut down to something safe to store and show: one line, bounded. */
function cleanMessage(raw: unknown): string {
  // eslint-disable-next-line no-control-regex -- deliberately stripping the C0 range
  const text = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() : '';
  return text.slice(0, 200);
}

/** What a status code means for the tracker. */
function errorFor(code: number, message: unknown): RankProviderError {
  const said = cleanMessage(message);
  const detail = said ? ` (${code}: ${said})` : ` (${code})`;
  if (code === 40100) return new RankProviderError('DataForSEO refused the API login or password', 'auth');
  if (code === 40104) return new RankProviderError('DataForSEO needs the account verified before it can be used', 'auth');
  if (code === 40207) return new RankProviderError('DataForSEO only accepts this account from listed IP addresses, and this server is not one', 'auth');
  if (code === 40201) return new RankProviderError('DataForSEO has paused this account; contact their support', 'auth');
  if (code === 40200 || code === 40210) return new RankProviderError('The DataForSEO balance is too low; add funds to the account', 'funds');
  if (code === 40203) return new RankProviderError('The daily cost limit set in the DataForSEO account is reached', 'funds');
  if (code === 40202 || code === 40209) return new RankProviderError('DataForSEO is limiting the request rate; trying again later', 'rate');
  if (code >= 50000) return new RankProviderError(`DataForSEO is unavailable${detail}`, 'unavailable');
  return new RankProviderError(`DataForSEO refused the request${detail}`, 'invalid');
}

type Json = Record<string, unknown>;
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Only the objects of an array: a `null` or a string in a provider's list is skipped, never read. */
const records = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isRecord) : []);
const tasksOf = (env: Json): Json[] => records(env.tasks);
const costOf = (task: Json): number => Math.max(0, num(task.cost) ?? 0);

function environmentOf(creds: RankCredentials): Environment {
  return creds.environment === 'sandbox' ? 'sandbox' : 'production';
}

async function call(creds: RankCredentials, method: 'GET' | 'POST', path: string, io: RankProviderIo, body?: unknown): Promise<Json> {
  const url = `${HOSTS[environmentOf(creds)]}${path}`;
  const authorization = `Basic ${Buffer.from(`${creds.login}:${creds.password}`).toString('base64')}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), io.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let res: Awaited<ReturnType<RankProviderIo['fetch']>>;
  let text: string;
  try {
    res = await io.fetch(url, {
      method,
      headers: { authorization, accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    text = await res.text();
  } catch {
    // ★ The transport's own message is not passed on: it is not ours to word, and it names the payments module.
    throw new RankProviderError('DataForSEO could not be reached', 'unavailable');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) throw errorFor(40100, undefined);
  if (res.status === 402) throw errorFor(40200, undefined);
  if (res.status === 429) throw errorFor(40202, undefined);
  // A server error may come after the request was acted on: never read as a clean refusal.
  if (res.status >= 500) throw new RankProviderError(`DataForSEO is unavailable (HTTP ${res.status})`, 'unavailable');
  let env: unknown;
  try {
    env = secureJsonParse(text, undefined, { protoAction: 'remove', constructorAction: 'remove' });
  } catch {
    throw new RankProviderError(`${UNREADABLE} (HTTP ${res.status})`, 'unavailable');
  }
  if (!isRecord(env)) throw new RankProviderError(UNREADABLE, 'unavailable');
  const code = num(env.status_code);
  if (code === undefined) throw new RankProviderError(`${UNREADABLE} (HTTP ${res.status})`, 'unavailable');
  if (code !== OK) throw errorFor(code, env.status_message);
  return env;
}

/** DataForSEO URL-decodes the keyword, so a literal `%` or `+` must arrive encoded. */
function encodeKeyword(keyword: string): string {
  return keyword.replace(/%/g, '%25').replace(/\+/g, '%2B');
}

/** `2026-10-20 12:34:56 +00:00` → a Date; the current time if it cannot be read. */
function parseDatetime(raw: unknown): Date {
  const s = str(raw);
  if (s) {
    const iso = s.replace(' ', 'T').replace(/ ([+-]\d{2}:\d{2})$/, '$1');
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function pageFrom(task: Json): SerpPage {
  const result = records(task.result)[0];
  const entries: SerpEntry[] = [];
  for (const item of records(result?.items)) {
    const kind = item.type === 'organic' || item.type === 'featured_snippet' ? item.type : undefined;
    const position = num(item.rank_group);
    const absolutePosition = num(item.rank_absolute);
    const url = str(item.url);
    if (!kind || position === undefined || absolutePosition === undefined || !url || !WEB_URL_RE.test(url)) continue;
    entries.push({ kind, position, absolutePosition, url: url.slice(0, 2048), domain: str(item.domain) ?? '' });
  }
  return { checkedAt: parseDatetime(result?.datetime), entries };
}

/** Each search's task in a `task_post` answer, matched by the tag the search was sent with. */
function readSubmitted(env: Json, searches: ReadonlyArray<{ checkId: string }>): SubmitOutcome[] {
  const tasks = tasksOf(env);
  const byTag = new Map<string, Json>();
  for (const task of tasks) {
    const tag = isRecord(task.data) ? str(task.data.tag) : undefined;
    if (tag) byTag.set(tag, task);
  }
  // Every task refused for one ACCOUNT reason (credentials, funds) and nothing charged is the whole request
  // refused: thrown, so the tracker gives the claims back instead of spending the day on a cause no retry fixes.
  const refusals = tasks.map((t) => errorFor(num(t.status_code) ?? 0, t.status_message));
  const first = refusals[0];
  if (
    first &&
    (first.kind === 'auth' || first.kind === 'funds') &&
    refusals.every((e) => e.message === first.message) &&
    tasks.every((t) => costOf(t) === 0 && num(t.status_code) !== TASK_CREATED)
  ) {
    throw first;
  }
  return searches.map((s): SubmitOutcome => {
    const task = byTag.get(s.checkId);
    if (!task) return { checkId: s.checkId, state: 'failed', error: 'DataForSEO returned no task for this search', costUsd: 0 };
    const code = num(task.status_code);
    const id = str(task.id);
    if (code === TASK_CREATED && id && TASK_ID_RE.test(id)) return { checkId: s.checkId, state: 'queued', ref: id, costUsd: costOf(task) };
    return { checkId: s.checkId, state: 'failed', error: errorFor(code ?? 0, task.status_message).message, costUsd: costOf(task) };
  });
}

/** Per-country location lists, kept for a day: they are large and change rarely. */
const LOCATION_TTL_MS = 24 * 60 * 60 * 1000;
const LOCATION_CACHE_MAX = 8;
const locationCache = new Map<string, { at: number; list: ReadonlyArray<readonly [name: string, type: string]> }>();
/** Lists being fetched, so concurrent pickers for one country share one download. */
const locationInFlight = new Map<string, Promise<ReadonlyArray<readonly [string, string]>>>();
/** One list download at a time: each is megabytes, held twice (text, then parsed) until it is compacted. */
let locationQueue: Promise<unknown> = Promise.resolve();

/** Places people search from first, then larger areas; postal codes and the like last. */
const TYPE_ORDER = ['City', 'Country', 'Municipality', 'State', 'Province', 'Region', 'County', 'District', 'Neighborhood'];
const typeRank = (type: string): number => {
  const i = TYPE_ORDER.indexOf(type);
  return i < 0 ? TYPE_ORDER.length : i;
};

async function locationList(creds: RankCredentials, countryCode: string, io: RankProviderIo): Promise<ReadonlyArray<readonly [string, string]>> {
  const key = `${environmentOf(creds)}:${countryCode}`;
  const cached = locationCache.get(key);
  if (cached && Date.now() - cached.at < LOCATION_TTL_MS) return cached.list;
  const running = locationInFlight.get(key);
  if (running) return running;
  const load = locationQueue.then(async () => {
    const env = await call(creds, 'GET', `/v3/serp/google/locations/${countryCode.toLowerCase()}`, { ...io, fetch: io.largeFetch ?? io.fetch });
    const list: Array<readonly [string, string]> = [];
    for (const row of records(tasksOf(env)[0]?.result)) {
      const name = str(row.location_name);
      if (name && name.length <= 200 && str(row.country_iso_code)?.toUpperCase() === countryCode) list.push([name, str(row.location_type) ?? '']);
    }
    // An empty list is not kept: more likely a passing fault than a country without places.
    if (list.length > 0) {
      locationCache.delete(key);
      locationCache.set(key, { at: Date.now(), list });
      while (locationCache.size > LOCATION_CACHE_MAX) {
        const oldest = locationCache.keys().next().value;
        if (oldest === undefined) break;
        locationCache.delete(oldest);
      }
    }
    return list;
  });
  locationQueue = load.catch(() => undefined);
  locationInFlight.set(key, load);
  try {
    return await load;
  } finally {
    locationInFlight.delete(key);
  }
}

/** @internal tests */
export function clearDataForSeoLocationCache(): void {
  locationCache.clear();
}

export const dataForSeo: RankProvider = {
  id: 'dataforseo',
  label: 'DataForSEO',
  signupUrl: 'https://app.dataforseo.com/register',
  fields: [
    { key: 'login', label: 'API login', type: 'text', required: true, help: 'On app.dataforseo.com/api-access — usually the account email.' },
    {
      key: 'password',
      label: 'API password',
      type: 'secret',
      required: true,
      help: 'The API password on the same page, not the password you sign in with.',
    },
    {
      key: 'environment',
      label: 'Searches',
      type: 'select',
      required: false,
      options: [
        { value: 'production', label: 'Live searches (charged to the account)' },
        { value: 'sandbox', label: 'Sandbox: free dummy results, for testing' },
      ],
    },
  ],
  maxBatch: MAX_BATCH,

  parseCredentials(raw) {
    const login = (raw.login ?? '').trim();
    const password = raw.password ?? '';
    const environment = (raw.environment ?? 'production').trim() || 'production';
    if (!login || login.length > 200) throw new RankProviderError('Enter the DataForSEO API login', 'invalid');
    if (!password || password.length > 200) throw new RankProviderError('Enter the DataForSEO API password', 'invalid');
    if (environment !== 'production' && environment !== 'sandbox') throw new RankProviderError('Choose live searches or the sandbox', 'invalid');
    return { login, password, environment };
  },

  estimateCostUsd(depth, creds) {
    return environmentOf(creds) === 'sandbox' ? 0 : PRICE_PER_PAGE_USD * Math.ceil(depth / 10);
  },

  async submit(creds, searches, io) {
    if (searches.length === 0) return [];
    if (searches.length > MAX_BATCH) throw new RankProviderError(`at most ${MAX_BATCH} searches per request`, 'invalid');
    const body = searches.map((s) => ({
      keyword: encodeKeyword(s.keyword),
      location_name: s.location.name,
      language_code: s.languageCode,
      device: s.device,
      os: s.device === 'mobile' ? 'android' : 'windows',
      depth: s.depth,
      tag: s.checkId,
    }));
    const env = await call(creds, 'POST', '/v3/serp/google/organic/task_post', io, body);
    try {
      return readSubmitted(env, searches);
    } catch (err) {
      if (err instanceof RankProviderError) throw err;
      // ★ The request WAS taken (status 20000) but its answer cannot be read: the tasks may exist and be
      // charged, so this is `unavailable` — possibly paid — never a clean refusal.
      throw new RankProviderError(UNREADABLE, 'unavailable');
    }
  },

  async collect(creds, queued, io) {
    const out: Array<CollectOutcome | undefined> = new Array(queued.length);
    let next = 0;
    let stop: RankProviderError | undefined;
    const worker = async (): Promise<void> => {
      while (next < queued.length && !stop) {
        const i = next++;
        const q = queued[i]!;
        if (!TASK_ID_RE.test(q.ref)) {
          out[i] = { checkId: q.checkId, state: 'failed', error: 'the stored task id is not one DataForSEO issues' };
          continue;
        }
        try {
          const env = await call(creds, 'GET', `/v3/serp/google/organic/task_get/regular/${q.ref}`, io);
          const task = tasksOf(env)[0];
          const code = task ? num(task.status_code) : undefined;
          if (task && code === OK) out[i] = { checkId: q.checkId, state: 'done', page: pageFrom(task) };
          else if (code !== undefined && STILL_RUNNING.has(code)) out[i] = { checkId: q.checkId, state: 'pending' };
          else out[i] = { checkId: q.checkId, state: 'failed', error: errorFor(code ?? 0, task?.status_message).message };
        } catch (err) {
          if (err instanceof RankProviderError && err.kind !== 'invalid') {
            // The whole account is affected (credentials, funds, rate, outage): stop asking; the rest stays queued.
            stop = err;
            out[i] = { checkId: q.checkId, state: 'pending' };
          } else {
            // Not the provider refusing: an answer that could not be read. Its own message is no admin's business.
            out[i] = { checkId: q.checkId, state: 'failed', error: err instanceof RankProviderError ? err.message : UNREADABLE };
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(COLLECT_CONCURRENCY, queued.length) }, worker));
    if (stop && (stop.kind === 'auth' || stop.kind === 'funds')) throw stop;
    return queued.map((q, i): CollectOutcome => out[i] ?? { checkId: q.checkId, state: 'pending' });
  },

  async account(creds, io) {
    const env = await call(creds, 'GET', '/v3/appendix/user_data', io);
    const first = records(tasksOf(env)[0]?.result)[0];
    return { balanceUsd: isRecord(first?.money) ? (num(first.money.balance) ?? null) : null };
  },

  async searchLocations(creds, countryCode, query, io) {
    if (!/^[A-Z]{2}$/.test(countryCode)) throw new RankProviderError('a country is an ISO code such as NA', 'invalid');
    const list = await locationList(creds, countryCode, io);
    const q = query.trim().toLowerCase();
    const hits: Array<RankLocationOption & { score: number }> = [];
    for (const [name, type] of list) {
      const lower = name.toLowerCase();
      if (q && !lower.includes(q)) continue;
      // A name that STARTS with the query beats one that merely contains it ("Windhoek" before "Windhoek East").
      const score = (q && lower.startsWith(q) ? 0 : 100) + typeRank(type) * 10 + Math.min(9, name.length / 20);
      hits.push({ name, type, countryCode, score });
    }
    hits.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
    return hits.slice(0, 25).map((h) => ({ name: h.name, type: h.type, countryCode: h.countryCode }));
  },
};
