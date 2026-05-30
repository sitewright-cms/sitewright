import { describe, expect, it } from 'vitest';
import type { Brand, Entry, Page, PageNode } from '@sitewright/schema';
import { renderNode, renderPage, renderDocument } from '../src/render.js';

function node(partial: Partial<PageNode> & { type: string }): PageNode {
  return { id: partial.id ?? 'n1', ...partial };
}

describe('renderNode — Html (raw embed) block', () => {
  it('emits the raw HTML unescaped inside a block wrapper', () => {
    const embed = '<iframe src="https://maps.example/?q=1" title="Map"></iframe>';
    const html = renderNode(node({ type: 'Html', props: { html: embed } }));
    expect(html).toContain('<div data-sw-block="Html"');
    expect(html).toContain(embed); // raw, NOT escaped
    expect(html).not.toContain('&lt;iframe');
  });

  it('keeps the className on the Html block wrapper', () => {
    const html = renderNode(node({ type: 'Html', className: 'my-8', props: { html: '<b>x</b>' } }));
    expect(html).toMatch(/<div data-sw-block="Html" class="my-8"/);
    expect(html).toContain('<b>x</b>');
  });

  it('renders an empty Html wrapper when no html is provided', () => {
    const html = renderNode(node({ type: 'Html', props: {} }));
    expect(html).toContain('data-sw-block="Html"');
    expect(html).toContain('</div>');
  });

  it('escapes the wrapper className even though the body is raw', () => {
    const html = renderNode(
      node({ type: 'Html', className: 'x" onmouseover="evil()', props: { html: '<b>x</b>' } }),
    );
    expect(html).not.toContain('onmouseover="evil()"');
    expect(html).toContain('&quot;');
  });

  it('resolves the html from a dataset binding field', () => {
    const html = renderNode(node({ type: 'Html', props: { htmlField: 'embed' } }), {
      entry: { id: 'e', dataset: 'd', status: 'published', values: { embed: '<span>bound</span>' } },
    });
    expect(html).toContain('<span>bound</span>');
  });
});

describe('renderNode — Carousel / Slide (interactive component)', () => {
  it('renders the component hook, data attrs, track, slides, and PE controls', () => {
    const html = renderNode(
      node({
        type: 'Carousel',
        props: { label: 'Work', autoplay: true, interval: 3000, loop: false },
        children: [
          { id: 's1', type: 'Slide', props: { image: '/a.jpg', alt: 'A', caption: 'First' } },
          { id: 's2', type: 'Slide', props: { image: '/b.jpg', alt: 'B' } },
        ],
      }),
    );
    expect(html).toContain('data-sw-block="Carousel"');
    expect(html).toContain('data-sw-component="carousel"'); // JS enhancement hook
    expect(html).toContain('data-autoplay="true"');
    expect(html).toContain('data-interval="3000"');
    expect(html).toContain('data-loop="false"');
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('aria-label="Work"');
    expect(html).toContain('data-sw-part="track"');
    expect(html).toContain('data-sw-part="prev"');
    expect(html).toContain('data-sw-part="next"');
    expect(html).toContain('data-sw-part="dots"');
    expect(html).toContain('data-sw-part="slide"');
    expect(html).toContain('<figcaption>First</figcaption>');
    expect(html).toContain('alt="A"');
  });

  it('clamps the interval and defaults loop/arrows/dots on', () => {
    const html = renderNode(node({ type: 'Carousel', props: { interval: 99 } }));
    expect(html).toContain('data-interval="1000"'); // clamped to the 1000ms floor
    expect(html).toContain('data-loop="true"'); // default
    expect(html).toContain('data-autoplay="false"'); // default
    expect(html).toContain('data-sw-part="prev"'); // arrows default on
    expect(html).toContain('data-sw-part="dots"'); // dots default on
  });

  it('omits arrows/dots when disabled', () => {
    const html = renderNode(node({ type: 'Carousel', props: { showArrows: false, showDots: false } }));
    expect(html).not.toContain('data-sw-part="prev"');
    expect(html).not.toContain('data-sw-part="dots"');
  });

  it('Slide renders a figure with image + escaped caption', () => {
    const html = renderNode(node({ type: 'Slide', props: { image: '/a.jpg', alt: 'x', caption: '<b>hi</b>' } }));
    expect(html).toContain('data-sw-part="slide"');
    expect(html).toContain('<figure>');
    expect(html).toContain('alt="x"');
    expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;'); // caption escaped
    expect(html).not.toContain('<b>hi</b>');
  });

  it('keeps the className on the carousel root', () => {
    expect(renderNode(node({ type: 'Carousel', className: 'my-12' }))).toMatch(
      /<div data-sw-block="Carousel" class="my-12"/,
    );
  });

  it('Slide with a media-asset image renders an optimized <picture> (shared imageTag)', () => {
    const asset = {
      id: 'a1',
      filename: 'x.png',
      format: 'image/png',
      bytes: 1,
      width: 800,
      height: 600,
      variants: [{ format: 'webp' as const, width: 400, height: 300, path: 'a1.webp' }],
      fallback: 'a1.jpg',
      url: '/media/p/a1/a1.jpg',
    };
    const html = renderNode(
      node({ type: 'Slide', props: { image: '/media/p/a1/a1.jpg', alt: 'X', caption: 'Cap' } }),
      { media: [asset], mediaUrl: (a, f) => `media/${a.id}/${f}` },
    );
    expect(html).toContain('<picture');
    expect(html).toContain('type="image/webp"');
    expect(html).toContain('<figcaption>Cap</figcaption>');
  });
});

describe('renderNode — Accordion (native, zero-JS)', () => {
  it('renders details/summary items with escaped titles and a content slot', () => {
    const html = renderNode(
      node({
        type: 'Accordion',
        children: [
          {
            id: 'i1',
            type: 'AccordionItem',
            props: { title: 'Q <1>', open: true },
            children: [{ id: 'c', type: 'RichText', props: { text: 'Answer' } }],
          },
          { id: 'i2', type: 'AccordionItem', props: { title: 'Q2' } },
        ],
      }),
    );
    expect(html).toContain('data-sw-block="Accordion"');
    expect(html).toMatch(/<details data-sw-block="AccordionItem" open>/); // open by default
    expect(html).toContain('<summary>Q &lt;1&gt;</summary>'); // escaped
    expect(html).toContain('data-sw-part="content"');
    expect(html).toContain('Answer');
    expect(html).toMatch(/<details data-sw-block="AccordionItem">/); // 2nd item closed (no open)
  });
});

describe('renderNode — Lightbox (gallery + overlay)', () => {
  it('renders the component hook, a thumbnail grid, item anchors, and a hidden overlay', () => {
    const html = renderNode(
      node({
        type: 'Lightbox',
        props: { label: 'Portfolio' },
        children: [
          { id: 'p1', type: 'LightboxItem', props: { image: '/full1.jpg', alt: 'One', caption: 'First' } },
          { id: 'p2', type: 'LightboxItem', props: { image: '/full2.jpg', thumb: '/thumb2.jpg', alt: 'Two' } },
        ],
      }),
    );
    expect(html).toContain('data-sw-block="Lightbox"');
    expect(html).toContain('data-sw-component="lightbox"');
    expect(html).toContain('aria-label="Portfolio"');
    expect(html).toContain('data-sw-part="grid"');
    expect(html).toContain('data-sw-part="overlay"');
    // PE: each item is an anchor to the FULL image (opens with no JS); caption in data
    expect(html).toContain('data-sw-part="item" href="full1.jpg"');
    expect(html).toContain('data-caption="First"');
    expect(html).toContain('src="full1.jpg"'); // p1 has no thumb → falls back to the full image
    expect(html).toContain('href="full2.jpg"'); // p2 links to its full image
  });

  it('uses the thumbnail when provided, and escapes a hostile caption', () => {
    const html = renderNode(
      node({ type: 'LightboxItem', props: { image: '/f.jpg', thumb: '/t.jpg', caption: '"><x' } }),
    );
    expect(html).toContain('src="t.jpg"'); // thumb used for the visible image
    expect(html).toContain('href="f.jpg"'); // full image is the link target
    expect(html).not.toContain('"><x');
    expect(html).toContain('&quot;');
  });

  it('renders an empty placeholder LightboxItem with no image', () => {
    expect(renderNode(node({ type: 'LightboxItem', props: {} }))).toContain('data-sw-empty="1"');
  });
});

describe('renderNode — brand/social icons (simple-icons)', () => {
  it('renders a brand icon as a filled-path SVG, labelled by the brand title', () => {
    const html = renderNode(node({ type: 'Icon', props: { name: 'brand:facebook' } }));
    expect(html).toContain('<svg data-sw-block="Icon"');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('fill="currentColor"'); // themeable by default
    expect(html).not.toContain('stroke='); // brand icons are fill-based, not stroke
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Facebook"'); // defaults to the brand title
    expect(html).toMatch(/<path d="M9\.101/); // the real simple-icons path
  });

  it('uses the official brand color when brandColor is set', () => {
    const html = renderNode(node({ type: 'Icon', props: { name: 'brand:facebook', brandColor: true } }));
    expect(html).toContain('fill="#0866ff"');
  });

  it('lets an explicit label override the brand-title default', () => {
    const html = renderNode(node({ type: 'Icon', props: { name: 'brand:github', label: 'Our code' } }));
    expect(html).toContain('aria-label="Our code"');
  });

  it('renders an empty placeholder for an unknown brand slug', () => {
    const html = renderNode(node({ type: 'Icon', props: { name: 'brand:nope-not-real' } }));
    expect(html).toContain('data-sw-empty="1"');
  });

  it('keeps the className on a brand icon root', () => {
    const html = renderNode(node({ type: 'Icon', className: 'h-6 w-6', props: { name: 'brand:x' } }));
    expect(html).toMatch(/<svg data-sw-block="Icon" class="h-6 w-6"/);
  });

  it('still renders Lucide (stroke) icons unchanged', () => {
    const html = renderNode(node({ type: 'Icon', props: { name: 'star' } }));
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('fill="none"');
  });

  it('routes the bare name "x" to the Lucide close icon, not brand:x', () => {
    // `x` exists in BOTH sets; only the `brand:` prefix selects the brand logo.
    const html = renderNode(node({ type: 'Icon', props: { name: 'x' } }));
    expect(html).toContain('stroke="currentColor"'); // Lucide (stroke), not brand
    expect(html).toContain('fill="none"');
    expect(html).not.toContain('role="img"');
  });
});

describe('renderNode — className (Tailwind utility layer)', () => {
  it('emits a class attribute on the block root element', () => {
    const html = renderNode(node({ type: 'Section', className: 'flex gap-4 md:grid' }));
    expect(html).toMatch(/<section[^>]*\sclass="flex gap-4 md:grid"/);
  });

  it('puts the class on the outer element for wrapper blocks (Hero/Heading/Image/Button)', () => {
    expect(renderNode(node({ type: 'Hero', className: 'py-20', props: { title: 'Hi' } }))).toMatch(
      /<div data-sw-block="Hero" class="py-20"/,
    );
    expect(renderNode(node({ type: 'Heading', className: 'text-3xl', props: { text: 'H' } }))).toMatch(
      /<h2 data-sw-block="Heading" class="text-3xl"/,
    );
    expect(renderNode(node({ type: 'Button', className: 'btn', props: { text: 'Go' } }))).toMatch(
      /<a data-sw-block="Button" class="btn"/,
    );
  });

  it('escapes class to prevent attribute breakout', () => {
    const html = renderNode(node({ type: 'Section', className: 'x" onmouseover="evil()' }));
    expect(html).not.toContain('onmouseover="evil()"');
    expect(html).toContain('&quot;');
  });

  it('emits no class attribute when className is absent', () => {
    expect(renderNode(node({ type: 'Section' }))).not.toContain('class=');
  });
});

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

  it('Icon inlines a built-in SVG (sized + accessible); placeholder for unknown', () => {
    const html = renderNode(node({ type: 'Icon', props: { name: 'menu', size: 32 } }));
    expect(html).toContain('data-sw-block="Icon"');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('width="32"');
    expect(html).toContain('aria-hidden="true"'); // decorative when no label
    expect(html).toContain('<line'); // the menu icon body
    const labeled = renderNode(node({ type: 'Icon', props: { name: 'search', label: 'Search "x"' } }));
    expect(labeled).toContain('role="img"');
    expect(labeled).toContain('aria-label="Search &quot;x&quot;"'); // escaped
    // unknown name → empty placeholder, clamped size
    expect(renderNode(node({ type: 'Icon', props: { name: 'no-such' } }))).toContain('data-sw-empty="1"');
    expect(renderNode(node({ type: 'Icon', props: { name: 'menu', size: 9999 } }))).toContain('width="256"');
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

    // author-placed children render inside the <nav> after the auto-links (container)
    const withChild = renderNode(
      node({ type: 'Nav', props: { slot: 'header' }, children: [node({ id: 'b', type: 'Heading', props: { text: 'Brand' } })] }),
      { nav },
    );
    expect(withChild).toContain('Brand');
    expect(withChild.indexOf('nav-link')).toBeLessThan(withChild.indexOf('Brand'));
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

  it('links external stylesheets last in <head> so utilities win by source order', () => {
    const doc = renderDocument(page, {
      brand,
      criticalCss: '.hero{color:red}',
      stylesheets: ['styles.css', '../styles.css'],
    });
    expect(doc).toContain('<link rel="stylesheet" href="styles.css" />');
    expect(doc).toContain('<link rel="stylesheet" href="../styles.css" />');
    // The stylesheet link comes AFTER the inline brand + critical CSS (later in the
    // cascade) and still inside <head>.
    expect(doc.indexOf('.hero{color:red}')).toBeLessThan(doc.indexOf('href="styles.css"'));
    expect(doc.indexOf('href="styles.css"')).toBeLessThan(doc.indexOf('</head>'));
    // none emitted by default
    expect(renderDocument(page, { brand })).not.toContain('rel="stylesheet"');
  });

  it('escapes a stylesheet href', () => {
    const doc = renderDocument(page, { brand, stylesheets: ['a"><script>x'] });
    expect(doc).not.toContain('<script>x');
    expect(doc).toContain('&quot;');
  });

  it('links deferred scripts at the end of <body>, escaping the src', () => {
    const doc = renderDocument(page, { brand, scripts: ['components.js'] });
    expect(doc).toContain('<script defer src="components.js"></script>');
    expect(doc.indexOf('<script defer')).toBeGreaterThan(doc.indexOf('<body>'));
    expect(doc.indexOf('<script defer')).toBeLessThan(doc.indexOf('</body>'));
    // none by default; href escaped
    expect(renderDocument(page, { brand })).not.toContain('<script defer');
    const evil = renderDocument(page, { brand, scripts: ['x"></script><script>alert(1)'] });
    expect(evil).not.toContain('<script>alert(1)');
    expect(evil).toContain('&quot;');
  });

  it('inlines inlineStyles as <style> blocks last in <head>, after critical CSS', () => {
    const doc = renderDocument(page, {
      brand,
      criticalCss: '.hero{color:red}',
      inlineStyles: ['.flex{display:flex}'],
    });
    expect(doc).toContain('<style>.flex{display:flex}</style>');
    expect(doc.indexOf('.hero{color:red}')).toBeLessThan(doc.indexOf('.flex{display:flex}'));
    expect(doc.indexOf('.flex{display:flex}')).toBeLessThan(doc.indexOf('</head>'));
    expect(renderDocument(page, { brand })).not.toContain('.flex{display:flex}');
  });
});
