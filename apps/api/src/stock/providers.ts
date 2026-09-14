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
  /** Results this provider returns per page — its own upstream maximum, not a shared one. The
   *  service uses it to decide whether another page exists (a FULL page means "ask for more"). */
  readonly pageSize: number;
  search(query: string, page: number, key: string | null): Promise<StockResult[]>;
  resolve(id: string, key: string | null): Promise<ResolvedStock | null>;
}

// Per-provider page sizes: each upstream's own limit, not a lowest-common-denominator. 20 is the
// hard cap for Openverse's keyless (anonymous) tier — an anonymous request with page_size > 20 is
// rejected with 401 — while Unsplash allows 30 and Pexels 80. Taking each provider's own maximum
// means a single-provider search shows as much as that provider will give, and a fan-out still
// interleaves cleanly (round-robin tolerates uneven list lengths).
const OPENVERSE_PAGE_SIZE = 20;
const UNSPLASH_PAGE_SIZE = 30;
// Pexels permits 80, but 30 keeps a fan-out page balanced and the grid quick to scan; `hasMore`
// + "Load more" reaches the rest.
const PEXELS_PAGE_SIZE = 30;
// Pixabay accepts 3-200; 30 for the same reason as Pexels.
const PIXABAY_PAGE_SIZE = 30;
/** Pixabay rejects a `q` over 100 characters with a 400 (documented). The route allows 200. */
const PIXABAY_MAX_QUERY = 100;
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
  // Only the STATUS is carried out of here. The body can be an upstream error page, and for Pixabay
  // the request URL itself holds the API key — neither ever reaches a log line or the client.
  if (!res.ok) throw new StockProviderError(`provider request failed (${res.status})`, res.status);
  return res.json();
}

/** A provider-call failure (bad upstream response/status). Maps to 502 at the route. */
export class StockProviderError extends Error {
  constructor(
    message: string,
    /** The upstream HTTP status, when the failure was one. Lets a caller tell a REJECTED KEY
     *  (400/401/403) from an upstream that is merely down, which are different problems. */
    readonly status?: number,
  ) {
    super(message);
  }
}

// --- Openverse (CC-licensed, no API key) -------------------------------------
export class OpenverseProvider implements StockProvider {
  readonly name = 'openverse' as const;
  readonly requiresKey = false;
  readonly pageSize = OPENVERSE_PAGE_SIZE;
  constructor(private readonly fetchImpl: FetchLike) {}

  // Openverse needs no key, so it ignores the StockProvider `key` arg entirely
  // (a narrower signature still satisfies the interface; callers may pass a key).
  async search(query: string, page: number): Promise<StockResult[]> {
    const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page=${page}&page_size=${OPENVERSE_PAGE_SIZE}`;
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
    // Openverse offers only the ~600px proxy thumbnail and the original — no mid-size rendition.
    previewUrl: httpsUrl(r.url) || thumbUrl,
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
  readonly pageSize = UNSPLASH_PAGE_SIZE;
  constructor(private readonly fetchImpl: FetchLike) {}

  async search(query: string, page: number, key: string | null): Promise<StockResult[]> {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&page=${page}&per_page=${UNSPLASH_PAGE_SIZE}`;
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
    // Take the FULL-resolution rendition. `regular` is only ~1080px wide, which is visibly soft in a
    // full-bleed hero and cannot serve a 2x srcset — and the import caps at STOCK_IMPORT_CAP anyway,
    // so the bytes are bounded on our side rather than by picking a small upstream size. `full` (the
    // original at q=75) over `raw` (uncompressed original): same pixels, a fraction of the download.
    const downloadUrl = httpsUrl(urls.full) || httpsUrl(urls.raw) || httpsUrl(urls.regular);
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
    previewUrl: httpsUrl(urls.regular) || httpsUrl(urls.small) || thumbUrl,
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
  readonly pageSize = PEXELS_PAGE_SIZE;
  constructor(private readonly fetchImpl: FetchLike) {}

  async search(query: string, page: number, key: string | null): Promise<StockResult[]> {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&page=${page}&per_page=${PEXELS_PAGE_SIZE}`;
    const data = (await getJson(this.fetchImpl, url, { Authorization: key ?? '' })) as { photos?: unknown[] };
    const rows = Array.isArray(data.photos) ? data.photos : [];
    return rows.map((r) => pexelsResult(r as Record<string, unknown>)).filter((r): r is StockResult => r !== null);
  }

  async resolve(id: string, key: string | null): Promise<ResolvedStock | null> {
    const data = (await getJson(this.fetchImpl, `https://api.pexels.com/v1/photos/${encodeURIComponent(id)}`, {
      Authorization: key ?? '',
    })) as Record<string, unknown>;
    const src = (data.src ?? {}) as Record<string, unknown>;
    // `original` is the full-resolution file; large2x (1880px) / large (940px) are fallbacks only.
    const downloadUrl = httpsUrl(src.original) || httpsUrl(src.large2x) || httpsUrl(src.large);
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
    previewUrl: httpsUrl(src.large) || httpsUrl(src.large2x) || httpsUrl(src.original) || thumbUrl,
    width: num(r.width),
    height: num(r.height),
    author: str(r.photographer) || 'Unknown',
    ...(httpsUrl(r.photographer_url) ? { authorUrl: httpsUrl(r.photographer_url) } : {}),
    sourceUrl: httpsUrl(r.url) || thumbUrl,
    license: 'Pexels License',
  };
}

// --- Pixabay -----------------------------------------------------------------
/**
 * Pixabay authenticates with the key as a QUERY PARAMETER (`?key=`), not a header — the one
 * provider here that does. Two consequences the code has to respect:
 *  - the request URL is a secret. It is never logged, never put in an error message, and never
 *    returned to the client; `getJson` only ever reports the STATUS.
 *  - the download URLs it hands back (cdn.pixabay.com / pixabay.com/get/…) carry no key, so the
 *    import path is unaffected.
 *
 * Hotlinking: Pixabay permits its URLs for *temporarily displaying search results* only, which is
 * exactly what the picker's grid + lightbox do — an import downloads the file to our own storage
 * before anything is published. `webformatURL` is documented as valid for 24h; nothing persists it.
 */
export class PixabayProvider implements StockProvider {
  readonly name = 'pixabay' as const;
  readonly requiresKey = true;
  readonly pageSize = PIXABAY_PAGE_SIZE;
  constructor(private readonly fetchImpl: FetchLike) {}

  async search(query: string, page: number, key: string | null): Promise<StockResult[]> {
    // `image_type=photo`: the sibling providers are photo-only, and Pixabay's vector hits resolve to
    // SVG, which the image store refuses outright (librsvg fetches remote refs — an SSRF vector).
    // `safesearch=true`: Unsplash filters by default, Pixabay does not unless asked.
    const url =
      `https://pixabay.com/api/?key=${encodeURIComponent(key ?? '')}` +
      `&q=${encodeURIComponent(clampPixabayQuery(query))}` +
      `&image_type=photo&safesearch=true&page=${page}&per_page=${PIXABAY_PAGE_SIZE}`;
    const data = (await getJson(this.fetchImpl, url)) as { hits?: unknown[] };
    const rows = Array.isArray(data.hits) ? data.hits : [];
    return rows.map((r) => pixabayResult(r as Record<string, unknown>)).filter((r): r is StockResult => r !== null);
  }

  async resolve(id: string, key: string | null): Promise<ResolvedStock | null> {
    // Lookup-by-id is the same endpoint with `&id=`; the single hit still arrives inside `hits`.
    const url = `https://pixabay.com/api/?key=${encodeURIComponent(key ?? '')}&id=${encodeURIComponent(id)}`;
    const data = (await getJson(this.fetchImpl, url)) as { hits?: unknown[] };
    const hit = (Array.isArray(data.hits) ? data.hits[0] : undefined) as Record<string, unknown> | undefined;
    if (!hit) return null;
    // ★ Resolution ceiling depends on the INSTANCE'S KEY. `imageURL` (the original) and `fullHDURL`
    // (1920px) are only present for accounts Pixabay has approved for "full API access"; a standard
    // key tops out at `largeImageURL` = 1280px. Preferring the big ones means an approved key
    // automatically imports at full resolution with no code change, and a standard one still works.
    const downloadUrl = httpsUrl(hit.imageURL) || httpsUrl(hit.fullHDURL) || httpsUrl(hit.largeImageURL);
    if (!downloadUrl) return null;
    return {
      downloadUrl,
      attribution: {
        provider: 'pixabay',
        author: str(hit.user) || 'Unknown',
        sourceUrl: httpsUrl(hit.pageURL) || downloadUrl,
        license: PIXABAY_LICENSE,
      },
    };
  }
}

/** Pixabay's own name for its terms; no attribution is required, but we record it like the rest. */
const PIXABAY_LICENSE = 'Pixabay Content License';

/**
 * Clamp to Pixabay's documented 100-character `q` limit, on a word boundary where there is one.
 * Without this the one provider with the shorter limit 400s on a query the other three handled,
 * and a fan-out reports it as "Pixabay did not respond" — a broken-upstream message for a query
 * that was merely long.
 */
function clampPixabayQuery(query: string): string {
  if (query.length <= PIXABAY_MAX_QUERY) return query;
  const cut = query.slice(0, PIXABAY_MAX_QUERY);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}

/**
 * Pixabay publishes no author URL, only a name + numeric id; the profile URL is documented as
 * `https://pixabay.com/users/{USERNAME}-{ID}/`. Built only when both halves are present.
 */
function pixabayUserUrl(r: Record<string, unknown>): string {
  const user = str(r.user);
  const userId = num(r.user_id);
  if (!user || !userId) return '';
  return `https://pixabay.com/users/${encodeURIComponent(user)}-${userId}/`;
}

function pixabayResult(r: Record<string, unknown>): StockResult | null {
  const id = idStr(r.id);
  // `webformatURL` (<=640px) for the tile: `previewURL` is only 150px, which is visibly soft in the
  // grid on a 2x display. `largeImageURL` (1280px) for the lightbox, matching the other providers.
  const thumbUrl = httpsUrl(r.webformatURL) || httpsUrl(r.previewURL);
  if (!id || !thumbUrl) return null;
  const authorUrl = pixabayUserUrl(r);
  return {
    provider: 'pixabay',
    id,
    thumbUrl,
    previewUrl: httpsUrl(r.largeImageURL) || httpsUrl(r.webformatURL) || thumbUrl,
    // imageWidth/imageHeight are the ORIGINAL's dimensions — what the preview panel should report,
    // and what the author is judging when deciding whether a photo is big enough for a hero.
    width: num(r.imageWidth),
    height: num(r.imageHeight),
    author: str(r.user) || 'Unknown',
    ...(authorUrl ? { authorUrl } : {}),
    sourceUrl: httpsUrl(r.pageURL) || thumbUrl,
    license: PIXABAY_LICENSE,
  };
}

/** Builds the default provider registry backed by the live `fetch`. */
export function defaultStockProviders(fetchImpl: FetchLike = fetch as unknown as FetchLike): Map<StockProviderName, StockProvider> {
  return new Map<StockProviderName, StockProvider>([
    ['openverse', new OpenverseProvider(fetchImpl)],
    ['unsplash', new UnsplashProvider(fetchImpl)],
    ['pexels', new PexelsProvider(fetchImpl)],
    ['pixabay', new PixabayProvider(fetchImpl)],
  ]);
}
