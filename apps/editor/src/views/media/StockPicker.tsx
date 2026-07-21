import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, type StockProviderName, type StockProvidersStatus, type StockSearchResult } from '../../api';
import { glassCard, glassPanel, glassInput, primaryButton, ghostButton } from '../../theme';

const PROVIDER_LABELS: Record<StockProviderName, string> = {
  openverse: 'Openverse (CC)',
  unsplash: 'Unsplash',
  pexels: 'Pexels',
};

type Result = StockSearchResult['results'][number];

/**
 * Search Openverse/Unsplash/Pexels and import a photo into the project. Import
 * downloads + optimizes + self-hosts the image server-side (never a hotlink) and
 * records attribution; provider keys live in instance settings and never reach here.
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
  const [provider, setProvider] = useState<StockProviderName>('openverse');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [searching, setSearching] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.stockProviders(projectId);
        if (!active) return;
        setProviders(res.providers);
        // Default to the first available provider (openverse is always available).
        const firstAvailable = res.providers.find((p) => p.available);
        if (firstAvailable) setProvider(firstAvailable.name);
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

  const selectedAvailable = useMemo(
    () => providers.find((p) => p.name === provider)?.available ?? false,
    [providers, provider],
  );

  async function search(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    setSearched(true);
    try {
      const res = await api.searchStock(projectId, provider, q);
      setResults(res.results);
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : 'search failed');
    } finally {
      setSearching(false);
    }
  }

  async function importImage(r: Result) {
    setImportingId(r.id);
    setError(null);
    try {
      await api.importStock(projectId, r.provider, r.id, undefined, folder || undefined);
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
            onChange={(e) => setProvider(e.target.value as StockProviderName)}
          >
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
          This provider needs an API key. Configure it under System settings → Stock image providers.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5">
        {results.map((r) => (
          <figure key={`${r.provider}:${r.id}`} className={`flex flex-col ${glassPanel} p-2`}>
            <img src={r.thumbUrl} alt={`Stock photo by ${r.author}`} className="h-24 w-full rounded object-cover" loading="lazy" />
            <figcaption className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400" title={`${r.author} · ${r.license}`}>
              {r.author} · {r.license}
            </figcaption>
            <button
              onClick={() => importImage(r)}
              disabled={importingId !== null}
              className={`${ghostButton} mt-1 px-2 py-1 text-[11px]`}
            >
              {importingId === r.id ? 'Importing…' : 'Import'}
            </button>
          </figure>
        ))}
        {searched && !searching && results.length === 0 && !error && (
          <p className="text-sm text-slate-400 dark:text-slate-500">No results.</p>
        )}
      </div>
    </div>
  );
}
