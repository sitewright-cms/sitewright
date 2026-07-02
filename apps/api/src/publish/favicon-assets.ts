import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { generateFaviconSet, FAVICON_FILES } from '@sitewright/image-pipeline';
import type { CorporateIdentity, MediaAsset } from '@sitewright/schema';

// The favicon / PWA icon set + Web App Manifest, derived at publish from the single Corporate-Identity
// `icon`. Files land at the SITE ROOT (`favicon.ico`, `site.webmanifest`) + under `_assets/_icons/`
// (the PNGs); the head links are page-relative (the caller prefixes the page's siteRoot). When the
// icon isn't a usable in-project media asset (external URL, missing bytes, unreadable), this returns
// undefined and the caller falls back to a single generic <link rel="icon">.

/** Mirrors build.ts ASSET_DIR ('_assets') — kept literal here to avoid a build.ts import cycle. */
const ICON_DIR = '_assets/_icons';
const MANIFEST_FILE = 'site.webmanifest';

/** Root-relative paths for the per-page head links (the caller prefixes each with the page siteRoot). */
export interface IconSet {
  readonly ico: string;
  readonly png: string;
  readonly apple: string;
  readonly manifest: string;
}

/** Source bytes for the icon asset: the retained ORIGINAL (sharp downscales it to each icon size). */
async function readIconSource(
  asset: MediaAsset,
  readMedia: (assetId: string, file: string) => Promise<Buffer>,
): Promise<Buffer | undefined> {
  if (asset.kind !== 'image') return undefined;
  try {
    return await readMedia(asset.id, asset.original);
  } catch {
    return undefined; // missing bytes → caller falls back
  }
}

/**
 * Generate the favicon/PWA set + manifest from `identity.icon` into `outDir`. Returns the
 * root-relative head paths, or undefined when no usable media icon exists.
 */
export async function emitFaviconSet(
  outDir: string,
  projectSlug: string,
  identity: CorporateIdentity,
  media: readonly MediaAsset[],
  readMedia: (assetId: string, file: string) => Promise<Buffer>,
): Promise<IconSet | undefined> {
  const icon = identity.icon;
  if (!icon) return undefined;
  // Only an in-project media icon can be re-rendered into the set; an external/root-relative icon
  // can't be read here, so it stays a single <link rel="icon"> (the caller's fallback).
  const prefix = `/media/${projectSlug}/`;
  if (!icon.startsWith(prefix)) return undefined;
  const assetId = icon.slice(prefix.length).split('/')[0];
  const asset = media.find((a) => a.id === assetId);
  if (!asset) return undefined;

  const source = await readIconSource(asset, readMedia);
  if (!source) return undefined;

  const background = identity.colors?.['base-100'] || '#ffffff';
  let files;
  try {
    files = await generateFaviconSet(source, { background });
  } catch {
    return undefined; // sharp couldn't process the source → fall back gracefully
  }

  // All icon files bundle under _assets/_icons/ (the same tree the local `/sites/` store serves +
  // every static host bundles); the head links them page-relative. The manifest stays at the root.
  const iconFull = join(outDir, ICON_DIR);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ICON_DIR is a constant under outDir
  await mkdir(iconFull, { recursive: true });
  for (const f of files) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- f.name is a constant filename under iconFull
    await writeFile(join(iconFull, f.name), f.data);
  }

  // Web App Manifest. Its icon `src`s are relative to the manifest's OWN location (the site root),
  // so a page at any depth links the manifest page-relative and the browser still resolves icons.
  const manifest = {
    name: identity.name,
    short_name: identity.shortName || identity.name,
    icons: [
      { src: `${ICON_DIR}/${FAVICON_FILES.png192}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${ICON_DIR}/${FAVICON_FILES.png512}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${ICON_DIR}/${FAVICON_FILES.maskable}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    theme_color: identity.colors?.primary || '#ffffff',
    background_color: background,
    display: 'standalone',
    start_url: './',
  };
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under outDir
  await writeFile(join(outDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2));

  return {
    ico: `${ICON_DIR}/${FAVICON_FILES.ico}`,
    png: `${ICON_DIR}/${FAVICON_FILES.png32}`,
    apple: `${ICON_DIR}/${FAVICON_FILES.apple}`,
    manifest: MANIFEST_FILE,
  };
}
