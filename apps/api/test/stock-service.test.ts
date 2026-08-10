import { describe, it, expect, vi } from 'vitest';
import { StockService, StockNotConfiguredError, StockUnknownProviderError, STOCK_IMPORT_CAP } from '../src/stock/service.js';
import { StockProviderError, type StockProvider, type ResolvedStock } from '../src/stock/providers.js';
import type { StockProviderName, StockResult } from '@sitewright/schema';

const PAGE_SIZE = 4;

/** n results from `name`, ids `<name>1..n` — enough to assert interleave ORDER, not just membership. */
function hits(name: StockProviderName, n: number): StockResult[] {
  return Array.from({ length: n }, (_, i) => ({
    provider: name,
    id: `${name}${i + 1}`,
    thumbUrl: `https://cdn/${name}${i + 1}-t`,
    previewUrl: `https://cdn/${name}${i + 1}-p`,
    width: 1,
    height: 1,
    author: 'A',
    sourceUrl: `https://s/${name}${i + 1}`,
    license: 'L',
  }));
}

function fakeProvider(
  name: StockProviderName,
  requiresKey: boolean,
  resolved: ResolvedStock | null = null,
  results: StockResult[] | Error = hits(name, 1),
): StockProvider {
  return {
    name,
    requiresKey,
    pageSize: PAGE_SIZE,
    search: vi.fn(async (): Promise<StockResult[]> => {
      if (results instanceof Error) throw results;
      return results;
    }),
    resolve: vi.fn(async () => resolved),
  };
}

function service(opts: {
  unsplashKey?: string | null;
  pexelsKey?: string | null;
  resolved?: ResolvedStock | null;
  download?: (url: string) => Promise<{ buffer: Buffer; contentType: string }>;
  /** Per-provider canned search outcome (results, or an Error to throw). */
  results?: Partial<Record<StockProviderName, StockResult[] | Error>>;
}) {
  const make = (name: StockProviderName, requiresKey: boolean) =>
    fakeProvider(name, requiresKey, opts.resolved ?? null, opts.results?.[name] ?? hits(name, 1));
  const providers = new Map<StockProviderName, StockProvider>([
    ['openverse', make('openverse', false)],
    ['unsplash', make('unsplash', true)],
    ['pexels', make('pexels', true)],
  ]);
  const settings = {
    getStockKey: async (p: 'unsplash' | 'pexels') => (p === 'unsplash' ? (opts.unsplashKey ?? null) : (opts.pexelsKey ?? null)),
  };
  return new StockService(providers, settings, opts.download ?? (async () => ({ buffer: Buffer.from('img'), contentType: 'image/jpeg' })));
}

describe('StockService', () => {
  it('reports availability: keyless openverse always; keyed providers only when configured', async () => {
    const a = await service({ unsplashKey: 'k' }).availability();
    const by = Object.fromEntries(a.providers.map((p) => [p.name, p.available]));
    expect(by).toEqual({ openverse: true, unsplash: true, pexels: false });
  });

  it('searches a keyless provider without a key', async () => {
    const res = await service({}).search('openverse', 'cats', 1);
    expect(res.results[0]).toMatchObject({ provider: 'openverse' });
  });

  it('rejects search on a keyed provider with no key configured', async () => {
    await expect(service({ unsplashKey: null }).search('unsplash', 'x', 1)).rejects.toBeInstanceOf(StockNotConfiguredError);
  });

  it('the not-configured error names the providers usable right now (so the caller switches)', async () => {
    // openverse is keyless → always usable; pexels has a key here → usable; unsplash does not.
    await expect(service({ unsplashKey: null, pexelsKey: 'k' }).search('unsplash', 'x', 1)).rejects.toThrow(
      /unsplash is not configured.*available now:.*openverse.*pexels/s,
    );
    // The same guidance guards the import path.
    await expect(service({ unsplashKey: null }).fetchForImport('unsplash', 'x1')).rejects.toThrow(/available now:.*openverse/s);
  });

  it('throws on an unknown provider', async () => {
    await expect(service({}).search('nope' as StockProviderName, 'x', 1)).rejects.toBeInstanceOf(StockUnknownProviderError);
  });

  it('import: resolves by id and downloads via the guarded downloader', async () => {
    const download = vi.fn(async () => ({ buffer: Buffer.from('bytes'), contentType: 'image/png' }));
    const svc = service({ resolved: { downloadUrl: 'https://cdn/full.jpg', attribution: { provider: 'openverse', author: 'A', sourceUrl: 'https://s', license: 'CC' } }, download });
    const out = await svc.fetchForImport('openverse', 'x1');
    expect(out?.attribution.author).toBe('A');
    expect(out?.contentType).toBe('image/png');
    expect(download).toHaveBeenCalledWith('https://cdn/full.jpg');
  });

  it('import: returns null when the provider cannot resolve the id', async () => {
    const out = await service({ resolved: null }).fetchForImport('openverse', 'missing');
    expect(out).toBeNull();
  });

  it('clamps the search page into [1,100]', async () => {
    expect((await service({}).search('openverse', 'x', -5)).page).toBe(1);
    expect((await service({}).search('openverse', 'x', 9999)).page).toBe(100);
  });

  it('reports hasMore only when the provider filled its page', async () => {
    const short = await service({ results: { openverse: hits('openverse', PAGE_SIZE - 1) } }).search('openverse', 'x', 1);
    expect(short.hasMore).toBe(false);
    const full = await service({ results: { openverse: hits('openverse', PAGE_SIZE) } }).search('openverse', 'x', 1);
    expect(full.hasMore).toBe(true);
  });

  it('the import cap is the documented 2400 (bounds a full-resolution original)', () => {
    expect(STOCK_IMPORT_CAP).toBe(2400);
  });
});

describe('StockService — `all` fan-out', () => {
  it('queries every AVAILABLE provider and interleaves the pages round-robin', async () => {
    const svc = service({
      unsplashKey: 'k',
      pexelsKey: 'k',
      results: { openverse: hits('openverse', 2), unsplash: hits('unsplash', 2), pexels: hits('pexels', 2) },
    });
    const res = await svc.search('all', 'cats', 1);
    expect(res.provider).toBe('all');
    // First hit of each, THEN the second of each — not one provider's page after another's.
    expect(res.results.map((r) => r.id)).toEqual([
      'openverse1', 'unsplash1', 'pexels1',
      'openverse2', 'unsplash2', 'pexels2',
    ]);
    expect(res.errors).toBeUndefined();
  });

  it('skips providers with no key instead of erroring (an unkeyed instance still searches openverse)', async () => {
    const res = await service({ unsplashKey: null, pexelsKey: null }).search('all', 'cats', 1);
    expect(res.results.map((r) => r.provider)).toEqual(['openverse']);
    expect(res.errors).toBeUndefined();
  });

  it('uneven result counts do not push a longer provider down the grid', async () => {
    const svc = service({
      unsplashKey: 'k',
      results: { openverse: hits('openverse', 1), unsplash: hits('unsplash', 3) },
    });
    const res = await svc.search('all', 'cats', 1);
    expect(res.results.map((r) => r.id)).toEqual(['openverse1', 'unsplash1', 'unsplash2', 'unsplash3']);
  });

  it('a failing provider is reported in `errors` while the rest still return', async () => {
    const svc = service({
      unsplashKey: 'k',
      results: { openverse: hits('openverse', 2), unsplash: new StockProviderError('provider request failed (503)') },
    });
    const res = await svc.search('all', 'cats', 1);
    expect(res.results.map((r) => r.provider)).toEqual(['openverse', 'openverse']);
    expect(res.errors).toEqual([{ provider: 'unsplash', error: 'provider request failed (503)' }]);
  });

  it('throws only when EVERY provider failed (an empty grid would read as a bad query)', async () => {
    const svc = service({
      unsplashKey: 'k',
      results: { openverse: new StockProviderError('down'), unsplash: new StockProviderError('down') },
    });
    await expect(svc.search('all', 'cats', 1)).rejects.toBeInstanceOf(StockProviderError);
  });

  it('hasMore is true when ANY provider filled its page', async () => {
    const svc = service({
      unsplashKey: 'k',
      results: { openverse: hits('openverse', 1), unsplash: hits('unsplash', PAGE_SIZE) },
    });
    expect((await svc.search('all', 'cats', 1)).hasMore).toBe(true);
  });

  it('passes the requested page AND each provider its own key through to every provider', async () => {
    const openverse = fakeProvider('openverse', false);
    const unsplash = fakeProvider('unsplash', true);
    const svc = new StockService(
      new Map<StockProviderName, StockProvider>([
        ['openverse', openverse],
        ['unsplash', unsplash],
      ]),
      { getStockKey: async (p) => (p === 'unsplash' ? 'UK' : null) },
    );
    const res = await svc.search('all', 'cats', 3);
    expect(res.page).toBe(3);
    expect(openverse.search).toHaveBeenCalledWith('cats', 3, null);
    expect(unsplash.search).toHaveBeenCalledWith('cats', 3, 'UK');
  });
});
