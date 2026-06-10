import { test, expect } from '@playwright/test';

const stamp = Date.now();

// MINI SHOP end-to-end against a deployed instance: an author publishes a code-first page using the
// {{sw-add-to-cart}} + {{sw-cart}} helpers with website.shop configured. On the PUBLISHED static site
// the first-party cart.js runtime must wire the buttons → a localStorage cart → the WhatsApp deep
// link. This exercises the real browser runtime (not just the rendered markup).
test('published cart: add-to-cart opens the drawer and builds the WhatsApp order link', async ({ page, playwright, baseURL }) => {
  // --- set up + publish a shop over HTTP (PR-1 has no shop settings UI yet — that is PR-3) ---
  const ctx = await playwright.request.newContext({ baseURL });
  expect((await ctx.post('/auth/register', { data: { email: `shop-${stamp}@e2e.test`, password: 'pw-secret-1' } })).status()).toBe(201);
  const slug = `shop-${stamp}`;
  const proj = await ctx.post('/projects', { data: { name: 'Shop Site', slug } });
  expect(proj.status()).toBe(201);
  const projectId = (await proj.json()).project.id as string;
  const base = `/projects/${projectId}`;

  // website.shop: currency + two deep-link channels (WhatsApp + a PayPal.me payment link).
  const settings = {
    identity: { name: 'Acme', colors: { primary: '#0a7a5a' } },
    website: {
      shop: {
        currency: { code: 'USD', symbol: '$', position: 'before', decimals: 2 },
        channels: [
          { kind: 'whatsapp', number: '+14155550123', label: 'Order on WhatsApp' },
          { kind: 'payment', urlTemplate: 'https://paypal.me/acme/{total}', label: 'Pay now' },
        ],
      },
    },
    settings: {},
  };
  expect((await ctx.put(`${base}/content/settings/settings`, { data: settings })).status()).toBe(200);

  const home = {
    id: 'home',
    path: '',
    title: 'Shop',
    root: { id: 'r', type: 'Section' },
    source:
      '<section class="p-8">' +
      '{{sw-add-to-cart sku="w1" name="Widget" price="19.90"}}' +
      '{{sw-add-to-cart sku="g1" name="Gadget" price="49"}}' +
      '{{sw-cart}}' +
      '</section>',
  };
  expect((await ctx.put(`${base}/content/page/home`, { data: home })).status()).toBe(200);
  expect((await ctx.post(`${base}/publish`)).status()).toBe(200);

  // The runtime is shipped only-when-used.
  expect((await ctx.get(`/sites/${slug}/cart.js`)).status()).toBe(200);

  // --- drive the PUBLISHED page in a real browser ---
  // Capture window.open so we can assert the channel deep link without leaving the page.
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = ((u?: string | URL) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(u));
      return null;
    }) as typeof window.open;
  });
  await page.goto(`/sites/${slug}/`);

  const cart = page.locator('[data-sw-cart]');
  const dialog = cart.locator('dialog');
  const count = cart.locator('[data-sw-part="count"]');
  // PE-first: the drawer is closed and the count badge hidden until items are added.
  await expect(dialog).toBeHidden();
  await expect(count).toBeHidden();

  // Adding products does NOT pop the drawer (so several can be added in a row) — the badge bumps.
  await page.locator('[data-sw-cart-add][data-sku="w1"]').click();
  await expect(count).toHaveText('1');
  await expect(dialog).toBeHidden();
  // Add the second (distinct sku) → 2 lines, count 2.
  await page.locator('[data-sw-cart-add][data-sku="g1"]').click();
  await expect(count).toHaveText('2');

  // The cart persisted to a per-site localStorage key.
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.indexOf('sw-cart:') === 0));
  expect(keys.length).toBe(1);

  // Open the drawer via the floating toggle and verify the subtotal (19.90 + 49.00 = 68.90).
  await cart.locator('[data-sw-part="toggle"]').click();
  await expect(dialog).toBeVisible();
  await expect(cart.locator('[data-sw-part="subtotal"]')).toContainText('$68.90');

  // Click the WhatsApp channel → a wa.me deep link with the digit-only number and the encoded order.
  await cart.getByRole('button', { name: 'Order on WhatsApp' }).click();
  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
  expect(opened.length).toBe(1);
  expect(opened[0]).toMatch(/^https:\/\/wa\.me\/14155550123\?text=/);
  const text = decodeURIComponent(opened[0].split('text=')[1]);
  expect(text).toContain('Widget');
  expect(text).toContain('Gadget');
  expect(text).toContain('Total: $68.90');

  await ctx.dispose();
});
