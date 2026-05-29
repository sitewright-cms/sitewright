// Prebuild step: optimize every image in the project's `media/` directory into
// responsive AVIF/WebP variants under `public/_sw-media/<name>/`, and write a
// manifest the renderer reads at build time. Runs before `astro build`/`dev`.
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { optimizeImage } from '@sitewright/image-pipeline';

const SAMPLE_DIR = fileURLToPath(new URL('../projects/sample', import.meta.url));
const projectDir = process.env.SITEWRIGHT_PROJECT ?? SAMPLE_DIR;
const mediaDir = join(projectDir, 'media');
const outRoot = fileURLToPath(new URL('../public/_sw-media', import.meta.url));

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.tiff', '.avif']);

const manifest = {};
if (existsSync(mediaDir)) {
  for (const file of (await readdir(mediaDir)).sort()) {
    const { ext, base, name } = parse(file);
    if (!IMAGE_EXTENSIONS.has(ext.toLowerCase())) continue;
    const optimized = await optimizeImage(join(mediaDir, file), join(outRoot, name));
    manifest[base] = { ...optimized, dir: `/_sw-media/${name}/` };
  }
}

await mkdir(outRoot, { recursive: true });
await writeFile(join(outRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`[sitewright] optimized ${Object.keys(manifest).length} media image(s)`);
