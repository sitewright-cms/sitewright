import { describe, it, expect } from 'vitest';
import { computeResize } from '../src/lib/image-resize';

// The DOM/drag lifecycle needs real layout (jsdom has none), so it's render-verified; here we lock the pure
// aspect-lock + clamp math the SE-corner drag uses (mirrored byte-for-byte in preview-bridge.ts's rzMove).
describe('computeResize', () => {
  it('grows width by the cursor delta and keeps the aspect ratio', () => {
    expect(computeResize(200, 2, 100)).toEqual({ width: 300, height: 150 }); // aspect 2:1
    expect(computeResize(200, 2, -50)).toEqual({ width: 150, height: 75 });
  });
  it('clamps to [24, 4000]', () => {
    expect(computeResize(100, 1, -1000)).toEqual({ width: 24, height: 24 }); // min
    expect(computeResize(3990, 1, 500)).toEqual({ width: 4000, height: 4000 }); // max
  });
  it('guards a zero/degenerate aspect (no NaN/Infinity)', () => {
    const r = computeResize(200, 0, 0);
    expect(Number.isFinite(r.height)).toBe(true);
  });
});
