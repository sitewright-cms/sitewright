import zlib from 'node:zlib';

// ---------------------------------------------------------------------------
// Self-contained, valid PNG generator (node builtins only).
//
// `sharp` is a transitive dep of @sitewright/image-pipeline and is NOT resolvable
// from the api package, so a test cannot `import sharp` to build a fixture. Instead
// we hand-build real PNGs (8-bit truecolour, zlib-deflated raw scanlines). The image
// pipeline's `sharp` decodes these for real, so tests exercise the genuine optimize
// path (variant widths, LQIP, jpeg fallback, dimension metadata) at the HTTP layer.
// ---------------------------------------------------------------------------

function crc32(buf: Buffer): number {
  let c = ~0 >>> 0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

/** Builds a valid solid-colour PNG of the given dimensions. */
export function makePng(width: number, height: number, rgb: readonly [number, number, number]): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour (RGB)
  // 10-12 (compression, filter, interlace) left 0
  const row = Buffer.alloc(1 + width * 3); // leading filter byte (0 = None) + RGB pixels
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = rgb[0];
    row[2 + x * 3] = rgb[1];
    row[3 + x * 3] = rgb[2];
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
