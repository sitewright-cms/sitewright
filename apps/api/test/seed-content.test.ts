import { describe, it, expect } from 'vitest';
import { validateTemplate } from '@sitewright/blocks';
import { GLOBAL_TEMPLATES, GLOBAL_SNIPPET_PARTIALS, WIDGET_PARTIALS, WIDGET_MANIFESTS } from '@sitewright/core';
import type { Page } from '@sitewright/schema';
import { RESERVED_TRANSLATION_GROUPS } from '@sitewright/schema';
import {
  examplePages,
  pagesEn,
  EXAMPLE_WEBSITE,
  EXAMPLE_DATASETS,
  EXAMPLE_FORMS,
  EXAMPLE_SETTINGS,
  CHROME_STRINGS,
  CHROME_TRANSLATIONS,
  exampleEntries,
} from '../src/seed/index.js';

// The image-bearing content is parameterized by an asset-URL map; for these structural/
// validator checks the URLs are irrelevant, so seed with an empty map (→ empty image refs).
const EXAMPLE_PAGES = examplePages({});
const EXAMPLE_ENTRIES = exampleEntries({});
const EN_PAGES = pagesEn(new Proxy({}, { get: () => '' }) as Record<string, string>);
const EXTRA_LOCALES = EXAMPLE_SETTINGS.locales.filter((l) => l !== EXAMPLE_SETTINGS.defaultLocale);

// NOTE: the extractor sees only data-sw-* keys and page.data.* references — a translatable
// string authored as a STATIC attribute literal (e.g. data-sw-title="Project work" instead of
// data-sw-title="{{page.data.tab_projects}}") would escape the completeness check. Seed pages
// must keep translatable attribute text behind page.data references.
/**
 * A page's effective Handlebars source (own `source`, or its referenced global template's), WITH the
 * source of any composed `{{> name}}` partial appended. `includeWidgets` controls whether managed
 * WIDGET bodies are appended too:
 *  - DATASET guard → true: a Widget's `{{#each dataset.<slug>}}` must resolve to a seeded dataset.
 *  - i18n COMPLETENESS guard → false (default): a Widget is system-managed code; its OPTIONAL,
 *    non-translatable page.data pointers (e.g. the hero slider's `hero_config` config selector) are
 *    NOT the page's translation responsibility, so they must not be treated as required bound keys.
 */
function effectiveSource(page: Page, includeWidgets = false): string | undefined {
  const base = page.source ?? (page.template ? GLOBAL_TEMPLATES.find((t) => t.id === page.template)?.source : undefined);
  if (base === undefined) return undefined;
  const partials = [...base.matchAll(/\{\{>\s*([a-zA-Z0-9_-]+)\s*\}\}/g)]
    .map((m) => GLOBAL_SNIPPET_PARTIALS[m[1]!] ?? (includeWidgets ? WIDGET_PARTIALS[m[1]!] : undefined))
    .filter((s): s is string => Boolean(s));
  return partials.length ? `${base}\n${partials.join('\n')}` : base;
}

/** The page.data keys a source binds: [data-sw-* keys (DE-only — EN defaults are authored),
 *  tier-2 keys (page.data refs + quoted lookups — required in EVERY locale incl. EN)]. */
function boundKeys(source: string): { directive: string[]; attr: string[]; url: string[] } {
  // Directive keys are a nested `page.data.<path>` or a bare top-level key → reduce to the page.data key.
  const strip = (k: string): string => (k.startsWith('page.data.') ? k.slice('page.data.'.length).split('.')[0]! : k);
  const directive = [...source.matchAll(/data-sw-(?:text|html|href)="([^"{}]+)"/g)].map((m) => strip(m[1]!));
  // Image-URL sinks may legitimately hold '' (asset generation is best-effort) — presence-only.
  const url = [...source.matchAll(/data-sw-(?:src|bg)="([^"{}]+)"/g)].map((m) => strip(m[1]!));
  // Tier-2 = a page.data value READ via a binding/lookup (no element default → required in EVERY locale).
  // Exclude the directive ATTRIBUTES (tier-1, handled above) and the editor-only {{sw-control}} chips
  // (their target is settable, not a required seed) so neither is double-counted now that directive keys
  // share the same `page.data.` prefix as bindings.
  const bindings = source.replace(/data-sw-[a-z]+="[^"]*"/g, '').replace(/\{\{\s*sw-control[^}]*\}\}/g, '');
  const attr = [
    ...[...bindings.matchAll(/page\.data\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]!),
    ...[...bindings.matchAll(/\(lookup page\.data "([a-zA-Z0-9_]+)"\)/g)].map((m) => m[1]!),
  ];
  return { directive: [...new Set(directive)], attr: [...new Set(attr)], url: [...new Set(url)] };
}

/**
 * Guards the seeded demo CONTENT: every source/slot passes the no-JS validator, every dataset
 * binding resolves, and — the flagship i18n invariants — every locale variant is INHERIT-mode
 * with a COMPLETE translation (every key its shared code binds), the chrome string sets are
 * parity-checked, and every localized dataset/form twin matches its base. A future edit to the
 * demo can't silently ship an untranslated key or a page that only blows up at publish time.
 */
describe('seed demo content', () => {
  it('every code-first page source passes the no-JS template validator', () => {
    for (const page of EXAMPLE_PAGES) {
      if (page.source) {
        expect(() => validateTemplate(page.source as string), `page "${page.id}"`).not.toThrow();
      }
    }
  });

  it('every skeleton slot (mainNav, footer) passes the validator', () => {
    expect(() => validateTemplate(EXAMPLE_WEBSITE.mainNav)).not.toThrow();
    expect(() => validateTemplate(EXAMPLE_WEBSITE.footer)).not.toThrow();
    // No `bottom` slot any more — the consent banner auto-injects (no {{sw-consent}} placeholder).
  });

  it('seeds a content-only blog: an overview page + article children using the global blog templates', () => {
    const overview = EXAMPLE_PAGES.find((p) => p.id === 'blog');
    expect(overview).toMatchObject({ path: 'blog', parent: 'home', template: 'global:blog-overview' });
    const articles = EXAMPLE_PAGES.filter((p) => p.parent === 'blog');
    expect(articles.length).toBeGreaterThanOrEqual(3);
    for (const a of articles) {
      expect(a.template).toBe('global:blog-article');
      const data = a.data as Record<string, unknown>;
      expect(typeof data.article_title).toBe('string');
      expect(typeof data.article_body).toBe('string');
      expect(typeof data.article_excerpt).toBe('string');
      expect(typeof data.article_date).toBe('string'); // the overview's {{sw-date}} card line
    }
  });

  it('every dataset the pages bind via {{#each dataset.<slug>}} has a schema and seeded entries', () => {
    const entriesByDataset = new Set(EXAMPLE_ENTRIES.map((e) => e.dataset));
    const datasetSlugs = new Set(EXAMPLE_DATASETS.map((d) => d.slug));
    // includeWidgets=true: a Widget's dataset usage counts too — both `{{#each dataset.X}}` and the
    // `(sw-pick-entry dataset.X …)` form the hero slider uses to pick one config.
    const sources = EXAMPLE_PAGES.map((p) => effectiveSource(p, true) ?? '').join('\n');
    const bound = [
      ...sources.matchAll(/\{\{#each\s+dataset\.([a-z0-9_-]+)\s*\}\}/g),
      ...sources.matchAll(/sw-pick-entry\s+dataset\.([a-z0-9_-]+)/g),
    ].map((m) => m[1]);
    expect(bound.length).toBeGreaterThan(0);
    for (const slug of bound) {
      expect(datasetSlugs.has(slug!), `dataset "${slug}" is defined`).toBe(true);
      expect(entriesByDataset.has(slug!), `dataset "${slug}" has entries`).toBe(true);
    }
  });

  // ---- the flagship i18n invariants ------------------------------------------------------------

  it('every non-link EN page has exactly one INHERIT-mode variant per extra locale, with translated title + data', () => {
    for (const locale of EXTRA_LOCALES) {
      for (const owner of EN_PAGES) {
        const variants = EXAMPLE_PAGES.filter((p) => p.locale === locale && p.translationGroup === owner.id);
        expect(variants, `"${owner.id}" → ${locale}`).toHaveLength(1);
        const v = variants[0]!;
        // Inherit mode: the variant carries NO code — neither source nor template; its code
        // resolves to the owner's via resolveCodeRef (the i18n model's default).
        expect(v.source, `${v.id} must not fork code`).toBeUndefined();
        expect(v.template, `${v.id} must not pin a template`).toBeUndefined();
        expect(v.title, `${v.id} translated title`).toBeTruthy();
        if (owner.kind !== 'link') {
          // The locale home's slug is the locale code; every other variant gets a localized slug.
          expect(v.path, `${v.id} localized slug`).toBeTruthy();
        }
      }
    }
  });

  it('every locale variant carries EVERY page.data key its inherited code binds (translation completeness)', () => {
    for (const locale of EXTRA_LOCALES) {
      for (const owner of EN_PAGES) {
        const source = effectiveSource(owner);
        if (!source) continue;
        const v = EXAMPLE_PAGES.find((p) => p.locale === locale && p.translationGroup === owner.id)!;
        const keys = boundKeys(source);
        const vData = (v.data ?? {}) as Record<string, unknown>;
        const enData = (owner.data ?? {}) as Record<string, unknown>;
        for (const k of [...keys.directive, ...keys.attr]) {
          const val = vData[k as keyof typeof vData];
          expect(typeof val === 'string' && val !== '' ? 'ok' : `MISSING ${locale} ${owner.id}.${k}`, `${v.id} data.${k}`).toBe('ok');
        }
        for (const k of keys.url) {
          expect(typeof vData[k as keyof typeof vData], `${v.id} data.${k} (url sink, presence)`).toBe('string');
        }
        // Tier-2 (attribute/config) keys have no authored default — the EN page needs them too.
        for (const k of keys.attr) {
          expect(typeof enData[k as keyof typeof enData], `en ${owner.id} data.${k}`).toBe('string');
        }
      }
    }
  });

  it('chrome strings: every locale carries the SAME key set, and every key the slots reference exists', () => {
    const locales = Object.keys(CHROME_STRINGS);
    expect(locales).toEqual(expect.arrayContaining([...EXAMPLE_SETTINGS.locales]));
    const enKeys = Object.keys(CHROME_STRINGS.en!).sort();
    for (const locale of locales) {
      expect(Object.keys(CHROME_STRINGS[locale]!).sort(), `strings.${locale} keys`).toEqual(enKeys);
    }
    const slots = [EXAMPLE_WEBSITE.mainNav, EXAMPLE_WEBSITE.footer].filter(Boolean).join('\n');
    // The slots now localize via the translation catalog: {{sw-translate "key"}} / (sw-translate "key").
    const referenced = [...slots.matchAll(/sw-translate "([a-z_]+)"/g)].map((m) => m[1]!);
    expect(referenced.length).toBeGreaterThan(0);
    for (const key of new Set(referenced)) {
      expect(enKeys.includes(key), `strings key "${key}"`).toBe(true);
    }
  });

  it('every page data-sw-translate key resolves in the catalog with a translation for each extra locale', () => {
    // Pages bind prominent strings via data-sw-translate="<scope>.<key>" (the inline-editable global
    // catalog). EN is the element's inline fallback; the example is a complete trilingual showcase, so
    // every such key must carry a non-empty cell for every NON-default locale (de/es).
    const catalog = (EXAMPLE_WEBSITE.translations ?? {}) as Record<string, Record<string, string>>;
    const sources = EXAMPLE_PAGES.map((p) => effectiveSource(p, true) ?? '').join('\n');
    const keys = new Set([...sources.matchAll(/data-sw-translate="([A-Za-z_][A-Za-z0-9_.]*)"/g)].map((m) => m[1]!));
    expect(keys.size).toBeGreaterThan(0);
    // at least the migrated page scopes are present (sanity that the migration landed)
    for (const k of ['home.headline', 'services.headline', 'about.headline']) expect(keys.has(k), `page binds ${k}`).toBe(true);
    for (const key of keys) {
      const cell = catalog[key as keyof typeof catalog];
      expect(cell, `data-sw-translate key "${key}" exists in website.translations`).toBeTruthy();
      for (const loc of EXTRA_LOCALES) {
        const v = cell![loc as keyof typeof cell];
        expect(typeof v === 'string' && v !== '', `catalog "${key}" has a ${loc} translation`).toBe(true);
      }
    }
  });

  it('reserved-translation registry ↔ seed: every reserved key is seeded, and its EN value is the registry default', () => {
    // The RESERVED_TRANSLATION registry (@sitewright/schema) is the single source of truth for the
    // platform's built-in English UI strings (the cart helpers' fallback + the editor ghost rows). The
    // example's EN chrome must not drift from it, so a populated example matches what an empty project
    // renders by fallback.
    for (const group of RESERVED_TRANSLATION_GROUPS) {
      for (const { key, default: def } of group.keys) {
        const cell = CHROME_TRANSLATIONS[key];
        expect(cell, `reserved key "${key}" is seeded in the chrome catalog`).toBeDefined();
        expect(cell!.en, `reserved key "${key}" EN value matches the registry default`).toBe(def);
      }
    }
  });

  it('localized datasets: every base has per-locale twins with identical field shapes and equal entry counts; references resolve in-locale', () => {
    // Widget CONFIG datasets (e.g. the hero-slider's `hero`) are intentionally NON-localized: a single
    // bare dataset serves every locale via resolveLocaleDatasets' fallback, matching save-time
    // provisioning. They're exempt from the per-locale twin requirement.
    const widgetDatasetSlugs = new Set(Object.values(WIDGET_MANIFESTS).flatMap((m) => m.datasets.map((d) => d.slug)));
    const bases = EXAMPLE_DATASETS.filter(
      (d) => !EXTRA_LOCALES.some((l) => d.slug.endsWith(`_${l}`)) && !widgetDatasetSlugs.has(d.slug),
    );
    expect(bases.length).toBeGreaterThanOrEqual(8);
    for (const locale of EXTRA_LOCALES) {
      for (const base of bases) {
        // locale twins use the UNDERSCORE suffix (a dataset slug is a Handlebars path)
        const twin = EXAMPLE_DATASETS.find((d) => d.slug === `${base.slug}_${locale}`);
        expect(twin, `${base.slug}_${locale}`).toBeDefined();
        expect(twin!.fields.map((f) => [f.name, f.type])).toEqual(base.fields.map((f) => [f.name, f.type]));
        const baseCount = EXAMPLE_ENTRIES.filter((e) => e.dataset === base.slug).length;
        const twinCount = EXAMPLE_ENTRIES.filter((e) => e.dataset === twin!.slug).length;
        expect(twinCount, `${twin!.slug} entry count`).toBe(baseCount);
      }
      // roles_<locale> managers reference team-<locale> entry ids (the keyed item.team lookup).
      const teamIds = new Set(EXAMPLE_ENTRIES.filter((e) => e.dataset === `team_${locale}`).map((e) => e.id));
      for (const role of EXAMPLE_ENTRIES.filter((e) => e.dataset === `roles_${locale}`)) {
        const manager = (role.values as { manager?: string }).manager;
        expect(manager && teamIds.has(manager), `${role.id} manager "${manager}"`).toBe(true);
      }
    }
    // The English roles reference English team ids too.
    const enTeam = new Set(EXAMPLE_ENTRIES.filter((e) => e.dataset === 'team').map((e) => e.id));
    for (const role of EXAMPLE_ENTRIES.filter((e) => e.dataset === 'roles')) {
      expect(enTeam.has((role.values as { manager?: string }).manager ?? ''), role.id).toBe(true);
    }
  });

  it('the roles "manager" reference field targets the locale-correct team via config.dataset', () => {
    // The editor's reference picker reads `config.dataset` (NOT `targetDataset`), so the per-locale
    // roles twin must point its manager at the same-locale team slug.
    for (const suffix of ['', ...EXTRA_LOCALES.map((l) => `_${l}`)]) {
      const roles = EXAMPLE_DATASETS.find((d) => d.slug === `roles${suffix}`);
      const manager = roles?.fields.find((f) => f.name === 'manager');
      expect(manager?.type, `roles${suffix} manager type`).toBe('reference');
      expect((manager?.config as { dataset?: string })?.dataset, `roles${suffix} manager target`).toBe(`team${suffix}`);
    }
  });

  it('localized forms: the contact form has a translated twin per locale (the {{sw-form}} suffix convention)', () => {
    for (const locale of EXTRA_LOCALES) {
      const twin = EXAMPLE_FORMS.find((f) => f.id === `contact-${locale}`);
      expect(twin, `contact-${locale}`).toBeDefined();
      const base = EXAMPLE_FORMS.find((f) => f.id === 'contact')!;
      expect(twin!.fields.map((f) => f.name)).toEqual(base.fields.map((f) => f.name));
      expect(twin!.submitLabel).not.toBe(base.submitLabel); // actually translated
    }
  });

  it('legal pages are noindex + footer-slot (kept out of the sitemap, listed in the chrome Legal column)', () => {
    for (const id of ['privacy', 'imprint']) {
      const page = EXAMPLE_PAGES.find((p) => p.id === id);
      expect(page?.noindex, id).toBe(true);
      expect(page?.nav?.slots, id).toContain('footer');
    }
  });

  it('binds the provided LOCAL asset URLs into entries + pages — and uses NO remote image hosts', () => {
    const assets = {
      'proj-harbor': '/media/p/ex-proj-harbor/ex-proj-harbor-800.jpg',
      'team-mara': '/media/p/ex-team-mara/ex-team-mara-400.jpg',
      // The entry id is `team-dev` but it looks up the `team-devon` asset key — pin that mapping.
      'team-devon': '/media/p/ex-team-devon/ex-team-devon-400.jpg',
      'prod-tee': '/media/p/ex-prod-tee/ex-prod-tee-640.jpg',
      'blog-speed': '/media/p/ex-blog-speed/ex-blog-speed-960.jpg',
      hero: '/media/p/ex-hero/ex-hero-800.jpg',
      studio: '/media/p/ex-studio/ex-studio-800.jpg',
    };
    const entries = exampleEntries(assets);
    const pages = examplePages(assets);
    // entry ids are underscore identifiers now; the ASSET KEYS (assets[...]) stay as-is (media keys).
    expect(JSON.stringify(entries.find((e) => e.id === 'proj_harbor'))).toContain(assets['proj-harbor']);
    expect(JSON.stringify(entries.find((e) => e.id === 'team_mara'))).toContain(assets['team-mara']);
    expect(JSON.stringify(entries.find((e) => e.id === 'team_dev'))).toContain(assets['team-devon']);
    expect(JSON.stringify(entries.find((e) => e.id === 'prod_tee'))).toContain(assets['prod-tee']);
    const sources = pages.map((p) => p.source ?? '').join('\n');
    expect(sources).toContain(assets.hero);
    expect(sources).toContain(assets.studio);
    // The German article variants carry the same local cover (page.data flows through too).
    expect(JSON.stringify(pages.find((p) => p.id === 'blog-static-speed-de')?.data)).toContain(assets['blog-speed']);
    // No remote image hosts anywhere in the seeded demo content.
    const all = [JSON.stringify(entries), JSON.stringify(pages.map((p) => p.data)), sources].join('\n');
    expect(all).not.toContain('picsum');
    expect(all).not.toMatch(/https?:\/\/[^"']*\.(?:jpg|jpeg|png|webp|gif|avif)/i);
  });
});
