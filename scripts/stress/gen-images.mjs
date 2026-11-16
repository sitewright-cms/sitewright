// Unique photo-like JPEGs: blurred colour noise, hue-shifted per file, so every file is distinct (no dedupe, no
// warm thumb cache) and decodes like a real camera image. argv: outDir count
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../packages/image-pipeline/package.json', import.meta.url));
const sharp = require('sharp');
const [out, count] = [process.argv[2], Number(process.argv[3] ?? 20)];
const sizes = [[4000, 3000], [6000, 4000], [3000, 2000], [5184, 3456]];
for (let i = 0; i < count; i++) {
  const [w, h] = sizes[i % sizes.length];
  const sw = Math.round(w / 8), sh = Math.round(h / 8);
  const raw = Buffer.alloc(sw * sh * 3);
  for (let p = 0; p < raw.length; p++) raw[p] = (Math.random() * 255) | 0;
  await sharp(raw, { raw: { width: sw, height: sh, channels: 3 } })
    .resize(w, h, { kernel: 'cubic' })
    .blur(1.2)
    .modulate({ hue: (i * 37) % 360 })
    .jpeg({ quality: 88 })
    .toFile(`${out}/photo-${String(i).padStart(3, '0')}.jpg`);
}
