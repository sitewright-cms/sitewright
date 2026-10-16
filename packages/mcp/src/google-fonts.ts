import { GOOGLE_FONTS, type GoogleFontMeta } from '@sitewright/blocks/google-fonts-catalog';

/** The generic category a Google family falls back to — the catalog's `fallback`. */
export type GoogleFontCategory = 'serif' | 'sans-serif' | 'monospace' | 'cursive';

/**
 * Find Google families in the catalog the platform already BUNDLES — the same list the editor's font
 * picker shows and the server-side download allowlists. Answering from it costs no request to anyone,
 * and a family it returns is by construction one `select_google_font` will accept.
 *
 * Ranked so the family an agent most likely means comes first: the exact name, then names that start
 * with the query, then names with a WORD that does ("Open Sans" for "sans"), then any other match
 * ("Parkinsans"). Alphabetical within a rank. An empty query lists the category alphabetically.
 */
export function searchGoogleFonts(
  query: string,
  opts: { category?: GoogleFontCategory; limit?: number } = {},
): GoogleFontMeta[] {
  const q = query.trim().toLowerCase();
  const ranked: Array<{ font: GoogleFontMeta; rank: number }> = [];
  for (const font of GOOGLE_FONTS) {
    if (opts.category && font.fallback !== opts.category) continue;
    const rank = rankOf(font.family.toLowerCase(), q);
    if (rank !== undefined) ranked.push({ font, rank });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || a.font.family.localeCompare(b.font.family))
    .slice(0, opts.limit ?? 20)
    .map((r) => r.font);
}

/**
 * The catalog's spelling of a family, matched case-insensitively — the server's allowlist is exact,
 * and "inter" or "playfair display" is an unambiguous request for "Inter" / "Playfair Display".
 */
export function resolveGoogleFamily(name: string): string | undefined {
  const wanted = name.trim().toLowerCase();
  return GOOGLE_FONTS.find((f) => f.family.toLowerCase() === wanted)?.family;
}

/**
 * Near-misses for a name that is not a family. The usual miss is a family with a style word glued on
 * ("Playfair Bold", "Open Sans Light"), which matches nothing whole — so fall back to its FIRST word.
 */
export function suggestGoogleFamilies(name: string, limit = 5): string[] {
  const whole = searchGoogleFonts(name, { limit });
  const hits = whole.length > 0 ? whole : searchGoogleFonts(name.trim().split(/\s+/)[0] ?? '', { limit });
  return hits.map((f) => f.family);
}

/** Lower is better; `undefined` = no match. */
function rankOf(name: string, q: string): number | undefined {
  if (!q || name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(` ${q}`)) return 2;
  return name.includes(q) ? 3 : undefined;
}
