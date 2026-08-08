// Search over the Tailwind reference — pure functions, no React, so the matching rules are unit-testable.
//
// Two kinds of query have to work equally well, and they want opposite things:
//
//   "font size"  — CSS vocabulary. Should land on the Font Size TOPIC. This works without a synonym
//                  table because a topic is keyed by the CSS properties it generates: the topic's own
//                  property IS `font-size`, so normalising hyphens to spaces makes the query match the
//                  data directly. Same for "background color", "letter spacing", "z index".
//   "text-sm"    — a class name. Should land on the same topic, with that row highlighted.
//
// So a query is matched against both, and the caller shows whichever produced results (usually both).
import type { Category, ReferenceTopic, TailwindReference } from '@sitewright/tailwind-reference/meta';
import { CATEGORIES, CATEGORY_LABELS } from '@sitewright/tailwind-reference/meta';

/** A class that matched, and the topic it belongs to — a result row is always navigable. */
export interface ClassHit {
  topic: ReferenceTopic;
  name: string;
  /** Position in `topic.classes`, so the view can scroll to and highlight the exact row. */
  index: number;
}

export interface SearchResults {
  categories: Category[];
  topics: ReferenceTopic[];
  classes: ClassHit[];
  /** Total class hits before the cap, so the view can say how many are not shown. */
  classTotal: number;
}

/** How many class hits a single query returns. Enough to fill the pane without rendering 23k rows. */
export const CLASS_HIT_LIMIT = 200;

/** Lowercase, collapse whitespace, and treat hyphens as spaces so "font size" ≡ "font-size". */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The words a topic can be found by: its title, prose, CSS properties and category label. */
function topicHaystack(topic: ReferenceTopic): string {
  return normalize(
    [topic.title, topic.description, topic.props.join(' '), CATEGORY_LABELS[topic.category]].join(' '),
  );
}

/**
 * Rank a class-name hit: exact match first, then prefix, then anything else.
 *
 * Without this, searching `flex` buries the `flex` class itself under `flex-col`, `flex-1`,
 * `basis-…` and every other name that merely contains the substring.
 */
function classRank(name: string, rawQuery: string): number {
  if (name === rawQuery) return 0;
  if (name.startsWith(rawQuery)) return 1;
  return 2;
}

/** Order within a rank: shorter names first, then alphabetical. */
function compareHits(a: ClassHit, b: ClassHit): number {
  return a.name.length - b.name.length || a.name.localeCompare(b.name);
}

/**
 * Search topics, classes and categories at once.
 *
 * Topic matching is AND-over-tokens ("font size" must match both words) so a two-word query narrows
 * instead of widening. Class matching uses the RAW query, because class names are the one place a
 * hyphen is significant: `text-sm` should not also match `textsm` or `text sm`.
 */
export function searchReference(reference: TailwindReference, query: string): SearchResults {
  const raw = query.trim().toLowerCase();
  const normalized = normalize(query);
  if (!normalized) {
    return { categories: [], topics: [], classes: [], classTotal: 0 };
  }
  const tokens = normalized.split(' ');

  const categories = CATEGORIES.filter((c) => normalize(CATEGORY_LABELS[c]).includes(normalized));

  const topics = reference.topics.filter((topic) => {
    const hay = topicHaystack(topic);
    return tokens.every((t) => hay.includes(t));
  });

  // Bucket by rank as we go, rather than collecting everything and sorting at the end.
  //
  // A single capped buffer does not work here, however generous the cap: with 23k classes, a query
  // like `bg-x` can fill any buffer with substring matches from the early topics before the pass
  // ever reaches an EXACT match sitting in a late one, and the best result is silently dropped.
  //
  // ★ The cap applies to the SUBSTRING bucket only, and that asymmetry is the whole point. Capping
  // during the scan is a first-200-encountered cut in topic-iteration order, which happens BEFORE
  // the sort — so a capped bucket is not "the 200 closest", it is "the 200 the loop reached first".
  // For substring hits that tail genuinely goes unread. For exact and prefix hits it does not:
  // capping `prefix` at 200 during the scan drops `bg-white` and `bg-top` in favour of longer
  // `bg-<color>-<shade>` names from an earlier topic, and then the footer claims they were the
  // closest matches. Both of those buckets are bounded by the query's own match count, so they are
  // collected in full and cut only after `compareHits` has actually ordered them.
  const exact: ClassHit[] = [];
  const prefix: ClassHit[] = [];
  const contains: ClassHit[] = [];
  let classTotal = 0;
  for (const topic of reference.topics) {
    for (let i = 0; i < topic.classes.length; i++) {
      const name = topic.classes[i]?.[0];
      if (!name || !name.includes(raw)) continue;
      classTotal++;
      const rank = classRank(name, raw);
      if (rank === 0) exact.push({ topic, name, index: i });
      else if (rank === 1) prefix.push({ topic, name, index: i });
      else if (contains.length < CLASS_HIT_LIMIT) contains.push({ topic, name, index: i });
    }
  }
  exact.sort(compareHits);
  prefix.sort(compareHits);
  contains.sort(compareHits);
  const classes = [...exact, ...prefix, ...contains].slice(0, CLASS_HIT_LIMIT);

  return { categories, topics, classes, classTotal };
}

/**
 * The topic a query most likely means, for the "jump straight there" behaviour.
 *
 * An exact class name wins: typing `text-sm` should open Font Size with that row highlighted, even
 * though "text" also appears in a dozen topic descriptions. Otherwise a single topic hit wins.
 * Anything more ambiguous returns null and the caller shows the result list instead.
 */
export function bestMatch(results: SearchResults, query: string): ClassHit | ReferenceTopic | null {
  const raw = query.trim().toLowerCase();
  const exact = results.classes.find((c) => c.name === raw);
  if (exact) return exact;
  if (results.topics.length === 1 && results.classes.length === 0) return results.topics[0] ?? null;
  return null;
}

/** Group topics by category, preserving the reference's ordering. */
export function byCategory(topics: readonly ReferenceTopic[]): Map<Category, ReferenceTopic[]> {
  const map = new Map<Category, ReferenceTopic[]>();
  for (const topic of topics) {
    const list = map.get(topic.category);
    if (list) list.push(topic);
    else map.set(topic.category, [topic]);
  }
  return map;
}
