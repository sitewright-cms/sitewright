import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import nodemailer from 'nodemailer';
import { makeTestDb } from './helpers.js';
import {
  GlobalSmtpMailer,
  ProjectSmtpMailer,
  buildTransportOptions,
  verifySmtpConnection,
  sendSmtpTestMessage,
  type MailTransport,
  type SubmissionMail,
  type TransportFactory,
} from '../src/mail/mailer.js';
import { encryptSecret } from '../src/crypto/secret.js';
import { projects, content } from '../src/db/schema.js';
import type { Database } from '../src/db/client.js';
import type { InstanceSettingsStored, SmtpStored } from '@sitewright/schema';
import { makeCert, startFakeSmtp, type TestCert, type FakeSmtp, type FakeSmtpOptions } from './smtp-server.js';

// The platform's OWN mail path, over a real socket and a real SMTP dialogue.
//
// Everything else covering these two mailers injects a recording transport, so what was verified
// was "we hand nodemailer the right object" — never that a message leaves the process. nodemailer's
// own behaviour (TLS negotiation, AUTH, timeouts) sat entirely outside the test suite, which is
// exactly where a downgrade bug hides. Same scripted server the exported contact.php is held to,
// so both SMTP clients in this codebase answer to one standard.

const opensslAvailable = (): boolean => {
  try {
    return spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
};

const KEY = randomBytes(32);
const PASSWORD = 's3cr3t-mailbox-pw';

const modes = (over: Partial<InstanceSettingsStored['formModes']> = {}): InstanceSettingsStored['formModes'] => ({
  globalSmtp: false, userSmtp: false, contactPhp: false, contactPhpSmtp: false, thirdParty: false, whatsapp: false, ...over,
});

const mail: SubmissionMail = {
  recipient: 'sales@acme.com',
  subject: 'New lead',
  formName: 'Contact',
  fields: { email: 'visitor@example.com', message: 'line one\nline two' },
  replyTo: 'visitor@example.com',
};

describe.skipIf(!opensslAvailable())('mail delivery over a real SMTP dialogue', () => {
  let cert: TestCert;
  const servers: FakeSmtp[] = [];

  beforeAll(async () => { cert = await makeCert(); });
  afterAll(async () => {
    await Promise.all(servers.map((s) => s.close()));
    if (cert) await rm(cert.dir, { recursive: true, force: true });
  });

  async function server(options: FakeSmtpOptions = {}): Promise<FakeSmtp> {
    const s = await startFakeSmtp({ cert, ...options });
    servers.push(s);
    return s;
  }

  /**
   * The PRODUCTION transport, with the throwaway CA added so the test certificate verifies.
   * Everything else — requireTLS, the timeouts, auth — comes from `buildTransportOptions`, so a
   * change to the real options is a change to what these tests exercise.
   */
  const trustingFactory: TransportFactory = (config) =>
    nodemailer.createTransport({
      ...buildTransportOptions(config),
      tls: { ca: cert.cert, servername: 'localhost' },
    } as Parameters<typeof nodemailer.createTransport>[0]) as unknown as MailTransport;

  /** The production transport EXACTLY — no CA injected. Used where rejection is the assertion. */
  const productionFactory: TransportFactory = (config) =>
    nodemailer.createTransport(
      buildTransportOptions(config) as Parameters<typeof nodemailer.createTransport>[0],
    ) as unknown as MailTransport;

  function smtp(over: Partial<SmtpStored> & { port: number }): SmtpStored {
    return {
      host: '127.0.0.1',
      secure: false,
      user: 'apikey',
      fromEmail: 'no-reply@acme.com',
      fromName: 'Acme Ltd',
      ...over,
    } as SmtpStored;
  }

  /** A GlobalSmtpMailer wired to `srv`, using the production options. */
  function globalMailer(smtpConf: SmtpStored, factory: TransportFactory = trustingFactory): GlobalSmtpMailer {
    return new GlobalSmtpMailer(
      {
        getStored: async () => ({ formModes: modes({ globalSmtp: true }), smtp: smtpConf }) as InstanceSettingsStored,
        getSmtpPassword: async () => PASSWORD,
      },
      factory,
    );
  }

  // ---------------------------------------------------------------------------------------------
  // The three transports a customer actually configures
  // ---------------------------------------------------------------------------------------------

  it('globalSmtp delivers over STARTTLS, authenticating only inside the encrypted channel', async () => {
    const srv = await server({ offerStartTls: true, requireAuth: true });
    const ok = await globalMailer(smtp({ port: srv.port, secure: false })).send(mail);
    expect(ok).toBe(true);
    await srv.finished;

    expect(srv.transcript.upgraded).toBe(true);
    // Every AUTH line, the envelope and the payload must be on the TLS side of the transcript.
    expect(srv.transcript.commands.filter((c) => c.toUpperCase().includes('AUTH')).every((c) => c.startsWith('[tls] '))).toBe(true);
    expect(srv.transcript.commands).toContain('[tls] <END-OF-DATA>');
    expect(Buffer.from(srv.transcript.authPlain ?? '', 'base64').toString()).toBe(`\0apikey\0${PASSWORD}`);
  });

  it('globalSmtp delivers over implicit TLS (port-465 style)', async () => {
    const srv = await server({ implicitTls: true, requireAuth: true });
    const ok = await globalMailer(smtp({ port: srv.port, secure: true, host: 'localhost' })).send(mail);
    expect(ok).toBe(true);
    await srv.finished;
    expect(Buffer.from(srv.transcript.authPlain ?? '', 'base64').toString()).toBe(`\0apikey\0${PASSWORD}`);
    expect(srv.transcript.commands).toContain('<END-OF-DATA>');
  });

  it('globalSmtp delivers through an unauthenticated relay with no credentials to protect', async () => {
    const srv = await server();
    const conf = smtp({ port: srv.port, secure: false });
    delete (conf as { user?: string }).user;
    const mailer = new GlobalSmtpMailer(
      {
        getStored: async () => ({ formModes: modes({ globalSmtp: true }), smtp: conf }) as InstanceSettingsStored,
        getSmtpPassword: async () => null,
      },
      trustingFactory,
    );
    expect(await mailer.send(mail)).toBe(true);
    await srv.finished;
    expect(srv.transcript.authPlain).toBeNull();
    expect(srv.transcript.commands).toContain('<END-OF-DATA>');
  });

  // ---------------------------------------------------------------------------------------------
  // ★ The downgrade the recording transport could never have caught
  // ---------------------------------------------------------------------------------------------

  it('★ REFUSES to authenticate against a server that does not offer STARTTLS', async () => {
    // nodemailer's STARTTLS is OPPORTUNISTIC by default: strip the capability from the EHLO reply
    // and it carries on in the clear, putting the mailbox password on the wire. That is the same
    // attack the exported contact.php client refuses, and the platform mailer must refuse it too.
    const srv = await server({ offerStartTls: false });
    await expect(globalMailer(smtp({ port: srv.port, secure: false })).send(mail)).rejects.toThrow();
    expect(srv.transcript.authPlain).toBeNull();
    expect(srv.transcript.authLoginUser).toBeNull();
    expect(srv.transcript.commands.some((c) => c.toUpperCase().includes('AUTH'))).toBe(false);
    expect(srv.transcript.commands).not.toContain('DATA');
  });

  it('★ REJECTS an untrusted certificate on the STARTTLS path', async () => {
    const srv = await server({ offerStartTls: true });
    await expect(globalMailer(smtp({ port: srv.port, secure: false }), productionFactory).send(mail)).rejects.toThrow();
    expect(srv.transcript.authPlain).toBeNull();
    expect(srv.transcript.commands.some((c) => c.startsWith('[tls] '))).toBe(false);
  });

  it('★ REJECTS an untrusted certificate on implicit TLS', async () => {
    const srv = await server({ implicitTls: true });
    await expect(globalMailer(smtp({ port: srv.port, secure: true }), productionFactory).send(mail)).rejects.toThrow();
    expect(srv.transcript.commands).toEqual([]); // no session at all
  });

  // ---------------------------------------------------------------------------------------------
  // Misconfiguration: every one must fail FAST and LOUD, never hang the visitor's request
  // ---------------------------------------------------------------------------------------------

  it('fails fast when `secure` is on but the port speaks plaintext (a 587-as-465 mix-up)', async () => {
    const srv = await server({ offerStartTls: true });
    const started = Date.now();
    await expect(globalMailer(smtp({ port: srv.port, secure: true })).send(mail)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 30_000);

  it('fails fast when `secure` is off but the port serves implicit TLS (a 465-as-587 mix-up)', async () => {
    // The client speaks plaintext at a server expecting a handshake: nothing either side sends can
    // ever parse. Without a bounded timeout this is the classic hang.
    const srv = await server({ implicitTls: true });
    const started = Date.now();
    await expect(globalMailer(smtp({ port: srv.port, secure: false })).send(mail)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 40_000);

  it('fails fast on a connection refused (nothing listening on the port)', async () => {
    const srv = await server();
    await srv.close(); // free the port, then aim at it
    const started = Date.now();
    await expect(globalMailer(smtp({ port: srv.port, secure: false })).send(mail)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 30_000);

  it('surfaces an auth rejection as a thrown error rather than a silent success', async () => {
    const srv = await server({ offerStartTls: true, rejectAuth: true });
    await expect(globalMailer(smtp({ port: srv.port, secure: false })).send(mail)).rejects.toThrow();
    expect(srv.transcript.commands).not.toContain('[tls] DATA');
  });

  it('surfaces a rejected recipient rather than reporting the mail delivered', async () => {
    const srv = await server({ offerStartTls: true, rejectRecipient: true });
    await expect(globalMailer(smtp({ port: srv.port, secure: false })).send(mail)).rejects.toThrow();
    expect(srv.transcript.commands).not.toContain('[tls] <END-OF-DATA>');
  });

  // ---------------------------------------------------------------------------------------------
  // Name resolution
  // ---------------------------------------------------------------------------------------------

  it('resolves a HOSTNAME, not just a literal IP', async () => {
    const srv = await server({ offerStartTls: true });
    expect(await globalMailer(smtp({ port: srv.port, secure: false, host: 'localhost' })).send(mail)).toBe(true);
    await srv.finished;
    expect(srv.transcript.commands).toContain('[tls] <END-OF-DATA>');
  });

  it('delivers to an IPv6 literal, so a v6-only relay is reachable', async () => {
    // Measured, because the resolver path here surprises: nodemailer's family filter ignores
    // INTERNAL interfaces, so a hostname that resolves to ::1 is never tried on a box whose only
    // IPv6 interface is loopback. That is correct for production — an unroutable family should not
    // be attempted — but it means a hostname test cannot prove the v6 socket path works. A literal
    // skips resolution entirely and proves exactly that.
    const srv = await server({ offerStartTls: true, bindHost: '::1' });
    expect(await globalMailer(smtp({ port: srv.port, secure: false, host: '::1' })).send(mail)).toBe(true);
    await srv.finished;
    expect(srv.transcript.commands).toContain('[tls] <END-OF-DATA>');
  }, 30_000);

  it('fails fast and clearly on a host that does not resolve', async () => {
    const started = Date.now();
    await expect(
      globalMailer(smtp({ port: 587, secure: false, host: 'no-such-host.invalid' })).send(mail),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 30_000);

  // ---------------------------------------------------------------------------------------------
  // The message that actually arrives
  // ---------------------------------------------------------------------------------------------

  it('delivers a well-formed message: display name, Reply-To, and an indented multi-line field', async () => {
    const srv = await server({ offerStartTls: true, requireAuth: true });
    expect(await globalMailer(smtp({ port: srv.port, secure: false })).send(mail)).toBe(true);
    await srv.finished;
    const data = srv.transcript.rawData.join('\n');
    expect(data).toContain('From: Acme Ltd <no-reply@acme.com>');
    expect(data).toContain('To: sales@acme.com');
    expect(data).toContain('Reply-To: visitor@example.com');
    expect(data).toMatch(/^Subject: New lead$/m);
    // A value's own newline is indented so it cannot masquerade as the next field.
    expect(data).toContain('  line one');
    expect(data).toContain('  line two');
  });

  it('quotes a display name containing RFC 5322 specials', async () => {
    const srv = await server({ offerStartTls: true });
    const conf = smtp({ port: srv.port, secure: false, fromName: 'Acme, Inc. "The Best"' });
    expect(await globalMailer(conf).send(mail)).toBe(true);
    await srv.finished;
    const from = srv.transcript.rawData.find((l) => l.startsWith('From:')) ?? '';
    // However it encodes it, the comma must not be able to split the mailbox list.
    expect(from).toMatch(/^From: (".*"|=\?[^?]+\?[BQ]\?.*\?=) <no-reply@acme\.com>$/);
  });

  it('authenticates with AUTH LOGIN when that is the only mechanism offered', async () => {
    // nodemailer picks ONE mechanism from what the server advertises and does not try another after
    // a 535 — deliberately, since a second attempt against a real provider risks tripping a lockout
    // on what is usually just a wrong password. So the guarantee worth pinning is that BOTH
    // mechanisms work, not that one silently retries as the other.
    const srv = await server({ offerStartTls: true, requireAuth: true, authMechanisms: 'LOGIN' });
    expect(await globalMailer(smtp({ port: srv.port, secure: false })).send(mail)).toBe(true);
    await srv.finished;
    expect(srv.transcript.authPlain).toBeNull();
    expect(Buffer.from(srv.transcript.authLoginUser ?? '', 'base64').toString()).toBe('apikey');
    expect(Buffer.from(srv.transcript.authLoginPass ?? '', 'base64').toString()).toBe(PASSWORD);
    // …and the credentials still only ever appear inside the encrypted channel.
    expect(srv.transcript.commands.filter((c) => c.toUpperCase().includes('AUTH')).every((c) => c.startsWith('[tls] '))).toBe(true);
  });

  // ---------------------------------------------------------------------------------------------
  // The connection test an operator runs from the settings screen
  // ---------------------------------------------------------------------------------------------

  describe('verifySmtpConnection', () => {
    it('reports a healthy STARTTLS server as usable, without sending anything', async () => {
      const srv = await server({ offerStartTls: true, requireAuth: true });
      const res = await verifySmtpConnection(
        { host: '127.0.0.1', port: srv.port, secure: false, auth: { user: 'apikey', pass: PASSWORD } },
        trustingFactory,
      );
      expect(res).toEqual({ ok: true });
      await srv.finished;
      // It authenticated, but no message was ever handed over.
      expect(srv.transcript.authPlain).not.toBeNull();
      expect(srv.transcript.commands).not.toContain('[tls] DATA');
    });

    it('★ explains a server with no STARTTLS in terms an operator can act on', async () => {
      // This is the exact case the encryption requirement turns from "quietly insecure" into
      // "fails" — so the message has to name the cause and the fix, or the change just looks like
      // mail breaking for no reason.
      const srv = await server({ offerStartTls: false });
      const res = await verifySmtpConnection(
        { host: '127.0.0.1', port: srv.port, secure: false, auth: { user: 'apikey', pass: PASSWORD } },
        trustingFactory,
      );
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/does not offer STARTTLS/i);
      expect(res.error).toMatch(/587|465/); // tells them which port to try
      expect(srv.transcript.authPlain).toBeNull(); // and still no credentials on the wire
    });

    it('explains a rejected password without echoing it', async () => {
      const srv = await server({ offerStartTls: true, rejectAuth: true });
      const res = await verifySmtpConnection(
        { host: '127.0.0.1', port: srv.port, secure: false, auth: { user: 'apikey', pass: PASSWORD } },
        trustingFactory,
      );
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/rejected the username or password/i);
      expect(res.error).not.toContain(PASSWORD);
    });

    it('explains a name that does not resolve, and one that refuses the connection', async () => {
      const dead = await server();
      await dead.close();
      const refused = await verifySmtpConnection({ host: '127.0.0.1', port: dead.port, secure: false }, trustingFactory);
      expect(refused.ok).toBe(false);
      expect(refused.error).toMatch(/nothing accepted a connection/i);

      const unresolved = await verifySmtpConnection({ host: 'no-such-host.invalid', port: 587, secure: false }, trustingFactory);
      expect(unresolved.ok).toBe(false);
      expect(unresolved.error).toMatch(/could not be resolved/i);
    }, 30_000);

    it('never leaks the password or the server banner into the message', async () => {
      const srv = await server({ implicitTls: true });
      // Production factory: the test CA is untrusted, so this fails on the certificate.
      const res = await verifySmtpConnection(
        { host: '127.0.0.1', port: srv.port, secure: true, auth: { user: 'apikey', pass: PASSWORD } },
        productionFactory,
      );
      expect(res.ok).toBe(false);
      expect(res.error).not.toContain(PASSWORD);
      expect(res.error).not.toMatch(/fake ESMTP ready/);
    });
  });

  describe('sendSmtpTestMessage', () => {
    it('★ delivers a real message an operator can look for in their inbox', async () => {
      // The point of this over verify(): a login that succeeds proves nothing about whether mail
      // ARRIVES. Only a message that goes all the way through DATA exercises the sender address and
      // the recipient, and only one that lands in a human's inbox reveals an SPF/DKIM problem.
      const srv = await server({ offerStartTls: true, requireAuth: true });
      const res = await sendSmtpTestMessage(
        { host: '127.0.0.1', port: srv.port, secure: false, auth: { user: 'apikey', pass: PASSWORD } },
        { to: 'admin@acme.test', fromEmail: 'no-reply@acme.com', fromName: 'Acme Ltd', origin: 'the instance mail settings' },
        trustingFactory,
      );
      expect(res).toEqual({ ok: true });
      await srv.finished;
      const data = srv.transcript.rawData.join('\n');
      expect(srv.transcript.commands).toContain('[tls] RCPT TO:<admin@acme.test>');
      expect(data).toContain('From: Acme Ltd <no-reply@acme.com>');
      expect(data).toContain('Subject: Sitewright SMTP test');
      // The body has to tell the reader what receiving it proves, and where to look if it went to spam.
      expect(data).toMatch(/SPF/);
      expect(data).toContain('127.0.0.1');
    });

    it('reports a refused recipient instead of claiming the mail was sent', async () => {
      const srv = await server({ offerStartTls: true, rejectRecipient: true });
      const res = await sendSmtpTestMessage(
        { host: '127.0.0.1', port: srv.port, secure: false, auth: { user: 'apikey', pass: PASSWORD } },
        { to: 'nobody@acme.test', fromEmail: 'no-reply@acme.com', origin: 'x' },
        trustingFactory,
      );
      expect(res.ok).toBe(false);
      expect(res.error).toBeTruthy();
      expect(srv.transcript.commands).not.toContain('[tls] <END-OF-DATA>');
    });

    it('★ will not send a test message over an unencrypted remote session either', async () => {
      // The send path must obey the same rule as delivery — otherwise "test message" would be a
      // way to push a message out in the clear that a real submission would refuse to send.
      const srv = await server({ offerStartTls: false });
      const res = await sendSmtpTestMessage(
        { host: '0.0.0.0', port: srv.port, secure: false },
        { to: 'admin@acme.test', fromEmail: 'no-reply@acme.com', origin: 'x' },
        trustingFactory,
      );
      expect(res.ok).toBe(false);
      expect(srv.transcript.rawData).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // The same guarantees for the PROJECT mailer (`userSmtp`), which is a different code path
  // ---------------------------------------------------------------------------------------------

  describe('ProjectSmtpMailer (userSmtp)', () => {
    let db: Database;
    let projectId: string;

    beforeEach(async () => {
      db = await makeTestDb();
      projectId = randomUUID();
      await db.insert(projects).values({ id: projectId, name: 'P', slug: 'p', createdAt: new Date() });
    });

    async function seed(conf: SmtpStored): Promise<void> {
      const now = new Date();
      await db.insert(content).values({
        id: randomUUID(), projectId, kind: 'project_smtp', entityId: 'smtp', data: conf, createdAt: now, updatedAt: now,
      });
    }

    function projectMailer(factory: TransportFactory = trustingFactory): ProjectSmtpMailer {
      return new ProjectSmtpMailer(
        db,
        { getStored: async () => ({ formModes: modes({ userSmtp: true }) }) as InstanceSettingsStored },
        KEY,
        factory,
      );
    }

    it('delivers over STARTTLS with the DECRYPTED stored password', async () => {
      const srv = await server({ offerStartTls: true, requireAuth: true });
      await seed(smtp({ port: srv.port, secure: false, password: encryptSecret(PASSWORD, KEY) }));
      expect(await projectMailer().send(projectId, mail)).toBe(true);
      await srv.finished;
      // The decrypted secret must arrive intact — and only inside TLS.
      expect(Buffer.from(srv.transcript.authPlain ?? '', 'base64').toString()).toBe(`\0apikey\0${PASSWORD}`);
      expect(srv.transcript.commands.filter((c) => c.toUpperCase().includes('AUTH')).every((c) => c.startsWith('[tls] '))).toBe(true);
    });

    it('delivers over implicit TLS', async () => {
      const srv = await server({ implicitTls: true, requireAuth: true });
      await seed(smtp({ port: srv.port, secure: true, host: 'localhost', password: encryptSecret(PASSWORD, KEY) }));
      expect(await projectMailer().send(projectId, mail)).toBe(true);
      await srv.finished;
      expect(srv.transcript.commands).toContain('<END-OF-DATA>');
    });

    it('★ REFUSES to authenticate against a server that does not offer STARTTLS', async () => {
      const srv = await server({ offerStartTls: false });
      await seed(smtp({ port: srv.port, secure: false, password: encryptSecret(PASSWORD, KEY) }));
      await expect(projectMailer().send(projectId, mail)).rejects.toThrow();
      expect(srv.transcript.authPlain).toBeNull();
      expect(srv.transcript.commands.some((c) => c.toUpperCase().includes('AUTH'))).toBe(false);
    });

    it('★ REJECTS an untrusted certificate', async () => {
      const srv = await server({ offerStartTls: true });
      await seed(smtp({ port: srv.port, secure: false, password: encryptSecret(PASSWORD, KEY) }));
      await expect(projectMailer(productionFactory).send(projectId, mail)).rejects.toThrow();
      expect(srv.transcript.commands.some((c) => c.startsWith('[tls] '))).toBe(false);
    });
  });
});
