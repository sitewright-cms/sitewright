import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { shopOrderFormId, type Form } from '@sitewright/schema';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { orderFormFor, orderFormMode } from '../src/repo/shop-order-forms.js';
import { content, formSubmissions, instanceSettings, INSTANCE_SETTINGS_ID } from '../src/db/schema.js';
import { PROJECT_MAIL_UNAVAILABLE } from '../src/mail/mailer.js';

/**
 * The mini-shop's `form` channel takes an ADDRESS, and the platform provisions the Form behind it.
 *
 * Server-side delivery needs a spam-guarded endpoint, an SMTP mode, an inbox row and a retry path —
 * all of which is what a Form IS — but none of that is something an operator should have to assemble
 * by hand and then point at. So the settings save derives it, and these tests pin the two properties
 * that make derivation safe: the Form MATCHES the channel, and it keeps matching after an edit.
 */

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let publishRoot: string;

beforeEach(async () => {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-shopform-'));
  db = await makeTestDb();
  app = await createApp({ db, publishRoot });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await rm(publishRoot, { recursive: true, force: true });
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

async function setup(email: string) {
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const t = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
  const proj = await app.inject({
    method: 'POST',
    url: '/projects',
    cookies: { sw_session: t },
    payload: { name: 'Shop', slug: `s-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  });
  return { t, projectId: (proj.json() as { project: { id: string } }).project.id };
}

/** Write the shop config through the ordinary settings merge, and assert it landed. */
async function saveShop(projectId: string, t: string, channels: unknown[]) {
  const res = await app.inject({
    method: 'PUT',
    url: `/projects/${projectId}/content/settings/settings?merge=1`,
    cookies: { sw_session: t },
    payload: { website: { shop: { enabled: true, channels } } },
  });
  // ★ A fixture write that silently 400s is how a vacuous test is born.
  expect(res.statusCode, `settings write must succeed: ${res.body}`).toBe(200);
}

const getForm = async (projectId: string, t: string, id: string) =>
  app.inject({ method: 'GET', url: `/projects/${projectId}/content/form/${id}`, cookies: { sw_session: t } });

describe('the Form a shop order channel implies', () => {
  it('★ mirrors the channel: recipient, subject, captcha and the buyer FIELDS', async () => {
    const { t, projectId } = await setup('shop1@t.test');
    await saveShop(projectId, t, [
      {
        kind: 'form',
        key: 'order',
        email: 'orders@acme.test',
        subject: 'New order',
        captcha: true,
        fields: [
          { key: 'name', type: 'text', required: true },
          { key: 'delivery_address', type: 'textarea', required: true },
          { key: 'po_number', type: 'text' },
        ],
      },
    ]);

    const res = await getForm(projectId, t, shopOrderFormId('order'));
    expect(res.statusCode, res.body).toBe(200);
    const form = (res.json() as { item: Form }).item;
    expect(form.recipient).toBe('orders@acme.test');
    expect(form.subject).toBe('New order');
    expect(form.captcha).toBe(true);
    expect(form.managed).toBe('shop');
    // The FIELDS are the channel's — which is the whole fix. A required field the cart cannot fill
    // used to 400 every order; now the cart and the validator are built from the same list.
    expect(form.fields.map((f) => f.name)).toEqual(['name', 'delivery_address', 'po_number']);
    expect(form.fields.find((f) => f.name === 'delivery_address')?.required).toBe(true);
    expect(form.fields.find((f) => f.name === 'po_number')?.required).toBeFalsy();
  });

  it('★ FOLLOWS an edit — the form cannot drift from the channel', async () => {
    const { t, projectId } = await setup('shop2@t.test');
    await saveShop(projectId, t, [{ kind: 'form', key: 'order', email: 'a@acme.test', fields: [{ key: 'name', type: 'text', required: true }] }]);
    await saveShop(projectId, t, [{ kind: 'form', key: 'order', email: 'b@acme.test', fields: [{ key: 'phone', type: 'tel' }] }]);

    const form = ((await getForm(projectId, t, shopOrderFormId('order'))).json() as { item: Form }).item;
    expect(form.recipient).toBe('b@acme.test');
    expect(form.fields.map((f) => f.name)).toEqual(['phone']);
  });

  it('a channel with NO buyer fields still provisions — the order itself is the content', async () => {
    const { t, projectId } = await setup('shop3@t.test');
    await saveShop(projectId, t, [{ kind: 'form', key: 'order', email: 'a@acme.test' }]);
    const form = ((await getForm(projectId, t, shopOrderFormId('order'))).json() as { item: Form }).item;
    // A Form must declare at least one field; an order with no buyer questions is a real shop, not a
    // misconfiguration, so it gets an optional note rather than being refused.
    expect(form.fields).toHaveLength(1);
    expect(form.fields[0]?.required).toBeFalsy();
  });

  it('a NON-form channel provisions nothing', async () => {
    const { t, projectId } = await setup('shop4@t.test');
    await saveShop(projectId, t, [{ kind: 'whatsapp', key: 'wa', number: '+14155550123' }]);
    expect((await getForm(projectId, t, shopOrderFormId('wa'))).statusCode).toBe(404);
  });

  it('★ a submission with the channel-declared fields is ACCEPTED end to end', async () => {
    // The pairing test: what the cart would post must satisfy the form the same config produced.
    const { t, projectId } = await setup('shop5@t.test');
    await saveShop(projectId, t, [
      { kind: 'form', key: 'order', email: 'orders@acme.test', fields: [{ key: 'name', type: 'text', required: true }, { key: 'po_number', type: 'text' }] },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: `/f/${projectId}/${shopOrderFormId('order')}`,
      payload: {
        name: 'Ada',
        po_number: '',
        cart_text: '1x Widget',
        cart_json: '[]',
        _hpt: '',
        _elapsed: '9000',
        _ix: '3.12.2',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
  });
});

describe('orderFormFor / orderFormMode (unit)', () => {
  it('prefers global SMTP, falls back to project SMTP', () => {
    expect(orderFormMode({ globalSmtp: true, userSmtp: true })).toBe('globalSmtp');
    expect(orderFormMode({ globalSmtp: false, userSmtp: true })).toBe('userSmtp');
    // Neither enabled → still coherent, so it starts working the moment an admin turns one on.
    expect(orderFormMode({})).toBe('globalSmtp');
  });

  it('returns null for a channel that is not a form at all', () => {
    expect(orderFormFor({ kind: 'whatsapp', key: 'wa', number: '+14155550123' }, 'globalSmtp')).toBeNull();
  });
});

describe('★ shop order mail comes from the project\'s own SMTP when it has one', () => {
  // Its own app: the project SMTP routes exist only with an encryption key, and the two mailers are
  // recorders so the test sees which one each order went through.
  let app2: FastifyInstance;
  let db2: Awaited<ReturnType<typeof makeTestDb>>;
  let via: string[];
  let projectFails: number;
  let globalUp: boolean;

  beforeEach(async () => {
    via = [];
    projectFails = 0;
    globalUp = true;
    db2 = await makeTestDb();
    // An instance offering both global SMTP and per-project SMTP.
    const data = { formModes: { globalSmtp: true, userSmtp: true, contactPhp: false, contactPhpSmtp: false, thirdParty: false, whatsapp: false } };
    await db2.insert(instanceSettings).values({ id: INSTANCE_SETTINGS_ID, data, updatedAt: new Date() });
    app2 = await createApp({
      db: db2,
      encryptionKey: randomBytes(32),
      // Only these hosts may be a project's SMTP.
      smtpAllowedHosts: ['smtp.acme.test'],
      mailer: { send: async () => (globalUp ? (via.push('global'), true) : false) },
      projectMailer: {
        send: async () => {
          if (projectFails > 0) {
            projectFails -= 1;
            throw new Error('421 try again later');
          }
          via.push('project');
          return true;
        },
      },
    });
    await app2.ready();
  });
  afterEach(async () => {
    await app2.close();
  });

  async function shopProject() {
    await registerAccount(db2, 'smtp-owner@t.test', 'Pw-secret-1', { platformRole: 'developer' });
    const t = token(await app2.inject({ method: 'POST', url: '/auth/login', payload: { email: 'smtp-owner@t.test', password: 'Pw-secret-1' } }));
    const proj = await app2.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Shop', slug: 'smtp-shop' } });
    const projectId = (proj.json() as { project: { id: string } }).project.id;
    const saved = await app2.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/settings/settings?merge=1`,
      cookies: { sw_session: t },
      payload: { website: { shop: { enabled: true, channels: [{ kind: 'form', key: 'order', email: 'orders@acme.test' }] } } },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    return { t, projectId };
  }
  const order = async (projectId: string) => {
    const res = await app2.inject({
      method: 'POST',
      url: `/f/${projectId}/${shopOrderFormId('order')}`,
      payload: { note: '', cart_text: '1x Widget', cart_json: '[]', _hpt: '', _elapsed: '9000', _ix: '3.12.2' },
    });
    expect(res.statusCode, res.body).toBe(200);
  };
  const smtp = (projectId: string, t: string, method: 'PUT' | 'DELETE') =>
    app2.inject({
      method,
      url: `/projects/${projectId}/smtp`,
      cookies: { sw_session: t },
      ...(method === 'PUT' ? { payload: { host: 'smtp.acme.test', port: 587, secure: false, fromEmail: 'shop@acme.test', fromName: 'Acme' } } : {}),
    });

  it('follows the project SMTP as it is added and removed, with no settings save in between', async () => {
    const { t, projectId } = await shopProject();
    await order(projectId);
    expect((await smtp(projectId, t, 'PUT')).statusCode).toBe(200);
    await order(projectId);
    expect((await smtp(projectId, t, 'DELETE')).statusCode).toBe(204);
    await order(projectId);
    expect(via).toEqual(['global', 'project', 'global']);
  });

  it('an ordinary form keeps the mode its author chose', async () => {
    const { t, projectId } = await shopProject();
    expect((await smtp(projectId, t, 'PUT')).statusCode).toBe(200);
    const form = await app2.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/form/contact`,
      cookies: { sw_session: t },
      payload: { id: 'contact', name: 'Contact', recipient: 'hi@acme.test', mode: 'globalSmtp', fields: [{ name: 'message', label: 'Message', type: 'textarea' }] },
    });
    expect(form.statusCode, form.body).toBe(200);
    const res = await app2.inject({
      method: 'POST',
      url: `/f/${projectId}/contact`,
      payload: { message: 'Hello', _hpt: '', _elapsed: '9000', _ix: '3.12.2' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(via).toEqual(['global']);
  });

  it('★ a retry of a failed order mail goes back through the project SMTP, not another address', async () => {
    const { t, projectId } = await shopProject();
    expect((await smtp(projectId, t, 'PUT')).statusCode).toBe(200);
    projectFails = 1;
    await order(projectId);
    expect(via).toEqual([]);
    const result = await (app2 as unknown as { runDueFormDeliveries: (o: { now: () => number }) => Promise<{ sent: number }> })
      .runDueFormDeliveries({ now: () => Date.now() + 60 * 60_000 });
    expect(result.sent).toBe(1);
    expect(via).toEqual(['project']);
  });

  it('★ a project SMTP whose host the allowlist no longer permits is not used: global SMTP sends instead', async () => {
    const { projectId } = await shopProject();
    // Saved before the allowlist was tightened — the save-time check would refuse it now.
    const now = new Date();
    await db2.insert(content).values({
      id: 'smtp-row', projectId, kind: 'project_smtp', entityId: 'smtp', scope: '',
      data: { host: 'smtp.elsewhere.test', port: 587, secure: false, fromEmail: 'shop@acme.test' }, createdAt: now, updatedAt: now,
    });
    await order(projectId);
    expect(via).toEqual(['global']);
  });

  it('an order no server could send says so in the inbox, on the request and on every retry', async () => {
    const { projectId } = await shopProject();
    globalUp = false; // no project SMTP, and global SMTP answers "cannot send"
    await order(projectId);
    const reason = async () => (await db2.select({ e: formSubmissions.deliveryError }).from(formSubmissions))[0]?.e;
    expect(await reason()).toBe(PROJECT_MAIL_UNAVAILABLE);
    await (app2 as unknown as { runDueFormDeliveries: (o: { now: () => number }) => Promise<unknown> })
      .runDueFormDeliveries({ now: () => Date.now() + 60 * 60_000 });
    expect(await reason()).toBe(PROJECT_MAIL_UNAVAILABLE);
    expect(via).toEqual([]);
  });
});
