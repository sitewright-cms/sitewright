import { describe, it, expect } from 'vitest';
import { GLOBAL_TEMPLATES } from '@sitewright/core';
import { resolveDirectives } from '../src/directives.js';
import { renderTemplate, validateTemplate } from '../src/template.js';

describe('resolveDirectives — data-sw-text', () => {
  it('is a no-op when no directive is present (byte-identical)', () => {
    const html = '<div class="x"><h1>Hi &amp; bye</h1><img src="/a.jpg"></div>';
    expect(resolveDirectives(html, { preview: true })).toBe(html);
  });

  it('binds content to textContent, escaping any markup in the value', () => {
    const html = '<h1 data-sw-text="t">Welcome</h1>';
    const out = resolveDirectives(html, { data: { t: '<b>x</b> & <script>y' }, preview: true });
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
    expect(resolveDirectives(html, { data: { t: 'Hi' }, preview: true })).toBe('<h1 data-sw-text="t">Hi</h1>');
    expect(resolveDirectives(html, { data: { t: 'Hi' } })).toBe('<h1>Hi</h1>');
  });

  it('ignores prototype-pollution keys', () => {
    const html = '<h1 data-sw-text="__proto__">Default</h1>';
    const out = resolveDirectives(html, { data: { __proto__: 'evil' } as Record<string, string>, preview: true });
    expect(out).toContain('Default');
    expect(out).not.toContain('evil');
  });

  it('keeps the authored default when a bare key holds a non-string page.data value', () => {
    const out = resolveDirectives('<h1 data-sw-text="n">Def</h1>', { data: { n: 42 } as unknown as Record<string, string>, preview: true });
    expect(out).toContain('>Def<'); // a number leaf is not a text override
  });
});

describe('resolveDirectives — data-sw-translate', () => {
  it('binds the per-locale catalog value to textContent, escaping markup', () => {
    const html = '<span data-sw-translate="nav_cta">Default</span>';
    const out = resolveDirectives(html, { t: { nav_cta: 'Projekt <b>starten</b> & los' }, preview: true });
    expect(out).toContain('data-sw-translate="nav_cta"');
    expect(out).toContain('Projekt &lt;b&gt;starten&lt;/b&gt; &amp; los');
    expect(out).not.toContain('<b>');
  });

  it('reads website.t — NOT page.data (the two stores are independent)', () => {
    const html = '<span data-sw-translate="k">Authored</span>';
    // a page.data["k"] must NOT bleed into a translate directive
    expect(resolveDirectives(html, { data: { k: 'from page.data' }, preview: true })).toContain('>Authored<');
    expect(resolveDirectives(html, { t: { k: 'from catalog' }, preview: true })).toContain('>from catalog<');
  });

  it('keeps the authored fallback when the key is untranslated (missing or empty)', () => {
    expect(resolveDirectives('<span data-sw-translate="k">Fallback</span>', { preview: true })).toContain('>Fallback<');
    // resolveTranslations omits empties, but a present-but-empty cell must not blank the element either
    expect(resolveDirectives('<span data-sw-translate="k">Fallback</span>', { t: { k: '' }, preview: true })).toContain('>Fallback<');
  });

  it('keeps the marker in preview, strips it on publish', () => {
    const html = '<span data-sw-translate="k">Def</span>';
    expect(resolveDirectives(html, { t: { k: 'Hi' }, preview: true })).toBe('<span data-sw-translate="k">Hi</span>');
    expect(resolveDirectives(html, { t: { k: 'Hi' } })).toBe('<span>Hi</span>');
  });

  it('ignores prototype-pollution keys', () => {
    const out = resolveDirectives('<span data-sw-translate="__proto__">Def</span>', {
      t: { __proto__: 'evil' } as Record<string, string>,
      preview: true,
    });
    expect(out).toContain('>Def<');
    expect(out).not.toContain('evil');
  });

  it('resolves end-to-end through renderTemplate from website.translations + page.locale', () => {
    const out = renderTemplate('<span data-sw-translate="hello">Hi</span>', {
      website: { t: { hello: 'Hola' } },
      preview: true,
    });
    expect(out).toContain('>Hola<');
  });

  it('passes validateTemplate (no JS) on a translate directive', () => {
    expect(() => validateTemplate('<span data-sw-translate="k">x</span>')).not.toThrow();
  });
});

describe('resolveDirectives — data-sw-html', () => {
  it('sets innerHTML from sanitized rich content in page.data (bare key)', () => {
    const html = '<div data-sw-html="body"><p>fallback</p></div>';
    const out = resolveDirectives(html, { data: { body: '<p>new <strong>copy</strong></p>' }, preview: true });
    expect(out).toContain('<p>new <strong>copy</strong></p>');
    expect(out).not.toContain('fallback');
  });

  it('reads a nested data.<path> rich leaf too', () => {
    const html = '<div data-sw-html="page.data.article.body"><p>fallback</p></div>';
    const out = resolveDirectives(html, { data: { article: { body: '<p>nested</p>' } }, preview: true });
    expect(out).toContain('<p>nested</p>');
    expect(out).not.toContain('fallback');
  });

  it('sanitizes the value (a script/onerror cannot survive)', () => {
    const html = '<div data-sw-html="body">x</div>';
    const out = resolveDirectives(html, {
      data: { body: '<p>ok</p><script>alert(1)</script><img src=x onerror=alert(2)>' },
      preview: true,
    });
    expect(out).toContain('<p>ok</p>');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('onerror');
  });

  it('strips the marker on publish', () => {
    const html = '<div data-sw-html="body"><p>d</p></div>';
    expect(resolveDirectives(html, { data: { body: '<p>v</p>' } })).toBe('<div><p>v</p></div>');
  });
});

describe('resolveDirectives — data-sw-href', () => {
  it('sets the anchor href from content, scheme-sanitized', () => {
    const html = '<a data-sw-href="cta" href="/old">Go</a>';
    expect(resolveDirectives(html, { data: { cta: 'https://x.test' }, preview: true })).toBe(
      '<a data-sw-href="cta" href="https://x.test">Go</a>',
    );
    expect(resolveDirectives(html, { data: { cta: 'javascript:alert(1)' }, preview: true })).toContain('href="#"');
  });

  it('keeps the authored href when unset; strips the marker on publish', () => {
    const html = '<a data-sw-href="cta" href="/old">Go</a>';
    expect(resolveDirectives(html, { preview: true })).toBe('<a data-sw-href="cta" href="/old">Go</a>');
    expect(resolveDirectives(html, { data: { cta: '/new' } })).toBe('<a href="/new">Go</a>');
  });
});

describe('resolveDirectives — data-sw-src / data-sw-bg (images)', () => {
  it('replaces an img src from content, scheme-sanitized; publish strips the marker', () => {
    const html = '<img data-sw-src="hero" src="/old.jpg" alt="">';
    const preview = resolveDirectives(html, { data: { hero: '/media/p/a/new.jpg' }, preview: true });
    expect(preview).toContain('data-sw-src="hero"');
    expect(preview).toContain('src="/media/p/a/new.jpg"');
    const published = resolveDirectives(html, { data: { hero: 'javascript:alert(1)' } });
    expect(published).not.toContain('data-sw-src');
    expect(published).not.toContain('javascript'); // neutralized to an empty src
  });

  it('sets a CSS-guarded background-image, merging existing style; refuses a breakout URL', () => {
    // (the url() delimiter single-quotes appear LITERALLY in the double-quoted style attribute —
    //  escapeAttribute only escapes " and &, not ' — so the assertions avoid the quote char.)
    const out = resolveDirectives('<section data-sw-bg="bg" style="padding:2rem">x</section>', {
      data: { bg: '/media/p/a/x.jpg' },
      preview: true,
    });
    expect(out).toContain('background-image:url(');
    expect(out).toContain('/media/p/a/x.jpg');
    expect(out).toContain('padding:2rem');
    expect(out).toContain('data-sw-bg="bg"');

    const evil = resolveDirectives('<section data-sw-bg="bg">x</section>', {
      data: { bg: "/x');background:red" },
      preview: true,
    });
    expect(evil).not.toContain('background-image'); // url with ' and ( ) refused

    const published = resolveDirectives('<section data-sw-bg="bg">x</section>', { data: { bg: '/media/a.jpg' } });
    expect(published).toContain('background-image:url(');
    expect(published).toContain('/media/a.jpg');
    expect(published).not.toContain('data-sw-bg');
  });

  it('LAZY: data-sw-src fills data-src (not src) when the element opts into lazy-loading', () => {
    // The author marks the image lazy by adding a (possibly empty) data-src; the runtime swaps it in.
    const out = resolveDirectives('<img data-sw-src="hero" data-src alt="">', { data: { hero: '/media/p/a/new.jpg' } });
    expect(out).toContain('data-src="/media/p/a/new.jpg"');
    expect(out).not.toMatch(/\ssrc="/); // eager src is NOT set
    expect(out).not.toContain('data-sw-src'); // publish strips the directive marker, keeps data-src
  });

  it('LAZY: data-sw-bg fills data-bg (not inline style) when the element opts into lazy-loading', () => {
    const out = resolveDirectives('<section data-sw-bg="bg" data-bg>x</section>', { data: { bg: '/media/p/a/x.jpg' } });
    expect(out).toContain('data-bg="/media/p/a/x.jpg"');
    expect(out).not.toContain('background-image'); // no eager inline style — the runtime sets it on intersect
    expect(out).not.toContain('data-sw-bg');
  });

  it('non-lazy elements are unchanged (src / inline style as before)', () => {
    expect(resolveDirectives('<img data-sw-src="h">', { data: { h: '/m/a.jpg' } })).toContain('src="/m/a.jpg"');
    expect(resolveDirectives('<section data-sw-bg="b">x</section>', { data: { b: '/m/a.jpg' } })).toContain('background-image:url(');
  });

  it('LAZY paths still scheme-sanitize via safeUrl (no javascript:/data: in data-src/data-bg)', () => {
    const src = resolveDirectives('<img data-sw-src="h" data-src>', { data: { h: 'javascript:alert(1)' } });
    expect(src).not.toContain('javascript'); // neutralized to data-src=""
    const bg = resolveDirectives('<section data-sw-bg="b" data-bg>x</section>', { data: { b: 'javascript:alert(1)' } });
    expect(bg).not.toContain('javascript'); // rejected → authored data-bg kept, no bad URL
  });

  it('lazy authoring markup passes the no-JS template validator', () => {
    // A valueless / empty data-src|data-bg is the lazy opt-in marker (no interpolation → safe).
    expect(() => validateTemplate('<img data-sw-src="hero" data-src src="/placeholder.jpg" alt="">')).not.toThrow();
    expect(() => validateTemplate('<section data-sw-bg="bg" data-bg>x</section>')).not.toThrow();
  });
});

describe('resolveDirectives — preview forces lazy images eager (editor must show content)', () => {
  // In the editor iframe native loading="lazy" is unreliable + arrives after Embla measures → blank
  // sliders. Preview render flips them eager; publish keeps lazy.
  it('PREVIEW: loading="lazy" → eager (even on a page whose only marker is the lazy img)', () => {
    const out = resolveDirectives('<div data-sw-entry="x" data-sw-dataset="d"><img src="/a.jpg" loading="lazy"></div>', { preview: true });
    expect(out).toContain('loading="eager"');
    expect(out).not.toContain('loading="lazy"');
  });
  it('PREVIEW: processes a no-directive page that only has lazy images', () => {
    const out = resolveDirectives('<section><img src="/a.jpg" loading="lazy"><img src="/b.jpg" loading="lazy"></section>', { preview: true });
    expect((out.match(/loading="eager"/g) ?? []).length).toBe(2);
  });
  it('PUBLISH: lazy is preserved (performance)', () => {
    const out = resolveDirectives('<div data-sw-text="t">x</div><img src="/a.jpg" loading="lazy">', { data: { t: 'hi' } });
    expect(out).toContain('loading="lazy"');
  });
  it('a non-directive, non-lazy page is still a byte-identical no-op', () => {
    const html = '<section><img src="/a.jpg"><p>hi</p></section>';
    expect(resolveDirectives(html, { preview: true })).toBe(html);
  });
  it('does NOT parse a page that only MENTIONS loading="lazy" in a code sample (no <img>)', () => {
    const html = '<pre><code>&lt;img loading="lazy"&gt;</code></pre>';
    expect(resolveDirectives(html, { preview: true })).toBe(html); // byte-identical no-op
  });
});

describe('resolveDirectives — empty URL override reverts to the authored default', () => {
  it('keeps the default src/href/bg when the stored value is empty (clear = revert)', () => {
    expect(resolveDirectives('<img data-sw-src="hero" src="/default.jpg">', { data: { hero: '' }, preview: true })).toContain(
      'src="/default.jpg"',
    );
    expect(resolveDirectives('<a data-sw-href="c" href="/keep">x</a>', { data: { c: '' }, preview: true })).toContain(
      'href="/keep"',
    );
    const bg = resolveDirectives('<section data-sw-bg="b" style="background-image:url(/d.jpg)">x</section>', {
      data: { b: '' },
      preview: true,
    });
    expect(bg).toContain('/d.jpg'); // the authored default background is preserved, not cleared
  });
});

describe('renderTemplate — directive integration', () => {
  it('resolves data-sw-html in preview (marker kept) and publish (stripped)', () => {
    const source = '<section data-sw-html="intro"><p>fallback</p></section>';
    const page = { data: { intro: '<p>Hello <em>world</em></p>' } };
    const preview = renderTemplate(source, { page, preview: true });
    expect(preview).toContain('data-sw-html="intro"');
    expect(preview).toContain('<p>Hello <em>world</em></p>');

    const published = renderTemplate(source, { page });
    expect(published).not.toContain('data-sw-html');
    expect(published).toContain('<p>Hello <em>world</em></p>');
  });

  it('composes with Handlebars loops — directive markers are page-level, values are dataset-bound', () => {
    const source =
      '<h1 data-sw-text="title">Title</h1><ul>{{#each data.items}}<li>{{this.name}}</li>{{/each}}</ul>';
    const out = renderTemplate(source, {
      page: { data: { title: 'Our work' } }, // the directive's bare key reads page.data
      data: { items: [{ name: 'A' }, { name: 'B' }] }, // the dataset context for {{#each data.items}}
      preview: true,
    });
    expect(out).toContain('<h1 data-sw-text="title">Our work</h1>');
    expect(out).toContain('<li>A</li><li>B</li>');
  });
});

describe('resolveDirectives — data.<path> keys bind to page.data', () => {
  const data = {
    article_title: 'Hello <b>World</b>',
    article_body: '<p>Body</p><script>bad()</script>',
    article_image: '/a.jpg',
    nested: { deep: 'X' },
  };

  it('reads a STRING leaf for text (escaped), html (sanitized), and src', () => {
    const out = resolveDirectives(
      '<h1 data-sw-text="page.data.article_title">d</h1><div data-sw-html="page.data.article_body">d</div><img data-sw-src="page.data.article_image">',
      { data, preview: true },
    );
    expect(out).toContain('Hello &lt;b&gt;World&lt;/b&gt;'); // text escaped, no markup injected
    expect(out).toContain('<p>Body</p>'); // rich sanitized
    expect(out).not.toContain('<script>'); // script stripped
    expect(out).toContain('src="/a.jpg"');
  });

  it('resolves a deep dotted path', () => {
    expect(resolveDirectives('<span data-sw-text="page.data.nested.deep">d</span>', { data, preview: true })).toContain('>X<');
  });

  it('keeps the authored default for a missing path or a non-string leaf', () => {
    expect(resolveDirectives('<h1 data-sw-text="page.data.nope">Def</h1>', { data, preview: true })).toContain('>Def<');
    // `nested` is an object, not a string → no override
    expect(resolveDirectives('<h1 data-sw-text="page.data.nested">Def</h1>', { data, preview: true })).toContain('>Def<');
  });

  it('refuses a prototype-pollution segment (keeps the default)', () => {
    expect(resolveDirectives('<h1 data-sw-text="page.data.__proto__">Def</h1>', { data, preview: true })).toContain('>Def<');
    expect(resolveDirectives('<h1 data-sw-text="page.data.a.constructor">Def</h1>', { data, preview: true })).toContain('>Def<');
  });

  it('does not traverse array-index segments (symmetric with the editor)', () => {
    const d = { items: ['first', 'second'] };
    expect(resolveDirectives('<h1 data-sw-text="page.data.items.0">Def</h1>', { data: d, preview: true })).toContain('>Def<');
  });

  it('strips the markers on publish (no preview flag)', () => {
    const out = resolveDirectives('<h1 data-sw-text="page.data.article_title">d</h1>', { data });
    expect(out).toBe('<h1>Hello &lt;b&gt;World&lt;/b&gt;</h1>');
  });

  it('resolves through renderTemplate via page.data (preview + publish)', () => {
    const page = { data: { headline: 'Live' } };
    expect(renderTemplate('<h1 data-sw-text="page.data.headline">d</h1>', { page, preview: true })).toContain('data-sw-text="page.data.headline">Live<');
    expect(renderTemplate('<h1 data-sw-text="page.data.headline">d</h1>', { page })).toBe('<h1>Live</h1>');
  });
});

describe('global blog templates (content-only) render via validateTemplate', () => {
  const article = GLOBAL_TEMPLATES.find((t) => t.id === 'global:blog-article')!;
  const overview = GLOBAL_TEMPLATES.find((t) => t.id === 'global:blog-overview')!;

  it('blog-article renders its declared page.data through the data-sw-* leaves (no validate throw)', () => {
    const page = { data: article.data };
    const out = renderTemplate(article.source, { page, preview: true });
    expect(out).toContain('Your article title'); // data.article_title via data-sw-text
    expect(() => renderTemplate(article.source, { page })).not.toThrow(); // publish path validates + renders
  });

  it('blog-overview lists children, reading each child’s page.data (image + excerpt)', () => {
    const page = {
      data: overview.data,
      children: [{ title: 'First', path: '/blog/first', data: { article_image: '/i.jpg', article_excerpt: 'Excerpt one' } }],
    };
    const out = renderTemplate(overview.source, { page });
    expect(out).toContain('href="/blog/first"'); // {{sw-url path}}
    expect(out).toContain('src="/i.jpg"'); // child's data.article_image
    expect(out).toContain('Excerpt one'); // child's data.article_excerpt
  });
});
