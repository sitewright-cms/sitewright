import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isTextureName } from '@sitewright/blocks';
import { readTexture } from '../textures.js';

// Platform textures (transparent tileable PNG overlays) are authored as `/authoring/textures/<name>.png`
// (an absolute URL that serves in the editor + single-page preview). For the draft preview and the
// PUBLISHED/EXPORTED site to be self-contained on any host, the build rebases that URL to a page-relative
// `<siteRoot>_assets/_textures/<name>.png` and copies the referenced PNGs into the export — mirroring how
// `/media/<slug>/…` is rebased to `_assets/` (media-thumbs.ts) and favicons to `_assets/_icons/`.

/** The flat export sub-folder textures are materialised into (a sibling of the `_assets/` media bundle). */
const TEXTURE_EXPORT_DIR = '_assets/_textures';

// Matches `/authoring/textures/<name>.png` anywhere in the assembled HTML — inline `style=`, a page
// `<style>`, or inlined `website.criticalCss`. The name charset excludes the delimiters that end a URL
// token, so a match never runs past its own reference.
const TEXTURE_RE = /\/authoring\/textures\/([A-Za-z0-9_-]+)\.png/g;

/**
 * Rebase every `/authoring/textures/<name>.png` reference to a self-contained, page-relative
 * `<siteRoot>_assets/_textures/<name>.png`, recording each referenced name in `used` so ONLY referenced
 * textures are copied (complete + minimal, like `materializeImageThumbs`). Unknown names (not in the
 * catalog) are left untouched. Run AFTER the media rewrite and BEFORE relativize, so the already-relative
 * result is not re-touched.
 */
export function rewriteTextureUrls(html: string, siteRoot: string, used: Set<string>): string {
  return html.replace(TEXTURE_RE, (whole: string, name: string) => {
    if (!isTextureName(name)) return whole;
    used.add(name);
    return `${siteRoot}${TEXTURE_EXPORT_DIR}/${name}.png`;
  });
}

/**
 * Copy each referenced texture PNG into `<tmp>/_assets/_textures/<name>.png`. Returns the total bytes
 * written. A catalog/file drift (missing PNG) is skipped rather than failing the whole publish.
 */
export async function materializeTextures(tmp: string, used: Set<string>): Promise<number> {
  if (used.size === 0) return 0;
  const dir = join(tmp, TEXTURE_EXPORT_DIR);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant subdir under the validated tmp
  await mkdir(dir, { recursive: true });
  let bytes = 0;
  for (const name of used) {
    const data = await readTexture(name);
    if (!data) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- `name` is catalog-allowlisted (isTextureName), dir is the validated tmp
    await writeFile(join(dir, `${name}.png`), data);
    bytes += data.length;
  }
  return bytes;
}
