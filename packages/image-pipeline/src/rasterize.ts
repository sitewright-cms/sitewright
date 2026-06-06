import sharp from 'sharp';

// Pixel ceiling for rasterized output (defensive; trusted callers pass small art).
const MAX_DIMENSION = 4000;

/**
 * Rasterizes a **TRUSTED, first-party** SVG string to a PNG buffer at the given size.
 *
 * ⚠️ SECURITY: this is ONLY for build/seed-time art authored inside this repository. NEVER pass
 * user-supplied or otherwise untrusted SVG: librsvg resolves remote references embedded in SVG
 * (`<image href="http…">`, external entities), which is an SSRF vector. `optimizeImage`
 * deliberately REJECTS SVG input for exactly this reason — this function is the separate,
 * trusted-only path the demo seed uses to generate local placeholder imagery, which is then run
 * through `optimizeImage` like any other raster source.
 *
 * The input must be a literal SVG with no external references.
 */
export async function renderTrustedSvgToPng(svg: string, width: number, height: number): Promise<Buffer> {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION
  ) {
    throw new Error(`invalid raster size: ${width}x${height}`);
  }
  return sharp(Buffer.from(svg), { density: 144 })
    .resize(width, height, { fit: 'fill' })
    .png()
    .toBuffer();
}
