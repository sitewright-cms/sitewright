// Detect the Google-Fonts families a page pulls in via a `<link rel="stylesheet" href="…css2?family=…">`
// or an `@import url(…css2?family=…)` — the common way a modern site loads its fonts WITHOUT any
// `@font-face` in its own CSS. The importer downloads + self-hosts these server-side (the browser never
// touches Google on a preview/published page) and matches them into identity.typography. Pure + regex —
// conservative (a family it can't parse is simply not hosted, the safe default).

/** One referenced webfont family and the weights it asked for (deduped, ascending; [400] if none given). */
export interface WebfontRef {
  family: string;
  weights: number[];
}

const GOOGLE_CSS_RE = /https?:\/\/fonts\.googleapis\.com\/css2?\?[^"')\s]+/gi;

/** Pull every `family=…` spec out of one Google Fonts css/css2 URL. */
function parseGoogleUrl(url: string): WebfontRef[] {
  let query: string;
  try {
    query = new URL(url.replace(/&amp;/g, '&')).search;
  } catch {
    return [];
  }
  const refs: WebfontRef[] = [];
  // css2 repeats `family=` once per family; css1 packs them into a single comma-separated `family=`.
  for (const m of query.matchAll(/[?&]family=([^&]+)/gi)) {
    for (const spec of decodeURIComponent(m[1]!).split('|')) {
      // "Sora:wght@400;700" | "Open Sans:ital,wght@0,400;1,700" | "Roboto"
      const [rawFamily, axes] = spec.split(':');
      const family = (rawFamily ?? '').replace(/\+/g, ' ').trim();
      if (!family) continue;
      const weights = new Set<number>();
      if (axes) {
        // Grab the wght@ tuple list; each tuple is either "<weight>" or "<ital>,<weight>".
        const wght = /wght@([^:&]+)/i.exec(axes);
        if (wght) {
          for (const tuple of wght[1]!.split(';')) {
            const parts = tuple.split(',');
            const w = Number(parts[parts.length - 1]);
            if (Number.isFinite(w) && w >= 1 && w <= 1000) weights.add(w);
          }
        }
      }
      if (weights.size === 0) weights.add(400);
      refs.push({ family, weights: [...weights].sort((a, b) => a - b) });
    }
  }
  return refs;
}

/** All Google-Fonts families referenced by `html` (via `<link>` or `@import`), merged by family. */
export function parseGoogleFontRefs(html: string): WebfontRef[] {
  if (typeof html !== 'string' || html.length === 0) return [];
  const byFamily = new Map<string, Set<number>>();
  for (const m of html.matchAll(GOOGLE_CSS_RE)) {
    for (const ref of parseGoogleUrl(m[0])) {
      const set = byFamily.get(ref.family) ?? new Set<number>();
      for (const w of ref.weights) set.add(w);
      byFamily.set(ref.family, set);
    }
  }
  return [...byFamily.entries()].map(([family, weights]) => ({ family, weights: [...weights].sort((a, b) => a - b) }));
}
