import { z } from 'zod';
import { MediaFolderSchema } from './media.js';

// Stock-image search/import domain types. Provider API keys live in instance
// settings (see instance-settings.ts `stock`); these are the request/result shapes
// for the project-scoped search + import endpoints and MCP tools.

/** Supported stock providers. `openverse` needs no key; the others need an instance key. */
export const StockProviderNameSchema = z.enum(['openverse', 'unsplash', 'pexels']);
export type StockProviderName = z.infer<typeof StockProviderNameSchema>;

/**
 * What a SEARCH may target: one provider, or `all` to fan out across every available one.
 *
 * Search-only. An IMPORT always names a concrete provider — ids are unique only WITHIN a provider,
 * so `all` could not identify a photo; each hit carries its own `StockResult.provider` for that.
 */
export const StockSearchProviderSchema = z.enum(['openverse', 'unsplash', 'pexels', 'all']);
export type StockSearchProvider = z.infer<typeof StockSearchProviderSchema>;

/**
 * A normalized search hit (provider-agnostic).
 *
 * Three image URLs, all provider-hosted, in ascending size: `thumbUrl` for the grid tile,
 * `previewUrl` for the full-size lightbox (~1000px — big enough to judge the photo, small enough
 * to load on hover), and the true original, which is never exposed here: `import` re-resolves it
 * server-side by id so the client can't point the downloader at a URL of its choosing.
 */
export interface StockResult {
  provider: StockProviderName;
  /** Provider-specific id; passed back to `import`. */
  id: string;
  thumbUrl: string;
  /** A larger rendition for the full-size preview. Falls back to `thumbUrl` if the provider has none. */
  previewUrl: string;
  width: number;
  height: number;
  author: string;
  authorUrl?: string;
  /** The photo's page on the provider (for attribution). */
  sourceUrl: string;
  /** Human-readable license, e.g. "Unsplash License", "CC BY 2.0". */
  license: string;
}

export interface StockSearchResult {
  /** Echoes what was searched — a provider name, or `all` for a fan-out. */
  provider: StockSearchProvider;
  page: number;
  results: StockResult[];
  /** True when at least one provider filled its page, i.e. asking for `page + 1` is worth doing. */
  hasMore: boolean;
  /**
   * Providers that failed for THIS query, in `all` mode. A fan-out never fails as a whole while any
   * provider answered — a dead upstream is reported here instead of 502-ing the search. Absent (or
   * empty) when everything answered. A single-provider search still throws.
   */
  errors?: Array<{ provider: StockProviderName; error: string }>;
}

/** Which providers are usable on this instance (openverse always; others if keyed). */
export interface StockProvidersStatus {
  providers: Array<{ name: StockProviderName; available: boolean; requiresKey: boolean }>;
}

/** The import request body: pick a provider result by id, optional alt text + target folder. */
export const StockImportSchema = z.object({
  provider: StockProviderNameSchema,
  id: z.string().min(1).max(256),
  alt: z.string().max(500).optional(),
  /** Virtual folder to import into ('' = root). */
  folder: MediaFolderSchema.optional(),
});
export type StockImport = z.infer<typeof StockImportSchema>;
