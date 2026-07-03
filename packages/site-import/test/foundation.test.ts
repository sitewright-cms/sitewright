import { describe, expect, it } from 'vitest';
import { validateTemplate } from '@sitewright/blocks';
import type { Page } from '@sitewright/schema';
import {
  applyFoundation,
  cleanNavLabel,
  configurePageNav,
  extractBodyBgImage,
  extractContentWidth,
  extractColors,
  extractHeaderDecor,
  extractTypography,
  foundationCriticalCss,
  isIconFont,
  nativeFooter,
  nativeMainNav,
  readCssVars,
  type HostedFont,
} from '../src/transform/foundation.js';

// Foreign CSS mirroring a real imported site (burmeister-style): brand color vars + @font-face woffs +
// var()-indirected heading/body font-family.
const CSS = `
:root{
  --primary-color:#B42A33; --secondary-color:#565656; --tertiary-color:#880088;
  --text-color:#222222; --bg-color:#e8e8ea;
  --primary-font:"primary-font"; --secondary-font:"secondary-font"; --text-font:"secondary-font";
}
@font-face{font-family:"primary-font";src:url('/media/s/aaa/primary-font-400.woff') format('woff');}
@font-face{font-family:"secondary-font";src:url('/media/s/bbb/secondary-font-400.woff') format('woff');}
body,html{color:var(--text-color);font-family:var(--text-font),Verdana,sans-serif;}
.bm-header{background:#B42A33;font-family:var(--primary-font);}
`;

const FONTS: HostedFont[] = [
  { family: 'primary-font', assetId: 'aaa', weight: 700, style: 'normal' },
  { family: 'secondary-font', assetId: 'bbb', weight: 400, style: 'normal' },
];

const page = (id: string, path: string, title: string, parent?: string): Page =>
  ({ id, path, title, ...(parent ? { parent } : {}) }) as unknown as Page;

describe('readCssVars', () => {
  it('reads custom properties (last wins)', () => {
    const v = readCssVars(CSS);
    expect(v.get('primary-color')).toBe('#B42A33');
    expect(v.get('text-font')).toBe('"secondary-font"');
  });
});

describe('extractColors', () => {
  it('maps the foreign palette to SW tokens', () => {
    const c = extractColors(CSS);
    expect(c.primary).toBe('#B42A33');
    expect(c.secondary).toBe('#565656');
    expect(c.accent).toBe('#880088'); // tertiary → accent
    expect(c['base-content']).toBe('#222222'); // text → base-content
    expect(c['base-200']).toBe('#e8e8ea'); // bg → base-200
  });
  it('ignores non-colors and transparent/inherit', () => {
    expect(extractColors('--primary-color:inherit;--secondary-color:var(--x)')).toEqual({});
  });
});

describe('extractTypography', () => {
  it('matches heading + body fonts via var-indirected font-family', () => {
    const t = extractTypography(CSS, FONTS);
    expect(t.heading).toMatchObject({ source: 'asset', assetId: 'aaa', weight: 700 });
    expect(t.body).toMatchObject({ source: 'asset', assetId: 'bbb', weight: 400 });
  });
  it('falls back to "the other font" when only one side matches', () => {
    // only a heading rule resolves; body should still get the other hosted font
    const css = `.bm-header{font-family:var(--primary-font)} :root{--primary-font:"primary-font"}`;
    const t = extractTypography(css, FONTS);
    expect(t.heading?.assetId).toBe('aaa');
    expect(t.body?.assetId).toBe('bbb');
  });
  it('returns empty when no fonts are hosted', () => {
    expect(extractTypography(CSS, [])).toEqual({});
  });

  it('resolves roles from semantic --*-font vars + !important, applied via classes, falling back for the unhosted body face', () => {
    // mirrors a real site (burmeister): brand fonts are --*-font vars applied via CLASSES (.primary-font),
    // body uses var(--text-font)!important, and only the heading woff + a second woff are self-hosted.
    const css = `
      :root{--primary-font:"primary-font";--text-font:"text-font";--secondary-font:"secondary-font";}
      @font-face{font-family:"primary-font";src:url('/p.woff')}
      @font-face{font-family:"secondary-font";src:url('/s.woff')}
      body,html{font-family:var(--text-font)!important}
      .primary-font{font-family:var(--primary-font)!important}
      h1{font-family:inherit}
    `;
    const fonts: HostedFont[] = [
      { family: 'primary-font', assetId: 'p', weight: 700, style: 'normal' },
      { family: 'secondary-font', assetId: 's', weight: 400, style: 'normal' },
      { family: 'FontAwesome', assetId: 'fa', weight: 400, style: 'normal' }, // icon font — must be ignored
    ];
    const t = extractTypography(css, fonts);
    expect(t.heading).toMatchObject({ source: 'asset', assetId: 'p' }); // from --primary-font var
    expect(t.body).toMatchObject({ source: 'asset', assetId: 's' }); // text-font not hosted → other non-icon font
    expect(t.body?.family).not.toBe('FontAwesome');
  });

  it('never adopts an icon font as the only face', () => {
    expect(extractTypography(CSS, [{ family: 'FontAwesome', assetId: 'fa', weight: 400, style: 'normal' }])).toEqual({});
  });

  it('resolves a LOCAL()-only @font-face role to a SYSTEM slot, not the hosted DISPLAY woff', () => {
    // globalinsti: --primary-font (all headings) is `src:local("Times New Roman")` — a system serif with no
    // woff to host; only the techno secondary-font + the body text-font are hostable. The heading must be the
    // system serif, NOT the techno display woff the old "other font" fallback wrongly adopted.
    const css = `
      :root{--primary-font:"primary-font";--secondary-font:"secondary-font";--text-font:"text-font";}
      @font-face{font-family:"primary-font";src:local("Times New Roman")}
      @font-face{font-family:"secondary-font";src:url('/nec.woff')}
      @font-face{font-family:"text-font";src:url('/open-sans.woff')}
      body{font-family:var(--text-font)} .primary-font{font-family:var(--primary-font)}
    `;
    const fonts: HostedFont[] = [
      { family: 'secondary-font', assetId: 's', weight: 400, style: 'normal' }, // techno display woff
      { family: 'text-font', assetId: 't', weight: 400, style: 'normal' }, // body woff
    ];
    const out = extractTypography(css, fonts);
    expect(out.heading).toEqual({ source: 'system', family: 'Times New Roman', weight: 700 });
    expect(out.body).toMatchObject({ source: 'asset', assetId: 't' });
  });

  it('does NOT treat a local()+url() @font-face as system — the hosted woff is matched', () => {
    const css = `:root{--primary-font:"brand";} @font-face{font-family:"brand";src:local("Arial"),url('/brand.woff')} .primary-font{font-family:var(--primary-font)}`;
    const fonts: HostedFont[] = [{ family: 'brand', assetId: 'br', weight: 700, style: 'normal' }];
    const out = extractTypography(css, fonts);
    expect(out.heading).toMatchObject({ source: 'asset', assetId: 'br' }); // hostable woff, not a system slot
  });

  it('resolves an ALIAS family to a hosted woff that deduped under a DIFFERENT alias name (shared src url)', () => {
    // droombos: primary-font (heading) + text-font (body) BOTH @font-face → the SAME gotham.woff. The content-
    // hash media dedup hosts it ONCE, under "primary-font". A name-only match dropped the body ("text-font");
    // resolving via the shared @font-face src url now maps it to the same hosted asset.
    const css = `
      :root{--primary-font:"primary-font";--text-font:"text-font";}
      @font-face{font-family:"primary-font";src:url('/gotham.woff')}
      @font-face{font-family:"text-font";src:url('/gotham.woff')}
      body{font-family:var(--text-font)} .primary-font{font-family:var(--primary-font)}
    `;
    const fonts: HostedFont[] = [{ family: 'primary-font', assetId: 'g', weight: 700, style: 'normal' }]; // deduped → ONE asset
    const out = extractTypography(css, fonts);
    expect(out.heading).toMatchObject({ source: 'asset', assetId: 'g' });
    expect(out.body).toMatchObject({ source: 'asset', assetId: 'g' }); // ← was dropped before the url-alias match
  });

  it('does NOT cross-resolve two families that have DIFFERENT src urls (no false alias collapse)', () => {
    const css = `
      :root{--primary-font:"primary-font";--text-font:"text-font";}
      @font-face{font-family:"primary-font";src:url('/heading.woff')}
      @font-face{font-family:"text-font";src:url('/body.woff')}
      body{font-family:var(--text-font)} .primary-font{font-family:var(--primary-font)}
    `;
    const fonts: HostedFont[] = [
      { family: 'primary-font', assetId: 'h', weight: 700, style: 'normal' },
      { family: 'text-font', assetId: 'b', weight: 400, style: 'normal' },
    ];
    const out = extractTypography(css, fonts);
    expect(out.heading).toMatchObject({ assetId: 'h' });
    expect(out.body).toMatchObject({ assetId: 'b' }); // distinct urls → each resolves to its OWN asset
  });
});

describe('foundationCriticalCss', () => {
  it('emits the bp-hero + bp-card helpers and a body background', () => {
    const css = foundationCriticalCss('#e8e8ea');
    expect(css).toContain('.bp-hero::before');
    expect(css).toContain('.bp-card');
    expect(css).toContain('background-color:#e8e8ea');
    expect(css.length).toBeLessThan(10_000); // CSS_MAX
  });
  it('uses the generic NOISE texture when no real body image is given', () => {
    expect(foundationCriticalCss('#e8e8ea')).toContain('fractalNoise');
  });
  it('uses the REAL body background-image when provided (no generic noise)', () => {
    const real = "url('/media/burmeister/abc/bg-brushed-aluminum-dark.png')";
    const css = foundationCriticalCss('#cccccc', real);
    expect(css).toContain(real);
    expect(css).not.toContain('fractalNoise');
  });
});

describe('extractContentWidth', () => {
  it('reads a width-ish CSS var (the reliable signal)', () => {
    expect(extractContentWidth(':root{--template-width:1400px}body{x:1}')).toBe('1400px');
    expect(extractContentWidth('--content-width: 1320px;')).toBe('1320px');
  });
  it('ignores out-of-range + non-width vars, returns undefined with no signal', () => {
    expect(extractContentWidth('--gap-width:24px;--primary-color:#fff')).toBeUndefined();
    expect(extractContentWidth('.container{max-width:1140px}')).toBeUndefined(); // not a var → no false positive
  });
});

describe('extractBodyBgImage', () => {
  const map = new Map([['https://ex.com/_data/assets/bg-brushed.png', '/media/s/main/bg-brushed.png']]);
  it('captures the source body background-image and rewrites its url() to /media', () => {
    const css = "body{margin:0;background-color:#ccc;background-image:url('https://ex.com/_data/assets/bg-brushed.png')}";
    expect(extractBodyBgImage(css, map)).toBe("url('/media/s/main/bg-brushed.png')");
  });
  it('returns empty when the source declares no body background-image', () => {
    expect(extractBodyBgImage('body{margin:0;color:#111}', map)).toBe('');
  });
  it('drops an unresolved foreign hotlink (never ship a non-hosted url)', () => {
    const css = "body{background-image:url('https://other.com/x.png')}";
    expect(extractBodyBgImage(css, map)).toBe('');
  });
  it('keeps an inline data: texture as-is', () => {
    const css = "html{background-image:url(\"data:image/svg+xml,%3Csvg/%3E\")}";
    expect(extractBodyBgImage(css, map)).toContain('data:image/svg+xml');
  });
});

describe('nativeMainNav', () => {
  it('is data-driven (iterates nav.header) and uses no <nav> landmark', () => {
    const nav = nativeMainNav({ name: 'Acme', logo: '/media/s/main/logo.webp' });
    expect(nav).toContain('{{#each nav.header}}');
    expect(nav).toContain('{{sw-label}}');
    expect(nav).toContain('(sw-active path)');
    expect(nav).not.toMatch(/<nav[\s>]/); // the platform owns the <nav id="main-nav"> landmark
    expect(nav).toContain('/media/s/main/logo.webp');
  });

  it('re-pins captured left/right decorations to the bar edges (desktop, aria-hidden), and validates', () => {
    const nav = nativeMainNav({ name: 'Acme' }, { left: '/media/s/hl/header-left.png', right: '/media/s/hr/header-right.png' });
    const leftImg = nav.match(/<img src="\/media\/s\/hl\/header-left\.png"[^>]*>/)?.[0] ?? '';
    expect(leftImg).toContain('aria-hidden');
    expect(leftImg).toMatch(/\babsolute\b/);
    expect(leftImg).toMatch(/\bleft-0\b/);
    expect(nav.match(/<img src="\/media\/s\/hr\/header-right\.png"[^>]*>/)?.[0] ?? '').toMatch(/\bright-0\b/);
    expect(nav).toContain('navbar relative'); // positioning context for the absolute decorations
    expect(() => validateTemplate(nav)).not.toThrow();
  });

  it('renders NO decoration wrapper when the source had none (byte-clean default)', () => {
    const nav = nativeMainNav({ name: 'Acme' });
    expect(nav).not.toContain('aria-hidden');
    expect(nav).toContain('navbar min-h-0'); // no ` relative` inserted
  });
});

describe('extractHeaderDecor', () => {
  const assetMap = new Map<string, string>([
    ['https://x.test/header-left.png', '/media/s/hl/header-left.png'],
    ['https://x.test/header-right.png', '/media/s/hr/header-right.png'],
  ]);

  it('captures a #nav::before/::after left+right decoration pair, resolved to hosted refs', () => {
    const css = `
      #top-nav:before{position:absolute;left:0;width:200px;background-image:url(https://x.test/header-left.png);background-position:center left;content:" "}
      #top-nav:after{position:absolute;right:0;width:200px;background-image:url(https://x.test/header-right.png);background-position:center right;content:" "}
    `;
    expect(extractHeaderDecor(css, assetMap)).toEqual({ left: '/media/s/hl/header-left.png', right: '/media/s/hr/header-right.png' });
  });

  it('ignores pseudo-element backgrounds on NON-header selectors', () => {
    const css = `.hero-band:before{background-image:url(https://x.test/header-left.png)}`;
    expect(extractHeaderDecor(css, assetMap)).toEqual({});
  });

  it('drops a decoration whose url is not a hosted asset (never a foreign hotlink)', () => {
    const css = `.site-header:before{left:0;background-image:url(https://cdn.other/deco.png)}`;
    expect(extractHeaderDecor(css, new Map())).toEqual({});
  });

  it('matches a BARE tag selector (header::before) and a single-sided decoration', () => {
    const css = `header::before{background-image:url(https://x.test/header-left.png);background-position:left}`;
    expect(extractHeaderDecor(css, assetMap)).toEqual({ left: '/media/s/hl/header-left.png' });
  });

  it('classifies by FILENAME segment when there is no background-position', () => {
    const css = `#nav:before{background-image:url(https://x.test/header-left.png)}#nav:after{background-image:url(https://x.test/header-right.png)}`;
    expect(extractHeaderDecor(css, assetMap)).toEqual({ left: '/media/s/hl/header-left.png', right: '/media/s/hr/header-right.png' });
  });

  it('does NOT false-match "right"/"left" as a substring of an unrelated filename word', () => {
    // brightwood-header.png must NOT be classified 'right'; with no position + no delimited segment it falls
    // back to ::before=left.
    const css = `.navbar:before{background-image:url(https://x.test/brightwood-header.png)}`;
    expect(extractHeaderDecor(css, new Map([['https://x.test/brightwood-header.png', '/media/s/bw/brightwood-header.png']]))).toEqual({ left: '/media/s/bw/brightwood-header.png' });
  });
});

describe('nativeFooter', () => {
  it('renders company + contacts, no <footer> landmark', () => {
    const f = nativeFooter({ name: 'Acme', email: 'hi@acme.com', telephone: '+1 555 000' });
    expect(f).toContain('Acme');
    expect(f).toContain('mailto:hi@acme.com');
    expect(f).toContain('tel:+1555000');
    expect(f).not.toMatch(/<footer[\s>]/);
  });

  it('embeds the captured map via the {{sw-url company.mapUrl}} HELPER and PASSES validateTemplate', () => {
    const f = nativeFooter({ name: 'Acme', mapUrl: 'https://www.google.com/maps/embed?pb=1' });
    // MUST be the sw-url helper, not a bare `{{company.mapUrl}}` — validateTemplate rejects a bare value in a URL
    // attribute, which would render on import but BLOCK every later settings save (validateSourceOnSave re-checks it).
    expect(f).toContain('<iframe src="{{sw-url company.mapUrl}}"'); // data-driven, editable in CI settings
    expect(f).toContain('loading="lazy"');
    expect(f).toContain('sandbox="allow-scripts allow-same-origin allow-popups allow-forms"'); // can't nav top
    expect(f).toMatch(/class="[^"]*\bskeleton\b/); // loading placeholder while it loads
    expect(() => validateTemplate(f)).not.toThrow(); // the generated footer must survive a settings save
  });

  it('omits the map iframe when the source had no map (still a valid template)', () => {
    const f = nativeFooter({ name: 'Acme' });
    expect(f).not.toContain('iframe');
    expect(() => validateTemplate(f)).not.toThrow();
  });
});

describe('configurePageNav', () => {
  it('puts top-level pages in header+mobile, names Home, nests children under dropdown parents', () => {
    const pages = [
      page('home', '', 'Home page'),
      page('about', 'about', 'About'),
      page('services', 'services', 'Our Services'),
      page('profile', 'about/profile', 'The Company', 'about'),
      page('agri', 'services/agri', 'Agri', 'services'),
    ];
    configurePageNav(pages);
    const byId = Object.fromEntries(pages.map((p) => [p.id, p])) as Record<string, Page>;
    expect(byId.home!.nav).toMatchObject({ slots: ['header'], order: 0, title: 'Home' });
    expect(byId.about!.nav).toMatchObject({ dropdown: true });
    expect(byId.services!.nav).toMatchObject({ dropdown: true });
    // children carry NO nav object (they nest via parent) — empty slots would be rejected on PUT
    expect(byId.profile!.nav).toBeUndefined();
    expect(byId.agri!.nav).toBeUndefined();
    expect(byId.agri!.order).toBe(0); // first (only) child of services
  });

  it('sets a clean per-page nav LABEL (strips the site-name suffix) — R13b', () => {
    const pages = [
      page('home', '', 'eTaxi Worldwide'),
      page('imprint', 'imprint', 'Imprint | eTaxi Worldwide'),
      page('privacy', 'privacy-policy', 'Privacy Policy – eTaxi Worldwide'),
    ];
    configurePageNav(pages, 'eTaxi Worldwide');
    const byId = Object.fromEntries(pages.map((p) => [p.id, p])) as Record<string, Page>;
    expect(byId.home!.nav!.title).toBe('Home');
    expect(byId.imprint!.nav!.title).toBe('Imprint'); // suffix stripped
    expect(byId.privacy!.nav!.title).toBe('Privacy Policy'); // en-dash suffix stripped
  });
});

describe('cleanNavLabel', () => {
  it('strips a trailing or leading site-name separator', () => {
    expect(cleanNavLabel('Imprint | eTaxi Worldwide', 'eTaxi Worldwide')).toBe('Imprint');
    expect(cleanNavLabel('eTaxi Worldwide - About', 'eTaxi Worldwide')).toBe('About');
    expect(cleanNavLabel('Contact', 'eTaxi Worldwide')).toBe('Contact'); // no suffix → unchanged
    expect(cleanNavLabel('eTaxi Worldwide', 'eTaxi Worldwide')).toBe('eTaxi Worldwide'); // don't blank it out
  });
});

describe('isIconFont', () => {
  it('flags icon/glyph fonts, not text fonts', () => {
    expect(isIconFont('FontAwesome')).toBe(true);
    expect(isIconFont('icomoon')).toBe(true);
    expect(isIconFont('Material Icons')).toBe(true);
    expect(isIconFont('primary-font')).toBe(false);
    expect(isIconFont(undefined)).toBe(false);
  });
});

describe('applyFoundation', () => {
  it('sets theme + fonts + native chrome and discards foreign css/js', () => {
    const identity = { name: 'Burmeister', logo: '/media/s/main/logo.webp', colors: {} } as never;
    const website = { head: '<link rel="stylesheet" href="/media/s/x/styles.css">', scripts: '<script src="/media/s/y/app.js"></script>' } as never;
    const pages = [page('home', '', 'Home'), page('about', 'about', 'About'), page('profile', 'about/profile', 'Profile', 'about')];
    const r = applyFoundation({ cssText: CSS, identity, website, pages, hostedFonts: FONTS });
    // colors
    expect(r.identity.colors.primary).toBe('#B42A33');
    expect(r.identity.colors.secondary).toBe('#565656');
    // fonts (native typography path)
    expect(r.identity.typography?.heading?.assetId).toBe('aaa');
    expect(r.identity.typography?.body?.assetId).toBe('bbb');
    // foreign css/js discarded; native chrome + criticalCss in
    expect(r.website.head ?? '').toBe('');
    expect(r.website.scripts ?? '').toBe('');
    expect(r.website.mainNav).toContain('{{#each nav.header}}');
    expect(r.website.criticalCss).toContain('.bp-hero');
    expect(r.website.criticalCss).toContain('#e8e8ea'); // the captured foreign bg flows into the body rule
    // page nav configured
    expect(pages.find((p) => p.id === 'home')!.nav).toMatchObject({ title: 'Home' });
    expect(r.diagnostics[0]!.code).toBe('foundation-applied');
  });

  it('reports (does not silently swallow) a discarded foreign sidebar — R28', () => {
    const identity = { name: 'Acme', logo: '/media/s/m/logo.webp', colors: {} } as never;
    const withSidebar = { sidebarLeft: '<div class="foreign-sidebar">menu</div>' } as never;
    const r1 = applyFoundation({ cssText: CSS, identity, website: withSidebar, pages: [page('home', '', 'Home')], hostedFonts: FONTS });
    expect(r1.website.sidebarLeft ?? '').toBe(''); // foreign sidebar removed from the slot
    expect(r1.diagnostics.some((d) => d.code === 'sidebar-discarded')).toBe(true);
    // no sidebar → no such diagnostic
    const r2 = applyFoundation({ cssText: CSS, identity, website: {} as never, pages: [page('home', '', 'Home')], hostedFonts: FONTS });
    expect(r2.diagnostics.some((d) => d.code === 'sidebar-discarded')).toBe(false);
  });
});
