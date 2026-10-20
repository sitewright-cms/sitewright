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
  /** How many results to read. */
  depth: number;
}

/** One result on a results page. */
export interface SerpEntry {
  kind: 'organic' | 'featured_snippet';
  /** Position among results of the same kind: organic 1 = the first ordinary result. */
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
  entries: SerpEntry[];
}

/** What sending one search produced. `costUsd` is what the provider charged for it. */
export type SubmitOutcome =
  | { checkId: string; state: 'queued'; ref: string; costUsd: number }
  | { checkId: string; state: 'done'; page: SerpPage; costUsd: number }
  | { checkId: string; state: 'failed'; error: string; costUsd: number };

/** What asking for one queued search produced. */
export type CollectOutcome =
  | { checkId: string; state: 'pending' }
  | { checkId: string; state: 'done'; page: SerpPage }
  | { checkId: string; state: 'failed'; error: string };

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
  /** Validates and normalizes the fields; throws `RankProviderError('invalid')` naming what is wrong. */
  parseCredentials(raw: Readonly<Record<string, string>>): RankCredentials;
  /** The price of one search at this depth, for the budget check before sending. The provider's answer has the real one. */
  estimateCostUsd(depth: number, creds: RankCredentials): number;
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
