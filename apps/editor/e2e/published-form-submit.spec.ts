import { test, expect } from '@playwright/test';
import { seedApiUser } from './helpers.js';

const stamp = Date.now();

// The whole chain for a platform-routed form, in a REAL browser: the published markup carries no
// submission address, the runtime assembles one from the encoded payload, a click actually posts it, and
// the lead lands in the inbox.
//
// This gap is why it needs to exist. `forms.spec.ts` (api) proves the HTML side but submits with an API
// request context; `forms-ui.spec.ts` does the same. `shop.spec.ts` is the only test that submits from a
// browser, and only through the CART. So nothing exercised the ordinary form's runtime path — which is
// exactly the path that breaks if the endpoint moves and the assembler is wrong, and it would break
// silently: a form that posts nowhere looks identical to one nobody filled in.
test('published form: no endpoint in the markup, and a real submit still reaches the inbox', async ({ page, baseURL }) => {
  const ctx = await seedApiUser(baseURL!, `pubform-${stamp}@e2e.test`);
  const slug = `pubform-${stamp}`;
  const proj = await ctx.post('/projects', { data: { name: 'Form Site', slug } });
  expect(proj.status()).toBe(201);
  const projectId = (await proj.json()).project.id as string;
  const base = `/projects/${projectId}`;

  expect(
    (
      await ctx.put(`${base}/content/form/contact`, {
        data: {
          id: 'contact',
          name: 'Contact form',
          fields: [
            { name: 'email', label: 'Email', type: 'email', required: true },
            { name: 'message', label: 'Message', type: 'textarea' },
          ],
          recipient: 'secret-recipient@acme.example',
        },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await ctx.put(`${base}/content/page/home`, {
        data: { id: 'home', path: '', title: 'Contact', source: '<section class="p-8">{{sw-form "contact"}}</section>' },
      })
    ).status(),
  ).toBe(200);
  expect([201, 409]).toContain((await ctx.post(`${base}/deploy-targets`, { data: { name: 'Local', protocol: 'local' } })).status());
  expect((await ctx.post(`${base}/publish`)).status()).toBe(200);

  await page.goto(`/sites/${slug}/`);

  // ★ The address is nowhere in the document the visitor receives.
  const html = await page.content();
  expect(html).not.toContain(`/f/${projectId}/`);
  expect(html).not.toContain('data-sw-endpoint');
  expect(html).toContain('data-sw-routed="contact"');
  expect(html).not.toContain('secret-recipient@acme.example'); // and neither is the recipient

  // …yet the runtime resolves one, from the encoded payload.
  const resolved = await page.evaluate(() => (window as unknown as { __swf?: (id: string) => string }).__swf?.('contact'));
  expect(resolved).toContain(`/f/${projectId}/contact`);

  // A REAL submit: fill the rendered fields and click the button, so the assembled URL is exercised by
  // the runtime rather than by the test. The time-trap silently drops anything faster than its minimum,
  // so wait it out first — a dropped submission also returns 200, and would look like a pass.
  const form = page.locator('form[data-sw-component="form"]');
  await expect(form).toBeVisible();
  await form.locator('input[name="email"]').fill('lead@example.com');
  await form.locator('[name="message"]').fill('Sent by clicking the real button.');
  await page.waitForTimeout(4000);
  const [posted] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/f/${projectId}/contact`) && r.request().method() === 'POST'),
    form.locator('[data-sw-part="submit"]').click(),
  ]);
  expect(posted.status()).toBe(200);
  await expect(form.locator('[data-sw-part="success"]')).toBeVisible();

  // …and it is a STORED lead, not a silently-dropped one.
  const inbox = await ctx.get(`${base}/submissions?formId=contact`);
  expect(inbox.status()).toBe(200);
  const body = (await inbox.json()) as { total: number; items: Array<{ fields: Record<string, string> }> };
  expect(body.total).toBe(1);
  expect(body.items[0]!.fields.email).toBe('lead@example.com');
  await ctx.dispose();
});
