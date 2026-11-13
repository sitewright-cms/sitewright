import {
  StockKeyedProviderSchema,
  targetsPrivateHost,
  type StockKeyedProvider,
  type StockProviderName,
  type StockProvidersStatus,
  type StockResult,
  type StockSearchProvider,
  type StockSearchResult,
} from '@sitewright/schema';
import {
  StockProviderError,
  StockProviderTimeoutError,
  durationLabel,
  type ProviderAttribution,
  type StockProvider,
} from './providers.js';

/**
 * How long a stock search waits on an upstream. The providers are third-party APIs, and one slow one
 * used to hold the whole answer: an `all` search waited for every provider with no limit at all, so a
 * degraded Openverse (5–17 s a search and some 504s, from about 2026-10-20) kept Unsplash, Pexels and
 * Pixabay results off the screen for just as long.
 * - `providerMs`: the most one provider call (a search, or the lookup an import starts with) may take;
 *   it is aborted after that. Above Openverse's own gateway timeout (it answers 504 after ~17 s), so
 *   any answer an upstream can still give arrives; only a request that would hang is cut off.
 * - `patienceMs`: in an `all` search, once this much has passed and at least one provider has answered,
 *   the rest are given up on and reported in `errors`. While nobody has answered it keeps waiting (up to
 *   `providerMs`), so an instance whose only provider is a slow Openverse still gets its results.
 */
export interface StockSearchLimits {
  providerMs: number;
  patienceMs: number;
}
export const STOCK_SEARCH_LIMITS: StockSearchLimits = { providerMs: 30_000, patienceMs: 8_000 };

/** One provider call, aborted after `ms` or when `cancel` fires — it never outlives either. */
async function within<T>(
  provider: StockProviderName,
  ms: number,
  call: (signal: AbortSignal) => Promise<T>,
  cancel?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new StockProviderTimeoutError(provider, ms)), ms);
  const stop = (): void => controller.abort(cancel?.reason);
  cancel?.addEventListener('abort', stop, { once: true });
  // Raced against the abort as well, so a provider (or a body read) that ignores the signal still ends here.
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });
  try {
    return await Promise.race([call(controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    cancel?.removeEventListener('abort', stop);
  }
}

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

/** Upstream statuses that mean "this key is wrong", not "this provider is down". Unsplash answers a
 *  bad key with 401, Pexels with 401, Pixabay with 400 ("Invalid or missing API key"). */
const KEY_REJECTED_STATUSES = new Set([400, 401, 403]);

/** The instance-settings surface the service needs (decoupled from the repo). */
export interface StockSettings {
  getStockKey(provider: StockKeyedProvider): Promise<string | null>;
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
    private readonly limits: StockSearchLimits = STOCK_SEARCH_LIMITS,
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
   * failure propagates and the route maps it to 502). Neither waits on a provider past
   * {@link STOCK_SEARCH_LIMITS} (a timeout is a 504 alone, an entry in `errors` in a fan-out).
   */
  async search(name: StockSearchProvider, query: string, page: number): Promise<StockSearchResult> {
    const p = Math.max(1, Math.min(Number.isFinite(page) ? page : 1, 100));
    if (name !== 'all') {
      const provider = this.provider(name);
      const key = await this.keyFor(name);
      if (provider.requiresKey && !key) throw await this.notConfiguredError(name);
      const results = await within(name, this.limits.providerMs, (signal) => provider.search(query, p, key, signal));
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

    const settled = await this.fanOut(usable, query, p);
    const errors = settled
      .filter((s) => s.error !== null)
      .map((s) => ({ provider: s.provider.name, error: s.error as string }));
    // Every provider failed → there is nothing to show and no partial result to salvage, so surface
    // it as a provider failure (502) instead of an empty "no results", which would read as a bad query.
    // When every one of them timed out, say THAT (a 504 naming who), as a single-provider search does.
    if (errors.length === settled.length) {
      const timeouts = settled.map((s) => s.failure).filter((f): f is StockProviderTimeoutError => f instanceof StockProviderTimeoutError);
      if (timeouts.length === settled.length) {
        throw settled.length === 1 ? timeouts[0]! : new StockProviderTimeoutError('all', this.limits.providerMs);
      }
      throw new StockProviderError('every stock provider failed');
    }
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
      await within(name, this.limits.providerMs, (signal) => provider.search('nature', 1, effectiveKey ?? null, signal));
      return { ok: true };
    } catch (err) {
      // The whole point of this button is to say WHY. An auth-shaped status means the key itself was
      // refused — actionable — where "provider request failed (401)" reads like an outage and invites
      // a pointless retry. Anything else is passed through as-is.
      if (err instanceof StockProviderError && err.status !== undefined && KEY_REJECTED_STATUSES.has(err.status)) {
        return { ok: false, error: `${name} rejected this key (HTTP ${err.status}) — check it was copied in full` };
      }
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
    const resolved = await within(name, this.limits.providerMs, (signal) => provider.resolve(id, key, signal));
    if (!resolved) return null;
    const { buffer, contentType } = await this.downloadImage(resolved.downloadUrl);
    return { buffer, contentType, attribution: resolved.attribution };
  }

  /**
   * Every usable provider at once, each within `providerMs`. Returns when all have answered — or, once
   * `patienceMs` has passed, as soon as at least one has: the rest are aborted and come back as errors.
   */
  private async fanOut(
    usable: ReadonlyArray<{ provider: StockProvider; key: string | null }>,
    query: string,
    page: number,
  ): Promise<Array<{ provider: StockProvider; results: StockResult[]; error: string | null; failure?: unknown }>> {
    type Outcome = { provider: StockProvider; results: StockResult[]; error: string | null; failure?: unknown };
    const outcomes: Array<Outcome | undefined> = usable.map(() => undefined);
    const cancel = new AbortController();
    await new Promise<void>((done) => {
      let open = usable.length;
      let patient = true;
      const timer = setTimeout(() => {
        patient = false;
        if (outcomes.some((o) => o?.error === null)) done();
      }, this.limits.patienceMs);
      usable.forEach(({ provider, key }, i) => {
        void within(provider.name, this.limits.providerMs, (signal) => provider.search(query, page, key, signal), cancel.signal)
          .then(
            (results): Outcome => ({ provider, results, error: null }),
            (err: unknown): Outcome => ({ provider, results: [], error: err instanceof Error ? err.message : 'search failed', failure: err }),
          )
          .then((outcome) => {
            outcomes[i] = outcome;
            open -= 1;
            if (open === 0 || (!patient && outcome.error === null)) {
              clearTimeout(timer);
              done();
            }
          });
      });
    });
    // Whatever is still running is given up on: its upstream request is aborted, not left to finish.
    cancel.abort(new Error('the search finished without it'));
    const gaveUp = durationLabel(this.limits.patienceMs);
    return usable.map(
      ({ provider }, i) => outcomes[i] ?? { provider, results: [], error: `${provider.name} did not answer within ${gaveUp}` },
    );
  }

  private provider(name: StockProviderName): StockProvider {
    const provider = this.providers.get(name);
    if (!provider) throw new StockUnknownProviderError(`unknown stock provider: ${name}`);
    return provider;
  }

  private async keyFor(name: StockProviderName): Promise<string | null> {
    // Parsed rather than compared: the enum is the list of keyed providers, so a new one is picked
    // up here automatically instead of silently resolving to `null` (= "not configured", forever).
    const keyed = StockKeyedProviderSchema.safeParse(name);
    return keyed.success ? this.settings.getStockKey(keyed.data) : null;
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
