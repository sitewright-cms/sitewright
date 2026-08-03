import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { projectMembers, formSubmissions } from '../src/db/schema.js';
import { DEFAULT_FORM_MODES, MAX_SUBMISSIONS_PER_FORM } from '@sitewright/schema';
import { SubmissionRepository } from '../src/repo/submissions.js';
import { registerAccount } from '../src/repo/accounts.js';
import type { Database } from '../src/db/client.js';
import { formatSubmissionText } from '../src/mail/mailer.js';
import type { SubmissionMail, SubmissionMailer, ProjectMailer } from '../src/mail/mailer.js';

class FakeMailer implements SubmissionMailer {
  sent: SubmissionMail[] = [];
  result = true;
  async send(mail: SubmissionMail): Promise<boolean> {
    this.sent.push(mail);
    return this.result;
  }
}

class FakeProjectMailer implements ProjectMailer {
  sent: Array<{ projectId: string; mail: SubmissionMail }> = [];
  result = true;
  async send(projectId: string, mail: SubmissionMail): Promise<boolean> {
    this.sent.push({ projectId, mail });
    return this.result;
  }
}

let app: FastifyInstance;
let db: Database;
let mailer: FakeMailer;
let projectMailer: FakeProjectMailer;
let t: string;
let projectId: string;

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const v = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!v) throw new Error('no session cookie');
  return v;
}

const form = {
  id: 'contact',
  name: 'Contact form',
  fields: [
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'message', label: 'Message', type: 'textarea' },
  ],
  recipient: 'sales@acme.com',
};

beforeEach(async () => {
  mailer = new FakeMailer();
  projectMailer = new FakeProjectMailer();
  db = await makeTestDb();
  app = await createApp({ db, mailer, projectMailer });
  await app.ready();
  // Project creation is agency-staff-only now; seed the creator as `developer` (agency staff). The
  // register route is invite-only, so seed via the repo, then log in for a session cookie.
  await registerAccount(db, 'owner@acme.test', 'Pw-secret-1', { platformRole: 'developer' });
  t = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'owner@acme.test', password: 'Pw-secret-1' } }));
  const proj = await app.inject({
    method: 'POST',
    url: `/projects`,
    cookies: { sw_session: t },
    payload: { name: 'Site', slug: 'site' },
  });
  projectId = (proj.json() as { project: { id: string } }).project.id;
  // Author the form (owner) via the generic content route.
  const put = await app.inject({
    method: 'PUT',
    url: `/projects/${projectId}/content/form/contact`,
    cookies: { sw_session: t },
    payload: form,
  });
  expect(put.statusCode).toBe(200);
});

describe('public form submission endpoint', () => {
  it('stores a valid submission, emails it (Mode A), and never echoes the recipient', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/f/${projectId}/contact`,
      payload: { email: 'lead@x.co', message: 'Hello there', _elapsed: '5000' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(res.body).not.toContain('sales@acme.com'); // recipient stays server-side
    // CORS for cross-origin posting from the exported site.
    expect(res.headers['access-control-allow-origin']).toBe('*');
    // Stored
    const list = await app.inject({ method: 'GET', url: `/projects/${projectId}/submissions`, cookies: { sw_session: t } });
    const body = list.json() as { items: Array<{ fields: Record<string, string> }>; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0]!.fields).toEqual({ email: 'lead@x.co', message: 'Hello there' });
    // Emailed
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ recipient: 'sales@acme.com', formName: 'Contact form', replyTo: 'lead@x.co' });
    expect(mailer.sent[0]!.fields).not.toHaveProperty('_elapsed'); // trap field stripped
  });

  it('routes a userSmtp form to the project mailer (not the global mailer)', async () => {
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/form/lead`,
      cookies: { sw_session: t },
      payload: { id: 'lead', name: 'Lead', fields: [{ name: 'email', label: 'Email', type: 'email' }], recipient: 'sales@acme.com', mode: 'userSmtp' },
    });
    const res = await app.inject({ method: 'POST', url: `/f/${projectId}/lead`, payload: { email: 'p@x.co', _elapsed: '5000' } });
    expect(res.statusCode).toBe(200);
    expect(projectMailer.sent).toHaveLength(1);
    expect(projectMailer.sent[0]).toMatchObject({ projectId, mail: { recipient: 'sales@acme.com' } });
    expect(mailer.sent).toHaveLength(0); // global mailer not used
  });

  it('drops (silently 200) a honeypot-filled submission', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/f/${projectId}/contact`,
      payload: { email: 'bot@x.co', _hpt: 'i am a bot', _elapsed: '5000' },
    });
    expect(res.statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(0);
    const list = await app.inject({ method: 'GET', url: `/projects/${projectId}/submissions`, cookies: { sw_session: t } });
    expect((list.json() as { total: number }).total).toBe(0);
  });

  it('drops a submission completed implausibly fast (time-trap)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/f/${projectId}/contact`,
      payload: { email: 'bot@x.co', _elapsed: '100' },
    });
    expect(res.statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(0);
  });

  it('rejects a submission missing a required field (server backstop, not stored/emailed)', async () => {
    // Passes the bot traps (_elapsed) but omits the required `email` — the client would have blocked
    // this, but a direct POST bypasses it, so the server must reject with the offending field names.
    const res = await app.inject({
      method: 'POST',
      url: `/f/${projectId}/contact`,
      payload: { message: 'no email supplied', _elapsed: '5000' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid fields', fields: ['email'] });
    expect(mailer.sent).toHaveLength(0);
    const list = await app.inject({ method: 'GET', url: `/projects/${projectId}/submissions`, cookies: { sw_session: t } });
    expect((list.json() as { total: number }).total).toBe(0);
  });

  it('rejects a malformed value for a typed field (email format)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/f/${projectId}/contact`,
      payload: { email: 'not-an-email', _elapsed: '5000' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid fields', fields: ['email'] });
    expect(mailer.sent).toHaveLength(0);
  });

  it('404s an unknown form and 400s a non-text (nested) value', async () => {
    expect((await app.inject({ method: 'POST', url: `/f/${projectId}/nope`, payload: { a: '1' } })).statusCode).toBe(404);
    const nested = await app.inject({
      method: 'POST',
      url: `/f/${projectId}/contact`,
      payload: { attachment: { bytes: 'AAAA' }, _elapsed: '5000' },
    });
    expect(nested.statusCode).toBe(400);
  });

  it('joins a checkbox-group array into a single stored text value; rejects a non-string array element', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: `/f/${projectId}/contact`,
      payload: { email: 'lead@x.co', features: ['SEO', 'Analytics', 'Hosting'], _elapsed: '5000' },
    });
    expect(ok.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: `/projects/${projectId}/submissions`, cookies: { sw_session: t } });
    const items = (list.json() as { items: Array<{ fields: Record<string, string> }> }).items;
    expect(items[0]!.fields.features).toBe('SEO, Analytics, Hosting'); // array joined
    // when only ONE box in a group is checked, the client sends a plain STRING (not an array) — stored as-is
    const single = await app.inject({ method: 'POST', url: `/f/${projectId}/contact`, payload: { email: 'x@y.co', features: 'SEO', _elapsed: '5000' } });
    expect(single.statusCode).toBe(200);
    const items2 = ((await app.inject({ method: 'GET', url: `/projects/${projectId}/submissions`, cookies: { sw_session: t } })).json() as { items: Array<{ fields: Record<string, string> }> }).items;
    expect(items2[0]!.fields.features).toBe('SEO');
    // an array with a non-string element is rejected (still no objects/binary)
    const bad = await app.inject({ method: 'POST', url: `/f/${projectId}/contact`, payload: { features: ['ok', { x: 1 }], _elapsed: '5000' } });
    expect(bad.statusCode).toBe(400);
    // a control (trap) field must NEVER be an array — reject rather than normalize it into a value
    expect((await app.inject({ method: 'POST', url: `/f/${projectId}/contact`, payload: { email: 'a@b.co', _hpt: [], _elapsed: '5000' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/f/${projectId}/contact`, payload: { email: 'a@b.co', _elapsed: ['5000'] } })).statusCode).toBe(400);
  });

  it('still stores the submission when mail delivery is unavailable', async () => {
    mailer.result = false; // SMTP not configured / disabled
    const res = await app.inject({
      method: 'POST',
      url: `/f/${projectId}/contact`,
      payload: { email: 'lead@x.co', _elapsed: '5000' },
    });
    expect(res.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: `/projects/${projectId}/submissions`, cookies: { sw_session: t } });
    expect((list.json() as { total: number }).total).toBe(1);
  });

  it('answers a CORS preflight', async () => {
    const res = await app.inject({ method: 'OPTIONS', url: `/f/${projectId}/contact` });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
  });

  it('allows a CROSS-DOMAIN post: preflight + POST from a foreign Origin (externally-deployed site)', async () => {
    // A site deployed to the owner's OWN host (or served from a `<slug>.<sitesDomain>` subdomain with an
    // absolute publicBaseUrl endpoint) posts cross-origin. The JSON content-type makes it a NON-simple
    // request → the browser preflights. Both the preflight and the POST must advertise CORS so the
    // browser lets the foreign origin send the body + read the `{ok:true}` response.
    const origin = 'https://acme.example.com'; // a different registrable domain than the API host
    const pre = await app.inject({
      method: 'OPTIONS',
      url: `/f/${projectId}/contact`,
      headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe('*'); // wildcard → any deploy host is allowed
    expect(pre.headers['access-control-allow-methods']).toContain('POST');
    expect(String(pre.headers['access-control-allow-headers']).toLowerCase()).toContain('content-type');

    const res = await app.inject({
      method: 'POST',
      url: `/f/${projectId}/contact`,
      headers: { origin, 'content-type': 'application/json' },
      payload: { email: 'lead@x.co', message: 'cross-domain hello', _elapsed: '5000' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(res.headers['access-control-allow-origin']).toBe('*');
    // No credentials are involved (a visitor has no platform session), so `*` is safe — and there is
    // deliberately NO `Access-Control-Allow-Credentials: true` (which would be invalid with `*`).
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('names the cap it hit instead of one opaque "invalid submission"', async () => {
    // A big order form sits close to the field cap (a real one measured 44 of 60); the first time a
    // menu grows past it, EVERY order 400s, and the message used to say nothing about which limit.
    const tooMany: Record<string, string> = { _elapsed: '5000' };
    for (let i = 0; i < 70; i += 1) tooMany[`f${i}`] = 'x';
    const over = await app.inject({ method: 'POST', url: `/f/${projectId}/contact`, payload: tooMany });
    expect(over.statusCode).toBe(400);
    expect(over.json()).toEqual({ error: 'invalid submission', reason: 'too many fields (71; the maximum is 60)' });

    const long = await app.inject({
      method: 'POST',
      url: `/f/${projectId}/contact`,
      payload: { email: 'a@b.co', message: 'x'.repeat(10_001), _elapsed: '5000' },
    });
    expect(long.json()).toMatchObject({ reason: '"message" is longer than 10000 characters' });

    const nested = await app.inject({
      method: 'POST',
      url: `/f/${projectId}/contact`,
      payload: { email: { deep: true }, _elapsed: '5000' },
    });
    expect(nested.json()).toMatchObject({ reason: '"email" is not text (no objects, nulls or attachments)' });

    const notAnObject = await app.inject({ method: 'POST', url: `/f/${projectId}/contact`, payload: ['a'] });
    expect(notAnObject.json()).toMatchObject({ reason: 'the body must be a flat object of text values' });
  });

  it('heads each email line with the author’s LABEL, and leaves undeclared fields on their own name', async () => {
    // The body is keyed by input `name` — wiring. A merchant was reading `arrival_date:` while the
    // author had written "Pickup Date in Windhoek" right there in the form.
    const res = await app.inject({
      method: 'POST',
      url: `/f/${projectId}/contact`,
      payload: { email: 'lead@x.co', message: 'Hello', 'Meal - Chilli Con Carne': '3', _elapsed: '5000' },
    });
    expect(res.statusCode).toBe(200);
    const mail = mailer.sent[0]!;
    expect(mail.labels).toEqual({ email: 'Email', message: 'Message' });
    const body = formatSubmissionText(mail.formName, mail.fields, mail.labels);
    expect(body).toContain('Email:\n  lead@x.co');
    expect(body).toContain('Message:\n  Hello');
    // no definition entry → keeps its own name, which is already prose on a hand-authored page
    expect(body).toContain('Meal - Chilli Con Carne:\n  3');
    expect(body).not.toContain('email:\n');
  });

  describe('dry run — what a preview posts to', () => {
    const stored = async (): Promise<number> =>
      (await new SubmissionRepository(db).list(projectId, {})).total;

    it('validates like the real endpoint, then stores nothing and mails nobody', async () => {
      const before = await stored();
      const res = await app.inject({
        method: 'POST',
        url: `/f/${projectId}/contact/preview`,
        payload: { email: 'lead@x.co', message: 'Hello there', _elapsed: '5000' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, preview: true, fields: 2 });
      expect(await stored()).toBe(before);
      expect(mailer.sent).toHaveLength(0);
      expect(projectMailer.sent).toHaveLength(0);
    });

    it('enforces the definition — a missing required field fails here exactly as it would live', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/f/${projectId}/contact/preview`,
        payload: { message: 'no email', _elapsed: '5000' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid fields', fields: ['email'] });
    });

    it('mirrors the bot filters, and names the reason so an author can tell a drop from a delivery', async () => {
      const trap = await app.inject({
        method: 'POST',
        url: `/f/${projectId}/contact/preview`,
        payload: { email: 'lead@x.co', _elapsed: '10' },
      });
      expect(trap.statusCode).toBe(200);
      expect(trap.json()).toMatchObject({ ok: true, filtered: 'too-fast' });
      const pot = await app.inject({
        method: 'POST',
        url: `/f/${projectId}/contact/preview`,
        payload: { email: 'lead@x.co', _hpt: 'bot', _elapsed: '5000' },
      });
      expect(pot.json()).toMatchObject({ ok: true, filtered: 'honeypot' });
      expect(await stored()).toBe(0);
    });

    it('404s an unknown form, and answers a CORS preflight like the real endpoint', async () => {
      const missing = await app.inject({ method: 'POST', url: `/f/${projectId}/nope/preview`, payload: { _elapsed: '5000' } });
      expect(missing.statusCode).toBe(404);
      const pre = await app.inject({ method: 'OPTIONS', url: `/f/${projectId}/contact/preview` });
      expect(pre.statusCode).toBe(204);
      expect(pre.headers['access-control-allow-origin']).toBe('*');
    });

    it('never echoes anything about the form — a preview must not leak the recipient', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/f/${projectId}/contact/preview`,
        payload: { email: 'lead@x.co', _elapsed: '5000' },
      });
      expect(res.body).not.toContain('sales@acme.com');
      expect(res.body).not.toContain('Contact form');
    });

    it('400s a structurally invalid body, like the real endpoint', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/f/${projectId}/contact/preview`,
        payload: { email: { nested: true }, _elapsed: '5000' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'invalid submission' });
    });
  });

  it('silently drops (200, not stored) once the per-form storage cap is reached', async () => {
    // Seed the table to the cap with a chunked batch insert (fast), then a public
    // submit must be silently dropped (200, no store, no email).
    const now = new Date();
    const rows = Array.from({ length: MAX_SUBMISSIONS_PER_FORM }, (_, i) => ({
      id: `seed-${i}`,
      projectId,
      formId: 'contact',
      data: { n: String(i) },
      createdAt: now,
    }));
    // Chunk size is bounded by SQLite's ~32k BOUND PARAMETER ceiling, not by memory: the driver
    // sends columns x rows placeholders in one statement. It was 5000 when the table had five
    // columns; the delivery-state columns take it to nine, so 5000 rows is ~45k parameters and the
    // insert fails. Sized with headroom so the next column added here does not break it again.
    for (let i = 0; i < rows.length; i += 2000) {
      await db.insert(formSubmissions).values(rows.slice(i, i + 2000));
    }
    const res = await app.inject({
      method: 'POST',
      url: `/f/${projectId}/contact`,
      payload: { email: 'over@cap.co', _elapsed: '5000' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mailer.sent).toHaveLength(0); // not emailed
    const repo = new SubmissionRepository(db);
    expect(await repo.countForForm(projectId, 'contact')).toBe(MAX_SUBMISSIONS_PER_FORM); // not stored beyond cap
  });

  it('exposes the instance form modes to a project member (default: all off)', async () => {
    const unauth = await app.inject({ method: 'GET', url: `/projects/${projectId}/form-modes` });
    expect(unauth.statusCode).toBe(401);
    const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/form-modes`, cookies: { sw_session: t } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { formModes: Record<string, boolean> }).formModes).toEqual(DEFAULT_FORM_MODES);
  });
});

describe('submissions inbox (authenticated)', () => {
  beforeEach(async () => {
    await app.inject({ method: 'POST', url: `/f/${projectId}/contact`, payload: { email: 'a@x.co', _elapsed: '5000' } });
  });

  it('requires authentication (401 without a session)', async () => {
    const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/submissions` });
    expect(res.statusCode).toBe(401);
  });

  it('lists, reads one, and deletes a submission', async () => {
    const list = await app.inject({ method: 'GET', url: `/projects/${projectId}/submissions`, cookies: { sw_session: t } });
    const id = (list.json() as { items: Array<{ id: string }> }).items[0]!.id;
    const one = await app.inject({ method: 'GET', url: `/projects/${projectId}/submissions/${id}`, cookies: { sw_session: t } });
    expect((one.json() as { item: { fields: Record<string, string> } }).item.fields.email).toBe('a@x.co');
    const del = await app.inject({ method: 'DELETE', url: `/projects/${projectId}/submissions/${id}`, cookies: { sw_session: t } });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: `/projects/${projectId}/submissions`, cookies: { sw_session: t } });
    expect((after.json() as { total: number }).total).toBe(0);
  });

  it('lets a project member read and delete a submission (constrained client-write removed)', async () => {
    // A second user, granted access to THIS project as a member.
    const { userId: memberUserId } = await registerAccount(db, 'member@x.test', 'Pw-secret-1');
    const memberT = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'member@x.test', password: 'Pw-secret-1' } }));
    await db.insert(projectMembers).values({ id: randomUUID(), userId: memberUserId, projectId, role: 'member', createdAt: new Date() });

    const list = await app.inject({ method: 'GET', url: `/projects/${projectId}/submissions`, cookies: { sw_session: memberT } });
    expect(list.statusCode).toBe(200); // members can read
    const id = (list.json() as { items: Array<{ id: string }> }).items[0]!.id;
    const del = await app.inject({ method: 'DELETE', url: `/projects/${projectId}/submissions/${id}`, cookies: { sw_session: memberT } });
    expect(del.statusCode).toBe(204); // a member is now a writer and may delete
  });

  it('isolates a non-member from these submissions (403 project)', async () => {
    await registerAccount(db, 'other@x.test', 'Pw-secret-1');
    const ot = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'other@x.test', password: 'Pw-secret-1' } }));
    // A user who holds no membership on this project cannot reach it over a session (403).
    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/submissions`,
      cookies: { sw_session: ot },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('undelivered notifications are visible and recoverable', () => {
  /** The delivery state of the single stored submission. */
  async function state() {
    const [row] = await db.select().from(formSubmissions);
    return row!;
  }

  it('★ a successful send leaves nothing owed', async () => {
    await app.inject({ method: 'POST', url: `/f/${projectId}/contact`, payload: { email: 'lead@x.co', _elapsed: '5000' } });
    expect((await state()).deliveryState).toBe('sent');
    const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/submissions/undelivered`, cookies: { sw_session: t } });
    expect(res.json()).toEqual({ count: 0, lastError: null });
  });

  it('★ a mail failure leaves a row the operator can SEE, with a reason', async () => {
    // Before this existed, a throwing mailer produced one server-log line and nothing else: the
    // visitor was thanked, the lead sat in the inbox, and nobody knew it had not been emailed.
    mailer.send = async () => { throw Object.assign(new Error('nope'), { code: 'EAUTH' }); };
    const post = await app.inject({ method: 'POST', url: `/f/${projectId}/contact`, payload: { email: 'lead@x.co', _elapsed: '5000' } });
    expect(post.statusCode).toBe(200); // the visitor is still thanked — that part is deliberate
    expect(post.json()).toEqual({ ok: true });

    const row = await state();
    expect(row.deliveryState).toBe('pending');
    expect(row.deliveryAttempts).toBe(1);
    expect(row.deliveryNextAt).not.toBeNull(); // scheduled, so the runner will find it

    const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/submissions/undelivered`, cookies: { sw_session: t } });
    const body = res.json() as { count: number; lastError: string };
    expect(body.count).toBe(1);
    expect(body.lastError).toMatch(/rejected the username or password/i);
    expect(body.lastError).not.toMatch(/nope/); // the raw driver message never surfaces
  });

  it('★ mail that is simply unconfigured is owed too, not silently dropped', async () => {
    mailer.result = false; // "not configured / mode disabled" rather than a transport error
    await app.inject({ method: 'POST', url: `/f/${projectId}/contact`, payload: { email: 'lead@x.co', _elapsed: '5000' } });
    const row = await state();
    expect(row.deliveryState).toBe('pending');
    expect(row.deliveryError).toMatch(/not configured/i);
  });

  it('★ the retry pass delivers it once the operator fixes the problem', async () => {
    mailer.send = async () => { throw new Error('down'); };
    await app.inject({ method: 'POST', url: `/f/${projectId}/contact`, payload: { email: 'lead@x.co', _elapsed: '5000' } });
    expect((await state()).deliveryState).toBe('pending');

    // SMTP is fixed; the next due pass carries the backlog out. `now` is pushed past the backoff
    // rather than waiting for it — the runner takes the clock as an argument for exactly this.
    const healthy = new FakeMailer();
    mailer.send = healthy.send.bind(healthy);
    const result = await app.runDueFormDeliveries({ now: () => Date.now() + 10 * 60_000 });
    expect(result).toMatchObject({ attempted: 1, sent: 1 });
    expect((await state()).deliveryState).toBe('sent');
    expect(healthy.sent[0]).toMatchObject({ recipient: 'sales@acme.com', replyTo: 'lead@x.co' });
  });

  it('★ resend requeues a submission and the next pass sends it', async () => {
    mailer.send = async () => { throw new Error('down'); };
    await app.inject({ method: 'POST', url: `/f/${projectId}/contact`, payload: { email: 'lead@x.co', _elapsed: '5000' } });
    const id = (await state()).id;

    const healthy = new FakeMailer();
    mailer.send = healthy.send.bind(healthy);
    const resend = await app.inject({ method: 'POST', url: `/projects/${projectId}/submissions/${id}/resend`, cookies: { sw_session: t } });
    expect(resend.statusCode).toBe(200);
    // Requeued to due-now, so it goes on the very next pass rather than after the backoff.
    expect((await app.runDueFormDeliveries()).sent).toBe(1);
    expect(healthy.sent).toHaveLength(1);
  });

  it('resend 404s for an unknown submission, and for one never owed an email', async () => {
    const missing = await app.inject({ method: 'POST', url: `/projects/${projectId}/submissions/nope/resend`, cookies: { sw_session: t } });
    expect(missing.statusCode).toBe(404);

    const repo = new SubmissionRepository(db);
    const s = await repo.create(projectId, 'contact', { email: 'x@y.z' }, { owesEmail: false });
    const notOwed = await app.inject({ method: 'POST', url: `/projects/${projectId}/submissions/${s.id}/resend`, cookies: { sw_session: t } });
    expect(notOwed.statusCode).toBe(404);
  });
});

describe('a submission is never emailed twice', () => {
  it('★ Resend during an in-flight first send does not produce a second delivery', async () => {
    // The exact reproduction: a fresh row is `pending` while the REQUEST is still sending it, and
    // that inline attempt holds no lease — `create()` holds the row back instead. Resend used to
    // clear that hold, so the next pass sent the message the request was in the middle of sending.
    let releaseSend: () => void = () => {};
    const inFlight = new Promise<void>((r) => { releaseSend = r; });
    let calls = 0;
    mailer.send = async () => {
      calls += 1;
      await inFlight; // the SMTP transaction is still open
      return true;
    };

    // Fire the submission WITHOUT awaiting: the handler is now blocked inside the transport.
    const posting = app.inject({ method: 'POST', url: `/f/${projectId}/contact`, payload: { email: 'lead@x.co', _elapsed: '5000' } });
    await waitFor(async () => (await db.select().from(formSubmissions)).length === 1);
    const [row] = await db.select().from(formSubmissions);
    expect(row!.deliveryState).toBe('pending'); // stored, owed, first attempt still running

    // An impatient operator clicks Resend on it.
    const resend = await app.inject({ method: 'POST', url: `/projects/${projectId}/submissions/${row!.id}/resend`, cookies: { sw_session: t } });
    expect(resend.statusCode).toBe(404); // refused: nothing has failed yet

    // A background pass must find nothing to do.
    expect((await app.runDueFormDeliveries()).attempted).toBe(0);

    releaseSend();
    await posting;
    expect(calls).toBe(1); // ONE send, to one customer
    const [after] = await db.select().from(formSubmissions);
    expect(after!.deliveryState).toBe('sent');
  }, 30_000);
});

/** Polls until `check` is true, so the test does not depend on a fixed sleep. */
async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - started > timeoutMs) throw new Error('condition never became true');
    await new Promise((r) => setTimeout(r, 10));
  }
}

