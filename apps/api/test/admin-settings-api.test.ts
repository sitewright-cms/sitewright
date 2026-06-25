import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import type { Database } from '../src/db/client.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

const ENC_KEY = randomBytes(32).toString('base64');
// The test DB for the current `beforeEach` app — needed to seed users (the registration route is
// invite-only now, so accounts are created via the repo and then logged in for a session cookie).
let db: Database;

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

/** Seed a plain client account (no platform role) and log in for a session cookie. */
async function register(app: FastifyInstance, email: string) {
  await registerAccount(db, email, 'Pw-secret-1');
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } });
  return { t: token(login) };
}

/** Seed an instance admin (`platform_role='admin'`) and log in for a session cookie. */
async function registerAdmin(app: FastifyInstance, email = 'admin@acme.test') {
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'admin' });
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } });
  return { t: token(login) };
}

describe('admin settings API', () => {
  describe('with an admin allowlist + encryption key', () => {
    let app: FastifyInstance;
    beforeEach(async () => {
      db = await makeTestDb();
      app = await createApp({
        db,
        encryptionKey: Buffer.from(ENC_KEY, 'base64'),
      });
      await app.ready();
    });

    it('marks the admin in /me and a normal user as not-admin', async () => {
      const admin = await registerAdmin(app);
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
      const admin = await registerAdmin(app);
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
      const admin = await registerAdmin(app);
      const put = await app.inject({
        method: 'PUT',
        url: '/admin/settings',
        cookies: { sw_session: admin.t },
        payload: { smtp: { host: 'h', port: 99999, fromEmail: 'not-an-email' } },
      });
      expect(put.statusCode).toBe(400);
    });

    it('applies the admin "default locale for new projects" to a newly created project', async () => {
      const admin = await registerAdmin(app);
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
      db = await makeTestDb();
      app = await createApp({ db });
      await app.ready();
    });

    it('allows non-secret settings but returns 503 when a secret is supplied', async () => {
      const admin = await registerAdmin(app);
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

  describe('branding (/auth/config + /branding/logo)', () => {
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    let app: FastifyInstance;
    beforeEach(async () => {
      db = await makeTestDb();
      app = await createApp({
        db,
        encryptionKey: Buffer.from(ENC_KEY, 'base64'),
      });
      await app.ready();
    });

    it('serves default branding (and no logo) from the unauthenticated /auth/config before anything is set', async () => {
      const res = await app.inject({ method: 'GET', url: '/auth/config' }); // no session cookie
      expect(res.statusCode).toBe(200);
      const cfg = res.json() as { branding: { name: string; primary: string; secondary: string; logoUrl: string | null } };
      expect(cfg.branding).toEqual({ name: 'SiteWright', primary: '#4f46e5', secondary: '#0ea5e9', logoUrl: null });
      // No logo yet → 404 (also unauthenticated).
      expect((await app.inject({ method: 'GET', url: '/branding/logo' })).statusCode).toBe(404);
    });

    it('reflects an admin branding update in /auth/config and serves the logo bytes', async () => {
      const admin = await registerAdmin(app);
      const put = await app.inject({
        method: 'PUT',
        url: '/admin/settings',
        cookies: { sw_session: admin.t },
        payload: { platformName: 'Acme CMS', brandPrimary: '#ff0066', brandSecondary: '#00ddaa', platformLogo: { mime: 'image/png', data: PNG } },
      });
      expect(put.statusCode).toBe(200);
      expect((put.json() as { settings: { hasLogo: boolean } }).settings.hasLogo).toBe(true);
      expect(put.body).not.toContain(PNG); // bytes never in the masked admin response

      const cfg = (await app.inject({ method: 'GET', url: '/auth/config' })).json() as {
        branding: { name: string; primary: string; secondary: string; logoUrl: string | null };
      };
      expect(cfg.branding.name).toBe('Acme CMS');
      expect(cfg.branding.primary).toBe('#ff0066');
      expect(cfg.branding.logoUrl).toMatch(/^\/branding\/logo\?v=\d+$/);

      const logo = await app.inject({ method: 'GET', url: '/branding/logo' }); // unauthenticated
      expect(logo.statusCode).toBe(200);
      expect(logo.headers['content-type']).toContain('image/png');
      expect(logo.headers['cache-control']).toContain('no-store');
      expect(logo.headers['x-content-type-options']).toBe('nosniff'); // global onSend hook
      expect(logo.rawPayload.equals(Buffer.from(PNG, 'base64'))).toBe(true);
    });
  });

  describe('with no admin allowlist configured', () => {
    let app: FastifyInstance;
    beforeEach(async () => {
      db = await makeTestDb();
      app = await createApp({ db });
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
