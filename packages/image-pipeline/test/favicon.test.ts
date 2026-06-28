import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { generateFaviconSet, pngToIco, FAVICON_FILES } from '../src/favicon.js';

// A 512×512 master WITH transparency (a magenta disc on a transparent field), so the test can prove
// apple-touch + maskable end up opaque (alpha flattened) and the maskable is padded.
async function master(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><circle cx="256" cy="256" r="200" fill="#d6219b"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe('generateFaviconSet', () => {
  it('produces the full set with the right names, sizes, and formats', async () => {
    const set = await generateFaviconSet(await master(), { background: '#102030' });
    const byName = Object.fromEntries(set.map((f) => [f.name, f.data]));
    expect(Object.keys(byName).sort()).toEqual(
      [FAVICON_FILES.ico, FAVICON_FILES.png32, FAVICON_FILES.apple, FAVICON_FILES.png192, FAVICON_FILES.png512, FAVICON_FILES.maskable].sort(),
    );

    const dim = async (b: Buffer | undefined) => {
      const m = await sharp(b!).metadata();
      return { w: m.width, h: m.height, fmt: m.format, alpha: m.hasAlpha };
    };
    expect(await dim(byName[FAVICON_FILES.png32])).toMatchObject({ w: 32, h: 32, fmt: 'png' });
    expect(await dim(byName[FAVICON_FILES.apple])).toMatchObject({ w: 180, h: 180, fmt: 'png', alpha: false }); // opaque (iOS)
    expect(await dim(byName[FAVICON_FILES.png192])).toMatchObject({ w: 192, h: 192, fmt: 'png' });
    expect(await dim(byName[FAVICON_FILES.png512])).toMatchObject({ w: 512, h: 512, fmt: 'png' });
    expect(await dim(byName[FAVICON_FILES.maskable])).toMatchObject({ w: 512, h: 512, fmt: 'png', alpha: false }); // full-bleed + opaque
  });

  it('keeps an OPAQUE full-bleed master edge-to-edge in the maskable (no shrink border)', async () => {
    const opaque = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#22cc88' } }).png().toBuffer();
    const set = await generateFaviconSet(opaque, { background: '#ffffff' });
    const mask = set.find((f) => f.name === FAVICON_FILES.maskable)!.data;
    // The top-left corner is the icon's OWN colour (full-bleed), not the white pad background.
    const { data } = await sharp(mask).raw().toBuffer({ resolveWithObject: true });
    const [r, g, b] = [data[0]!, data[1]!, data[2]!];
    expect(r < 90 && g > 170 && b > 110).toBe(true); // ≈ #22cc88, not #ffffff
  });

  it('emits a valid PNG-in-ICO (reserved=0, type=1, count=1) wrapping the 32px PNG', async () => {
    const set = await generateFaviconSet(await master());
    const ico = set.find((f) => f.name === FAVICON_FILES.ico)!.data;
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // type = icon
    expect(ico.readUInt16LE(4)).toBe(1); // one image
    // The embedded payload (at the offset in the dir entry) is a real PNG.
    const offset = ico.readUInt32LE(6 + 16 - 4);
    expect(ico.subarray(offset, offset + 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('pngToIco encodes the dimension byte (256 → 0)', () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    expect(pngToIco(png, 32).readUInt8(6)).toBe(32);
    expect(pngToIco(png, 256).readUInt8(6)).toBe(0); // 0 means 256 in the ICO spec
  });
});
