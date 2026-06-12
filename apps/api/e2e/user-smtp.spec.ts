import { test, expect } from '@playwright/test';

// Mode B / userSmtp (Phase 5b) over HTTP: the admin enables the userSmtp mode, the
// project configures its own SMTP (encrypted, masked), a userSmtp form is created,
// and a public submission is stored (email is best-effort — the dummy SMTP host
// refuses fast, so delivery fails but the submission is captured in the inbox).
const PW = 'Pw-secret-1';

test('userSmtp: project SMTP config + a userSmtp form stores submissions', async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });
  const stamp = Date.now();

  const reg = await api.post('/auth/register', { data: { email: 'admin@e2e.test', password: PW } });
  if (reg.status() === 409) {
    expect((await api.post('/auth/login', { data: { email: 'admin@e2e.test', password: PW } })).status()).toBe(200);
  } else {
    expect(reg.status()).toBe(201);
  }
  // Enable the userSmtp mode instance-wide.
  expect((await api.put('/admin/settings', { data: { formModes: { userSmtp: true } } })).status()).toBe(200);

  const proj = await api.post(`/projects`, { data: { name: 'US Site', slug: `us-${stamp}` } });
  const projectId = (await proj.json()).project.id as string;
  const base = `/projects/${projectId}`;

  // form-modes reflects the admin's choice.
  expect((await (await api.get(`${base}/form-modes`)).json()).formModes.userSmtp).toBe(true);

  // Configure the project's own SMTP (refusing host → delivery fails fast, but storage works).
  const putSmtp = await api.put(`${base}/smtp`, {
    data: { host: '127.0.0.1', port: 2, secure: false, user: 'mailer', password: 'proj-secret-pw', fromEmail: 'no-reply@acme.example', fromName: 'Acme' },
  });
  expect(putSmtp.status()).toBe(200);
  const smtpBody = await putSmtp.text();
  expect(smtpBody).not.toContain('proj-secret-pw'); // password never returned
  expect(JSON.parse(smtpBody).smtp.hasPassword).toBe(true);

  // A userSmtp form + a public submission → stored (email best-effort).
  await api.put(`${base}/content/form/lead`, {
    data: { id: 'lead', name: 'Lead', fields: [{ name: 'email', label: 'Email', type: 'email', required: true }], recipient: 'sales@acme.example', mode: 'userSmtp' },
  });
  const submit = await api.post(`/f/${projectId}/lead`, { data: { email: 'visitor@x.co', _elapsed: '5000' } });
  expect(submit.status()).toBe(200);
  expect(await submit.json()).toEqual({ ok: true });

  const inbox = await (await api.get(`${base}/submissions`)).json();
  expect(inbox.total).toBe(1);
  expect(inbox.items[0].fields).toEqual({ email: 'visitor@x.co' });

  await api.dispose();
});
