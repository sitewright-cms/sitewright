// The Tailwind reference dataset: every utility class the installed Tailwind can generate, the CSS
// each one produces, its resolved theme value, and authored prose for the topic it belongs to.
//
// Two halves, deliberately kept apart:
//   generated.ts — DERIVED from the `tailwindcss` package (MIT) by the generator in
//                  packages/tailwind/scripts. Diff-checked in the verify gate, never hand-edited.
//   topics.ts    — AUTHORED prose, one entry per CSS-property signature.
// This module joins them and is the only thing consumers import.
import { GENERATED_REFERENCE } from './generated.js';
import { TOPIC_DOCS } from './topics.js';
import {
  CATEGORIES,
  type Category,
  type GeneratedReference,
  type ReferenceTopic,
  type TailwindReference,
  type TopicDoc,
} from './types.js';

export * from './types.js';
export { TOPIC_DOCS } from './topics.js';
export { GENERATED_REFERENCE } from './generated.js';

/** A property signature → a stable, URL-safe topic id. */
export function topicId(sig: string): string {
  return sig.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

/** The signatures the generator emitted that no one has written prose for. Empty in a green build. */
export function undocumentedSignatures(): string[] {
  return GENERATED_REFERENCE.topics.map((t) => t.sig).filter((sig) => !TOPIC_DOCS[sig]);
}

/** Authored entries that no longer match any generated signature — stale after a Tailwind upgrade. */
export function orphanedDocs(): string[] {
  const live = new Set(GENERATED_REFERENCE.topics.map((t) => t.sig));
  return Object.keys(TOPIC_DOCS).filter((sig) => !live.has(sig));
}

/**
 * Joins generated topics with their authored prose and orders the result for display: categories in
 * `CATEGORIES` order, topics alphabetical by title within each.
 *
 * A signature with no authored entry is DROPPED rather than rendered untitled. `undocumentedSignatures()`
 * and this package's test make that case a build failure, so dropping cannot hide anything — it only
 * keeps a half-upgraded tree from showing an author raw CSS property names as a heading.
 *
 * Takes its inputs as parameters rather than reading the two modules directly, so the drop path and
 * the unknown-category fallback are reachable from a test instead of being untestable dead branches.
 */
export function joinReference(
  generated: GeneratedReference,
  docs: Record<string, TopicDoc>,
): TailwindReference {
  const order = new Map<Category, number>(CATEGORIES.map((c, i) => [c, i]));
  const topics: ReferenceTopic[] = [];
  for (const topic of generated.topics) {
    const doc = docs[topic.sig];
    if (!doc) continue;
    topics.push({ ...topic, ...doc, id: topicId(topic.sig) });
  }
  topics.sort((a, b) => {
    const byCategory = (order.get(a.category) ?? 0) - (order.get(b.category) ?? 0);
    return byCategory !== 0 ? byCategory : a.title.localeCompare(b.title);
  });
  return {
    tailwindVersion: generated.tailwindVersion,
    classCount: generated.classCount,
    topics,
    variants: generated.variants,
  };
}

let cached: TailwindReference | undefined;

/** The joined reference. Built once per process — the payload is large and entirely static. */
export function tailwindReference(): TailwindReference {
  cached ??= joinReference(GENERATED_REFERENCE, TOPIC_DOCS);
  return cached;
}
