import { describe, it, expect } from 'vitest';
import type { Dataset, Entry, Page } from '@sitewright/schema';
import {
  localeVariantOf,
  pagesContext,
  pageUrlsContext,
  referencedPageUrlIds,
  resolveDatasetPageRefs,
} from '../src/index.js';

/**
 * A link from one page to another must stay in the reader's language. Translated pages INHERIT the main
 * page's source, so whatever an author writes in that source runs on every locale: a literal
 * `{{sw-url '/contact'}}` sends a German reader to the English page, and a slug-based `pages.contact`
 * stops resolving the moment the German page is renamed `kontakt`. These pin the id-based resolution
 * that survives both — the page's TRANSLATION GROUP decides, never its slug.
 */

const page = (over: Partial<Page>): Page => ({ id: 'p', path: '', title: 'T', status: 'published', ...over }) as Page;

// English main language, German variants with LOCALISED slugs (the case that breaks slug lookup).
const SITE: Page[] = [
  page({ id: 'home', path: '', title: 'Home', translationGroup: 'home' }),
  page({ id: 'contact', path: 'contact', title: 'Contact', parent: 'home', translationGroup: 'contact' }),
  page({ id: 'svc', path: 'services', title: 'Services', parent: 'home', translationGroup: 'svc' }),
  page({ id: 'web', path: 'web-design', title: 'Web design', parent: 'svc', translationGroup: 'web' }),
  page({ id: 'about', path: 'about', title: 'About', parent: 'home' }), // never translated
  page({ id: 'home-de', path: 'de', title: 'Start', parent: 'home', locale: 'de', translationGroup: 'home' }),
  page({ id: 'contact-de', path: 'kontakt', title: 'Kontakt', parent: 'home-de', locale: 'de', translationGroup: 'contact' }),
  page({ id: 'svc-de', path: 'leistungen', title: 'Leistungen', parent: 'home-de', locale: 'de', translationGroup: 'svc' }),
  page({ id: 'web-de', path: 'webdesign', title: 'Webdesign', parent: 'svc-de', locale: 'de', translationGroup: 'web' }),
];
const byId = (id: string): Page => SITE.find((p) => p.id === id)!;

describe('localeVariantOf', () => {
  it('finds the group sibling in the requested locale, from either side of the group', () => {
    expect(localeVariantOf(byId('contact'), SITE, 'de', 'en')?.id).toBe('contact-de');
    expect(localeVariantOf(byId('contact-de'), SITE, 'en', 'en')?.id).toBe('contact');
  });

  it('returns the page itself when it is already in that locale', () => {
    expect(localeVariantOf(byId('contact'), SITE, 'en', 'en')?.id).toBe('contact');
  });

  it('is undefined for a page with no variant in that locale', () => {
    expect(localeVariantOf(byId('about'), SITE, 'de', 'en')).toBeUndefined();
  });

  it('treats a page without an explicit translationGroup as its own group (the scaffold convention)', () => {
    const owner = page({ id: 'team', path: 'team', parent: 'home' }); // owner never got the field written
    const variant = page({ id: 'team-de', path: 'team', parent: 'home-de', locale: 'de', translationGroup: 'team' });
    expect(localeVariantOf(owner, [...SITE, owner, variant], 'de', 'en')?.id).toBe('team-de');
  });
});

describe('referencedPageUrlIds', () => {
  it('collects the literal ids passed to {{sw-page-url}}, either quote style, deduplicated', () => {
    const src = `<a href="{{sw-page-url "contact"}}">x</a><a href="{{sw-page-url 'web'}}">y</a>{{sw-page-url "contact"}}`;
    expect(referencedPageUrlIds(src).sort()).toEqual(['contact', 'web']);
  });

  it('ignores a dynamic argument (it is resolved from the value it carries, not from this map)', () => {
    expect(referencedPageUrlIds('{{sw-page-url target}}')).toEqual([]);
  });

  it('is empty for a source that never names the helper', () => {
    expect(referencedPageUrlIds('<a href="{{sw-url page.path}}">x</a>')).toEqual([]);
  });

  it('never yields a prototype key (the id charset admits them)', () => {
    expect(referencedPageUrlIds('{{sw-page-url "__proto__"}}{{sw-page-url "constructor"}}{{sw-page-url "ok"}}')).toEqual(['ok']);
  });
});

describe('pageUrlsContext', () => {
  const src = '{{sw-page-url "contact"}} {{sw-page-url "web"}} {{sw-page-url "about"}} {{sw-page-url "nope"}}';

  it('maps each referenced id to its route IN THE RENDERED PAGE’S LOCALE', () => {
    expect(pageUrlsContext(SITE, 'de', 'en', src)).toEqual({
      contact: '/de/kontakt/',
      web: '/de/leistungen/webdesign/',
      // No German variant: the reader still gets a working link — to the page that exists.
      about: '/about/',
    });
  });

  it('gives the default-locale routes on a default-locale page', () => {
    expect(pageUrlsContext(SITE, 'en', 'en', src)).toEqual({
      contact: '/contact/',
      web: '/services/web-design/',
      about: '/about/',
    });
  });

  it('accepts the id of ANY member of the group, not only the main-language one', () => {
    expect(pageUrlsContext(SITE, 'en', 'en', '{{sw-page-url "contact-de"}}')).toEqual({ 'contact-de': '/contact/' });
  });

  it('resolves through a THIRD language from any member (the group decides, not the stored page’s locale)', () => {
    const fr = [...SITE, page({ id: 'contact-fr', path: 'contact', parent: 'home-fr', locale: 'fr', translationGroup: 'contact' }),
      page({ id: 'home-fr', path: 'fr', parent: 'home', locale: 'fr', translationGroup: 'home' })];
    expect(pageUrlsContext(fr, 'fr', 'en', '{{sw-page-url "contact-de"}}')).toEqual({ 'contact-de': '/fr/contact/' });
  });

  it('gives a menu placeholder’s link target, and nothing for a bare dropdown label', () => {
    const withLinks = [
      ...SITE,
      page({ id: 'shop', path: '', parent: 'home', kind: 'link', link: { target: 'https://shop.example.com' } }),
      page({ id: 'more', path: '', parent: 'home', kind: 'link', link: {}, nav: { dropdown: true } as Page['nav'] }),
    ];
    expect(pageUrlsContext(withLinks, 'en', 'en', '{{sw-page-url "shop"}}{{sw-page-url "more"}}')).toEqual({ shop: 'https://shop.example.com' });
  });

  it('leaves an unknown (deleted / draft / never-existed) id out, so the helper can render a dead-end marker', () => {
    expect(pageUrlsContext(SITE, 'en', 'en', '{{sw-page-url "nope"}}')).toEqual({});
  });

  it('is undefined (no payload at all) when the source never names the helper', () => {
    expect(pageUrlsContext(SITE, 'en', 'en', '<p>plain</p>')).toBeUndefined();
    expect(pageUrlsContext(SITE, 'en', 'en', undefined)).toBeUndefined();
  });
});

describe('pagesContext — slug chains survive a localised slug', () => {
  // The inherited source is the MAIN page's, so its chains spell the main language's slugs.
  const src = '{{pages.contact._attributes.path}} {{pages.services.web-design._attributes.path}}';

  it('resolves a main-language slug to the reader’s own translated page', () => {
    const ctx = pagesContext(SITE, byId('home-de'), 'en', src) as Record<string, Record<string, Record<string, unknown>>>;
    expect(ctx.contact!._attributes!.path).toBe('/de/kontakt/');
    const services = ctx.services as unknown as Record<string, Record<string, Record<string, unknown>>>;
    expect(services['web-design']!._attributes!.path).toBe('/de/leistungen/webdesign/');
  });

  it('still prefers a page whose OWN slug matches (an untranslated slug, or one written in German)', () => {
    const ctx = pagesContext(SITE, byId('home-de'), 'en', '{{pages.kontakt._attributes.title}}') as Record<string, Record<string, Record<string, unknown>>>;
    expect(ctx.kontakt!._attributes!.title).toBe('Kontakt');
  });

  it('changes nothing on the main language', () => {
    const ctx = pagesContext(SITE, byId('home'), 'en', src) as Record<string, Record<string, Record<string, unknown>>>;
    expect(ctx.contact!._attributes!.path).toBe('/contact/');
  });
});

describe('resolveDatasetPageRefs — a page field follows the reader’s locale', () => {
  const field = (name: string, type: string): unknown => ({ name, type, required: false, localized: false });
  const schemas = [{ id: 'promos', name: 'promos', slug: 'promos', fields: [field('target', 'page')] } as unknown as Dataset];
  const promos = { promos: [{ id: 'a', dataset: 'promos', status: 'published', values: { target: 'contact' } } as Entry] };

  it('resolves the stored (main-language) id to its sibling in the given locale', () => {
    const out = resolveDatasetPageRefs(promos, schemas, SITE, 'en', 'de');
    expect(out.promos![0]!.values.target).toMatchObject({ id: 'contact-de', path: '/de/kontakt/', locale: 'de', title: 'Kontakt' });
  });

  it('falls back to the stored page when it has no variant in that locale', () => {
    const out = resolveDatasetPageRefs({ promos: [{ ...promos.promos[0]!, values: { target: 'about' } }] }, schemas, SITE, 'en', 'de');
    expect(out.promos![0]!.values.target).toMatchObject({ id: 'about', path: '/about/' });
  });

  it('keeps the exact stored page when no locale is given (unchanged behaviour)', () => {
    const out = resolveDatasetPageRefs(promos, schemas, SITE, 'en');
    expect(out.promos![0]!.values.target).toMatchObject({ id: 'contact', path: '/contact/' });
  });
});
