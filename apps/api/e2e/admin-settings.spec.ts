import { test, expect } from '@playwright/test';
import { seedUser, adminContext } from './helpers.js';

// The deployed instance is started with SW_ADMIN_EMAILS=admin@e2e.test and a
// SW_ENCRYPTION_KEY. This exercises the instance-admin settings flow over HTTP:
// a normal user is denied; the configured admin can read/write settings; secrets
// are stored but never returned.


test('instance admin settings: gating, persistence, and secret masking', async ({ playwright, baseURL }) => {
    const stamp = Date.now();
  const api = await seedUser(playwright, baseURL, `user-${stamp}@e2e.test`);
  const userMe = await api.get('/me');
  expect((await userMe.json()).isInstanceAdmin).toBe(false);
  expect((await api.get('/admin/settings')).status()).toBe(403);
  await api.dispose();

  // --- The configured admin can manage settings. The admin is SEEDED at first boot (never
  // registered), so this just logs in — idempotent across repeated runs. ---
  const admin = await adminContext(playwright, baseURL);

  const me = await admin.get('/me');
  expect((await me.json()).isInstanceAdmin).toBe(true);

  // Form modes start disabled. This spec WRITES them further down, so a re-run against the same
  // deployment would otherwise fail on its own leftovers — reset first, then assert the read-back.
  // That still proves the gate (a non-admin was refused above) and that writes persist.
  expect((await admin.put('/admin/settings', { data: { formModes: { globalSmtp: false } } })).status()).toBe(200);
  const initial = await admin.get('/admin/settings');
  expect(initial.status()).toBe(200);
  expect((await initial.json()).settings.formModes.globalSmtp).toBe(false);

  // Write SMTP + a form mode, with secrets. (Captcha is per PROJECT now — see captcha.spec.ts.)
  const put = await admin.put('/admin/settings', {
    data: {
      formModes: { globalSmtp: true, contactPhp: true },
      smtp: { host: 'smtp.acme.example', port: 587, secure: false, user: 'mailer', fromEmail: 'no-reply@acme.example', password: 'top-secret-pw' },
    },
  });
  expect(put.status()).toBe(200);
  const putBody = await put.text();
  // Secrets must NEVER be echoed back.
  expect(putBody).not.toContain('top-secret-pw');
  const settings = JSON.parse(putBody).settings;
  expect(settings.smtp.hasPassword).toBe(true);
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
