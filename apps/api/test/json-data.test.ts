import { describe, it, expect } from 'vitest';
import { fetchJsonData, JsonDataError } from '../src/publish/json-data.js';

/** Minimal Response stub for the injected fetch. */
function res(opts: { ok?: boolean; status?: number; body?: string; contentLength?: string }): Response {
  const headers = new Map<string, string>();
  if (opts.contentLength !== undefined) headers.set('content-length', opts.contentLength);
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    text: async () => opts.body ?? '',
  } as unknown as Response;
}

const PUB = 'https://en.wikipedia.org/api/rest_v1/page/summary/Berlin';

describe('fetchJsonData', () => {
  it('fetches + parses a public https JSON URL', async () => {
    const data = await fetchJsonData(PUB, {
      fetchImpl: async () => res({ body: '{"title":"Berlin","extract":"Capital of Germany"}' }),
    });
    expect(data).toEqual({ title: 'Berlin', extract: 'Capital of Germany' });
  });

  it('rejects non-https URLs (no plaintext data fetch)', async () => {
    await expect(fetchJsonData('http://en.wikipedia.org/x', { fetchImpl: async () => res({}) })).rejects.toBeInstanceOf(
      JsonDataError,
    );
  });

  it('rejects private/internal hosts (SSRF guard) before fetching', async () => {
    let called = false;
    const spy = async () => {
      called = true;
      return res({});
    };
    await expect(fetchJsonData('https://localhost/x', { fetchImpl: spy })).rejects.toThrow(/public https/i);
    await expect(fetchJsonData('https://192.168.1.5/x', { fetchImpl: spy })).rejects.toBeInstanceOf(JsonDataError);
    await expect(fetchJsonData('https://169.254.169.254/latest', { fetchImpl: spy })).rejects.toBeInstanceOf(JsonDataError);
    expect(called).toBe(false); // guard fires before any network call
  });

  it('rejects a non-OK response', async () => {
    await expect(fetchJsonData(PUB, { fetchImpl: async () => res({ ok: false, status: 404 }) })).rejects.toThrow(/404/);
  });

  it('rejects a body that is not valid JSON', async () => {
    await expect(fetchJsonData(PUB, { fetchImpl: async () => res({ body: '<html>nope' }) })).rejects.toThrow(/not valid JSON/i);
  });

  it('enforces the size cap (declared Content-Length and the read backstop)', async () => {
    await expect(
      fetchJsonData(PUB, { maxBytes: 10, fetchImpl: async () => res({ contentLength: '99999', body: '{}' }) }),
    ).rejects.toThrow(/size limit/i);
    await expect(
      fetchJsonData(PUB, { maxBytes: 10, fetchImpl: async () => res({ body: '{"a":"aaaaaaaaaaaaaaaaaaaa"}' }) }),
    ).rejects.toThrow(/size limit/i);
  });

  it('maps an aborted (timed-out) fetch to a clear error', async () => {
    await expect(
      fetchJsonData(PUB, {
        fetchImpl: async () => {
          throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        },
      }),
    ).rejects.toThrow(/timed out/i);
  });

  it('forbids redirects (passes redirect:"error" to fetch)', async () => {
    let init: RequestInit | undefined;
    await fetchJsonData(PUB, {
      fetchImpl: async (_u, i) => {
        init = i;
        return res({ body: '{}' });
      },
    });
    expect(init?.redirect).toBe('error');
  });
});
