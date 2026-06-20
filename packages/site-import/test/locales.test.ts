import { describe, expect, it } from 'vitest';
import type { Page } from '@sitewright/schema';
import { parse } from '../src/dom.js';
import { applyLocales, detectLocaleSet } from '../src/transform/locales.js';

describe('detectLocaleSet', () => {
  it('gathers locales from <html lang> + hreflang alternates, dropping x-default/garbage', () => {
    const docs = [
      { doc: parse('<html lang="en"><head><link rel="alternate" hreflang="de" href="/de/"><link rel="alternate" hreflang="x-default" href="/"><link rel="stylesheet" href="/s.css"></head><body></body></html>') },
      { doc: parse('<html lang="de"><head><link rel="alternate" hreflang="es-ES" href="/es/"></head><body></body></html>') },
    ];
    expect([...detectLocaleSet(docs)].sort()).toEqual(['de', 'en', 'es-es']);
  });

  it('is empty for a page with no lang/hreflang signals', () => {
    expect(detectLocaleSet([{ doc: parse('<html><body>hi</body></html>') }]).size).toBe(0);
  });
});

// Pages as routes.ts produces them for a trilingual site (en default, /de/ + /es/ prefixed).
function trilingualPages(): Page[] {
  return [
    { id: 'home', path: '', title: 'Home', nav: { slots: ['header'] } },
    { id: 'about', path: 'about', title: 'About', nav: { slots: ['header'] } },
    { id: 'de', path: 'de', title: 'de', nav: { slots: ['header'] } },
    { id: 'de__about', path: 'about', title: 'About', parent: 'de' },
    { id: 'es', path: 'es', title: 'es' },
    { id: 'es__about', path: 'about', title: 'About', parent: 'es' },
  ];
}

describe('applyLocales', () => {
  it('labels prefixed pages with locale + a shared translationGroup; derives the locale list', () => {
    const pages = trilingualPages();
    const res = applyLocales(pages, new Set(['en', 'de', 'es']), 'en');
    expect(res).toEqual({ locales: ['en', 'de', 'es'], defaultLocale: 'en' });

    const byId = Object.fromEntries(pages.map((p) => [p.id, p]));
    // Default-locale (en) pages: no locale; owners carry the group.
    expect(byId.about!.locale).toBeUndefined();
    expect(byId.about!.translationGroup).toBe('about');
    expect(byId.home!.translationGroup).toBe('home');
    // de/es variants: locale set, same group as their owner, nav cleared.
    expect(byId.de!.locale).toBe('de');
    expect(byId.de!.translationGroup).toBe('home'); // locale home ↔ default home
    expect(byId.de!.nav).toBeUndefined();
    expect(byId.de__about!.locale).toBe('de');
    expect(byId.de__about!.translationGroup).toBe('about');
    expect(byId.es__about!.locale).toBe('es');
    expect(byId.es__about!.translationGroup).toBe('about');
  });

  it('links translationGroups for an all-prefixed site (/en/ + /de/, no bare /)', () => {
    const pages: Page[] = [
      { id: 'en', path: 'en', title: 'en' },
      { id: 'en__about', path: 'about', title: 'About', parent: 'en' },
      { id: 'de', path: 'de', title: 'de' },
      { id: 'de__about', path: 'about', title: 'About', parent: 'de' },
    ];
    const res = applyLocales(pages, new Set(['en', 'de']), 'en');
    expect(res.defaultLocale).toBe('en');
    const byId = Object.fromEntries(pages.map((p) => [p.id, p]));
    expect(byId.en__about!.locale).toBeUndefined(); // en = default (even though prefixed)
    expect(byId.de__about!.locale).toBe('de');
    expect(byId.de__about!.translationGroup).toBe(byId.en__about!.translationGroup); // linked, not orphaned
    expect(byId.de__about!.translationGroup).toBeTruthy();
    expect(byId.de!.translationGroup).toBe(byId.en!.translationGroup); // locale homes linked too
  });

  it('is a no-op for a single-locale site', () => {
    const pages = trilingualPages();
    const before = JSON.stringify(pages);
    const res = applyLocales(pages, new Set(['en']), 'en');
    expect(res).toEqual({ locales: ['en'], defaultLocale: 'en' });
    expect(JSON.stringify(pages)).toBe(before); // untouched
  });

  it('picks the unprefixed locale as the default even when the hint differs', () => {
    // Site served with /en/ + /fr/ prefixes but the home (unprefixed) is fr.
    const pages: Page[] = [
      { id: 'home', path: '', title: 'Accueil' }, // unprefixed → default
      { id: 'en', path: 'en', title: 'en' },
      { id: 'en__about', path: 'about', title: 'About', parent: 'en' },
    ];
    const res = applyLocales(pages, new Set(['fr', 'en']), 'en'); // hint 'en' but en IS prefixed
    expect(res.defaultLocale).toBe('fr');
    expect(Object.fromEntries(pages.map((p) => [p.id, p])).en__about!.locale).toBe('en');
  });
});
