import { describe, it, expect } from 'vitest';
import type { Shop } from '@sitewright/schema';
import { checkoutReadiness, type GatewayReadiness } from '../src/payments/readiness.js';

const TEST_KEYS: GatewayReadiness['keys'] = { mode: 'test', test: { complete: true, missing: [] }, live: { complete: false, missing: ['apiKey'] } };
const LIVE_KEYS: GatewayReadiness['keys'] = { mode: 'live', test: { complete: true, missing: [] }, live: { complete: true, missing: [] } };
const ready = (id: string, over: Partial<GatewayReadiness['gateway']> = {}, keys: GatewayReadiness['keys'] = LIVE_KEYS): GatewayReadiness => ({
  gateway: { id, enabled: true, verified: true, ...over },
  keys,
});

const shop = (over: Partial<Shop> = {}): Shop =>
  ({
    enabled: true,
    currency: { code: 'EUR' },
    channels: [{ kind: 'checkout', key: 'pay', gatewayId: 'acme', email: 'o@shop.test' }],
    ...over,
  }) as Shop;
const problems = (s: Shop | null, g: GatewayReadiness[]) => checkoutReadiness(s, g).problems;

describe('checkoutReadiness — why a checkout would fail, said before a buyer finds out', () => {
  it('has nothing to say about a shop taking live payments, or about no shop at all', () => {
    expect(checkoutReadiness(shop(), [ready('acme')])).toEqual({ problems: [], notes: [] });
    expect(checkoutReadiness(null, [ready('acme')])).toEqual({ problems: [], notes: [] });
  });

  it('names a channel whose gateway is unknown or disabled', () => {
    for (const gateways of [[], [ready('acme', { enabled: false })]]) {
      const [p, ...rest] = problems(shop(), gateways);
      expect(rest).toEqual([]);
      expect(p).toContain('"pay"');
      expect(p).toContain('does not offer');
    }
  });

  it('★ an unproven gateway still takes TEST payments — it is a problem only in live mode', () => {
    expect(problems(shop(), [ready('acme', { verified: false }, TEST_KEYS)])).toEqual([]);
    expect(checkoutReadiness(shop(), [ready('acme', { verified: false }, TEST_KEYS)]).notes).toEqual([expect.stringContaining('and proves it first')]);
    expect(problems(shop(), [ready('acme', { verified: false })])).toEqual([expect.stringMatching(/live mode but has not been proven/)]);
  });

  it('names a gateway the project has no keys for — and that a person enters them', () => {
    expect(problems(shop(), [ready('acme', {}, null)])).toEqual([expect.stringContaining('no keys for "acme"')]);
  });

  it('judges the keys of the mode the project is IN, naming what is missing', () => {
    const live = ready('acme', {}, { mode: 'live', test: { complete: true, missing: [] }, live: { complete: false, missing: ['apiKey', 'whsec'] } });
    expect(problems(shop(), [live])).toEqual([expect.stringMatching(/live mode but is missing apiKey, whsec/)]);
    // Incomplete LIVE keys do not stop a project transacting in test — but it is told it is in test.
    expect(checkoutReadiness(shop(), [ready('acme', {}, TEST_KEYS)])).toEqual({ problems: [], notes: [expect.stringMatching(/"pay" takes TEST payments only/)] });
  });

  it('names a market charging a currency its provider does not take — only through the channels it offers', () => {
    const markets = [
      { id: 'eu', name: 'Europe', currency: 'EUR', countries: ['DE'] },
      { id: 'ch', name: 'Switzerland', currency: 'CHF', countries: ['CH'], pricing: {} },
      { id: 'uk', name: 'UK', currency: 'GBP', countries: ['GB'], pricing: {}, channels: [] },
    ] as Shop['markets'];
    // CHF is refused; GBP offers no online checkout at all (channels: []), so it is not a problem.
    expect(problems(shop({ markets }), [ready('acme', { currencies: ['EUR'] })])).toEqual([
      expect.stringMatching(/market "ch" charges CHF through "pay", but "acme" only takes EUR/),
    ]);
  });

  it('checks the shop currency when there are no markets, and does not repeat a channel already reported', () => {
    expect(problems(shop({ currency: { code: 'USD' } as Shop['currency'] }), [ready('acme', { currencies: ['EUR'] })])).toEqual([
      expect.stringContaining('the shop charges USD'),
    ]);
    // Disabled AND the wrong currency: the one line that matters.
    expect(problems(shop({ currency: { code: 'USD' } as Shop['currency'] }), [ready('acme', { enabled: false, currencies: ['EUR'] })])).toHaveLength(1);
  });

  it('survives malformed stored settings rather than failing the request', () => {
    expect(checkoutReadiness({ channels: 'nope', markets: 7 } as unknown as Shop, [ready('acme')])).toEqual({ problems: [], notes: [] });
    expect(checkoutReadiness({ channels: [null, { kind: 'checkout' }] } as unknown as Shop, [ready('acme')])).toEqual({ problems: [], notes: [] });
  });
});
