import { describe, it, expect } from 'vitest';
import { CorporateIdentitySchema, FontSlotSchema, SelfHostedFontSchema } from '../src/corporate-identity.js';
import { legacyToIdentity, mergeLegacyIdentity } from '../src/migrate-identity.js';
import { BrandSchema } from '../src/brand.js';
import { CompanySchema } from '../src/company.js';

describe('CorporateIdentitySchema', () => {
  it('requires a name and defaults colors to {}', () => {
    expect(() => CorporateIdentitySchema.parse({})).toThrow();
    const id = CorporateIdentitySchema.parse({ name: 'Acme' });
    expect(id.name).toBe('Acme');
    expect(id.colors).toEqual({});
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
    expect(id.colors).toEqual(LEGACY_BRAND.colors);
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
    expect(id2.colors).toEqual(LEGACY_BRAND.colors);
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

  it('accepts a google slot (with fontId) and a family name containing an apostrophe', () => {
    const slot = FontSlotSchema.parse({ source: 'google', family: "It's Display", weight: 400, fontId: 'it-s-display' });
    expect(slot.fontId).toBe('it-s-display');
  });

  it('rejects an off-scale weight and a family that could break out of CSS', () => {
    expect(() => FontSlotSchema.parse({ family: 'serif', weight: 450 })).toThrow();
    expect(() => FontSlotSchema.parse({ family: 'serif"}', weight: 400 })).toThrow();
  });
});

describe('SelfHostedFontSchema', () => {
  it('normalizes the legacy `weights` shape (#123) into google `files`', () => {
    const font = SelfHostedFontSchema.parse({ id: 'playfair-display', family: 'Playfair Display', fallback: 'serif', weights: [400, 700] });
    expect(font.source).toBe('google');
    expect(font.files).toEqual([
      { weight: 400, style: 'normal', format: 'woff2', file: '400.woff2' },
      { weight: 700, style: 'normal', format: 'woff2', file: '700.woff2' },
    ]);
  });

  it('prefers `files` over a stale legacy `weights` when both are present', () => {
    const font = SelfHostedFontSchema.parse({
      id: 'x', family: 'X', fallback: 'serif', source: 'google',
      files: [{ weight: 700, format: 'woff2', file: '700.woff2' }],
      weights: [400],
    });
    expect(font.files).toEqual([{ weight: 700, style: 'normal', format: 'woff2', file: '700.woff2' }]);
  });

  it('accepts a local font with multi-format files', () => {
    const font = SelfHostedFontSchema.parse({
      id: 'up-ab12cd34',
      family: 'Boombox',
      fallback: 'sans-serif',
      source: 'local',
      files: [
        { weight: 400, format: 'ttf', file: '400.ttf' },
        { weight: 700, style: 'italic', format: 'woff', file: '700-italic.woff' },
      ],
    });
    expect(font.source).toBe('local');
    expect(font.files[0]).toEqual({ weight: 400, style: 'normal', format: 'ttf', file: '400.ttf' });
  });

  it('rejects a fallback outside the generic enum', () => {
    expect(() => SelfHostedFontSchema.parse({ id: 'x', family: 'X', fallback: 'fantasy', weights: [400] })).toThrow();
  });

  it('rejects a file name that disagrees with its format / is path-unsafe', () => {
    expect(() => SelfHostedFontSchema.parse({ id: 'x', family: 'X', fallback: 'serif', source: 'local', files: [{ weight: 400, format: 'ttf', file: '../evil.ttf' }] })).toThrow();
    expect(() => SelfHostedFontSchema.parse({ id: 'x', family: 'X', fallback: 'serif', source: 'local', files: [{ weight: 400, format: 'ttf', file: '400.exe' }] })).toThrow();
  });

  it('rejects duplicate faces (same weight+style+format)', () => {
    expect(() =>
      SelfHostedFontSchema.parse({ id: 'x', family: 'X', fallback: 'serif', source: 'local', files: [{ weight: 700, format: 'woff2', file: '700.woff2' }, { weight: 700, format: 'woff2', file: '700.woff2' }] }),
    ).toThrow(/duplicate/);
  });

  it('rejects a font with no files', () => {
    expect(() => SelfHostedFontSchema.parse({ id: 'x', family: 'X', fallback: 'serif', source: 'local', files: [] })).toThrow();
  });

  it('rejects a path-unsafe id', () => {
    expect(() => SelfHostedFontSchema.parse({ id: '../etc', family: 'X', fallback: 'serif', weights: [400] })).toThrow();
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
