import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { optimizeImage } from '../src/optimize.js';

let workDir = '';
let srcPath = '';
let outDir = '';

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'sw-img-'));
  srcPath = join(workDir, 'hero.png');
  outDir = join(workDir, 'out');
  await sharp({
    create: { width: 1600, height: 900, channels: 3, background: { r: 12, g: 110, b: 200 } },
  })
    .png()
    .toFile(srcPath);
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('optimizeImage', () => {
  it('produces responsive avif+webp variants plus a fallback, preserving aspect ratio', async () => {
    const result = await optimizeImage(srcPath, outDir);
    expect(result.width).toBe(1600);
    expect(result.height).toBe(900);
    // 3 widths (400/800/1200, all <= 1600) x 2 formats
    expect(result.variants.length).toBe(6);
    expect(result.variants.filter((v) => v.format === 'avif').length).toBe(3);
    const w800 = result.variants.find((v) => v.format === 'webp' && v.width === 800);
    expect(w800?.height).toBe(450); // 900/1600 ratio
    for (const variant of result.variants) {
      expect(existsSync(join(outDir, variant.path))).toBe(true);
    }
    expect(existsSync(join(outDir, result.fallback))).toBe(true);
  });

  it('emits an inline LQIP placeholder data URI', async () => {
    const result = await optimizeImage(srcPath, outDir);
    expect(result.placeholder.startsWith('data:image/webp;base64,')).toBe(true);
    expect(result.placeholder.length).toBeGreaterThan(40);
  });

  it('never upscales beyond the source width', async () => {
    const small = join(workDir, 'small.png');
    await sharp({
      create: { width: 300, height: 200, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toFile(small);
    const result = await optimizeImage(small, join(workDir, 'out-small'), { widths: [400, 800] });
    expect(result.variants.every((v) => v.width === 300)).toBe(true);
  });

  it('writes a real JPEG fallback at the largest target width', async () => {
    const result = await optimizeImage(srcPath, outDir);
    const bytes = await readFile(join(outDir, result.fallback));
    expect(result.fallback).toBe('hero-1200.jpg'); // max of [400,800,1200]
    expect(bytes[0]).toBe(0xff); // JPEG magic
    expect(bytes[1]).toBe(0xd8);
  });

  it('throws for a non-image input', async () => {
    const bad = join(workDir, 'notimage.txt');
    await writeFile(bad, 'not an image');
    await expect(optimizeImage(bad, join(workDir, 'out-bad'))).rejects.toThrow();
  });

  it('rejects SVG input (SSRF-via-librsvg vector)', async () => {
    const svg = join(workDir, 'logo.svg');
    await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
    await expect(optimizeImage(svg, join(workDir, 'out-svg'))).rejects.toThrow(/format/);
  });

  it('rejects invalid options', async () => {
    await expect(optimizeImage(srcPath, outDir, { widths: [0] })).rejects.toThrow(/width/);
    await expect(optimizeImage(srcPath, outDir, { quality: 0 })).rejects.toThrow(/quality/);
  });
});
