import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { projectMembers, formSubmissions } from '../src/db/schema.js';
import { MAX_SUBMISSIONS_PER_FORM } from '@sitewright/schema';
import { SubmissionRepository } from '../src/repo/submissions.js';
import type { Database } from '../src/db/client.js';
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
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email: 'owner@acme.test', password: 'pw-secret-1'},
  });
  t = token(reg);
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

  it('404s an unknown form and 400s a non-text (nested) value', async () => {
    expect((await app.inject({ method: 'POST', url: `/f/${projectId}/nope`, payload: { a: '1' } })).statusCode).toBe(404);
    const nested = await app.inject({
      method: 'POST',
      url: `/f/${projectId}/contact`,
      payload: { attachment: { bytes: 'AAAA' }, _elapsed: '5000' },
    });
    expect(nested.statusCode).toBe(400);
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
    for (let i = 0; i < rows.length; i += 5000) {
      await db.insert(formSubmissions).values(rows.slice(i, i + 5000));
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
    expect((res.json() as { formModes: Record<string, boolean> }).formModes).toEqual({
      globalSmtp: false,
      userSmtp: false,
      contactPhp: false,
      thirdParty: false,
    });
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
    const memberReg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'member@x.test', password: 'pw-secret-1'},
    });
    const memberT = token(memberReg);
    const memberUserId = (memberReg.json() as { userId: string }).userId;
    await db.insert(projectMembers).values({ id: randomUUID(), userId: memberUserId, projectId, role: 'member', createdAt: new Date() });

    const list = await app.inject({ method: 'GET', url: `/projects/${projectId}/submissions`, cookies: { sw_session: memberT } });
    expect(list.statusCode).toBe(200); // members can read
    const id = (list.json() as { items: Array<{ id: string }> }).items[0]!.id;
    const del = await app.inject({ method: 'DELETE', url: `/projects/${projectId}/submissions/${id}`, cookies: { sw_session: memberT } });
    expect(del.statusCode).toBe(204); // a member is now a writer and may delete
  });

  it('isolates a non-member from these submissions (403 project)', async () => {
    const other = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'other@x.test', password: 'pw-secret-1'},
    });
    const ot = token(other);
    // A user who holds no membership on this project cannot reach it over a session (403).
    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/submissions`,
      cookies: { sw_session: ot },
    });
    expect(res.statusCode).toBe(403);
  });
});
