import { test, expect } from '@playwright/test';

// Mode C / thirdParty (Phase 6) over HTTP: the admin enables the thirdParty mode, a
// form targets an external endpoint, and publish points the exported form directly
// at that URL — Sitewright is not involved in submission (no /f endpoint, no
// contact.php). The DinD instance runs with SW_ADMIN_EMAILS=admin@e2e.test.
const PW = 'pw-secret-1';

test('thirdParty: enabled mode points the exported form at the external endpoint', async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });
  const stamp = Date.now();

  const reg = await api.post('/auth/register', { data: { email: 'admin@e2e.test', password: PW } });
  if (reg.status() === 409) {
    expect((await api.post('/auth/login', { data: { email: 'admin@e2e.test', password: PW } })).status()).toBe(200);
  } else {
    expect(reg.status()).toBe(201);
  }
  expect((await api.put('/admin/settings', { data: { formModes: { thirdParty: true } } })).status()).toBe(200);

  const slug = `tp-${stamp}`;
  const proj = await api.post(`/projects`, { data: { name: 'TP Site', slug } });
  const projectId = (await proj.json()).project.id as string;
  const base = `/projects/${projectId}`;

  expect((await (await api.get(`${base}/form-modes`)).json()).formModes.thirdParty).toBe(true);

  const endpoint = `https://forms.example/submit/${stamp}`;
  await api.put(`${base}/content/form/contact`, {
    data: { id: 'contact', name: 'Contact', fields: [{ name: 'email', label: 'Email', type: 'email', required: true }], recipient: 'unused@acme.example', mode: 'thirdParty', thirdPartyUrl: endpoint },
  });
  await api.put(`${base}/content/page/contact`, {
    data: { id: 'contact', path: '/contact', title: 'Contact', root: { id: 'r', type: 'Section', children: [{ id: 'f', type: 'Form', props: { formId: 'contact' } }] } },
  });
  expect((await api.post(`${base}/publish`)).status()).toBe(200);

  const html = await (await api.get(`/sites/${slug}/contact/`)).text();
  expect(html).toContain(`data-sw-endpoint="${endpoint}"`);
  expect(html).not.toContain(`/f/${projectId}/`); // not the platform endpoint
  expect(html).not.toContain('contact.php');
  expect(html).not.toContain('unused@acme.example'); // recipient never in HTML

  await api.dispose();
});
