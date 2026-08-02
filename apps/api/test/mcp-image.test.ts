import { describe, it, expect } from 'vitest';
import { clampShotForModel, clampShots, MODEL_IMAGE_MAX_EDGE } from '../src/render/mcp-image.js';
import type { Shot } from '../src/render/screenshot.js';

// The maths and the sharp round-trip are covered in @sitewright/image-pipeline (model-image.test.ts).
// What matters HERE is the Shot adapter: that an oversized shot comes back re-sized with dimensions that
// match its bytes, and that the common in-limit case is not needlessly re-encoded.

// A 1x1 JPEG. Its real dimensions are irrelevant — the clamp trusts the Shot's declared width/height,
// which is what the renderer reports, so a fabricated over-limit shot exercises the resize path.
const TINY_JPEG =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

const shot = (width: number, height: number): Shot => ({
  base64: TINY_JPEG,
  mimeType: 'image/jpeg',
  width,
  height,
});

describe('clampShotForModel', () => {
  it('returns the SAME object when the shot is already within the limit', async () => {
    const s = shot(1440, 900);
    expect(await clampShotForModel(s)).toBe(s); // identity — no re-encode on the common path
  });

  it('re-encodes an oversized shot and reports the new size', async () => {
    const out = await clampShotForModel(shot(1920, 8000));
    expect(out.height).toBe(MODEL_IMAGE_MAX_EDGE);
    expect(out.width).toBe(Math.round(1920 * (MODEL_IMAGE_MAX_EDGE / 8000)));
    expect(out.base64).not.toBe(TINY_JPEG); // actually re-encoded, not just relabelled
    expect(out.mimeType).toBe('image/jpeg');
  });

  it('clamps on WIDTH too — the widest breakpoint is over the limit before any height', async () => {
    const out = await clampShotForModel(shot(2560, 1440));
    expect(out.width).toBe(MODEL_IMAGE_MAX_EDGE);
  });
});

describe('clampShots', () => {
  it('clamps each named shot, preserves keys, and leaves in-limit shots alone', async () => {
    const small = shot(390, 900);
    const out = await clampShots({ fullhd: shot(1920, 6000), mobile: small });
    expect(Object.keys(out).sort()).toEqual(['fullhd', 'mobile']);
    expect(out.fullhd!.height).toBe(MODEL_IMAGE_MAX_EDGE);
    expect(out.mobile).toBe(small);
  });

  it('tolerates a missing shot', async () => {
    expect((await clampShots({ fullhd: undefined })).fullhd).toBeUndefined();
  });
});
