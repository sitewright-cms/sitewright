import { test, expect } from '@playwright/test';
import { adminContext, enableLocalHosting } from './helpers.js';

/** hCaptcha's own documented TEST site key. A site key is validated for the UUID shape a real one
 * has, so a `site-key`-style placeholder is no longer a usable fixture — which is the point: that
 * class of value is exactly what reached visitors as data-sitekey="123". */
const HCAPTCHA_TEST_SITEKEY = '10000000-ffff-ffff-ffff-000000000001';


// hCaptcha (Phase 4) over HTTP: the admin configures instance hCaptcha keys, a form
// opts in, publish bakes the widget into the exported HTML, and the public endpoint
// rejects a submission with no/invalid captcha token (fail-closed). The DinD instance
// is started with SW_ADMIN_EMAILS=admin@e2e.test + SW_ENCRYPTION_KEY (for the secret).
test('captcha: a project’s configured keys render the widget and gate submissions', async ({ playwright, baseURL }) => {
  const stamp = Date.now();
  const admin = await adminContext(playwright, baseURL);
  // Configure instance hCaptcha keys (secret encrypted at rest).
  // A project with a form that requires a captcha + a page embedding it. The credentials are the
  // PROJECT's now — a site key is bound to a domain allowlist, and a domain belongs to a site.
  const slug = `hc-${stamp}`;
  const proj = await admin.post(`/projects`, { data: { name: 'HC Site', slug } });
  const projectId = (await proj.json()).project.id as string;
  const base = `/projects/${projectId}`;
  const settings = await admin.put(`${base}/captcha`, {
    data: { provider: 'hcaptcha', siteKey: HCAPTCHA_TEST_SITEKEY, secret: 'hc-secret-xyz' },
  });
  expect(settings.status()).toBe(200);
  expect(await settings.text()).not.toContain('hc-secret-xyz'); // the secret is never echoed back
  await admin.put(`${base}/content/form/contact`, {
    data: { id: 'contact', name: 'Contact', fields: [{ name: 'email', label: 'Email', type: 'email', required: true }], recipient: 'leads@acme.example', captcha: true },
  });
  await admin.put(`${base}/content/page/contact`, {
    // Code-first: the block-tree renderer was removed in #250, so a `Form` BLOCK renders as Unknown
    // and no form markup reaches the export. {{sw-form}} is the supported embed.
    data: { id: 'contact', path: 'contact', title: 'Contact', source: '<section>{{sw-form "contact"}}</section>' },
  });
  await enableLocalHosting(admin, projectId);
  expect((await admin.post(`${base}/publish`)).status()).toBe(200);

  // The exported page carries the hCaptcha widget with the project's site key, and names the
  // provider on the form (which is what the page's CSP and the runtime both switch on).
  const html = await (await admin.get(`/sites/${slug}/contact/`)).text();
  expect(html).toContain('class="h-captcha"');
  expect(html).toContain(`data-sitekey="${HCAPTCHA_TEST_SITEKEY}"`);
  expect(html).toContain('data-sw-captcha="hcaptcha"');

  // A submission with NO captcha token is rejected (fail-closed) and not stored.
  // The accept path (a valid token) needs a real hCaptcha solve, so it's covered by
  // the integration test with an injected verifier rather than here.
  const noToken = await admin.post(`/f/${projectId}/contact`, { data: { email: 'x@y.co', _elapsed: '5000', _ix: '3.12.2' } });
  expect(noToken.status()).toBe(400);
  expect((await (await admin.get(`${base}/submissions`)).json()).total).toBe(0);

  await admin.dispose();
});
