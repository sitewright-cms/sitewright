import { describe, it, expect, vi, afterEach } from 'vitest';
import { defaultDownloadImage } from '../src/stock/service.js';
import { StockProviderError } from '../src/stock/providers.js';

type DlInit = { redirect?: string; signal?: AbortSignal };
type DlResult = { ok: boolean; status: number; headers: { get(k: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> };

function fetchReturning(opts: { ok?: boolean; status?: number; contentType?: string; contentLength?: string; bytes?: number }) {
  const headers = new Map<string, string>();
  if (opts.contentType !== undefined) headers.set('content-type', opts.contentType);
  if (opts.contentLength !== undefined) headers.set('content-length', opts.contentLength);
  return vi.fn<(url: string, init?: DlInit) => Promise<DlResult>>(async () => ({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    arrayBuffer: async () => new ArrayBuffer(opts.bytes ?? 8),
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('defaultDownloadImage (SSRF + size + type guards)', () => {
  it('refuses a non-https URL without fetching', async () => {
    const f = fetchReturning({});
    vi.stubGlobal('fetch', f);
    await expect(defaultDownloadImage('http://example.com/x.jpg')).rejects.toBeInstanceOf(StockProviderError);
    expect(f).not.toHaveBeenCalled();
  });

  it('refuses a private/loopback host (incl. IPv4-mapped IPv6) without fetching', async () => {
    const f = fetchReturning({});
    vi.stubGlobal('fetch', f);
    await expect(defaultDownloadImage('https://127.0.0.1/x.jpg')).rejects.toBeInstanceOf(StockProviderError);
    await expect(defaultDownloadImage('https://[::ffff:a9fe:a9fe]/meta')).rejects.toBeInstanceOf(StockProviderError);
    expect(f).not.toHaveBeenCalled();
  });

  it('fetches with redirect:error and no-follow semantics', async () => {
    const f = fetchReturning({ contentType: 'image/png', bytes: 8 });
    vi.stubGlobal('fetch', f);
    await defaultDownloadImage('https://cdn.example/x.png');
    expect(f.mock.calls[0]![1]!.redirect).toBe('error');
    expect(f.mock.calls[0]![1]!.signal).toBeDefined();
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', fetchReturning({ ok: false, status: 503 }));
    await expect(defaultDownloadImage('https://cdn.example/x.png')).rejects.toThrow(/download failed/);
  });

  it('rejects a non-image content-type', async () => {
    vi.stubGlobal('fetch', fetchReturning({ contentType: 'text/html', bytes: 8 }));
    await expect(defaultDownloadImage('https://cdn.example/x.png')).rejects.toThrow(/not an image/);
  });

  it('rejects when the declared Content-Length exceeds the cap', async () => {
    vi.stubGlobal('fetch', fetchReturning({ contentType: 'image/jpeg', contentLength: String(20 * 1024 * 1024) }));
    await expect(defaultDownloadImage('https://cdn.example/x.jpg')).rejects.toThrow(/size limit/);
  });

  it('rejects when the actual body exceeds the cap (no/again small declared length)', async () => {
    vi.stubGlobal('fetch', fetchReturning({ contentType: 'image/jpeg', contentLength: '0', bytes: 16 * 1024 * 1024 }));
    await expect(defaultDownloadImage('https://cdn.example/x.jpg')).rejects.toThrow(/size limit/);
  });

  it('returns the buffer and a charset-stripped content-type on success', async () => {
    vi.stubGlobal('fetch', fetchReturning({ contentType: 'image/jpeg; charset=binary', bytes: 8 }));
    const out = await defaultDownloadImage('https://cdn.example/x.jpg');
    expect(out.contentType).toBe('image/jpeg');
    expect(out.buffer.length).toBe(8);
  });
});
