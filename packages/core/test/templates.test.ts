import { describe, it, expect } from 'vitest';
import type { Template } from '@sitewright/schema';
import {
  GLOBAL_TEMPLATES,
  GLOBAL_TEMPLATE_PREFIX,
  isGlobalTemplate,
  resolveTemplateSource,
  TemplateResolutionError,
} from '../src/index.js';

const projectTemplates = new Map<string, Template>([
  ['legal', { id: 'legal', name: 'Legal', source: '<article data-sw-text="body">…</article>' }],
]);

describe('resolveTemplateSource (code-first templates)', () => {
  it('resolves a project template to its Handlebars source', () => {
    expect(resolveTemplateSource('legal', projectTemplates)).toContain('data-sw-text="body"');
  });

  it('resolves built-in global templates by prefix', () => {
    for (const template of GLOBAL_TEMPLATES) {
      expect(isGlobalTemplate(template.id)).toBe(true);
      expect(resolveTemplateSource(template.id, new Map())).toBe(template.source);
    }
  });

  it('throws an author-correctable error for unknown references (never a blank page)', () => {
    expect(() => resolveTemplateSource('missing', projectTemplates)).toThrow(TemplateResolutionError);
    expect(() => resolveTemplateSource('global:missing', projectTemplates)).toThrow(TemplateResolutionError);
  });

  it('global templates are valid, content-editable, code-first sources', () => {
    for (const template of GLOBAL_TEMPLATES) {
      expect(template.id.startsWith(GLOBAL_TEMPLATE_PREFIX)).toBe(true);
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.source).toContain('data-sw-'); // content-editable via data-sw-* leaf directives
      expect(template.source).not.toContain('{{edit'); // the legacy {{edit}} helper is retired
      expect(template.source).not.toContain('<script'); // same no-JS rule as page sources
    }
  });

  it('ships the content-only blog templates with declared default page.data', () => {
    const article = GLOBAL_TEMPLATES.find((t) => t.id === 'global:blog-article');
    const overview = GLOBAL_TEMPLATES.find((t) => t.id === 'global:blog-overview');
    expect(article).toBeDefined();
    expect(overview).toBeDefined();
    // The article binds its fields to page.data via data-sw-*; its defaults declare those keys.
    expect(article!.source).toContain('data-sw-text="page.data.article_title"');
    expect(article!.source).toContain('data-sw-html="page.data.article_body"');
    expect(Object.keys(article!.data as object)).toEqual(
      expect.arrayContaining(['article_title', 'article_excerpt', 'article_image', 'article_body']),
    );
    // The overview lists child pages and reads each child's flattened fields + data.
    expect(overview!.source).toContain('{{#each page.children}}');
    expect(overview!.source).toContain('href="{{sw-url path}}"');
    // Excerpts are clipped and an (optional) article_date renders via sw-date.
    expect(overview!.source).toContain('{{sw-truncate data.article_excerpt 120}}');
    expect(overview!.source).toContain('{{#if data.article_date}}');
    expect(overview!.source).toContain('{{sw-date data.article_date}}');
  });

  it('ships the MINI SHOP storefront template (product grid + add-to-cart + cart mount)', () => {
    const shop = GLOBAL_TEMPLATES.find((t) => t.id === 'global:shop');
    expect(shop).toBeDefined();
    // Loops the products dataset and emits a first-party add-to-cart button + the cart mount.
    expect(shop!.source).toContain('{{#each dataset.products}}');
    expect(shop!.source).toContain('{{sw-add-to-cart');
    // The cart mount is bare — its drawer strings + the add-to-cart label auto-localize from the
    // translation catalog (reserved cart_* keys), so a locale variant needs no per-page hash wiring.
    expect(shop!.source).toContain('{{sw-cart}}');
    // The currency symbol is translatable (catalog), NOT the removed website.shop.currency.symbol field.
    expect(shop!.source).toContain('{{sw-translate "cart_currency_symbol" default="$"}}');
    expect(shop!.source).not.toContain('currency.symbol');
    // The editable headings are page.data leaves with declared defaults.
    expect(shop!.source).toContain('data-sw-text="page.data.heading"');
    expect(Object.keys(shop!.data as object)).toEqual(expect.arrayContaining(['heading', 'intro']));
  });
});
