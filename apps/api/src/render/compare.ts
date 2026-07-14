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
import { pngToLosslessWebp } from '@sitewright/image-pipeline';
import { getBrowser, withRenderSlot, settlePage, type Shot, type ViewportName } from './screenshot.js';
import { FIDELITY_EXTRACT, FIDELITY_META, REGION_BOX } from './fidelity-extract.js';
import { BEHAVIOUR_PROBE, NAV_COUNT, NAV_TOGGLE } from './clone-audit-probe.js';
import type { BehaviourFacts } from './clone-audit.js';

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
// external source, and navigate. The scroll/fonts/embed/animation SETTLE is a separate shared step
// (`settlePage`, screenshot.ts) each caller runs next — with `freeze:false` for the behaviour probe. The
// pinned routing lives in exactly ONE place.
async function prepPage(browser: Browser, url: string, mode: CaptureMode, vp: (typeof SCREENSHOT_VIEWPORTS)[ViewportName], signal?: AbortSignal, deviceScaleFactor = 1): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor,
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
  return { context, page };
  } catch (e) {
    // Close the context if setup threw before we could hand it back (else the caller's finally never runs
    // and the render slot leaks until the concurrency timeout). Security review LOW.
    await context.close().catch(() => {});
    throw e;
  }
}

async function shootOne(browser: Browser, url: string, mode: CaptureMode, vp: (typeof SCREENSHOT_VIEWPORTS)[ViewportName], signal?: AbortSignal): Promise<Shot> {
  const { context, page } = await prepPage(browser, url, mode, vp, signal);
  try {
    // Scroll-load + fonts + iframe/embed paint + animation freeze (shared, identical for build + original).
    await settlePage(page, { freeze: true });
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
      // Scroll-load + fonts + iframe/embed paint, then FREEZE animations to a stable end-state — so an
      // auto-rotating slider / scroll-reveal doesn't change which elements are present/visible run-to-run
      // (which would drift the ORIGINAL's element count, the coverage denominator). Applied identically to
      // BOTH sides via the shared settle, so the comparison stays fair AND stable across runs.
      await settlePage(page, { freeze: true });
      // NOTE: unlike the CLI gate we do NOT run a mouse-hover pass here, so ChromeEl.hover is undefined both
      // sides — scoreChrome guards on `if (o.hover)`, so hover:MISSING? is simply never surfaced (the CLI
      // marks it "reported, not gated" anyway, so PASS/FAIL is unaffected).
      const items = (await page.evaluate(FIDELITY_EXTRACT as () => unknown).catch(() => [])) as ChromeEl[];
      const meta = (await page.evaluate(FIDELITY_META as () => unknown).catch(() => ({}))) as ChromeMeta;
      return { items, meta };
    } finally {
      await context.close().catch(() => {});
    }
  }).catch(() => ({ items: [] as ChromeEl[], meta: {} as ChromeMeta }));
}

/**
 * Capture the BEHAVIOUR facts of a BUILD render for `clone_audit`: a desktop probe (carousels enhanced,
 * modals present, heading/body fonts actually LOADED) plus a phone-width (390px) pass that counts the
 * header nav links reachable — clicking a menu toggle first if they're collapsed — so a missing mobile
 * drawer is caught. Reuses the SSRF-pinned scroll-and-settle render (prepPage); degrades to a safe-empty
 * result on any failure (the caller surfaces that as the relevant check failing).
 */
export async function captureBehaviour(
  url: string,
  opts: { mode: CaptureMode; signal?: AbortSignal; navExpected: number; hasModalTrigger: boolean },
): Promise<BehaviourFacts> {
  const browser = await getBrowser();
  // FAIL-BY-DEFAULT: a render failure must not green-light the fonts check — fonts default UNLOADED so an
  // audit fails conservatively on instability (only a SUCCESSFUL probe of a genuinely system-font page reports
  // loaded, via the probe's own isSystem path). Overwritten wholesale by a successful BEHAVIOUR_PROBE.
  const desktopFallback = { carousels: 0, carouselsEnhanced: 0, dialogs: 0, headingFont: '', bodyFont: '', headingFontLoaded: false, bodyFontLoaded: false };
  const nav = { navExpected: opts.navExpected, hasModalTrigger: opts.hasModalTrigger };
  return withRenderSlot(async () => {
    // DESKTOP probe: sliders / modals / fonts-loaded.
    const dp = await prepPage(browser, url, opts.mode, SCREENSHOT_VIEWPORTS.fullhd, opts.signal);
    let desktop = desktopFallback;
    try {
      // freeze:false — the probe needs live runtimes (a slider must actually enhance, fonts must load) to
      // detect them; the shared settle still scrolls/loads + waits fonts + waits embeds.
      await settlePage(dp.page, { freeze: false });
      desktop = ((await dp.page.evaluate(BEHAVIOUR_PROBE as () => unknown).catch(() => null)) as typeof desktopFallback | null) ?? desktopFallback;
    } finally {
      await dp.context.close().catch(() => {});
    }
    // MOBILE pass: nav reachability at 390px (open the toggle if the links are collapsed).
    const mp = await prepPage(browser, url, opts.mode, SCREENSHOT_VIEWPORTS.mobile, opts.signal);
    let navReachableMobile = 0;
    try {
      await settlePage(mp.page, { freeze: false });
      navReachableMobile = ((await mp.page.evaluate(NAV_COUNT as () => unknown).catch(() => 0)) as number) || 0;
      if (navReachableMobile < opts.navExpected) {
        const opened = ((await mp.page.evaluate(NAV_TOGGLE as () => unknown).catch(() => false)) as boolean);
        if (opened) { await mp.page.waitForTimeout(450).catch(() => {}); navReachableMobile = ((await mp.page.evaluate(NAV_COUNT as () => unknown).catch(() => 0)) as number) || 0; }
      }
    } finally {
      await mp.context.close().catch(() => {});
    }
    return { ...desktop, ...nav, navReachableMobile };
  }).catch(() => ({ ...desktopFallback, ...nav, navReachableMobile: 0 }));
}

/** A high-res region crop, lossless WebP, base64. */
export interface RegionShot { base64: string; mimeType: 'image/webp'; width: number; height: number }
/** Default regions for the high-res chrome compare: the nav header and the footer. */
export const DEFAULT_COMPARE_REGIONS: Record<string, string> = { header: '#main-nav, header, nav', footer: '#footer, footer' };

/**
 * Capture HIGH-RESOLUTION crops of named page REGIONS (default: header + footer) at 2× device scale, encoded
 * as LOSSLESS WebP — for the `compare_regions` tool, so an agent can SEE fine chrome detail (gradient stops,
 * skew edges, thin shadows) that a 1× full-page JPEG smears. Reuses the same SSRF-pinned render path
 * (prepPage) as the screenshot + element captures; Chromium emits PNG, transcoded to lossless WebP via sharp.
 * Returns {} on any failure (the caller degrades to "no crop for this side").
 */
export async function captureUrlRegions(
  url: string,
  opts: { mode: CaptureMode; regions?: Record<string, string>; signal?: AbortSignal },
): Promise<Record<string, RegionShot>> {
  const regions = opts.regions ?? DEFAULT_COMPARE_REGIONS;
  const browser = await getBrowser();
  const vp = SCREENSHOT_VIEWPORTS.fullhd;
  return withRenderSlot(async () => {
    const { context, page } = await prepPage(browser, url, opts.mode, vp, opts.signal, 2); // 2× = high-res
    const out: Record<string, RegionShot> = {};
    try {
      // Scroll-load + fonts + iframe/embed paint + animation freeze before the high-res chrome crops.
      await settlePage(page, { freeze: true });
      for (const [name, sel] of Object.entries(regions)) {
        const box = (await page.evaluate(REGION_BOX as (s: string) => { x: number; y: number; w: number; h: number } | null, sel).catch(() => null));
        if (!box || box.w < 4 || box.h < 4) continue;
        await page.waitForTimeout(120).catch(() => {}); // let the scrolled region settle before the shot
        // Cap the crop height (CSS px) so a very tall footer can't blow up the base64 payload: at 2× this is
        // 3000 physical px — a header is ~60-120px and a footer ~200-600px, so 1500 is generous headroom
        // while bounding worst-case response size (4 crops/response). Security/code review MEDIUM.
        const clip = { x: box.x, y: box.y, width: Math.min(vp.width - box.x, box.w), height: Math.min(1500, box.h) };
        const png = await page.screenshot({ type: 'png', clip }).catch(() => null);
        if (!png) continue;
        const w = await pngToLosslessWebp(png).catch(() => null);
        if (w) out[name] = { base64: w.buffer.toString('base64'), mimeType: 'image/webp', width: w.width, height: w.height };
      }
      return out;
    } finally {
      await context.close().catch(() => {});
    }
  }).catch(() => ({}) as Record<string, RegionShot>);
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
      meta: meta.diffs.slice(0, 10),
    },
  };
}
