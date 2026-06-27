// compare-to-source: screenshot a URL (the agent's BUILD via the loopback preview, or the LIVE SOURCE)
// so the `compare_to_source` tool can hand an agent build + source side-by-side and let it self-correct.
//
// Symmetric capture for both sides, reusing the existing screenshot browser:
//  - mode 'loopback' — the build's own preview URL on the API origin; subresources load normally.
//  - mode 'pinned'   — an EXTERNAL source URL; EVERY request is served by `pinnedFetch` (https-only,
//                      SSRF-validated, connect-pinned), exactly like the importer's `renderViaBrowser`,
//                      so the browser's unpinnable DNS is never used.
import { SCREENSHOT_VIEWPORTS, DEFAULT_SCREENSHOT_VIEWPORTS } from '@sitewright/schema';
import { getBrowser, withRenderSlot, type Shot, type ViewportName } from './screenshot.js';

type Browser = Awaited<ReturnType<typeof getBrowser>>;
import { pinnedFetch } from '../import/pinned-fetch.js';

const NAV_TIMEOUT_MS = 20_000;
const SUBRESOURCE_MAX_BYTES = 15 * 1024 * 1024;
const JPEG_QUALITY = 72;

export type CaptureMode = 'loopback' | 'pinned';

// Drives a real headless Chromium (no browser in unit tests) — exercised by the deploy-time e2e check,
// like renderViaBrowser. The SSRF guard it relies on (pinnedFetch) IS unit-tested.
/* v8 ignore start */
async function shootOne(browser: Browser, url: string, mode: CaptureMode, vp: (typeof SCREENSHOT_VIEWPORTS)[ViewportName], signal?: AbortSignal): Promise<Shot> {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    isMobile: vp.isMobile,
    reducedMotion: 'reduce',
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);
    if (mode === 'pinned') {
      // Route the whole external page through the pinned fetcher (no browser DNS) — renderViaBrowser pattern.
      await page.routeWebSocket(/.*/, (ws) => ws.close());
      await page.route('**/*', async (route, request) => {
        if (request.method() !== 'GET' || request.headers()['upgrade']) return route.abort('blockedbyclient');
        const r = await pinnedFetch(request.url(), { timeoutMs: 10_000, maxBytes: SUBRESOURCE_MAX_BYTES, signal }).catch(() => null);
        if (!r) return route.abort('blockedbyclient');
        await route.fulfill({ status: r.status, headers: { 'content-type': r.contentType }, body: Buffer.from(r.bytes) }).catch(() => {});
      });
    }
    await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS }).catch(() => {});
    // Trigger scroll-reveal/lazy content, then release any preloader scroll-lock so fullPage isn't clipped.
    await page
      .evaluate(async () => {
        const g = globalThis as unknown as {
          innerHeight: number; scrollBy: (x: number, y: number) => void; scrollTo: (x: number, y: number) => void;
          setInterval: (fn: () => void, ms: number) => number; clearInterval: (id: number) => void;
          setTimeout: (fn: () => void, ms: number) => void;
          document: { documentElement: { scrollHeight: number; style: { setProperty(p: string, v: string, prio?: string): void } }; body: { style: { setProperty(p: string, v: string, prio?: string): void } } };
        };
        await new Promise<void>((resolve) => {
          let y = 0, steps = 0; const step = Math.max(200, g.innerHeight);
          const tick = g.setInterval(() => {
            g.scrollBy(0, step); y += step;
            if (y >= g.document.documentElement.scrollHeight || ++steps > 60) { g.clearInterval(tick); g.scrollTo(0, 0); g.setTimeout(resolve, 150); }
          }, 50);
        });
        for (const el of [g.document.documentElement, g.document.body]) {
          el.style.setProperty('overflow', 'visible', 'important');
          el.style.setProperty('height', 'auto', 'important');
        }
      })
      .catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
    const fullHeight = await page
      .evaluate(() => (globalThis as unknown as { document: { documentElement: { scrollHeight: number } } }).document.documentElement.scrollHeight)
      .catch(() => vp.height);
    const height = Math.min(Math.max(fullHeight, vp.height), vp.capHeight);
    const buf = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY, clip: { x: 0, y: 0, width: vp.width, height } });
    return { base64: buf.toString('base64'), mimeType: 'image/jpeg', width: vp.width, height };
  } finally {
    await context.close().catch(() => {});
  }
}

/** Screenshot `url` at the requested viewports (default desktop+mobile). `mode` picks the network path. */
export async function captureUrlShots(
  url: string,
  opts: { mode: CaptureMode; viewports?: ViewportName[]; signal?: AbortSignal },
): Promise<Partial<Record<ViewportName, Shot>>> {
  const wanted = opts.viewports ?? DEFAULT_SCREENSHOT_VIEWPORTS;
  const browser = await getBrowser();
  const plan = (Object.entries(SCREENSHOT_VIEWPORTS) as Array<[ViewportName, (typeof SCREENSHOT_VIEWPORTS)[ViewportName]]>).filter(([n]) => wanted.includes(n));
  const out: Array<[ViewportName, Shot]> = [];
  for (const [name, vp] of plan) {
    const shot = await withRenderSlot(() => shootOne(browser, url, opts.mode, vp, opts.signal)).catch(() => null);
    if (shot) out.push([name, shot]);
  }
  return Object.fromEntries(out);
}
/* v8 ignore stop */
