// Headless render of a client-rendered (SPA) page for the importer. We navigate the real URL in the
// shared Chromium, but EVERY request the page makes is intercepted and served by `pinnedFetch` — so the
// browser's own (unpinnable) DNS is never used: navigation + subresources go through the same
// connect-pinned, SSRF-validated, https-only path as the fetch crawler. Best-effort: any failure returns
// null and the caller keeps the raw fetched HTML.
import { getBrowser } from '../render/screenshot.js';
import { pinnedFetch } from './pinned-fetch.js';

const RENDER_TIMEOUT_MS = 15_000;
const SUBRESOURCE_MAX_BYTES = 15 * 1024 * 1024;

// Drives a real headless Chromium, so it can't run in unit tests (no browser in the env) — it's
// exercised by the deploy-time end-to-end import check. The pinned-fetch guard it relies on IS tested.
/* v8 ignore start */
/** Render `url` and return the post-JS HTML, or null if it can't be rendered safely/at all. */
export async function renderViaBrowser(url: string, opts: { signal?: AbortSignal } = {}): Promise<string | null> {
  let browser;
  try {
    browser = await getBrowser();
  } catch {
    return null; // no browser available → caller falls back to the raw HTML
  }
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);
    // WebSocket upgrades are HTTP GETs — close them outright so they never reach the pinned fetcher.
    await page.routeWebSocket(/.*/, (ws) => ws.close());
    await page.route('**/*', async (route, request) => {
      // Only plain GETs go through the pinned fetcher; non-GET + Upgrade (WS) requests are blocked.
      if (request.method() !== 'GET' || request.headers()['upgrade']) return route.abort('blockedbyclient');
      const r = await pinnedFetch(request.url(), { timeoutMs: 10_000, maxBytes: SUBRESOURCE_MAX_BYTES, signal: opts.signal }).catch(() => null);
      if (!r) return route.abort('blockedbyclient');
      await route.fulfill({ status: r.status, headers: { 'content-type': r.contentType }, body: Buffer.from(r.bytes) }).catch(() => {});
    });
    // networkidle can legitimately time out on a chatty SPA — capture the DOM regardless.
    await page.goto(url, { waitUntil: 'networkidle', timeout: RENDER_TIMEOUT_MS }).catch(() => {});
    return await page.content();
  } catch {
    return null;
  } finally {
    await context?.close().catch(() => {});
  }
}
/* v8 ignore stop */
