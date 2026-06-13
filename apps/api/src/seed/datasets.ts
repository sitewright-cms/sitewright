import type { Dataset, Field } from '@sitewright/schema';
import { WIDGET_MANIFESTS } from '@sitewright/core';

// ---------------------------------------------------------------- datasets (the CMS)
//
// Every translatable dataset is declared ONCE and emitted per locale via the platform's
// `<slug>-<locale>` convention: a `de` page binding `{{#each data.services}}` auto-resolves to
// `services-de` (resolveLocaleDatasets in @sitewright/core). The default-locale dataset keeps the
// bare slug. `reference` fields point at the SAME-locale twin of their target (e.g. `roles-de`
// managers reference `team-de` entry ids), so keyed `{{item.team.<id>.…}}` lookups resolve
// within the locale.

/** The locales the example ships datasets/entries/forms/translations for (en = default). */
export const EXAMPLE_CONTENT_LOCALES = ['en', 'de', 'es'] as const;
/** The non-default locales (every localized artifact gets a `-<locale>` twin per entry here). */
export const EXAMPLE_EXTRA_LOCALES: readonly string[] = EXAMPLE_CONTENT_LOCALES.slice(1);

interface DatasetSpec {
  id: string;
  /** Editor-facing name per locale (the suffix tells locales apart in the datasets panel). */
  name: Record<string, string>;
  fields: Field[];
  /** Field names whose `config.targetDataset` must be locale-suffixed in each variant. */
  referenceFields?: string[];
}

const text = (name: string, required = false): Field => ({ name, type: 'text', required, localized: false });

const SPECS: DatasetSpec[] = [
  {
    id: 'services',
    name: { en: 'Services', de: 'Leistungen (DE)' },
    // `icon` is a Lucide icon NAME (rendered via {{sw-icon icon}}), not an emoji glyph.
    fields: [text('icon'), text('title', true), text('summary'), text('price')],
  },
  {
    id: 'projects',
    name: { en: 'Work', de: 'Arbeiten (DE)' },
    fields: [text('title', true), text('client'), text('category'), text('summary'), { name: 'image', type: 'image', required: false, localized: false }, text('year')],
  },
  {
    id: 'team',
    name: { en: 'Team', de: 'Team (DE)' },
    fields: [text('name', true), text('role'), { name: 'photo', type: 'image', required: false, localized: false }, text('bio')],
  },
  {
    id: 'testimonials',
    name: { en: 'Testimonials', de: 'Stimmen (DE)' },
    fields: [text('quote', true), text('author'), text('role')],
  },
  {
    id: 'products',
    name: { en: 'Products', de: 'Produkte (DE)' },
    fields: [text('sku', true), text('name', true), { name: 'price', type: 'number', required: true, localized: false }, { name: 'image', type: 'image', required: false, localized: false }, text('description')],
  },
  {
    // FAQ — richtext answers (the one HTML sink, sanitized at render) for the Accordion page.
    id: 'faq',
    name: { en: 'FAQ', de: 'FAQ (DE)' },
    fields: [text('question', true), { name: 'answer', type: 'richtext', required: true, localized: false }],
  },
  {
    // Pricing plans — number price, booleans (monthly/featured drive the Tabs panels + the
    // highlight ring), and a `features` JSON array looped with a nested {{#each}}.
    id: 'plans',
    name: { en: 'Plans', de: 'Pakete (DE)' },
    fields: [
      text('name', true),
      { name: 'price', type: 'number', required: true, localized: false },
      // The locale-formatted price STRING the pricing cards display ('$4,800' / '4.800 $') —
      // `price` stays the raw number (the number-field demo; machine-readable for sorting).
      text('display'),
      text('period'),
      { name: 'monthly', type: 'boolean', required: false, localized: false },
      { name: 'featured', type: 'boolean', required: false, localized: false },
      text('blurb'),
      { name: 'features', type: 'json', required: false, localized: false },
    ],
  },
  {
    // Open roles — select (department), boolean (remote), date (posted, via {{sw-date}}),
    // richtext description, and a reference to the hiring manager's team entry.
    id: 'roles',
    name: { en: 'Open roles', de: 'Offene Stellen (DE)' },
    fields: [
      text('title', true),
      { name: 'dept', type: 'select', required: true, localized: false, config: { options: ['Design', 'Engineering', 'Strategy', 'Operations'] } },
      text('location'),
      { name: 'remote', type: 'boolean', required: false, localized: false },
      { name: 'posted', type: 'date', required: false, localized: false },
      { name: 'description', type: 'richtext', required: true, localized: false },
      { name: 'manager', type: 'reference', required: false, localized: false, config: { targetDataset: 'team' } },
    ],
    referenceFields: ['manager'],
  },
];

/** One spec → the base dataset + its `-<locale>` twins (schema declared once, emitted per locale). */
function emit(spec: DatasetSpec): Dataset[] {
  return EXAMPLE_CONTENT_LOCALES.map((locale) => {
    const suffix = locale === 'en' ? '' : `-${locale}`;
    const fields = spec.fields.map((f) =>
      spec.referenceFields?.includes(f.name)
        ? { ...f, config: { ...f.config, targetDataset: `${(f.config as { targetDataset: string }).targetDataset}${suffix}` } }
        : f,
    );
    return { id: `${spec.id}${suffix}`, name: spec.name[locale] ?? spec.id, slug: `${spec.id}${suffix}`, fields };
  });
}

// The hero-slider WIDGET's config dataset, seeded directly from its manifest so the example mirrors
// exactly what real save-time provisioning creates. NON-localized + no `-<locale>` twins: the bare
// `hero` slug serves every locale via resolveLocaleDatasets' bare-slug fallback (the slides/settings
// are shared, not translated). This dogfoods the nested list/object field types end-to-end.
const heroSpec = WIDGET_MANIFESTS['hero-slider']?.datasets[0];
if (!heroSpec) throw new Error('seed: the hero-slider widget manifest is missing its config dataset');
const HERO_DATASET: Dataset = { id: heroSpec.slug, name: heroSpec.name, slug: heroSpec.slug, fields: heroSpec.fields };

export const EXAMPLE_DATASETS: Dataset[] = [...SPECS.flatMap(emit), HERO_DATASET];
