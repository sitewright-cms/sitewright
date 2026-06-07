import { describe, it, expect, afterEach, vi } from 'vitest';
import { downloadGoogleFont, FontFetchError } from '../src/fonts/service.js';

/** A css2 response with one latin @font-face per requested weight, pointing at gstatic woff2 urls. */
function css2(weights: number[]): string {
  return weights
    .map(
      (w) => `/* latin */
@font-face {
  font-family: 'Playfair Display';
  font-style: normal;
  font-weight: ${w};
  src: url(https://fonts.gstatic.com/s/playfairdisplay/v37/face-${w}.woff2) format('woff2');
}`,
    )
    .join('\n');
}
const cssResponse = (weights: number[]) => new Response(css2(weights), { headers: { 'content-type': 'text/css' } });
const woff2Response = (bytes = 'WOFF2') => new Response(Buffer.from(bytes), { headers: { 'content-type': 'font/woff2' } });

describe('downloadGoogleFont', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('downloads the requested weight and returns its woff2 bytes (no storage)', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      return url.includes('googleapis.com/css2') ? cssResponse([700]) : woff2Response('FONTBYTES');
    }));

    const dl = await downloadGoogleFont('Playfair Display', [700]);
    expect(dl.family).toBe('Playfair Display');
    expect(dl.fallback).toBe('serif');
    expect(dl.faces).toHaveLength(1);
    expect(dl.faces[0]).toMatchObject({ weight: 700, style: 'normal', format: 'woff2' });
    expect(dl.faces[0]!.bytes.toString()).toBe('FONTBYTES');
    expect(calls[0]).toBe('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap');
    expect(calls[1]).toBe('https://fonts.gstatic.com/s/playfairdisplay/v37/face-700.woff2');
  });

  it('intersects requested weights with what the family offers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('css2') ? cssResponse([700]) : woff2Response())));
    const dl = await downloadGoogleFont('Playfair Display', [700, 123]); // 123 isn't a Playfair weight
    expect(dl.faces.map((f) => f.weight)).toEqual([700]);
  });

  it('prefers the latin subset when a weight has multiple subset faces', async () => {
    const multi = `/* cyrillic */
@font-face { font-family:'Playfair Display'; font-weight:700; src:url(https://fonts.gstatic.com/s/pd/cyr-700.woff2) format('woff2'); }
/* latin */
@font-face { font-family:'Playfair Display'; font-weight:700; src:url(https://fonts.gstatic.com/s/pd/latin-700.woff2) format('woff2'); }`;
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      return url.includes('css2') ? new Response(multi, { headers: { 'content-type': 'text/css' } }) : woff2Response();
    }));
    await downloadGoogleFont('Playfair Display', [700]);
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
    const dl = await downloadGoogleFont('Playfair Display', [700]);
    expect(dl.faces.map((f) => f.weight)).toEqual([700]);
    expect(calls).toContain('https://fonts.gstatic.com/s/pd/cyr-700.woff2');
  });

  it('rejects a family not in the bundled catalog before any fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(downloadGoogleFont('Definitely Not A Font', [400])).rejects.toBeInstanceOf(FontFetchError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when none of the requested weights are available', async () => {
    await expect(downloadGoogleFont('Playfair Display', [123])).rejects.toThrow(/no available weights/);
  });

  it('throws when the css fetch is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await expect(downloadGoogleFont('Playfair Display', [700])).rejects.toThrow(/font fetch failed/);
  });

  it('throws when the css yields no usable gstatic faces (off-allowlist src)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(`/* latin */ @font-face { font-weight: 700; src: url(https://evil.example/x.woff2) format('woff2') }`, {
        headers: { 'content-type': 'text/css' },
      }),
    ));
    await expect(downloadGoogleFont('Playfair Display', [700])).rejects.toThrow(/no font files/);
  });
});
