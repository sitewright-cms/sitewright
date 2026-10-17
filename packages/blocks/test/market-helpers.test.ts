import { describe, it, expect } from 'vitest';
import { COUNTRY_CODES } from '@sitewright/schema';
import { renderTemplate } from '../src/template.js';

/** What the market helpers put in the page — the cart runtime reads nothing else. */
const MARKETS = [
  { id: 'eu', name: 'Europe', currency: 'EUR', countries: ['DE', 'AT'], locale: 'de', channels: ['card'] },
  { id: 'ch', name: 'Switzerland', currency: 'CHF', countries: ['CH'], pricing: { shipping: { flatMinor: 900 } } },
  { id: 'row', name: 'Rest of world', currency: 'USD', countries: [], restOfWorld: true },
];
const ctx = (markets: unknown[] | undefined, page: Record<string, unknown> = {}) =>
  ({ website: { shop: { enabled: true, currency: { code: 'EUR' }, ...(markets ? { markets } : {}) } }, page }) as never;
const attrJson = (html: string, name: string): unknown => {
  const raw = new RegExp(`${name}="([^"]*)"`).exec(html)?.[1];
  return raw === undefined ? undefined : JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
};

describe('{{sw-cart}} with markets', () => {
  it('★ carries each market’s id, currency, language, channels and the countries it SHIPS to — never its prices', () => {
    const html = renderTemplate('{{sw-cart}}', ctx(MARKETS));
    const markets = attrJson(html, 'data-markets') as Array<{ id: string; ship: string[]; channels?: string[] }>;
    expect(markets.map((m) => m.id)).toEqual(['eu', 'ch', 'row']);
    expect(markets[0]).toEqual({ id: 'eu', name: 'Europe', currency: 'EUR', locale: 'de', channels: ['card'], ship: ['DE', 'AT'] });
    // The rest of the world: every country no other market claims.
    expect(markets[2]!.ship).toHaveLength(COUNTRY_CODES.length - 3);
    expect(markets[2]!.ship).not.toContain('CH');
    expect(html).not.toContain('flatMinor');
    expect(html).toContain('data-ship-to-label="Ship to"');
  });

  it('a shop without markets carries none of it', () => {
    const html = renderTemplate('{{sw-cart}}', ctx(undefined));
    expect(html).not.toContain('data-markets');
    expect(html).not.toContain('data-ship-to-label');
  });
});

describe('{{sw-price}}', () => {
  it('renders the DEFAULT market’s price in its currency, carrying every market’s for the runtime', () => {
    const html = renderTemplate('{{sw-price prices=page.data.p}}', ctx(MARKETS, { locale: 'en', data: { p: { eu: 19.9, ch: 21.5 } } }));
    expect(html).toMatch(/^<span data-sw-price data-prices="[^"]+">€19\.90<\/span>$/);
    expect(attrJson(html, 'data-prices')).toEqual({ eu: '19.9', ch: '21.5' });
  });

  it('without markets formats the plain price in the shop currency; with the shop off renders nothing', () => {
    expect(renderTemplate('{{sw-price price=12}}', ctx(undefined, { locale: 'de' }))).toMatch(/12,00(\s|&nbsp;)€/);
    expect(renderTemplate('{{sw-price price=12}}', { website: { shop: { enabled: false } } } as never)).toBe('');
  });
});

describe('{{sw-market-switcher}}', () => {
  it('a select of the markets, by name', () => {
    const html = renderTemplate('{{sw-market-switcher class="select"}}', ctx(MARKETS));
    expect(html).toBe(
      '<select data-sw-market-switcher aria-label="Shop in" class="select"><option value="eu">Europe</option><option value="ch">Switzerland</option><option value="row">Rest of world</option></select>',
    );
  });

  it('nothing for fewer than two markets', () => {
    expect(renderTemplate('{{sw-market-switcher}}', ctx([MARKETS[0]]))).toBe('');
    expect(renderTemplate('{{sw-market-switcher}}', ctx(undefined))).toBe('');
  });
});
