// Icon search over the Phosphor set — used by the REST `/authoring/icons/search` route, the MCP
// `search_icons` tool, and the editor icon library. Accepts MULTIPLE terms at once (comma- OR
// whitespace-separated) and returns per-term matches, so an author/agent can look up several icons in one
// call. Matching spans Phosphor names, the Lucide→Phosphor aliases, and Lucide's own keyword tags — so a
// familiar term ("settings", "cog", "trash") finds the right Phosphor icon ("gear", "trash"), and
// country flags are searchable by COUNTRY NAME as well as ISO code ("germany" → flag:de).
import { PHOSPHOR_NAMES, isPhosphorName } from './phosphor-icons.js';
import { aliasToPhosphor } from './icon-aliases.js';
import { ICON_NAMES, iconTags } from './icons.js';
import { BRAND_ICON_NAMES_ALL } from './vendored-icons.js';
import { FLAG_CODES, flagIcon } from './flag-icons.js';
import { FLAG_PREFIX } from './icon-render.js';

export interface IconSearchGroup {
  /** The search term this group answers. */
  term: string;
  /** Matching icon names, best first — Phosphor names, plus `brand:<slug>` logos and `flag:<cc>` flags. */
  matches: string[];
}

/** The most terms one search handles. Each term does a linear scan over the icon sets, and the search is
 *  synchronous + on a PUBLIC route, so an unbounded term count would be an event-loop-starvation DoS lever.
 *  A real "look up several icons" call needs only a handful; 24 is a generous ceiling. */
export const MAX_ICON_SEARCH_TERMS = 24;

/** Split a query into individual terms on commas and/or whitespace, capped at {@link MAX_ICON_SEARCH_TERMS}. */
export function iconSearchTerms(query: string): string[] {
  return query
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, MAX_ICON_SEARCH_TERMS);
}

/**
 * Search the icon set for each term in `query`. Returns one group per term (deduped, order preserved).
 * `limitPerTerm` caps each group (default 24). An empty/blank query → [].
 */
export function searchIcons(query: string, limitPerTerm = 24): IconSearchGroup[] {
  const terms = iconSearchTerms(query);
  return terms.map((term) => {
    const score = new Map<string, number>();
    const bump = (name: string, s: number): void => {
      if (score.get(name) === undefined || (score.get(name) as number) < s) score.set(name, s);
    };
    // Direct Phosphor name matches (exact > word-boundary > substring).
    for (const name of PHOSPHOR_NAMES) {
      if (name === term) bump(name, 100);
      else if (name.startsWith(`${term}-`) || name.endsWith(`-${term}`) || name.includes(`-${term}-`)) bump(name, 70);
      else if (name.includes(term)) bump(name, 45);
    }
    // The term is itself a familiar Lucide name → its Phosphor twin.
    const aliased = aliasToPhosphor(term);
    if (aliased) bump(aliased, 90);
    // Lucide keyword tags (synonyms) → the matching Lucide name's Phosphor equivalent. Match the term as a
    // whole TAG TOKEN (not a raw substring — iconTags is a space-joined string, so `.includes` would match
    // mid-word across unrelated tags, e.g. "onito" inside "monitor", padding results with irrelevant icons).
    for (const lu of ICON_NAMES) {
      if (lu === term || iconTags(lu).split(/\s+/).includes(term)) {
        const ph = isPhosphorName(lu) ? lu : aliasToPhosphor(lu);
        if (ph) bump(ph, lu === term ? 80 : 35);
      }
    }
    // BRAND LOGOS. `brand:<slug>` renders a simple-icons logo, but the slugs were not searchable at
    // all — and an unknown slug renders NOTHING: no error, no fallback. A clone author guessed
    // `brand:dinersclub`, got silence, and only caught it by counting <svg> elements against the
    // spans that should have held them. Returning the slugs makes the set discoverable instead of a
    // blind guess. Scored below an exact Phosphor hit but above a loose substring, and emitted with
    // the `brand:` prefix so the result is the literal string {{sw-icon}} expects.
    for (const slug of BRAND_ICON_NAMES_ALL) {
      if (slug === term) bump(`brand:${slug}`, 95);
      else if (slug.startsWith(term) || slug.endsWith(term)) bump(`brand:${slug}`, 60);
      else if (slug.includes(term)) bump(`brand:${slug}`, 40);
    }
    // COUNTRY FLAGS, matched on the country's NAME as well as its code. Searching "germany" used to
    // return nothing at all: the set was reachable only by ISO alpha-2 code, which is the one thing
    // someone looking for a flag does not know. Emitted as `flag:<code>` — the literal string an icon
    // NAME takes (a dataset `icon` field, an image-map hotspot, {{sw-icon}}); written by hand in a
    // template it is {{sw-flag "de"}}, the same artwork either way.
    //
    // An exact CODE match scores high (75) but below an exact Phosphor/brand NAME (95-100): `id`, `me`,
    // `in`, `no`, `so` and ~60 more are country codes AND plausible icon words, so an exact-name icon
    // still wins — but someone who typed a country code gets that country. Ranking a flag highly in
    // SEARCH is harmless in a way that rendering one was not: search offers, it does not decide.
    // No catch-all for the bare term "flag" — that query wants the flag GLYPH, and answering it with an
    // alphabetical slice of 251 countries is noise. A country is found by its name.
    for (const code of FLAG_CODES) {
      const name = (flagIcon(code)?.name ?? '').toLowerCase();
      if (name === term) bump(`${FLAG_PREFIX}${code}`, 95);
      else if (code === term) bump(`${FLAG_PREFIX}${code}`, 75);
      else if (name.startsWith(`${term} `) || name.includes(` ${term}`)) bump(`${FLAG_PREFIX}${code}`, 65);
      else if (name.includes(term) && term.length >= 3) bump(`${FLAG_PREFIX}${code}`, 40);
    }
    const matches = [...score.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
      .slice(0, limitPerTerm)
      .map(([n]) => n);
    return { term, matches };
  });
}
