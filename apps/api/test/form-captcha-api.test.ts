import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import type { Database } from '../src/db/client.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import type { CaptchaVerifier, CaptchaVerifyRequest } from '../src/mail/captcha.js';
import type { CaptchaProvider } from '@sitewright/schema';

/**
 * Each vendor's own documented TEST key. Site keys are validated for the shape their issuer uses, so
 * a `site-key`-style placeholder is no longer a usable fixture — which is exactly the point: that
 * class of value is what once reached visitors as data-sitekey="123".
 */
const HCAPTCHA_KEY = '10000000-ffff-ffff-ffff-000000000001';
const RECAPTCHA_KEY = '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI';

const ENC_KEY = randomBytes(32);

class FakeCaptcha implements CaptchaVerifier {
  result = true;
  calls: CaptchaVerifyRequest[] = [];
  async verify(req: CaptchaVerifyRequest): Promise<boolean> {
    this.calls.push(req);
    return this.result;
  }
  async testCredentials(): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }
}

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const v = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!v) throw new Error('no session cookie');
  return v;
}

let app: FastifyInstance;
let appDb: Database;
let captcha: FakeCaptcha;
let t: string;
let projectId: string;

/** Configure the PROJECT's captcha, the way the editor does. */
async function configure(provider: CaptchaProvider, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: 'PUT',
    url: `/projects/${projectId}/captcha`,
    cookies: { sw_session: t },
    payload: { provider, siteKey: provider === 'hcaptcha' ? HCAPTCHA_KEY : RECAPTCHA_KEY, secret: 'vendor-secret', ...extra },
  });
}

async function setup() {
  captcha = new FakeCaptcha();
  appDb = await makeTestDb();
  app = await createApp({ db: appDb, captcha, encryptionKey: ENC_KEY });
  await app.ready();
  await registerAccount(appDb, 'admin@acme.test', 'Pw-secret-1', { platformRole: 'admin' });
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin@acme.test', password: 'Pw-secret-1' } });
  t = token(login);
  const proj = await app.inject({ method: 'POST', url: `/projects`, cookies: { sw_session: t }, payload: { name: 'Site', slug: 'site' } });
  projectId = (proj.json() as { project: { id: string } }).project.id;
  await app.inject({
    method: 'PUT',
    url: `/projects/${projectId}/content/form/contact`,
    cookies: { sw_session: t },
    payload: { id: 'contact', name: 'Contact', fields: [{ name: 'email', label: 'Email', type: 'email' }], recipient: 'a@b.co', captcha: true },
  });
}

const submit = (fields: Record<string, string>) =>
  app.inject({ method: 'POST', url: `/f/${projectId}/contact`, payload: { email: 'x@y.co', _elapsed: '5000', _ix: '3.12.2', ...fields } });

const total = async () =>
  ((await app.inject({ method: 'GET', url: `/projects/${projectId}/submissions`, cookies: { sw_session: t } })).json() as { total: number }).total;

describe('form submission captcha enforcement (per project)', () => {
  it('verifies against the PROJECT’s provider and secret', async () => {
    await setup();
    await configure('hcaptcha');
    const res = await submit({ 'h-captcha-response': 'good-token' });
    expect(res.statusCode).toBe(200);
    expect(captcha.calls[0]).toMatchObject({ provider: 'hcaptcha', secret: 'vendor-secret', token: 'good-token' });
    expect(await total()).toBe(1);
  });

  it('★ accepts either vendor’s response field, since each widget injects its own', async () => {
    await setup();
    await configure('recaptcha-v2');
    const res = await submit({ 'g-recaptcha-response': 'g-token' });
    expect(res.statusCode).toBe(200);
    expect(captcha.calls[0]).toMatchObject({ provider: 'recaptcha-v2', token: 'g-token' });
  });

  it('passes the project’s v3 score threshold through to the verifier', async () => {
    await setup();
    await configure('recaptcha-v3', { minScore: 0.8 });
    await submit({ 'g-recaptcha-response': 'g-token' });
    expect(captcha.calls[0]).toMatchObject({ provider: 'recaptcha-v3', minScore: 0.8 });
  });

  it('rejects (400) when verification fails, and stores nothing', async () => {
    await setup();
    await configure('hcaptcha');
    captcha.result = false;
    expect((await submit({ 'h-captcha-response': 'bad' })).statusCode).toBe(400);
    expect(await total()).toBe(0);
  });

  it('never stores the captcha token with the lead', async () => {
    await setup();
    await configure('recaptcha-v2');
    await submit({ 'g-recaptcha-response': 'g-token' });
    const list = await app.inject({ method: 'GET', url: `/projects/${projectId}/submissions`, cookies: { sw_session: t } });
    const body = list.json() as { items: Array<{ fields: Record<string, string> }> };
    expect(body.items[0]!.fields).toEqual({ email: 'x@y.co' });
    expect(body.items[0]!.fields).not.toHaveProperty('g-recaptcha-response');
  });

  it('★ fails CLOSED (503) when the form wants a captcha the project never configured', async () => {
    // The author explicitly asked for a captcha. Accepting the submission because the credentials
    // are missing would silently deliver exactly the unprotected form they were trying to avoid.
    await setup();
    const res = await submit({});
    expect(res.statusCode).toBe(503);
    expect(captcha.calls).toHaveLength(0); // nothing to verify against — never called
    expect(await total()).toBe(0);
  });

  it('fails closed when the stored secret cannot be decrypted (key rotated/removed)', async () => {
    await setup();
    await configure('hcaptcha');
    // Same database, NO encryption key → the decrypt throws where the request path reads it.
    const keyless = await createApp({ db: appDb, captcha });
    await keyless.ready();
    const res = await keyless.inject({
      method: 'POST',
      url: `/f/${projectId}/contact`,
      payload: { email: 'x@y.co', _elapsed: '5000', _ix: '3.12.2', 'h-captcha-response': 'tok' },
    });
    expect(res.statusCode).toBe(503);
  });

  it('leaves a form that did not ask for a captcha completely alone', async () => {
    await setup();
    await configure('hcaptcha');
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/form/open`,
      cookies: { sw_session: t },
      payload: { id: 'open', name: 'Open', fields: [{ name: 'email', label: 'Email', type: 'email' }], recipient: 'a@b.co' },
    });
    const res = await app.inject({ method: 'POST', url: `/f/${projectId}/open`, payload: { email: 'x@y.co', _elapsed: '5000', _ix: '3.12.2' } });
    expect(res.statusCode).toBe(200);
    expect(captcha.calls).toHaveLength(0);
  });
});

describe('per-project captcha config routes', () => {
  it('round-trips the config and never returns the secret', async () => {
    await setup();
    const put = await configure('recaptcha-v3', { minScore: 0.7 });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ captcha: { provider: 'recaptcha-v3', siteKey: RECAPTCHA_KEY, hasSecret: true, minScore: 0.7 } });
    expect(put.body).not.toContain('vendor-secret');

    const get = await app.inject({ method: 'GET', url: `/projects/${projectId}/captcha`, cookies: { sw_session: t } });
    expect(get.json()).toMatchObject({ captcha: { provider: 'recaptcha-v3', hasSecret: true } });
    expect(get.body).not.toContain('vendor-secret');
  });

  it('rejects a site key that could not have been issued by the chosen provider', async () => {
    await setup();
    // The reCAPTCHA key under hCaptcha — the most likely way to misconfigure this, and the boundary
    // where a human is still looking at the field.
    const res = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/captcha`,
      cookies: { sw_session: t },
      payload: { provider: 'hcaptcha', siteKey: RECAPTCHA_KEY, secret: 's' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('keeps the stored secret when it is omitted, but DROPS it when the provider changes', async () => {
    // Keys are not portable between vendors. Silently keeping the old secret across a switch would
    // produce a config that looks complete and rejects every visitor.
    await setup();
    await configure('hcaptcha');
    const same = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/captcha`,
      cookies: { sw_session: t },
      payload: { provider: 'hcaptcha', siteKey: HCAPTCHA_KEY },
    });
    expect(same.json()).toMatchObject({ captcha: { hasSecret: true } });

    const switched = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/captcha`,
      cookies: { sw_session: t },
      payload: { provider: 'recaptcha-v2', siteKey: RECAPTCHA_KEY },
    });
    expect(switched.json()).toMatchObject({ captcha: { provider: 'recaptcha-v2', hasSecret: false } });
  });

  it('deletes idempotently, so the editor can always save an unconfigured section', async () => {
    await setup();
    await configure('hcaptcha');
    expect((await app.inject({ method: 'DELETE', url: `/projects/${projectId}/captcha`, cookies: { sw_session: t } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/projects/${projectId}/captcha`, cookies: { sw_session: t } })).statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: `/projects/${projectId}/captcha`, cookies: { sw_session: t } });
    expect(get.json()).toEqual({ captcha: null });
  });

  it('★ is unreachable through the GENERIC content routes, which would leak the secret', async () => {
    // A generic read of a secret-bearing kind hands out the encrypted envelope; a generic write lets
    // a caller store an attacker-chosen blob. Both are refused, exactly as for SMTP and deploy
    // targets — the dedicated routes are the only way in.
    await setup();
    await configure('hcaptcha');
    const read = await app.inject({ method: 'GET', url: `/projects/${projectId}/content/project_captcha/captcha`, cookies: { sw_session: t } });
    expect(read.statusCode).toBe(403);
    expect(read.body).not.toContain('vendor-secret');
    const write = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/project_captcha/captcha`,
      cookies: { sw_session: t },
      payload: { provider: 'hcaptcha', siteKey: HCAPTCHA_KEY, secret: { iv: 'x', ct: 'y', tag: 'z' } },
    });
    expect(write.statusCode).toBe(403);
  });

  it('is TENANT-scoped: another project’s config is not visible or reachable', async () => {
    await setup();
    await configure('hcaptcha');
    const other = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Other', slug: 'other' } });
    const otherId = (other.json() as { project: { id: string } }).project.id;
    const get = await app.inject({ method: 'GET', url: `/projects/${otherId}/captcha`, cookies: { sw_session: t } });
    expect(get.json()).toEqual({ captcha: null });
  });
});
