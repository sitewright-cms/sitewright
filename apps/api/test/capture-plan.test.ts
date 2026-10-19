import { describe, expect, it } from 'vitest';
import { SCREENSHOT_VIEWPORTS } from '@sitewright/schema';
import {
  COLUMN_GUTTER,
  ELEMENT_MAX_WIDTH,
  MAX_COLUMNS,
  MAX_IMAGE_PIXELS,
  MAX_IMAGES_PER_VIEWPORT,
  MODEL_READ_EDGE,
  elementScale,
  planLegacy,
  planSegments,
  type CapturePlan,
} from '../src/render/capture-plan.js';
import { MODEL_IMAGE_MAX_EDGE } from '../src/render/mcp-image.js';

/**
 * How a preview capture is cut up. The page is never shrunk below a READABLE scale; a long page is
 * split into segments sized for the model to read at full resolution, narrow viewports tile several
 * segments into one image, and a call returns at most two images per viewport — the rest is a
 * `segment` away. Pure arithmetic, so every breakpoint is pinned here.
 */

const page = (width: number, height: number) => ({ left: 0, top: 0, width, height });
const vp = SCREENSHOT_VIEWPORTS;

/** Every image the plan would emit stays inside the model's limits. */
function expectReadable(plan: CapturePlan): void {
  for (const img of plan.images) {
    expect(Math.max(img.width, img.height), 'long edge').toBeLessThanOrEqual(MODEL_READ_EDGE);
    expect(img.width * img.height, 'pixels').toBeLessThanOrEqual(MAX_IMAGE_PIXELS);
  }
  expect(plan.images.length).toBeLessThanOrEqual(MAX_IMAGES_PER_VIEWPORT);
}

describe('planSegments — a whole page', () => {
  it('★ a long DESKTOP page stays at half scale (960px wide), split into segments — never shrunk to fit', () => {
    // THE BUG: a 1440-wide, 8,000px page came back 360px wide because the whole page was fitted into
    // one 2,000px image. At 50% a 16px body line is still 8px tall; at 25% it is noise.
    const plan = planSegments(page(1920, 9450), { scale: 0.5, capHeight: vp.fullhd.capHeight, start: 1 });
    expect(plan.scale).toBe(0.5);
    expect(plan.images.every((img) => img.width === 960)).toBe(true);
    expect(plan.segmentHeight).toBe(2708); // 1,354 image px — 1.3 MP at 960 wide
    expect(plan.segmentCount).toBe(4);
    // Two images per call: the top 5,416px. Segments 3–4 are one `segment: 3` away.
    expect(plan.images.map((i) => i.segments.map((s) => s.index))).toEqual([[1], [2]]);
    expect(plan.images[1]!.segments[0]).toEqual({ index: 2, top: 2708, bottom: 5416 });
    expectReadable(plan);
  });

  it('pages on from `start`, and the last segment is only as tall as what is left', () => {
    const plan = planSegments(page(1920, 9450), { scale: 0.5, capHeight: vp.fullhd.capHeight, start: 3 });
    expect(plan.images.map((i) => i.segments)).toEqual([[{ index: 3, top: 5416, bottom: 8124 }], [{ index: 4, top: 8124, bottom: 9450 }]]);
    expect(plan.images[1]!.height).toBe(663); // (9450 − 8124) × 0.5
  });

  it('★ a long MOBILE page is tiled into ONE image of side-by-side columns', () => {
    // 390px at half scale is a 195px column. Fitted to 2,000px it was 65px wide; as separate segments
    // it would spend an image per screen. Four columns read top-to-bottom, left-to-right, in one image.
    const plan = planSegments(page(390, 11800), { scale: 0.5, capHeight: vp.mobile.capHeight, start: 1 });
    expect(plan.segmentHeight).toBe(3136);
    expect(plan.segmentCount).toBe(4);
    expect(plan.images).toHaveLength(1);
    expect(plan.images[0]!.segments.map((s) => s.index)).toEqual([1, 2, 3, 4]);
    expect(plan.images[0]!.width).toBe(4 * 195 + 3 * COLUMN_GUTTER);
    expectReadable(plan);
  });

  it('keeps every breakpoint inside the limits, at a readable scale', () => {
    for (const [name, v] of Object.entries(vp)) {
      const plan = planSegments(page(v.width, 30_000), { scale: 0.5, capHeight: v.capHeight, start: 1 });
      expect(plan.truncated, name).toBe(true);
      expectReadable(plan);
      expect(plan.images[0]!.segments[0]!.top, name).toBe(0);
    }
  });

  it('a SHORT page is one image of the whole page — same as it always was', () => {
    const plan = planSegments(page(1920, 1500), { scale: 0.5, capHeight: vp.fullhd.capHeight, start: 1 });
    expect(plan.segmentCount).toBe(1);
    expect(plan.images).toEqual([{ segments: [{ index: 1, top: 0, bottom: 1500 }], width: 960, height: 750 }]);
  });

  it('stops at the capture limit and says so', () => {
    const plan = planSegments(page(1920, 40_000), { scale: 0.5, capHeight: 12_000, start: 1 });
    expect(plan.coveredHeight).toBe(12_000);
    expect(plan.truncated).toBe(true);
    expect(plan.segmentCount).toBe(Math.ceil(12_000 / plan.segmentHeight));
  });

  it('a start past the end plans nothing and flags it, rather than wrapping or clamping silently', () => {
    const plan = planSegments(page(1920, 3000), { scale: 0.5, capHeight: 12_000, start: 5 });
    expect(plan.outOfRange).toBe(true);
    expect(plan.images).toEqual([]);
    expect(plan.segmentCount).toBe(2);
  });

  it('a nonsense start is read as the first segment', () => {
    for (const start of [0, -3, Number.NaN, 1.7]) {
      const plan = planSegments(page(1920, 3000), { scale: 0.5, capHeight: 12_000, start });
      expect(plan.images[0]!.segments[0]!.index, String(start)).toBe(1);
    }
  });
});

describe('planSegments — one element', () => {
  it('pages through the element box in PAGE coordinates', () => {
    const box = { left: 240, top: 3100, width: 960, height: 2600 };
    const plan = planSegments(box, { scale: elementScale(box.width), capHeight: 12_000, start: 1 });
    expect(plan.scale).toBe(1);
    expect(plan.images[0]!.segments[0]!.top).toBe(3100);
    expect(plan.images.flatMap((i) => i.segments).at(-1)!.bottom).toBe(5700);
    expectReadable(plan);
  });
});

describe('planSegments — a hostile element', () => {
  it('★ a 1px-wide element is never tiled into dozens of columns — every one of them a separate grab', () => {
    // Without a cap, a 1px column fits ~93 times into the read edge: ~186 sequential captures for one
    // viewport of one call, all inside a render slot.
    const plan = planSegments({ left: 0, top: 0, width: 1, height: 1_000_000 }, { scale: elementScale(1), capHeight: 12_000, start: 1 });
    expect(MAX_COLUMNS).toBe(8);
    expect(Math.max(...plan.images.map((i) => i.segments.length))).toBe(MAX_COLUMNS);
    expect(plan.images.flatMap((i) => i.segments).length).toBeLessThanOrEqual(MAX_COLUMNS * MAX_IMAGES_PER_VIEWPORT);
  });
});

describe('elementScale', () => {
  it('shows a narrow element at full resolution and a wide one at most ELEMENT_MAX_WIDTH wide', () => {
    expect(elementScale(600)).toBe(1);
    expect(elementScale(1920) * 1920).toBeCloseTo(ELEMENT_MAX_WIDTH, 5);
    expect(elementScale(0)).toBe(1);
  });
});

describe('planLegacy — the single whole-page image older clients ask for', () => {
  it('fits a long page inside the many-image ceiling, as before', () => {
    const p = planLegacy(1920, 9000, 0.5);
    expect(Math.round(9000 * p.scale)).toBe(MODEL_IMAGE_MAX_EDGE);
  });

  it('never UPSCALES the half-resolution raster (a 3,000px page used to come back 1280×2000, blurred)', () => {
    expect(planLegacy(1920, 3000, 0.5).scale).toBe(0.5);
    expect(planLegacy(1920, 1080, 0.5).scale).toBe(0.5);
  });
});
