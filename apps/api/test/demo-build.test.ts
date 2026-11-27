import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectBundle } from '@sitewright/core';
import { BookingConfigSchema, FormSchema } from '@sitewright/schema';
import type { ShopCatalog } from '@sitewright/blocks';
import { buildSite } from '../src/publish/build.js';
import { demoRuntimeData } from '../src/publish/demo-build.js';

/**
 * ★★ A DEMO COPY's build, file by file.
 *
 * Every file of the build is read — the pages of both languages, the scripts, the indexes, the runtime — and none
 * may name a receiver. The same bundle built as a live site is read the same way, and must name every one of them:
 * otherwise the demo's silence would prove nothing.
 */

const SITE_KEY = '10000000-ffff-ffff-ffff-000000000001';
// Each string is a receiver the live build carries somewhere: the platform, captcha, an inbox, a number, a
// third-party form or payment link, a managed analytics account, a search engine's verification.
const RECEIVERS = [
  'sw.test',
  SITE_KEY,
  'leads@shop.test',
  'orders@shop.test',
  '+264811234567',
  '+264819876543',
  'forms.elsewhere.test',
  'pay.elsewhere.test',
  'G-ABC123',
  'gv-token-123',
];

const field = [{ name: 'email', label: 'Email', type: 'email', required: true }];
const form = (f: Record<string, unknown>) => FormSchema.parse({ fields: field, recipient: 'leads@shop.test', ...f });
const FORMS = [
  form({ id: 'contact', name: 'Contact', captcha: true, pow: true, redirectUrl: 'https://forms.elsewhere.test/thanks' }),
  form({ id: 'php', name: 'PHP', mode: 'contactPhp' }),
  form({ id: 'tp', name: 'Third party', mode: 'thirdParty', thirdPartyUrl: 'https://forms.elsewhere.test/in' }),
  form({ id: 'wa', name: 'WhatsApp', mode: 'whatsapp', whatsappNumber: '+264819876543' }),
  form({ id: 'shop-order', name: 'Order', managed: 'shop', recipient: 'orders@shop.test' }),
];
const SHOP = (price: string) => ({
  enabled: true,
  currency: { code: 'EUR' },
  pricing: { shipping: { flatMinor: 495, freeOverMinor: 5000 }, tax: { rateBp: 1900, mode: 'exclusive' } },
  channels: [
    { kind: 'checkout', key: 'card', gatewayId: 'card', email: 'orders@shop.test', captcha: true, pow: true, returnPath: '/thank-you/' },
    { kind: 'form', key: 'order', email: 'orders@shop.test', captcha: true },
    { kind: 'whatsapp', key: 'wa', number: '+264811234567' },
    { kind: 'mailto', key: 'mail', email: 'orders@shop.test' },
    { kind: 'payment', key: 'link', urlTemplate: 'https://pay.elsewhere.test/{total}' },
  ],
  _price: price,
});
const BOOKING = BookingConfigSchema.parse({
  resources: [{ id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin' }],
  offerings: [{ id: 'massage', name: 'Massage', resourceIds: ['anna'], mode: 'duration', durationMin: 60 }],
  statusPath: '/my-booking/',
  captcha: true,
  pow: true,
});

function bundle(price = '9.50'): ProjectBundle {
  const { _price, ...shop } = SHOP(price);
  const home = (h: string) =>
    `<section><h1>${h}</h1>{{sw-form "contact"}}{{sw-form "php"}}{{sw-form "tp"}}{{sw-form "wa"}}` +
    `{{sw-add-to-cart sku="mug" name="Enamel mug" price="${_price}"}}{{sw-cart}}{{sw-booking "massage"}}</section>`;
  return {
    project: {
      formatVersion: 2 as const,
      id: 'p1',
      name: 'Shop',
      slug: 'shop',
      identity: { name: 'Shop', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
      website: {
        shop,
        statistics: { enabled: true },
        consent: { enabled: true, integrations: [{ id: 'ga', name: 'GA', category: 'analytics', preset: 'ga4', measurementId: 'G-ABC123' }] },
      },
    },
    pages: [
      { id: 'home', path: '', title: 'Home', source: home('Home') },
      { id: 'about', path: 'about', title: 'About', source: '<section><h1>About us</h1></section>' },
      { id: 'thanks', path: 'thank-you', title: 'Thanks', source: '<section>{{sw-order-status}}</section>' },
      { id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de', translationGroup: 'home', source: home('Start') },
      { id: 'about-de', path: 'about', parent: 'home-de', title: 'Über', locale: 'de', translationGroup: 'about', source: '<section><h1>Über uns</h1></section>' },
    ],
    datasets: [],
    entries: [],
    forms: FORMS,
    booking: BOOKING,
  } as unknown as ProjectBundle;
}

let dirs: string[] = [];
beforeEach(() => {
  dirs = [];
});
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function build(b: ProjectBundle, demo: boolean): Promise<Map<string, string>> {
  const outDir = await mkdtemp(join(tmpdir(), 'sw-demo-build-'));
  dirs.push(outDir, `${outDir}.tmp`);
  await buildSite({
    outDir,
    bundle: b,
    publishedAt: '2026-11-27T00:00:00.000Z',
    publicBaseUrl: 'https://sw.test',
    captcha: { provider: 'hcaptcha', siteKey: SITE_KEY },
    stats: { key: 'k' },
    siteVerification: { google: 'gv-token-123' },
    ...(demo ? { demo: true } : {}),
  });
  const files = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else files.set(relative(outDir, full).replaceAll('\\', '/'), await readFile(full, 'utf8'));
    }
  };
  await walk(outDir);
  return files;
}

const versionOf = (html: string) => /sw-demo\.js\?v=([^"]+)"/.exec(html)?.[1];

describe('★★ a demo copy names no receiver, in any file', () => {
  it('the live build names every receiver; the demo build, file by file, none', async () => {
    const live = await build(bundle(), false);
    const everything = [...live.values()].join('\n');
    for (const r of RECEIVERS) expect(everything, `the live build carries ${r}`).toContain(r);
    expect([...live.keys()]).toContain('contact.php');

    const demo = await build(bundle(), true);
    for (const [path, text] of demo) {
      for (const r of RECEIVERS) expect(text, `${path} names ${r}`).not.toContain(r);
    }
    const paths = [...demo.keys()];
    expect(paths).not.toContain('contact.php');
    expect(paths.some((p) => p.endsWith('/stats.js'))).toBe(false);
    expect(paths).toContain('_assets/_sw/sw-demo.js');
    // Both languages were built, so both were read.
    expect(paths).toEqual(expect.arrayContaining(['index.html', 'de/index.html', 'about/index.html', 'de/about/index.html', 'thank-you/index.html']));
  });

  it('loads the runtime as a PLAIN script, and only on the pages that call the platform', async () => {
    const demo = await build(bundle(), true);
    for (const page of ['index.html', 'de/index.html', 'thank-you/index.html']) {
      const html = demo.get(page)!;
      const tags = html.match(/<script[^>]*sw-demo\.js[^>]*>/g) ?? [];
      expect(tags, page).toHaveLength(1);
      // Not deferred and not async: it runs where it stands, before the deferred runtimes call the builders.
      expect(tags[0], page).not.toMatch(/\b(defer|async)\b/);
      expect(html.indexOf(tags[0]!), page).toBeGreaterThan(html.lastIndexOf('<script defer'));
    }
    // A page with nothing to send fetches nothing.
    for (const page of ['about/index.html', 'de/about/index.html']) expect(demo.get(page), page).not.toContain('sw-demo.js');
    // The consent manager stays, without the integration it would load.
    expect(demo.get('index.html')).toContain('data-sw-consent');
  });

  it('★ versions the runtime by its own bytes: a changed price is a new address on every page that loads it', async () => {
    const before = await build(bundle('9.50'), true);
    const after = await build(bundle('12.00'), true);
    const digest = (files: Map<string, string>) => createHash('sha256').update(files.get('_assets/_sw/sw-demo.js')!).digest('hex');
    for (const page of ['index.html', 'de/index.html', 'thank-you/index.html']) {
      const v1 = versionOf(before.get(page)!);
      const v2 = versionOf(after.get(page)!);
      expect(v1, page).toBeDefined();
      expect(v2, page).not.toBe(v1);
      expect(digest(before).startsWith(v1!), page).toBe(true);
      expect(digest(after).startsWith(v2!), page).toBe(true);
    }
  });
});

describe('the demo runtime data', () => {
  const catalog = (currency: string, market?: string): ShopCatalog => ({
    currency,
    ...(market ? { market } : {}),
    items: { mug: { sku: 'mug', name: 'Mug', priceMinor: 950, stock: 3 } },
    digest: 'd',
  });

  it('carries the pricing the live checkout applies: a market’s own, else the shop’s', () => {
    const shopPricing = { shipping: { flatMinor: 495 }, tax: { rateBp: 1900, mode: 'inclusive' as const } };
    const usPricing = { shipping: { flatMinor: 900, freeOverMinor: 10000 }, tax: { rateBp: 800, mode: 'exclusive' as const } };
    const b = bundle();
    const withMarkets = {
      ...b,
      project: {
        ...b.project,
        website: {
          shop: { enabled: true, pricing: shopPricing, markets: [{ id: 'eu', currency: 'EUR' }, { id: 'us', currency: 'USD', pricing: usPricing }], channels: [] },
        },
      },
    } as unknown as ProjectBundle;
    const data = demoRuntimeData(withMarkets, undefined, { eu: catalog('EUR', 'eu'), us: catalog('USD', 'us') });
    expect(data.catalogs?.eu?.pricing).toEqual(shopPricing);
    expect(data.catalogs?.us?.pricing).toEqual(usPricing);
    expect(data.catalogs?.us).toMatchObject({ c: 'USD', d: 2, items: { mug: { n: 'Mug', p: 950 } } });
    // Never the declared stock.
    expect(JSON.stringify(data)).not.toContain('stock');

    const single = demoRuntimeData({ ...b, project: { ...b.project, website: { shop: { enabled: true, pricing: shopPricing, channels: [] } } } } as unknown as ProjectBundle, catalog('JPY'), undefined);
    expect(single.catalog).toMatchObject({ c: 'JPY', d: 0, pricing: shopPricing });
  });
});
