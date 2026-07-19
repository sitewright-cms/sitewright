import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { storeOriginal } from '../src/store.js';

let workDir = '';

async function writePng(name: string, w: number, h: number, channels: 3 | 4 = 3): Promise<string> {
  const p = join(workDir, name);
  const background = channels === 4 ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: 10, g: 90, b: 180 };
  await sharp({ create: { width: w, height: h, channels, background } }).png().toFile(p);
  return p;
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'sw-store-'));
});
afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('storeOriginal', () => {
  it('transcodes an AVIF/HEIF source to WebP (sharp reports it as `heif`; not servable verbatim)', async () => {
    // Modern CDNs serve AVIF when the request Accept lists it — the importer must still self-host it.
    const src = join(workDir, 'photo.avif');
    await sharp({ create: { width: 1000, height: 700, channels: 3, background: { r: 20, g: 120, b: 200 } } }).avif().toFile(src);
    const out = join(workDir, 'out-avif');
    const r = await storeOriginal(src, out, { storedName: 'photo.avif' });
    expect(r.format).toBe('webp');
    expect(r.storedName).toBe('photo.webp'); // extension normalised to the transcoded format
    expect(r.width).toBe(1000);
    expect(r.height).toBe(700);
    expect(existsSync(join(out, 'photo.webp'))).toBe(true);
    expect((await sharp(await readFile(join(out, 'photo.webp'))).metadata()).format).toBe('webp');
  });

  it('stores the original VERBATIM in its own format when uncapped (no eager variants)', async () => {
    const src = await writePng('hero.png', 1600, 900);
    const out = join(workDir, 'out-hero');
    const r = await storeOriginal(src, out, { storedName: 'hero.png' });

    expect(r.storedName).toBe('hero.png');
    expect(r.format).toBe('png');
    expect(r.width).toBe(1600);
    expect(r.height).toBe(900);
    expect(r.hasAlpha).toBe(false);
    expect(r.animated).toBe(false);
    expect(r.placeholder.startsWith('data:image/webp;base64,')).toBe(true);
    expect(existsSync(join(out, 'hero.png'))).toBe(true);
    // stored bytes are the exact source bytes (verbatim, not re-encoded)
    const [srcBytes, storedBytes] = await Promise.all([readFile(src), readFile(join(out, 'hero.png'))]);
    expect(storedBytes.equals(srcBytes)).toBe(true);
    // only ONE image file is written (no variant fan-out)
    expect(r.bytes).toBe((await stat(join(out, 'hero.png'))).size);
  });

  it('records alpha and keeps a transparent PNG as-is', async () => {
    const src = await writePng('logo.png', 500, 500, 4);
    const r = await storeOriginal(src, join(workDir, 'out-logo'), { storedName: 'logo.png' });
    expect(r.hasAlpha).toBe(true);
    expect(r.format).toBe('png');
  });

  it('caps + converts to WebP only when the cap actually bites (importer rule)', async () => {
    const src = await writePng('huge.png', 3000, 1000);
    const r = await storeOriginal(src, join(workDir, 'out-huge'), { storedName: 'huge.png', cap: 2400 });
    expect(r.storedName).toBe('huge.webp'); // extension rewritten
    expect(r.format).toBe('webp');
    expect(r.width).toBe(2400); // downscaled, never upscaled
    expect(r.height).toBe(800); // round(2400 * 1000/3000)
    const meta = await sharp(join(workDir, 'out-huge', 'huge.webp')).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(2400);
  });

  it('leaves a sub-cap image untouched (cap does not bite → verbatim original format)', async () => {
    const src = await writePng('mid.png', 1600, 900);
    const r = await storeOriginal(src, join(workDir, 'out-mid'), { storedName: 'mid.png', cap: 2400 });
    expect(r.storedName).toBe('mid.png');
    expect(r.format).toBe('png');
    expect(r.width).toBe(1600);
  });

  it('rejects SVG (SSRF-via-librsvg) and non-image input', async () => {
    const svg = join(workDir, 'x.svg');
    await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
    await expect(storeOriginal(svg, join(workDir, 'out-svg'), { storedName: 'x.svg' })).rejects.toThrow(/format/);

    const bad = join(workDir, 'x.txt');
    await writeFile(bad, 'not an image');
    await expect(storeOriginal(bad, join(workDir, 'out-bad'), { storedName: 'x.txt' })).rejects.toThrow();
  });

  it('rejects an invalid cap', async () => {
    const src = await writePng('c.png', 100, 100);
    await expect(storeOriginal(src, join(workDir, 'out-c'), { storedName: 'c.png', cap: 0 })).rejects.toThrow(/cap/);
  });
});
