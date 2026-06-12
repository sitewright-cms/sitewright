import type { Dataset } from '@sitewright/schema';

// ---------------------------------------------------------------- datasets (the CMS)
export const EXAMPLE_DATASETS: Dataset[] = [
  {
    id: 'services',
    name: 'Services',
    slug: 'services',
    fields: [
      { name: 'icon', type: 'text', required: false, localized: false },
      { name: 'title', type: 'text', required: true, localized: false },
      { name: 'summary', type: 'text', required: false, localized: false },
      { name: 'price', type: 'text', required: false, localized: false },
    ],
  },
  {
    // German variant of `services` (auto-resolved for locale "de" pages via the
    // `<slug>-<locale>` convention — see docs/i18n-content-model.md).
    id: 'services-de',
    name: 'Leistungen (DE)',
    slug: 'services-de',
    fields: [
      { name: 'icon', type: 'text', required: false, localized: false },
      { name: 'title', type: 'text', required: true, localized: false },
      { name: 'summary', type: 'text', required: false, localized: false },
      { name: 'price', type: 'text', required: false, localized: false },
    ],
  },
  {
    id: 'projects',
    name: 'Work',
    slug: 'projects',
    fields: [
      { name: 'title', type: 'text', required: true, localized: false },
      { name: 'client', type: 'text', required: false, localized: false },
      { name: 'category', type: 'text', required: false, localized: false },
      { name: 'summary', type: 'text', required: false, localized: false },
      { name: 'image', type: 'image', required: false, localized: false },
      { name: 'year', type: 'text', required: false, localized: false },
    ],
  },
  {
    id: 'team',
    name: 'Team',
    slug: 'team',
    fields: [
      { name: 'name', type: 'text', required: true, localized: false },
      { name: 'role', type: 'text', required: false, localized: false },
      { name: 'photo', type: 'image', required: false, localized: false },
      { name: 'bio', type: 'text', required: false, localized: false },
    ],
  },
  {
    id: 'testimonials',
    name: 'Testimonials',
    slug: 'testimonials',
    fields: [
      { name: 'quote', type: 'text', required: true, localized: false },
      { name: 'author', type: 'text', required: false, localized: false },
      { name: 'role', type: 'text', required: false, localized: false },
    ],
  },
  {
    // MINI SHOP catalogue — products the front-end cart adds by `sku`. `price` is a number; the
    // cart formats it with the currency in website.shop (display-only, non-authoritative).
    id: 'products',
    name: 'Products',
    slug: 'products',
    fields: [
      { name: 'sku', type: 'text', required: false, localized: false },
      { name: 'name', type: 'text', required: true, localized: false },
      { name: 'price', type: 'number', required: false, localized: false },
      { name: 'image', type: 'image', required: false, localized: false },
      { name: 'description', type: 'text', required: false, localized: false },
    ],
  },
];
