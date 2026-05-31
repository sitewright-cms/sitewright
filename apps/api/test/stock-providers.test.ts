import { describe, it, expect, vi } from 'vitest';
import { OpenverseProvider, UnsplashProvider, PexelsProvider, type FetchLike } from '../src/stock/providers.js';

function jsonFetch(payload: unknown, ok = true): FetchLike {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 502,
    json: async () => payload,
    arrayBuffer: async () => new ArrayBuffer(0),
    headers: { get: () => null },
  }));
}

describe('OpenverseProvider', () => {
  it('maps search results and resolves a download URL + attribution', async () => {
    const search = jsonFetch({
      results: [{ id: 'ov1', thumbnail: 'https://cdn/ov1-thumb.jpg', url: 'https://cdn/ov1.jpg', width: 800, height: 600, creator: 'Ann', creator_url: 'https://ann', foreign_landing_url: 'https://openverse/ov1', license: 'by', license_version: '2.0' }],
    });
    const p = new OpenverseProvider(search);
    const [hit] = await p.search('cats', 1);
    expect(hit).toMatchObject({ provider: 'openverse', id: 'ov1', author: 'Ann', license: 'BY 2.0' });

    const resolve = jsonFetch({ url: 'https://cdn/ov1-full.jpg', creator: 'Ann', foreign_landing_url: 'https://openverse/ov1', license: 'by', license_version: '2.0' });
    const r = await new OpenverseProvider(resolve).resolve('ov1');
    expect(r).toMatchObject({ downloadUrl: 'https://cdn/ov1-full.jpg', attribution: { provider: 'openverse', author: 'Ann' } });
  });

  it('throws on a non-ok provider response', async () => {
    await expect(new OpenverseProvider(jsonFetch({}, false)).search('x', 1)).rejects.toThrow();
  });

  it('requests page_size <= 20 (Openverse rejects anonymous requests above 20 with 401)', async () => {
    let calledUrl = '';
    const capture: FetchLike = async (url) => {
      calledUrl = url;
      return { ok: true, status: 200, json: async () => ({ results: [] }), arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } };
    };
    await new OpenverseProvider(capture).search('cats', 1);
    expect(Number(new URL(calledUrl).searchParams.get('page_size'))).toBeLessThanOrEqual(20);
  });

  it('drops results whose URLs are not https (defense-in-depth)', async () => {
    const search = jsonFetch({ results: [{ id: 'ov1', thumbnail: 'http://insecure/ov1', url: 'http://insecure/ov1' }] });
    expect(await new OpenverseProvider(search).search('cats', 1)).toEqual([]);
  });

  it('resolve returns null when the full URL is missing or non-https', async () => {
    expect(await new OpenverseProvider(jsonFetch({})).resolve('ov1')).toBeNull();
    expect(await new OpenverseProvider(jsonFetch({ url: 'http://insecure/full.jpg' })).resolve('ov1')).toBeNull();
  });
});

describe('UnsplashProvider', () => {
  it('sends the Client-ID auth header and maps results', async () => {
    const f = jsonFetch({ results: [{ id: 'u1', urls: { thumb: 'https://images.unsplash.com/u1-thumb', full: 'https://images.unsplash.com/u1-full' }, width: 1, height: 1, user: { name: 'Bo', links: { html: 'https://unsplash/@bo' } }, links: { html: 'https://unsplash/u1' } }] });
    const [hit] = await new UnsplashProvider(f).search('x', 1, 'KEY');
    expect(hit).toMatchObject({ provider: 'unsplash', id: 'u1', author: 'Bo', license: 'Unsplash License' });
    expect((f as ReturnType<typeof vi.fn>).mock.calls[0]![1].headers.Authorization).toBe('Client-ID KEY');
  });

  it('resolves the full image URL', async () => {
    const f = jsonFetch({ urls: { full: 'https://images.unsplash.com/u1-full' }, user: { name: 'Bo' }, links: { html: 'https://unsplash/u1' } });
    expect(await new UnsplashProvider(f).resolve('u1', 'KEY')).toMatchObject({ downloadUrl: 'https://images.unsplash.com/u1-full' });
  });

  it('resolve returns null when no usable (https) url is present', async () => {
    expect(await new UnsplashProvider(jsonFetch({ urls: {} })).resolve('u1', 'KEY')).toBeNull();
  });
});

describe('PexelsProvider', () => {
  it('sends the Authorization header and maps results (numeric id → truncated int string)', async () => {
    const f = jsonFetch({ photos: [{ id: 123.9, src: { medium: 'https://images.pexels.com/p1-m', large2x: 'https://images.pexels.com/p1-l' }, width: 1, height: 1, photographer: 'Cy', photographer_url: 'https://pexels/@cy', url: 'https://pexels/p1' }] });
    const [hit] = await new PexelsProvider(f).search('x', 1, 'PK');
    expect(hit).toMatchObject({ provider: 'pexels', id: '123', author: 'Cy', license: 'Pexels License' });
    expect((f as ReturnType<typeof vi.fn>).mock.calls[0]![1].headers.Authorization).toBe('PK');
  });

  it('resolves the full image URL and returns null when none is present', async () => {
    const ok = jsonFetch({ src: { large2x: 'https://images.pexels.com/p1-l' }, photographer: 'Cy', url: 'https://pexels/p1' });
    expect(await new PexelsProvider(ok).resolve('123', 'PK')).toMatchObject({ downloadUrl: 'https://images.pexels.com/p1-l', attribution: { provider: 'pexels', author: 'Cy' } });
    expect(await new PexelsProvider(jsonFetch({ src: {} })).resolve('123', 'PK')).toBeNull();
  });
});

describe('provider mappers — fallback branches', () => {
  it('Unsplash: falls back to urls.small / regular / raw and to Unknown author + thumb sourceUrl', async () => {
    const search = jsonFetch({ results: [{ id: 'u2', urls: { small: 'https://images.unsplash.com/u2-small' }, width: 1, height: 1 }] });
    const [hit] = await new UnsplashProvider(search).search('x', 1, 'K');
    expect(hit).toMatchObject({ id: 'u2', thumbUrl: 'https://images.unsplash.com/u2-small', author: 'Unknown', sourceUrl: 'https://images.unsplash.com/u2-small' });
    expect(hit!.authorUrl).toBeUndefined();
    // resolve: full absent → regular; then raw
    expect(await new UnsplashProvider(jsonFetch({ urls: { regular: 'https://images.unsplash.com/u2-reg' } })).resolve('u2', 'K')).toMatchObject({ downloadUrl: 'https://images.unsplash.com/u2-reg' });
    expect(await new UnsplashProvider(jsonFetch({ urls: { raw: 'https://images.unsplash.com/u2-raw' } })).resolve('u2', 'K')).toMatchObject({ downloadUrl: 'https://images.unsplash.com/u2-raw' });
  });

  it('Pexels: falls back to src.small / large / original and to Unknown author + thumb sourceUrl', async () => {
    const search = jsonFetch({ photos: [{ id: 9, src: { small: 'https://images.pexels.com/p9-s' }, width: 1, height: 1 }] });
    const [hit] = await new PexelsProvider(search).search('x', 1, 'PK');
    expect(hit).toMatchObject({ id: '9', thumbUrl: 'https://images.pexels.com/p9-s', author: 'Unknown', sourceUrl: 'https://images.pexels.com/p9-s' });
    expect(hit!.authorUrl).toBeUndefined();
    expect(await new PexelsProvider(jsonFetch({ src: { large: 'https://images.pexels.com/p9-lg' } })).resolve('9', 'PK')).toMatchObject({ downloadUrl: 'https://images.pexels.com/p9-lg' });
    expect(await new PexelsProvider(jsonFetch({ src: { original: 'https://images.pexels.com/p9-orig' } })).resolve('9', 'PK')).toMatchObject({ downloadUrl: 'https://images.pexels.com/p9-orig' });
  });

  it('Openverse: defaults author to Unknown and license to CC when fields are missing', async () => {
    const search = jsonFetch({ results: [{ id: 'ov2', url: 'https://cdn/ov2.jpg', width: 1, height: 1 }] });
    const [hit] = await new OpenverseProvider(search).search('x', 1);
    expect(hit).toMatchObject({ id: 'ov2', thumbUrl: 'https://cdn/ov2.jpg', author: 'Unknown', license: 'CC', sourceUrl: 'https://cdn/ov2.jpg' });
  });
});
