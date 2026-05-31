import { describe, it, expect } from 'vitest';
import type { Page, PageNode, PageTranslation } from '@sitewright/schema';
import { localeDraft, translationId, toTranslation } from '../src/lib/translation-draft';

const root: PageNode = {
  id: 'r',
  type: 'Section',
  children: [{ id: 'h', type: 'Heading', props: { text: 'Home' } }],
};
const page: Page = { id: 'home', path: '/', title: 'Home', root };

/** Deterministic id generator for assertions about copy-from-default re-iding. */
function counter(): () => string {
  let n = 0;
  return () => `n${n++}`;
}

describe('translationId', () => {
  it('joins page id and locale with a double underscore', () => {
    expect(translationId('home', 'de')).toBe('home__de');
    expect(translationId('products-slug', 'pt-BR')).toBe('products-slug__pt-BR');
  });
});

describe('localeDraft', () => {
  it('returns the page itself for the default locale (no copy, not new)', () => {
    const draft = localeDraft(page, 'en', 'en', [], counter());
    expect(draft).toEqual({ title: 'Home', root: page.root, isNew: false });
    expect(draft.root).toBe(page.root); // same reference — editing the default IS editing the page
  });

  it('seeds a fresh-id copy of the default page when a locale has no translation yet', () => {
    const draft = localeDraft(page, 'en', 'de', [], counter());
    expect(draft.isNew).toBe(true);
    expect(draft.title).toBe('Home'); // copy-from-default starting point
    // Structurally identical but with fresh ids so the copy is independent.
    expect(draft.root.type).toBe('Section');
    expect(draft.root.id).toBe('n0');
    expect(draft.root.children?.[0]?.id).toBe('n1');
    expect(draft.root.children?.[0]?.props?.text).toBe('Home');
    // The original page tree is never mutated.
    expect(page.root.id).toBe('r');
    expect(page.root.children?.[0]?.id).toBe('h');
  });

  it('returns an existing translation when present (not new, no copy)', () => {
    const tr: PageTranslation = {
      id: 'home__de',
      pageId: 'home',
      locale: 'de',
      title: 'Startseite',
      root: { id: 'rd', type: 'Section', children: [{ id: 'hd', type: 'Heading', props: { text: 'Zuhause' } }] },
    };
    const draft = localeDraft(page, 'en', 'de', [tr], counter());
    expect(draft.isNew).toBe(false);
    expect(draft.title).toBe('Startseite');
    expect(draft.root).toBe(tr.root);
  });

  it('falls back to the page title when an existing translation omits its title', () => {
    const tr: PageTranslation = {
      id: 'home__de',
      pageId: 'home',
      locale: 'de',
      root: { id: 'rd', type: 'Section' },
    };
    const draft = localeDraft(page, 'en', 'de', [tr], counter());
    expect(draft.title).toBe('Home');
    expect(draft.isNew).toBe(false);
  });
});

describe('toTranslation', () => {
  const deRoot: PageNode = { id: 'rd', type: 'Section' };

  it('builds a PageTranslation with the storage-key id', () => {
    const tr = toTranslation(page, 'de', 'Startseite', deRoot);
    expect(tr).toEqual({
      id: 'home__de',
      pageId: 'home',
      locale: 'de',
      title: 'Startseite',
      root: deRoot,
    });
  });

  it('trims the title', () => {
    expect(toTranslation(page, 'de', '  Startseite  ', deRoot).title).toBe('Startseite');
  });

  it('omits the title when it is empty/whitespace (publish falls back to default)', () => {
    expect(toTranslation(page, 'de', '   ', deRoot).title).toBeUndefined();
    expect(toTranslation(page, 'de', '', deRoot).title).toBeUndefined();
  });

  it('omits the title when it equals the default page title (no redundant override)', () => {
    expect(toTranslation(page, 'de', 'Home', deRoot).title).toBeUndefined();
  });
});
