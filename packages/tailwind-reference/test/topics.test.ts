import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  GENERATED_REFERENCE,
  TOPIC_DOCS,
  declCondition,
  declValue,
  formatDecl,
  joinReference,
  orphanedDocs,
  tailwindReference,
  topicId,
  undocumentedSignatures,
  type GeneratedReference,
  type TopicDoc,
} from '../src/index.js';

/** A minimal generated payload, for driving `joinReference` past the paths the real data never hits. */
function fakeGenerated(sigs: string[]): GeneratedReference {
  return {
    tailwindVersion: '4.0.0',
    classCount: sigs.length,
    topics: sigs.map((sig) => ({ sig, props: sig.split(','), classes: [[`${sig}-1`, [[sig.split(',')[0]!, '1px']], 0] as const] })),
    variants: [],
  };
}

const doc = (title: string, category: TopicDoc['category'] = 'layout'): TopicDoc => ({
  category,
  title,
  description: 'A description long enough to pass the prose floor.',
  preview: 'none',
});

// The point of this suite is DRIFT. The generated half moves whenever Tailwind is upgraded; the
// authored half only moves when someone writes prose. These tests are what turns "a new utility
// family appeared and nobody documented it" from a silent gap in the UI into a red build.
describe('topic coverage', () => {
  it('documents every generated signature', () => {
    // Failing here means Tailwind now emits a utility family with no authored entry. Run
    // `pnpm --filter @sitewright/tailwind gen:tailwind-reference -- --report` to see it, then add
    // it to TOPIC_DOCS. Do not delete the assertion.
    expect(undocumentedSignatures()).toEqual([]);
  });

  it('has no authored entry left without a generated signature', () => {
    // Failing here means an upgrade dropped or renamed a utility family and its prose is now dead.
    expect(orphanedDocs()).toEqual([]);
  });

  it('assigns every topic a known category', () => {
    const known = new Set<string>(CATEGORIES);
    const bad = Object.entries(TOPIC_DOCS).filter(([, doc]) => !known.has(doc.category));
    expect(bad.map(([sig]) => sig)).toEqual([]);
  });

  it('labels every category', () => {
    for (const c of CATEGORIES) expect(CATEGORY_LABELS[c]).toBeTruthy();
  });

  it('gives every topic a title and a description that reads as a sentence', () => {
    for (const [sig, doc] of Object.entries(TOPIC_DOCS)) {
      expect(doc.title, sig).toMatch(/^[A-Z]/);
      expect(doc.description.length, sig).toBeGreaterThan(20);
      expect(doc.description.endsWith('.'), `${sig} description should end in a period`).toBe(true);
    }
  });
});

describe('topicId', () => {
  it('makes a URL-safe id from a property signature', () => {
    expect(topicId('font-size,line-height')).toBe('font-size-line-height');
    expect(topicId('--tw-shadow-color')).toBe('tw-shadow-color');
    expect(topicId('-webkit-user-select,user-select')).toBe('webkit-user-select-user-select');
  });

  it('is unique across every documented topic', () => {
    const ids = tailwindReference().topics.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('tailwindReference', () => {
  it('orders topics by category then title', () => {
    const topics = tailwindReference().topics;
    const categoryOrder = topics.map((t) => CATEGORIES.indexOf(t.category));
    expect(categoryOrder).toEqual([...categoryOrder].sort((a, b) => a - b));
  });

  it('is built once and reused', () => {
    expect(tailwindReference()).toBe(tailwindReference());
  });

  it('carries the Tailwind version the data was derived from', () => {
    expect(tailwindReference().tailwindVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('reports the same class count the generator saw', () => {
    expect(tailwindReference().classCount).toBe(GENERATED_REFERENCE.classCount);
    expect(tailwindReference().classCount).toBeGreaterThan(20_000);
  });
});

describe('joinReference', () => {
  it('drops a generated topic that has no authored prose rather than rendering it untitled', () => {
    const joined = joinReference(fakeGenerated(['color', 'brand-new-property']), { color: doc('Text Color') });
    expect(joined.topics.map((t) => t.sig)).toEqual(['color']);
  });

  it('keeps an unknown category from throwing, sorting it to the front', () => {
    // Defensive: a category outside CATEGORIES has no order index. It must still render.
    const rogue = { ...doc('Rogue'), category: 'not-a-category' as TopicDoc['category'] };
    const joined = joinReference(fakeGenerated(['a', 'b']), { a: rogue, b: doc('Beta', 'accessibility') });
    expect(joined.topics.map((t) => t.title)).toEqual(['Rogue', 'Beta']);
  });

  it('sorts alphabetically by title within one category', () => {
    const joined = joinReference(fakeGenerated(['a', 'b', 'c']), {
      a: doc('Zulu'),
      b: doc('Alpha'),
      c: doc('Mike'),
    });
    expect(joined.topics.map((t) => t.title)).toEqual(['Alpha', 'Mike', 'Zulu']);
  });

  it('passes the generated metadata through untouched', () => {
    const joined = joinReference(fakeGenerated(['color']), { color: doc('Text Color') });
    expect(joined.tailwindVersion).toBe('4.0.0');
    expect(joined.classCount).toBe(1);
    expect(joined.variants).toEqual([]);
  });
});

describe('generated data shape', () => {
  it('resolves theme variables to real values where one backs the declaration', () => {
    const fontSize = tailwindReference().topics.find((t) => t.sig === 'font-size,line-height');
    const textSm = fontSize?.classes.find(([name]) => name === 'text-sm');
    expect(textSm).toBeDefined();
    // `text-sm` sets font-size: var(--text-sm) — the row must show 0.875rem, not the variable.
    expect(textSm?.[1][0]).toEqual(['font-size', 'var(--text-sm)', '0.875rem']);
    expect(declValue(textSm![1][0]!)).toBe('0.875rem');
  });

  it('splits the polymorphic `text-` root into separate size and colour topics', () => {
    const topics = tailwindReference().topics;
    const size = topics.find((t) => t.sig === 'font-size,line-height');
    const color = topics.find((t) => t.sig === 'color');
    expect(size?.title).toBe('Font Size');
    expect(color?.title).toBe('Text Color');
    expect(size?.classes.some(([n]) => n === 'text-sm')).toBe(true);
    expect(color?.classes.some(([n]) => n === 'text-red-500')).toBe(true);
    // …and neither topic contains the other's classes.
    expect(size?.classes.some(([n]) => n === 'text-red-500')).toBe(false);
    expect(color?.classes.some(([n]) => n === 'text-sm')).toBe(false);
  });

  it('strips the @property machinery out of the documented declarations', () => {
    for (const topic of tailwindReference().topics) {
      expect(topic.props.some((p) => p === 'syntax' || p === 'inherits' || p === 'initial-value')).toBe(false);
    }
  });

  it('dedupes repeated properties in a signature but keeps every declaration', () => {
    // `container` sets max-width once per breakpoint: one topic, several declarations worth showing.
    const container = tailwindReference().topics.find((t) => t.sig === 'width,max-width');
    expect(container?.title).toBe('Container');
    const decls = container?.classes[0]?.[1] ?? [];
    expect(decls.length).toBe(6); // width + five breakpoints
  });

  it('tags a declaration nested in an at-rule with the condition it applies under', () => {
    // ★ Regression guard. A flat line-scan of the generated CSS reported `container`'s five
    // breakpoint-scoped `max-width` values as unconditional, and the deduped signature then made the
    // UI zip 2 props against 6 values and show only the first — a row that read
    // "width: 100%; max-width: 40rem" and silently dropped four breakpoints.
    const container = tailwindReference().topics.find((t) => t.sig === 'width,max-width');
    const decls = container?.classes[0]?.[1] ?? [];
    expect(declCondition(decls[0]!)).toBeNull(); // width: 100% always applies
    const conditions = decls.slice(1).map((d) => declCondition(d));
    expect(conditions).toEqual([
      '@media (width >= 40rem)',
      '@media (width >= 48rem)',
      '@media (width >= 64rem)',
      '@media (width >= 80rem)',
      '@media (width >= 96rem)',
    ]);
    expect(formatDecl(decls[1]!)).toBe('max-width: 40rem (@media (width >= 40rem))');
  });

  it('marks the forced-colors fallbacks on outline-hidden as conditional', () => {
    const topic = tailwindReference().topics.find((t) => t.sig === 'outline-style,outline,outline-offset');
    const decls = topic?.classes.find(([n]) => n === 'outline-hidden')?.[1] ?? [];
    expect(declCondition(decls[0]!)).toBeNull();
    expect(declCondition(decls[1]!)).toBe('@media (forced-colors: active)');
    expect(declCondition(decls[2]!)).toBe('@media (forced-colors: active)');
  });

  it('gives every declaration a property and a value — no parse fragments', () => {
    // A general invariant over all 23k classes, so a Tailwind upgrade that introduces a new nesting
    // shape fails HERE rather than silently producing garbage rows.
    //
    // SCANNED IN PLAIN JS, asserted ONCE. Calling expect() per declaration meant ~100k matcher
    // invocations, whose bookkeeping — not the checking — took 510ms on a 20-core box and blew
    // vitest's 5s default on CI's 2-core runner with every package's suite running beside it. An
    // exhaustive invariant that is too slow to finish stops being an invariant: it just turns the
    // build red at random. Collecting offenders also reports EVERY one instead of stopping at the
    // first, which is what you want from a sweep whose job is to catch an upstream shape change.
    const PROPERTY = /^-{0,2}[a-zA-Z][-a-zA-Z0-9]*$/;
    const bad: string[] = [];
    for (const topic of tailwindReference().topics) {
      for (const [name, decls] of topic.classes) {
        if (decls.length === 0) {
          bad.push(`${name}: no declarations`);
          continue;
        }
        for (const decl of decls) {
          if (!PROPERTY.test(decl[0])) bad.push(`${name}: property ${JSON.stringify(decl[0])}`);
          if (decl[1] === '') bad.push(`${name}: empty value`);
          const condition = declCondition(decl);
          if (condition !== null && !condition.startsWith('@')) bad.push(`${name}: condition ${JSON.stringify(condition)}`);
        }
      }
    }
    // Show the first few rather than a diff of every offender, with the true count in the message.
    expect(bad.slice(0, 10), `${bad.length} declaration(s) failed the shape invariant`).toEqual([]);
  });

  it('never has a class whose declarations are all conditional but whose topic claims otherwise', () => {
    // Every property in a topic's signature must appear on at least one class, so the header
    // ("font-size · line-height") can never name a property no row actually carries.
    for (const topic of tailwindReference().topics) {
      const seen = new Set(topic.classes.flatMap(([, decls]) => decls.map((d) => d[0])));
      for (const prop of topic.props) expect(seen.has(prop), `${topic.title} claims ${prop}`).toBe(true);
    }
  });

  it('lists the variants the design system supports', () => {
    const names = tailwindReference().variants.map((v) => v.name);
    expect(names).toContain('hover');
    expect(names).toContain('dark');
    expect(names).toContain('focus-visible');
  });
});
