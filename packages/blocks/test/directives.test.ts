import { describe, it, expect } from 'vitest';
import { resolveDirectives } from '../src/directives.js';
import { renderTemplate } from '../src/template.js';

describe('resolveDirectives — data-sw-text', () => {
  it('is a no-op when no directive is present (byte-identical)', () => {
    const html = '<div class="x"><h1>Hi &amp; bye</h1><img src="/a.jpg"></div>';
    expect(resolveDirectives(html, { preview: true })).toBe(html);
  });

  it('binds content to textContent, escaping any markup in the value', () => {
    const html = '<h1 data-sw-text="t">Welcome</h1>';
    const out = resolveDirectives(html, { content: { t: '<b>x</b> & <script>y' }, preview: true });
    expect(out).toContain('data-sw-text="t"');
    expect(out).not.toContain('<b>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;b&gt;');
    expect(out).toContain('&amp;');
  });

  it('keeps the authored default when the key is unset', () => {
    expect(resolveDirectives('<h1 data-sw-text="t">Default</h1>', { preview: true })).toBe(
      '<h1 data-sw-text="t">Default</h1>',
    );
  });

  it('keeps the marker in preview, strips it on publish', () => {
    const html = '<h1 data-sw-text="t">Welcome</h1>';
    expect(resolveDirectives(html, { content: { t: 'Hi' }, preview: true })).toBe('<h1 data-sw-text="t">Hi</h1>');
    expect(resolveDirectives(html, { content: { t: 'Hi' } })).toBe('<h1>Hi</h1>');
  });

  it('ignores prototype-pollution keys', () => {
    const html = '<h1 data-sw-text="__proto__">Default</h1>';
    const out = resolveDirectives(html, { content: { __proto__: 'evil' } as Record<string, string>, preview: true });
    expect(out).toContain('Default');
    expect(out).not.toContain('evil');
  });
});

describe('resolveDirectives — data-sw-html', () => {
  it('sets innerHTML from sanitized rich content', () => {
    const html = '<div data-sw-html="body"><p>fallback</p></div>';
    const out = resolveDirectives(html, { richContent: { body: '<p>new <strong>copy</strong></p>' }, preview: true });
    expect(out).toContain('<p>new <strong>copy</strong></p>');
    expect(out).not.toContain('fallback');
  });

  it('sanitizes the value (a script/onerror cannot survive)', () => {
    const html = '<div data-sw-html="body">x</div>';
    const out = resolveDirectives(html, {
      richContent: { body: '<p>ok</p><script>alert(1)</script><img src=x onerror=alert(2)>' },
      preview: true,
    });
    expect(out).toContain('<p>ok</p>');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('onerror');
  });

  it('strips the marker on publish', () => {
    const html = '<div data-sw-html="body"><p>d</p></div>';
    expect(resolveDirectives(html, { richContent: { body: '<p>v</p>' } })).toBe('<div><p>v</p></div>');
  });
});

describe('resolveDirectives — data-sw-href', () => {
  it('sets the anchor href from content, scheme-sanitized', () => {
    const html = '<a data-sw-href="cta" href="/old">Go</a>';
    expect(resolveDirectives(html, { content: { cta: 'https://x.test' }, preview: true })).toBe(
      '<a data-sw-href="cta" href="https://x.test">Go</a>',
    );
    expect(resolveDirectives(html, { content: { cta: 'javascript:alert(1)' }, preview: true })).toContain('href="#"');
  });

  it('keeps the authored href when unset; strips the marker on publish', () => {
    const html = '<a data-sw-href="cta" href="/old">Go</a>';
    expect(resolveDirectives(html, { preview: true })).toBe('<a data-sw-href="cta" href="/old">Go</a>');
    expect(resolveDirectives(html, { content: { cta: '/new' } })).toBe('<a href="/new">Go</a>');
  });
});

describe('renderTemplate — directive integration', () => {
  it('resolves data-sw-html in preview (marker kept) and publish (stripped)', () => {
    const source = '<section data-sw-html="intro"><p>fallback</p></section>';
    const richContent = { intro: '<p>Hello <em>world</em></p>' };
    const preview = renderTemplate(source, { richContent, preview: true });
    expect(preview).toContain('data-sw-html="intro"');
    expect(preview).toContain('<p>Hello <em>world</em></p>');

    const published = renderTemplate(source, { richContent });
    expect(published).not.toContain('data-sw-html');
    expect(published).toContain('<p>Hello <em>world</em></p>');
  });

  it('composes with Handlebars loops — directive markers are page-level, values are dataset-bound', () => {
    const source =
      '<h1 data-sw-text="title">Title</h1><ul>{{#each data.items}}<li>{{this.name}}</li>{{/each}}</ul>';
    const out = renderTemplate(source, {
      content: { title: 'Our work' },
      data: { items: [{ name: 'A' }, { name: 'B' }] },
      preview: true,
    });
    expect(out).toContain('<h1 data-sw-text="title">Our work</h1>');
    expect(out).toContain('<li>A</li><li>B</li>');
  });
});
