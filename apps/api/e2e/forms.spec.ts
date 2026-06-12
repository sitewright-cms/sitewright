import { test, expect } from '@playwright/test';

// Full forms loop over HTTP: author a form + a page that embeds it, publish,
// confirm the exported HTML carries the JS-only form (no recipient), submit via
// the PUBLIC endpoint, and read it back from the authenticated inbox. Honeypot
// and unknown-form paths are checked too. (No SMTP is configured on the DinD
// instance, so the submission is stored but not emailed — exactly the desired
// "inbox is the source of truth" behavior; email delivery is unit-tested.)
test('author → publish → public submit → inbox', async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });
  const stamp = Date.now();

  const reg = await api.post('/auth/register', {
    data: { email: `forms-${stamp}@e2e.test`, password: 'Pw-secret-1' },
  });
  expect(reg.status()).toBe(201);
  const slug = `forms-${stamp}`;
  const proj = await api.post(`/projects`, { data: { name: 'Forms Site', slug } });
  const projectId = (await proj.json()).project.id as string;
  const base = `/projects/${projectId}`;

  // Author the form (recipient is server-side only).
  const putForm = await api.put(`${base}/content/form/contact`, {
    data: {
      id: 'contact',
      name: 'Contact form',
      fields: [
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'message', label: 'Message', type: 'textarea' },
      ],
      recipient: 'secret-recipient@acme.example',
    },
  });
  expect(putForm.status()).toBe(200);

  // A page embedding the form.
  const putPage = await api.put(`${base}/content/page/contact`, {
    data: {
      id: 'contact',
      path: 'contact',
      title: 'Contact',
      root: { id: 'r', type: 'Section', children: [{ id: 'f', type: 'Form', props: { formId: 'contact' } }] },
    },
  });
  expect(putPage.status()).toBe(200);

  expect((await api.post(`${base}/publish`)).status()).toBe(200);

  // The exported page carries the JS-only form pointing at the platform endpoint;
  // the recipient is NOT in the HTML.
  const exported = await api.get(`/sites/${slug}/contact/`);
  expect(exported.status()).toBe(200);
  const html = await exported.text();
  expect(html).toContain('data-sw-component="form"');
  expect(html).toContain(`data-sw-endpoint="/f/${projectId}/contact"`);
  expect(html).not.toContain('secret-recipient@acme.example');

  // Public submission (cross-origin in production; assert CORS + storage).
  const submit = await api.post(`/f/${projectId}/contact`, {
    data: { email: 'lead@x.co', message: 'Hello from E2E', _elapsed: '5000' },
  });
  expect(submit.status()).toBe(200);
  expect(await submit.json()).toEqual({ ok: true });
  expect(submit.headers()['access-control-allow-origin']).toBe('*');

  // Read it back from the authenticated inbox.
  const inbox = await api.get(`${base}/submissions`);
  expect(inbox.status()).toBe(200);
  const body = await inbox.json();
  expect(body.total).toBe(1);
  expect(body.items[0].fields).toEqual({ email: 'lead@x.co', message: 'Hello from E2E' });

  // Honeypot-filled submission is dropped (still 200, not stored).
  const trap = await api.post(`/f/${projectId}/contact`, {
    data: { email: 'bot@x.co', _hpt: 'i am a bot', _elapsed: '5000' },
  });
  expect(trap.status()).toBe(200);
  expect((await (await api.get(`${base}/submissions`)).json()).total).toBe(1);

  // Unknown form → 404.
  expect((await api.post(`/f/${projectId}/nope`, { data: { a: '1' } })).status()).toBe(404);

  await api.dispose();
});
