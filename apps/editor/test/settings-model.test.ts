import { describe, it, expect } from 'vitest';
import { DEFAULT_BRAND_COLORS, MANDATORY_COLOR_TOKENS } from '@sitewright/schema';
import { toForm, toBundle, newShopChannel } from '../src/views/settings/model';
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
    mapUrl: 'https://www.google.com/maps/embed?pb=test',
    bookingUrl: 'https://calendly.com/acme/intro',
    social: [{ link: 'https://x.com/acme', name: 'X', icon: 'brand:x' }],
    // All six mandatory tokens set to non-default values, so the round-trip proves explicit
    // values survive (and aren't clobbered by the fill-missing defaults).
    colors: { primary: '#0a7', secondary: '#0bd', accent: '#f50', neutral: '#123', 'base-100': '#fefefe', 'base-content': '#111' },
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

  it('round-trips the mini-shop currency + all four channel kinds', () => {
    const withShop: SettingsBundle = {
      identity: { name: 'Acme', colors: {} },
      website: {
        shop: {
          currency: { code: 'EUR', symbol: '€', position: 'after', decimals: 2 },
          addToCartLabel: 'Add to basket',
          title: 'Your basket',
          note: 'Order request only — we confirm price.',
          channels: [
            { kind: 'whatsapp', label: 'WhatsApp', number: '+14155550123', intro: 'Hi' },
            { kind: 'mailto', email: 'orders@acme.test', subject: 'Order' },
            { kind: 'payment', urlTemplate: 'https://paypal.me/acme/{total}', provider: 'paypal' },
            { kind: 'form', formId: 'order' },
          ],
        },
      },
      settings: { defaultLocale: 'en', locales: ['en'] },
    };
    const back = toBundle(toForm(withShop), withShop);
    expect(back.website?.shop).toEqual(withShop.website!.shop);
  });

  it('round-trips per-channel order fields (whatsapp + mailto) and defaults the field type to text', () => {
    const withFields: SettingsBundle = {
      identity: { name: 'Acme', colors: {} },
      website: {
        shop: {
          channels: [
            {
              kind: 'whatsapp',
              number: '+14155550123',
              fields: [{ label: 'Your name', type: 'text', required: true }, { label: 'Your address', type: 'textarea' }],
            },
            { kind: 'mailto', email: 'orders@acme.test', fields: [{ label: 'Phone', type: 'tel' }] },
          ],
        },
      },
      settings: { defaultLocale: 'en', locales: ['en'] },
    };
    const back = toBundle(toForm(withFields), withFields);
    expect(back.website?.shop).toEqual(withFields.website!.shop);
  });

  it('drops blank-label order fields and omits the fields key when none remain', () => {
    const form = toForm(empty());
    form.shopChannels = [
      {
        ...newShopChannel(),
        kind: 'whatsapp',
        number: '+14155550123',
        fields: [
          { id: 'a', label: '  ', type: 'text', required: true }, // blank label → dropped
          { id: 'b', label: 'Your name', type: 'text', required: false }, // kept (required omitted when false)
        ],
      },
      { ...newShopChannel(), kind: 'mailto', email: 'a@b.test', fields: [{ id: 'c', label: '', type: 'text', required: false }] },
    ];
    const back = toBundle(form, empty());
    expect(back.website?.shop?.channels).toEqual([
      { kind: 'whatsapp', number: '+14155550123', fields: [{ label: 'Your name', type: 'text' }] },
      { kind: 'mailto', email: 'a@b.test' }, // all fields blank → no fields key
    ]);
  });

  it('round-trips website.theme (nav/button effects) and omits "None"', () => {
    const withTheme: SettingsBundle = {
      identity: { name: 'Acme', colors: {} },
      website: { theme: { navEffect: 'pill', buttonEffect: 'lift' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    };
    expect(toBundle(toForm(withTheme), withTheme).website?.theme).toEqual({ navEffect: 'pill', buttonEffect: 'lift' });

    // 'none' (and an unset effect) drop out — only the chosen one is serialized.
    const f = toForm(empty());
    f.navEffect = 'underline';
    f.buttonEffect = 'none';
    expect(toBundle(f, empty()).website?.theme).toEqual({ navEffect: 'underline' });

    // both off → no theme block at all.
    expect(toBundle(toForm(empty()), empty()).website?.theme).toBeUndefined();

    // A project with no theme loads as "none" (not ''), so it never falsely shows as unsaved.
    expect(toForm(empty()).navEffect).toBe('none');
    expect(toForm(empty()).buttonEffect).toBe('none');
  });

  it('drops incomplete shop channels (every kind) and an empty currency', () => {
    const form = toForm(empty());
    form.shopChannels = [
      { ...newShopChannel(), kind: 'whatsapp', number: '' }, // no number → dropped
      { ...newShopChannel(), kind: 'payment', urlTemplate: '' }, // no urlTemplate → dropped
      { ...newShopChannel(), kind: 'form', formId: '' }, // no formId → dropped
      { ...newShopChannel(), kind: 'mailto', email: 'a@b.test' }, // kept
    ];
    const back = toBundle(form, empty());
    expect(back.website?.shop?.channels).toEqual([{ kind: 'mailto', email: 'a@b.test' }]);
    expect(back.website?.shop?.currency).toBeUndefined();
  });

  it('currency decimals: a cleared field falls back to 2 (not 0) and non-integers are truncated + clamped', () => {
    const mk = (decimals: string) => {
      const form = toForm(empty());
      form.shopCurrencyCode = 'USD';
      form.shopCurrencySymbol = '$';
      form.shopCurrencyDecimals = decimals;
      return toBundle(form, empty()).website?.shop?.currency?.decimals;
    };
    expect(mk('')).toBe(2); // cleared → schema default, NOT 0
    expect(mk('0')).toBe(0); // an explicit 0 (e.g. JPY) is honored
    expect(mk('1.5')).toBe(1); // truncated to a valid int (the schema is .int())
    expect(mk('9')).toBe(4); // clamped to the schema max
    expect(mk('abc')).toBe(2); // non-numeric → default
  });

  it('strips empty optionals so a minimal identity stays minimal', () => {
    const minimal: SettingsBundle = { identity: { name: 'Bare', colors: {} }, settings: { defaultLocale: 'en', locales: ['en'] } };
    const back = toBundle(toForm(minimal), minimal);
    // "Minimal" no longer means zero colors: the six mandatory tokens are always present (at their
    // defaults). Everything else optional is still stripped.
    expect(back.identity).toEqual({ name: 'Bare', colors: { ...DEFAULT_BRAND_COLORS } });
    expect('legalName' in back.identity).toBe(false);
    expect(back.website).toBeUndefined(); // no website fields → section omitted
  });

  it('hydrates the six mandatory color rows (first, in order) and keeps custom colors after them', () => {
    const form = toForm({
      identity: { name: 'X', colors: { primary: '#0a7', 'brand-teal': '#0d9488' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    });
    const keys = form.colors.map((r) => r.key);
    expect(keys.slice(0, MANDATORY_COLOR_TOKENS.length)).toEqual([...MANDATORY_COLOR_TOKENS]);
    expect(keys).toContain('brand-teal');
    // The set value is preserved; a missing mandatory token shows its default.
    expect(form.colors.find((r) => r.key === 'primary')?.value).toBe('#0a7');
    expect(form.colors.find((r) => r.key === 'base-100')?.value).toBe(DEFAULT_BRAND_COLORS['base-100']);
  });

  it('clearing a mandatory color drops it on save (so the server fill-missing restores its default)', () => {
    const form = toForm({ identity: { name: 'X', colors: {} }, settings: { defaultLocale: 'en', locales: ['en'] } });
    // Emulate the editor clearing the Background Color field.
    form.colors = form.colors.map((r) => (r.key === 'base-100' ? { ...r, value: '  ' } : r));
    const colors = toBundle(form).identity.colors;
    expect('base-100' in colors).toBe(false); // blank → omitted (not persisted as an invalid empty color)
    expect(colors.primary).toBe(DEFAULT_BRAND_COLORS.primary); // untouched mandatory still sent
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

  it('converts color/font token rows to records, dropping blank keys, blank values, and dangerous keys', () => {
    const form = toForm(empty());
    form.colors = [
      { id: '1', key: 'primary', value: '#000' },
      { id: '2', key: '', value: '#fff' }, // blank key → dropped
      { id: '3', key: '__proto__', value: 'x' }, // dangerous key → dropped
      { id: '4', key: 'brand-teal', value: '   ' }, // blank value → dropped
    ];
    form.fonts = [
      { id: '5', key: 'body', value: 'Inter' },
      { id: '6', key: 'heading', value: '' }, // blank font value → dropped (renderer uses its default)
    ];
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
