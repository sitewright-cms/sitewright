import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { shopOrderFormId, type Form } from '@sitewright/schema';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { orderFormFor, orderFormMode } from '../src/repo/shop-order-forms.js';

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

  it('returns null for a LEGACY channel that still names a hand-made form', () => {
    // Such a channel keeps posting to the form it names; provisioning over it would hijack an entity
    // the operator authored.
    expect(orderFormFor({ kind: 'form', key: 'order', formId: 'contact', captcha: false }, 'globalSmtp')).toBeNull();
  });

  it('returns null for a channel that is not a form at all', () => {
    expect(orderFormFor({ kind: 'whatsapp', key: 'wa', number: '+14155550123' }, 'globalSmtp')).toBeNull();
  });
});
