// compare-to-source: screenshot a URL (the agent's BUILD via the loopback preview, or the LIVE SOURCE)
// so the `compare_to_source` tool can hand an agent build + source side-by-side and let it self-correct.
//
// Symmetric capture for both sides, reusing the existing screenshot browser:
//  - mode 'loopback' — the build's own preview URL on the API origin; subresources load normally.
//  - mode 'pinned'   — an EXTERNAL source URL; EVERY request is served by `pinnedFetch` (https-only,
//                      SSRF-validated, connect-pinned), exactly like the importer's `renderViaBrowser`,
//                      so the browser's unpinnable DNS is never used.
import { SCREENSHOT_VIEWPORTS, DEFAULT_SCREENSHOT_VIEWPORTS, isScreenshotViewportName } from '@sitewright/schema';
import { matchAndDiff, scorePage, matchChrome, scoreChrome, scoreChromeMeta, type ChromeEl, type ChromeMeta } from '@sitewright/site-import/fidelity';
import { getBrowser, withRenderSlot, type Shot, type ViewportName } from './screenshot.js';
import { FIDELITY_EXTRACT, FIDELITY_META } from './fidelity-extract.js';

type Browser = Awaited<ReturnType<typeof getBrowser>>;
type BrowserContext = Awaited<ReturnType<Browser['newContext']>>;
type Page = Awaited<ReturnType<BrowserContext['newPage']>>;
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
  /**
   * The page's FULL nested route slug (e.g. `services/building-engineering`), pre-resolved from the
   * parent chain by the caller. `page.path` is ONLY the page's own leaf segment, so a child page's build
   * URL built from it (`/…/building-engineering/`) 404s → a blank BUILD capture. Falls back to `page.path`
   * for a top-level page / callers that don't resolve the route.
   */
  route?: string;
  /** Raw `viewports` query string (comma-separated); unknown names are dropped. */
  viewports?: string;
}): CompareTargets {
  if (!opts.page) return { error: 'not-found' };
  const sourceUrl = opts.page.data?.swImport?.sourceUrl;
  if (!sourceUrl) return { error: 'no-source' };
  const route = (opts.route ?? opts.page.path ?? '').replace(/^\/+/, '');
  const buildUrl = `http://${opts.originHostPort}/preview-site/${opts.projectId}/${opts.sig}/${route}${route && !route.endsWith('/') ? '/' : ''}`;
  const vps = (opts.viewports ?? '').split(',').map((v) => v.trim()).filter((v): v is ViewportName => isScreenshotViewportName(v));
  return { sourceUrl, route, buildUrl, ...(vps.length ? { viewports: vps } : {}) };
}

// Drives a real headless Chromium (no browser in unit tests) — exercised by the deploy-time e2e check,
// like renderViaBrowser. The SSRF guard it relies on (pinnedFetch) IS unit-tested.
/* v8 ignore start */
// Shared page setup for a capture in the given `mode`: new context, the SSRF-pinned network routing for an
// external source, navigate, and scroll-settle lazy content. Both the screenshot capture (shootOne) and the
// element capture (captureUrlElements) build on this, so the pinned routing lives in exactly ONE place.
async function prepPage(browser: Browser, url: string, mode: CaptureMode, vp: (typeof SCREENSHOT_VIEWPORTS)[ViewportName], signal?: AbortSignal): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    isMobile: vp.isMobile,
    reducedMotion: 'reduce',
  });
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
  return { context, page };
}

async function shootOne(browser: Browser, url: string, mode: CaptureMode, vp: (typeof SCREENSHOT_VIEWPORTS)[ViewportName], signal?: AbortSignal): Promise<Shot> {
  const { context, page } = await prepPage(browser, url, mode, vp, signal);
  try {
    await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
    // Lazy cross-origin embeds (Google Maps, video) fetch tiles/players AFTER networkidle and never
    // re-settle it, so a fullPage shot catches them mid-load (a grey box). Give a page that has any
    // iframe a short extra beat to paint before capture. Skipped entirely for iframe-free pages.
    const hasEmbed = await page
      .evaluate(() => (globalThis as unknown as { document: { querySelector(s: string): unknown } }).document.querySelector('iframe') != null)
      .catch(() => false);
    if (hasEmbed) await page.waitForTimeout(1800).catch(() => {});
    const fullHeight = await page
      .evaluate(() => (globalThis as unknown as { document: { documentElement: { scrollHeight: number } } }).document.documentElement.scrollHeight)
      .catch(() => vp.height);
    // Capture the WHOLE page. Use Playwright `fullPage` (Chromium captures beyond the viewport WITHOUT
    // resizing the layout viewport) so the footer/below-the-fold is included AND `vh`-based sections keep
    // their real height — resizing the viewport instead would make a `100vh`/`80vh` hero grow with it,
    // inflating the page toward the cap. Only a PATHOLOGICALLY tall page (over the DoS cap) falls back to a
    // bounded, capped viewport capture.
    const height = Math.min(Math.max(fullHeight, vp.height), vp.capHeight);
    let buf: Buffer;
    if (fullHeight <= vp.capHeight) {
      buf = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY, fullPage: true });
    } else {
      await page.setViewportSize({ width: vp.width, height: vp.capHeight }).catch(() => {});
      await page.waitForTimeout(150).catch(() => {});
      buf = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY });
    }
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

/**
 * Capture the fidelity ELEMENTS + whole-bar meta from `url` at Full HD (1920), the same viewport the CLI gate
 * uses — for the `fidelity_check` MCP tool. Reuses the SSRF-pinned render path (via prepPage) exactly like
 * `captureUrlShots`, but runs the in-page extract instead of a screenshot. Returns empty on any failure so the
 * gate degrades to a low-coverage FAIL rather than throwing.
 */
export async function captureUrlElements(
  url: string,
  opts: { mode: CaptureMode; signal?: AbortSignal },
): Promise<{ items: ChromeEl[]; meta: ChromeMeta }> {
  const browser = await getBrowser();
  const vp = SCREENSHOT_VIEWPORTS.fullhd;
  return withRenderSlot(async () => {
    const { context, page } = await prepPage(browser, url, opts.mode, vp, opts.signal);
    try {
      await page.evaluate(async () => { const g = globalThis as unknown as { document?: { fonts?: { ready?: Promise<unknown> } } }; if (g.document?.fonts?.ready) { try { await g.document.fonts.ready; } catch { /* fonts optional */ } } }).catch(() => {});
      const items = (await page.evaluate(FIDELITY_EXTRACT as () => unknown).catch(() => [])) as ChromeEl[];
      const meta = (await page.evaluate(FIDELITY_META as () => unknown).catch(() => ({}))) as ChromeMeta;
      return { items, meta };
    } finally {
      await context.close().catch(() => {});
    }
  }).catch(() => ({ items: [] as ChromeEl[], meta: {} as ChromeMeta }));
}
/* v8 ignore stop */

/**
 * Pure: run the fidelity diff on captured original vs build element sets + meta, and shape a compact,
 * agent-readable result (matches the CLI gate's BODY + CHROME + META scoring). Kept out of the browser-driving
 * code so it's unit-testable.
 */
export interface FidelityResult {
  pass: boolean;
  body: { pass: boolean; coverage: number; matched: number; orig: number; fontMiss: number; gradFail: number; score: number };
  chrome: { pass: boolean; coverage: number; matched: number; orig: number; posOff: number; sizeOff: number; styleOff: number; metaOff: number };
  diffs: { body: string[]; chrome: string[]; meta: string[] };
}
export function scoreFidelity(
  orig: { items: ChromeEl[]; meta: ChromeMeta },
  build: { items: ChromeEl[]; meta: ChromeMeta },
): FidelityResult {
  const bodyMatch = matchAndDiff(orig.items.filter((e) => e.region === 'body' && e.text), build.items.filter((e) => e.region === 'body' && e.text));
  const body = scorePage(bodyMatch);
  const chrome = scoreChrome(matchChrome(orig.items, build.items));
  const meta = scoreChromeMeta(orig.meta, build.meta);
  return {
    pass: body.pass && chrome.pass && meta.pass,
    body: { pass: body.pass, coverage: body.coverage, matched: body.matched, orig: body.origCount, fontMiss: body.fontMiss, gradFail: body.gradFail, score: body.score },
    chrome: { pass: chrome.pass && meta.pass, coverage: chrome.coverage, matched: chrome.matched, orig: chrome.origCount, posOff: chrome.posOff, sizeOff: chrome.sizeOff, styleOff: chrome.styleOff, metaOff: meta.metaOff },
    diffs: {
      body: bodyMatch.diffs.slice(0, 10).map((d) => `[${d.role}] "${d.text.slice(0, 34)}": ${d.props.join(', ')}`),
      chrome: chrome.diffs.slice(0, 14).map((d) => `(${d.region}) "${d.label.slice(0, 24)}": ${d.props.join(', ')}`),
      meta: meta.diffs,
    },
  };
}
