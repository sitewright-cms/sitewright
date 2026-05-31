import { z } from 'zod';

// Stock-image search/import domain types. Provider API keys live in instance
// settings (see instance-settings.ts `stock`); these are the request/result shapes
// for the project-scoped search + import endpoints and MCP tools.

/** Supported stock providers. `openverse` needs no key; the others need an instance key. */
export const StockProviderNameSchema = z.enum(['openverse', 'unsplash', 'pexels']);
export type StockProviderName = z.infer<typeof StockProviderNameSchema>;

/** A normalized search hit (provider-agnostic). `thumbUrl` is the provider CDN preview. */
export interface StockResult {
  provider: StockProviderName;
  /** Provider-specific id; passed back to `import`. */
  id: string;
  thumbUrl: string;
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
  provider: StockProviderName;
  page: number;
  results: StockResult[];
}

/** Which providers are usable on this instance (openverse always; others if keyed). */
export interface StockProvidersStatus {
  providers: Array<{ name: StockProviderName; available: boolean; requiresKey: boolean }>;
}

/** The import request body: pick a provider result by id, optional alt text. */
export const StockImportSchema = z.object({
  provider: StockProviderNameSchema,
  id: z.string().min(1).max(256),
  alt: z.string().max(500).optional(),
});
export type StockImport = z.infer<typeof StockImportSchema>;
