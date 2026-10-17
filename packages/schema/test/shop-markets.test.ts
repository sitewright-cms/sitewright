import { describe, it, expect } from 'vitest';
import { COUNTRY_CODES, CountryCodeSchema, ShopSchema, isCountryCode } from '../src/index.js';

/**
 * SHOP MARKETS — where a shop sells, in which currency, shipping where, through which providers. The
 * rules here are the ones a checkout depends on: a country belongs to at most one market (else a buyer
 * picks the cheaper one), at most one market is the rest of the world, a market ships somewhere, and a
 * shipping fee is an amount, so it cannot be borrowed across currencies.
 */
const checkout = { kind: 'checkout', key: 'card', gatewayId: 'stripe', email: 'o@shop.test' };
const market = (over: Record<string, unknown> = {}) => ({ id: 'eu', name: 'Europe', currency: 'EUR', countries: ['DE', 'AT'], ...over });
const issues = (shop: unknown): string[] => {
  const r = ShopSchema.safeParse(shop);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('ShopSchema — markets', () => {
  it('accepts a shop with markets, and needs no shop-level currency for checkout then', () => {
    expect(issues({ enabled: true, channels: [checkout], markets: [market(), market({ id: 'ch', name: 'Switzerland', currency: 'CHF', countries: ['CH'] })] })).toEqual([]);
    // Without markets the old rule stands: a checkout needs the settlement currency.
    expect(issues({ enabled: true, channels: [checkout] })[0]).toMatch(/requires currency\.code/);
  });

  it('★ refuses a country in two markets — the cheaper would be the buyer’s choice, not the shop’s', () => {
    expect(issues({ markets: [market(), market({ id: 'dach', countries: ['DE', 'CH'] })] })).toContain('DE is in two markets ("eu" and "dach")');
  });

  it('allows ONE rest-of-world market, which may list no countries of its own', () => {
    expect(issues({ markets: [market(), market({ id: 'row', countries: [], restOfWorld: true, currency: 'USD' })] })).toEqual([]);
    expect(issues({ markets: [market({ restOfWorld: true }), market({ id: 'row', countries: [], restOfWorld: true })] })[0]).toMatch(/only one market can be the rest of the world/);
  });

  it('refuses a market that ships nowhere, a duplicate id, and an unknown channel', () => {
    expect(issues({ markets: [market({ countries: [] })] })[0]).toMatch(/ships nowhere/);
    expect(issues({ markets: [market(), market({ countries: ['CH'] })] })[0]).toMatch(/two markets are called "eu"/);
    expect(issues({ channels: [checkout], markets: [market({ channels: ['card', 'twint'] })] })[0]).toMatch(/"twint", which is not a checkout channel/);
  });

  it('★ a market in another currency must bring its own shipping — the shop’s fee is an amount', () => {
    const shop = { currency: { code: 'EUR' }, pricing: { shipping: { flatMinor: 499 } } };
    expect(issues({ ...shop, markets: [market()] })).toEqual([]); // EUR market: the shop's EUR fee applies
    expect(issues({ ...shop, markets: [market({ id: 'ch', currency: 'CHF', countries: ['CH'] })] })[0]).toMatch(/charges in CHF — give it its own shipping/);
    expect(issues({ ...shop, markets: [market({ id: 'ch', currency: 'CHF', countries: ['CH'], pricing: { shipping: { flatMinor: 900 } } })] })).toEqual([]);
  });

  it('refuses a ship-to that is not an uppercase country code', () => {
    for (const bad of ['de', 'XX', 'EU', 'DEU']) expect(issues({ markets: [market({ countries: [bad] })] }).length, bad).toBeGreaterThan(0);
  });
});

describe('COUNTRY_CODES', () => {
  it('is the 249 ISO 3166-1 codes plus Kosovo, uppercase and unique', () => {
    expect(COUNTRY_CODES.length).toBe(250);
    expect(new Set(COUNTRY_CODES).size).toBe(250);
    for (const c of COUNTRY_CODES) expect(c).toMatch(/^[A-Z]{2}$/);
    expect(isCountryCode('CH') && isCountryCode('XK')).toBe(true);
    expect(isCountryCode('EU') || isCountryCode('UK') || isCountryCode('ch')).toBe(false);
    expect(CountryCodeSchema.safeParse('GB').success).toBe(true);
  });
});
