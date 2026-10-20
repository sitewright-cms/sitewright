import type { RankProviderId } from '@sitewright/schema';
import { dataForSeo } from './dataforseo.js';
import type { RankProvider } from './types.js';

export * from './types.js';

/** Every provider the platform can use, by id. A new provider is a client module plus an entry here. */
export const RANK_PROVIDERS: Readonly<Record<RankProviderId, RankProvider>> = {
  dataforseo: dataForSeo,
};
