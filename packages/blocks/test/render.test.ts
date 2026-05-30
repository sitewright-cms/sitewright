import { describe, expect, it } from 'vitest';
import type { Brand, Entry, Page, PageNode } from '@sitewright/schema';
import { renderNode, renderPage, renderDocument } from '../src/render.js';

function node(partial: Partial<PageNode> & { type: string }): PageNode {
  return { id: partial.id ?? 'n1', ...partial };
}

describe('renderNode — per block', () => {
  it('Heading renders the right level and escapes the text', () => {
    const html = renderNode(node({ type: 'Heading', props: { text: '<b>Hi</b>', level: 3 } }));
    expect(html).toContain('data-sw-block="Heading"');
    expect(html).toMatch(/<h3[ >]/);
    expect(html).toContain('&lt;b&gt;Hi&lt;/b&gt;');
    expect(html).not.toContain('<b>Hi</b>');
  });

  it('Heading clamps the level into 1..6', () => {
    expect(renderNode(node({ type: 'Heading', props: { level: 99 } }))).toMatch(/<h6[ >]/);
    expect(renderNode(node({ type: 'Heading', props: { level: -3 } }))).toMatch(/<h1[ >]/);
  });

  it('RichText wraps text in a paragraph', () => {
    const html = renderNode(node({ type: 'RichText', props: { text: 'Body copy' } }));
    expect(html).toContain('data-sw-block="RichText"');
    expect(html).toContain('<p>Body copy</p>');
  });

  it('Hero renders title/subtitle and a sanitized CTA', () => {
    const html = renderNode(
      node({
        type: 'Hero',
        props: { title: 'Welcome', subtitle: 'Sub', ctaText: 'Go', ctaHref: 'javascript:evil()' },
      }),
    );
    expect(html).toContain('Welcome');
    expect(html).toContain('Sub');
    expect(html).toContain('>Go<');
    expect(html).toContain('href="#"'); // unsafe scheme neutralised
    expect(html).not.toContain('javascript:');
  });

  it('Image escapes the alt and only accepts safe src', () => {
    const ok = renderNode(node({ type: 'Image', props: { src: '/img/a.png', alt: 'A "cat"' } }));
    expect(ok).toContain('src="img/a.png"'); // root-relative src rebased onto page root ('' = home)
    expect(ok).toContain('alt="A &quot;cat&quot;"');
    const bad = renderNode(node({ type: 'Image', props: { src: 'javascript:1', alt: '' } }));
    expect(bad).not.toContain('javascript:');
  });

  it('Button and Link sanitize hrefs and escape text', () => {
    const btn = renderNode(node({ type: 'Button', props: { text: 'Buy', href: 'https://x.io' } }));
    expect(btn).toContain('data-sw-block="Button"');
    expect(btn).toContain('href="https://x.io"');
    expect(btn).toContain('Buy');
  });

  it('Grid carries the clamped column count as a data attribute', () => {
    expect(renderNode(node({ type: 'Grid', props: { columns: 4 } }))).toContain('data-columns="4"');
    expect(renderNode(node({ type: 'Grid', props: { columns: 99 } }))).toContain('data-columns="6"');
  });

  it('Section carries its tone', () => {
    expect(renderNode(node({ type: 'Section', props: { tone: 'primary' } }))).toContain(
      'data-tone="primary"',
    );
    // unknown tone falls back to surface
    expect(renderNode(node({ type: 'Section', props: { tone: 'bogus' } }))).toContain(
      'data-tone="surface"',
    );
  });

  it('Header escapes the brand and Footer escapes its text', () => {
    expect(renderNode(node({ type: 'Header', props: { brand: 'A&B' } }))).toContain('A&amp;B');
    expect(renderNode(node({ type: 'Footer', props: { text: '© 2026' } }))).toContain('© 2026');
  });

  it('renders children of container blocks', () => {
    const html = renderNode(
      node({
        type: 'Section',
        children: [node({ id: 'c1', type: 'Heading', props: { text: 'Inner' } })],
      }),
    );
    expect(html).toContain('Inner');
    expect(html).toContain('data-sw-block="Heading"');
  });

  it('renders an unknown block type as a labelled fallback (no crash)', () => {
    const html = renderNode(node({ type: 'Mystery' }));
    expect(html).toContain('data-sw-block="Unknown"');
    expect(html).toContain('Mystery');
  });

  it('Hero omits empty title/subtitle/cta', () => {
    const html = renderNode(node({ type: 'Hero', props: {} }));
    expect(html).toContain('data-sw-block="Hero"');
    expect(html).not.toContain('data-sw-part="title"');
    expect(html).not.toContain('data-sw-part="subtitle"');
    expect(html).not.toContain('data-sw-part="cta"');
  });

  it('RichText with no text still renders its children', () => {
    const html = renderNode(
      node({ type: 'RichText', children: [node({ id: 'k', type: 'Link', props: { text: 'k' } })] }),
    );
    expect(html).not.toContain('<p>');
    expect(html).toContain('data-sw-block="Link"');
  });

  it('Image marks priority images as eager-loading', () => {
    const html = renderNode(node({ type: 'Image', props: { src: '/a.png', priority: true } }));
    expect(html).toContain('loading="eager"');
  });

  it('Image with no usable src renders an empty placeholder', () => {
    const html = renderNode(node({ type: 'Image', props: {} }));
    expect(html).toContain('data-sw-empty');
  });

  it('Image renders an optimized <picture> for a known media asset', () => {
    const asset = {
      id: 'a1',
      filename: 'hero.png',
      format: 'image/png',
      bytes: 100,
      width: 800,
      height: 600,
      variants: [
        { format: 'avif' as const, width: 400, height: 300, path: 'a1-400.avif' },
        { format: 'webp' as const, width: 400, height: 300, path: 'a1-400.webp' },
      ],
      fallback: 'a1-400.jpg',
      url: '/media/p/a1/a1-400.jpg',
    };
    const html = renderNode(
      node({ type: 'Image', props: { src: '/media/p/a1/a1-400.jpg', alt: 'Hero' } }),
      { media: [asset], mediaUrl: (a, file) => `media/${a.id}/${file}` },
    );
    expect(html).toContain('<picture');
    expect(html).toContain('type="image/avif"');
    expect(html).toContain('media/a1/a1-400.avif 400w');
    expect(html).toContain('src="media/a1/a1-400.jpg"');
    expect(html).toContain('width="800"');
    expect(html).toContain('Hero');
  });

  it('escapes the alt attribute in the <picture> fallback img', () => {
    const asset = {
      id: 'a1', filename: 'h.png', format: 'image/png', bytes: 1, width: 10, height: 10,
      variants: [{ format: 'webp' as const, width: 10, height: 10, path: 'a1-10.webp' }],
      fallback: 'a1-10.jpg', url: '/media/p/a1/a1-10.jpg',
    };
    const html = renderNode(
      node({ type: 'Image', props: { src: '/media/p/a1/a1-10.jpg', alt: '"><script>x' } }),
      { media: [asset], mediaUrl: (a, file) => `media/${a.id}/${file}` },
    );
    expect(html).not.toContain('<script>x');
    expect(html).toContain('alt="&quot;&gt;&lt;script&gt;x"');
  });

  it('Image falls back to plain <img> when the asset is unknown', () => {
    const html = renderNode(
      node({ type: 'Image', props: { src: '/external/x.jpg', alt: 'X' } }),
      { media: [], mediaUrl: (a, file) => `media/${a.id}/${file}` },
    );
    expect(html).toContain('<img data-sw-block="Image"');
    expect(html).not.toContain('<picture');
  });

  it('Link sanitizes its href', () => {
    const html = renderNode(node({ type: 'Link', props: { text: 'Home', href: '/home' } }));
    expect(html).toContain('data-sw-block="Link"');
    expect(html).toContain('href="home"'); // root-relative internal link rebased onto page root
    expect(html).toContain('Home');
  });

  it('rebases internal links and image src onto the page root for portable output', () => {
    const link = renderNode(node({ type: 'Link', props: { text: 'About', href: '/about' } }), {
      root: '../',
    });
    expect(link).toContain('href="../about"');

    const btn = renderNode(node({ type: 'Button', props: { text: 'Home', href: '/' } }), {
      root: '../',
    });
    expect(btn).toContain('href="../"');

    const img = renderNode(node({ type: 'Image', props: { src: '/img/a.png', alt: 'A' } }), {
      root: '../../',
    });
    expect(img).toContain('src="../../img/a.png"');

    const hero = renderNode(
      node({ type: 'Hero', props: { title: 'T', ctaText: 'Go', ctaHref: '/contact' } }),
      { root: '../' },
    );
    expect(hero).toContain('href="../contact"');

    const ext = renderNode(node({ type: 'Link', props: { text: 'X', href: 'https://x.io/y' } }), {
      root: '../',
    });
    expect(ext).toContain('href="https://x.io/y"'); // external untouched
  });

  it('Nav renders the slot menu from ctx.nav (rebased hrefs, escaped labels)', () => {
    const nav = { header: [{ label: 'Home', path: '/' }, { label: 'A & B', path: '/about' }] };
    const html = renderNode(node({ type: 'Nav', props: { slot: 'header' } }), { root: '../', nav });
    expect(html).toContain('data-sw-block="Nav"');
    expect(html).toContain('data-slot="header"');
    expect(html).toContain('href="../"'); // home rebased to the page root
    expect(html).toContain('href="../about"');
    expect(html).toContain('A &amp; B'); // label escaped
    // a slot with no items still renders the <nav> wrapper, no links
    const empty = renderNode(node({ type: 'Nav', props: { slot: 'footer' } }), { nav });
    expect(empty).toContain('data-sw-block="Nav"');
    expect(empty).not.toContain('data-sw-part="nav-link"');
  });

  it('Footer renders nested children alongside its text', () => {
    const html = renderNode(
      node({
        type: 'Footer',
        props: { text: 'Copyright' },
        children: [node({ id: 'l', type: 'Link', props: { text: 'Privacy', href: '/p' } })],
      }),
    );
    expect(html).toContain('Copyright');
    expect(html).toContain('Privacy');
  });
});

describe('renderNode — data binding', () => {
  const entries: Entry[] = [
    { id: 'p1', dataset: 'posts', status: 'published', values: { title: 'First' } },
    { id: 'p2', dataset: 'posts', status: 'published', values: { title: 'Second' } },
    { id: 'p3', dataset: 'posts', status: 'draft', values: { title: 'Hidden' } },
  ];

  it('list binding repeats children once per published entry', () => {
    const tree = node({
      type: 'Grid',
      binding: { dataset: 'posts', mode: 'list' },
      children: [node({ id: 'card', type: 'Heading', props: { textField: 'title' } })],
    });
    const html = renderNode(tree, { datasets: { posts: entries } });
    expect(html).toContain('First');
    expect(html).toContain('Second');
    expect(html).not.toContain('Hidden'); // drafts excluded by default
  });

  it('includes drafts when previewing drafts', () => {
    const tree = node({
      type: 'Grid',
      binding: { dataset: 'posts', mode: 'list' },
      children: [node({ id: 'card', type: 'Heading', props: { textField: 'title' } })],
    });
    const html = renderNode(tree, { datasets: { posts: entries }, includeDrafts: true });
    expect(html).toContain('Hidden');
  });

  it('single binding puts one entry into context for the subtree', () => {
    const tree = node({
      type: 'Section',
      binding: { dataset: 'posts', mode: 'single' },
      children: [node({ id: 'h', type: 'Heading', props: { textField: 'title' } })],
    });
    const html = renderNode(tree, { datasets: { posts: entries } });
    expect(html).toContain('First');
  });
});

describe('renderPage / renderDocument', () => {
  const page: Page = {
    id: 'home',
    path: '/',
    title: 'Home',
    root: {
      id: 'root',
      type: 'Section',
      children: [{ id: 'h', type: 'Heading', props: { text: 'Hello' } }],
    },
  };
  const brand: Brand = { name: 'Acme', colors: { primary: '#0a7' } } as Brand;

  it('renderPage renders the root subtree', () => {
    const html = renderPage(page);
    expect(html).toContain('data-sw-block="Section"');
    expect(html).toContain('Hello');
  });

  it('renderDocument returns a full, brand-themed HTML document', () => {
    const doc = renderDocument(page, { brand });
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain('<style>');
    expect(doc).toContain('--sw-color-primary: #0a7;');
    expect(doc).toContain('Hello');
    expect(doc).toContain('</html>');
  });

  it('escapes the document title', () => {
    const doc = renderDocument(
      { ...page, title: '</title><script>alert(1)</script>' },
      { brand },
    );
    expect(doc).not.toContain('<script>alert(1)</script>');
  });

  it('emits SEO meta, schema.org JSON-LD, and raw custom head/footer', () => {
    const doc = renderDocument(page, {
      brand,
      seo: { title: 'Custom Title', description: 'Desc', themeColor: '#0a7', favicon: '/i.png' },
      organization: { name: 'Acme', url: 'https://acme.test/' },
      customHead: '<!-- analytics-head -->',
      customFooter: '<!-- analytics-foot -->',
    });
    expect(doc).toContain('<title>Custom Title</title>'); // seo.title overrides page.title
    expect(doc).toContain('name="description" content="Desc"');
    expect(doc).toContain('name="theme-color" content="#0a7"');
    expect(doc).toContain('rel="icon" href="/i.png"');
    expect(doc).toContain('<script type="application/ld+json">');
    expect(doc).toContain('"name":"Acme"');
    expect(doc).toContain('<!-- analytics-head -->');
    expect(doc).toContain('<!-- analytics-foot -->');
  });

  it('falls back to the page title and omits optional head bits by default', () => {
    const doc = renderDocument(page, { brand });
    expect(doc).toContain('<title>Home</title>');
    expect(doc).not.toContain('application/ld+json');
    expect(doc).not.toContain('rel="icon"');
  });

  it('falls back to the page title when the SEO title is an empty string', () => {
    const doc = renderDocument(page, { brand, seo: { title: '' } });
    expect(doc).toContain('<title>Home</title>');
  });

  it('inlines project-wide critical CSS in <head> after the brand styles', () => {
    const doc = renderDocument(page, { brand, criticalCss: '.hero{color:red}' });
    expect(doc).toContain('<style>.hero{color:red}</style>');
    // brand-token style block still present and precedes the critical CSS
    expect(doc.indexOf('--sw-color-primary')).toBeLessThan(doc.indexOf('.hero{color:red}'));
    expect(doc.indexOf('.hero{color:red}')).toBeLessThan(doc.indexOf('</head>'));
    // omitted when not provided
    expect(renderDocument(page, { brand })).not.toContain('<style>.hero');
  });
});
