import { describe, it, expect } from 'vitest';
import { SLOT_MAX } from '@sitewright/schema';
import type { SettingsBundle } from '../src/api';
import { toForm, type SettingsForm } from '../src/views/settings/model';
import {
  budget,
  identityStatus,
  logosStatus,
  colorsStatus,
  typographyStatus,
  typographyRows,
  cssTokensStatus,
  contactStatus,
  socialStatus,
  siteStatus,
  contentWidthStatus,
  contentWidthLabel,
  imagesStatus,
  skeletonStatus,
  lineCount,
  criticalCssUsage,
  themesStatus,
  effectRows,
  effectsStatus,
  redirectsStatus,
  redirectsExtra,
  securityStatus,
  securityContacts,
  searchStatus,
  shopStatus,
  consentStatus,
  languagesStatus,
  localeCodesOf,
  translationCoverage,
  translationsStatus,
} from '../src/views/settings/board/summaries';

const base: SettingsBundle = {
  identity: { name: 'Acme', colors: {} },
  settings: { defaultLocale: 'en', locales: ['en'] },
};
const fresh = (): SettingsForm => toForm(base);
const withForm = (p: Partial<SettingsForm>): SettingsForm => ({ ...fresh(), ...p });

describe('budget — the fixed row allowance every tile list shares', () => {
  it('shows everything when it fits', () => {
    expect(budget([1, 2, 3], 3)).toEqual({ shown: [1, 2, 3], more: 0 });
  });
  it('gives the LAST row to "+N more" once the list overflows', () => {
    expect(budget([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2], more: 3 });
  });
  it('handles an empty list', () => {
    expect(budget([], 3)).toEqual({ shown: [], more: 0 });
  });
});

describe('Corporate Identity tiles', () => {
  it('identity counts the six fields, and a missing display name needs attention', () => {
    expect(identityStatus(fresh())).toEqual({ kind: 'set', label: '1 of 6 set' });
    expect(identityStatus(withForm({ legalName: 'Acme Inc.', businessType: 'LocalBusiness' })).label).toBe('3 of 6 set');
    expect(identityStatus(withForm({ name: '  ' }))).toEqual({ kind: 'attention', label: 'Name missing' });
  });

  it('logos count the five wells; none set is a hollow default, not a gap', () => {
    expect(logosStatus(fresh())).toEqual({ kind: 'default', label: 'None set' });
    expect(logosStatus(withForm({ logo: '/media/a.svg', icon: '/media/i.png' }))).toEqual({ kind: 'set', label: '2 of 5 set' });
  });

  it('brand colors at the platform defaults read as Default; any change or custom colour is Set', () => {
    expect(colorsStatus(fresh())).toEqual({ kind: 'default', label: 'Platform palette' });
    const f = fresh();
    const changed = f.colors.map((c) => (c.key === 'primary' ? { ...c, value: '#c2410c' } : c));
    expect(colorsStatus(withForm({ colors: changed }))).toEqual({ kind: 'set', label: '6 core' });
    const custom = [...f.colors, { id: 'x', key: 'sand', value: '#e7d8c3' }];
    expect(colorsStatus(withForm({ colors: custom }))).toEqual({ kind: 'set', label: '6 core · 1 custom' });
  });

  it('typography: system defaults are Default; rows list core then named slots, one weight each', () => {
    expect(typographyStatus(fresh())).toEqual({ kind: 'default', label: 'System fonts' });
    const f = withForm({
      heading: { source: 'asset', family: 'Fraunces', weight: 600, assetId: 'a1' },
      named: [{ id: 'n', name: 'mono', slot: { source: 'system', family: 'monospace', weight: 400 } }],
    });
    expect(typographyStatus(f)).toEqual({ kind: 'set', label: '3 slots' });
    expect(typographyRows(f)).toEqual([
      { slot: 'heading', utility: 'font-heading', family: 'Fraunces', weight: 600, source: 'Self-hosted' },
      { slot: 'body', utility: 'font-body', family: 'sans-serif', weight: 400, source: 'System' },
      { slot: 'mono', utility: 'font-mono', family: 'monospace', weight: 400, source: 'System' },
    ]);
  });

  it('css tokens: none is Default; a value the schema would REFUSE needs attention before the save fails', () => {
    expect(cssTokensStatus(fresh())).toEqual({ kind: 'default', label: 'None' });
    const ok = [{ id: 'a', key: 'grad', value: 'linear-gradient(#000,#fff)' }];
    expect(cssTokensStatus(withForm({ cssTokens: ok }))).toEqual({ kind: 'set', label: '1 defined' });
    const bad = [...ok, { id: 'b', key: 'bg', value: 'url(https://evil.test/x.png)' }];
    expect(cssTokensStatus(withForm({ cssTokens: bad }))).toEqual({ kind: 'attention', label: '1 invalid' });
  });

  it('contact counts eleven fields; social counts linked profiles', () => {
    expect(contactStatus(fresh())).toEqual({ kind: 'default', label: 'Not set' });
    expect(contactStatus(withForm({ email: 'a@b.c', telephone: '+1', street: 'x' })).label).toBe('3 of 11 set');
    expect(socialStatus(fresh())).toEqual({ kind: 'default', label: 'None' });
    expect(socialStatus(withForm({ social: [{ id: 's', link: 'https://x.test', name: 'X', icon: '' }] }))).toEqual({ kind: 'set', label: '1 linked' });
  });
});

describe('Website Settings tiles', () => {
  it('site: no production URL needs attention (publish skips sitemap.xml); a malformed one too', () => {
    expect(siteStatus(fresh())).toEqual({ kind: 'attention', label: 'No production URL' });
    expect(siteStatus(withForm({ siteUrl: 'acme.com' }))).toEqual({ kind: 'attention', label: 'Invalid URL' });
    expect(siteStatus(withForm({ siteUrl: 'https://acme.com' }))).toEqual({ kind: 'set', label: 'Set' });
  });

  it('content width: blank is the 1200px default; presets and custom widths read back by name', () => {
    expect(contentWidthStatus(fresh())).toEqual({ kind: 'default', label: 'Default' });
    expect(contentWidthLabel('')).toBe('1200px');
    expect(contentWidthLabel('none')).toBe('Full width');
    expect(contentWidthLabel('1080px')).toBe('1080px');
    expect(contentWidthStatus(withForm({ containerWidth: '960px' }))).toEqual({ kind: 'set', label: 'Set' });
  });

  it('images: both blank is Default', () => {
    expect(imagesStatus(fresh())).toEqual({ kind: 'default', label: 'Default' });
    expect(imagesStatus(withForm({ imageDelivery: 'avif' }))).toEqual({ kind: 'set', label: 'Set' });
  });

  it('skeleton: counts the eight document parts; an oversized Critical CSS needs attention', () => {
    expect(skeletonStatus(fresh())).toEqual({ kind: 'default', label: 'Empty' });
    const f = withForm({ mainNav: '<div>nav</div>', scripts: '<script></script>', criticalCss: '.a{}' });
    expect(skeletonStatus(f)).toEqual({ kind: 'set', label: '3 of 8 in use' });
    expect(lineCount('a\nb\n')).toBe(2);
    expect(lineCount('   ')).toBe(0);
    const huge = 'a'.repeat(SLOT_MAX + 1);
    expect(criticalCssUsage(withForm({ criticalCss: huge })).overCap).toBe(true);
    expect(skeletonStatus(withForm({ criticalCss: huge }))).toEqual({ kind: 'attention', label: 'Critical CSS too large' });
    expect(criticalCssUsage(withForm({ criticalCss: 'a'.repeat(1024) }))).toMatchObject({ chars: 1024, overCap: false });
  });

  it('themes: off is not-applicable, on is Set', () => {
    expect(themesStatus(fresh())).toEqual({ kind: 'na', label: 'Off' });
    expect(themesStatus(withForm({ enableThemes: true }))).toEqual({ kind: 'set', label: 'On' });
  });

  it('effects: lists only what differs from the defaults (back-to-top is ON by default)', () => {
    expect(effectRows(fresh())).toEqual([]);
    expect(effectsStatus(fresh())).toEqual({ kind: 'default', label: 'Plain' });
    const f = withForm({ navEffect: 'line-sliding-bottom', backToTop: false, scrollSpy: true, buttonCode: '<style></style>' });
    const labels = effectRows(f).map((r) => r.label);
    expect(labels).toEqual(['Nav hover', 'Button effect', 'Scrollspy', 'Back to top']);
    expect(effectRows(f).find((r) => r.label === 'Button effect')?.value).toBe('Custom code');
    expect(effectsStatus(f)).toEqual({ kind: 'set', label: '4 set' });
  });

  it('redirects: counts real rules (blank rows are dropped on save) and names the unusual statuses', () => {
    expect(redirectsStatus(fresh())).toEqual({ kind: 'default', label: 'None' });
    const rows = [
      { id: '1', from: '/a', to: '/b', status: 301 },
      { id: '2', from: '/c', to: '/d', status: 302 },
      { id: '3', from: '', to: '', status: 301 },
    ];
    expect(redirectsStatus(withForm({ redirects: rows }))).toEqual({ kind: 'set', label: '2 rules' });
    expect(redirectsExtra(withForm({ redirects: rows }))).toBe('1 use 302');
  });

  it('security.txt: off is n/a; on without a contact (or with a contact page but no production URL) needs attention', () => {
    expect(securityStatus(fresh())).toEqual({ kind: 'na', label: 'Off' });
    expect(securityStatus(withForm({ securityEnabled: true }))).toEqual({ kind: 'attention', label: 'No contact' });
    expect(securityStatus(withForm({ securityEnabled: true, securityContactPageId: 'p1' }))).toEqual({ kind: 'attention', label: 'Needs production URL' });
    expect(securityStatus(withForm({ securityEnabled: true, securityEmailMode: 'ci', securityPolicyUrl: 'http://x' }))).toEqual({ kind: 'attention', label: 'Invalid link' });
    expect(securityStatus(withForm({ securityEnabled: true, securityEmailMode: 'ci' }))).toEqual({ kind: 'set', label: 'On' });
  });

  it('security.txt: custom contacts count, "custom" with nothing typed does not, and page LINKS need the production URL too', () => {
    expect(securityStatus(withForm({ securityEnabled: true, securityContactUrl: 'https://hackerone.com/acme' }))).toEqual({ kind: 'set', label: 'On' });
    expect(securityStatus(withForm({ securityEnabled: true, securityPhoneMode: 'custom', securityPhone: '' }))).toEqual({ kind: 'attention', label: 'No contact' });
    expect(securityStatus(withForm({ securityEnabled: true, securityPhoneMode: 'custom', securityPhone: 'call us' }))).toEqual({ kind: 'attention', label: 'Invalid contact' });
    expect(securityStatus(withForm({ securityEnabled: true, securityEmailMode: 'custom', securityEmail: 'nope' }))).toEqual({ kind: 'attention', label: 'Invalid contact' });
    expect(securityStatus(withForm({ securityEnabled: true, securityEmailMode: 'ci', securityPolicyPageId: 'p2' }))).toEqual({ kind: 'attention', label: 'Needs production URL' });
    // A typed URL beside a CHOSEN page is not what will be published, so it is not judged.
    expect(securityStatus(withForm({ securityEnabled: true, siteUrl: 'https://a.co', securityContactPageId: 'p1', securityContactUrl: 'http://bad' }))).toEqual({ kind: 'set', label: 'On' });
  });

  it('security.txt contacts read back in publish order, naming where each comes from', () => {
    expect(securityContacts(withForm({ securityContactPageId: 'p1', securityPhoneMode: 'ci', securityEmailMode: 'custom', securityEmail: 'a@b.co' }))).toEqual([
      'Contact page',
      'company phone',
      'own email',
    ]);
    expect(securityContacts(withForm({ securityContactUrl: 'https://x.co', securityPhoneMode: 'custom', securityPhone: '+1 2' }))).toEqual(['Contact URL', 'own phone']);
    expect(securityContacts(fresh())).toEqual([]);
  });

  it('search: loose matching is the default', () => {
    expect(searchStatus(fresh())).toEqual({ kind: 'default', label: 'Loose matching' });
    expect(searchStatus(withForm({ searchFoldDiacritics: false }))).toEqual({ kind: 'set', label: 'Exact accents' });
  });

  it('shop: off is n/a; a cart with nowhere to send an order needs attention; a checkout channel needs a currency', () => {
    expect(shopStatus(fresh())).toEqual({ kind: 'na', label: 'Off' });
    expect(shopStatus(withForm({ shopEnabled: true }))).toEqual({ kind: 'attention', label: 'No checkout channel' });
    const mail = { ...fresh(), shopEnabled: true };
    const ch = (kind: 'mailto' | 'checkout') => ({
      id: kind, kind, key: kind, number: '', intro: '', email: 'a@b.c', subject: '', urlTemplate: '', provider: '',
      gatewayId: '', returnPath: '', cancelPath: '', pow: false, captcha: false, fields: [],
    });
    expect(shopStatus({ ...mail, shopChannels: [ch('mailto')] })).toEqual({ kind: 'set', label: '1 channel' });
    expect(shopStatus({ ...mail, shopChannels: [ch('checkout')] })).toEqual({ kind: 'attention', label: 'Currency missing' });
    expect(shopStatus({ ...mail, shopChannels: [ch('checkout'), ch('mailto')], shopCurrencyCode: 'EUR' })).toEqual({ kind: 'set', label: '2 channels' });
  });

  it('consent: off is n/a; on counts gated integrations', () => {
    expect(consentStatus(fresh())).toEqual({ kind: 'na', label: 'Off' });
    expect(consentStatus(withForm({ consent: { enabled: true } }))).toEqual({ kind: 'set', label: 'On' });
    const integrations = [{ id: 'i', name: 'GA', category: 'analytics' as const, preset: 'ga4' as const }];
    expect(consentStatus(withForm({ consent: { enabled: true, integrations } }))).toEqual({ kind: 'set', label: '1 gated' });
  });

  it('languages: the default language first, deduplicated', () => {
    const f = withForm({ defaultLocale: 'de', locales: [{ id: 'a', value: 'en' }, { id: 'b', value: 'de' }, { id: 'c', value: '' }] });
    expect(localeCodesOf(f)).toEqual(['de', 'en']);
    expect(languagesStatus(fresh())).toEqual({ kind: 'default', label: '1 language' });
    expect(languagesStatus(f)).toEqual({ kind: 'set', label: '2 languages' });
  });

  it('★ translations stay available with ONE language — they also hold the cart, consent and theme labels', () => {
    expect(translationsStatus(fresh())).toEqual({ kind: 'default', label: 'Built-in labels' });
    const rows = [{ id: 'r', key: 'tagline', cells: { en: 'Hi' } }];
    expect(translationsStatus(withForm({ translations: rows }))).toEqual({ kind: 'set', label: '1 key' });
  });

  it('translations: coverage per added language, lowest first; a gap needs attention', () => {
    const f = withForm({
      locales: [{ id: 'a', value: 'en' }, { id: 'b', value: 'de' }, { id: 'c', value: 'fr' }],
      translations: [
        { id: '1', key: 'a', cells: { en: 'A', de: 'A', fr: 'A' } },
        { id: '2', key: 'b', cells: { en: 'B', de: 'B' } },
        { id: '3', key: 'c', cells: { en: 'C', de: 'C', fr: '' } },
        // A key with no main-language text is not something a translation can be missing from.
        { id: '4', key: 'd', cells: { fr: 'only' } },
      ],
    });
    expect(translationCoverage(f)).toEqual([
      { locale: 'fr', pct: 33 },
      { locale: 'de', pct: 100 },
    ]);
    expect(translationsStatus(f)).toEqual({ kind: 'attention', label: '1 incomplete' });
  });
});
