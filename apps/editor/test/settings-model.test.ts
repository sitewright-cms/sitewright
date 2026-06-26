import { describe, it, expect } from 'vitest';
import { DEFAULT_BRAND_COLORS, MANDATORY_COLOR_TOKENS } from '@sitewright/schema';
import { toForm, toBundle, newShopChannel, newShopField, shopLabelKeys } from '../src/views/settings/model';
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
    mainNav: '<nav class="navbar">{{ company.name }}</nav>',
    sidebarLeft: '<aside class="menu">l</aside>',
    sidebarRight: '<aside class="menu">r</aside>',
    footer: '<footer class="footer">f</footer>',
    bottom: '<div class="modal">b</div>',
    redirects: [{ from: '/old', to: '/new', status: 301 }],
    translations: { nav_cta: { en: 'Go', de: 'Los' }, only_en: { en: 'Only EN' } },
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

  it('round-trips the mini-shop currency formatting + all four channel kinds (keyed, no labels)', () => {
    const withShop: SettingsBundle = {
      identity: { name: 'Acme', colors: {} },
      website: {
        shop: {
          currency: { position: 'after', decimals: 2 },
          channels: [
            { kind: 'whatsapp', key: 'whatsapp', number: '+14155550123', intro: 'Hi' },
            { kind: 'mailto', key: 'email', email: 'orders@acme.test', subject: 'Order' },
            { kind: 'payment', key: 'pay', urlTemplate: 'https://paypal.me/acme/{total}', provider: 'paypal' },
            { kind: 'form', key: 'order_form', formId: 'order' },
          ],
        },
      },
      settings: { defaultLocale: 'en', locales: ['en'] },
    };
    const back = toBundle(toForm(withShop), withShop);
    expect(back.website?.shop).toEqual(withShop.website!.shop);
  });

  it('round-trips the shop enabled toggle (and toggling on with no config yields a bare {enabled})', () => {
    const enabled: SettingsBundle = {
      identity: { name: 'Acme', colors: {} },
      website: { shop: { enabled: true, currency: { position: 'after', decimals: 2 } } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    };
    expect(toForm(enabled).shopEnabled).toBe(true);
    expect(toBundle(toForm(enabled), enabled).website?.shop).toEqual(enabled.website!.shop);
    // toggling on with no other config → a minimal { enabled: true }
    const form = toForm(empty());
    form.shopEnabled = true;
    expect(toBundle(form, empty()).website?.shop).toEqual({ enabled: true });
    // a disabled shop omits `enabled` (off = the schema default), keeping any config
    expect(toForm(empty()).shopEnabled).toBe(false);
    const cfgOnly = toForm(empty());
    cfgOnly.shopCurrencyPosition = 'after';
    expect(toBundle(cfgOnly, empty()).website?.shop).toEqual({ currency: { position: 'after', decimals: 2 } });
  });

  it('round-trips per-channel order fields (whatsapp + mailto) and defaults the field type to text', () => {
    const withFields: SettingsBundle = {
      identity: { name: 'Acme', colors: {} },
      website: {
        shop: {
          channels: [
            {
              kind: 'whatsapp',
              key: 'whatsapp',
              number: '+14155550123',
              fields: [{ key: 'name', type: 'text', required: true }, { key: 'address', type: 'textarea' }],
            },
            { kind: 'mailto', key: 'email', email: 'orders@acme.test', fields: [{ key: 'phone', type: 'tel' }] },
          ],
        },
      },
      settings: { defaultLocale: 'en', locales: ['en'] },
    };
    const back = toBundle(toForm(withFields), withFields);
    expect(back.website?.shop).toEqual(withFields.website!.shop);
  });

  it('drops keyless order fields and omits the fields key when none remain', () => {
    const form = toForm(empty());
    form.shopChannels = [
      {
        ...newShopChannel(),
        kind: 'whatsapp',
        key: 'whatsapp',
        number: '+14155550123',
        fields: [
          { id: 'a', key: '  ', type: 'text', required: true }, // blank key → dropped
          { id: 'b', key: 'name', type: 'text', required: false }, // kept (required omitted when false)
        ],
      },
      { ...newShopChannel(), kind: 'mailto', key: 'email', email: 'a@b.test', fields: [{ id: 'c', key: '', type: 'text', required: false }] },
    ];
    const back = toBundle(form, empty());
    expect(back.website?.shop?.channels).toEqual([
      { kind: 'whatsapp', key: 'whatsapp', number: '+14155550123', fields: [{ key: 'name', type: 'text' }] },
      { kind: 'mailto', key: 'email', email: 'a@b.test' }, // all fields keyless → no fields key
    ]);
  });

  it('shopLabelKeys derives a deduped shop.<key> per channel + field (for the Translations ghost rows)', () => {
    const channels = [
      { ...newShopChannel(), kind: 'whatsapp' as const, key: 'whatsapp', number: '+1', fields: [{ ...newShopField(), key: 'name' }, { ...newShopField(), key: 'address' }] },
      { ...newShopChannel(), kind: 'mailto' as const, key: 'email', email: 'a@b.test', fields: [{ ...newShopField(), key: 'name' }] }, // name reused → deduped
      { ...newShopChannel(), kind: 'payment' as const, key: '', urlTemplate: 'https://x.test' }, // blank key → skipped
    ];
    expect(shopLabelKeys(channels)).toEqual([
      { key: 'shop.whatsapp', label: 'WhatsApp button', default: '' },
      { key: 'shop.name', label: 'Order field', default: '' },
      { key: 'shop.address', label: 'Order field', default: '' },
      { key: 'shop.email', label: 'Email button', default: '' },
    ]);
  });

  it('round-trips website.effects (nav/button effects) and omits "None"', () => {
    const withEffects: SettingsBundle = {
      identity: { name: 'Acme', colors: {} },
      website: { effects: { navEffect: 'box-solid', buttonEffect: 'lift' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    };
    expect(toBundle(toForm(withEffects), withEffects).website?.effects).toEqual({ navEffect: 'box-solid', buttonEffect: 'lift' });

    // 'none' (and an unset effect) drop out — only the chosen one is serialized.
    const f = toForm(empty());
    f.navEffect = 'line-bottom';
    f.buttonEffect = 'none';
    expect(toBundle(f, empty()).website?.effects).toEqual({ navEffect: 'line-bottom' });

    // both off → no effects block at all.
    expect(toBundle(toForm(empty()), empty()).website?.effects).toBeUndefined();

    // A project with no effects loads as "none" (not ''), so it never falsely shows as unsaved.
    expect(toForm(empty()).navEffect).toBe('none');
    expect(toForm(empty()).buttonEffect).toBe('none');
  });

  it('round-trips per-effect custom code (preserved even when a built-in effect is chosen)', () => {
    const withCode: SettingsBundle = {
      identity: { name: 'Acme', colors: {} },
      // nav has a built-in effect AND custom code (preserved); preloader is custom-only.
      website: { effects: { navEffect: 'box-solid', navCode: '<style>n</style>', preloaderCode: '<div>p</div>' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    };
    const form = toForm(withCode);
    expect(form.navCode).toBe('<style>n</style>');
    expect(form.preloaderCode).toBe('<div>p</div>');
    expect(form.buttonCode).toBe('');
    expect(toBundle(form, withCode).website?.effects).toEqual({
      navEffect: 'box-solid',
      navCode: '<style>n</style>',
      preloaderCode: '<div>p</div>',
    });

    // Empty custom code drops out; whitespace-only counts as empty.
    const f = toForm(empty());
    f.buttonCode = '   ';
    expect(toBundle(f, empty()).website?.effects).toBeUndefined();
  });

  it('round-trips the themes opt-in (enableThemes + defaultTheme); omitted when off / on auto', () => {
    const on: SettingsBundle = {
      identity: { name: 'Acme', colors: {} },
      website: { enableThemes: true, defaultTheme: 'dark' },
      settings: { defaultLocale: 'en', locales: ['en'] },
    };
    const w = toBundle(toForm(on), on).website;
    expect(w?.enableThemes).toBe(true);
    expect(w?.defaultTheme).toBe('dark');

    // OFF (default) → both keys omitted, so a single-theme site stays byte-identical.
    expect(toBundle(toForm(empty()), empty()).website?.enableThemes).toBeUndefined();

    // ON but 'auto' → enableThemes emitted, defaultTheme omitted (auto is the default).
    const auto: SettingsBundle = { ...on, website: { enableThemes: true } };
    const wa = toBundle(toForm(auto), auto).website;
    expect(wa?.enableThemes).toBe(true);
    expect(wa?.defaultTheme).toBeUndefined();
  });

  it('drops incomplete shop channels (every kind), a keyless channel, and a default currency', () => {
    const form = toForm(empty());
    form.shopChannels = [
      { ...newShopChannel(), kind: 'whatsapp', key: 'whatsapp', number: '' }, // no number → dropped
      { ...newShopChannel(), kind: 'payment', key: 'pay', urlTemplate: '' }, // no urlTemplate → dropped
      { ...newShopChannel(), kind: 'form', key: 'order_form', formId: '' }, // no formId → dropped
      { ...newShopChannel(), kind: 'mailto', key: '', email: 'a@b.test' }, // no KEY → dropped
      { ...newShopChannel(), kind: 'mailto', key: 'email', email: 'b@c.test' }, // kept
    ];
    const back = toBundle(form, empty());
    expect(back.website?.shop?.channels).toEqual([{ kind: 'mailto', key: 'email', email: 'b@c.test' }]);
    expect(back.website?.shop?.currency).toBeUndefined(); // defaults (before / 2) → currency omitted
  });

  it('currency decimals: a cleared field falls back to 2 (not 0) and non-integers are truncated + clamped', () => {
    // position 'after' (non-default) forces the currency object to be emitted so decimals is observable.
    const mk = (decimals: string) => {
      const form = toForm(empty());
      form.shopCurrencyPosition = 'after';
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

describe('settings model — translations', () => {
  const bundle = (translations: Record<string, Record<string, string>>, locales = ['en', 'de']): SettingsBundle => ({
    identity: { name: 'X', colors: {} },
    website: { translations },
    settings: { defaultLocale: 'en', locales },
  });

  it('round-trips a translation catalog for configured locales', () => {
    const b = bundle({ nav_cta: { en: 'Go', de: 'Los' }, only_en: { en: 'Hi' } });
    expect(toBundle(toForm(b), b).website?.translations).toEqual({ nav_cta: { en: 'Go', de: 'Los' }, only_en: { en: 'Hi' } });
  });

  it('drops cells for locales no longer configured (self-heal on locale removal)', () => {
    const b = bundle({ k: { en: 'E', de: 'D', fr: 'F' } }, ['en', 'de']); // fr was removed
    expect(toBundle(toForm(b), b).website?.translations).toEqual({ k: { en: 'E', de: 'D' } });
  });

  it('drops blank/whitespace cells and a key left with none', () => {
    const b = bundle({ keep: { en: 'A', de: '   ' }, gone: { en: '' } });
    expect(toBundle(toForm(b), b).website?.translations).toEqual({ keep: { en: 'A' } });
  });

  it('omits the catalog entirely when there are no (non-blank) translations', () => {
    const b = bundle({ blank: { en: '' } });
    expect(toBundle(toForm(b), b).website?.translations).toBeUndefined();
  });
});
