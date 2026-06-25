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
      'recipe-dataset-grid', 'recipe-folder-gallery', 'recipe-i18n', 'recipe-page-vars',
      'navbar', 'logo-marquee', 'rotating-tiles',
    ]) {
      expect(names.has(want), `expected recipe "${want}"`).toBe(true);
    }
    for (const gone of ['hero', 'cta', 'features', 'pricing', 'footer']) {
      expect(names.has(gone), `"${gone}" should be retired`).toBe(false);
    }
  });

  it('every recipe carries grouping metadata (category + description)', () => {
    const categories = new Set(['slider', 'data', 'chrome', 'effects']);
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
  it('recipe-dataset-grid: loops a dataset into cards (sw-date / sw-truncate / @first)', () => {
    const html = renderTemplate(src('recipe-dataset-grid'), {
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

    const empty = renderTemplate(src('recipe-dataset-grid'), { dataset: { posts: [] } });
    expect(empty).toContain('Add entries to the');
  });

  it('recipe-folder-gallery: empty media folder routes to the {{else}} placeholder', () => {
    const html = renderTemplate(src('recipe-folder-gallery'), { media: [] });
    expect(html).toContain('Upload images to the');
  });

  it('recipe-i18n: resolves the catalog (sw-translate + data-sw-translate) and the flag switcher', () => {
    const t = { 'home.headline': 'Hallo', 'home.lead': 'Aus dem Katalog' };
    const html = renderTemplate(src('recipe-i18n'), {
      website: { t }, // data-sw-translate + {{sw-translate}} both read website.t
      page: { translations: [ { locale: 'de', path: '/de' }, { locale: 'fr', path: '/fr' } ] },
    });
    expect(html).toContain('Hallo'); // data-sw-translate replaced the default heading
    expect(html).toContain('Aus dem Katalog'); // {{sw-translate}}
    expect(html).toContain('href="/de"');
    expect(html).toContain('href="/fr"');
    expect(html).toContain('<svg'); // {{sw-flag}} rendered

    const noTr = renderTemplate(src('recipe-i18n'), {});
    expect(noTr).not.toContain('aria-label="Languages"'); // switcher hidden without page.translations
  });

  it('recipe-page-vars: binds page.data (text/html/src/bg), lists children, shows the parent', () => {
    const html = renderTemplate(src('recipe-page-vars'), {
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
