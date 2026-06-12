import { test, expect } from '@playwright/test';

// The deployed instance is started with SW_ADMIN_EMAILS=admin@e2e.test and a
// SW_ENCRYPTION_KEY. This exercises the instance-admin settings flow over HTTP:
// a normal user is denied; the configured admin can read/write settings; secrets
// are stored but never returned.

const ADMIN_EMAIL = 'admin@e2e.test';
const PW = 'Pw-secret-1';

test('instance admin settings: gating, persistence, and secret masking', async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });
  const stamp = Date.now();

  // --- A normal (non-admin) user is denied. ---
  const userReg = await api.post('/auth/register', {
    data: { email: `user-${stamp}@e2e.test`, password: PW },
  });
  expect(userReg.status()).toBe(201);
  const userMe = await api.get('/me');
  expect((await userMe.json()).isInstanceAdmin).toBe(false);
  expect((await api.get('/admin/settings')).status()).toBe(403);
  await api.dispose();

  // --- The configured admin can manage settings. Register-or-login for
  // idempotency across repeated runs against the same (persistent) container. ---
  const admin = await playwright.request.newContext({ baseURL });
  const reg = await admin.post('/auth/register', {
    data: { email: ADMIN_EMAIL, password: PW },
  });
  if (reg.status() === 409) {
    const login = await admin.post('/auth/login', { data: { email: ADMIN_EMAIL, password: PW } });
    expect(login.status()).toBe(200);
  } else {
    expect(reg.status()).toBe(201);
  }

  const me = await admin.get('/me');
  expect((await me.json()).isInstanceAdmin).toBe(true);

  // Defaults: all form modes disabled.
  const initial = await admin.get('/admin/settings');
  expect(initial.status()).toBe(200);
  expect((await initial.json()).settings.formModes.globalSmtp).toBe(false);

  // Write SMTP + hCaptcha + a form mode, with secrets.
  const put = await admin.put('/admin/settings', {
    data: {
      formModes: { globalSmtp: true, contactPhp: true },
      smtp: { host: 'smtp.acme.example', port: 587, secure: false, user: 'mailer', fromEmail: 'no-reply@acme.example', password: 'top-secret-pw' },
      hcaptcha: { siteKey: 'site-abc', secret: 'hc-secret-xyz' },
    },
  });
  expect(put.status()).toBe(200);
  const putBody = await put.text();
  // Secrets must NEVER be echoed back.
  expect(putBody).not.toContain('top-secret-pw');
  expect(putBody).not.toContain('hc-secret-xyz');
  const settings = JSON.parse(putBody).settings;
  expect(settings.smtp.hasPassword).toBe(true);
  expect(settings.hcaptcha.hasSecret).toBe(true);
  expect(settings.formModes.globalSmtp).toBe(true);
  expect(settings.formModes.contactPhp).toBe(true);

  // Re-read confirms persistence; password retained when omitted on edit.
  const edit = await admin.put('/admin/settings', {
    data: { smtp: { host: 'smtp.new.example', port: 465, secure: true, fromEmail: 'no-reply@acme.example' } },
  });
  const edited = JSON.parse(await edit.text()).settings;
  expect(edited.smtp.host).toBe('smtp.new.example');
  expect(edited.smtp.hasPassword).toBe(true);

  await admin.dispose();
});
