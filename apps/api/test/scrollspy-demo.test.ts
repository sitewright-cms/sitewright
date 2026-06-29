import { describe, it, expect } from 'vitest';
import { validateTemplate, findSkeletonLandmark } from '@sitewright/blocks';
import {
  SCROLLSPY_DEMO_WEBSITE,
  SCROLLSPY_DEMO_SETTINGS,
  scrollspyDemoPages,
} from '../src/seed/scrollspy-demo.js';

describe('ScrollSpy Demo seed project', () => {
  it('chrome slots carry no skeleton landmark (<nav>/<footer>/…) — the platform owns those', () => {
    // Guards the live-save validation (app.ts CHROME_HTML_SLOTS) that contentRepo.put alone does not run.
    expect(findSkeletonLandmark(SCROLLSPY_DEMO_WEBSITE.mainNav ?? '')).toBeNull();
    expect(findSkeletonLandmark(SCROLLSPY_DEMO_WEBSITE.footer ?? '')).toBeNull();
  });

  it('every page source passes the no-JS template validator', () => {
    for (const page of scrollspyDemoPages()) {
      expect(() => validateTemplate(page.source as string), `page "${page.id}"`).not.toThrow();
    }
    expect(() => validateTemplate(SCROLLSPY_DEMO_WEBSITE.mainNav ?? '')).not.toThrow();
    expect(() => validateTemplate(SCROLLSPY_DEMO_WEBSITE.footer ?? '')).not.toThrow();
  });

  it('turns ScrollSpy on site-wide and pairs it with a visible active style', () => {
    expect(SCROLLSPY_DEMO_WEBSITE.effects?.scrollSpy).toBe(true);
    // a nav effect so the toggled .active is visibly styled
    expect(SCROLLSPY_DEMO_WEBSITE.effects?.navEffect).toBeTruthy();
    expect(SCROLLSPY_DEMO_WEBSITE.effects?.navEffect).not.toBe('none');
  });

  it('the main nav MIXES in-page section anchors with a real route link', () => {
    const nav = SCROLLSPY_DEMO_WEBSITE.mainNav ?? '';
    expect(nav).toContain('href="/#features"'); // path-prefixed in-page anchor
    expect(nav).toContain('href="/docs"'); // a real route link (dormant on the docs page)
  });

  it('is a single-locale project with a home + docs page, docs carrying a per-element scrollspy nav', () => {
    expect(SCROLLSPY_DEMO_SETTINGS.locales).toEqual(['en']);
    const pages = scrollspyDemoPages();
    expect(pages.map((p) => p.id).sort()).toEqual(['docs', 'home']);
    const home = pages.find((p) => p.id === 'home')!;
    const docs = pages.find((p) => p.id === 'docs')!;
    // home one-pager has the sections its nav anchors target
    for (const id of ['features', 'pricing', 'faq']) expect(home.source).toContain(`id="${id}"`);
    // docs page drives its OWN table of contents — every TOC anchor must map to a real section id
    expect(docs.source).toContain('data-sw-scrollspy');
    for (const id of ['install', 'usage', 'anchors', 'api']) expect(docs.source).toContain(`id="${id}"`);
  });
});
