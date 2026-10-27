import { describe, it, expect } from 'vitest';
import { describeDeliveryFailure, makeProjectMailSender, MailDeliveryError, platformMailMode, type SubmissionMail } from '../src/mail/mailer.js';

/**
 * THE sender for every mail the platform writes on a project's behalf (shop orders, payments, bookings).
 * The user's rule: a project with its own SMTP sends through it, so its customers hear from the business
 * and not from the platform. These tests pin the rule and the two kinds of "it did not send".
 */

const mail: SubmissionMail = { recipient: 'buyer@acme.test', subject: 'Your order', formName: 'order', fields: { body: 'x' } };

function harness(opts: {
  modes?: Partial<Record<'globalSmtp' | 'userSmtp', boolean>>;
  usable?: boolean;
  project?: boolean | Error;
  global?: boolean;
}) {
  const calls: string[] = [];
  const send = makeProjectMailSender({
    globalMailer: {
      send: async () => {
        calls.push('global');
        return opts.global ?? true;
      },
    },
    projectMailer: {
      send: async (projectId) => {
        calls.push(`project:${projectId}`);
        if (opts.project instanceof Error) throw opts.project;
        return opts.project ?? true;
      },
    },
    formModes: async () => opts.modes ?? { globalSmtp: true, userSmtp: true },
    projectSmtpUsable: async () => opts.usable ?? true,
  });
  return { calls, send };
}

describe('platformMailMode', () => {
  it('the project SMTP only when the instance allows it AND the project has one', () => {
    expect(platformMailMode({ globalSmtp: true, userSmtp: true }, true)).toBe('userSmtp');
    expect(platformMailMode({ globalSmtp: false, userSmtp: true }, true)).toBe('userSmtp');
    expect(platformMailMode({ globalSmtp: true, userSmtp: true }, false)).toBe('globalSmtp');
    expect(platformMailMode({ globalSmtp: true, userSmtp: false }, true)).toBe('globalSmtp');
    expect(platformMailMode({}, true)).toBe('globalSmtp');
  });
});

describe('makeProjectMailSender', () => {
  it('★ sends through the project SMTP when it has one, and nothing through global', async () => {
    const h = harness({});
    expect(await h.send('p1', mail)).toBe(true);
    expect(h.calls).toEqual(['project:p1']);
  });

  it('uses global SMTP when the project has none, or the instance does not allow per-project SMTP', async () => {
    const none = harness({ usable: false });
    expect(await none.send('p1', mail)).toBe(true);
    expect(none.calls).toEqual(['global']);
    const forbidden = harness({ modes: { globalSmtp: true, userSmtp: false } });
    expect(await forbidden.send('p1', mail)).toBe(true);
    expect(forbidden.calls).toEqual(['global']);
  });

  it('★ a project SMTP that CANNOT send (answers false) falls back to global SMTP', async () => {
    // e.g. its password no longer decrypts after a key rotation: the customer still gets the mail.
    const h = harness({ project: false });
    expect(await h.send('p1', mail)).toBe(true);
    expect(h.calls).toEqual(['project:p1', 'global']);
  });

  it('…unless the instance has no global SMTP to fall back to: undelivered, so retried', async () => {
    const h = harness({ project: false, modes: { globalSmtp: false, userSmtp: true } });
    expect(await h.send('p1', mail)).toBe(false);
    expect(h.calls).toEqual(['project:p1']);
  });

  it('★ a project SMTP that FAILED a delivery is retried as it is, never re-sent from another address', async () => {
    const h = harness({ project: new Error('550 mailbox unavailable') });
    const err = await h.send('p1', mail).catch((e: unknown) => e);
    expect(h.calls).toEqual(['project:p1']);
    // Tagged with the server that failed, so the stored reason can name it.
    expect(err).toBeInstanceOf(MailDeliveryError);
    expect(describeDeliveryFailure(err)).toBe('Project SMTP: The mail server rejected the recipient address.');
  });

  it('a global SMTP failure is named as such', async () => {
    const send = makeProjectMailSender({
      globalMailer: { send: async () => { throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:25'), { code: 'ECONNECTION' }); } },
      projectMailer: { send: async () => true },
      formModes: async () => ({ globalSmtp: true }),
      projectSmtpUsable: async () => false,
    });
    const err = await send('p1', mail).catch((e: unknown) => e);
    expect(describeDeliveryFailure(err)).toBe('Global SMTP: The mail server refused the connection. Check the host and port.');
  });

  it('decides on every send: a mode change or a new project SMTP applies to the next mail', async () => {
    let usable = false;
    const calls: string[] = [];
    const send = makeProjectMailSender({
      globalMailer: { send: async () => (calls.push('global'), true) },
      projectMailer: { send: async () => (calls.push('project'), true) },
      formModes: async () => ({ globalSmtp: true, userSmtp: true }),
      projectSmtpUsable: async () => usable,
    });
    await send('p1', mail);
    usable = true;
    await send('p1', mail);
    expect(calls).toEqual(['global', 'project']);
  });
});
