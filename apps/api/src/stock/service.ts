import { targetsPrivateHost, type StockProviderName, type StockProvidersStatus, type StockSearchResult } from '@sitewright/schema';
import { StockProviderError, type ProviderAttribution, type StockProvider } from './providers.js';

/** Max bytes the import will download (matches the media upload cap). */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 10_000;

/** A provider whose key isn't configured (→ 400 at the route). */
export class StockNotConfiguredError extends Error {}
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
    if (declared > MAX_IMAGE_BYTES) throw new StockProviderError('image exceeds size limit');
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) throw new StockProviderError('image exceeds size limit');
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

  async search(name: StockProviderName, query: string, page: number): Promise<StockSearchResult> {
    const provider = this.provider(name);
    const key = await this.keyFor(name);
    if (provider.requiresKey && !key) throw await this.notConfiguredError(name);
    const p = Math.max(1, Math.min(Number.isFinite(page) ? page : 1, 100));
    return { provider: name, page: p, results: await provider.search(query, p, key) };
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
