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

describe('resolveDirectives — data-sw-src / data-sw-bg (images)', () => {
  it('replaces an img src from content, scheme-sanitized; publish strips the marker', () => {
    const html = '<img data-sw-src="hero" src="/old.jpg" alt="">';
    const preview = resolveDirectives(html, { content: { hero: '/media/p/a/new.jpg' }, preview: true });
    expect(preview).toContain('data-sw-src="hero"');
    expect(preview).toContain('src="/media/p/a/new.jpg"');
    const published = resolveDirectives(html, { content: { hero: 'javascript:alert(1)' } });
    expect(published).not.toContain('data-sw-src');
    expect(published).not.toContain('javascript'); // neutralized to an empty src
  });

  it('sets a CSS-guarded background-image, merging existing style; refuses a breakout URL', () => {
    // (the serializer renders the url() delimiter quotes as &apos; in the style attribute — the
    //  browser decodes them, so the assertions avoid the quote char.)
    const out = resolveDirectives('<section data-sw-bg="bg" style="padding:2rem">x</section>', {
      content: { bg: '/media/p/a/x.jpg' },
      preview: true,
    });
    expect(out).toContain('background-image:url(');
    expect(out).toContain('/media/p/a/x.jpg');
    expect(out).toContain('padding:2rem');
    expect(out).toContain('data-sw-bg="bg"');

    const evil = resolveDirectives('<section data-sw-bg="bg">x</section>', {
      content: { bg: "/x');background:red" },
      preview: true,
    });
    expect(evil).not.toContain('background-image'); // url with ' and ( ) refused

    const published = resolveDirectives('<section data-sw-bg="bg">x</section>', { content: { bg: '/media/a.jpg' } });
    expect(published).toContain('background-image:url(');
    expect(published).toContain('/media/a.jpg');
    expect(published).not.toContain('data-sw-bg');
  });
});

describe('resolveDirectives — empty URL override reverts to the authored default', () => {
  it('keeps the default src/href/bg when the stored value is empty (clear = revert)', () => {
    expect(resolveDirectives('<img data-sw-src="hero" src="/default.jpg">', { content: { hero: '' }, preview: true })).toContain(
      'src="/default.jpg"',
    );
    expect(resolveDirectives('<a data-sw-href="c" href="/keep">x</a>', { content: { c: '' }, preview: true })).toContain(
      'href="/keep"',
    );
    const bg = resolveDirectives('<section data-sw-bg="b" style="background-image:url(/d.jpg)">x</section>', {
      content: { b: '' },
      preview: true,
    });
    expect(bg).toContain('/d.jpg'); // the authored default background is preserved, not cleared
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
