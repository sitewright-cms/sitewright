import { describe, it, expect } from 'vitest';
import { CorporateIdentitySchema, DEFAULT_BRAND_COLORS, MANDATORY_COLOR_TOKENS, FontSlotSchema } from '../src/corporate-identity.js';
import { legacyToIdentity, mergeLegacyIdentity } from '../src/migrate-identity.js';
import { BrandSchema } from '../src/brand.js';
import { CompanySchema } from '../src/company.js';

describe('CorporateIdentitySchema', () => {
  it('requires a name and fills the mandatory color tokens by default', () => {
    expect(() => CorporateIdentitySchema.parse({})).toThrow();
    const id = CorporateIdentitySchema.parse({ name: 'Acme' });
    expect(id.name).toBe('Acme');
    // A project with no colors still gets all six mandatory tokens, at their defaults.
    expect(id.colors).toEqual(DEFAULT_BRAND_COLORS);
    for (const token of MANDATORY_COLOR_TOKENS) expect(id.colors[token]).toBeDefined();
  });

  it('fills MISSING mandatory tokens but never overrides ones the project set; keeps custom colors', () => {
    const id = CorporateIdentitySchema.parse({
      name: 'Acme',
      colors: { primary: '#0a7', 'brand-teal': '#0d9488' },
    });
    expect(id.colors.primary).toBe('#0a7'); // author value wins over the default
    expect(id.colors['base-100']).toBe(DEFAULT_BRAND_COLORS['base-100']); // missing → default
    expect(id.colors.neutral).toBe(DEFAULT_BRAND_COLORS.neutral);
    expect(id.colors['brand-teal']).toBe('#0d9488'); // custom color passes through
  });

  it('accepts hyphenated DaisyUI/Tailwind color keys (base-100, base-content, primary-content)', () => {
    const id = CorporateIdentitySchema.parse({
      name: 'Acme',
      colors: { 'base-100': '#0b0b0f', 'base-content': '#f5f5f5', 'primary-content': '#ffffff' },
    });
    expect(id.colors['base-100']).toBe('#0b0b0f');
    expect(id.colors['base-content']).toBe('#f5f5f5');
    expect(id.colors['primary-content']).toBe('#ffffff');
  });

  it('accepts a full identity and rejects non-https social URLs', () => {
    const id = CorporateIdentitySchema.parse({
      name: 'Acme',
      legalName: 'Acme Inc.',
      colors: { primary: '#0a7' },
      social: ['https://x.com/acme'],
    });
    expect(id.legalName).toBe('Acme Inc.');
    expect(() => CorporateIdentitySchema.parse({ name: 'Acme', social: ['javascript:alert(1)'] })).toThrow();
  });

  it('rejects a backslash CSS hex-escape in a token value (injection defense)', () => {
    // `\3b color:red\7b` decodes to `; color:red{` — a declaration break-out that
    // contains no literal `;{}<>`. The backslash denial in the token schema stops it.
    expect(() => CorporateIdentitySchema.parse({ name: 'Acme', typography: { fontFamilies: { body: '\\3b color:red' } } })).toThrow();
    expect(() => CorporateIdentitySchema.parse({ name: 'Acme', spacing: { md: '1rem\\7b' } })).toThrow();
  });
});

// A legacy brand + company with EVERY field set to a unique sentinel, so the
// field-map test below proves nothing is dropped in the merge.
const LEGACY_BRAND = BrandSchema.parse({
  name: 'Acme Brand',
  logo: { light: '/logo-light.svg', dark: '/logo-dark.svg', favicon: '/favicon.ico' },
  colors: { primary: '#0a7', accent: '#f50' },
  typography: { fontFamilies: { body: 'Inter' }, scale: { base: '16px' } },
  spacing: { md: '1rem' },
  radii: { lg: '12px' },
});

const LEGACY_COMPANY = CompanySchema.parse({
  businessType: 'Organization',
  legalName: 'Acme Corporation',
  shortName: 'Acme',
  slogan: 'We build the future',
  description: 'A maker of things.',
  logo: '/company-logo.png',
  icon: '/company-icon.png',
  image: '/og.png',
  email: 'hi@acme.test',
  telephone: '+1-555-0100',
  address: { street: '1 Main', locality: 'Town', region: 'CA', country: 'US', postalCode: '90001' },
  geo: { latitude: '34.0', longitude: '-118.2' },
  social: ['https://x.com/acme', 'https://github.com/acme'],
});

describe('legacyToIdentity — exhaustive field map (no silent drops)', () => {
  const id = legacyToIdentity(LEGACY_BRAND, LEGACY_COMPANY);

  it('maps every brand token field', () => {
    // The identity transform fills the mandatory tokens; the legacy brand's colors win where set.
    expect(id.colors).toEqual({ ...DEFAULT_BRAND_COLORS, ...LEGACY_BRAND.colors });
    expect(id.typography).toEqual(LEGACY_BRAND.typography);
    expect(id.spacing).toEqual(LEGACY_BRAND.spacing);
    expect(id.radii).toEqual(LEGACY_BRAND.radii);
  });

  it('splits the brand.logo object into logoLight / logoDark / favicon, and name from brand.name', () => {
    expect(id.name).toBe('Acme Brand');
    expect(id.logoLight).toBe('/logo-light.svg');
    expect(id.logoDark).toBe('/logo-dark.svg');
    expect(id.favicon).toBe('/favicon.ico');
  });

  it('maps every company field 1:1 (logo/icon/image kept distinct from brand logos)', () => {
    expect(id.businessType).toBe('Organization');
    expect(id.legalName).toBe('Acme Corporation');
    expect(id.shortName).toBe('Acme');
    expect(id.slogan).toBe('We build the future');
    expect(id.description).toBe('A maker of things.');
    expect(id.logo).toBe('/company-logo.png');
    expect(id.icon).toBe('/company-icon.png');
    expect(id.image).toBe('/og.png');
    expect(id.email).toBe('hi@acme.test');
    expect(id.telephone).toBe('+1-555-0100');
    expect(id.address).toEqual(LEGACY_COMPANY.address);
    expect(id.geo).toEqual(LEGACY_COMPANY.geo);
    expect(id.social).toEqual(LEGACY_COMPANY.social);
  });

  it('covers every source key — guards against a future field being forgotten', () => {
    // Union of all old brand + company keys must each be represented in identity.
    const idKeys = new Set(Object.keys(id));
    // brand.name → identity.name; brand.logo.* → logoLight/logoDark/favicon.
    for (const k of ['name', 'colors', 'typography', 'spacing', 'radii', 'logoLight', 'logoDark', 'favicon']) {
      expect(idKeys.has(k)).toBe(true);
    }
    for (const k of Object.keys(LEGACY_COMPANY)) {
      // company.logo→logo, .icon→icon, .image→image, all others same-named
      expect(idKeys.has(k)).toBe(true);
    }
  });

  it('works with no company (brand-only legacy project)', () => {
    const id2 = legacyToIdentity(LEGACY_BRAND);
    expect(id2.name).toBe('Acme Brand');
    expect(id2.legalName).toBeUndefined();
    expect(id2.colors).toEqual({ ...DEFAULT_BRAND_COLORS, ...LEGACY_BRAND.colors });
  });

  it('preserves the businessType="disabled" schema.org-suppression sentinel', () => {
    const id3 = legacyToIdentity(LEGACY_BRAND, CompanySchema.parse({ businessType: 'disabled' }));
    expect(id3.businessType).toBe('disabled');
  });
});

describe('mergeLegacyIdentity — read-boundary normalizer', () => {
  it('folds a legacy {brand,company} record into {identity}, dropping the old keys', () => {
    const out = mergeLegacyIdentity({ formatVersion: 1, brand: LEGACY_BRAND, company: LEGACY_COMPANY, website: { siteUrl: 'https://acme.test' } }) as Record<string, unknown>;
    expect(out.brand).toBeUndefined();
    expect(out.company).toBeUndefined();
    expect(out.website).toEqual({ siteUrl: 'https://acme.test' }); // other fields preserved
    expect((out.identity as { legalName: string }).legalName).toBe('Acme Corporation');
  });

  it('passes through a record that already has identity', () => {
    const already = { identity: { name: 'X' }, website: {} };
    expect(mergeLegacyIdentity(already)).toBe(already);
  });

  it('leaves a record with neither identity nor brand untouched (defensive)', () => {
    const neither = { settings: { locales: ['en'] } };
    expect(mergeLegacyIdentity(neither)).toBe(neither);
  });
});

describe('FontSlotSchema', () => {
  it('defaults source to system and accepts a numeric CSS weight', () => {
    const slot = FontSlotSchema.parse({ family: 'serif', weight: 700 });
    expect(slot).toEqual({ source: 'system', family: 'serif', weight: 700 });
  });

  it('accepts an asset slot (font in the library) with its assetId', () => {
    const slot = FontSlotSchema.parse({ source: 'asset', family: "It's Display", weight: 400, assetId: 'asset-123' });
    expect(slot).toEqual({ source: 'asset', family: "It's Display", weight: 400, assetId: 'asset-123' });
  });

  it('degrades a legacy google/local slot (or an asset slot missing its id) to a system family', () => {
    expect(FontSlotSchema.parse({ source: 'google', family: 'Playfair Display', weight: 700, fontId: 'playfair-display' }))
      .toEqual({ source: 'system', family: 'Playfair Display', weight: 700 });
    expect(FontSlotSchema.parse({ source: 'local', family: 'Boombox', weight: 400 }))
      .toEqual({ source: 'system', family: 'Boombox', weight: 400 });
    expect(FontSlotSchema.parse({ source: 'asset', family: 'X', weight: 400 }))
      .toEqual({ source: 'system', family: 'X', weight: 400 });
  });

  it('rejects an off-scale weight and a family that could break out of CSS', () => {
    expect(() => FontSlotSchema.parse({ family: 'serif', weight: 450 })).toThrow();
    expect(() => FontSlotSchema.parse({ family: 'serif"}', weight: 400 })).toThrow();
  });
});

describe('typography.named (custom font slots)', () => {
  it('accepts custom named slots and rejects reserved/invalid names', () => {
    const id = CorporateIdentitySchema.parse({
      name: 'Acme',
      typography: { named: { boombox: { source: 'system', family: 'serif', weight: 700 } } },
    });
    expect((id.typography as { named: Record<string, unknown> }).named.boombox).toMatchObject({ family: 'serif' });
    // reserved name (would shadow a built-in/Tailwind utility)
    expect(() => CorporateIdentitySchema.parse({ name: 'A', typography: { named: { heading: { family: 'serif', weight: 400 } } } })).toThrow();
    // invalid slug (uppercase / leading digit / trailing hyphen)
    expect(() => CorporateIdentitySchema.parse({ name: 'A', typography: { named: { Boombox: { family: 'serif', weight: 400 } } } })).toThrow();
    expect(() => CorporateIdentitySchema.parse({ name: 'A', typography: { named: { 'boom-': { family: 'serif', weight: 400 } } } })).toThrow();
    // prototype-pollution key
    expect(() => CorporateIdentitySchema.parse({ name: 'A', typography: { named: { __proto__: { family: 'serif', weight: 400 } } } })).toThrow();
  });
});
