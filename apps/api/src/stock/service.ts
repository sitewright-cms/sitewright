import {
  targetsPrivateHost,
  type StockProviderName,
  type StockProvidersStatus,
  type StockResult,
  type StockSearchProvider,
  type StockSearchResult,
} from '@sitewright/schema';
import { StockProviderError, type ProviderAttribution, type StockProvider } from './providers.js';

/** Max bytes the import will download (matches the media upload cap). */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 10_000;

/**
 * Max stored width for an imported stock photo. Providers are asked for their FULL-resolution file
 * (so a hero is sharp and a 2x srcset has pixels to work with) and the pipeline downscales to this,
 * re-encoding to WebP — the same bound the site importer applies to a cloned site. A project's own
 * `website.imageUploadCap`, when set lower, still wins (see `createMediaAsset`).
 */
export const STOCK_IMPORT_CAP = 2400;

/** A provider whose key isn't configured (→ 400 at the route). */
export class StockNotConfiguredError extends Error {}
/**
 * The chosen photo is bigger than the import can accept (→ 413 at the route).
 *
 * Distinct from StockProviderError because the provider did nothing wrong and "stock provider
 * unavailable — please try again" would send the author into a retry loop that cannot succeed.
 * Reaching this got MORE likely when imports moved to full-resolution originals, so it needs to say
 * what actually happened and that a different photo is the way out.
 */
export class StockImageTooLargeError extends Error {}
/** An unknown provider name (→ 404 at the route). */
export class StockUnknownProviderError extends Error {}

/** The instance-settings surface the service needs (decoupled from the repo). */
export interface StockSettings {
  getStockKey(provider: 'unsplash' | 'pexels'): Promise<string | null>;
}

/** A downloaded image: the bytes plus the upstream content-type (e.g. `image/jpeg`). */
export interface DownloadedImage {
  buffer: Buffer;
  contentType: string;
}

/** Downloads an image URL to a Buffer, applying SSRF + size + type guards. */
export type ImageDownloader = (url: string) => Promise<DownloadedImage>;

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const tooLargeMessage = (bytes: number): string =>
  `this photo is ${mb(bytes)}, over the ${mb(MAX_IMAGE_BYTES)} import limit — pick a different one`;

/**
 * Default image downloader: https-only, public-host-only (SSRF guard), no redirects
 * (a 302 to a private host can't bypass the check), image/* content-type, and a
 * size cap (Content-Length pre-check + post-read backstop) under a timeout.
 */
export const defaultDownloadImage: ImageDownloader = async (url) => {
  if (!/^https:\/\//i.test(url) || targetsPrivateHost(url)) {
    throw new StockProviderError('refusing to fetch a non-public image URL');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'error' });
    if (!res.ok) throw new StockProviderError(`image download failed (${res.status})`);
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) throw new StockProviderError('download is not an image');
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > MAX_IMAGE_BYTES) throw new StockImageTooLargeError(tooLargeMessage(declared));
    const buffer = Buffer.from(await res.arrayBuffer());
    // Backstop for a missing/lying Content-Length: the bytes are already in memory here, but the
    // pre-check above means that only happens when the provider didn't declare a length.
    if (buffer.length > MAX_IMAGE_BYTES) throw new StockImageTooLargeError(tooLargeMessage(buffer.length));
    // Strip any `; charset=…` parameter so the stored format is a clean MIME type.
    return { buffer, contentType: contentType.split(';')[0]?.trim() || 'image/jpeg' };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Orchestrates stock search/import across providers. Resolves each provider's key
 * from instance settings server-side (never exposed); the import re-resolves the
 * download URL by id (so the client never supplies the fetched URL) and pulls the
 * bytes through the guarded downloader.
 */
export class StockService {
  constructor(
    private readonly providers: Map<StockProviderName, StockProvider>,
    private readonly settings: StockSettings,
    private readonly downloadImage: ImageDownloader = defaultDownloadImage,
  ) {}

  /** Which providers are usable (keyless ones always; keyed ones iff configured). */
  async availability(): Promise<StockProvidersStatus> {
    const out: StockProvidersStatus['providers'] = [];
    for (const [name, p] of this.providers) {
      const available = !p.requiresKey || (await this.keyFor(name)) !== null;
      out.push({ name, available, requiresKey: p.requiresKey });
    }
    return { providers: out };
  }

  /** "not configured" message that names the providers usable RIGHT NOW, so a caller (esp. an agent)
   *  switches to an available one instead of retrying the unconfigured one. */
  private async notConfiguredError(name: StockProviderName): Promise<StockNotConfiguredError> {
    const usable = (await this.availability()).providers.filter((p) => p.available).map((p) => p.name);
    const hint = usable.length ? `available now: ${usable.join(', ')} — search one of those instead` : 'no providers are configured';
    return new StockNotConfiguredError(`${name} is not configured (needs an instance API key); ${hint}`);
  }

  /**
   * Search one provider, or every AVAILABLE one at once (`all`).
   *
   * A fan-out queries the available providers concurrently and interleaves the pages round-robin, so
   * the top of the grid is a mix rather than one provider's page followed by another's. It is also
   * fault-TOLERANT: a provider that errors is reported in `errors` and the rest still return —
   * only a total wipeout throws. A single-provider search keeps its strict behaviour (an upstream
   * failure propagates and the route maps it to 502).
   */
  async search(name: StockSearchProvider, query: string, page: number): Promise<StockSearchResult> {
    const p = Math.max(1, Math.min(Number.isFinite(page) ? page : 1, 100));
    if (name !== 'all') {
      const provider = this.provider(name);
      const key = await this.keyFor(name);
      if (provider.requiresKey && !key) throw await this.notConfiguredError(name);
      const results = await provider.search(query, p, key);
      // A FULL page means "there is probably another". Inferred from the mapped count rather than an
      // upstream total, which the three providers each report differently — the cost is that a page
      // whose last row was DROPPED by the mapper (a non-https URL, a missing id) reads as the last
      // one. Rare, and it ends pagination early rather than promising a page that isn't there.
      return { provider: name, page: p, results, hasMore: results.length >= provider.pageSize };
    }

    // Resolve every key ONCE up front (each is a decrypt), then fan out.
    const usable: Array<{ provider: StockProvider; key: string | null }> = [];
    for (const [providerName, provider] of this.providers) {
      const key = await this.keyFor(providerName);
      if (!provider.requiresKey || key !== null) usable.push({ provider, key });
    }
    if (usable.length === 0) throw new StockNotConfiguredError('no stock providers are configured');

    const settled = await Promise.all(
      usable.map(async ({ provider, key }) => {
        try {
          return { provider, results: await provider.search(query, p, key), error: null as string | null };
        } catch (err) {
          return { provider, results: [] as StockResult[], error: err instanceof Error ? err.message : 'search failed' };
        }
      }),
    );
    const errors = settled
      .filter((s) => s.error !== null)
      .map((s) => ({ provider: s.provider.name, error: s.error as string }));
    // Every provider failed → there is nothing to show and no partial result to salvage, so surface
    // it as a provider failure (502) instead of an empty "no results", which would read as a bad query.
    if (errors.length === settled.length) throw new StockProviderError('every stock provider failed');
    return {
      provider: 'all',
      page: p,
      results: interleave(settled.map((s) => s.results)),
      hasMore: settled.some((s) => s.results.length >= s.provider.pageSize),
      ...(errors.length ? { errors } : {}),
    };
  }

  /**
   * Verify a provider's key works with a minimal search. Tests the supplied `key` if given (so the
   * admin can check a just-typed-but-unsaved key), else the stored one. Never throws — the outcome is
   * returned as `{ ok, error? }` so the route can render a friendly result.
   */
  async testKey(name: StockProviderName, key?: string): Promise<{ ok: boolean; error?: string }> {
    let provider: StockProvider;
    try {
      provider = this.provider(name);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'unknown provider' };
    }
    const effectiveKey = key ?? (await this.keyFor(name));
    if (provider.requiresKey && !effectiveKey) return { ok: false, error: `${name} has no key configured` };
    try {
      await provider.search('nature', 1, effectiveKey ?? null);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'request failed' };
    }
  }

  /** Resolves a result by id and downloads the full image. Returns null if not found. */
  async fetchForImport(
    name: StockProviderName,
    id: string,
  ): Promise<{ buffer: Buffer; contentType: string; attribution: ProviderAttribution } | null> {
    const provider = this.provider(name);
    const key = await this.keyFor(name);
    if (provider.requiresKey && !key) throw await this.notConfiguredError(name);
    const resolved = await provider.resolve(id, key);
    if (!resolved) return null;
    const { buffer, contentType } = await this.downloadImage(resolved.downloadUrl);
    return { buffer, contentType, attribution: resolved.attribution };
  }

  private provider(name: StockProviderName): StockProvider {
    const provider = this.providers.get(name);
    if (!provider) throw new StockUnknownProviderError(`unknown stock provider: ${name}`);
    return provider;
  }

  private async keyFor(name: StockProviderName): Promise<string | null> {
    return name === 'unsplash' || name === 'pexels' ? this.settings.getStockKey(name) : null;
  }
}

/**
 * Round-robin merge: first hit of every list, then the second of every list, and so on. Uneven
 * lengths are fine — a list that runs out simply stops contributing, so a provider returning 3
 * results doesn't push a provider returning 30 down the grid.
 */
function interleave(lists: StockResult[][]): StockResult[] {
  const longest = lists.reduce((max, l) => Math.max(max, l.length), 0);
  const out: StockResult[] = [];
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      const hit = list[i];
      if (hit) out.push(hit);
    }
  }
  return out;
}
