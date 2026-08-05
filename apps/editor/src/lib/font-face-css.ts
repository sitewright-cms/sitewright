// `@font-face` rules for a self-hosted library font, addressed the way the app serves media. Lives in
// `lib/` because two surfaces need it: the typography settings slot editor (previewing a slot in its real
// face) and the rich-text field (drawing author content in the project's brand fonts).
import type { MediaAsset } from '../api';

/** CSS `@font-face` `format()` hint per stored container format. */
const FORMAT_HINT: Record<string, string> = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };

/** A font asset as the media list returns it — `url` addresses the PRIMARY (`files[0]`) face. */
export type FontLibraryAsset = Extract<MediaAsset, { kind: 'font' }>;

/**
 * `@font-face` rules for every face of one library font, addressed the way the app serves media.
 *
 * The prefix comes from stripping the PRIMARY face's file name off the asset's own url — never from
 * cutting at the last `/`. Media is delivered FLAT (`/media/<slug>/<id>-<file>`), so a slash-cut drops
 * the `<id>-` and every face 404s; legacy assets are nested (`/media/<slug>/<id>/<file>`), where a
 * slash-cut happens to work. Stripping the file name is the one derivation correct for both, and it
 * keeps the project segment out of the caller.
 *
 * Returns `''` when the url doesn't end in the primary face's name — better a fallback face than a
 * guessed url that 404s.
 */
export function fontFaceCss(asset: FontLibraryAsset): string {
  const primary = asset.files[0]?.file ?? '';
  if (!primary || !asset.url.endsWith(primary)) return '';
  const base = asset.url.slice(0, asset.url.length - primary.length);
  return asset.files
    .map(
      (f) =>
        `@font-face{font-family:"${asset.family}";font-style:${f.style};font-weight:${f.weight};font-display:swap;` +
        `src:url("${base}${f.file}") format("${FORMAT_HINT[f.format] ?? 'woff2'}")}`,
    )
    .join('');
}
