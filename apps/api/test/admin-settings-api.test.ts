import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

const ENC_KEY = randomBytes(32).toString('base64');

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

async function register(app: FastifyInstance, email: string) {
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'pw-secret-1'},
  });
  return { t: token(reg) };
}

describe('admin settings API', () => {
  describe('with an admin allowlist + encryption key', () => {
    let app: FastifyInstance;
    beforeEach(async () => {
      app = await createApp({
        db: await makeTestDb(),
        adminEmails: ['admin@acme.test'],
        encryptionKey: Buffer.from(ENC_KEY, 'base64'),
      });
      await app.ready();
    });

    it('marks the admin in /me and a normal user as not-admin', async () => {
      const admin = await register(app, 'admin@acme.test');
      const user = await register(app, 'user@acme.test');
      const meAdmin = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: admin.t } });
      expect((meAdmin.json() as { isInstanceAdmin: boolean }).isInstanceAdmin).toBe(true);
      const meUser = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: user.t } });
      expect((meUser.json() as { isInstanceAdmin: boolean }).isInstanceAdmin).toBe(false);
    });

    it('forbids a non-admin from reading or writing settings (403)', async () => {
      const user = await register(app, 'user@acme.test');
      const get = await app.inject({ method: 'GET', url: '/admin/settings', cookies: { sw_session: user.t } });
      expect(get.statusCode).toBe(403);
      const put = await app.inject({
        method: 'PUT',
        url: '/admin/settings',
        cookies: { sw_session: user.t },
        payload: { formModes: { globalSmtp: true } },
      });
      expect(put.statusCode).toBe(403);
    });

    it('requires authentication (401) when no session is present', async () => {
      const get = await app.inject({ method: 'GET', url: '/admin/settings' });
      expect(get.statusCode).toBe(401);
    });

    it('lets the admin read defaults, write settings, and never leaks the password', async () => {
      const admin = await register(app, 'admin@acme.test');
      const cookies = { sw_session: admin.t };

      const initial = await app.inject({ method: 'GET', url: '/admin/settings', cookies });
      expect(initial.statusCode).toBe(200);
      expect((initial.json() as { settings: { formModes: Record<string, boolean> } }).settings.formModes).toEqual({
        globalSmtp: false,
        userSmtp: false,
        contactPhp: false,
        thirdParty: false,
      });

      const put = await app.inject({
        method: 'PUT',
        url: '/admin/settings',
        cookies,
        payload: {
          formModes: { globalSmtp: true, contactPhp: true },
          smtp: { host: 'smtp.acme.com', port: 587, secure: false, user: 'mailer', fromEmail: 'no-reply@acme.com', password: 'hunter2' },
          hcaptcha: { siteKey: 'site-123', secret: 'hc-secret' },
        },
      });
      expect(put.statusCode).toBe(200);
      const body = put.json() as { settings: { smtp: { hasPassword: boolean }; hcaptcha: { hasSecret: boolean } } };
      expect(body.settings.smtp.hasPassword).toBe(true);
      expect(body.settings.hcaptcha.hasSecret).toBe(true);
      // No secret material in the response body.
      expect(put.body).not.toContain('hunter2');
      expect(put.body).not.toContain('hc-secret');

      // Re-read persists; password retained when omitted on a later edit.
      const edit = await app.inject({
        method: 'PUT',
        url: '/admin/settings',
        cookies,
        payload: { smtp: { host: 'smtp.new.com', port: 465, secure: true, fromEmail: 'no-reply@acme.com' } },
      });
      const edited = edit.json() as { settings: { smtp: { host: string; hasPassword: boolean } } };
      expect(edited.settings.smtp.host).toBe('smtp.new.com');
      expect(edited.settings.smtp.hasPassword).toBe(true);
    });

    it('rejects an invalid settings body (400)', async () => {
      const admin = await register(app, 'admin@acme.test');
      const put = await app.inject({
        method: 'PUT',
        url: '/admin/settings',
        cookies: { sw_session: admin.t },
        payload: { smtp: { host: 'h', port: 99999, fromEmail: 'not-an-email' } },
      });
      expect(put.statusCode).toBe(400);
    });

    it('applies the admin "default locale for new projects" to a newly created project', async () => {
      const admin = await register(app, 'admin@acme.test');
      const cookies = { sw_session: admin.t };
      const put = await app.inject({ method: 'PUT', url: '/admin/settings', cookies, payload: { defaultLocale: 'de' } });
      expect(put.statusCode).toBe(200);
      expect((put.json() as { settings: { defaultLocale?: string } }).settings.defaultLocale).toBe('de');

      const proj = await app.inject({ method: 'POST', url: '/projects', cookies, payload: { name: 'Neu', slug: 'neu' } });
      const projectId = (proj.json() as { project: { id: string } }).project.id;
      const settings = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/content/settings/settings`,
        cookies,
      });
      const bundle = settings.json() as { item: { settings: { defaultLocale: string; locales: string[] } } };
      expect(bundle.item.settings.defaultLocale).toBe('de');
      expect(bundle.item.settings.locales).toEqual(['de']);

      // Clearing it (null) reverts new projects to English.
      await app.inject({ method: 'PUT', url: '/admin/settings', cookies, payload: { defaultLocale: null } });
      const proj2 = await app.inject({ method: 'POST', url: '/projects', cookies, payload: { name: 'Two', slug: 'two' } });
      const id2 = (proj2.json() as { project: { id: string } }).project.id;
      const s2 = await app.inject({ method: 'GET', url: `/projects/${id2}/content/settings/settings`, cookies });
      expect((s2.json() as { item: { settings: { defaultLocale: string } } }).item.settings.defaultLocale).toBe('en');
    });

    it('forbids the bearer (API-key) path entirely on admin routes', async () => {
      // A made-up bearer must be rejected as session-only (403), not 401: the route
      // refuses the bearer path before any key lookup, so no admin account is needed.
      const get = await app.inject({
        method: 'GET',
        url: '/admin/settings',
        headers: { authorization: 'Bearer swk_whatever' },
      });
      expect(get.statusCode).toBe(403);
    });
  });

  describe('without an encryption key', () => {
    let app: FastifyInstance;
    beforeEach(async () => {
      app = await createApp({ db: await makeTestDb(), adminEmails: ['admin@acme.test'] });
      await app.ready();
    });

    it('allows non-secret settings but returns 503 when a secret is supplied', async () => {
      const admin = await register(app, 'admin@acme.test');
      const cookies = { sw_session: admin.t };
      const ok = await app.inject({
        method: 'PUT',
        url: '/admin/settings',
        cookies,
        payload: { formModes: { thirdParty: true }, hcaptcha: { siteKey: 'site-1' } },
      });
      expect(ok.statusCode).toBe(200);
      const blocked = await app.inject({
        method: 'PUT',
        url: '/admin/settings',
        cookies,
        payload: { smtp: { host: 'h', port: 25, secure: false, fromEmail: 'a@b.co', password: 'pw' } },
      });
      expect(blocked.statusCode).toBe(503);
    });
  });

  describe('with no admin allowlist configured', () => {
    let app: FastifyInstance;
    beforeEach(async () => {
      app = await createApp({ db: await makeTestDb() });
      await app.ready();
    });

    it('treats everyone as non-admin (no one can reach settings)', async () => {
      const user = await register(app, 'user@acme.test');
      const me = await app.inject({ method: 'GET', url: '/me', cookies: { sw_session: user.t } });
      expect((me.json() as { isInstanceAdmin: boolean }).isInstanceAdmin).toBe(false);
      const get = await app.inject({ method: 'GET', url: '/admin/settings', cookies: { sw_session: user.t } });
      expect(get.statusCode).toBe(403);
    });
  });
});
