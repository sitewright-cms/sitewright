import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import type { HcaptchaVerifier } from '../src/mail/hcaptcha.js';

const ENC_KEY = randomBytes(32);

class FakeHcaptcha implements HcaptchaVerifier {
  result = true;
  calls: Array<{ secret: string; token: string | undefined; remoteip?: string }> = [];
  async verify(secret: string, token: string | undefined, remoteip?: string): Promise<boolean> {
    this.calls.push({ secret, token, remoteip });
    return this.result;
  }
}

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const v = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!v) throw new Error('no session cookie');
  return v;
}

let app: FastifyInstance;
let hcaptcha: FakeHcaptcha;
let t: string;
let orgId: string;
let projectId: string;

async function setup(opts: { configureSecret: boolean }) {
  hcaptcha = new FakeHcaptcha();
  app = await createApp({ db: await makeTestDb(), hcaptcha, encryptionKey: ENC_KEY, adminEmails: ['admin@acme.test'] });
  await app.ready();
  const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'admin@acme.test', password: 'pw-secret-1', orgName: 'Acme' } });
  t = token(reg);
  orgId = (reg.json() as { orgId: string }).orgId;
  const proj = await app.inject({ method: 'POST', url: `/orgs/${orgId}/projects`, cookies: { sw_session: t }, payload: { name: 'Site', slug: 'site' } });
  projectId = (proj.json() as { project: { id: string } }).project.id;
  // A form that requires hCaptcha.
  await app.inject({
    method: 'PUT',
    url: `/orgs/${orgId}/projects/${projectId}/content/form/contact`,
    cookies: { sw_session: t },
    payload: { id: 'contact', name: 'Contact', fields: [{ name: 'email', label: 'Email', type: 'email' }], recipient: 'a@b.co', hcaptcha: true },
  });
  if (opts.configureSecret) {
    await app.inject({
      method: 'PUT',
      url: '/admin/settings',
      cookies: { sw_session: t },
      payload: { hcaptcha: { siteKey: 'site-key', secret: 'hc-secret' } },
    });
  }
}

describe('form submission hCaptcha enforcement', () => {
  it('rejects (400) when verification fails, and does not store', async () => {
    await setup({ configureSecret: true });
    hcaptcha.result = false;
    const res = await app.inject({ method: 'POST', url: `/f/${projectId}/contact`, payload: { email: 'x@y.co', 'h-captcha-response': 'bad', _elapsed: '5000' } });
    expect(res.statusCode).toBe(400);
    expect(hcaptcha.calls[0]).toMatchObject({ secret: 'hc-secret', token: 'bad' });
    const list = await app.inject({ method: 'GET', url: `/orgs/${orgId}/projects/${projectId}/submissions`, cookies: { sw_session: t } });
    expect((list.json() as { total: number }).total).toBe(0);
  });

  it('accepts when verification passes and never stores the captcha token', async () => {
    await setup({ configureSecret: true });
    hcaptcha.result = true;
    const res = await app.inject({ method: 'POST', url: `/f/${projectId}/contact`, payload: { email: 'x@y.co', 'h-captcha-response': 'good-token', _elapsed: '5000' } });
    expect(res.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: `/orgs/${orgId}/projects/${projectId}/submissions`, cookies: { sw_session: t } });
    const body = list.json() as { items: Array<{ fields: Record<string, string> }>; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0]!.fields).toEqual({ email: 'x@y.co' }); // token + trap fields stripped
    expect(body.items[0]!.fields).not.toHaveProperty('h-captcha-response');
  });

  it('rejects (503, fail-closed) when the form requires hCaptcha but no instance secret is configured', async () => {
    await setup({ configureSecret: false });
    const res = await app.inject({ method: 'POST', url: `/f/${projectId}/contact`, payload: { email: 'x@y.co', _elapsed: '5000' } });
    expect(res.statusCode).toBe(503);
    expect(hcaptcha.calls).toHaveLength(0); // never called — no secret to verify against
    const list = await app.inject({ method: 'GET', url: `/orgs/${orgId}/projects/${projectId}/submissions`, cookies: { sw_session: t } });
    expect((list.json() as { total: number }).total).toBe(0); // not stored
  });

  it('rejects (503) when the secret cannot be decrypted (key removed/rotated)', async () => {
    // App with NO encryption key, but a form that requires hCaptcha and a stored
    // (pretend) secret — getHcaptchaSecret() will throw EncryptionUnavailableError.
    hcaptcha = new FakeHcaptcha();
    const db = await makeTestDb();
    // First app (with key) to store a secret, then a second app (no key) to read it.
    const keyed = await createApp({ db, hcaptcha, encryptionKey: ENC_KEY, adminEmails: ['admin@acme.test'] });
    await keyed.ready();
    const reg = await keyed.inject({ method: 'POST', url: '/auth/register', payload: { email: 'admin@acme.test', password: 'pw-secret-1', orgName: 'Acme' } });
    const tok = token(reg);
    const oid = (reg.json() as { orgId: string }).orgId;
    const proj = await keyed.inject({ method: 'POST', url: `/orgs/${oid}/projects`, cookies: { sw_session: tok }, payload: { name: 'S', slug: 's' } });
    const pid = (proj.json() as { project: { id: string } }).project.id;
    await keyed.inject({ method: 'PUT', url: `/orgs/${oid}/projects/${pid}/content/form/contact`, cookies: { sw_session: tok }, payload: { id: 'contact', name: 'C', fields: [{ name: 'email', label: 'Email', type: 'email' }], recipient: 'a@b.co', hcaptcha: true } });
    await keyed.inject({ method: 'PUT', url: '/admin/settings', cookies: { sw_session: tok }, payload: { hcaptcha: { siteKey: 'sk', secret: 'hc-secret' } } });

    // Same DB, NO encryption key → decrypt throws.
    const keyless = await createApp({ db, hcaptcha });
    await keyless.ready();
    const res = await keyless.inject({ method: 'POST', url: `/f/${pid}/contact`, payload: { email: 'x@y.co', _elapsed: '5000' } });
    expect(res.statusCode).toBe(503);
  });
});
