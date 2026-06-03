import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { projectMembers } from '../src/db/schema.js';
import type { Database } from '../src/db/client.js';

const ENC_KEY = randomBytes(32);

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const v = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!v) throw new Error('no session cookie');
  return v;
}

let app: FastifyInstance;
let db: Database;
let t: string;
let orgId: string;
let projectId: string;
let base: string;

beforeEach(async () => {
  db = await makeTestDb();
  app = await createApp({ db, encryptionKey: ENC_KEY });
  await app.ready();
  const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'owner@acme.test', password: 'pw-secret-1', orgName: 'Acme' } });
  t = token(reg);
  orgId = (reg.json() as { orgId: string }).orgId;
  const proj = await app.inject({ method: 'POST', url: `/orgs/${orgId}/projects`, cookies: { sw_session: t }, payload: { name: 'Site', slug: 'site' } });
  projectId = (proj.json() as { project: { id: string } }).project.id;
  base = `/orgs/${orgId}/projects/${projectId}`;
});

describe('per-project SMTP API', () => {
  it('requires auth (401) and returns null when unset', async () => {
    expect((await app.inject({ method: 'GET', url: `${base}/smtp` })).statusCode).toBe(401);
    const get = await app.inject({ method: 'GET', url: `${base}/smtp`, cookies: { sw_session: t } });
    expect(get.statusCode).toBe(200);
    expect((get.json() as { smtp: unknown }).smtp).toBeNull();
  });

  it('stores SMTP (encrypted), masks the password, and retains it on edit', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `${base}/smtp`,
      cookies: { sw_session: t },
      payload: { host: 'smtp.acme.com', port: 587, secure: false, user: 'mailer', password: 'hunter2', fromEmail: 'no-reply@acme.com', fromName: 'Acme' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.body).not.toContain('hunter2');
    const body = put.json() as { smtp: { hasPassword: boolean; host: string } };
    expect(body.smtp).toMatchObject({ host: 'smtp.acme.com', hasPassword: true });

    // Edit host without a password → password retained.
    const edit = await app.inject({
      method: 'PUT',
      url: `${base}/smtp`,
      cookies: { sw_session: t },
      payload: { host: 'smtp.new.com', port: 465, secure: true, fromEmail: 'no-reply@acme.com' },
    });
    const edited = edit.json() as { smtp: { host: string; hasPassword: boolean } };
    expect(edited.smtp.host).toBe('smtp.new.com');
    expect(edited.smtp.hasPassword).toBe(true);
  });

  it('deletes the config', async () => {
    await app.inject({ method: 'PUT', url: `${base}/smtp`, cookies: { sw_session: t }, payload: { host: 'h', port: 25, secure: false, fromEmail: 'a@b.co' } });
    expect((await app.inject({ method: 'DELETE', url: `${base}/smtp`, cookies: { sw_session: t } })).statusCode).toBe(204);
    expect((await (await app.inject({ method: 'GET', url: `${base}/smtp`, cookies: { sw_session: t } })).json() as { smtp: unknown }).smtp).toBeNull();
  });

  it('lets a project member read and write SMTP (constrained client-write removed)', async () => {
    const memberReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'member@x.test', password: 'pw-secret-1', orgName: 'Member' } });
    const mt = token(memberReg);
    const mUser = (memberReg.json() as { userId: string }).userId;
    await db.insert(projectMembers).values({ id: randomUUID(), userId: mUser, projectId, role: 'member', createdAt: new Date() });
    // Any project member may now manage SMTP — the old owner/admin-only gate is gone.
    expect((await app.inject({ method: 'GET', url: `${base}/smtp`, cookies: { sw_session: mt } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: `${base}/smtp`, cookies: { sw_session: mt }, payload: { host: 'h', port: 25, secure: false, fromEmail: 'a@b.co' } })).statusCode).toBe(200);
  });

  it('rejects an invalid SMTP body (400)', async () => {
    const res = await app.inject({ method: 'PUT', url: `${base}/smtp`, cookies: { sw_session: t }, payload: { host: 'h', port: 99999, fromEmail: 'not-an-email' } });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE is idempotent (204) when no config exists', async () => {
    const res = await app.inject({ method: 'DELETE', url: `${base}/smtp`, cookies: { sw_session: t } });
    expect(res.statusCode).toBe(204);
  });
});

describe('per-project SMTP API with a host allowlist', () => {
  it('rejects a host not on the SW_SMTP_ALLOWED_HOSTS allowlist (403)', async () => {
    const adb = await makeTestDb();
    const app2 = await createApp({ db: adb, encryptionKey: ENC_KEY, smtpAllowedHosts: ['mail.allowed.com'] });
    await app2.ready();
    const reg = await app2.inject({ method: 'POST', url: '/auth/register', payload: { email: 'o@a.test', password: 'pw-secret-1', orgName: 'A' } });
    const tok = token(reg);
    const oid = (reg.json() as { orgId: string }).orgId;
    const proj = await app2.inject({ method: 'POST', url: `/orgs/${oid}/projects`, cookies: { sw_session: tok }, payload: { name: 'S', slug: 's' } });
    const pid = (proj.json() as { project: { id: string } }).project.id;
    const b = `/orgs/${oid}/projects/${pid}`;
    const blocked = await app2.inject({ method: 'PUT', url: `${b}/smtp`, cookies: { sw_session: tok }, payload: { host: 'evil.example', port: 587, secure: false, fromEmail: 'a@b.co' } });
    expect(blocked.statusCode).toBe(403);
    const allowed = await app2.inject({ method: 'PUT', url: `${b}/smtp`, cookies: { sw_session: tok }, payload: { host: 'mail.allowed.com', port: 587, secure: false, fromEmail: 'a@b.co' } });
    expect(allowed.statusCode).toBe(200);
  });
});
