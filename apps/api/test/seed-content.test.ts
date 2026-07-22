import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { validateTemplate } from '@sitewright/blocks';
import { GLOBAL_TEMPLATES, GLOBAL_SNIPPET_PARTIALS, WIDGET_PARTIALS, WIDGET_MANIFESTS } from '@sitewright/core';
import type { Page } from '@sitewright/schema';
import { RESERVED_TRANSLATION_GROUPS } from '@sitewright/schema';
import { EXAMPLE_PROJECTS_DIR, loadSeedBundle } from '../src/seed-bundle.js';

// The demo content now lives in the COMMITTED export bundle (apps/api/example_projects/example) —
// these guards read the bundle the seed imports, so an exported edit that breaks an invariant
// fails here before it ships.
const { bundle } = await loadSeedBundle(join(EXAMPLE_PROJECTS_DIR, 'example'));
const EXAMPLE_PAGES = bundle.pages;
const EXAMPLE_DATASETS = bundle.datasets;
const EXAMPLE_ENTRIES = bundle.entries;
const EXAMPLE_FORMS = bundle.forms;
const EXAMPLE_SETTINGS = bundle.project.settings;
const EXAMPLE_WEBSITE = bundle.project.website!;
// ONE key→{locale: value} catalog replaces the old per-locale CHROME_STRINGS/CHROME_TRANSLATIONS
// modules — chrome, page prose, and the reserved cart/consent strings all localize through it.
const CATALOG = (EXAMPLE_WEBSITE.translations ?? {}) as Record<string, Record<string, string>>;
const EN_PAGES = EXAMPLE_PAGES.filter((p) => !p.locale);
const EXTRA_LOCALES = EXAMPLE_SETTINGS.locales.filter((l) => l !== EXAMPLE_SETTINGS.defaultLocale);
// An EN page participates in translation via its translationGroup (export sets it to the page's own
// id). The current export ships comp-svg WITHOUT one (added to the live showcase untranslated) —
// pinned below so any NEW untranslated page still fails the i18n guards.
const TRANSLATED_EN_PAGES = EN_PAGES.filter((p) => p.translationGroup);
const KNOWN_UNTRANSLATED = ['comp-svg'];

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
 * with a COMPLETE translation (every key its shared code binds), the translation catalog is
 * parity-checked across locales, and every localized dataset/form twin matches its base. A future
 * re-export of the demo can't silently ship an untranslated key or a page that only blows up at
 * publish time.
 */
describe('seed demo content (the example bundle)', () => {
  it('every code-first page source passes the no-JS template validator', () => {
    for (const page of EXAMPLE_PAGES) {
      if (page.source) {
        expect(() => validateTemplate(page.source as string), `page "${page.id}"`).not.toThrow();
      }
    }
  });

  it('every skeleton slot (mainNav, footer) passes the validator', () => {
    expect(EXAMPLE_WEBSITE.mainNav, 'bundle ships a mainNav slot').toBeTruthy();
    expect(EXAMPLE_WEBSITE.footer, 'bundle ships a footer slot').toBeTruthy();
    expect(() => validateTemplate(EXAMPLE_WEBSITE.mainNav!)).not.toThrow();
    expect(() => validateTemplate(EXAMPLE_WEBSITE.footer!)).not.toThrow();
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
    // The untranslated set must not grow: only the pinned known gap may lack a translationGroup.
    expect(EN_PAGES.filter((p) => !p.translationGroup).map((p) => p.id)).toEqual(KNOWN_UNTRANSLATED);
    for (const locale of EXTRA_LOCALES) {
      for (const owner of TRANSLATED_EN_PAGES) {
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
      for (const owner of TRANSLATED_EN_PAGES) {
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

  it('translation-catalog parity: every key carries every extra locale, and every key the slots reference exists', () => {
    // The old per-locale CHROME_STRINGS maps became the single website.translations catalog
    // (key → {locale: value}). Parity now means: every catalog key is translated into every
    // non-default locale. An `en` cell is OPTIONAL for page-scoped keys (the element's inline text
    // is the EN fallback) — the reserved-key guard below pins the EN cells that must exist.
    const keys = Object.keys(CATALOG);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      for (const locale of EXTRA_LOCALES) {
        const v = CATALOG[key]![locale];
        expect(typeof v === 'string' && v !== '' ? 'ok' : `MISSING ${locale} ${key}`, `catalog "${key}" ${locale}`).toBe('ok');
      }
    }
    // The chrome slots localize via the catalog — both the {{sw-translate "key"}} helper form and
    // the inline-editable data-sw-translate="key" directive; every referenced key must resolve.
    const slots = [EXAMPLE_WEBSITE.mainNav, EXAMPLE_WEBSITE.footer].filter(Boolean).join('\n');
    const referenced = [
      ...[...slots.matchAll(/sw-translate "([A-Za-z_][A-Za-z0-9_.]*)"/g)].map((m) => m[1]!),
      ...[...slots.matchAll(/data-sw-translate="([A-Za-z_][A-Za-z0-9_.]*)"/g)].map((m) => m[1]!),
    ];
    expect(referenced.length).toBeGreaterThan(0);
    for (const key of new Set(referenced)) {
      expect(keys.includes(key), `catalog key "${key}"`).toBe(true);
    }
  });

  it('every page data-sw-translate key resolves in the catalog with a translation for each extra locale', () => {
    // Pages bind prominent strings via data-sw-translate="<scope>.<key>" (the inline-editable global
    // catalog). EN is the element's inline fallback; the example is a complete trilingual showcase, so
    // every such key must carry a non-empty cell for every NON-default locale (de/es).
    const sources = EXAMPLE_PAGES.map((p) => effectiveSource(p, true) ?? '').join('\n');
    const keys = new Set([...sources.matchAll(/data-sw-translate="([A-Za-z_][A-Za-z0-9_.]*)"/g)].map((m) => m[1]!));
    expect(keys.size).toBeGreaterThan(0);
    // at least the migrated page scopes are present (sanity that the migration landed)
    for (const k of ['home.headline', 'services.headline', 'about.headline']) expect(keys.has(k), `page binds ${k}`).toBe(true);
    for (const key of keys) {
      const cell = CATALOG[key as keyof typeof CATALOG];
      expect(cell, `data-sw-translate key "${key}" exists in website.translations`).toBeTruthy();
      for (const loc of EXTRA_LOCALES) {
        const v = cell![loc as keyof typeof cell];
        expect(typeof v === 'string' && v !== '', `catalog "${key}" has a ${loc} translation`).toBe(true);
      }
    }
  });

  it('reserved-translation registry ↔ bundle: every reserved key is seeded, and its EN value is the registry default', () => {
    // The RESERVED_TRANSLATION registry (@sitewright/schema) is the single source of truth for the
    // platform's built-in English UI strings (the cart helpers' fallback + the editor ghost rows). The
    // example's EN catalog cells must not drift from it, so a populated example matches what an empty
    // project renders by fallback.
    for (const group of RESERVED_TRANSLATION_GROUPS) {
      for (const { key, default: def } of group.keys) {
        const cell = CATALOG[key];
        expect(cell, `reserved key "${key}" is seeded in the catalog`).toBeDefined();
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

  it('bakes LOCAL flat media URLs into entries + pages — and uses NO remote image hosts', () => {
    // The old assets-map parameterization (examplePages(assets)) is gone — the export bakes the real
    // flat media URLs (/media/<slug>/<shortId>-<file>) in. Asset ids are per-export short ids, so pin
    // the stable FILENAME tail instead of the id.
    const mediaUrl = (name: string): RegExp => new RegExp(`/media/example/[A-Za-z0-9]+-${name}`);
    const entryJson = (id: string): string => JSON.stringify(EXAMPLE_ENTRIES.find((e) => e.id === id));
    expect(entryJson('proj_harbor')).toMatch(mediaUrl('proj-harbor\\.png'));
    expect(entryJson('team_mara')).toMatch(mediaUrl('team-mara\\.png'));
    // The entry id is `team_dev` but its image is the `team-devon` asset — pin that mapping.
    expect(entryJson('team_dev')).toMatch(mediaUrl('team-devon\\.png'));
    expect(entryJson('prod_tee')).toMatch(mediaUrl('prod-tee\\.png'));
    const sources = EXAMPLE_PAGES.map((p) => p.source ?? '').join('\n');
    expect(sources).toMatch(mediaUrl('hero\\.png'));
    expect(sources).toMatch(mediaUrl('studio\\.png'));
    // The German article variants carry the same local cover (page.data flows through too).
    expect(JSON.stringify(EXAMPLE_PAGES.find((p) => p.id === 'blog-static-speed-de')?.data)).toMatch(mediaUrl('blog-speed\\.png'));
    // No remote image hosts anywhere in the seeded demo content — and every media URL stays under
    // this project's own flat /media/<slug>/ namespace.
    const all = [JSON.stringify(EXAMPLE_ENTRIES), JSON.stringify(EXAMPLE_PAGES.map((p) => p.data)), sources].join('\n');
    expect(all).not.toContain('picsum');
    expect(all).not.toMatch(/https?:\/\/[^"']*\.(?:jpg|jpeg|png|webp|gif|avif)/i);
    for (const url of [...all.matchAll(/\/media\/[^"'\\\s)]+/g)].map((m) => m[0])) {
      expect(url.startsWith('/media/example/'), `local media url ${url}`).toBe(true);
    }
  });
});
