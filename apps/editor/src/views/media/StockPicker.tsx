import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, type StockProviderName, type StockProvidersStatus, type StockSearchProvider, type StockSearchResult } from '../../api';
import { glassCard, glassPanel, glassInput, primaryButton, ghostButton } from '../../theme';
import { Modal } from '../ui/Modal';

const PROVIDER_LABELS: Record<StockProviderName, string> = {
  openverse: 'Openverse (CC)',
  unsplash: 'Unsplash',
  pexels: 'Pexels',
};

type Result = StockSearchResult['results'][number];

/** Identity of a hit across a fan-out: ids are only unique WITHIN a provider. */
const resultKey = (r: Result): string => `${r.provider}:${r.id}`;

/** Providers that failed a fan-out, rendered as "Unsplash, Pexels". */
function providerNames(errors: NonNullable<StockSearchResult['errors']>): string {
  return errors.map((e) => PROVIDER_LABELS[e.provider]).join(', ');
}

/**
 * Search Openverse/Unsplash/Pexels and import a photo into the project. Import
 * downloads + optimizes + self-hosts the image server-side (never a hotlink) and
 * records attribution; provider keys live in instance settings and never reach here.
 *
 * The provider select defaults to ALL, which fans out across every available provider server-side
 * and interleaves the hits. Results paginate via "Load more" (appending, so what you already
 * scanned stays put), and clicking a tile opens a full-size preview before committing to an import.
 */
export function StockPicker({
  projectId,
  onImported,
  folder = '',
  bare = false,
}: {
  projectId: string;
  onImported: () => void | Promise<void>;
  /** Virtual folder the import is filed into ('' = root) — the Assets view's current folder. */
  folder?: string;
  /** Drop the glass-card chrome — for rendering inside the Modal, which supplies the panel. */
  bare?: boolean;
}) {
  const [providers, setProviders] = useState<StockProvidersStatus['providers']>([]);
  const [loaded, setLoaded] = useState(false);
  const [provider, setProvider] = useState<StockSearchProvider>('all');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [preview, setPreview] = useState<Result | null>(null);
  // The query/provider/page the CURRENT result set came from — "Load more" must continue THAT
  // search, not whatever has since been typed into the box.
  const [lastSearch, setLastSearch] = useState<{ query: string; provider: StockSearchProvider; page: number } | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [partial, setPartial] = useState<StockSearchResult['errors']>(undefined);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.stockProviders(projectId);
        if (!active) return;
        setProviders(res.providers);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'failed to load stock providers');
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId]);

  // 'all' is usable as long as ANY provider is (openverse never needs a key, so in practice always).
  const selectedAvailable = useMemo(
    () =>
      provider === 'all'
        ? providers.some((p) => p.available)
        : (providers.find((p) => p.name === provider)?.available ?? false),
    [providers, provider],
  );

  /** Fresh search: page 1 replaces the grid. */
  async function search(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    setSearched(true);
    try {
      const res = await api.searchStock(projectId, provider, q, 1);
      setResults(res.results);
      setLastSearch({ query: q, provider, page: 1 });
      setHasMore(res.hasMore);
      setPartial(res.errors);
    } catch (err) {
      setResults([]);
      setHasMore(false);
      setPartial(undefined); // don't leave the previous search's partial-failure note above an empty grid
      setError(err instanceof Error ? err.message : 'search failed');
    } finally {
      setSearching(false);
    }
  }

  /**
   * Appends the next page of the search whose results are currently on screen.
   *
   * New hits are deduped against what is already shown: a provider can serve the SAME rows for two
   * consecutive pages (measured on Openverse's anonymous tier — `mountain` returns an identical
   * page 1 and 2, while `cats` paginates normally), and appending those would mean duplicate keys
   * and a button that visibly does nothing. When a page turns out to be all duplicates we skip
   * ahead ONE more page rather than making the author click again into the same wall.
   */
  async function loadMore() {
    if (!lastSearch || loadingMore || searching) return;
    setLoadingMore(true);
    setError(null);
    try {
      let page = lastSearch.page;
      let merged = results;
      let more = hasMore;
      let added = 0;
      for (let attempt = 0; attempt < 2 && added === 0 && more; attempt++) {
        page += 1;
        const res = await api.searchStock(projectId, lastSearch.provider, lastSearch.query, page);
        const seen = new Set(merged.map(resultKey));
        const fresh = res.results.filter((r) => !seen.has(resultKey(r)));
        merged = fresh.length ? [...merged, ...fresh] : merged;
        added = fresh.length;
        more = res.hasMore;
        setPartial(res.errors);
      }
      setResults(merged);
      setHasMore(more);
      setLastSearch({ ...lastSearch, page });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'search failed');
    } finally {
      setLoadingMore(false);
    }
  }

  async function importImage(r: Result) {
    // Keyed by provider+id, not the bare id: in a fan-out two providers can hand back the same id
    // string and the spinner would land on the wrong tile.
    setImportingId(resultKey(r));
    setError(null);
    try {
      await api.importStock(projectId, r.provider, r.id, undefined, folder || undefined);
      setPreview(null);
      await onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'import failed');
    } finally {
      setImportingId(null);
    }
  }

  const field = glassInput;

  return (
    <div className={bare ? '' : `${glassCard} p-4`}>
      <form onSubmit={search} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
          Provider
          <select
            className={field}
            aria-label="Stock provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as StockSearchProvider)}
          >
            <option value="all">All providers</option>
            {providers.map((p) => (
              <option key={p.name} value={p.name}>
                {PROVIDER_LABELS[p.name]}
                {p.available ? '' : ' — needs an API key'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col text-xs text-slate-500 dark:text-slate-400">
          Search stock photos
          <input
            className={field}
            aria-label="Stock search query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. mountains at sunset"
          />
        </label>
        <button
          type="submit"
          disabled={searching || !selectedAvailable || !query.trim()}
          className={primaryButton}
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {loaded && !selectedAvailable && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          {provider === 'all'
            ? 'No stock providers are available on this instance. Configure one under System settings → Stock image providers.'
            : 'This provider needs an API key. Configure it under System settings → Stock image providers.'}
        </p>
      )}
      {loaded && provider === 'all' && selectedAvailable && providers.some((p) => !p.available) && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Searching {providers.filter((p) => p.available).map((p) => PROVIDER_LABELS[p.name]).join(', ')}.
          Add a key under System settings → Stock image providers to include the rest.
        </p>
      )}
      {partial && partial.length > 0 && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          {providerNames(partial)} did not respond — showing the other providers&apos; results.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5">
        {results.map((r) => (
          <figure key={resultKey(r)} className={`flex flex-col ${glassPanel} p-2`}>
            {/* The tile itself opens the full-size preview — a 96px thumbnail is not enough to
                judge a photo you are about to import. */}
            <button
              type="button"
              onClick={() => setPreview(r)}
              title="Preview full size"
              aria-label={`Preview stock photo by ${r.author}`}
              className="group relative block cursor-zoom-in overflow-hidden rounded"
            >
              <img src={r.thumbUrl} alt={`Stock photo by ${r.author}`} className="sw-zoom-thumb h-24 w-full rounded object-cover" loading="lazy" />
              <span className="pointer-events-none absolute inset-0 rounded bg-slate-900/0 transition group-hover:bg-slate-900/20" />
            </button>
            <figcaption className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400" title={`${r.author} · ${r.license} · ${PROVIDER_LABELS[r.provider]}`}>
              {r.author} · {r.license}
            </figcaption>
            {/* In a fan-out the tiles are mixed, so each one has to say where it came from. Keyed off
                the search that PRODUCED these tiles, not the select's current value. */}
            {lastSearch?.provider === 'all' && (
              <span className="truncate text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {PROVIDER_LABELS[r.provider]}
              </span>
            )}
            <button
              onClick={() => importImage(r)}
              disabled={importingId !== null}
              className={`${ghostButton} mt-1 px-2 py-1 text-[11px]`}
            >
              {importingId === resultKey(r) ? 'Importing…' : 'Import'}
            </button>
          </figure>
        ))}
        {searched && !searching && results.length === 0 && !error && (
          <p className="text-sm text-slate-500 dark:text-slate-400">No results.</p>
        )}
      </div>

      {hasMore && lastSearch && results.length > 0 && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            disabled={loadingMore || searching}
            onClick={() => void loadMore()}
            className={`${ghostButton} px-4 py-1.5 text-xs`}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {preview && (
        <Modal
          title={`${preview.author} · ${PROVIDER_LABELS[preview.provider]}`}
          size="2xl"
          onClose={() => setPreview(null)}
        >
          <div className="flex flex-col gap-3 p-4">
            <img
              src={preview.previewUrl}
              alt={`Stock photo by ${preview.author}`}
              className="max-h-[60dvh] w-full rounded-xl bg-slate-100 object-contain dark:bg-slate-900"
            />
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
              <span>
                {preview.width > 0 && preview.height > 0 && (
                  <>
                    {preview.width}×{preview.height} ·{' '}
                  </>
                )}
                {preview.license} ·{' '}
                <a href={preview.sourceUrl} target="_blank" rel="noreferrer noopener" className="underline hover:no-underline">
                  View on {PROVIDER_LABELS[preview.provider]}
                </a>
              </span>
              <button
                type="button"
                onClick={() => void importImage(preview)}
                disabled={importingId !== null}
                className={primaryButton}
              >
                {importingId === resultKey(preview) ? 'Importing…' : 'Import this photo'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
