import type { StockProviderName, StockResult } from '@sitewright/schema';

/** Minimal fetch surface (so tests inject canned responses instead of hitting the network). */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
  headers: { get(name: string): string | null };
}>;

export interface ProviderAttribution {
  provider: StockProviderName;
  author: string;
  sourceUrl: string;
  license: string;
}

/** A resolved-by-id stock photo: where to download the full image + its attribution. */
export interface ResolvedStock {
  downloadUrl: string;
  attribution: ProviderAttribution;
}

/** A stock-image provider. `key` is the instance API key (null for keyless providers). */
export interface StockProvider {
  readonly name: StockProviderName;
  readonly requiresKey: boolean;
  search(query: string, page: number, key: string | null): Promise<StockResult[]>;
  resolve(id: string, key: string | null): Promise<ResolvedStock | null>;
}

// 20 is the hard cap for Openverse's keyless (anonymous) tier: an anonymous request
// with page_size > 20 is rejected with 401. Unsplash (max 30) and Pexels (max 80)
// both accept 20, so one shared page size keeps all three providers working.
const PAGE_SIZE = 20;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** Provider-supplied URL, but only if it is https — else '' (defense-in-depth: these
 * land in the editor as <img src> / future <a href>; non-https is dropped). */
const httpsUrl = (v: unknown): string => (/^https:\/\//i.test(str(v)) ? str(v) : '');
/** A stock id: integer-valued numbers are truncated to an int string (provider ids are ints). */
const idStr = (v: unknown): string =>
  typeof v === 'number' && Number.isFinite(v) ? String(Math.trunc(v)) : str(v);

async function getJson(fetchImpl: FetchLike, url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetchImpl(url, headers ? { headers } : undefined);
  if (!res.ok) throw new StockProviderError(`provider request failed (${res.status})`);
  return res.json();
}

/** A provider-call failure (bad upstream response/status). Maps to 502 at the route. */
export class StockProviderError extends Error {}

// --- Openverse (CC-licensed, no API key) -------------------------------------
export class OpenverseProvider implements StockProvider {
  readonly name = 'openverse' as const;
  readonly requiresKey = false;
  constructor(private readonly fetchImpl: FetchLike) {}

  // Openverse needs no key, so it ignores the StockProvider `key` arg entirely
  // (a narrower signature still satisfies the interface; callers may pass a key).
  async search(query: string, page: number): Promise<StockResult[]> {
    const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page=${page}&page_size=${PAGE_SIZE}`;
    const data = (await getJson(this.fetchImpl, url)) as { results?: unknown[] };
    const rows = Array.isArray(data.results) ? data.results : [];
    return rows.map((r) => openverseResult(r as Record<string, unknown>)).filter((r): r is StockResult => r !== null);
  }

  async resolve(id: string): Promise<ResolvedStock | null> {
    const data = (await getJson(this.fetchImpl, `https://api.openverse.org/v1/images/${encodeURIComponent(id)}/`)) as Record<string, unknown>;
    const downloadUrl = httpsUrl(data.url);
    if (!downloadUrl) return null;
    return {
      downloadUrl,
      attribution: {
        provider: 'openverse',
        author: str(data.creator) || 'Unknown',
        sourceUrl: httpsUrl(data.foreign_landing_url) || downloadUrl,
        license: `${str(data.license).toUpperCase()} ${str(data.license_version)}`.trim() || 'CC',
      },
    };
  }
}

function openverseResult(r: Record<string, unknown>): StockResult | null {
  const id = str(r.id);
  const thumbUrl = httpsUrl(r.thumbnail) || httpsUrl(r.url);
  if (!id || !thumbUrl) return null;
  return {
    provider: 'openverse',
    id,
    thumbUrl,
    width: num(r.width),
    height: num(r.height),
    author: str(r.creator) || 'Unknown',
    ...(httpsUrl(r.creator_url) ? { authorUrl: httpsUrl(r.creator_url) } : {}),
    sourceUrl: httpsUrl(r.foreign_landing_url) || thumbUrl,
    license: `${str(r.license).toUpperCase()} ${str(r.license_version)}`.trim() || 'CC',
  };
}

// --- Unsplash ----------------------------------------------------------------
export class UnsplashProvider implements StockProvider {
  readonly name = 'unsplash' as const;
  readonly requiresKey = true;
  constructor(private readonly fetchImpl: FetchLike) {}

  async search(query: string, page: number, key: string | null): Promise<StockResult[]> {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&page=${page}&per_page=${PAGE_SIZE}`;
    const data = (await getJson(this.fetchImpl, url, { Authorization: `Client-ID ${key ?? ''}` })) as { results?: unknown[] };
    const rows = Array.isArray(data.results) ? data.results : [];
    return rows
      .map((r) => unsplashResult(r as Record<string, unknown>))
      .filter((r): r is StockResult => r !== null);
  }

  async resolve(id: string, key: string | null): Promise<ResolvedStock | null> {
    const data = (await getJson(this.fetchImpl, `https://api.unsplash.com/photos/${encodeURIComponent(id)}`, {
      Authorization: `Client-ID ${key ?? ''}`,
    })) as Record<string, unknown>;
    const urls = (data.urls ?? {}) as Record<string, unknown>;
    // Prefer `regular` (~1080px, web-sized) over `full`/`raw` originals: the pipeline
    // re-encodes to AVIF/WebP anyway, so a multi-MB original would just waste bandwidth
    // (and could exceed the download size cap) for no quality gain at typical web sizes.
    const downloadUrl = httpsUrl(urls.regular) || httpsUrl(urls.full) || httpsUrl(urls.raw);
    if (!downloadUrl) return null;
    const user = (data.user ?? {}) as Record<string, unknown>;
    const links = (data.links ?? {}) as Record<string, unknown>;
    return {
      downloadUrl,
      attribution: {
        provider: 'unsplash',
        author: str(user.name) || 'Unknown',
        sourceUrl: httpsUrl(links.html) || downloadUrl,
        license: 'Unsplash License',
      },
    };
  }
}

function unsplashResult(r: Record<string, unknown>): StockResult | null {
  const id = str(r.id);
  const urls = (r.urls ?? {}) as Record<string, unknown>;
  const thumbUrl = httpsUrl(urls.thumb) || httpsUrl(urls.small);
  if (!id || !thumbUrl) return null;
  const user = (r.user ?? {}) as Record<string, unknown>;
  const userLinks = (user.links ?? {}) as Record<string, unknown>;
  const links = (r.links ?? {}) as Record<string, unknown>;
  return {
    provider: 'unsplash',
    id,
    thumbUrl,
    width: num(r.width),
    height: num(r.height),
    author: str(user.name) || 'Unknown',
    ...(httpsUrl(userLinks.html) ? { authorUrl: httpsUrl(userLinks.html) } : {}),
    sourceUrl: httpsUrl(links.html) || thumbUrl,
    license: 'Unsplash License',
  };
}

// --- Pexels ------------------------------------------------------------------
export class PexelsProvider implements StockProvider {
  readonly name = 'pexels' as const;
  readonly requiresKey = true;
  constructor(private readonly fetchImpl: FetchLike) {}

  async search(query: string, page: number, key: string | null): Promise<StockResult[]> {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&page=${page}&per_page=${PAGE_SIZE}`;
    const data = (await getJson(this.fetchImpl, url, { Authorization: key ?? '' })) as { photos?: unknown[] };
    const rows = Array.isArray(data.photos) ? data.photos : [];
    return rows.map((r) => pexelsResult(r as Record<string, unknown>)).filter((r): r is StockResult => r !== null);
  }

  async resolve(id: string, key: string | null): Promise<ResolvedStock | null> {
    const data = (await getJson(this.fetchImpl, `https://api.pexels.com/v1/photos/${encodeURIComponent(id)}`, {
      Authorization: key ?? '',
    })) as Record<string, unknown>;
    const src = (data.src ?? {}) as Record<string, unknown>;
    const downloadUrl = httpsUrl(src.large2x) || httpsUrl(src.large) || httpsUrl(src.original);
    if (!downloadUrl) return null;
    return {
      downloadUrl,
      attribution: {
        provider: 'pexels',
        author: str(data.photographer) || 'Unknown',
        sourceUrl: httpsUrl(data.url) || downloadUrl,
        license: 'Pexels License',
      },
    };
  }
}

function pexelsResult(r: Record<string, unknown>): StockResult | null {
  const id = idStr(r.id);
  const src = (r.src ?? {}) as Record<string, unknown>;
  const thumbUrl = httpsUrl(src.medium) || httpsUrl(src.small) || httpsUrl(src.tiny);
  if (!id || !thumbUrl) return null;
  return {
    provider: 'pexels',
    id,
    thumbUrl,
    width: num(r.width),
    height: num(r.height),
    author: str(r.photographer) || 'Unknown',
    ...(httpsUrl(r.photographer_url) ? { authorUrl: httpsUrl(r.photographer_url) } : {}),
    sourceUrl: httpsUrl(r.url) || thumbUrl,
    license: 'Pexels License',
  };
}

/** Builds the default provider registry backed by the live `fetch`. */
export function defaultStockProviders(fetchImpl: FetchLike = fetch as unknown as FetchLike): Map<StockProviderName, StockProvider> {
  return new Map<StockProviderName, StockProvider>([
    ['openverse', new OpenverseProvider(fetchImpl)],
    ['unsplash', new UnsplashProvider(fetchImpl)],
    ['pexels', new PexelsProvider(fetchImpl)],
  ]);
}
