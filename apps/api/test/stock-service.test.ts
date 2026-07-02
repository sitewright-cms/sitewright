import { describe, it, expect, vi } from 'vitest';
import { StockService, StockNotConfiguredError, StockUnknownProviderError } from '../src/stock/service.js';
import type { StockProvider, ResolvedStock } from '../src/stock/providers.js';
import type { StockProviderName, StockResult } from '@sitewright/schema';

function fakeProvider(name: StockProviderName, requiresKey: boolean, resolved: ResolvedStock | null = null): StockProvider {
  return {
    name,
    requiresKey,
    search: vi.fn(async (): Promise<StockResult[]> => [
      { provider: name, id: 'x1', thumbUrl: 'https://cdn/x1', width: 1, height: 1, author: 'A', sourceUrl: 'https://s/x1', license: 'L' },
    ]),
    resolve: vi.fn(async () => resolved),
  };
}

function service(opts: {
  unsplashKey?: string | null;
  pexelsKey?: string | null;
  resolved?: ResolvedStock | null;
  download?: (url: string) => Promise<{ buffer: Buffer; contentType: string }>;
}) {
  const providers = new Map<StockProviderName, StockProvider>([
    ['openverse', fakeProvider('openverse', false, opts.resolved ?? null)],
    ['unsplash', fakeProvider('unsplash', true, opts.resolved ?? null)],
    ['pexels', fakeProvider('pexels', true, opts.resolved ?? null)],
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
});
