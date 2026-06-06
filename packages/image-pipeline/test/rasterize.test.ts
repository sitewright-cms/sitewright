import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { renderTrustedSvgToPng } from '../src/rasterize.js';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="#0ea5e9"/><circle cx="50" cy="30" r="20" fill="#fff"/></svg>`;

describe('renderTrustedSvgToPng', () => {
  it('rasterizes a trusted SVG to a PNG of the requested size', async () => {
    const png = await renderTrustedSvgToPng(SVG, 200, 120);
    // PNG magic header.
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(120);
  });

  it('the output feeds the optimize pipeline (it is a real raster, not SVG)', async () => {
    const png = await renderTrustedSvgToPng(SVG, 120, 80);
    // sharp accepts it as a raster format (png), unlike an SVG buffer.
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
  });

  it('rejects out-of-range dimensions', async () => {
    await expect(renderTrustedSvgToPng(SVG, 0, 100)).rejects.toThrow(/invalid raster size/);
    await expect(renderTrustedSvgToPng(SVG, 100, 99999)).rejects.toThrow(/invalid raster size/);
    await expect(renderTrustedSvgToPng(SVG, 1.5, 100)).rejects.toThrow(/invalid raster size/);
  });
});
