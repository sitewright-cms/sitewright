import { describe, it, expect } from 'vitest';
import { renderTemplate } from '@sitewright/blocks';
import { GLOBAL_SNIPPETS, GLOBAL_SNIPPET_PARTIALS, GLOBAL_SNIPPET_CATALOG } from '@sitewright/core';

// Renders each REFERENCE COOKBOOK recipe through the REAL template engine with a representative
// context and asserts the structural outcome (component markers, loop counts, resolved directives).
// This is the render-level companion to global-snippets.test.ts (which validates every source).
const src = (name: string): string => {
  const s = GLOBAL_SNIPPET_PARTIALS[name];
  if (!s) throw new Error(`no global snippet "${name}"`);
  return s;
};
const slideCount = (html: string): number => (html.match(/data-sw-part="slide"/g) ?? []).length;

describe('reference cookbook — catalog shape', () => {
  it('ships the new reference recipes and has retired the trivial marketing sections', () => {
    const names = new Set(GLOBAL_SNIPPETS.map((s) => s.name));
    for (const want of [
      'slider-fullscreen', 'slider-cards', 'slider-multi', 'slider-logowall', 'slider-dataset',
      'gallery-grid', 'gallery-masonry', 'gallery-dataset', 'tabs-mixed', 'tabs-dataset', 'modal-basic', 'modal-confirm',
      'form-embed', 'form-custom', 'datetimepicker-field', 'cookie-consent', 'shop-product', 'parallax-hero', 'shader-hero',
      'dataset-grid', 'folder-gallery', 'i18n', 'page-vars',
      'nav-header', 'nav-footer', 'navbar', 'logo-marquee', 'rotating-tiles',
    ]) {
      expect(names.has(want), `expected recipe "${want}"`).toBe(true);
    }
    for (const gone of ['hero', 'cta', 'features', 'pricing', 'footer']) {
      expect(names.has(gone), `"${gone}" should be retired`).toBe(false);
    }
  });

  it('every recipe carries grouping metadata (category + description)', () => {
    const categories = new Set(['slider', 'gallery', 'tabs', 'modal', 'forms', 'shop', 'data', 'chrome', 'effects']);
    for (const s of GLOBAL_SNIPPETS) {
      expect(categories.has(s.category), `recipe "${s.name}" category`).toBe(true);
      expect(s.description.length, `recipe "${s.name}" description`).toBeGreaterThan(10);
    }
  });

  it('GLOBAL_SNIPPET_CATALOG mirrors the snippets without leaking source', () => {
    expect(GLOBAL_SNIPPET_CATALOG.map((m) => m.name).sort()).toEqual(GLOBAL_SNIPPETS.map((s) => s.name).sort());
    for (const m of GLOBAL_SNIPPET_CATALOG) expect('source' in m).toBe(false);
  });
});

describe('reference cookbook — slider recipes render', () => {
  it('slider-fullscreen: 2 full-screen slides, Ken Burns, default captions kept (markers stripped on publish)', () => {
    const html = renderTemplate(src('slider-fullscreen'), {});
    expect(html).toContain('data-sw-component="carousel"');
    expect(html).toContain('data-kenburns');
    expect(html).toContain('h-[80vh]');
    expect(slideCount(html)).toBe(2);
    expect(html).toContain('Craft that ships');
    expect(html).toContain('Built to last');
    expect(html).toContain('sw-kenburns'); // the cover layer survives
    expect(html).not.toContain('data-sw-text='); // publish render strips the editable markers
  });

  it('slider-cards: 3 single content cards with slide effect + dots', () => {
    const html = renderTemplate(src('slider-cards'), {});
    expect(html).toContain('data-effect="slide"');
    expect(slideCount(html)).toBe(3);
    expect(html).toContain('data-sw-part="dots"');
  });

  it('slider-multi: 4 cards with a fractional --sw-items peek', () => {
    const html = renderTemplate(src('slider-multi'), {});
    expect(html).toContain('[--sw-items:1.15]');
    expect(slideCount(html)).toBe(4);
  });

  it('slider-logowall: an auto-scroll ticker of rendered brand glyphs', () => {
    const html = renderTemplate(src('slider-logowall'), {});
    expect(html).toContain('data-autoscroll="true"');
    expect(slideCount(html)).toBe(8);
    expect(html).toContain('<svg'); // {{sw-icon "brand:react"}} resolved to an inline SVG
  });

  it('slider-dataset: one slide per dataset entry, with an empty-state fallback', () => {
    const bound = renderTemplate(src('slider-dataset'), {
      dataset: { projects: [
        { image: '/media/a.jpg', title: 'Alpha', category: 'Web' },
        { image: '/media/b.jpg', title: 'Beta', category: 'Brand' },
      ] },
    });
    expect(slideCount(bound)).toBe(2);
    expect(bound).toContain('Alpha');
    expect(bound).toContain('src="/media/a.jpg"');

    const empty = renderTemplate(src('slider-dataset'), { dataset: { projects: [] } });
    expect(empty).toContain('data-sw-component="carousel"');
    expect(empty).toContain('Add entries to the'); // {{else}} placeholder
  });
});

describe('reference cookbook — primitives sampler render', () => {
  it('dataset-grid: loops a dataset into cards (sw-date / sw-truncate / @first)', () => {
    const html = renderTemplate(src('dataset-grid'), {
      dataset: { posts: [
        { title: 'First post', summary: 'x'.repeat(200), date: '2026-01-15', image: '/i/1.jpg', url: '/blog/1' },
        { title: 'Second post', summary: 'short', date: '2026-02-20', image: '/i/2.jpg', url: '/blog/2' },
      ] },
    });
    expect((html.match(/<article/g) ?? []).length).toBe(2);
    expect(html).toContain('First post');
    expect(html).toContain('2026-01-15'); // sw-date
    expect(html).toContain('…'); // sw-truncate ellipsis on the 200-char summary
    expect(html).toContain('sm:col-span-2'); // @first card spans wider

    const empty = renderTemplate(src('dataset-grid'), { dataset: { posts: [] } });
    expect(empty).toContain('Add entries to the');
  });

  it('folder-gallery: empty media folder routes to the {{else}} placeholder', () => {
    const html = renderTemplate(src('folder-gallery'), { media: [] });
    expect(html).toContain('Upload images to the');
  });

  it('i18n: resolves the catalog (sw-translate + data-sw-translate) and the flag switcher', () => {
    const t = { 'home.headline': 'Hallo', 'home.lead': 'Aus dem Katalog' };
    const html = renderTemplate(src('i18n'), {
      website: { t }, // data-sw-translate + {{sw-translate}} both read website.t
      page: { translations: [ { locale: 'de', path: '/de' }, { locale: 'fr', path: '/fr' } ] },
    });
    expect(html).toContain('Hallo'); // data-sw-translate replaced the default heading
    expect(html).toContain('Aus dem Katalog'); // {{sw-translate}}
    expect(html).toContain('href="/de"');
    expect(html).toContain('href="/fr"');
    expect(html).toContain('<svg'); // {{sw-flag}} rendered

    const noTr = renderTemplate(src('i18n'), {});
    expect(noTr).not.toContain('aria-label="Languages"'); // switcher hidden without page.translations
  });

  it('page-vars: binds page.data (text/html/src/bg), lists children, shows the parent', () => {
    const html = renderTemplate(src('page-vars'), {
      page: { data: { headline: 'My Section', intro: '<p>Intro HTML</p>', cover: '/cover.jpg', cover_image: '/ci.jpg' },
        children: [ { title: 'Child A', path: '/a', description: 'DA' }, { title: 'Child B', path: '/b', description: 'DB' } ] },
      parentPage: { title: 'Parent page', path: '/parent' },
    });
    expect(html).toContain('My Section'); // data-sw-text on page.data.headline
    expect(html).toContain('Intro HTML'); // data-sw-html on page.data.intro
    expect(html).toContain('/cover.jpg'); // data-sw-bg
    expect(html).toContain('/ci.jpg'); // data-sw-src
    expect(html).toContain('Child A');
    expect(html).toContain('Child B');
    expect(html).toContain('Parent page'); // page.parent breadcrumb
  });
});

describe('reference cookbook — gallery / tabs / modal recipes render', () => {
  const itemCount = (html: string, sel: RegExp): number => (html.match(sel) ?? []).length;

  it('gallery-grid: a lightbox grid with one item per folder image (else placeholder when empty)', () => {
    const media = [
      { url: '/media/g/1.jpg', filename: '1.jpg', kind: 'image' as const, folder: 'Gallery', alt: 'One' },
      { url: '/media/g/2.jpg', filename: '2.jpg', kind: 'image' as const, folder: 'Gallery', alt: 'Two' },
    ];
    const html = renderTemplate(src('gallery-grid'), { media });
    expect(html).toContain('data-sw-component="lightbox"');
    expect(html).toContain('data-sw-part="grid"'); // the EXPLICIT styled-grid form (its flagship value)
    expect(itemCount(html, /data-sw-part="item"/g)).toBe(2);
    expect(html).toContain('href="/media/g/1.jpg"');
    expect(html).toContain('data-caption="One"');
    expect(renderTemplate(src('gallery-grid'), { media: [] })).toContain('Upload images to the');
  });

  it('gallery-masonry: a columns lightbox with width/height from folder items (no-crop)', () => {
    const media = [
      { url: '/m/1.jpg', filename: '1.jpg', kind: 'image' as const, folder: 'Gallery', alt: 'One', width: 800, height: 600 },
      { url: '/m/2.jpg', filename: '2.jpg', kind: 'image' as const, folder: 'Gallery', alt: 'Two', width: 600, height: 900 },
    ];
    const html = renderTemplate(src('gallery-masonry'), { media });
    expect(html).toContain('columns-2'); // the masonry layout
    expect(itemCount(html, /<a href="\/m\//g)).toBe(2);
    expect(html).toContain('data-caption="One"');
    expect(html).toContain('width="800"'); // item width/height reserve space (no layout shift)
    expect(html).toContain('height="900"');
    expect(renderTemplate(src('gallery-masonry'), { media: [] })).toContain('Upload images to the');
  });

  it('gallery-dataset: a lightbox tile per dataset entry, with the bound image + caption', () => {
    const html = renderTemplate(src('gallery-dataset'), {
      dataset: { portfolio: [ { image: '/p/a.jpg', title: 'Alpha' }, { image: '/p/b.jpg', title: 'Beta' } ] },
    });
    expect(html).toContain('data-sw-component="lightbox"');
    // MINIMAL form (no data-sw-part) — items are plain <a href><img>, so we count the anchors.
    expect(itemCount(html, /<a href="\/p\//g)).toBe(2);
    expect(html).toContain('data-caption="Alpha"');
    expect(renderTemplate(src('gallery-dataset'), { dataset: { portfolio: [] } })).toContain('Add entries to the');
  });

  it('tabs-mixed: a tabs component with 3 panels and a rich tabtitle on the first', () => {
    const html = renderTemplate(src('tabs-mixed'), {});
    expect(html).toContain('data-sw-component="tabs"');
    expect(itemCount(html, /data-sw-part="panel"/g)).toBe(3);
    expect(html).toContain('data-sw-part="tabtitle"');
    expect(html).toContain('data-sw-title="Overview"'); // accessible name kept alongside the rich label
    expect(html).toContain('<svg'); // {{sw-icon "sparkles"}} in the rich label
  });

  it('tabs-dataset: one panel per dataset entry with the label interpolated from a field', () => {
    const html = renderTemplate(src('tabs-dataset'), {
      dataset: { faqs: [ { question: 'How long?', answer: 'Weeks.' }, { question: 'How much?', answer: 'Depends.' } ] },
    });
    expect(itemCount(html, /data-sw-part="panel"/g)).toBe(2);
    expect(html).toContain('data-sw-title="How long?"');
    expect(html).toContain('Depends.');
    // Empty dataset → the {{else}} fallback panel keeps the tabs component non-empty.
    const empty = renderTemplate(src('tabs-dataset'), { dataset: { faqs: [] } });
    expect(itemCount(empty, /data-sw-part="panel"/g)).toBe(1);
  });

  it('modal-basic: a link trigger + a native <dialog> modal with editable title/body', () => {
    const html = renderTemplate(src('modal-basic'), {});
    expect(html).toContain('href="#how-it-works"');
    expect(html).toMatch(/<dialog id="how-it-works"[^>]*data-sw-component="modal"/);
    expect(html).toContain('How it works'); // data-sw-text default kept (publish)
  });

  it('modal-confirm: a button trigger opens a forced-choice dialog (backdrop close off)', () => {
    const html = renderTemplate(src('modal-confirm'), {});
    expect(html).toContain('data-sw-modal="confirm-delete"');
    expect(html).toContain('data-backdrop-close="false"');
    expect(html).toContain('data-sw-part="close"');
  });
});

describe('reference cookbook — forms / inputs / shop / effects recipes render', () => {
  it('form-embed: renders the section; {{sw-form}} is empty in preview (no forms map), never throws', () => {
    const html = renderTemplate(src('form-embed'), {});
    expect(html).toContain('Get in touch'); // the surrounding section renders
    expect(html).not.toContain('<form'); // {{sw-form}} → '' with no forms map (safe preview)
  });

  it('form-custom: a hand-authored <form data-sw-form> with the custom fields (graceful with no forms map)', () => {
    const html = renderTemplate(src('form-custom'), {});
    expect(html).toMatch(/<form[^>]*data-sw-form="contact"/);
    expect(html).toContain('name="email"');
    expect(html).toContain('name="message"');
    expect(html).not.toContain('data-sw-endpoint'); // no forms map → the embed pass is a no-op (no throw)
  });

  it('form-custom: throws at render when a forms map is present but "contact" is unknown (documented footgun)', () => {
    // A project that already has OTHER forms (so a forms map is present) but not "contact".
    const ctx = { forms: { other: {} } } as unknown as Parameters<typeof renderTemplate>[1];
    expect(() => renderTemplate(src('form-custom'), ctx)).toThrow(/unknown form/i);
  });

  it('datetimepicker-field: a text input upgraded to a range picker', () => {
    const html = renderTemplate(src('datetimepicker-field'), {});
    expect(html).toContain('data-sw-component="datetimepicker"');
    expect(html).toContain('data-mode="range"');
    expect(html).toContain('name="stay"');
  });

  it('cookie-consent: a hidden consent banner with an accept part', () => {
    const html = renderTemplate(src('cookie-consent'), {});
    expect(html).toContain('data-sw-component="cookie-consent"');
    expect(html).toMatch(/\bhidden\b/); // ships hidden (the runtime reveals it only until accepted)
    expect(html).toContain('data-sw-part="accept"');
  });

  it('shop-product: the cart helpers are gated — empty when the shop is off, present when enabled', () => {
    const off = renderTemplate(src('shop-product'), {});
    expect(off).toContain('Studio mug'); // the card renders regardless
    expect(off).not.toContain('data-sw-cart'); // both {{sw-add-to-cart}} and {{sw-cart}} → '' when shop off

    const on = renderTemplate(src('shop-product'), { website: { shop: { enabled: true } } });
    expect(on).toContain('data-sw-cart-add'); // the add-to-cart button
    expect(on).toMatch(/data-sw-cart[ >"]/); // the {{sw-cart}} mount (distinct from data-sw-cart-add)
  });

  it('parallax-hero: a clipping scene with stacked, independently-moving layers', () => {
    const html = renderTemplate(src('parallax-hero'), {});
    expect(html).toContain('data-sw-parallax-scene');
    expect(html).toContain('data-sw-parallax-layer');
    expect(html).toContain('data-sw-parallax-translate="70,-70"');
  });

  it('shader-hero: a shader-bg section with a preset and an overlay scrim', () => {
    const html = renderTemplate(src('shader-hero'), {});
    expect(html).toContain('data-sw-component="shader-bg"');
    expect(html).toContain('data-preset="mesh-gradient"');
    expect(html).toContain('data-sw-part="overlay"');
  });
});

describe('reference cookbook — navigation recipes render', () => {
  // A representative data-driven nav context: a dropdown parent, a flat page, translations + themes on.
  const navCtx = (over: Record<string, unknown> = {}) => ({
    nav: {
      header: [
        { label: 'Home', path: '/' },
        { label: 'Services', path: '/services', children: [ { label: 'Web', path: '/services/web' }, { label: 'SEO', path: '/services/seo' } ] },
        { label: 'Contact', path: '/contact' },
      ],
      footer: [ { label: 'Privacy', path: '/privacy' }, { label: 'Terms', path: '/terms' } ],
      mobile: [] as Array<Record<string, unknown>>,
    },
    page: { path: '/services/web', locale: 'en', translations: [ { locale: 'de', path: '/de/services/web' }, { locale: 'es', path: '/es/services/web' } ] },
    company: { name: 'Acme', social: [ { link: 'https://x.com/acme', name: 'X', icon: 'brand:x' } ] },
    website: { enableThemes: true, data: { locale_flags: { en: 'gb', de: 'de', es: 'es' } } },
    ...over,
  });

  it('nav-header: desktop hover-dropdown + the pure-CSS mobile drawer (peer-checkbox + accordion)', () => {
    const html = renderTemplate(src('nav-header'), navCtx());
    expect(html).toContain('dropdown dropdown-hover'); // Services (has children) → desktop hover dropdown
    expect(html).toContain('id="sw-nav-drawer"'); // the peer-checkbox toggle
    expect(html).toContain('peer-checked:translate-x-0'); // the slide-in panel
    expect(html).toContain('<details>'); // child pages → accordion in the drawer
    expect(html).toContain('aria-label="Close"'); // the drawer close button
    expect(html).toContain('Services');
    expect(html).toContain('href="/services/web"'); // a child link
  });

  it('nav-header: the mobile drawer loops nav.mobile, falling back to nav.header when empty', () => {
    // Curated mobile menu → only those items appear in the drawer.
    const curated = renderTemplate(src('nav-header'), navCtx({
      nav: { header: [ { label: 'Home', path: '/' } ], footer: [], mobile: [ { label: 'Shop', path: '/shop' } ] },
    }));
    const drawer = curated.slice(curated.indexOf('peer-checked:translate-x-0'));
    expect(drawer).toContain('/shop'); // from nav.mobile
    // Empty nav.mobile (the default navCtx) → the drawer mirrors nav.header.
    const fallback = renderTemplate(src('nav-header'), navCtx());
    const fbDrawer = fallback.slice(fallback.indexOf('peer-checked:translate-x-0'));
    expect(fbDrawer).toContain('/contact'); // a nav.header item shows in the drawer via the fallback
  });

  it('nav-header: language dropdown is gated on page.translations; theme toggle on website.enableThemes', () => {
    const on = renderTemplate(src('nav-header'), navCtx());
    expect(on).toContain('hreflang="de"'); // the language switcher
    expect(on).toContain('hreflang="es"');
    expect(on).toContain('<svg'); // {{sw-flag}} rendered (locale_flags maps en→gb etc.)
    expect(on).toContain('data-sw-theme-toggle'); // {{sw-theme-toggle}} present (themes on)

    const off = renderTemplate(src('nav-header'), navCtx({ page: { path: '/', locale: 'en' }, website: { enableThemes: false } }));
    expect(off).not.toContain('hreflang='); // no translations → no language switcher
    expect(off).not.toContain('data-sw-theme-toggle'); // themes off → no toggle
  });

  it('nav-footer: data-driven columns (nav.header / nav.footer) + social icons', () => {
    const html = renderTemplate(src('nav-footer'), navCtx());
    expect(html).toContain('Services'); // Menu column from nav.header
    expect(html).toContain('Privacy'); // Legal column from nav.footer
    expect(html).toContain('href="https://x.com/acme"'); // a social link
    expect(html).toContain('<svg'); // the brand social icon
  });

  it('navbar: data-driven (loops nav.header, no hardcoded links)', () => {
    const html = renderTemplate(src('navbar'), navCtx());
    expect(html).toContain('dropdown dropdown-hover'); // Services dropdown
    expect(html).toContain('Contact');
    expect(html).not.toContain('/features'); // the old hardcoded link is gone
  });
});
