import { describe, it, expect } from 'vitest';
import type { Page } from '@sitewright/schema';
import {
  localizedDatasetName,
  resolveLocaleDatasets,
  translationsOf,
  localeOf,
  pagesInLocale,
  pagesById,
  pagePath,
  hasOwnCode,
  pageCodeMode,
  codeOwnerOf,
  resolveCodeRef,
  isCodeOwner,
  inheritingVariants,
  independentVariants,
  buildLocaleVariant,
  scaffoldLocale,
  propagatePageToLocales,
} from '../src/index.js';

// `path` is a SLUG SEGMENT (empty for home); full routes are computed from the parent chain.
const page = (over: Partial<Page>): Page =>
  ({ id: 'p', path: '', title: 'T', root: { id: 'r', type: 'Section' }, ...over }) as Page;

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
    page({ id: 'home', path: '', title: 'Home', translationGroup: 'home' }), // en (default, locale unset)
    page({ id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de', translationGroup: 'home' }),
    page({ id: 'home-fr', path: 'fr', parent: 'home', title: 'Accueil', locale: 'fr', translationGroup: 'home' }),
    page({ id: 'about', path: 'about', parent: 'home', title: 'About' }), // ungrouped
  ];

  it('returns all variants of the group (incl. self), sorted by locale, default filling unset', () => {
    // The paths are COMPUTED from the parent chain: /de, /, /fr.
    expect(translationsOf(pages, pages[0]!, 'en')).toEqual([
      { locale: 'de', path: '/de', title: 'Start' },
      { locale: 'en', path: '/', title: 'Home' }, // self, locale ← default
      { locale: 'fr', path: '/fr', title: 'Accueil' },
    ]);
  });

  it('a page with no translationGroup stands alone (no alternates)', () => {
    expect(translationsOf(pages, pages[3]!, 'en')).toEqual([]);
  });
});

describe('localeOf / pagesInLocale (per-locale nav)', () => {
  const pages: Page[] = [
    page({ id: 'home', path: '', title: 'Home' }), // default (locale unset)
    page({ id: 'about', path: 'about', parent: 'home', title: 'About' }), // default
    page({ id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de' }),
    page({ id: 'services-de', path: 'leistungen', parent: 'home-de', title: 'Leistungen', locale: 'de' }),
  ];

  it('localeOf falls back to the project default when a page has no locale', () => {
    expect(localeOf(pages[0]!, 'en')).toBe('en'); // unset → default
    expect(localeOf(pages[2]!, 'en')).toBe('de'); // explicit
  });

  it('pagesInLocale returns only the pages of that language (default = the unset ones)', () => {
    expect(pagesInLocale(pages, 'en', 'en').map((p) => p.id)).toEqual(['home', 'about']);
    expect(pagesInLocale(pages, 'de', 'en').map((p) => p.id)).toEqual(['home-de', 'services-de']);
  });
});

describe('code mode classification', () => {
  it('pageCodeMode / hasOwnCode distinguish inherit / fork / template', () => {
    expect(pageCodeMode(page({ id: 'a' }))).toBe('inherit'); // no source/template
    expect(pageCodeMode(page({ id: 'a', source: '<p>x</p>' }))).toBe('fork');
    expect(pageCodeMode(page({ id: 'a', template: 'global:text' }))).toBe('template');
    // template wins over a stray source.
    expect(pageCodeMode(page({ id: 'a', source: '<p>x</p>', template: 'global:text' }))).toBe('template');

    expect(hasOwnCode(page({ id: 'a' }))).toBe(false);
    expect(hasOwnCode(page({ id: 'a', source: '<p>x</p>' }))).toBe(true);
    expect(hasOwnCode(page({ id: 'a', template: 'global:text' }))).toBe(true);
  });

  it('treats an EMPTY-string source as no own code (the editor sends `source: ""` for code-less pages)', () => {
    expect(pageCodeMode(page({ id: 'a', source: '' }))).toBe('inherit');
    expect(hasOwnCode(page({ id: 'a', source: '' }))).toBe(false);
    // An inherit variant whose owner has only an empty source resolves to no code (not `{ source: '' }`).
    const pages: Page[] = [
      page({ id: 'home', path: '', title: 'Home', source: '', translationGroup: 'home' }),
      page({ id: 'home-de', path: 'de', title: 'Start', locale: 'de', translationGroup: 'home' }),
    ];
    expect(resolveCodeRef(pages[1]!, pages, 'en')).toEqual({});
  });
});

describe('code inheritance (resolveCodeRef / codeOwnerOf)', () => {
  const owner = page({ id: 'about', path: 'about', title: 'About', source: '<h1>About</h1>', translationGroup: 'about' });
  const ownerTpl = page({ id: 'svc', path: 'svc', title: 'Services', template: 'svc-tpl', translationGroup: 'svc' });
  const pages: Page[] = [
    owner,
    ownerTpl,
    page({ id: 'about-de', path: 'about', title: 'Über', locale: 'de', translationGroup: 'about' }), // inherit
    page({ id: 'about-fr', path: 'about', title: 'À propos', locale: 'fr', source: '<h1>FR</h1>', translationGroup: 'about' }), // fork
    page({ id: 'svc-de', path: 'svc', title: 'Leistungen', locale: 'de', translationGroup: 'svc' }), // inherit a template
    page({ id: 'lonely-de', path: 'kontakt', title: 'Kontakt', locale: 'de', source: '<h1>DE only</h1>' }), // locale-only, own code
  ];

  it('codeOwnerOf finds the default-locale member of the group', () => {
    expect(codeOwnerOf(pages[2]!, pages, 'en')?.id).toBe('about');
    expect(codeOwnerOf(pages[4]!, pages, 'en')?.id).toBe('svc');
    expect(codeOwnerOf(pages[5]!, pages, 'en')).toBeUndefined(); // no group
  });

  it('an inherit-mode variant resolves the owner source', () => {
    expect(resolveCodeRef(pages[2]!, pages, 'en')).toEqual({ source: '<h1>About</h1>' });
  });

  it('an inherit-mode variant resolves the owner TEMPLATE ref', () => {
    expect(resolveCodeRef(pages[4]!, pages, 'en')).toEqual({ template: 'svc-tpl' });
  });

  it('a forked variant uses its OWN source (never the owner)', () => {
    expect(resolveCodeRef(pages[3]!, pages, 'en')).toEqual({ source: '<h1>FR</h1>' });
  });

  it('the owner resolves to its own code', () => {
    expect(resolveCodeRef(owner, pages, 'en')).toEqual({ source: '<h1>About</h1>' });
    expect(resolveCodeRef(ownerTpl, pages, 'en')).toEqual({ template: 'svc-tpl' });
  });

  it('a template ref WINS over a stale source (the editor keeps source when a template is assigned)', () => {
    const both = page({ id: 'b', source: '<h1>old</h1>', template: 'global:text' });
    expect(resolveCodeRef(both, [both], 'en')).toEqual({ template: 'global:text' });
  });

  it('a locale-only page with own code resolves it; with no code + no owner returns empty', () => {
    expect(resolveCodeRef(pages[5]!, pages, 'en')).toEqual({ source: '<h1>DE only</h1>' });
    const orphan = page({ id: 'x-de', locale: 'de', path: 'x', translationGroup: 'missing' });
    expect(resolveCodeRef(orphan, pages, 'en')).toEqual({});
  });
});

describe('delete-cascade partitioning', () => {
  const pages: Page[] = [
    page({ id: 'about', path: 'about', title: 'About', source: '<h1>A</h1>', translationGroup: 'about' }),
    page({ id: 'about-de', path: 'about', title: 'Über', locale: 'de', translationGroup: 'about' }), // inherit → cascades
    page({ id: 'about-fr', path: 'about', title: 'FR', locale: 'fr', source: '<h1>FR</h1>', translationGroup: 'about' }), // fork → kept
    page({ id: 'about-es', path: 'about', title: 'ES', locale: 'es', template: 'global:text', translationGroup: 'about' }), // template → kept
    page({ id: 'solo', path: 'solo', title: 'Solo', source: '<p>s</p>' }), // no group
  ];

  it('isCodeOwner is true only for the default-locale page of a multi-member group', () => {
    expect(isCodeOwner(pages[0]!, pages, 'en')).toBe(true);
    expect(isCodeOwner(pages[1]!, pages, 'en')).toBe(false); // a de variant, not the owner
    expect(isCodeOwner(pages[4]!, pages, 'en')).toBe(false); // standalone
  });

  it('cascade hits inherit-mode variants; forked/template variants are kept', () => {
    expect(inheritingVariants(pages[0]!, pages).map((p) => p.id)).toEqual(['about-de']);
    expect(independentVariants(pages[0]!, pages).map((p) => p.id)).toEqual(['about-fr', 'about-es']);
  });
});

describe('scaffoldLocale (whole-site duplicate into a new locale)', () => {
  const pages: Page[] = [
    page({ id: 'home', path: '', title: 'Home', source: '<h1>Home</h1>', data: { headline: 'Hi' } }),
    page({ id: 'about', path: 'about', parent: 'home', title: 'About', source: '<h1>About</h1>' }),
    page({ id: 'team', path: 'team', parent: 'about', title: 'Team', source: '<h1>Team</h1>' }),
  ];

  it('creates an inherit-mode variant of every default page, mirroring the tree under /<locale>', () => {
    const { created, updated } = scaffoldLocale(pages, 'de', 'en');
    expect(created.map((p) => p.id)).toEqual(['home-de', 'about-de', 'team-de']);

    const byId = pagesById([...pages.map((p) => updated.find((u) => u.id === p.id) ?? p), ...created]);
    const route = (id: string) => pagePath(byId.get(id)!, byId);
    expect(route('home-de')).toBe('/de');
    expect(route('about-de')).toBe('/de/about');
    expect(route('team-de')).toBe('/de/about/team');

    // Variants inherit code (no source/template) and copy data.
    const homeDe = created.find((p) => p.id === 'home-de')!;
    expect(homeDe.source).toBeUndefined();
    expect(homeDe.template).toBeUndefined();
    expect(homeDe.data).toEqual({ headline: 'Hi' });
    expect(homeDe.locale).toBe('de');
    expect(homeDe.translationGroup).toBe('home');
  });

  it('links the owners into their translation group (updated set)', () => {
    const { updated } = scaffoldLocale(pages, 'de', 'en');
    expect(updated.map((p) => [p.id, p.translationGroup])).toEqual([
      ['home', 'home'],
      ['about', 'about'],
      ['team', 'team'],
    ]);
  });

  it('the copied data is a deep clone (mutating a variant does not touch the owner)', () => {
    const { created } = scaffoldLocale(pages, 'de', 'en');
    const homeDe = created.find((p) => p.id === 'home-de')!;
    (homeDe.data as Record<string, unknown>).headline = 'Hallo';
    expect(pages[0]!.data).toEqual({ headline: 'Hi' }); // owner untouched
  });
});

describe('propagatePageToLocales (new page → all languages)', () => {
  // A site already translated into de + fr (home variants exist), plus a freshly created owner page.
  const base: Page[] = [
    page({ id: 'home', path: '', title: 'Home', source: '<h1>H</h1>', translationGroup: 'home' }),
    page({ id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de', translationGroup: 'home' }),
    page({ id: 'home-fr', path: 'fr', parent: 'home', title: 'Accueil', locale: 'fr', translationGroup: 'home' }),
  ];
  const owner = page({ id: 'pricing', path: 'pricing', parent: 'home', title: 'Pricing', source: '<h1>$</h1>' });

  it('creates a variant nested under each locale home and shares a group', () => {
    const pages = [...base, owner];
    const { created, updated } = propagatePageToLocales(owner, pages, ['en', 'de', 'fr'], 'en');
    expect(created.map((p) => p.id)).toEqual(['pricing-de', 'pricing-fr']); // skips en (default)
    expect(updated.map((p) => p.id)).toEqual(['pricing']); // owner gains translationGroup

    const byId = pagesById([...base, updated[0]!, ...created]);
    expect(pagePath(byId.get('pricing-de')!, byId)).toBe('/de/pricing');
    expect(pagePath(byId.get('pricing-fr')!, byId)).toBe('/fr/pricing');
    expect(created.every((p) => p.source === undefined && p.template === undefined)).toBe(true);
    expect(created.every((p) => p.translationGroup === 'pricing')).toBe(true);
  });

  it('skips locales the page already exists in', () => {
    const pages = [...base, owner, buildLocaleVariant({ ...owner, translationGroup: 'pricing' }, 'de', [...base, { ...owner, translationGroup: 'pricing' }], 'en')];
    const { created } = propagatePageToLocales({ ...owner, translationGroup: 'pricing' }, pages, ['en', 'de', 'fr'], 'en');
    expect(created.map((p) => p.id)).toEqual(['pricing-fr']); // de already present
  });
});
