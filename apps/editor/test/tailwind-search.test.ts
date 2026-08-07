import { describe, expect, it } from 'vitest';
import type { ReferenceTopic, TailwindReference } from '@sitewright/tailwind-reference/meta';
import {
  CLASS_HIT_LIMIT,
  bestMatch,
  byCategory,
  normalize,
  searchReference,
} from '../src/views/library/tailwind-search';

function topic(partial: Partial<ReferenceTopic> & Pick<ReferenceTopic, 'sig' | 'title'>): ReferenceTopic {
  return {
    id: partial.sig.replace(/[^a-z0-9]+/g, '-'),
    props: partial.sig.split(','),
    classes: [],
    category: 'typography',
    description: 'Some prose about this topic.',
    preview: 'none',
    ...partial,
  };
}

const FONT_SIZE = topic({
  sig: 'font-size,line-height',
  title: 'Font Size',
  description: 'Sets the type size.',
  preview: 'text',
  classes: [
    ['text-xs', [['var(--text-xs)', '0.75rem']], 1],
    ['text-sm', [['var(--text-sm)', '0.875rem']], 1],
    ['text-base', [['var(--text-base)', '1rem']], 1],
  ],
});

const TEXT_COLOR = topic({
  sig: 'color',
  title: 'Text Color',
  description: 'Sets the text colour.',
  preview: 'color',
  classes: [
    ['text-red-500', [['oklch(63.7% 0.237 25.331)']], 0],
    ['text-blue-500', [['oklch(62.3% 0.214 259.815)']], 0],
  ],
});

const DISPLAY = topic({
  sig: 'display',
  title: 'Display',
  description: 'Sets the box type an element generates.',
  category: 'layout',
  classes: [
    ['flex', [['flex']], 0],
    ['grid', [['grid']], 0],
    ['inline-flex', [['inline-flex']], 0],
  ],
});

const REFERENCE: TailwindReference = {
  tailwindVersion: '4.3.3',
  classCount: 8,
  topics: [DISPLAY, FONT_SIZE, TEXT_COLOR],
  variants: [],
};

describe('normalize', () => {
  it('folds case, hyphens and underscores so CSS property names read as plain words', () => {
    expect(normalize('Font-Size')).toBe('font size');
    expect(normalize('  BACKGROUND_COLOR  ')).toBe('background color');
    expect(normalize('z-index')).toBe('z index');
  });
});

describe('searchReference', () => {
  it('finds a topic by its CSS property spelled as words — the "font size" case', () => {
    // This is the requirement that motivated keying topics by property signature: no synonym table
    // maps "font size" onto `text-*`; the topic's own generated property IS `font-size`.
    const results = searchReference(REFERENCE, 'font size');
    expect(results.topics.map((t) => t.title)).toEqual(['Font Size']);
  });

  it('finds the same topic by its hyphenated property name', () => {
    expect(searchReference(REFERENCE, 'font-size').topics.map((t) => t.title)).toEqual(['Font Size']);
  });

  it('requires every token to match, so a second word narrows rather than widens', () => {
    // "sets" is in all three descriptions; adding a second word cuts it to one.
    expect(searchReference(REFERENCE, 'sets').topics).toHaveLength(3);
    expect(searchReference(REFERENCE, 'sets colour').topics.map((t) => t.title)).toEqual(['Text Color']);
  });

  it('finds a class by name and reports the topic it belongs to', () => {
    const results = searchReference(REFERENCE, 'text-sm');
    expect(results.classes).toHaveLength(1);
    expect(results.classes[0]?.name).toBe('text-sm');
    expect(results.classes[0]?.topic.title).toBe('Font Size');
    expect(results.classes[0]?.index).toBe(1);
  });

  it('ranks an exact class name above the names that merely contain it', () => {
    const names = searchReference(REFERENCE, 'flex').classes.map((c) => c.name);
    expect(names[0]).toBe('flex');
    expect(names).toContain('inline-flex');
  });

  it('matches class names on the RAW query, so a hyphen stays significant', () => {
    // `text sm` is a topic-style query — it must not pull `text-sm` in as a class hit.
    expect(searchReference(REFERENCE, 'text sm').classes).toHaveLength(0);
  });

  it('matches categories by their label', () => {
    expect(searchReference(REFERENCE, 'typography').categories).toContain('typography');
  });

  it('returns nothing for an empty query', () => {
    const empty = searchReference(REFERENCE, '   ');
    expect(empty.topics).toEqual([]);
    expect(empty.classes).toEqual([]);
    expect(empty.categories).toEqual([]);
    expect(empty.classTotal).toBe(0);
  });

  it('caps returned class hits but reports the true total', () => {
    const many = topic({
      sig: 'background-color',
      title: 'Background Color',
      classes: Array.from({ length: CLASS_HIT_LIMIT * 2 }, (_, i) => [`bg-c${i}`, [['#fff']], 0] as const),
    });
    const results = searchReference({ ...REFERENCE, topics: [many] }, 'bg-c');
    expect(results.classes).toHaveLength(CLASS_HIT_LIMIT);
    expect(results.classTotal).toBe(CLASS_HIT_LIMIT * 2);
  });

  it('ranks an exact match first even when thousands of substring hits precede it', () => {
    // Regression guard. A single capped buffer — however generous — fills with the filler's prefix
    // matches long before the pass reaches the exact match in the LAST topic, and drops the one
    // result the author actually typed. Ranked buckets are what make that impossible.
    const filler = topic({
      sig: 'background-color',
      title: 'Background Color',
      classes: Array.from({ length: CLASS_HIT_LIMIT * 20 }, (_, i) => [`bg-x${i}`, [['#fff']], 0] as const),
    });
    const late = topic({ sig: 'fill', title: 'Fill Color', classes: [['bg-x', [['#000']], 0]] });
    const results = searchReference({ ...REFERENCE, topics: [filler, late] }, 'bg-x');
    expect(results.classes[0]?.name).toBe('bg-x');
    expect(results.classTotal).toBe(CLASS_HIT_LIMIT * 20 + 1);
  });

  it('returns the SHORTEST prefix matches, not the first ones the scan happened to reach', () => {
    // ★ Regression guard. Capping the prefix bucket during the scan is a first-N-encountered cut in
    // topic-iteration order, which happens before the sort — so `bg-white` and `bg-top` got dropped
    // in favour of longer `bg-<colour>-<shade>` names from an earlier topic, while the footer went
    // on claiming these were "the closest matches". Only the substring bucket may be capped early.
    const longNames = topic({
      sig: 'background-color',
      title: 'Background Color',
      classes: Array.from({ length: CLASS_HIT_LIMIT * 2 }, (_, i) => [`bg-colour-${i}-500`, [['#fff']], 0] as const),
    });
    const shortNames = topic({
      sig: 'background-image',
      title: 'Background Image',
      classes: [
        ['bg-top', [['top']], 0],
        ['bg-white', [['#fff']], 0],
      ],
    });
    const names = searchReference({ ...REFERENCE, topics: [longNames, shortNames] }, 'bg-').classes.map((c) => c.name);
    expect(names).toContain('bg-top');
    expect(names).toContain('bg-white');
    // …and they sort to the front, being the shortest.
    expect(names.slice(0, 2).sort()).toEqual(['bg-top', 'bg-white']);
  });

  it('never lets substring hits crowd out prefix hits', () => {
    // `-mx-4` contains "mx-4"; `mx-4` starts with it. The prefix match must survive the cap even
    // though the substring matches are enumerated first.
    const negatives = topic({
      sig: 'margin',
      title: 'Margin',
      classes: Array.from({ length: CLASS_HIT_LIMIT * 3 }, (_, i) => [`-mx-4x${i}`, [['1px']], 0] as const),
    });
    const positives = topic({
      sig: 'padding',
      title: 'Padding',
      classes: [['mx-4b', [['1rem']], 0]],
    });
    const results = searchReference({ ...REFERENCE, topics: [negatives, positives] }, 'mx-4');
    expect(results.classes[0]?.name).toBe('mx-4b');
  });
});

describe('bestMatch', () => {
  it('picks the exact class so typing a class name jumps to its topic', () => {
    const match = bestMatch(searchReference(REFERENCE, 'text-sm'), 'text-sm');
    expect(match && 'name' in match ? match.name : null).toBe('text-sm');
  });

  it('picks a lone topic hit when no class matched', () => {
    const match = bestMatch(searchReference(REFERENCE, 'font size'), 'font size');
    expect(match && 'title' in match ? match.title : null).toBe('Font Size');
  });

  it('stays ambiguous — returning null — when several things matched', () => {
    expect(bestMatch(searchReference(REFERENCE, 'text'), 'text')).toBeNull();
  });

  it('returns null for a query that matched nothing', () => {
    expect(bestMatch(searchReference(REFERENCE, 'zzzz'), 'zzzz')).toBeNull();
  });
});

describe('byCategory', () => {
  it('groups topics under their category, keeping the reference order', () => {
    const grouped = byCategory(REFERENCE.topics);
    expect([...grouped.keys()]).toEqual(['layout', 'typography']);
    expect(grouped.get('typography')?.map((t) => t.title)).toEqual(['Font Size', 'Text Color']);
  });
});
