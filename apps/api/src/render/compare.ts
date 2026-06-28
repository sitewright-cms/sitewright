// compare-to-source: screenshot a URL (the agent's BUILD via the loopback preview, or the LIVE SOURCE)
// so the `compare_to_source` tool can hand an agent build + source side-by-side and let it self-correct.
//
// Symmetric capture for both sides, reusing the existing screenshot browser:
//  - mode 'loopback' — the build's own preview URL on the API origin; subresources load normally.
//  - mode 'pinned'   — an EXTERNAL source URL; EVERY request is served by `pinnedFetch` (https-only,
//                      SSRF-validated, connect-pinned), exactly like the importer's `renderViaBrowser`,
//                      so the browser's unpinnable DNS is never used.
import { SCREENSHOT_VIEWPORTS, DEFAULT_SCREENSHOT_VIEWPORTS, isScreenshotViewportName } from '@sitewright/schema';
import { getBrowser, withRenderSlot, type Shot, type ViewportName } from './screenshot.js';

type Browser = Awaited<ReturnType<typeof getBrowser>>;
import { pinnedFetch } from '../import/pinned-fetch.js';

const NAV_TIMEOUT_MS = 20_000;
const SUBRESOURCE_MAX_BYTES = 15 * 1024 * 1024;
const JPEG_QUALITY = 72;

export type CaptureMode = 'loopback' | 'pinned';

/** The page shape the compare route reads (its route + import source). */
export interface ComparePageInput {
  path?: string;
  data?: { swImport?: { sourceUrl?: string } };
}
export type CompareTargets =
  | { error: 'not-found' | 'no-source' }
  | { sourceUrl: string; route: string; buildUrl: string; viewports?: ViewportName[] };

/**
 * Pure: resolve what to screenshot for a compare request — the page's import SOURCE url and its own
 * loopback BUILD preview url (route-rebased, trailing slash for non-root) — or an error sentinel when the
 * page is missing or was never imported. Kept out of the browser-driving code so it's unit-testable.
 */
export function compareTargets(opts: {
  page: ComparePageInput | null;
  projectId: string;
  sig: string;
  originHostPort: string;
  /** Raw `viewports` query string (comma-separated); unknown names are dropped. */
  viewports?: string;
}): CompareTargets {
  if (!opts.page) return { error: 'not-found' };
  const sourceUrl = opts.page.data?.swImport?.sourceUrl;
  if (!sourceUrl) return { error: 'no-source' };
  const route = (opts.page.path ?? '').replace(/^\/+/, '');
  const buildUrl = `http://${opts.originHostPort}/preview-site/${opts.projectId}/${opts.sig}/${route}${route && !route.endsWith('/') ? '/' : ''}`;
  const vps = (opts.viewports ?? '').split(',').map((v) => v.trim()).filter((v): v is ViewportName => isScreenshotViewportName(v));
  return { sourceUrl, route, buildUrl, ...(vps.length ? { viewports: vps } : {}) };
}

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
    // Grow the viewport to the full (capped) page height, then capture — a `clip` taller than the viewport
    // is silently CLAMPED to the viewport by the browser, which produced top-of-page-only screenshots
    // (everything below the fold was invisible to the comparing agent). Resizing makes the whole page paint.
    await page.setViewportSize({ width: vp.width, height }).catch(() => {});
    await page.waitForTimeout(200).catch(() => {});
    const buf = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY });
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
