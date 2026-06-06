import { describe, it, expect } from 'vitest';
import type { Page } from '@sitewright/schema';
import { localizedDatasetName, resolveLocaleDatasets, translationsOf } from '../src/index.js';

const page = (over: Partial<Page>): Page =>
  ({ id: 'p', path: '/', title: 'T', root: { id: 'r', type: 'Section' }, ...over }) as Page;

describe('resolveLocaleDatasets (auto locale-suffix)', () => {
  const data = {
    services: [{ id: 'a' }],
    'services-de': [{ id: 'a-de' }],
    team: [{ id: 't' }], // no -de variant → falls back
  };

  it('base names resolve to their <name>-<locale> variant for the active locale', () => {
    const de = resolveLocaleDatasets(data, 'de');
    expect(de.services).toEqual([{ id: 'a-de' }]); // services → services-de
    expect(de.team).toEqual([{ id: 't' }]); // no de variant → unchanged (fallback)
    // The suffixed key stays addressable (manual escape hatch).
    expect(de['services-de']).toEqual([{ id: 'a-de' }]);
  });

  it('the default locale (no variants) is unchanged', () => {
    expect(resolveLocaleDatasets(data, 'en')).toEqual(data); // no services-en → identical
    expect(resolveLocaleDatasets(data, undefined)).toBe(data); // no locale → same ref
  });

  it('does not double-suffix an already-localized name', () => {
    const de = resolveLocaleDatasets({ 'services-de': [{ id: 'x' }] }, 'de');
    expect(de['services-de']).toEqual([{ id: 'x' }]); // not services-de-de
  });

  it('localizedDatasetName composes the suffix', () => {
    expect(localizedDatasetName('services', 'pt-BR')).toBe('services-pt-br');
  });
});

describe('translationsOf (language switcher / hreflang group)', () => {
  const pages: Page[] = [
    page({ id: 'home', path: '/', title: 'Home', translationGroup: 'home' }), // en (default, locale unset)
    page({ id: 'home-de', path: '/de/start', title: 'Start', locale: 'de', translationGroup: 'home' }),
    page({ id: 'home-fr', path: '/fr/accueil', title: 'Accueil', locale: 'fr', translationGroup: 'home' }),
    page({ id: 'about', path: '/about', title: 'About' }), // ungrouped
  ];

  it('returns all variants of the group (incl. self), sorted by locale, default filling unset', () => {
    expect(translationsOf(pages, pages[0]!, 'en')).toEqual([
      { locale: 'de', path: '/de/start', title: 'Start' },
      { locale: 'en', path: '/', title: 'Home' }, // self, locale ← default
      { locale: 'fr', path: '/fr/accueil', title: 'Accueil' },
    ]);
  });

  it('a page with no translationGroup stands alone (no alternates)', () => {
    expect(translationsOf(pages, pages[3]!, 'en')).toEqual([]);
  });
});
