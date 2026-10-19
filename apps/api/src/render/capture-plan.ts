import { COLUMN_GUTTER_PX, MODEL_IMAGE_MAX_EDGE } from '@sitewright/image-pipeline';

/**
 * HOW A PREVIEW CAPTURE IS CUT UP — pure arithmetic, unit-tested; the browser half is in preview-capture.ts.
 *
 * WHY. `preview_page` used to capture the whole page as ONE image and then fit it inside the model's
 * 2,000px many-image ceiling. On a long page that is a shrink, not a crop: a 1440-wide, 8,000px page
 * came back 360px wide, a phone view 65px wide — a quarter scale at which a 16px body line is 4px of
 * noise. Five of six agents gave up on the tool and drove their own browser. The one tall image was
 * also the most expensive way to take the picture: Chromium rasterised the entire page at once.
 *
 * WHAT INSTEAD. The scale never drops below the readable one the caller asks for (half resolution for
 * a preview). A long page is cut into SEGMENTS sized for the model to read at full resolution — a long
 * edge of at most {@link MODEL_READ_EDGE} and at most {@link MAX_IMAGE_PIXELS} each, so the model API
 * does not shrink it again on the way in. Narrow viewports, whose segments are slivers, are TILED side
 * by side into one image (columns, read left to right). And one call returns at most
 * {@link MAX_IMAGES_PER_VIEWPORT} images per viewport, starting at `start`; the rest of the page is a
 * `segment` argument away. The image COUNT matters as much as the size: every image a tool result
 * carries is fed back to the model on every later turn, and a conversation's image count is capped.
 */

/** The long edge the model reads without resizing it again (its own downscale starts above this). */
export const MODEL_READ_EDGE = 1568;
/** Pixels per image — about what the model reads natively; a little over costs a ~5% rescale, not legibility. */
export const MAX_IMAGE_PIXELS = 1_300_000;
/** Gap between tiled columns (image px) — the same divider the compositor draws. */
export const COLUMN_GUTTER = COLUMN_GUTTER_PX;
/** Images per viewport per call. Two desktop segments show the top ~5,400px; a phone page fits in one. */
export const MAX_IMAGES_PER_VIEWPORT = 2;
/** An element capture is shown at full resolution up to this many image px wide. */
export const ELEMENT_MAX_WIDTH = 1280;
/**
 * Columns per tiled image, at most. Every column is a separate capture inside a render slot; without a
 * cap a 1px-wide `screenshotSelector` element would tile ~93 columns, ~186 sequential captures per
 * viewport. Real viewports never reach it (a phone page is 4 columns).
 */
export const MAX_COLUMNS = 8;

/** The region being paged through — the whole page, or one element's box — in CSS px, page coordinates. */
export interface CaptureRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PlannedSegment {
  /** 1-based. */
  index: number;
  /** CSS px, page coordinates. */
  top: number;
  bottom: number;
}

export interface PlannedImage {
  /** One segment, or several laid out as columns left to right. */
  segments: PlannedSegment[];
  /** Image px. */
  width: number;
  height: number;
}

export interface CapturePlan {
  /** Image px per CSS px. */
  scale: number;
  /** CSS px per segment. */
  segmentHeight: number;
  segmentCount: number;
  /** CSS px of the region that is captured at all (the region, up to the capture limit). */
  coveredHeight: number;
  /** The region runs past the capture limit; nothing below `coveredHeight` can be captured. */
  truncated: boolean;
  images: PlannedImage[];
  /** `start` is past the last segment — nothing to capture. */
  outOfRange?: boolean;
}

/** The scale an element is captured at: full resolution, unless that would be wider than {@link ELEMENT_MAX_WIDTH}. */
export function elementScale(boxWidth: number): number {
  return boxWidth > ELEMENT_MAX_WIDTH ? ELEMENT_MAX_WIDTH / boxWidth : 1;
}

/** How many columns of `colWidth` x `colHeight` fit one image, by edge and by pixel count. */
function columnsPerImage(colWidth: number, colHeight: number): number {
  let cols = 1;
  while (cols < MAX_COLUMNS) {
    const next = cols + 1;
    const width = next * colWidth + (next - 1) * COLUMN_GUTTER;
    if (width > MODEL_READ_EDGE || width * colHeight > MAX_IMAGE_PIXELS) return cols;
    cols = next;
  }
  return cols;
}

/** Plan the segments of `region` at `scale`, returning at most {@link MAX_IMAGES_PER_VIEWPORT} images from `start` (1-based). */
export function planSegments(region: CaptureRegion, opts: { scale: number; capHeight: number; start: number }): CapturePlan {
  const { scale } = opts;
  const colWidth = Math.max(1, Math.round(region.width * scale));
  const segOut = Math.max(1, Math.min(MODEL_READ_EDGE, Math.floor(MAX_IMAGE_PIXELS / colWidth)));
  const segmentHeight = Math.max(1, Math.floor(segOut / scale));
  const coveredHeight = Math.max(1, Math.min(region.height, opts.capHeight));
  const segmentCount = Math.ceil(coveredHeight / segmentHeight);
  const base = { scale, segmentHeight, segmentCount, coveredHeight, truncated: region.height > opts.capHeight };
  const start = Number.isFinite(opts.start) && opts.start >= 1 ? Math.floor(opts.start) : 1;
  if (start > segmentCount) return { ...base, images: [], outOfRange: true };

  const cols = columnsPerImage(colWidth, segOut);
  const images: PlannedImage[] = [];
  let index = start;
  while (index <= segmentCount && images.length < MAX_IMAGES_PER_VIEWPORT) {
    const segments: PlannedSegment[] = [];
    for (let c = 0; c < cols && index <= segmentCount; c++, index++) {
      const top = region.top + (index - 1) * segmentHeight;
      segments.push({ index, top, bottom: Math.min(top + segmentHeight, region.top + coveredHeight) });
    }
    const tallest = Math.max(...segments.map((s) => Math.round((s.bottom - s.top) * scale)));
    images.push({ segments, width: segments.length * colWidth + (segments.length - 1) * COLUMN_GUTTER, height: tallest });
  }
  return { ...base, images };
}

/**
 * The ONE whole-page image an older client (no `segment` on the request) gets — the picture it always
 * got, fitted inside the many-image ceiling. It never goes ABOVE `maxScale`: the old path rendered at
 * half scale and then resized to the ceiling, so a 3,000px page was UPSCALED to 1280x2000 and blurred.
 */
export function planLegacy(width: number, height: number, maxScale: number): { scale: number } {
  return { scale: Math.min(maxScale, MODEL_IMAGE_MAX_EDGE / Math.max(width, height, 1)) };
}
