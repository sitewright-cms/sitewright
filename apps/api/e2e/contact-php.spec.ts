import { test, expect } from '@playwright/test';

// Mode B / contact.php (Phase 5a) over HTTP: an admin enables the contactPhp mode,
// a form uses it, and publish bakes a contact.php (PHP mail()) into the export while
// the page form points at it — with the recipient kept server-side (never in HTML).
// The DinD instance runs with SW_ADMIN_EMAILS=admin@e2e.test + SW_ENCRYPTION_KEY.
const PW = 'pw-secret-1';

test('contactPhp: enabled mode publishes a contact.php and points the form at it', async ({ playwright, baseURL }) => {
  const admin = await playwright.request.newContext({ baseURL });
  const stamp = Date.now();

  const reg = await admin.post('/auth/register', { data: { email: 'admin@e2e.test', password: PW } });
  if (reg.status() === 409) {
    expect((await admin.post('/auth/login', { data: { email: 'admin@e2e.test', password: PW } })).status()).toBe(200);
  } else {
    expect(reg.status()).toBe(201);
  }
  // Enable the contactPhp mode instance-wide.
  expect((await admin.put('/admin/settings', { data: { formModes: { contactPhp: true } } })).status()).toBe(200);

  const slug = `cp-${stamp}`;
  const proj = await admin.post(`/projects`, { data: { name: 'CP Site', slug } });
  const projectId = (await proj.json()).project.id as string;
  const base = `/projects/${projectId}`;

  // The form-modes endpoint reflects the admin's choice.
  const modes = await admin.get(`${base}/form-modes`);
  expect((await modes.json()).formModes.contactPhp).toBe(true);

  // A contactPhp form + a page embedding it.
  await admin.put(`${base}/content/form/contact`, {
    data: { id: 'contact', name: 'Contact', fields: [{ name: 'email', label: 'Email', type: 'email', required: true }], recipient: 'leads@acme.example', mode: 'contactPhp' },
  });
  await admin.put(`${base}/content/page/contact`, {
    data: { id: 'contact', path: '/contact', title: 'Contact', root: { id: 'r', type: 'Section', children: [{ id: 'f', type: 'Form', props: { formId: 'contact' } }] } },
  });
  expect((await admin.post(`${base}/publish`)).status()).toBe(200);

  // The exported page posts to contact.php (root-relative); the recipient is NOT in the HTML.
  const html = await (await admin.get(`/sites/${slug}/contact/`)).text();
  expect(html).toContain('data-sw-endpoint="../contact.php"');
  expect(html).toContain('name="_form" value="contact"');
  expect(html).not.toContain('leads@acme.example');

  // contact.php is part of the export but NOT served over /sites (no executable PHP host here).
  expect((await admin.get(`/sites/${slug}/contact.php`)).status()).toBe(404);

  await admin.dispose();
});
