import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FontStore } from '../src/fonts/store.js';
import { selectGoogleFont, FontFetchError } from '../src/fonts/service.js';

/** A css2 response with one latin @font-face per requested weight, pointing at gstatic woff2 urls. */
function css2(weights: number[]): string {
  return weights
    .map(
      (w) => `/* latin */
@font-face {
  font-family: 'Playfair Display';
  font-style: normal;
  font-weight: ${w};
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/playfairdisplay/v37/face-${w}.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`,
    )
    .join('\n');
}

function cssResponse(weights: number[]): Response {
  return new Response(css2(weights), { headers: { 'content-type': 'text/css; charset=utf-8' } });
}
function woff2Response(bytes = 'WOFF2', contentLength?: number): Response {
  const headers: Record<string, string> = { 'content-type': 'font/woff2' };
  if (contentLength !== undefined) headers['content-length'] = String(contentLength);
  return new Response(Buffer.from(bytes), { headers });
}

describe('selectGoogleFont', () => {
  let root: string;
  let store: FontStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sw-fontsvc-'));
    store = new FontStore(root);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(root, { recursive: true, force: true });
  });

  it('downloads + self-hosts the requested weight and returns the record', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      return url.includes('googleapis.com/css2') ? cssResponse([700]) : woff2Response();
    }));

    const font = await selectGoogleFont(store, 'Playfair Display', [700]);

    expect(font).toEqual({
      id: 'playfair-display',
      family: 'Playfair Display',
      fallback: 'serif',
      source: 'google',
      files: [{ weight: 700, style: 'normal', format: 'woff2', file: '700.woff2' }],
    });
    expect(await store.has('playfair-display', '700.woff2')).toBe(true);
    // css2 url is the keyless endpoint, '+'-encoded family, joined weights.
    expect(calls[0]).toBe('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap');
    expect(calls[1]).toBe('https://fonts.gstatic.com/s/playfairdisplay/v37/face-700.woff2');
  });

  it('prefers the latin subset when a weight has multiple subset faces', async () => {
    // Two faces for weight 700 (cyrillic FIRST, latin second) — the latin woff2 must win.
    const multi = `/* cyrillic */
@font-face { font-family:'Playfair Display'; font-weight:700; src:url(https://fonts.gstatic.com/s/pd/cyr-700.woff2) format('woff2'); }
/* latin */
@font-face { font-family:'Playfair Display'; font-weight:700; src:url(https://fonts.gstatic.com/s/pd/latin-700.woff2) format('woff2'); }`;
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      return url.includes('css2') ? new Response(multi, { headers: { 'content-type': 'text/css' } }) : woff2Response();
    }));
    const font = await selectGoogleFont(store, 'Playfair Display', [700]);
    expect(font.files.map((f) => f.weight)).toEqual([700]);
    expect(calls).toContain('https://fonts.gstatic.com/s/pd/latin-700.woff2');
    expect(calls).not.toContain('https://fonts.gstatic.com/s/pd/cyr-700.woff2');
  });

  it('falls back to a non-latin subset when latin is absent for a weight', async () => {
    const cyrOnly = `/* cyrillic */
@font-face { font-family:'Playfair Display'; font-weight:700; src:url(https://fonts.gstatic.com/s/pd/cyr-700.woff2) format('woff2'); }`;
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      return url.includes('css2') ? new Response(cyrOnly, { headers: { 'content-type': 'text/css' } }) : woff2Response();
    }));
    const font = await selectGoogleFont(store, 'Playfair Display', [700]);
    expect(font.files.map((f) => f.weight)).toEqual([700]);
    expect(calls).toContain('https://fonts.gstatic.com/s/pd/cyr-700.woff2');
  });

  it('intersects requested weights with what the family offers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('css2') ? cssResponse([700]) : woff2Response(),
    ));
    // 123 is not a Playfair weight → dropped; only 700 is fetched + returned.
    const font = await selectGoogleFont(store, 'Playfair Display', [700, 123]);
    expect(font.files.map((f) => f.weight)).toEqual([700]);
  });

  it('does NOT re-download a weight already cached (only the css is fetched)', async () => {
    await store.write('playfair-display', '700.woff2', Buffer.from('cached'));
    const fetchMock = vi.fn(async () => cssResponse([700]));
    vi.stubGlobal('fetch', fetchMock);

    const font = await selectGoogleFont(store, 'Playfair Display', [700]);
    expect(font.files.map((f) => f.weight)).toEqual([700]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // css only — no gstatic woff2 fetch
    expect((await store.read('playfair-display', '700.woff2')).toString()).toBe('cached');
  });

  it('rejects a family not in the bundled catalog (allowlist gate) before any fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(selectGoogleFont(store, 'Definitely Not A Font', [400])).rejects.toBeInstanceOf(FontFetchError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when none of the requested weights are available', async () => {
    await expect(selectGoogleFont(store, 'Playfair Display', [123])).rejects.toThrow(/no available weights/);
  });

  it('rejects a woff2 over the size cap (content-length)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('css2') ? cssResponse([700]) : woff2Response('big', 3 * 1024 * 1024),
    ));
    await expect(selectGoogleFont(store, 'Playfair Display', [700])).rejects.toThrow(/size limit/);
  });

  it('throws when the css fetch is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await expect(selectGoogleFont(store, 'Playfair Display', [700])).rejects.toThrow(/font fetch failed/);
  });

  it('tolerates a woff2 response with no content-type / content-length header', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('css2')
        ? cssResponse([700])
        : new Response(Buffer.from('WOFF2')), // no headers at all
    ));
    const font = await selectGoogleFont(store, 'Playfair Display', [700]);
    expect(font.files.map((f) => f.weight)).toEqual([700]);
  });

  it('throws when the css yields no usable gstatic faces', async () => {
    // A css whose src points off-allowlist (not gstatic) matches no face → nothing downloads.
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(
        `/* latin */ @font-face { font-weight: 700; src: url(https://evil.example/x.woff2) format('woff2') }`,
        { headers: { 'content-type': 'text/css' } },
      ),
    ));
    await expect(selectGoogleFont(store, 'Playfair Display', [700])).rejects.toThrow(/no font files/);
  });
});
