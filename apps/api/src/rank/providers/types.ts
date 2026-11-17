import type {
  RankDevice,
  RankEngine,
  RankLocation,
  RankLocationOption,
  RankProviderField,
  RankProviderId,
} from '@sitewright/schema';
import type { FetchLike } from '../../payments/executor.js';

export type { FetchLike };

/**
 * THE RANK-PROVIDER CONTRACT.
 *
 * A provider runs searches and hands back results pages. That is all it does: deciding where the project's site
 * appears on a page happens in the platform (`../match.ts`), identically for every provider, so a keyword's
 * history keeps its meaning when an admin switches providers.
 *
 * Searches may finish at once (a "live" API) or later (a queue): `submit` answers each one `done` or `queued`,
 * and `collect` is asked again for the queued ones until they finish. The platform keeps the queue state in its
 * own table, so a restart loses nothing.
 */

/** One search to run. `checkId` is the platform's id for it and comes back in every outcome. */
export interface RankSearch {
  checkId: string;
  keyword: string;
  engine: RankEngine;
  device: RankDevice;
  location: RankLocation;
  languageCode: string;
  /**
   * The results pages to read: `startPage` (1 = the first) and the `pages` from there. A check reads its depth in stages
   * (`rankStages`) and asks for the next only when these did not hold the site, so a provider reads exactly these.
   */
  startPage: number;
  pages: number;
}

/** One result on a results page. */
export interface SerpEntry {
  kind: 'organic' | 'featured_snippet';
  /** Position among results of the same KIND, as providers number them (organic 1 = the first ordinary result); `../match.ts` turns it into Google's count. */
  position: number;
  /** Position among every element of the page. */
  absolutePosition: number;
  url: string;
  /** The result's host as the provider reports it (may include `www.`). */
  domain: string;
}

export interface SerpPage {
  /** When the search engine was queried. */
  checkedAt: Date;
  /**
   * The results of the pages asked for, numbered from the first of THEM (a request for pages 3–5 starts at 1): the
   * tracker adds the results of the stages before it, so positions count the way they would in one long read.
   */
  entries: SerpEntry[];
  /**
   * Results pages the provider fetched, when it says. Google serves ten results a page and often stops after a few,
   * so a search for 100 may come back with 30: a site not among them is not "outside the top 100".
   */
  pagesRead?: number;
  /** Google has no results past these (it stopped serving pages): the check reads no further. */
  end?: boolean;
  /**
   * The provider stopped before the last page asked for, for a reason of its own (a refusal partway): the pages read are
   * kept, and the check reads on from them on a later pass — fewer pages than asked do not mean Google stopped.
   */
  cut?: boolean;
}

/**
 * What sending one search produced. `costUsd` is what the provider charged for it. A failure with `retry` is one the
 * provider could not run and did not charge for (a challenge page, a query refused for a moment): it is tried again
 * later the same day. Without it a failure is final for the day.
 */
export type SubmitOutcome =
  | { checkId: string; state: 'queued'; ref: string; costUsd: number }
  | { checkId: string; state: 'done'; page: SerpPage; costUsd: number }
  | { checkId: string; state: 'failed'; error: string; costUsd: number; retry?: boolean }
  /**
   * Never sent, so never charged: the provider stopped before it (a refusal for the whole account partway through a
   * request). The claim is given back, the refusal shown to the admin, and the search tried again on a later pass.
   */
  | { checkId: string; state: 'unsent'; error: string };

/**
 * What asking for one queued search produced. `costUsd`, when present, is what the provider says the search cost and
 * replaces the figure booked at sending — for a provider that only knows the charge once the work is done (Apify).
 */
export type CollectOutcome =
  | { checkId: string; state: 'pending' }
  | { checkId: string; state: 'done'; page: SerpPage; costUsd?: number }
  | { checkId: string; state: 'failed'; error: string; costUsd?: number; retry?: boolean };

/**
 * The provider refused, or could not be reached for, a whole request (not one search in it).
 *
 * `kind` decides what happens next: `auth` and `funds` stop sending until an admin acts; `rate` and
 * `unavailable` are tried again on the next pass; `invalid` is a request the provider will never accept.
 * ★ The message is shown to admins, so it never carries a credential, a URL or a response body.
 */
export class RankProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'funds' | 'rate' | 'invalid' | 'unavailable',
  ) {
    super(message);
    this.name = 'RankProviderError';
  }
}

export interface RankProviderIo {
  /** Every request: its answer is capped small (a results page, a balance). */
  fetch: FetchLike;
  /** The few requests whose answer runs to megabytes (a country's location list); `fetch` when absent. */
  largeFetch?: FetchLike;
  /** The deadline for one request to the provider. */
  timeoutMs?: number;
  /** Waits before a request is tried again (tests pass one that does not wait). */
  sleep?: (ms: number) => Promise<void>;
}

/** A provider's credential fields, already checked by {@link RankProvider.parseCredentials}. */
export type RankCredentials = Readonly<Record<string, string>>;

export interface RankProvider {
  id: RankProviderId;
  label: string;
  /** Where an admin signs up and finds the credentials. */
  signupUrl: string;
  fields: readonly RankProviderField[];
  /** The most searches one `submit` may carry. */
  maxBatch: number;
  /**
   * How many days after a search its stored result can be fetched again through `collect`, FREE of charge — or absent
   * when it cannot. Used once, to fill in what checks made before `pagesRead` and featured snippets were recorded did
   * not keep. ★ Only a provider that charges for sending, never for reading, may set it.
   */
  freeRereadDays?: number;
  /** Validates and normalizes the fields; throws `RankProviderError('invalid')` naming what is wrong. */
  parseCredentials(raw: Readonly<Record<string, string>>): RankCredentials;
  /** The price of reading `pages` results pages, for the budget check before sending. The provider's answer has the real one. */
  estimateCostUsd(pages: number, creds: RankCredentials): number;
  submit(creds: RankCredentials, searches: readonly RankSearch[], io: RankProviderIo): Promise<SubmitOutcome[]>;
  collect(
    creds: RankCredentials,
    queued: ReadonlyArray<{ checkId: string; ref: string }>,
    io: RankProviderIo,
  ): Promise<CollectOutcome[]>;
  /** Proves the credentials work; the balance, when the provider reports one. */
  account(creds: RankCredentials, io: RankProviderIo): Promise<{ balanceUsd: number | null }>;
  /** Places in one country whose name contains `query`, for the keyword form's location picker. */
  searchLocations(
    creds: RankCredentials,
    countryCode: string,
    query: string,
    io: RankProviderIo,
  ): Promise<RankLocationOption[]>;
}
