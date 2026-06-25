import { describe, expect, it } from 'vitest';
import { mapAosEffect, ms, aosAttrs } from '../src/nativize/aos.js';
import { mergeTree, mergeTrees, renderTree, toRoute, snapButton, expandCarouselDirect, type CapturedNode, type NativizeContext } from '../src/nativize/emit.js';
import { DEFAULT_FONT_MAP } from '../src/nativize/tokens.js';

const ctx: NativizeContext = {
  palette: { colors: { '11,74,119': 'primary', '57,193,240': 'secondary' }, fonts: DEFAULT_FONT_MAP },
  originHosts: ['advancedtechcc.com'],
  breakpoints: ['', 'md:', 'lg:'],
};

/** Build a captured node (same styles at all 3 viewports unless varied per-tree). */
function node(tag: string, s: Record<string, string> = {}, extra: Partial<CapturedNode> = {}): CapturedNode {
  return { tag, s, children: [], ...extra };
}

describe('aos — scroll-reveal mapping', () => {
  it('maps animate.css keyframes to platform effects (with inverted direction)', () => {
    expect(mapAosEffect('fadeInLeft')).toBe('fade-right');
    expect(mapAosEffect('fadeInUp')).toBe('fade-up');
    expect(mapAosEffect('zoomIn')).toBe('zoom-in');
    expect(mapAosEffect('flipInX')).toBe('flip-up');
    expect(mapAosEffect('fadeIn')).toBe('fade');
    expect(mapAosEffect('wow')).toBe('fade-up'); // generic hint
    expect(mapAosEffect('pulse')).toBeNull(); // continuous → not a one-shot reveal
    expect(mapAosEffect('')).toBeNull();
  });

  it('parses + clamps timing', () => {
    expect(ms('400ms')).toBe(400);
    expect(ms('0.4s')).toBe(400);
    expect(ms('99s')).toBe(5000); // clamped
    expect(ms(undefined)).toBe(0);
  });

  it('builds data-aos attrs, dropping default-ish delay/duration', () => {
    expect(aosAttrs({ name: 'fadeInUp', delay: '0ms', dur: '400ms' })).toEqual({ effect: 'fade-up' }); // delay<50, dur~400 dropped
    expect(aosAttrs({ name: 'fadeInLeft', delay: '300ms', dur: '800ms' })).toEqual({ effect: 'fade-right', delay: 300, dur: 800 });
    expect(aosAttrs({ name: 'spin', delay: '0s', dur: '1s' })).toBeNull();
    expect(aosAttrs(null)).toBeNull();
  });
});

describe('toRoute — internal links → {{sw-url}}', () => {
  it('strips the source origin (incl. www) → a root-relative sw-url', () => {
    expect(toRoute('https://www.advancedtechcc.com/about-us/', ctx.originHosts)).toBe("{{sw-url '/about-us'}}");
    expect(toRoute('https://advancedtechcc.com/', ctx.originHosts)).toBe("{{sw-url '/'}}");
    expect(toRoute('/services/', ctx.originHosts)).toBe("{{sw-url '/services'}}");
    expect(toRoute('/contact#form', ctx.originHosts)).toBe("{{sw-url '/contact'}}#form");
  });
  it('leaves external / deep / unparseable links untouched', () => {
    expect(toRoute('https://example.com/x', ctx.originHosts)).toBe('https://example.com/x');
    expect(toRoute('/a/b/c', ctx.originHosts)).toBe('/a/b/c'); // not a single slug
    expect(toRoute(undefined, ctx.originHosts)).toBeUndefined();
  });
});

describe('mergeTree — responsive merge + snap decisions', () => {
  it('snaps a wide centered structural block to .sw-container (drops captured width/padding)', () => {
    const n = node('div', { width: '1140px', 'margin-left': '150px', 'margin-right': '150px', 'padding-left': '24px' }, {
      children: [node('p', { color: 'rgb(11, 74, 119)' }, { text: 'hi' })],
    });
    const merged = mergeTree(n, n, n, ctx);
    expect(merged.cls).toContain('sw-container');
    expect(merged.cls).not.toContain('w-['); // captured width dropped
  });

  it('adds min-w-0 to a flex child (overflow fix)', () => {
    const child = node('div', {});
    child.pflex = true;
    expect(mergeTree(child, child, child, ctx).cls).toContain('min-w-0');
  });

  it('maps an <i> FontAwesome icon to {{sw-icon}} (carrying size + color)', () => {
    const n = node('i', {}, { icon: 'fa fa-suitcase', iconSize: '40px', iconColor: 'rgb(11, 74, 119)' });
    const m = mergeTree(n, n, n, ctx);
    expect(m.swicon).toBe('briefcase');
  });

  it('detects a slider track child → marquee viewport', () => {
    const slide = node('div', { width: '120px' }, { children: [node('img', {}, { src: 'https://www.advancedtechcc.com/logo.png', alt: 'L' })] });
    const track = node('div', { width: '45000px' }, { children: [slide] });
    const viewport = node('div', { overflow: 'hidden' }, { children: [track] });
    const m = mergeTree(viewport, viewport, viewport, ctx);
    expect(m.swMarquee).toBe(true);
  });

  it('adds a subtle hover to a content-wrapping link TILE, not to a plain text link', () => {
    const tile = node('a', {}, { href: '/services/mining', children: [node('img', {}, { src: 'm.jpg', alt: '' }), node('h3', {}, { text: 'Mining' })] });
    expect(mergeTree(tile, tile, tile, ctx).cls).toContain('hover:opacity-90');
    const textLink = node('a', {}, { href: '/about', text: 'About' });
    expect(mergeTree(textLink, textLink, textLink, ctx).cls).not.toContain('hover:opacity-90');
  });
});

describe('emit hardening — captured external content is escaped, not injected', () => {
  it('entity-encodes attribute values (no breakout)', () => {
    const img = node('img', {}, { src: 'x.jpg" onload="alert(1)', alt: 'A " B & C' });
    const html = renderTree(mergeTrees([img], [img], [img], ctx), ctx).html;
    expect(html).not.toContain('onload="alert(1)"');
    expect(html).toContain('&quot;');
    expect(html).toContain('A &quot; B &amp; C');
  });

  it('entity-encodes text content (no markup injection)', () => {
    const p = node('p', {}, { text: '<script>alert(1)</script> & more' });
    const html = renderTree(mergeTrees([p], [p], [p], ctx), ctx).html;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; more');
  });

  it('neutralizes javascript:/data: hrefs to #', () => {
    const a = node('a', {}, { href: 'javascript:alert(1)', text: 'x' });
    expect(renderTree(mergeTrees([a], [a], [a], ctx), ctx).html).toContain('href="#"');
    const a2 = node('a', {}, { href: 'data:text/html,<x>', text: 'y' });
    expect(renderTree(mergeTrees([a2], [a2], [a2], ctx), ctx).html).toContain('href="#"');
  });

  it('drops attr-unsafe FA passthrough tokens', () => {
    const i = node('i', {}, { icon: 'fa fa-notanicon" onmouseover="evil' }); // unmapped → passthrough, but unsafe
    const html = renderTree(mergeTrees([i], [i], [i], ctx), ctx).html;
    expect(html).not.toContain('onmouseover');
  });

  it('an empty origin host does NOT become a catch-all that internalizes external links', () => {
    expect(toRoute('https://google.com/page', [''])).toBe('https://google.com/page');
  });
});

describe('renderTree — tree → Handlebars HTML', () => {
  it('renders a basic section with classes + an internal link', () => {
    const a = node('a', {}, { href: 'https://www.advancedtechcc.com/about-us/', text: 'About' });
    const sec = node('div', { display: 'flex' }, { children: [a] });
    const m = mergeTrees([sec], [sec], [sec], ctx);
    const { html } = renderTree(m, ctx);
    expect(html).toContain('<div class="flex">');
    expect(html).toContain("href=\"{{sw-url '/about-us'}}\"");
    expect(html).toContain('About');
  });

  it('snaps a marquee to {{> logo-marquee}} and collects its logos', () => {
    const slide = node('div', { width: '120px' }, { children: [node('img', {}, { src: 'https://www.advancedtechcc.com/p1.png', alt: 'P1' })] });
    const track = node('div', { width: '45000px' }, { children: [slide] });
    const viewport = node('div', { overflow: 'hidden' }, { children: [track] });
    const { html, marqueeLogos } = renderTree(mergeTrees([viewport], [viewport], [viewport], ctx), ctx);
    expect(html).toContain('{{> logo-marquee}}');
    expect(marqueeLogos).toEqual([{ image: 'https://www.advancedtechcc.com/p1.png', alt: 'P1' }]);
  });

  it('rebuilds a 3D flip card from a .flippable subtree (clean faces, named 3D utilities)', () => {
    const icon = node('i', {}, { icon: 'fa fa-rocket' });
    const front = node('div', {}, { children: [icon, node('h3', {}, { text: 'Setup' })] });
    const back = node('div', {}, { text: 'We get you ready.', isBack: true });
    const card = node('div', {}, { flip: true, flipH: '224px', children: [front, back] });
    const { html } = renderTree(mergeTrees([card], [card], [card], ctx), ctx);
    expect(html).toContain('perspective-distant');
    expect(html).toContain('group-hover:rotate-y-180');
    expect(html).toContain('backface-hidden');
    expect(html).toContain('{{sw-icon "rocket"');
    expect(html).toContain('Setup');
    expect(html).toContain('We get you ready.');
  });

  it('duplicates a marquee track\'s slides for the seamless loop (2nd copy aria-hidden)', () => {
    // A bare track (no overflow-hidden viewport wrapper) renders as .sw-marquee-track with doubled slides.
    const slide = node('div', { width: '120px' }, { text: 'A' });
    const track = node('div', { width: '45000px' }, { children: [slide] });
    const { html } = renderTree(mergeTrees([track], [track], [track], ctx), ctx);
    expect(html).toContain('sw-marquee-track');
    expect(html).toContain('data-sw-marquee-dup');
    expect(html).toContain('aria-hidden="true"');
  });

  it('drops a back face that repeats the front title', () => {
    const front = node('div', {}, { children: [node('h3', {}, { text: 'Training' })] });
    const back = node('div', {}, { text: 'Training Hands-on sessions.', isBack: true });
    const card = node('div', {}, { flip: true, children: [front, back] });
    const { html } = renderTree(mergeTrees([card], [card], [card], ctx), ctx);
    expect(html).toContain('<p>Hands-on sessions.</p>'); // title prefix stripped from the back
    expect(html).toContain('h-56'); // default height when flipH absent
  });

  it('renders {{sw-icon}} honoring captured size + color (token, then bare)', () => {
    const sized = node('i', {}, { icon: 'fa fa-phone', iconSize: '24px', iconColor: 'rgb(11, 74, 119)' });
    expect(renderTree(mergeTrees([sized], [sized], [sized], ctx), ctx).html)
      .toBe('{{sw-icon "phone" "inline-block align-[-0.125em] h-6 w-6 text-primary"}}');
    const bare = node('span', {}, { icon: 'fab fa-instagram' });
    expect(renderTree(mergeTrees([bare], [bare], [bare], ctx), ctx).html)
      .toBe('{{sw-icon "brand:instagram" "inline-block align-[-0.125em] h-[1em] w-[1em]"}}');
  });

  it('renders responsive overrides across viewports (mobile flex-col → desktop row)', () => {
    const colS = { display: 'flex', 'flex-direction': 'column' };
    const rowS = { display: 'flex' };
    const m = mergeTree(node('div', colS), node('div', colS), node('div', rowS), ctx);
    expect(m.cls).toContain('flex-col');
    expect(m.cls).toContain('lg:flex-row');
  });
});

describe('snapButton — button / button-link → SW button system', () => {
  const pad = { 'padding-left': '24px', 'padding-right': '24px', 'padding-top': '12px', 'padding-bottom': '12px' };
  it('snaps a brand-fill control to the matching face (captured color dropped)', () => {
    expect(snapButton({ 'background-color': 'rgb(11, 74, 119)', ...pad }, 'a', ctx.palette)).toEqual({ classes: 'btn btn-primary', keepColor: false });
    expect(snapButton({ 'background-color': 'rgb(57, 193, 240)', ...pad }, 'a', ctx.palette)?.classes).toBe('btn btn-secondary');
  });
  it('snaps a border-only control to btn-outline (+ brand face when the border is a brand color)', () => {
    expect(snapButton({ 'border-top-width': '2px', 'border-top-color': 'rgb(11, 74, 119)', ...pad }, 'a', ctx.palette)?.classes).toBe('btn btn-outline btn-primary');
    expect(snapButton({ 'border-top-width': '1px', 'border-top-color': 'rgb(20, 20, 20)', ...pad }, 'a', ctx.palette)?.classes).toBe('btn btn-outline');
  });
  it('keeps the color for a non-brand fill; a bare <button> → neutral', () => {
    expect(snapButton({ 'background-color': 'rgb(34, 197, 94)', ...pad }, 'a', ctx.palette)).toEqual({ classes: 'btn', keepColor: true });
    expect(snapButton({}, 'button', ctx.palette)).toEqual({ classes: 'btn btn-neutral', keepColor: false });
  });
  it('a transparent text/icon button (a text color, no fill/border) → btn-ghost KEEPING its color', () => {
    expect(snapButton({ color: 'rgb(180, 42, 51)', ...pad }, 'button', ctx.palette)).toEqual({ classes: 'btn btn-ghost', keepColor: true });
  });
  it('a LARGE-font box (heading-sized link/card) is NOT a button', () => {
    expect(snapButton({ 'font-size': '36px', 'border-top-width': '2px', 'border-top-color': 'rgb(180, 42, 51)', ...pad }, 'a', ctx.palette)).toBeNull();
  });
  it('snaps a small ~square fill with no padding to a btn-square icon button', () => {
    expect(snapButton({ 'background-color': 'rgb(12, 163, 200)', width: '50px', height: '50px' }, 'a', ctx.palette)).toEqual({ classes: 'btn btn-square', keepColor: true });
    expect(snapButton({ 'background-color': 'rgb(11, 74, 119)', width: '48px', height: '48px' }, 'a', ctx.palette)?.classes).toBe('btn btn-square btn-primary');
  });
  it('derives size from padding / font-size', () => {
    expect(snapButton({ 'background-color': 'rgb(11, 74, 119)', 'padding-left': '32px', 'padding-right': '32px', 'padding-top': '18px', 'padding-bottom': '18px' }, 'a', ctx.palette)?.classes).toBe('btn btn-primary btn-lg');
    expect(snapButton({ 'background-color': 'rgb(11, 74, 119)', 'padding-left': '12px', 'padding-right': '12px', 'padding-top': '5px', 'padding-bottom': '5px' }, 'a', ctx.palette)?.classes).toBe('btn btn-primary btn-sm');
  });
  it('leaves plain links alone', () => {
    expect(snapButton({ color: 'rgb(11, 74, 119)' }, 'a', ctx.palette)).toBeNull();
    expect(snapButton({ 'background-color': 'rgb(11, 74, 119)', ...pad }, 'div', ctx.palette)).toBeNull(); // not a/button
  });
  it('renders a brand button-link with the face (no color), and KEEPS a non-brand color', () => {
    const a = node('a', { 'background-color': 'rgb(11, 74, 119)', ...pad }, { href: 'https://www.advancedtechcc.com/contact/', text: 'Contact us' });
    const html = renderTree(mergeTrees([a], [a], [a], ctx), ctx).html;
    expect(html).toContain('class="btn btn-primary"');
    expect(html).toContain("href=\"{{sw-url '/contact'}}\"");
    expect(html).not.toContain('bg-['); // brand face → captured fill dropped
    const g = node('a', { 'background-color': 'rgb(34, 197, 94)', ...pad }, { href: '/x', text: 'Go' });
    expect(renderTree(mergeTrees([g], [g], [g], ctx), ctx).html).toMatch(/class="btn[^"]*bg-\[#22c55e\]/); // non-brand → color kept
  });
});

describe('modal snapping → <dialog data-sw-component="modal"> + wired triggers', () => {
  it('renders a modal container as a native dialog (drops the hidden display)', () => {
    const modal = node('div', { display: 'none', 'background-color': 'rgb(255, 255, 255)' }, { isModal: true, id: 'signup', children: [node('p', {}, { text: 'Join us' })] });
    const html = renderTree(mergeTrees([modal], [modal], [modal], ctx), ctx).html;
    expect(html).toContain('<dialog id="signup" data-sw-component="modal"');
    expect(html).toContain('</dialog>');
    expect(html).toContain('Join us');
    expect(html).not.toContain('hidden'); // the captured display:none is dropped — the dialog owns visibility
  });
  it('wires an <a> trigger via href="#id" and a <button> trigger via data-sw-modal', () => {
    const pad = { 'padding-left': '24px', 'padding-right': '24px', 'padding-top': '12px', 'padding-bottom': '12px' };
    const aTrig = node('a', { 'background-color': 'rgb(11, 74, 119)', ...pad }, { modalTarget: 'signup', text: 'Open' });
    expect(renderTree(mergeTrees([aTrig], [aTrig], [aTrig], ctx), ctx).html).toContain('href="#signup"');
    const btnTrig = node('button', {}, { modalTarget: 'signup', text: 'Open' });
    const bh = renderTree(mergeTrees([btnTrig], [btnTrig], [btnTrig], ctx), ctx).html;
    expect(bh).toContain('data-sw-modal="signup"');
    expect(bh).toContain('class="btn btn-neutral"');
  });
});

describe('component snapping → carousel / tabs / accordion (static markup)', () => {
  it('snaps a carousel: root markers + track/slide parts + prev/next/dots', () => {
    const slide1 = node('div', {}, { snap: 'carousel-slide', children: [node('p', {}, { text: 'Slide one' })] });
    const slide2 = node('div', {}, { snap: 'carousel-slide', children: [node('p', {}, { text: 'Slide two' })] });
    const track = node('div', {}, { snap: 'carousel-track', children: [slide1, slide2] });
    const root = node('div', {}, { snap: 'carousel', children: [track] });
    const html = renderTree(mergeTrees([root], [root], [root], ctx), ctx).html;
    expect(html).toContain('data-sw-component="carousel"');
    expect(html).toContain('data-sw-block="Carousel"');
    expect(html).toContain('class="relative"'); // overlay arrows need a positioned root
    expect(html).toContain('data-sw-part="track"');
    expect((html.match(/data-sw-part="slide"/g) || []).length).toBe(2);
    expect(html).toContain('data-sw-part="prev"');
    expect(html).toContain('data-sw-part="next"');
    expect(html).toContain('data-sw-part="dots"');
    expect(html).toContain('Slide one');
  });

  it('snaps Bootstrap tabs: container → tabs, panes → panels w/ titles, nav buttons dropped', () => {
    const nav = node('ul', {}, { snap: 'drop', children: [node('li', {}, { text: 'NAV-LABEL' })] });
    const pane1 = node('div', {}, { snap: 'tab-panel', tabTitle: 'Overview', children: [node('p', {}, { text: 'Panel one' })] });
    const pane2 = node('div', {}, { snap: 'tab-panel', tabTitle: 'Details', children: [node('p', {}, { text: 'Panel two' })] });
    const content = node('div', {}, { snap: 'tabs', children: [pane1, pane2] });
    const wrapper = node('div', {}, { children: [nav, content] });
    const html = renderTree(mergeTrees([wrapper], [wrapper], [wrapper], ctx), ctx).html;
    expect(html).toContain('data-sw-component="tabs"');
    expect((html.match(/data-sw-part="panel"/g) || []).length).toBe(2);
    expect(html).toContain('data-sw-title="Overview"');
    expect(html).toContain('data-sw-title="Details"');
    expect(html).toContain('Panel one');
    expect(html).not.toContain('NAV-LABEL'); // the source's tab buttons are dropped (runtime rebuilds them)
  });

  it('snaps a Bootstrap accordion to native <details>/<summary> (wrappers unwrapped)', () => {
    const btn = node('button', {}, { snap: 'summary', text: 'Question one' });
    const header = node('h2', {}, { snap: 'unwrap', children: [btn] });
    const body = node('div', {}, { children: [node('p', {}, { text: 'Answer one' })] });
    const collapse = node('div', { display: 'none' }, { snap: 'unwrap', children: [body] });
    const item = node('div', {}, { snap: 'details', children: [header, collapse] });
    const html = renderTree(mergeTrees([item], [item], [item], ctx), ctx).html;
    expect(html).toContain('<details');
    expect(html).toContain('<summary');
    expect(html).toContain('Question one');
    expect(html).toContain('Answer one');
    expect(html).not.toContain('<h2'); // accordion-header unwrapped
    expect(html).not.toContain('hidden'); // collapse unwrapped → its display:none is gone
  });
});

describe('expandCarouselDirect — owl / declarative-slick (slides are direct children)', () => {
  it('synthesizes a track wrapping the direct children, each marked a slide', () => {
    const root = node('div', { width: '900px' }, { snap: 'carousel-direct', children: [
      node('div', {}, { text: 'Slide A' }),
      node('div', {}, { text: 'Slide B' }),
      node('div', {}, { text: 'Slide C' }),
    ] });
    const [expanded] = expandCarouselDirect([root]);
    expect(expanded!.snap).toBe('carousel');
    expect(expanded!.children).toHaveLength(1);
    const track = expanded!.children[0]!;
    expect(track.snap).toBe('carousel-track');
    expect(track.children).toHaveLength(3);
    expect(track.children.every((c) => c.snap === 'carousel-slide')).toBe(true);
  });

  it('renders an owl/slick-direct root as a full platform carousel', () => {
    const root = node('div', {}, { snap: 'carousel-direct', children: [
      node('div', {}, { children: [node('p', {}, { text: 'One' })] }),
      node('div', {}, { children: [node('p', {}, { text: 'Two' })] }),
    ] });
    const html = renderTree(mergeTrees([root], [root], [root], ctx), ctx).html;
    expect(html).toContain('data-sw-component="carousel"');
    expect(html).toContain('data-sw-part="track"');
    expect((html.match(/data-sw-part="slide"/g) || []).length).toBe(2);
    expect(html).toContain('data-sw-part="prev"');
    expect(html).toContain('One');
    expect(html).toContain('Two');
  });
});

describe('renderTree — fold-based lazy loading', () => {
  const r = (n: CapturedNode): string => renderTree([mergeTree(n, n, n, ctx)], ctx).html;

  it('images: eager above the fold, lazy below', () => {
    expect(r(node('img', {}, { src: '/hero.jpg', alt: 'h', belowFold: false }))).toContain('loading="eager"');
    expect(r(node('img', {}, { src: '/tile.jpg', alt: 't', belowFold: true }))).toContain('loading="lazy"');
  });

  it('backgrounds stay EAGER inline styles regardless of fold (a deferred bg would flash black under a dark overlay)', () => {
    const above = r(node('div', { 'background-image': 'url(/a.jpg)' }, { belowFold: false, children: [node('p', {}, { text: 'x' })] }));
    const below = r(node('div', { 'background-image': 'url(/b.jpg)' }, { belowFold: true, children: [node('p', {}, { text: 'y' })] }));
    expect(above).toMatch(/style="[^"]*background-image:url\(\/a\.jpg\)/);
    expect(below).toMatch(/style="[^"]*background-image:url\(\/b\.jpg\)/);
    expect(below).not.toContain('data-bg'); // never deferred
  });
});
