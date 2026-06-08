import { describe, it, expect } from 'vitest';
import { toForm, toBundle } from '../src/views/settings/model';
import type { SettingsBundle } from '../src/api';

const full: SettingsBundle = {
  identity: {
    name: 'Acme',
    legalName: 'Acme Inc.',
    shortName: 'Acme',
    slogan: 'Build',
    description: 'Maker of things',
    businessType: 'Organization',
    logo: '/logo.svg',
    favicon: '/favicon.ico',
    icon: '/icon.png',
    image: '/og.png',
    email: 'hi@acme.test',
    telephone: '+1 555',
    address: { street: '1 Main', locality: 'Town', region: 'CA', country: 'US', postalCode: '90001' },
    geo: { latitude: '34.0', longitude: '-118.2' },
    social: ['https://x.com/acme'],
    colors: { primary: '#0a7', accent: '#f50' },
    typography: { fontFamilies: { body: 'Inter' } },
  },
  website: {
    siteUrl: 'https://acme.com',
    jsonDataUrl: 'https://api.acme.com/data.json',
    data: { hero: { headline: 'Hi' }, tags: ['a', 'b'] },
    criticalCss: '.hero{}',
    head: '<meta>',
    scripts: '<script></script>',
    topNav: '<nav class="navbar">{{ company.name }}</nav>',
    mobileNav: '<nav class="drawer">m</nav>',
    sidebarLeft: '<aside class="menu">l</aside>',
    sidebarRight: '<aside class="menu">r</aside>',
    footer: '<footer class="footer">f</footer>',
    bottom: '<div class="modal">b</div>',
    redirects: [{ from: '/old', to: '/new', status: 301 }],
  },
  settings: { defaultLocale: 'en', locales: ['en', 'de'] },
};

const empty = (): SettingsBundle => ({ identity: { name: 'X', colors: {} }, settings: { defaultLocale: 'en', locales: ['en'] } });

describe('settings model', () => {
  it('round-trips a full bundle through toForm → toBundle', () => {
    const back = toBundle(toForm(full), full);
    expect(back.identity).toEqual(full.identity);
    expect(back.website).toEqual(full.website);
    expect(back.settings).toEqual(full.settings);
  });

  it('strips empty optionals so a minimal identity stays minimal', () => {
    const minimal: SettingsBundle = { identity: { name: 'Bare', colors: {} }, settings: { defaultLocale: 'en', locales: ['en'] } };
    const back = toBundle(toForm(minimal), minimal);
    expect(back.identity).toEqual({ name: 'Bare', colors: {} });
    expect('legalName' in back.identity).toBe(false);
    expect(back.website).toBeUndefined(); // no website fields → section omitted
  });

  it('preserves unsurfaced tokens (spacing/radii/scale) and round-trips the surfaced logo fields', () => {
    const withExtra: SettingsBundle = {
      identity: {
        name: 'X',
        colors: { primary: '#000' },
        spacing: { md: '1rem' },
        radii: { lg: '12px' },
        typography: { fontFamilies: { body: 'Inter' }, scale: { base: '16px' } },
        logoLight: '/light.svg',
        logoDark: '/dark.svg',
      },
      settings: { defaultLocale: 'en', locales: ['en'] },
    };
    const back = toBundle(toForm(withExtra), withExtra);
    expect(back.identity.spacing).toEqual({ md: '1rem' });
    expect(back.identity.radii).toEqual({ lg: '12px' });
    // Default heading/body slots are NOT persisted (the renderer applies them) — typography stays
    // as it was.
    expect(back.identity.typography).toEqual({ fontFamilies: { body: 'Inter' }, scale: { base: '16px' } });
    // logoLight/logoDark are now editable form fields → they survive a full toForm→toBundle round-trip.
    expect(back.identity.logoLight).toBe('/light.svg');
    expect(back.identity.logoDark).toBe('/dark.svg');
  });

  it('converts color/font token rows to records, dropping blank + dangerous keys', () => {
    const form = toForm(empty());
    form.colors = [
      { id: '1', key: 'primary', value: '#000' },
      { id: '2', key: '', value: '#fff' }, // blank key → dropped
      { id: '3', key: '__proto__', value: 'x' }, // dangerous key → dropped
    ];
    form.fonts = [{ id: '4', key: 'body', value: 'Inter' }];
    const back = toBundle(form);
    expect(back.identity.colors).toEqual({ primary: '#000' });
    expect(back.identity.typography).toEqual({ fontFamilies: { body: 'Inter' } });
  });

  it('surfaces default heading/body slots but only PERSISTS them when customized', () => {
    // Absent slots → platform defaults surface in the form…
    const f = toForm(empty());
    expect(f.heading).toEqual({ source: 'system', family: 'serif', weight: 700 });
    expect(f.body).toEqual({ source: 'system', family: 'sans-serif', weight: 400 });
    // …and unchanged defaults are NOT written back (project stays minimal, renderer applies them).
    expect(toBundle(f).identity.typography).toBeUndefined();
    // Customizing a slot persists it.
    f.heading = { source: 'system', family: 'monospace', weight: 800 };
    const back = toBundle(f);
    expect(back.identity.typography?.heading).toEqual({ source: 'system', family: 'monospace', weight: 800 });
    expect(back.identity.typography?.body).toBeUndefined(); // body still default → not written
  });

  it('round-trips custom named slots — an asset slot keeps its assetId', () => {
    const f = toForm(empty());
    f.named = [
      { id: 'r1', name: 'boombox', slot: { source: 'asset', family: 'Boombox', weight: 800, assetId: 'fa-1' } },
      { id: 'r2', name: '', slot: { source: 'system', family: 'serif', weight: 400 } }, // empty name → dropped
    ];
    const typ = toBundle(f).identity.typography!;
    expect(typ.named).toEqual({ boombox: { source: 'asset', family: 'Boombox', weight: 800, assetId: 'fa-1' } });

    // toForm restores the named slots (incl. the asset reference) from the record.
    const reloaded = toForm({ identity: { name: 'X', colors: {}, typography: typ }, settings: { defaultLocale: 'en', locales: ['en'] } });
    expect(reloaded.named.map((n) => ({ name: n.name, family: n.slot.family, assetId: n.slot.assetId }))).toEqual([
      { name: 'boombox', family: 'Boombox', assetId: 'fa-1' },
    ]);
  });

  it('only emits geo when both latitude and longitude are present', () => {
    const form = toForm(empty());
    form.latitude = '34.0'; // longitude blank
    expect(toBundle(form).identity.geo).toBeUndefined();
    form.longitude = '-118.2';
    expect(toBundle(form).identity.geo).toEqual({ latitude: '34.0', longitude: '-118.2' });
  });

  it('round-trips website.data and omits it when empty', () => {
    const form = toForm(empty());
    expect(form.data).toEqual({}); // default: an empty object, so the section stays omitted
    expect(toBundle(form).website).toBeUndefined();

    form.data = { hero: { headline: 'Hi' }, tags: ['a', 'b'] };
    expect(toBundle(form).website).toEqual({ data: { hero: { headline: 'Hi' }, tags: ['a', 'b'] } });

    // An empty object or array is treated as "no data" and dropped from the payload.
    form.data = {};
    expect(toBundle(form).website).toBeUndefined();
    form.data = [];
    expect(toBundle(form).website).toBeUndefined();
  });

  it('includes the website section when only redirects are set', () => {
    const form = toForm(empty());
    form.redirects = [{ id: 'r1', from: '/a', to: '/b', status: 308 }];
    expect(toBundle(form).website).toEqual({ redirects: [{ from: '/a', to: '/b', status: 308 }] });
  });

  it('falls back locales to ["en"] when emptied', () => {
    const form = toForm({ identity: { name: 'X', colors: {} }, settings: { defaultLocale: '', locales: [] } });
    expect(toBundle(form).settings).toEqual({ defaultLocale: 'en', locales: ['en'] });
  });
});
