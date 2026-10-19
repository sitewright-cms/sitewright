import type { CDPSession, Page } from 'playwright-core';
import { composeColumns } from '@sitewright/image-pipeline';
import type { ScreenshotViewport, ScreenshotViewportName } from '@sitewright/schema';
import { elementScale, planLegacy, planSegments, type CaptureRegion, type PlannedSegment } from './capture-plan.js';

/**
 * Turns a settled preview page into the images `preview_page` returns. The cutting rules are in
 * capture-plan.ts; this runs them against a page through a {@link CaptureDriver}, so the orchestration
 * is unit-tested with a fake driver and only {@link cdpDriver} needs a real browser.
 *
 * Every image is taken with ONE bounded clip (`Page.captureScreenshot` with a clip and a scale) rather
 * than one full-page capture that is cut up afterwards. MEASURED on a 13,000px page at 1920 wide, half
 * scale: the full-page capture added 114-158MB to Chromium; the five segments taken one by one added
 * ~74MB, and the two a call actually returns ~46MB. The clip's scale also lets an element be captured
 * sharper than the page without a second page load, and never moves the layout viewport (a `100vh`
 * hero stays one screen tall).
 */

/** What a call asks for. `segment` is 1-based; `selector` captures one element instead of the page. */
export interface CaptureRequest {
  segment: number;
  selector?: string;
}

/** One image of a page (or element), with where on the page it came from. */
export interface PreviewCapture {
  viewport: ScreenshotViewportName;
  kind: 'page' | 'element';
  base64: string;
  mimeType: 'image/jpeg';
  /** Image px. */
  width: number;
  height: number;
  /** Image px per CSS px. */
  scale: number;
  /** The segments in this image — several means columns, left to right. CSS px, page coordinates. */
  segments: PlannedSegment[];
  segmentCount: number;
  /** CSS px height of what is paged through: the page (or element), up to the capture limit. */
  totalHeight: number;
  /** The page is taller than the capture limit; nothing below `totalHeight` was captured. */
  truncated?: boolean;
  /** Element captures: the selector, and how many elements it matched (the FIRST is captured). */
  selector?: string;
  matches?: number;
}

/** Why a viewport has no image (or fewer than asked) — said, not silently omitted. */
export interface CaptureNote {
  viewport: ScreenshotViewportName;
  message: string;
}

/** The legacy single whole-page image: dimensions in CSS px, as that response always reported them. */
export interface LegacyShot {
  base64: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}

/** What the capture needs from a page. */
export interface CaptureDriver {
  /** CSS px height of the document. */
  documentHeight(): Promise<number>;
  /** The FIRST element matching `selector` (CSS px, page coordinates), or 'invalid' for a bad selector. */
  element(selector: string): Promise<{ box: CaptureRegion | null; matches: number } | 'invalid'>;
  /** A JPEG of `clip` (CSS px, page coordinates) at `scale` image px per CSS px. */
  grab(clip: CaptureRegion, scale: number): Promise<Buffer>;
}

export const PREVIEW_JPEG_QUALITY = 78;

const px = (n: number): string => `${Math.round(n).toLocaleString('en-US')}px`;

/** The part of an element's box that lies across the viewport — what a visitor can actually see of it. */
function visiblePart(box: CaptureRegion, viewportWidth: number): CaptureRegion | null {
  const left = Math.max(0, box.left);
  const right = Math.min(viewportWidth, box.left + box.width);
  const top = Math.max(0, box.top);
  const height = box.top + box.height - top;
  if (right - left < 1 || height < 1) return null;
  return { left, top, width: right - left, height };
}

/** Capture one viewport of a settled page per `request`. Never throws for a page-level reason — it notes it. */
export async function capturePreviewViewport(
  driver: CaptureDriver,
  viewport: ScreenshotViewportName,
  vp: ScreenshotViewport,
  request: CaptureRequest,
  pageScale: number,
): Promise<{ captures: PreviewCapture[]; notes: CaptureNote[] }> {
  const note = (message: string) => ({ captures: [], notes: [{ viewport, message }] });
  let region: CaptureRegion;
  let scale: number;
  let element: { selector: string; matches: number } | undefined;
  if (request.selector !== undefined) {
    const sel = request.selector;
    const found = await driver.element(sel);
    if (found === 'invalid') return note(`"${sel}" is not a valid CSS selector.`);
    if (!found.box) {
      return note(
        found.matches === 0
          ? `no element matches "${sel}" at this width.`
          : `"${sel}" matches ${found.matches} element${found.matches === 1 ? '' : 's'}, but the first has no visible box here (hidden, or zero-sized).`,
      );
    }
    const visible = visiblePart(found.box, vp.width);
    if (!visible) return note(`the first element matching "${sel}" lies outside the ${vp.width}px viewport.`);
    region = visible;
    scale = elementScale(region.width);
    element = { selector: sel, matches: found.matches };
  } else {
    // At least one screen, as the full-page capture always was: a short page shows the whole viewport.
    region = { left: 0, top: 0, width: vp.width, height: Math.max(await driver.documentHeight(), vp.height) };
    scale = pageScale;
  }

  const plan = planSegments(region, { scale, capHeight: vp.capHeight, start: request.segment });
  const what = element ? `the element "${element.selector}"` : 'the page';
  if (plan.outOfRange) {
    return note(
      `there is no segment ${request.segment}: ${what} is ${px(plan.coveredHeight)} tall here — ${plan.segmentCount} segment${plan.segmentCount === 1 ? '' : 's'} of ${px(plan.segmentHeight)}.`,
    );
  }
  const captures: PreviewCapture[] = [];
  for (const img of plan.images) {
    // One at a time: each clip is bounded, and Chromium never holds more than one of them.
    const parts: Buffer[] = [];
    for (const s of img.segments) parts.push(await driver.grab({ left: region.left, top: s.top, width: region.width, height: s.bottom - s.top }, scale));
    const out = await composeColumns(parts);
    captures.push({
      viewport,
      kind: element ? 'element' : 'page',
      base64: out.buffer.toString('base64'),
      mimeType: 'image/jpeg',
      width: out.width,
      height: out.height,
      scale,
      segments: img.segments,
      segmentCount: plan.segmentCount,
      totalHeight: plan.coveredHeight,
      ...(plan.truncated ? { truncated: true } : {}),
      ...(element ?? {}),
    });
  }
  return { captures, notes: [] };
}

/**
 * The single whole-page image a request WITHOUT `segment` gets — what older clients have always been
 * sent (planLegacy). Taken directly at its final scale, so a long page no longer rasterises in full at
 * half resolution only to be shrunk again.
 */
export async function captureLegacyShot(driver: CaptureDriver, vp: ScreenshotViewport, maxScale: number): Promise<LegacyShot> {
  const height = Math.min(Math.max(await driver.documentHeight(), vp.height), vp.capHeight);
  const { scale } = planLegacy(vp.width, height, maxScale);
  const buf = await driver.grab({ left: 0, top: 0, width: vp.width, height }, scale);
  return { base64: buf.toString('base64'), mimeType: 'image/jpeg', width: vp.width, height };
}

/**
 * Settle with `work`, or reject after `ms` — and swallow `work`'s own late rejection, which comes when the
 * caller closes the page under it. A raw CDP call has NO timeout of its own (unlike `page.screenshot`,
 * which the page's default timeout bounds), so a wedged renderer would otherwise hold its render slot,
 * context and memory reservation for the life of the process.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  work.catch(() => {});
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/* v8 ignore start -- drives a real page over CDP; the orchestration above is unit-tested with a fake driver,
   and capture-layout.test.ts exercises this against a real browser where one is installed. */
/** A {@link CaptureDriver} over a settled Playwright page; every call is bounded by `timeoutMs`. */
export function cdpDriver(page: Page, cdp: CDPSession, timeoutMs: number): CaptureDriver {
  // No DOM lib in this tsconfig — describe only what is touched.
  interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
  }
  return {
    documentHeight: () =>
      withTimeout(
        page.evaluate(() => {
          const d = (globalThis as unknown as { document: { documentElement: { scrollHeight: number }; body: { scrollHeight: number } | null } }).document;
          return Math.max(d.documentElement.scrollHeight, d.body?.scrollHeight ?? 0);
        }),
        timeoutMs,
        'measuring the page',
      ),
    element: (selector) =>
      withTimeout(page.evaluate((sel) => {
        const d = (globalThis as unknown as {
          document: {
            querySelectorAll(s: string): ArrayLike<{ getBoundingClientRect(): Rect }>;
            scrollingElement: { scrollTop: number; scrollLeft: number } | null;
          };
        }).document;
        let list: ArrayLike<{ getBoundingClientRect(): Rect }>;
        try {
          list = d.querySelectorAll(sel);
        } catch {
          return 'invalid' as const;
        }
        const first = list[0];
        if (!first) return { box: null, matches: 0 };
        const r = first.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return { box: null, matches: list.length };
        const x0 = d.scrollingElement?.scrollLeft ?? 0;
        const y0 = d.scrollingElement?.scrollTop ?? 0;
        return { box: { left: r.left + x0, top: r.top + y0, width: r.width, height: r.height }, matches: list.length };
      }, selector), timeoutMs, 'finding the element'),
    grab: async (clip, scale) => {
      const shot = await withTimeout(
        cdp.send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: PREVIEW_JPEG_QUALITY,
          captureBeyondViewport: true,
          clip: { x: clip.left, y: clip.top, width: clip.width, height: clip.height, scale },
        }),
        timeoutMs,
        'the capture',
      );
      return Buffer.from(shot.data, 'base64');
    },
  };
}
/* v8 ignore stop */
