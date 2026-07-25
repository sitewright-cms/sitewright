// Transparent-texture catalog + search — used by the REST `/authoring/textures` route, the MCP
// `search_textures` tool, and the editor texture library. The textures are transparent, tileable PNG
// overlays (from transparenttextures.com); the COLOUR comes from the element's `background-color`
// (a CI token or any CSS colour), so one asset works over any brand colour. Metadata only — the PNG
// bytes live in apps/api/assets/textures/ and are served at `/authoring/textures/<name>.png`, which
// the publish build rewrites to a relative `_assets/_textures/<name>.png` for self-contained exports.
import { TEXTURE_NAMES } from './texture-names.js';

export { TEXTURE_NAMES } from './texture-names.js';

/** The stable, root-relative URL prefix a texture is served from (preview + editor). */
export const TEXTURE_URL_PREFIX = '/authoring/textures/';

const NAME_SET = new Set(TEXTURE_NAMES);

/** Whether `name` is a real texture (allowlist guard for the serving route — blocks path traversal). */
export function isTextureName(name: string): boolean {
  return NAME_SET.has(name);
}

/** The served URL for a texture, e.g. `/authoring/textures/cartographer.png`. */
export function textureUrl(name: string): string {
  return `${TEXTURE_URL_PREFIX}${name}.png`;
}

/**
 * The ready-to-paste CSS for applying a texture over a background colour. `color` is any CSS colour —
 * default a CI token (`var(--sw-color-primary)`), so it re-tints with the brand and light/dark theme.
 * Transparent + tileable → the colour shows through. Resolves in preview AND published/exported sites
 * (the build rewrites the `url(...)` to a relative `_assets/` path). Drop it on any element's `style`,
 * a page `<style>`, or `website.criticalCss`.
 */
export function textureCss(name: string, color = 'var(--sw-color-primary)'): string {
  return `background-color: ${color};\nbackground-image: url("${textureUrl(name)}");\nbackground-repeat: repeat;`;
}

export interface TextureSearchGroup {
  /** The search term this group answers. */
  term: string;
  /** Matching texture names, best first. */
  matches: string[];
}

/** The most terms one search handles — mirrors the icon search bound (synchronous, per-term-linear,
 *  on a PUBLIC route, so an unbounded term count would be an event-loop-starvation DoS lever). */
export const MAX_TEXTURE_SEARCH_TERMS = 24;

/** Split a query into individual terms on commas and/or whitespace, capped at {@link MAX_TEXTURE_SEARCH_TERMS}. */
export function textureSearchTerms(query: string): string[] {
  return query
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, MAX_TEXTURE_SEARCH_TERMS);
}

const nameTokens = (name: string): string[] => name.split(/[-_]/).filter(Boolean);

/**
 * Search the texture set for each term in `query`. Returns one group per term (deduped, order
 * preserved). Matches the full hyphenated name and its individual tokens (exact > word-boundary >
 * substring). `limitPerTerm` caps each group (default 24). An empty/blank query → [].
 */
export function searchTextures(query: string, limitPerTerm = 24): TextureSearchGroup[] {
  return textureSearchTerms(query).map((term) => {
    const score = new Map<string, number>();
    const bump = (name: string, s: number): void => {
      const cur = score.get(name);
      if (cur === undefined || cur < s) score.set(name, s);
    };
    for (const name of TEXTURE_NAMES) {
      if (name === term) bump(name, 100);
      else if (name.startsWith(`${term}-`) || name.endsWith(`-${term}`) || name.includes(`-${term}-`)) bump(name, 70);
      else if (name.includes(term)) bump(name, 45);
      const toks = nameTokens(name);
      if (toks.includes(term)) bump(name, 60);
      else if (toks.some((t) => t.includes(term))) bump(name, 30);
    }
    const matches = [...score.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
      .slice(0, limitPerTerm)
      .map(([n]) => n);
    return { term, matches };
  });
}
