import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: the MINI SHOP front-end cart. When a page/source/slot uses the {{sw-add-to-cart}} /
// {{sw-cart}} helpers, the publisher ships ONE first-party `cart.js` at the site root (linked per
// page at the right relative depth) plus the inline cart stylesheet — the only-used-ships discipline
// of components.js/animations.js. The cart mount carries the currency + submission channels (from
// website.shop) as escaped data-* attributes. A site that uses no cart gets byte-identical output.

describe('mini shop cart → publish', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'shop';
  let publishRoot: string;
  let mediaRoot: string;

  const shop = {
    enabled: true,
    currency: { position: 'after', decimals: 2 },
    channels: [
      { kind: 'whatsapp', key: 'whatsapp', number: '+14155550123' },
      { kind: 'payment', key: 'pay', urlTemplate: 'https://paypal.me/acme/{total}', provider: 'paypal' },
    ],
  };
  // Currency symbol/code + channel labels are translatable → the catalog (resolved per locale at render).
  const shopTr = {
    'cart.currency_symbol': { en: '€' },
    'cart.currency_code': { en: 'EUR' },
    'shop.whatsapp': { en: 'Order on WhatsApp' },
    'shop.pay': { en: 'Pay with PayPal' },
  };

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-cart-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-cart-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Shop', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('ships cart.js + the mount with currency/channels for a shop page, site-wide via the footer slot', async () => {
    const proj = client.project(projectId);
    expect(
      (
        await proj.putContent('settings', 'settings', {
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          // The cart mount lives in the footer slot → present on EVERY page.
          website: { footer: '{{sw-cart}}', shop, translations: shopTr },
          settings: {},
        })
      ).statusCode,
    ).toBe(200);
    const home = {
      id: 'home',
      path: '',
      title: 'Shop',
      root: { id: 'r', type: 'Section' },
      source: '<section>{{sw-add-to-cart sku="w1" name="Widget" price="19.90"}}</section>',
    };
    const about = {
      id: 'about',
      path: 'about',
      title: 'About',
      root: { id: 'r2', type: 'Section' },
      source: '<section><h1>Plain page on the same site</h1></section>',
    };
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
    expect((await proj.putContent('page', 'about', about)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.statusCode).toBe(200);
    // The add-to-cart button rendered with the canonical numeric price.
    expect(index.body).toContain('data-sw-cart-add');
    expect(index.body).toContain('data-sku="w1"');
    expect(index.body).toContain('data-price="19.9"');
    // The mount carries the currency + the channels JSON (attribute-escaped; the JSON quotes → &quot;).
    expect(index.body).toContain('data-sw-cart');
    expect(index.body).toContain('data-currency-symbol="€"');
    expect(index.body).toContain('data-currency-pos="after"');
    expect(index.body).toContain('data-channels=');
    expect(index.body).toContain('paypal.me/acme/{total}'); // payment urlTemplate survives verbatim
    expect(index.body).toContain('14155550123'); // whatsapp number
    // The runtime is linked at the site root.
    expect(index.body).toContain('<script defer src="_assets/_sw/cart.js?v=');

    // Site-wide asset: the nested page links it rebased to its depth (footer mount → every page).
    const aboutPage = await client.get(`/sites/${slug}/about/index.html`);
    expect(aboutPage.statusCode).toBe(200);
    expect(aboutPage.body).toContain('<script defer src="../_assets/_sw/cart.js?v=');

    // The runtime itself is served from the site root.
    const js = await client.get(`/sites/${slug}/_assets/_sw/cart.js`);
    expect(js.statusCode).toBe(200);
    expect(js.body).toContain('https://wa.me/');
    expect(js.body).toContain('localStorage');
  });

  it('bakes per-page cart string overrides (i18n) into the published mount', async () => {
    const proj = client.project(projectId);
    expect(
      (
        await proj.putContent('settings', 'settings', {
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          website: { shop: { enabled: true } },
          settings: {},
        })
      ).statusCode,
    ).toBe(200);
    // Shared code reads the strings from page.data — the inherit-mode localization pattern.
    const page = {
      id: 'shop-de',
      path: 'warenkorb',
      title: 'Shop',
      root: { id: 'r', type: 'Section' },
      data: { 'cart.title': 'Warenkorb', 'cart.empty': 'Ihr Warenkorb ist leer.' },
      source: '<section>{{sw-cart title=(lookup page.data "cart.title") empty=(lookup page.data "cart.empty")}}</section>',
    };
    expect((await proj.putContent('page', 'shop-de', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);
    const html = (await client.get(`/sites/${slug}/warenkorb/index.html`)).body;
    expect(html).toContain('data-cart-title="Warenkorb"'); // per-page hash override (lookup page.data)
    expect(html).toContain('data-empty-label="Ihr Warenkorb ist leer."');
  });

  it('auto-localizes a bare cart + add-to-cart from the translation catalog (reserved cart_* keys)', async () => {
    const proj = client.project(projectId);
    expect(
      (
        await proj.putContent('settings', 'settings', {
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          // No per-page hash, no website.shop labels — the strings come from website.translations.
          website: {
            footer: '{{sw-cart}}',
            shop,
            translations: {
              'cart.add': { en: 'Add to cart' },
              'cart.title': { en: 'Your cart' },
              'cart.empty': { en: 'Your cart is empty.' },
            },
          },
          settings: {},
        })
      ).statusCode,
    ).toBe(200);
    const home = {
      id: 'home',
      path: '',
      title: 'Shop',
      root: { id: 'r', type: 'Section' },
      source: '<section>{{sw-add-to-cart sku="w1" name="Widget" price="5"}}</section>',
    };
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const html = (await client.get(`/sites/${slug}/index.html`)).body;
    expect(html).toContain('data-cart-title="Your cart"'); // from website.translations, no hash
    expect(html).toContain('data-empty-label="Your cart is empty."');
    expect(html).toContain('>Add to cart</button>'); // sw-add-to-cart label from cart.add
  });

  it('ships NOTHING extra for a site that uses no cart', async () => {
    const proj = client.project(projectId);
    const page = {
      id: 'home',
      path: '',
      title: 'Home',
      root: { id: 'r', type: 'Section' },
      source: '<section><h1>Plain</h1></section>',
    };
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.body).not.toContain('cart.js');
    expect(index.body).not.toContain('data-sw-cart');
    expect((await client.get(`/sites/${slug}/_assets/_sw/cart.js`)).statusCode).toBe(404);
  });

  it('resolves the /f endpoint for a form channel in the published cart mount', async () => {
    const proj = client.project(projectId);
    expect(
      (
        await proj.putContent('settings', 'settings', {
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          website: { footer: '{{sw-cart}}', shop: { enabled: true, channels: [{ kind: 'form', key: 'order_form', formId: 'order' }] } },
          settings: {},
        })
      ).statusCode,
    ).toBe(200);
    const home = {
      id: 'home',
      path: '',
      title: 'Shop',
      root: { id: 'r', type: 'Section' },
      source: '<section>{{sw-add-to-cart sku="w1" name="Widget" price="9.99"}}</section>',
    };
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.statusCode).toBe(200);
    // The form channel's submission endpoint is resolved server-side (the cart can't build it).
    // The cart resolves its channel endpoint at runtime from the same encoded blob the forms use, so
    // the address is not in the page — only the channel's form id is.
    expect(index.body).not.toContain(`/f/${projectId}/order`);
    expect(index.body).toContain('order');
    expect(index.body).toContain('cart.js');
  });
});

// ★ A hosted site lives on its own origin, so with an absolute API address every call the cart and the
// thank-you panel make is cross-origin, and the page's policy must name the API host. It used to only for a
// page with a FORM (or with statistics on): a shop page with a checkout and nothing else published no
// widening at all, so the hosted site served `connect-src 'self'` and the browser blocked every checkout.
describe('mini shop cart → the published page policy lets it reach the API', () => {
  it('names the API host on a cart page and a thank-you page, and nowhere else', async () => {
    const publishRoot = await mkdtemp(join(tmpdir(), 'sw-cart-csp-'));
    const mediaRoot = await mkdtemp(join(tmpdir(), 'sw-cart-csp-media-'));
    const harness = await makeHarness({ publishRoot, mediaRoot, publicUrl: 'https://platform.example.com' });
    try {
      const client = await harness.signup();
      const projectId = await client.createProject('Shop', 'csp-shop');
      const proj = client.project(projectId);
      const shop = {
        enabled: true,
        currency: { code: 'EUR' },
        channels: [
          { kind: 'checkout', key: 'pay', gatewayId: 'stripe', email: 'orders@example.com' },
          { kind: 'form', key: 'order_form', email: 'orders@example.com', captcha: true },
        ],
      };
      // The cart names the project's captcha on its mount only when one is configured.
      const cap = await client.put(`/projects/${projectId}/captcha`, { provider: 'hcaptcha', siteKey: '10000000-ffff-ffff-ffff-000000000001', secret: 'vendor-secret' });
      expect(cap.statusCode).toBe(200);
      // No statistics: the collector would widen the same host and hide the gap.
      expect((await proj.putContent('settings', 'settings', { identity: { name: 'Acme' }, website: { shop }, settings: {} })).statusCode).toBe(200);
      const page = (id: string, path: string, source: string) => ({ id, path, title: id, root: { id: `r-${id}`, type: 'Section' }, source });
      expect((await proj.putContent('page', 'home', page('home', '', '<section>{{sw-add-to-cart sku="w1" name="Widget" price="9.99"}}{{sw-cart}}</section>'))).statusCode).toBe(200);
      expect((await proj.putContent('page', 'thanks', page('thanks', 'thanks', '<section>{{sw-order-status}}</section>'))).statusCode).toBe(200);
      expect((await proj.putContent('page', 'about', page('about', 'about', '<section><h1>About</h1></section>'))).statusCode).toBe(200);
      expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

      const csp = async (path: string): Promise<string> => {
        const html = await readFile(join(publishRoot, 'csp-shop', path, 'index.html'), 'utf8');
        return (/<meta name="sw-csp" content="([^"]*)"/.exec(html)?.[1] ?? '').replace(/&#39;/g, "'");
      };
      const connect = (policy: string): string => /connect-src [^;]*/.exec(policy)?.[0] ?? '';
      const home = await csp('');
      expect(connect(home)).toContain('https://platform.example.com');
      // The order form asks for a captcha, which the cart names on its mount: its provider may load too.
      expect(home).toMatch(/script-src [^;]*https:\/\/hcaptcha\.com/);
      const thanks = await csp('thanks');
      expect(connect(thanks)).toContain('https://platform.example.com');
      // The thank-you panel shows no captcha, so it does not get the captcha's hosts.
      expect(thanks).not.toContain('hcaptcha');
      expect(await csp('about')).not.toContain('platform.example.com');
    } finally {
      await harness.close();
      await rm(publishRoot, { recursive: true, force: true });
      await rm(mediaRoot, { recursive: true, force: true });
    }
  });
});
