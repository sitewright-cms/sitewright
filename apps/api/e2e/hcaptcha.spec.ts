import { test, expect } from '@playwright/test';
import { adminContext, enableLocalHosting } from './helpers.js';


// hCaptcha (Phase 4) over HTTP: the admin configures instance hCaptcha keys, a form
// opts in, publish bakes the widget into the exported HTML, and the public endpoint
// rejects a submission with no/invalid captcha token (fail-closed). The DinD instance
// is started with SW_ADMIN_EMAILS=admin@e2e.test + SW_ENCRYPTION_KEY (for the secret).
test('hcaptcha: configured keys render the widget and gate submissions', async ({ playwright, baseURL }) => {
    const stamp = Date.now();
  const admin = await adminContext(playwright, baseURL);
  // Configure instance hCaptcha keys (secret encrypted at rest).
  const settings = await admin.put('/admin/settings', {
    data: { hcaptcha: { siteKey: `hcsite-${stamp}`, secret: 'hc-secret-xyz' } },
  });
  expect(settings.status()).toBe(200);

  // A project with a form that requires hCaptcha + a page embedding it.
  const slug = `hc-${stamp}`;
  const proj = await admin.post(`/projects`, { data: { name: 'HC Site', slug } });
  const projectId = (await proj.json()).project.id as string;
  const base = `/projects/${projectId}`;
  await admin.put(`${base}/content/form/contact`, {
    data: { id: 'contact', name: 'Contact', fields: [{ name: 'email', label: 'Email', type: 'email', required: true }], recipient: 'leads@acme.example', hcaptcha: true },
  });
  await admin.put(`${base}/content/page/contact`, {
    // Code-first: the block-tree renderer was removed in #250, so a `Form` BLOCK renders as Unknown
    // and no form markup reaches the export. {{sw-form}} is the supported embed.
    data: { id: 'contact', path: 'contact', title: 'Contact', source: '<section>{{sw-form "contact"}}</section>' },
  });
  await enableLocalHosting(admin, projectId);
  expect((await admin.post(`${base}/publish`)).status()).toBe(200);

  // The exported page carries the hCaptcha widget with the configured site key.
  const html = await (await admin.get(`/sites/${slug}/contact/`)).text();
  expect(html).toContain('class="h-captcha"');
  expect(html).toContain(`data-sitekey="hcsite-${stamp}"`);

  // A submission with NO captcha token is rejected (fail-closed) and not stored.
  // The accept path (a valid token) needs a real hCaptcha solve, so it's covered by
  // the integration test with an injected verifier rather than here.
  const noToken = await admin.post(`/f/${projectId}/contact`, { data: { email: 'x@y.co', _elapsed: '5000' } });
  expect(noToken.status()).toBe(400);
  expect((await (await admin.get(`${base}/submissions`)).json()).total).toBe(0);

  await admin.dispose();
});
