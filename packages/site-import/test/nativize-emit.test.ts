import { describe, expect, it } from 'vitest';
import { mapAosEffect, ms, aosAttrs } from '../src/nativize/aos.js';
import { mergeTree, mergeTrees, renderTree, toRoute, type CapturedNode, type NativizeContext } from '../src/nativize/emit.js';
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
