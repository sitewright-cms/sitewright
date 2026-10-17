import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { MIN_SUBMIT_ELAPSED_MS, PaymentGatewayStoredSchema } from '@sitewright/schema';
import { shopCatalog, shopTransactions, instanceSettings, INSTANCE_SETTINGS_ID, content } from '../src/db/schema.js';
import { GLOBAL_SCOPE_ID, ensureGlobalProject } from '../src/repo/global-library.js';
import { encryptSecret } from '../src/crypto/secret.js';
import { resolveMarket } from '../src/http/payment-routes.js';
import { mergeCatalogStock } from '../src/publish/shop-catalog.js';

// ★ SHOP MARKETS through the money path: where a buyer shops decides the price list, the currency,
// shipping and tax, which providers may take the order, and where it may ship. The browser names the
// market and the ship-to country; the server re-checks both and charges from that market's OWN sealed
// price list, built at publish from the rendered buy buttons.

const KEY = Buffer.alloc(32, 7);
let scripted: { calls: Array<{ url: string; body?: string }>; responses: Array<{ body: unknown }> };
const makeFetch = () => async (url: string, init: { body?: string }) => {
  scripted.calls.push({ url, ...(init.body !== undefined ? { body: init.body } : {}) });
  const r = scripted.responses.shift() ?? { body: { id: `sess_${scripted.calls.length}`, url: 'https://mock-pay.invalid/s/1' } };
  return { ok: true, status: 200, text: async () => JSON.stringify(r.body) };
};

const gateway = (id: string, over: Record<string, unknown> = {}) =>
  PaymentGatewayStoredSchema.parse({
    id,
    name: id,
    apiBase: { test: 'https://mock-pay.invalid', live: 'https://mock-pay.invalid' },
    auth: { kind: 'bearer', secretField: 'apiKey' },
    credentialFields: [{ key: 'apiKey', label: 'API key', kind: 'secret' }, { key: 'webhookSecret', label: 'Secret', kind: 'secret' }],
    checkout: {
      request: { method: 'POST', path: '/sessions', format: 'json', headers: {}, body: { amount: '${#AMOUNT:minor}', currency: '${AMOUNT:currency}' } },
      refPath: 'id',
      redirectUrlPath: 'url',
    },
    verification: { scheme: 'hmac-sha256-header', header: 'x-sig', encoding: 'hex', secretField: 'webhookSecret' },
    events: { refPath: 'id', types: {}, defaultKind: 'paid' },
    allowedOrigins: ['https://mock-pay.invalid'],
    enabled: true,
    verified: true,
    ...over,
  });

const MARKETS = [
  { id: 'eu', name: 'Europe', currency: 'EUR', countries: ['DE', 'AT'], channels: ['card'] },
  { id: 'ch', name: 'Switzerland', currency: 'CHF', countries: ['CH'], channels: ['card', 'local'], pricing: { shipping: { flatMinor: 900 } } },
  { id: 'row', name: 'Rest of world', currency: 'USD', countries: [], restOfWorld: true, pricing: {} },
];
const channel = (key: string, gatewayId: string) => ({ kind: 'checkout', key, gatewayId, email: 'o@shop.test', captcha: false, pow: false });
const SHOP = {
  enabled: true,
  currency: { code: 'EUR' },
  pricing: { shipping: { flatMinor: 499 } },
  channels: [channel('card', 'card'), channel('local', 'local')],
  markets: MARKETS,
};

let h: Harness;
let owner: TestClient;
let projectId: string;
let publishRoot: string;

async function putShop(shop: unknown, source?: string): Promise<void> {
  const put = await owner.project(projectId).putContent('settings', 'settings', {
    identity: { name: 'Shop', colors: { primary: '#0a7' } },
    website: { shop },
    settings: {},
  });
  if (put.statusCode >= 400) throw new Error(`settings put failed (${put.statusCode}): ${put.body}`);
  if (source !== undefined) {
    const page = await owner.project(projectId).putContent('page', 'home', { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source });
    if (page.statusCode >= 400) throw new Error(`page put failed: ${page.body}`);
  }
}

beforeEach(async () => {
  scripted = { calls: [], responses: [] };
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-markets-sites-'));
  h = await makeHarness({ encryptionKey: KEY, publicUrl: 'https://sw.test', paymentFetch: makeFetch(), publishRoot });
  owner = await h.signup({ admin: true });
  projectId = await owner.createProject('Shop', 'shop');
  const data = { formModes: { globalSmtp: true, userSmtp: false, contactPhp: false, contactPhpSmtp: false, thirdParty: false, whatsapp: false }, paymentsEnabled: true };
  await h.db.insert(instanceSettings).values({ id: INSTANCE_SETTINGS_ID, data, updatedAt: new Date() }).onConflictDoUpdate({ target: instanceSettings.id, set: { data, updatedAt: new Date() } });
  await ensureGlobalProject(h.db);
  for (const id of ['card', 'local']) {
    await h.db.insert(content).values({ id: `gw_${id}`, projectId: GLOBAL_SCOPE_ID, kind: 'payment_gateway', entityId: id, scope: '', data: gateway(id), createdAt: new Date(), updatedAt: new Date() });
    await h.db.insert(content).values({
      id: `bind_${id}`, projectId, kind: 'project_payment', entityId: id, scope: '',
      data: { gatewayId: id, mode: 'test', values: { test: { apiKey: encryptSecret('sk', KEY), webhookSecret: encryptSecret('wh', KEY) } } },
      createdAt: new Date(), updatedAt: new Date(),
    });
  }
  await putShop(SHOP);
  const list = (market: string, currency: string, priceMinor: number) => ({
    projectId, mode: 'live' as const, market, currency, items: { mug: { sku: 'mug', name: 'Mug', priceMinor } }, digest: `d_${market}`, publishedAt: new Date(),
  });
  await h.db.insert(shopCatalog).values([list('eu', 'EUR', 1990), list('ch', 'CHF', 2150), list('row', 'USD', 2400)]);
});

afterEach(async () => {
  await h?.close();
  await rm(publishRoot, { recursive: true, force: true });
});

const body = (over: Record<string, unknown> = {}) => ({
  items: [{ sku: 'mug', qty: 1 }],
  fields: {},
  _hpt: '',
  _elapsed: String(MIN_SUBMIT_ELAPSED_MS + 500),
  _ix: '3.5.1',
  ...over,
});
const checkout = (payload: unknown, via = 'card') => h.app.inject({ method: 'POST', url: `/pay/${projectId}/${via}`, payload: payload as never });
const sent = () => JSON.parse(scripted.calls.at(-1)!.body ?? '{}') as { amount: number; currency: string };

describe('★★ checkout in a market', () => {
  it('charges in the MARKET’s currency, from ITS price list, with ITS shipping — and records where', async () => {
    const res = await checkout(body({ market: 'ch', shipTo: 'CH' }));
    expect(res.statusCode).toBe(200);
    expect(res.json().currency).toBe('CHF');
    expect(sent()).toEqual({ amount: 2150 + 900, currency: 'CHF' });
    const [txn] = await h.db.select().from(shopTransactions);
    expect(txn).toMatchObject({ currency: 'CHF', market: 'ch', shipCountry: 'CH', catalogDigest: 'd_ch' });
  });

  it('a market without its own pricing in the shop’s currency uses the shop’s shipping', async () => {
    expect((await checkout(body({ market: 'eu', shipTo: 'de' }))).statusCode).toBe(200);
    expect(sent()).toEqual({ amount: 1990 + 499, currency: 'EUR' });
  });

  it('★ refuses an order that names no market, an unknown one, or a ship-to outside it', async () => {
    for (const [payload, error] of [
      [body(), 'market_required'],
      [body({ market: 'mars', shipTo: 'DE' }), 'unknown_market'],
      [body({ market: 'eu' }), 'ship_to_required'],
      // The cheaper market cannot ship somewhere it does not sell.
      [body({ market: 'eu', shipTo: 'CH' }), 'ship_to_not_in_market'],
      [body({ market: 'eu', shipTo: 'ZZ' }), 'ship_to_not_in_market'],
    ] as const) {
      const res = await checkout(payload);
      expect(res.statusCode, error).toBe(400);
      expect(res.json().error).toBe(error);
    }
    expect(scripted.calls).toEqual([]);
    expect(await h.db.select().from(shopTransactions)).toEqual([]);
  });

  it('★ the rest of the world ships to every country NO OTHER market claims — never to one that does', async () => {
    expect((await checkout(body({ market: 'row', shipTo: 'US' }))).statusCode).toBe(200);
    expect(sent()).toEqual({ amount: 2400, currency: 'USD' });
    const res = await checkout(body({ market: 'row', shipTo: 'DE' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('ship_to_not_in_market');
  });

  it('★ a market only takes orders through the channels — the providers — it offers', async () => {
    const refused = await checkout(body({ market: 'eu', shipTo: 'DE' }), 'local');
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toBe('channel_not_offered');
    expect((await checkout(body({ market: 'ch', shipTo: 'CH' }), 'local')).statusCode).toBe(200);
    expect((await h.db.select().from(shopTransactions))[0]?.gatewayId).toBe('local');
    // A market that names none offers every checkout channel.
    expect((await checkout(body({ market: 'row', shipTo: 'US' }), 'local')).statusCode).toBe(200);
  });

  it('refuses — before holding anything — a provider that declares it cannot charge the market’s currency', async () => {
    await h.db.update(content).set({ data: gateway('card', { currencies: ['EUR'] }) }).where(eq(content.id, 'gw_card'));
    expect((await checkout(body({ market: 'ch', shipTo: 'CH' }))).statusCode).toBe(503);
    expect(scripted.calls).toEqual([]);
    expect((await checkout(body({ market: 'eu', shipTo: 'DE' }))).statusCode).toBe(200);
  });

  it('refuses a price list built before the market changed currency, until the next publish', async () => {
    await h.db.update(shopCatalog).set({ currency: 'EUR' }).where(and(eq(shopCatalog.projectId, projectId), eq(shopCatalog.market, 'ch')));
    expect((await checkout(body({ market: 'ch', shipTo: 'CH' }))).statusCode).toBe(503);
  });

  it('a shop without markets ignores market and ship-to, exactly as before', async () => {
    await putShop({ ...SHOP, markets: undefined, channels: [channel('card', 'card')] });
    await h.db.insert(shopCatalog).values({ projectId, mode: 'live', market: '', currency: 'EUR', items: { mug: { sku: 'mug', name: 'Mug', priceMinor: 1000 } }, digest: 'd', publishedAt: new Date() });
    expect((await checkout(body({ market: 'ch', shipTo: 'CH' }))).statusCode).toBe(200);
    expect(sent()).toEqual({ amount: 1000 + 499, currency: 'EUR' });
    expect((await h.db.select().from(shopTransactions))[0]).toMatchObject({ market: null, shipCountry: null });
  });
});

describe('★★ publish → one sealed price list per market → the charge', () => {
  const PAGE = '<section>{{sw-add-to-cart sku="mug" name="Mug" prices=page.data.prices}}{{sw-add-to-cart sku="cap" name="Cap" price="9.50"}}</section>';

  it('the price a buyer is charged is the one the published page carries for their market', async () => {
    await h.db.delete(shopCatalog);
    await putShop(SHOP);
    const page = await owner.project(projectId).putContent('page', 'home', {
      id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: PAGE, data: { prices: { eu: 19.9, ch: '24.50' } },
    });
    expect(page.statusCode).toBeLessThan(400);
    expect((await owner.post(`/projects/${projectId}/publish`, {})).statusCode).toBe(200);

    const lists = await h.db.select().from(shopCatalog).where(eq(shopCatalog.mode, 'live'));
    const byMarket = Object.fromEntries(lists.map((l) => [l.market, l]));
    expect(Object.keys(byMarket).sort()).toEqual(['ch', 'eu', 'row']);
    expect(byMarket.ch!.currency).toBe('CHF');
    expect(byMarket.ch!.items).toEqual({ mug: { sku: 'mug', name: 'Mug', priceMinor: 2450 } });
    // The plain-price cap sells in the DEFAULT market only; the mug was given no US price.
    expect(Object.keys(byMarket.eu!.items).sort()).toEqual(['cap', 'mug']);
    expect(byMarket.row!.items).toEqual({});

    expect((await checkout(body({ market: 'ch', shipTo: 'CH' }))).statusCode).toBe(200);
    expect(sent()).toEqual({ amount: 2450 + 900, currency: 'CHF' });
    // Not sold in the rest of the world: refused by name, so the cart can say which line.
    const rest = await checkout(body({ market: 'row', shipTo: 'US' }));
    expect(rest.statusCode).toBe(409);
    expect(rest.json()).toMatchObject({ error: 'unknown-sku', sku: 'mug' });
  });

  it('★ a market removed since the last publish leaves NO price list a checkout could charge against', async () => {
    await putShop(SHOP, PAGE);
    expect((await owner.post(`/projects/${projectId}/publish`, {})).statusCode).toBe(200);
    await putShop({ ...SHOP, markets: MARKETS.filter((m) => m.id !== 'ch'), channels: [channel('card', 'card')] });
    expect((await owner.post(`/projects/${projectId}/publish`, {})).statusCode).toBe(200);
    const markets = (await h.db.select().from(shopCatalog).where(eq(shopCatalog.mode, 'live'))).map((l) => l.market).sort();
    expect(markets).toEqual(['eu', 'row']);
  });
});

describe('resolveMarket', () => {
  const shop = { ...SHOP } as never;
  it('normalises the ship-to country and names the market', () => {
    expect(resolveMarket(shop, 'card', 'eu', 'at')).toMatchObject({ ok: true, shipTo: 'AT', market: { id: 'eu' } });
  });
});

describe('mergeCatalogStock — stock is a fact about the SKU, not the market', () => {
  it('one entry per SKU across markets, the first declared stock winning', () => {
    const merged = mergeCatalogStock([
      { currency: 'EUR', items: { mug: { sku: 'mug', name: 'Mug', priceMinor: 1 } }, digest: 'a' },
      { currency: 'CHF', items: { mug: { sku: 'mug', name: 'Mug', priceMinor: 2, stock: 5 }, cap: { sku: 'cap', name: 'Cap', priceMinor: 3, stock: 1 } }, digest: 'b' },
    ]);
    expect(merged.items).toEqual({
      mug: { sku: 'mug', name: 'Mug', priceMinor: 1, stock: 5 },
      cap: { sku: 'cap', name: 'Cap', priceMinor: 3, stock: 1 },
    });
  });
});
