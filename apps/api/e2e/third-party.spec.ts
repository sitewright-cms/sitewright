import { test, expect } from '@playwright/test';
import { adminContext, enableLocalHosting } from './helpers.js';

// Mode C / thirdParty (Phase 6) over HTTP: the admin enables the thirdParty mode, a
// form targets an external endpoint, and publish points the exported form directly
// at that URL — Sitewright is not involved in submission (no /f endpoint, no
// contact.php). The DinD instance runs with SW_ADMIN_EMAILS=admin@e2e.test.

test('thirdParty: enabled mode points the exported form at the external endpoint', async ({ playwright, baseURL }) => {
    const stamp = Date.now();
  const api = await adminContext(playwright, baseURL);
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
    // Code-first: the block-tree renderer was removed in #250, so a `Form` BLOCK renders as Unknown
    // and no form markup reaches the export. {{sw-form}} is the supported embed.
    data: { id: 'contact', path: 'contact', title: 'Contact', source: '<section>{{sw-form "contact"}}</section>' },
  });
  await enableLocalHosting(api, projectId);
  expect((await api.post(`${base}/publish`)).status()).toBe(200);

  const html = await (await api.get(`/sites/${slug}/contact/`)).text();
  expect(html).toContain(`data-sw-endpoint="${endpoint}"`);
  expect(html).not.toContain(`/f/${projectId}/`); // not the platform endpoint
  expect(html).not.toContain('contact.php');
  expect(html).not.toContain('unused@acme.example'); // recipient never in HTML

  await api.dispose();
});
