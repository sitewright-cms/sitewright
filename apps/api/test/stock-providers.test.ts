import { describe, it, expect, vi } from 'vitest';
import { OpenverseProvider, UnsplashProvider, PexelsProvider, PixabayProvider, defaultStockProviders, type FetchLike } from '../src/stock/providers.js';

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

describe('rendition choice — the sizes each provider is asked for', () => {
  // These pin the PREFERENCE ORDER, not just "a url came back". The fallback tests below only ever
  // supply one candidate, so they pass under any order — which is how an import silently shipped a
  // 1080px `regular` while a full-resolution `full` sat right next to it in the same payload.
  it('Unsplash import takes `full` even when the smaller renditions are present', async () => {
    const f = jsonFetch({
      urls: {
        raw: 'https://images.unsplash.com/u1-raw',
        full: 'https://images.unsplash.com/u1-full',
        regular: 'https://images.unsplash.com/u1-reg',
        small: 'https://images.unsplash.com/u1-small',
      },
      user: { name: 'Bo' },
      links: { html: 'https://unsplash/u1' },
    });
    expect(await new UnsplashProvider(f).resolve('u1', 'K')).toMatchObject({ downloadUrl: 'https://images.unsplash.com/u1-full' });
  });

  it('Pexels import takes `original` even when large2x/large are present', async () => {
    const f = jsonFetch({
      src: { original: 'https://images.pexels.com/p1-orig', large2x: 'https://images.pexels.com/p1-l2x', large: 'https://images.pexels.com/p1-lg' },
      photographer: 'Cy',
      url: 'https://pexels/p1',
    });
    expect(await new PexelsProvider(f).resolve('1', 'PK')).toMatchObject({ downloadUrl: 'https://images.pexels.com/p1-orig' });
  });

  it('search results carry a MID-size previewUrl distinct from the grid thumbnail', async () => {
    const [u] = await new UnsplashProvider(
      jsonFetch({ results: [{ id: 'u1', urls: { thumb: 'https://images.unsplash.com/u1-thumb', regular: 'https://images.unsplash.com/u1-reg', full: 'https://images.unsplash.com/u1-full' }, width: 1, height: 1 }] }),
    ).search('x', 1, 'K');
    expect(u).toMatchObject({ thumbUrl: 'https://images.unsplash.com/u1-thumb', previewUrl: 'https://images.unsplash.com/u1-reg' });

    const [p] = await new PexelsProvider(
      jsonFetch({ photos: [{ id: 1, src: { medium: 'https://images.pexels.com/p1-m', large: 'https://images.pexels.com/p1-lg' }, width: 1, height: 1 }] }),
    ).search('x', 1, 'PK');
    expect(p).toMatchObject({ thumbUrl: 'https://images.pexels.com/p1-m', previewUrl: 'https://images.pexels.com/p1-lg' });

    const [o] = await new OpenverseProvider(
      jsonFetch({ results: [{ id: 'ov1', thumbnail: 'https://cdn/ov1-thumb.jpg', url: 'https://cdn/ov1.jpg', width: 1, height: 1 }] }),
    ).search('x', 1);
    expect(o).toMatchObject({ thumbUrl: 'https://cdn/ov1-thumb.jpg', previewUrl: 'https://cdn/ov1.jpg' });
  });

  it('previewUrl falls back to the thumbnail when no larger rendition is offered', async () => {
    const [u] = await new UnsplashProvider(
      jsonFetch({ results: [{ id: 'u1', urls: { thumb: 'https://images.unsplash.com/u1-thumb' }, width: 1, height: 1 }] }),
    ).search('x', 1, 'K');
    expect(u!.previewUrl).toBe('https://images.unsplash.com/u1-thumb');
  });

  it('each provider asks for its OWN page size, and the request URL says so', async () => {
    const capture = (): { fetchImpl: FetchLike; url: () => string } => {
      let seen = '';
      return {
        fetchImpl: async (url) => {
          seen = url;
          return { ok: true, status: 200, json: async () => ({ results: [], photos: [] }), arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } };
        },
        url: () => seen,
      };
    };
    const ov = capture();
    await new OpenverseProvider(ov.fetchImpl).search('x', 1);
    expect(new URL(ov.url()).searchParams.get('page_size')).toBe('20');

    const un = capture();
    const unsplash = new UnsplashProvider(un.fetchImpl);
    await unsplash.search('x', 1, 'K');
    expect(new URL(un.url()).searchParams.get('per_page')).toBe(String(unsplash.pageSize));
    expect(unsplash.pageSize).toBe(30);

    const px = capture();
    const pexels = new PexelsProvider(px.fetchImpl);
    await pexels.search('x', 1, 'PK');
    expect(new URL(px.url()).searchParams.get('per_page')).toBe(String(pexels.pageSize));
  });
});

describe('PixabayProvider', () => {
  /** Captures the URL (and any headers) a provider call made — Pixabay's key rides in the URL. */
  function capture(payload: unknown, ok = true): { fetchImpl: FetchLike; url: () => string; init: () => unknown } {
    let seen = '';
    let seenInit: unknown;
    return {
      fetchImpl: async (url, init) => {
        seen = url;
        seenInit = init;
        return { ok, status: ok ? 200 : 429, json: async () => payload, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } };
      },
      url: () => seen,
      init: () => seenInit,
    };
  }

  const HIT = {
    id: 195893,
    pageURL: 'https://pixabay.com/photos/blossom-195893/',
    previewURL: 'https://cdn.pixabay.com/photo/flower-195893_150.jpg',
    webformatURL: 'https://pixabay.com/get/flower_640.jpg',
    largeImageURL: 'https://pixabay.com/get/flower_1280.jpg',
    imageWidth: 4000,
    imageHeight: 2250,
    user: 'Josch13',
    user_id: 48777,
  };

  it('maps a hit: 640px tile, 1280px preview, ORIGINAL dimensions, composed profile URL', async () => {
    const [hit] = await new PixabayProvider(jsonFetch({ hits: [HIT] })).search('flowers', 1, 'PK');
    expect(hit).toEqual({
      provider: 'pixabay',
      id: '195893',
      thumbUrl: 'https://pixabay.com/get/flower_640.jpg',
      previewUrl: 'https://pixabay.com/get/flower_1280.jpg',
      // imageWidth/Height, NOT webformatWidth/Height — the author is judging the file they import.
      width: 4000,
      height: 2250,
      author: 'Josch13',
      authorUrl: 'https://pixabay.com/users/Josch13-48777/',
      sourceUrl: 'https://pixabay.com/photos/blossom-195893/',
      license: 'Pixabay Content License',
    });
  });

  it('sends the key as a QUERY PARAMETER and no auth header (the one provider that does)', async () => {
    const c = capture({ hits: [] });
    await new PixabayProvider(c.fetchImpl).search('flowers', 1, 'PK');
    expect(new URL(c.url()).searchParams.get('key')).toBe('PK');
    expect(c.init()).toBeUndefined();
  });

  it('never leaks the key into the error it throws for a failed request', async () => {
    const c = capture({}, false);
    await expect(new PixabayProvider(c.fetchImpl).search('x', 1, 'SUPER-SECRET')).rejects.toThrow(
      /provider request failed \(429\)/,
    );
    await expect(new PixabayProvider(c.fetchImpl).search('x', 1, 'SUPER-SECRET')).rejects.not.toThrow(/SUPER-SECRET/);
  });

  it('asks for photos only, with safesearch on and its own page size', async () => {
    const c = capture({ hits: [] });
    const p = new PixabayProvider(c.fetchImpl);
    await p.search('x', 2, 'PK');
    const params = new URL(c.url()).searchParams;
    // Vectors resolve to SVG, which the image store refuses outright — so photos only.
    expect(params.get('image_type')).toBe('photo');
    expect(params.get('safesearch')).toBe('true');
    expect(params.get('per_page')).toBe(String(p.pageSize));
    expect(params.get('page')).toBe('2');
    expect(p.pageSize).toBe(30);
  });

  it('clamps a query to Pixabay’s 100-character limit on a word boundary', async () => {
    const c = capture({ hits: [] });
    // 12 x 9 chars = 108 > 100, so the last whole word has to go rather than 400-ing upstream.
    const long = Array.from({ length: 12 }, (_, i) => `word${String(i).padStart(4, '0')}`).join(' ');
    expect(long.length).toBeGreaterThan(100);
    await new PixabayProvider(c.fetchImpl).search(long, 1, 'PK');
    const sent = new URL(c.url()).searchParams.get('q') ?? '';
    expect(sent.length).toBeLessThanOrEqual(100);
    expect(long.startsWith(sent)).toBe(true);
    expect(sent.endsWith(' ')).toBe(false);
  });

  it('resolves by id and prefers the original over Full HD over the 1280px scale', async () => {
    const c = capture({ hits: [{ ...HIT, fullHDURL: 'https://pixabay.com/get/flower_1920.jpg', imageURL: 'https://pixabay.com/get/flower_orig.jpg' }] });
    const r = await new PixabayProvider(c.fetchImpl).resolve('195893', 'PK');
    expect(new URL(c.url()).searchParams.get('id')).toBe('195893');
    expect(r).toMatchObject({
      downloadUrl: 'https://pixabay.com/get/flower_orig.jpg',
      attribution: { provider: 'pixabay', author: 'Josch13', sourceUrl: 'https://pixabay.com/photos/blossom-195893/', license: 'Pixabay Content License' },
    });
  });

  it('falls back down the resolution chain a standard (non-full-access) key gets', async () => {
    // fullHDURL/imageURL only exist for accounts approved for full API access; 1280 is the floor.
    const hd = await new PixabayProvider(jsonFetch({ hits: [{ ...HIT, fullHDURL: 'https://pixabay.com/get/flower_1920.jpg' }] })).resolve('1', 'PK');
    expect(hd).toMatchObject({ downloadUrl: 'https://pixabay.com/get/flower_1920.jpg' });
    const large = await new PixabayProvider(jsonFetch({ hits: [HIT] })).resolve('1', 'PK');
    expect(large).toMatchObject({ downloadUrl: 'https://pixabay.com/get/flower_1280.jpg' });
  });

  it('resolve returns null for an unknown id (empty hits) and for a non-https file', async () => {
    expect(await new PixabayProvider(jsonFetch({ total: 0, hits: [] })).resolve('nope', 'PK')).toBeNull();
    expect(await new PixabayProvider(jsonFetch({ hits: [{ ...HIT, largeImageURL: 'http://insecure/flower.jpg' }] })).resolve('1', 'PK')).toBeNull();
  });

  it('falls back to previewURL, Unknown author and no profile URL when fields are missing', async () => {
    const [hit] = await new PixabayProvider(
      jsonFetch({ hits: [{ id: 7, previewURL: 'https://cdn.pixabay.com/photo/x_150.jpg' }] }),
    ).search('x', 1, 'PK');
    expect(hit).toMatchObject({ id: '7', thumbUrl: 'https://cdn.pixabay.com/photo/x_150.jpg', previewUrl: 'https://cdn.pixabay.com/photo/x_150.jpg', author: 'Unknown', sourceUrl: 'https://cdn.pixabay.com/photo/x_150.jpg' });
    expect(hit!.authorUrl).toBeUndefined();
  });

  it('drops a hit whose URLs are not https', async () => {
    expect(await new PixabayProvider(jsonFetch({ hits: [{ id: 8, webformatURL: 'http://insecure/x_640.jpg', previewURL: 'http://insecure/x_150.jpg' }] })).search('x', 1, 'PK')).toEqual([]);
  });

  it('is in the default registry and declares that it needs a key', async () => {
    const registry = defaultStockProviders(jsonFetch({ hits: [] }));
    expect([...registry.keys()]).toEqual(['openverse', 'unsplash', 'pexels', 'pixabay']);
    expect(registry.get('pixabay')?.requiresKey).toBe(true);
  });
});

describe('provider mappers — fallback branches', () => {
  it('Unsplash: falls back to urls.small / regular / raw and to Unknown author + thumb sourceUrl', async () => {
    const search = jsonFetch({ results: [{ id: 'u2', urls: { small: 'https://images.unsplash.com/u2-small' }, width: 1, height: 1 }] });
    const [hit] = await new UnsplashProvider(search).search('x', 1, 'K');
    expect(hit).toMatchObject({ id: 'u2', thumbUrl: 'https://images.unsplash.com/u2-small', author: 'Unknown', sourceUrl: 'https://images.unsplash.com/u2-small' });
    expect(hit!.authorUrl).toBeUndefined();
    // resolve falls back down the chain when the preferred rendition is absent (full → raw → regular)
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
