// Icon search over the Phosphor set — used by the REST `/authoring/icons/search` route, the MCP
// `search_icons` tool, and the editor icon library. Accepts MULTIPLE terms at once (comma- OR
// whitespace-separated) and returns per-term matches, so an author/agent can look up several icons in one
// call. Matching spans Phosphor names, the Lucide→Phosphor aliases, and Lucide's own keyword tags — so a
// familiar term ("settings", "cog", "trash") finds the right Phosphor icon ("gear", "trash").
import { PHOSPHOR_NAMES, isPhosphorName } from './phosphor-icons.js';
import { aliasToPhosphor } from './icon-aliases.js';
import { ICON_NAMES, iconTags } from './icons.js';

export interface IconSearchGroup {
  /** The search term this group answers. */
  term: string;
  /** Matching Phosphor icon names, best first. */
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
    const matches = [...score.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
      .slice(0, limitPerTerm)
      .map(([n]) => n);
    return { term, matches };
  });
}
