import { targetsPrivateHost } from '@sitewright/schema';

/** A publish-time JSON-data fetch failure (bad URL, unreachable, oversized, malformed). */
export class JsonDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonDataError';
  }
}

export interface FetchJsonDataOptions {
  /** Injectable fetch (tests). Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Abort the request after this many ms (default 8s). */
  timeoutMs?: number;
  /** Reject responses larger than this (default 2 MiB). */
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Fetch + parse a tenant-supplied JSON data URL at PUBLISH time, decoded into `{{ website.json_data }}`.
 *
 * @security The URL is tenant-controlled, so this is an SSRF sink. It is hardened the same way as the
 * stock-image downloader: https-only, public-host-only (`targetsPrivateHost`), `redirect: 'error'`
 * (a 302 to a private host can't bypass the host check), a Content-Length pre-check plus a post-read
 * size backstop, and a hard timeout. It runs in the MAIN api process (never the `--network none`
 * build worker); the parsed result is snapshotted into the build job, so the exported static site
 * never fetches anything itself. Any failure throws `JsonDataError` so the publish fails with a
 * clear, author-correctable message rather than silently rendering an empty data object.
 */
export async function fetchJsonData(url: string, options: FetchJsonDataOptions = {}): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!/^https:\/\//i.test(url) || targetsPrivateHost(url)) {
    throw new JsonDataError('JSON data URL must be a public https URL');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, redirect: 'error' });
    if (!res.ok) throw new JsonDataError(`JSON data fetch failed (${res.status})`);
    // Content-Length pre-check (early-exit). Distinguish an ABSENT header (fall through to the
    // post-read backstop) from a present value — a server lying with `Content-Length: 0` while
    // streaming a large body is still caught by the backstop below.
    const declaredHeader = res.headers.get('content-length');
    if (declaredHeader !== null) {
      const declared = Number(declaredHeader);
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new JsonDataError('JSON data exceeds the size limit');
      }
    }
    const text = await res.text();
    if (Buffer.byteLength(text) > maxBytes) throw new JsonDataError('JSON data exceeds the size limit');
    try {
      return JSON.parse(text);
    } catch {
      throw new JsonDataError('JSON data is not valid JSON');
    }
  } catch (err) {
    if (err instanceof JsonDataError) throw err;
    const aborted = err instanceof Error && (err.name === 'AbortError' || controller.signal.aborted);
    throw new JsonDataError(aborted ? 'JSON data fetch timed out' : 'JSON data fetch failed');
  } finally {
    clearTimeout(timer);
  }
}
