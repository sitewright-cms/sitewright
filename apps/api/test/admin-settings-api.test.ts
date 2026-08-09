import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_FORM_MODES } from '@sitewright/schema';

/**
 * hCaptcha's own publicly documented TEST site key, used here because a site key is now validated for
 * the UUID shape a real one has. The placeholders this file used before ('site-123', 'site-1') are the
 * exact class of value that reached a published site as data-sitekey="123" and greeted every visitor
 * with hCaptcha's "the sitekey is incorrect" — a fixture that cannot be a real key is not a fixture
 * worth keeping.
 */
const HCAPTCHA_TEST_SITEKEY = '10000000-ffff-ffff-ffff-000000000001';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createDb, runMigrations, type Database } from '../src/db/client.js';
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
      expect((initial.json() as { settings: { formModes: Record<string, boolean> } }).settings.formModes).toEqual(DEFAULT_FORM_MODES);

      const put = await app.inject({
        method: 'PUT',
        url: '/admin/settings',
        cookies,
        payload: {
          formModes: { globalSmtp: true, contactPhp: true },
          smtp: { host: 'smtp.acme.com', port: 587, secure: false, user: 'mailer', fromEmail: 'no-reply@acme.com', password: 'hunter2' },
          hcaptcha: { siteKey: HCAPTCHA_TEST_SITEKEY, secret: 'hc-secret' },
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

    it('round-trips the HSTS policy (schema defaults applied; null clears)', async () => {
      const admin = await registerAdmin(app);
      const cookies = { sw_session: admin.t };

      // Default read: no HSTS section.
      const initial = await app.inject({ method: 'GET', url: '/admin/settings', cookies });
      expect((initial.json() as { settings: { hsts?: unknown } }).settings.hsts).toBeUndefined();

      // A partial input is completed by the schema defaults (only `enabled`+`includeSubDomains` sent).
      const put = await app.inject({
        method: 'PUT',
        url: '/admin/settings',
        cookies,
        payload: { hsts: { enabled: true, includeSubDomains: true } },
      });
      expect(put.statusCode).toBe(200);
      const hsts = (
        put.json() as {
          settings: {
            hsts?: {
              enabled: boolean;
              maxAgeSeconds: number;
              includeSubDomains: boolean;
              preload: boolean;
              applyToServedSites: boolean;
            };
          };
        }
      ).settings.hsts;
      expect(hsts).toEqual({
        enabled: true,
        maxAgeSeconds: 31_536_000,
        includeSubDomains: true,
        preload: false,
        applyToServedSites: false,
      });

      // Clearing it (null) removes the section entirely.
      const cleared = await app.inject({ method: 'PUT', url: '/admin/settings', cookies, payload: { hsts: null } });
      expect((cleared.json() as { settings: { hsts?: unknown } }).settings.hsts).toBeUndefined();
    });

    it('round-trips logLevel + backupRetention', async () => {
      const admin = await registerAdmin(app);
      const cookies = { sw_session: admin.t };
      const put = await app.inject({
        method: 'PUT',
        url: '/admin/settings',
        cookies,
        payload: { logLevel: 'warn', backupRetention: 5 },
      });
      expect(put.statusCode).toBe(200);
      const s = (put.json() as { settings: { logLevel?: string; backupRetention?: number } }).settings;
      expect(s.logLevel).toBe('warn');
      expect(s.backupRetention).toBe(5);
    });

    it('round-trips the platform WebGL background + serves it publicly on /auth/config; null clears it', async () => {
      const admin = await registerAdmin(app);
      const cookies = { sw_session: admin.t };
      const bg = { preset: 'mesh-gradient', angle: 135, colors: ['primary', 'auto', '#123456'] };

      const put = await app.inject({ method: 'PUT', url: '/admin/settings', cookies, payload: { platformBackground: bg } });
      expect(put.statusCode).toBe(200);
      expect((put.json() as { settings: { platformBackground?: unknown } }).settings.platformBackground).toEqual(bg);

      // Served pre-auth (no session) so the login screen can render it.
      const pub = await app.inject({ method: 'GET', url: '/auth/config' });
      expect(pub.statusCode).toBe(200);
      expect((pub.json() as { platformBackground: unknown }).platformBackground).toEqual(bg);

      // Clearing it (null) removes it; /auth/config then reports null.
      const cleared = await app.inject({ method: 'PUT', url: '/admin/settings', cookies, payload: { platformBackground: null } });
      expect((cleared.json() as { settings: { platformBackground?: unknown } }).settings.platformBackground).toBeUndefined();
      const pub2 = await app.inject({ method: 'GET', url: '/auth/config' });
      expect((pub2.json() as { platformBackground: unknown }).platformBackground).toBeNull();
    });

    it('rejects a platform background with an injection-shaped color slot (400)', async () => {
      const admin = await registerAdmin(app);
      const put = await app.inject({
        method: 'PUT',
        url: '/admin/settings',
        cookies: { sw_session: admin.t },
        // a slot containing a quote/space/angle-bracket must fail the strict hex-or-token pattern
        payload: { platformBackground: { preset: 'mesh-gradient', angle: 0, colors: ['primary', 'secondary', '"><script>'] } },
      });
      expect(put.statusCode).toBe(400);
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
        payload: { formModes: { thirdParty: true }, hcaptcha: { siteKey: HCAPTCHA_TEST_SITEKEY } },
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

    it('refuses a site key that cannot possibly be one, at the boundary a human can still act on', async () => {
      // The instance that shipped `data-sitekey="123"` to visitors is why this is checked on the way
      // IN. Rejecting it on the way OUT would not have helped: stored settings are read with a
      // throwing parse on every read, so a strict stored schema turns one bad key into an unreadable
      // instance rather than a fixed one.
      const admin = await registerAdmin(app);
      const res = await app.inject({
        method: 'PUT',
        url: '/admin/settings',
        cookies: { sw_session: admin.t },
        payload: { hcaptcha: { siteKey: '123' } },
      });
      expect(res.statusCode).toBe(400);
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

  describe('storage + backups purge routes', () => {
    it('reports DB + snapshot sizes and purges snapshots (admin-only)', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'sw-storage-'));
      const dbFile = join(dir, 'sitewright.db');
      const handle = await createDb(`file:${dbFile}`);
      await runMigrations(handle.db);
      db = handle.db; // registerAdmin() seeds via the module `db`
      const app = await createApp({
        db,
        dataDir: dir,
        databaseUrl: `file:${dbFile}`,
        encryptionKey: Buffer.from(ENC_KEY, 'base64'),
      });
      await app.ready();
      const admin = await registerAdmin(app);
      const cookies = { sw_session: admin.t };
      try {
        // No snapshots yet — the DB has a size; backups are empty.
        const s0 = await app.inject({ method: 'GET', url: '/admin/storage', cookies });
        expect(s0.statusCode).toBe(200);
        const j0 = s0.json() as { dbBytes: number; backups: { count: number; bytes: number } };
        expect(j0.dbBytes).toBeGreaterThan(0);
        expect(j0.backups).toEqual({ count: 0, bytes: 0 });

        // Drop in three fake snapshots (3 bytes each).
        await mkdir(join(dir, 'backups'), { recursive: true });
        for (const stamp of ['20260101T000000Z', '20260201T000000Z', '20260301T000000Z']) {
          await writeFile(join(dir, 'backups', `sitewright-${stamp}-aaa.pre-migration.bak`), 'xyz');
        }
        const s1 = (await app.inject({ method: 'GET', url: '/admin/storage', cookies })).json() as typeof j0;
        expect(s1.backups).toEqual({ count: 3, bytes: 9 });

        // Purge, keeping the newest 1.
        const purge = await app.inject({ method: 'POST', url: '/admin/backups/purge', cookies, payload: { keepLast: 1 } });
        expect(purge.statusCode).toBe(200);
        expect(purge.json()).toMatchObject({ removed: 2, count: 1 });

        // Anonymous is refused.
        const anon = await app.inject({ method: 'GET', url: '/admin/storage' });
        expect([401, 403]).toContain(anon.statusCode);
      } finally {
        await app.close();
        handle.client.close();
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('live log level', () => {
    it('applies a set level live and reverts to the ENV fallback (not the stale boot value) on clear', async () => {
      db = await makeTestDb();
      // Simulate a restart where a prior admin had stored 'trace': opts.logLevel is the boot-effective value,
      // envLogLevel is the RAW env ('debug' here). Clearing must revert to envLogLevel, never the boot 'trace'.
      const app = await createApp({ db, logger: true, logLevel: 'trace', envLogLevel: 'debug' });
      await app.ready();
      expect(app.log.level).toBe('trace'); // initial = boot-effective
      const admin = await registerAdmin(app);
      const cookies = { sw_session: admin.t };
      try {
        await app.inject({ method: 'PUT', url: '/admin/settings', cookies, payload: { logLevel: 'warn' } });
        expect(app.log.level).toBe('warn'); // explicit set applies live
        await app.inject({ method: 'PUT', url: '/admin/settings', cookies, payload: { logLevel: null } });
        expect(app.log.level).toBe('debug'); // reverts to the env fallback, NOT the stale boot 'trace'
      } finally {
        await app.close();
      }
    });
  });
});

describe('instance SMTP connection test', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeEach(async () => {
    db = await makeTestDb();
    app = await createApp({ db, encryptionKey: Buffer.from(ENC_KEY, 'base64') });
    await app.ready();
    adminToken = (await registerAdmin(app)).t;
  });

  it('404s until an SMTP is configured, then reports a usable/unusable verdict', async () => {
    // Form delivery is best-effort, so a broken instance SMTP is otherwise invisible to the admin:
    // the visitor is thanked either way and only a server log records the failure.
    const none = await app.inject({ method: 'POST', url: '/admin/settings/smtp/test', cookies: { sw_session: adminToken } });
    expect(none.statusCode).toBe(404);

    // Port 1 with nothing on it: what matters is the SHAPE of the answer — a readable reason, not a
    // 500 and not a silent success.
    await app.inject({
      method: 'PUT', url: '/admin/settings', cookies: { sw_session: adminToken },
      payload: { smtp: { host: '127.0.0.1', port: 1, secure: false, fromEmail: 'a@b.co' } },
    });
    const res = await app.inject({ method: 'POST', url: '/admin/settings/smtp/test', cookies: { sw_session: adminToken } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
  }, 30_000);

  it('is admin-only', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/settings/smtp/test' });
    expect(res.statusCode).toBe(401);
  });

  it('send-test 404s until an SMTP is configured', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/settings/smtp/send-test', cookies: { sw_session: adminToken }, payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('send-test defaults to the admin’s own address, and honours one they type', async () => {
    await app.inject({
      method: 'PUT', url: '/admin/settings', cookies: { sw_session: adminToken },
      payload: { smtp: { host: '127.0.0.1', port: 1, secure: false, fromEmail: 'a@b.co', fromName: 'Acme' } },
    });
    // Port 1 refuses, so delivery fails — but the RECIPIENT decision happens first and is what
    // matters here: an admin is agency staff, so both forms are allowed.
    const own = await app.inject({ method: 'POST', url: '/admin/settings/smtp/send-test', cookies: { sw_session: adminToken }, payload: {} });
    expect(own.statusCode).toBe(200);
    expect((own.json() as { to: string }).to).toBe('admin@acme.test');

    const typed = await app.inject({
      method: 'POST', url: '/admin/settings/smtp/send-test', cookies: { sw_session: adminToken }, payload: { to: 'deliverability@acme.test' },
    });
    expect((typed.json() as { to: string; ok: boolean }).to).toBe('deliverability@acme.test');
    expect((typed.json() as { ok: boolean }).ok).toBe(false); // nothing is listening on port 1
  }, 30_000);

  it('send-test rejects a malformed recipient before attempting any mail', async () => {
    await app.inject({
      method: 'PUT', url: '/admin/settings', cookies: { sw_session: adminToken },
      payload: { smtp: { host: '127.0.0.1', port: 1, secure: false, fromEmail: 'a@b.co' } },
    });
    const res = await app.inject({ method: 'POST', url: '/admin/settings/smtp/send-test', cookies: { sw_session: adminToken }, payload: { to: 'nope' } });
    expect(res.statusCode).toBe(400);
  });

  it('send-test is admin-only', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/settings/smtp/send-test', payload: {} });
    expect(res.statusCode).toBe(401);
  });
});

describe('instance SMTP honours SW_SMTP_ALLOWED_HOSTS', () => {
  it('★ refuses to connect to or mail a host outside the SMTP allowlist', async () => {
    // The guard is named for SMTP and an operator setting SW_SMTP_ALLOWED_HOSTS expects it to bound
    // the instance surface too. Both instance routes previously consulted the DEPLOY allowlist, so
    // this setting was a no-op there while reading like enforcement.
    const adb = await makeTestDb();
    db = adb;
    const app2 = await createApp({ db: adb, encryptionKey: Buffer.from(ENC_KEY, 'base64'), smtpAllowedHosts: ['mail.allowed.com'] });
    await app2.ready();
    const admin = (await registerAdmin(app2)).t;
    // Saved directly: the save path is admin-trusted and deliberately unguarded (see the note in
    // the route), so this succeeds and the check has to happen where we actually connect.
    expect((await app2.inject({
      method: 'PUT', url: '/admin/settings', cookies: { sw_session: admin },
      payload: { smtp: { host: 'evil.example', port: 25, secure: false, fromEmail: 'a@b.co' } },
    })).statusCode).toBe(200);

    expect((await app2.inject({ method: 'POST', url: '/admin/settings/smtp/test', cookies: { sw_session: admin } })).statusCode).toBe(403);
    expect((await app2.inject({ method: 'POST', url: '/admin/settings/smtp/send-test', cookies: { sw_session: admin }, payload: {} })).statusCode).toBe(403);
  }, 30_000);
});

describe('instance-wide undelivered count', () => {
  it('★ reports the backlog across ALL projects to an admin, and is admin-only', async () => {
    // A broken GLOBAL SMTP breaks every project at once; the admin looking at mail settings is the
    // one who can fix it, so the number has to be reachable from there.
    const adb = await makeTestDb();
    db = adb;
    const app2 = await createApp({ db: adb, encryptionKey: Buffer.from(ENC_KEY, 'base64') });
    await app2.ready();
    const admin = (await registerAdmin(app2)).t;

    const empty = await app2.inject({ method: 'GET', url: '/admin/submissions/undelivered', cookies: { sw_session: admin } });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ count: 0, lastError: null });

    expect((await app2.inject({ method: 'GET', url: '/admin/submissions/undelivered' })).statusCode).toBe(401);
  }, 30_000);
});

