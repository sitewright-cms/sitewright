import { describe, it, expect } from 'vitest';
import type { Entry } from '@sitewright/schema';
import {
  jsonEqual,
  localizeEntry,
  normalizeEntryTranslations,
  resolveLocaleEntries,
  withoutEntryTranslation,
} from '../src/entry-translations.js';

const entry = (id: string, values: Record<string, unknown>, translations?: Entry['translations']): Entry => ({
  id,
  dataset: 'services',
  status: 'published',
  values,
  ...(translations ? { translations } : {}),
});

describe('jsonEqual', () => {
  it('compares JSON structurally, ignoring key order', () => {
    expect(jsonEqual({ a: 1, b: [1, { c: 'x' }] }, { b: [1, { c: 'x' }], a: 1 })).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(jsonEqual([], {})).toBe(false);
    expect(jsonEqual(null, {})).toBe(false);
    expect(jsonEqual('1', 1)).toBe(false);
  });
});

describe('localizeEntry', () => {
  const hike = entry('hike', { name: 'Hiking boot', price: 120, photo: '/media/en.webp' }, { de: { name: 'Wanderschuh', photo: '/media/de.webp' } });

  it('overlays the language’s fields on the main values — the rest follow the main language', () => {
    expect(localizeEntry(hike, 'de').values).toEqual({ name: 'Wanderschuh', price: 120, photo: '/media/de.webp' });
  });

  it('leaves the entry as it is in a language it has no version in, or an empty one', () => {
    expect(localizeEntry(hike, 'fr')).toBe(hike);
    expect(localizeEntry(hike, undefined)).toBe(hike);
    const reviewed = entry('x', { name: 'Same' }, { de: {} });
    expect(localizeEntry(reviewed, 'de')).toBe(reviewed);
  });

  it('never reads an inherited property as a language', () => {
    expect(localizeEntry(hike, 'constructor')).toBe(hike);
    expect(localizeEntry(hike, '__proto__')).toBe(hike);
  });
});

describe('normalizeEntryTranslations', () => {
  it('★ keeps only what DIFFERS from the main language, so the rest keeps following it', () => {
    const copied = entry(
      'hike',
      { name: 'Hiking boot', price: 120, sizes: [40, 41], spec: { weight: 900 } },
      { de: { name: 'Wanderschuh', price: 120, sizes: [40, 41], spec: { weight: 900 } }, fr: { price: 125 } },
    );
    expect(normalizeEntryTranslations(copied).translations).toEqual({ de: { name: 'Wanderschuh' }, fr: { price: 125 } });
  });

  it('a version with nothing different stays, empty — reviewed, not missing', () => {
    expect(normalizeEntryTranslations(entry('x', { name: 'Logo' }, { de: { name: 'Logo' } })).translations).toEqual({ de: {} });
  });

  it('keeps a field the main language does not have at all', () => {
    expect(normalizeEntryTranslations(entry('x', {}, { de: { note: 'Nur hier' } })).translations).toEqual({ de: { note: 'Nur hier' } });
  });

  it('leaves an entry without translations untouched', () => {
    const plain = entry('x', { name: 'A' });
    expect(normalizeEntryTranslations(plain)).toBe(plain);
  });
});

describe('withoutEntryTranslation', () => {
  it('drops one language and keeps the others', () => {
    const e = entry('x', { name: 'A' }, { de: { name: 'B' }, fr: { name: 'C' } });
    expect(withoutEntryTranslation(e, 'de').translations).toEqual({ fr: { name: 'C' } });
  });

  it('drops the whole map with its last language, and is a no-op for one it does not have', () => {
    const e = entry('x', { name: 'A' }, { de: { name: 'B' } });
    expect(withoutEntryTranslation(e, 'de')).not.toHaveProperty('translations');
    expect(withoutEntryTranslation(e, 'fr')).toBe(e);
  });
});

describe('resolveLocaleEntries', () => {
  const services = [
    entry('web', { title: 'Web design', price: 900 }, { de: { title: 'Webdesign' } }),
    entry('seo', { title: 'SEO', price: 400 }),
  ];
  const team = [entry('ana', { name: 'Ana', role: 'Designer' }, { de: { role: 'Gestalterin' } })];

  it('★ a page in a language sees every entry in it where it has a version, else the main language', () => {
    const de = resolveLocaleEntries({ services, team }, 'de');
    expect(de.services!.map((e) => e.values)).toEqual([
      { title: 'Webdesign', price: 900 },
      { title: 'SEO', price: 400 },
    ]);
    // A reference is read through the same map (sw-pick-entry dataset.team id), so it follows too.
    expect(de.team![0]!.values).toEqual({ name: 'Ana', role: 'Gestalterin' });
  });

  it('★ a <slug>_<locale> dataset still replaces the whole dataset for that language', () => {
    const services_de = [entry('web', { title: 'Webdesign (Kopie)' })];
    const de = resolveLocaleEntries({ services, services_de }, 'de');
    expect(de.services).toBe(services_de);
    expect(de.services_de).toBe(services_de); // still addressable by its own name
  });

  it('the main language (no page locale) renders the stored values untouched', () => {
    const map = { services, team };
    expect(resolveLocaleEntries(map, undefined)).toBe(map);
  });

  it('a dataset no entry translates keeps its identity, and each list is overlaid once per language', () => {
    const plain = [entry('a', { t: 'A' })];
    const first = resolveLocaleEntries({ plain, services }, 'de');
    const again = resolveLocaleEntries({ plain, services }, 'de');
    expect(first.plain).toBe(plain);
    expect(again.services).toBe(first.services); // cached, not rebuilt for every page
    expect(resolveLocaleEntries({ services }, 'fr').services).toBe(services);
  });
});
