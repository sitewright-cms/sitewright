// Headless render of a client-rendered (SPA) page for the importer. We navigate the real URL in the
// shared Chromium, but EVERY request the page makes is intercepted and served by `pinnedFetch` — so the
// browser's own (unpinnable) DNS is never used: navigation + subresources go through the same
// connect-pinned, SSRF-validated, https-only path as the fetch crawler. The browser's Referer is
// forwarded (and the top navigation is seeded with the page's own origin) so an EMBED GUARD — a host
// that 302s referer-less requests to a wrapper page (Arena/preview hosts) — resolves to the real site.
// If the rendered page is a bare wrapper around a dominant `<iframe>`, we FOLLOW that frame's URL and
// render it as the top document (page.content() serializes only the main frame). Best-effort: any
// failure returns null and the caller keeps the raw fetched HTML.
import { getBrowser } from '../render/screenshot.js';
import { pinnedFetch } from './pinned-fetch.js';

const RENDER_TIMEOUT_MS = 15_000;
const SUBRESOURCE_MAX_BYTES = 15 * 1024 * 1024;
/** Wrapper → framed document → (one nested). Bounds the iframe-follow recursion. */
const MAX_FRAME_FOLLOW = 2;

// The helpers below drive / support the real headless Chromium render — integration-only (no browser in
// unit tests), exercised by the deploy-time end-to-end import check. The pinned-fetch guard they rely on
// IS unit-tested.
/* v8 ignore start */
/** The origin root (`https://host/`) of `url`, for seeding the top-navigation Referer; null if unparsable. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin + '/';
  } catch {
    return null;
  }
}

/** The absolute URL of a viewport-DOMINATING `<iframe>` (an embed wrapper's framed site), or null. */
async function dominantFrameUrl(page: Awaited<ReturnType<Awaited<ReturnType<typeof getBrowser>>['newPage']>>): Promise<string | null> {
  // The callback runs in the browser but is TYPE-CHECKED under the Node config (no DOM lib) — describe the
  // shapes we touch via a loose `globalThis` cast, like the scroll pass below.
  return await page.evaluate(() => {
    type Frame = { src?: string; getAttribute: (n: string) => string | null; getBoundingClientRect: () => { left: number; right: number; top: number; bottom: number } };
    const g = globalThis as unknown as { innerWidth: number; innerHeight: number; document: { querySelectorAll: (s: string) => ArrayLike<Frame> } };
    const vw = g.innerWidth || 1280;
    const vh = g.innerHeight || 720;
    let best: string | null = null;
    let bestArea = 0;
    const frames = g.document.querySelectorAll('iframe');
    for (let i = 0; i < frames.length; i += 1) {
      const f = frames[i]!;
      const src = f.src || f.getAttribute('src') || '';
      if (!/^https?:\/\//i.test(src)) continue;
      const r = f.getBoundingClientRect();
      const area = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      if (area > bestArea) {
        bestArea = area;
        best = src;
      }
    }
    // Only follow a frame that covers most of the viewport (a real wrapper, not an embedded widget).
    return bestArea >= vw * vh * 0.5 ? best : null;
  });
}

/** Render `url` and return the post-JS HTML, or null if it can't be rendered safely/at all. */
export async function renderViaBrowser(url: string, opts: { signal?: AbortSignal; _depth?: number } = {}): Promise<string | null> {
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
      // Forward the browser's Referer (set on subframe/subresource loads, and on the top navigation via
      // goto's `referer` below) so an embed-guarded host resolves to the real page, not its wrapper.
      const referer = request.headers()['referer'];
      const r = await pinnedFetch(request.url(), {
        timeoutMs: 10_000,
        maxBytes: SUBRESOURCE_MAX_BYTES,
        signal: opts.signal,
        ...(referer ? { headers: { referer } } : {}),
      }).catch(() => null);
      if (!r) return route.abort('blockedbyclient');
      await route.fulfill({ status: r.status, headers: { 'content-type': r.contentType }, body: Buffer.from(r.bytes) }).catch(() => {});
    });
    // Seed the top navigation's Referer with the page's own origin → ungates embed-guarded hosts (which
    // 302 a referer-less request to their wrapper) without affecting normal sites.
    const origin = originOf(url);
    await page.goto(url, { waitUntil: 'networkidle', timeout: RENDER_TIMEOUT_MS, ...(origin ? { referer: origin } : {}) }).catch(() => {});
    // Scroll top→bottom to trigger lazy-loaded / IntersectionObserver-mounted content (deferred lower
    // sections, lazy-mounted modals, lazy images) so the CAPTURED DOM is COMPLETE — then settle the network
    // its fetches kicked off. No DOM mutation (no injected style, no overflow release), so the serialized
    // HTML isn't polluted; scroll position doesn't persist into page.content().
    await page
      .evaluate(async () => {
        const g = globalThis as unknown as {
          innerHeight: number; scrollBy: (x: number, y: number) => void; scrollTo: (x: number, y: number) => void;
          setInterval: (fn: () => void, ms: number) => number; clearInterval: (id: number) => void; setTimeout: (fn: () => void, ms: number) => void;
          document: { documentElement: { scrollHeight: number } };
        };
        await new Promise<void>((resolve) => {
          let y = 0, steps = 0; const step = Math.max(200, g.innerHeight);
          const tick = g.setInterval(() => {
            g.scrollBy(0, step); y += step;
            if (y >= g.document.documentElement.scrollHeight || ++steps > 60) { g.clearInterval(tick); g.scrollTo(0, 0); g.setTimeout(resolve, 150); }
          }, 50);
        });
      })
      .catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
    // FOLLOW a dominant embed <iframe> — its framed document is the REAL site (page.content() serializes
    // only the main frame). Re-render the frame URL as a top document (referer-seeded, so its own embed
    // guard resolves). Bounded recursion; a self-referential frame is skipped.
    const depth = opts._depth ?? 0;
    if (depth < MAX_FRAME_FOLLOW) {
      const frameUrl = await dominantFrameUrl(page).catch(() => null);
      if (frameUrl && frameUrl !== url) {
        const framed = await renderViaBrowser(frameUrl, { signal: opts.signal, _depth: depth + 1 });
        if (framed) return framed;
      }
    }
    return await page.content();
  } catch {
    return null;
  } finally {
    await context?.close().catch(() => {});
  }
}
/* v8 ignore stop */
