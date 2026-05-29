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
const MAX_MEDIA_FILES = 500; // build-time guard against unbounded asset generation

const manifest = {};
if (existsSync(mediaDir)) {
  const images = (await readdir(mediaDir))
    .filter((file) => IMAGE_EXTENSIONS.has(parse(file).ext.toLowerCase()))
    .sort();
  if (images.length > MAX_MEDIA_FILES) {
    throw new Error(`media directory exceeds the ${MAX_MEDIA_FILES}-image limit`);
  }

  const seenStems = new Set();
  for (const file of images) {
    const { base, name } = parse(file);
    // Output dir is keyed by stem; two files sharing a stem (hero.png/hero.jpg)
    // would clobber each other's variants — reject rather than silently overwrite.
    if (seenStems.has(name)) {
      throw new Error(`duplicate media name "${name}" — file stems must be unique`);
    }
    seenStems.add(name);
    const optimized = await optimizeImage(join(mediaDir, file), join(outRoot, name));
    manifest[base] = { ...optimized, dir: `/_sw-media/${name}/` };
  }
}

await mkdir(outRoot, { recursive: true });
await writeFile(join(outRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stderr.write(`[sitewright] optimized ${Object.keys(manifest).length} media image(s)\n`);
