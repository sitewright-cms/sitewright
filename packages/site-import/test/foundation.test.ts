import { describe, expect, it } from 'vitest';
import type { Page } from '@sitewright/schema';
import {
  applyFoundation,
  configurePageNav,
  extractColors,
  extractTypography,
  foundationCriticalCss,
  nativeFooter,
  nativeTopNav,
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
});

describe('foundationCriticalCss', () => {
  it('emits the bp-hero + bp-card helpers and a body background', () => {
    const css = foundationCriticalCss('#e8e8ea');
    expect(css).toContain('.bp-hero::before');
    expect(css).toContain('.bp-card');
    expect(css).toContain('background-color:#e8e8ea');
    expect(css.length).toBeLessThan(10_000); // CSS_MAX
  });
});

describe('nativeTopNav', () => {
  it('is data-driven (iterates nav.header) and uses no <nav> landmark', () => {
    const nav = nativeTopNav({ name: 'Acme', logo: '/media/s/main/logo.webp' });
    expect(nav).toContain('{{#each nav.header}}');
    expect(nav).toContain('{{sw-label}}');
    expect(nav).toContain('(sw-active path)');
    expect(nav).not.toMatch(/<nav[\s>]/); // the platform owns the <nav> landmark
    expect(nav).toContain('/media/s/main/logo.webp');
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
    expect(byId.home!.nav).toMatchObject({ slots: ['header', 'mobile'], order: 0, title: 'Home' });
    expect(byId.about!.nav).toMatchObject({ dropdown: true });
    expect(byId.services!.nav).toMatchObject({ dropdown: true });
    // children carry NO nav object (they nest via parent) — empty slots would be rejected on PUT
    expect(byId.profile!.nav).toBeUndefined();
    expect(byId.agri!.nav).toBeUndefined();
    expect(byId.agri!.order).toBe(0); // first (only) child of services
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
    expect(r.website.topNav).toContain('{{#each nav.header}}');
    expect(r.website.criticalCss).toContain('.bp-hero');
    // page nav configured
    expect(pages.find((p) => p.id === 'home')!.nav).toMatchObject({ title: 'Home' });
    expect(r.diagnostics[0]!.code).toBe('foundation-applied');
  });
});
