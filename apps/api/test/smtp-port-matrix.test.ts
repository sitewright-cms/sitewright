import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import nodemailer from 'nodemailer';
import {
  GlobalSmtpMailer,
  buildTransportOptions,
  type MailTransport,
  type SubmissionMail,
  type TransportFactory,
} from '../src/mail/mailer.js';
import { makeCert, startFakeSmtp, type TestCert, type FakeSmtp } from './smtp-server.js';
import { phpAvailable, startPhpSite, submit, type PhpSite } from './php-smtp-harness.js';
import { renderContactPhp, renderPhpSmtpConfig } from '../src/publish/contact-php.js';
import type { Form, InstanceSettingsStored, SmtpStored } from '@sitewright/schema';

// The three ports a customer is ever told to use, on the ACTUAL port numbers, with the convention
// each one carries:
//
//   465  implicit TLS from the first byte      → credentials fine, the channel is already encrypted
//   587  submission; STARTTLS then AUTH        → credentials only after the upgrade
//    25  MTA; plain relay, or STARTTLS then AUTH
//
// Nothing in the delivery code branches on the port NUMBER — the decision comes from `secure` and
// from what the server advertises. That is the right design (a provider may put implicit TLS on
// anything), but it means the conventions above are a claim about behaviour that nothing checked.
// These tests bind the real ports and pin each convention, including the two mix-ups people
// actually make: 465 configured as if it were 587, and 587 configured as if it were 465.

const PORTS = { smtp: 25, submission: 587, implicitTls: 465 } as const;

/** Real ports need either root or a low `ip_unprivileged_port_start`; skip cleanly where we lack it. */
async function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

const opensslAvailable = (): boolean => {
  try {
    return spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
};

const PASSWORD = 's3cr3t-mailbox-pw';

// ★ Resolved at MODULE scope, before any describe body runs, so the suite can SKIP VISIBLY rather
// than pass vacuously. The first version gated inside each `it` with an early `return`, which
// Vitest reports as PASSED — so on an ordinary non-root runner (where ports below 1024 need
// CAP_NET_BIND_SERVICE) all fifteen cases would have gone green having asserted nothing, and the
// reporter output would be indistinguishable from a real run. A test that cannot run must say so.
const portsUsable = (await Promise.all(Object.values(PORTS).map(canBind))).every(Boolean);

const modes: InstanceSettingsStored['formModes'] = {
  globalSmtp: true, userSmtp: false, contactPhp: false, contactPhpSmtp: false, thirdParty: false,
  whatsapp: false,
};

const mail: SubmissionMail = {
  recipient: 'sales@acme.com', subject: 'New lead', formName: 'Contact', fields: { email: 'v@example.com' },
};

describe.skipIf(!opensslAvailable() || !portsUsable)('SMTP port conventions (25 / 465 / 587)', () => {
  let cert: TestCert;
  const servers: FakeSmtp[] = [];

  beforeAll(async () => {
    cert = await makeCert();
  });
  // A FIXED port cannot be left listening between cases the way an ephemeral one can — the next
  // case on the same port would get EADDRINUSE. Close after every test, not once at the end.
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });
  afterAll(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
    if (cert) await rm(cert.dir, { recursive: true, force: true });
  });

  async function server(port: number, options: Parameters<typeof startFakeSmtp>[0] = {}): Promise<FakeSmtp> {
    const s = await startFakeSmtp({ cert, bindPort: port, ...options });
    servers.push(s);
    return s;
  }

  const trusting: TransportFactory = (config) =>
    nodemailer.createTransport({
      ...buildTransportOptions(config),
      tls: { ca: cert.cert, servername: 'localhost' },
    } as Parameters<typeof nodemailer.createTransport>[0]) as unknown as MailTransport;

  function mailer(smtp: Partial<SmtpStored> & { port: number; secure: boolean }): GlobalSmtpMailer {
    const conf = { host: '127.0.0.1', user: 'apikey', fromEmail: 'no-reply@acme.com', ...smtp } as SmtpStored;
    return new GlobalSmtpMailer(
      { getStored: async () => ({ formModes: modes, smtp: conf }) as InstanceSettingsStored, getSmtpPassword: async () => PASSWORD },
      trusting,
    );
  }


  // -------------------------------------------------------------------------------------------
  // 465 — implicit TLS. Encrypted before the first byte, so AUTH PLAIN is fine immediately.
  // -------------------------------------------------------------------------------------------

  it('465 with implicit TLS: authenticates and delivers, never speaking plaintext', async () => {
    const srv = await server(PORTS.implicitTls, { implicitTls: true, requireAuth: true });
    expect(await mailer({ port: PORTS.implicitTls, secure: true, host: 'localhost' }).send(mail)).toBe(true);
    await srv.finished;
    expect(Buffer.from(srv.transcript.authPlain ?? '', 'base64').toString()).toBe(`\0apikey\0${PASSWORD}`);
    // There is no cleartext phase at all on 465 — the whole session is inside TLS from the start,
    // so the transcript carries no `[tls] ` prefix and nothing was ever exposed.
    expect(srv.transcript.upgraded).toBe(false); // no STARTTLS: it was never plaintext to begin with
    expect(srv.transcript.commands).toContain('<END-OF-DATA>');
  });

  it('465 configured as if it were 587 (secure off) fails fast instead of hanging', async () => {
    const srv = await server(PORTS.implicitTls, { implicitTls: true });
    const started = Date.now();
    await expect(mailer({ port: PORTS.implicitTls, secure: false, host: 'localhost' }).send(mail)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(srv.transcript.authPlain).toBeNull();
  }, 40_000);

  // -------------------------------------------------------------------------------------------
  // 587 — submission. Plaintext greeting, STARTTLS, then AUTH inside the upgrade.
  // -------------------------------------------------------------------------------------------

  it('587 upgrades with STARTTLS and only then authenticates', async () => {
    const srv = await server(PORTS.submission, { offerStartTls: true, requireAuth: true });
    expect(await mailer({ port: PORTS.submission, secure: false }).send(mail)).toBe(true);
    await srv.finished;
    expect(srv.transcript.upgraded).toBe(true);
    // The credential and the message are both on the TLS side; only EHLO/STARTTLS preceded it.
    expect(srv.transcript.commands.filter((c) => c.toUpperCase().includes('AUTH')).every((c) => c.startsWith('[tls] '))).toBe(true);
    expect(srv.transcript.commands).toContain('[tls] <END-OF-DATA>');
  });

  it('★ 587 that will not upgrade never sees the password', async () => {
    const srv = await server(PORTS.submission, { offerStartTls: false });
    await expect(mailer({ port: PORTS.submission, secure: false }).send(mail)).rejects.toThrow();
    expect(srv.transcript.authPlain).toBeNull();
    expect(srv.transcript.commands.some((c) => c.toUpperCase().includes('AUTH'))).toBe(false);
  });

  it('587 configured as if it were 465 (secure on) fails fast instead of hanging', async () => {
    const srv = await server(PORTS.submission, { offerStartTls: true });
    const started = Date.now();
    await expect(mailer({ port: PORTS.submission, secure: true }).send(mail)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(srv.transcript.commands).toEqual([]); // the handshake failed; no SMTP was ever spoken
  }, 40_000);

  // -------------------------------------------------------------------------------------------
  // 25 — MTA. Both shapes are legitimate here: an unauthenticated local relay in the clear, and
  // STARTTLS-then-AUTH. What is NOT legitimate is a password in the clear.
  // -------------------------------------------------------------------------------------------

  it('25 unauthenticated on loopback delivers in the clear — nothing to protect', async () => {
    const srv = await server(PORTS.smtp);
    const m = new GlobalSmtpMailer(
      {
        getStored: async () =>
          ({ formModes: modes, smtp: { host: '127.0.0.1', port: PORTS.smtp, secure: false, fromEmail: 'no-reply@acme.com' } }) as InstanceSettingsStored,
        getSmtpPassword: async () => null,
      },
      trusting,
    );
    expect(await m.send(mail)).toBe(true);
    await srv.finished;
    expect(srv.transcript.authPlain).toBeNull();
    expect(srv.transcript.commands).toContain('<END-OF-DATA>');
  });

  it('25 upgrades opportunistically when the relay does offer STARTTLS', async () => {
    // No credentials at stake, but if encryption is on the table it should be taken.
    const srv = await server(PORTS.smtp, { offerStartTls: true });
    const m = new GlobalSmtpMailer(
      {
        getStored: async () =>
          ({ formModes: modes, smtp: { host: '127.0.0.1', port: PORTS.smtp, secure: false, fromEmail: 'no-reply@acme.com' } }) as InstanceSettingsStored,
        getSmtpPassword: async () => null,
      },
      trusting,
    );
    expect(await m.send(mail)).toBe(true);
    await srv.finished;
    expect(srv.transcript.upgraded).toBe(true);
    expect(srv.transcript.commands).toContain('[tls] <END-OF-DATA>');
  });

  it('25 with credentials authenticates only after STARTTLS', async () => {
    const srv = await server(PORTS.smtp, { offerStartTls: true, requireAuth: true });
    expect(await mailer({ port: PORTS.smtp, secure: false }).send(mail)).toBe(true);
    await srv.finished;
    expect(srv.transcript.commands.filter((c) => c.toUpperCase().includes('AUTH')).every((c) => c.startsWith('[tls] '))).toBe(true);
  });

  it('★ 25 with credentials and no STARTTLS is refused, even on loopback', async () => {
    // The one rule that holds everywhere: a mailbox password never goes out unencrypted. Loopback
    // exempts the MESSAGE, never the credential.
    const srv = await server(PORTS.smtp, { offerStartTls: false });
    await expect(mailer({ port: PORTS.smtp, secure: false, host: '127.0.0.1' }).send(mail)).rejects.toThrow();
    expect(srv.transcript.authPlain).toBeNull();
    expect(srv.transcript.commands).not.toContain('DATA');
  });

  // -------------------------------------------------------------------------------------------
  // The rule the review found untested: a REMOTE host with no credentials still requires encryption
  // -------------------------------------------------------------------------------------------

  it('★ a non-loopback host with NO credentials still requires encryption', async () => {
    // `0.0.0.0` reaches the loopback listener but is not a loopback ADDRESS, which is exactly the
    // distinction the rule draws. Without this, "messages never travel unencrypted to a remote
    // host" was asserted only for the PHP client, never for the platform mailer.
    const srv = await server(PORTS.smtp, { offerStartTls: false });
    const m = new GlobalSmtpMailer(
      {
        getStored: async () =>
          ({ formModes: modes, smtp: { host: '0.0.0.0', port: PORTS.smtp, secure: false, fromEmail: 'no-reply@acme.com' } }) as InstanceSettingsStored,
        getSmtpPassword: async () => null,
      },
      trusting,
    );
    await expect(m.send(mail)).rejects.toThrow();
    expect(srv.transcript.commands).not.toContain('DATA');
    expect(srv.transcript.rawData).toEqual([]); // the submission never left the process
  });
});

// The SAME three ports for the OTHER SMTP client — the one that ends up on a customer's own host.
// It is a completely separate implementation (hand-rolled PHP, not nodemailer), so "the platform
// mailer handles 465" says nothing about what the exported contact.php does with it.
describe.skipIf(!opensslAvailable() || !phpAvailable() || !portsUsable)('contact.php on the same three ports', () => {
  let cert: TestCert;
  const servers: FakeSmtp[] = [];
  const sites: PhpSite[] = [];

  beforeAll(async () => {
    cert = await makeCert();
  });
  afterEach(async () => {
    await Promise.all(sites.splice(0).map((s) => s.stop()));
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });
  afterAll(async () => {
    if (cert) await rm(cert.dir, { recursive: true, force: true });
  });

  const form = (): Form => ({
    id: 'contact', name: 'Contact', fields: [{ name: 'email', label: 'Email', type: 'email', required: true }],
    submitLabel: 'Send', successMessage: 'ok', errorMessage: 'no', recipient: 'leads@acme.com',
    mode: 'contactPhpSmtp', captcha: false, pow: false,
  } as Form);

  /** Boots contact.php against a server on `port` and posts one submission. */
  async function deliver(port: number, opts: { smtp?: Parameters<typeof startFakeSmtp>[0]; conf?: Record<string, unknown> }) {
    const srv = await startFakeSmtp({ cert, bindPort: port, ...opts.smtp });
    servers.push(srv);
    const site = await startPhpSite(
      {
        'contact.php': renderContactPhp([form()]),
        'sw-mail.config.php': renderPhpSmtpConfig({
          host: '127.0.0.1', port, secure: false, user: 'apikey', password: PASSWORD,
          fromEmail: 'no-reply@acme.com', ...opts.conf,
        } as Parameters<typeof renderPhpSmtpConfig>[0]),
      },
      [`openssl.cafile=${cert.caFile}`],
    );
    sites.push(site);
    const res = await submit(site, { _form: 'contact', _elapsed: 5000, email: 'v@example.com' });
    await Promise.race([srv.finished, new Promise((r) => setTimeout(r, 1500))]);
    return { res, transcript: srv.transcript };
  }


  it('465: implicit TLS, credentials inside the encrypted channel', async () => {
    const { res, transcript } = await deliver(PORTS.implicitTls, {
      smtp: { implicitTls: true, requireAuth: true },
      conf: { secure: true },
    });
    expect(res.status).toBe(200);
    expect(Buffer.from(transcript.authPlain ?? '', 'base64').toString()).toBe(`\0apikey\0${PASSWORD}`);
    expect(transcript.upgraded).toBe(false); // encrypted from the first byte; no STARTTLS needed
  });

  it('587: STARTTLS first, then AUTH', async () => {
    const { res, transcript } = await deliver(PORTS.submission, { smtp: { offerStartTls: true, requireAuth: true } });
    expect(res.status).toBe(200);
    expect(transcript.upgraded).toBe(true);
    expect(transcript.commands.filter((c) => c.toUpperCase().includes('AUTH')).every((c) => c.startsWith('[tls] '))).toBe(true);
  });

  it('★ 587 that will not upgrade never sees the password', async () => {
    const { res, transcript } = await deliver(PORTS.submission, { smtp: { offerStartTls: false } });
    expect(res.status).toBe(502);
    expect(transcript.authPlain).toBeNull();
    expect(transcript.commands.some((c) => c.toUpperCase().includes('AUTH'))).toBe(false);
  });

  it('25: an unauthenticated loopback relay delivers in the clear', async () => {
    const { res, transcript } = await deliver(PORTS.smtp, { conf: { user: '', password: '' } });
    expect(res.status).toBe(200);
    expect(transcript.authPlain).toBeNull();
    expect(transcript.commands).toContain('<END-OF-DATA>');
  });

  it('★ 25 with credentials and no STARTTLS is refused, even on loopback', async () => {
    const { res, transcript } = await deliver(PORTS.smtp, { smtp: { offerStartTls: false } });
    expect(res.status).toBe(502);
    expect(transcript.authPlain).toBeNull();
    expect(transcript.commands).not.toContain('DATA');
  });
});

