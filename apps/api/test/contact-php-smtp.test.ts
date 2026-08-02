import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import type { Form } from '@sitewright/schema';
import { renderContactPhp, renderPhpSmtpConfig, hasPhpSmtpForm, hasContactPhpForm } from '../src/publish/contact-php.js';
import {
  phpAvailable,
  makeCert,
  startFakeSmtp,
  startPhpSite,
  submit,
  type TestCert,
  type PhpSite,
  type FakeSmtp,
} from './php-smtp-harness.js';

function form(over: Partial<Form>): Form {
  return {
    id: 'contact',
    name: 'Contact',
    fields: [{ name: 'email', label: 'Email', type: 'email', required: true }],
    submitLabel: 'Send',
    successMessage: 'ok',
    errorMessage: 'no',
    recipient: 'leads@acme.com',
    mode: 'contactPhpSmtp',
    hcaptcha: false,
    ...over,
  } as Form;
}

const conf = (over: Record<string, unknown> = {}): string =>
  renderPhpSmtpConfig({
    host: '127.0.0.1',
    port: 0,
    secure: false,
    user: 'apikey',
    password: 's3cr3t',
    fromEmail: 'no-reply@acme.com',
    fromName: 'Acme Ltd',
    ...over,
  } as Parameters<typeof renderPhpSmtpConfig>[0]);

// ---- Pure generation (no PHP needed) --------------------------------------------------------

describe('contact.php SMTP mode — generation', () => {
  it('marks only contactPhpSmtp forms for SMTP, and still serves plain contactPhp from one file', () => {
    const php = renderContactPhp([
      form({ id: 'sales', mode: 'contactPhp', recipient: 'sales@acme.com' }),
      form({ id: 'careers', mode: 'contactPhpSmtp', recipient: 'hr@acme.com' }),
    ]);
    expect(php).toContain('"sales"');
    expect(php).toContain('"careers"');
    // The per-form flag is what routes each submission to mail() or SMTP.
    expect(php).toMatch(/"sales":\{[^}]*"smtp":false/);
    expect(php).toMatch(/"careers":\{[^}]*"smtp":true/);
    expect(php).toContain("!empty($cfg['smtp'])"); // dispatch
    expect(php).toContain('@mail($to, $subject, $body, $headers)'); // mail() path retained
  });

  it('omits the SMTP client entirely when no form needs it (no dead code in the export)', () => {
    const php = renderContactPhp([form({ mode: 'contactPhp' })]);
    expect(php).not.toContain('sw_smtp_send');
    expect(php).not.toContain('stream_socket_client');
  });

  it('never embeds credentials in contact.php — they live in the sibling config', () => {
    const php = renderContactPhp([form({ mode: 'contactPhpSmtp' })]);
    expect(php).not.toContain('s3cr3t');
    // No credential LITERAL: the only `pass` in the file is the client's own variable, read out
    // of the included config — never an assignment baked at publish time.
    expect(php).not.toMatch(/'pass'\s*=>/);
    expect(php).not.toMatch(/\$pass\s*=\s*'/);
    expect(php).toContain("include __DIR__ . '/sw-mail.config.php'");
  });

  it('hasPhpSmtpForm / hasContactPhpForm classify the two php modes correctly', () => {
    expect(hasContactPhpForm([form({ mode: 'contactPhp' })])).toBe(true);
    expect(hasContactPhpForm([form({ mode: 'contactPhpSmtp' })])).toBe(true);
    expect(hasContactPhpForm([form({ mode: 'globalSmtp' })])).toBe(false);
    expect(hasPhpSmtpForm([form({ mode: 'contactPhp' })])).toBe(false);
    expect(hasPhpSmtpForm([form({ mode: 'contactPhpSmtp' })])).toBe(true);
  });

  it('guards the config file so a direct request emits nothing', () => {
    expect(conf()).toContain("if (!defined('SW_CONTACT_MAILER')) { http_response_code(404); exit; }");
  });
});

// ---- Executed against a real PHP + a real SMTP dialogue -------------------------------------
//
// Skipped (not failed) where PHP is absent, so the suite stays portable; it runs here and on the
// GitHub runners, which ship PHP.

describe.skipIf(!phpAvailable())('contact.php SMTP mode — executed', () => {
  let cert: TestCert;
  const sites: PhpSite[] = [];
  const servers: FakeSmtp[] = [];

  beforeAll(async () => {
    cert = await makeCert();
  });
  afterAll(async () => {
    await Promise.all(sites.map((s) => s.stop()));
    await Promise.all(servers.map((s) => s.close()));
    if (cert) await rm(cert.dir, { recursive: true, force: true });
  });

  /** Boots a fake SMTP + a PHP site wired to it, and posts one submission. */
  async function run(opts: {
    smtp?: Parameters<typeof startFakeSmtp>[0];
    config?: Record<string, unknown>;
    /** Omit the config file entirely. */
    noConfig?: boolean;
    body?: Record<string, unknown>;
    forms?: Form[];
    trustCert?: boolean;
  }) {
    const server = await startFakeSmtp({ cert, ...opts.smtp });
    servers.push(server);
    const files: Record<string, string> = {
      'contact.php': renderContactPhp(opts.forms ?? [form({ mode: 'contactPhpSmtp' })]),
    };
    if (!opts.noConfig) files['sw-mail.config.php'] = conf({ port: server.port, ...opts.config });
    const site = await startPhpSite(files, opts.trustCert === false ? [] : [`openssl.cafile=${cert.caFile}`]);
    sites.push(site);
    const res = await submit(site, { _form: 'contact', _elapsed: 5000, email: 'jane@example.com', message: 'Hello', ...opts.body });
    // Give the dialogue a moment to finish/close either way.
    await Promise.race([server.finished, new Promise((r) => setTimeout(r, 1500))]);
    return { res, transcript: server.transcript };
  }

  it('delivers over an unauthenticated plaintext relay (no credentials to protect)', async () => {
    const { res, transcript } = await run({ config: { user: '', password: '' } });
    expect(res.status).toBe(200);
    expect(res.text).toContain('"ok":true');
    expect(transcript.commands).toEqual(
      expect.arrayContaining(['MAIL FROM:<no-reply@acme.com>', 'RCPT TO:<leads@acme.com>', 'DATA', '<END-OF-DATA>']),
    );
    expect(transcript.authPlain).toBeNull();
  });

  it('★ REFUSES to send credentials over an unencrypted channel — aborts before AUTH', async () => {
    // The server offers no STARTTLS, so the session can never be encrypted. An "opportunistic"
    // client would carry on and put the customer's mailbox password on the wire in the clear.
    const { res, transcript } = await run({ smtp: { offerStartTls: false } });
    expect(res.status).toBe(502);
    expect(transcript.authPlain).toBeNull();
    expect(transcript.commands.some((c) => c.toUpperCase().includes('AUTH'))).toBe(false);
    // It got as far as EHLO and then gave up — it did not silently fall back to mail() either.
    expect(transcript.commands.some((c) => c.startsWith('EHLO'))).toBe(true);
    expect(transcript.commands).not.toContain('DATA');
  });

  it('upgrades with STARTTLS and authenticates only inside the encrypted channel', async () => {
    const { res, transcript } = await run({ smtp: { offerStartTls: true } });
    expect(res.status).toBe(200);
    expect(transcript.upgraded).toBe(true);
    // AUTH, the envelope and the payload must ALL be on the TLS side of the transcript.
    expect(transcript.commands.filter((c) => c.toUpperCase().includes('AUTH')).every((c) => c.startsWith('[tls] '))).toBe(true);
    expect(transcript.commands).toContain('[tls] DATA');
    expect(Buffer.from(transcript.authPlain ?? '', 'base64').toString()).toBe('\0apikey\0s3cr3t');
  });

  it('★ REFUSES to upgrade when the server pre-seeds the plaintext buffer (STARTTLS injection)', async () => {
    // RFC 3207 §6: everything learned before the handshake must be discarded. PHP's stream layer
    // does NOT do that for us — fgets() over-reads past the "220" line into a userland buffer that
    // survives stream_socket_enable_crypto(), so bytes an on-path attacker appends to the 220 are
    // read back later as though they had arrived INSIDE the encrypted session. Here the injection
    // is a complete forged EHLO reply plus an "authentication accepted"; a client that trusts its
    // buffer would treat both as answers from the verified server.
    const { res, transcript } = await run({
      smtp: { offerStartTls: true, injectAfterStartTls: '250-forged\r\n250 HELP\r\n235 2.7.0 ok\r\n' },
    });
    expect(res.status).toBe(502);
    expect(transcript.authPlain).toBeNull();
    expect(transcript.commands.some((c) => c.toUpperCase().includes('AUTH'))).toBe(false);
    // It gave up BEFORE the handshake, so nothing was ever spoken inside the session.
    expect(transcript.commands.some((c) => c.startsWith('[tls] '))).toBe(false);
  });

  it('authenticates over implicit TLS (port-465 style)', async () => {
    const { res, transcript } = await run({ smtp: { implicitTls: true }, config: { secure: true } });
    expect(res.status).toBe(200);
    expect(Buffer.from(transcript.authPlain ?? '', 'base64').toString()).toBe('\0apikey\0s3cr3t');
  });

  it('★ verifies the TLS peer — an untrusted certificate aborts the send', async () => {
    // Same server, but PHP is NOT given the CA. If verify_peer were off (or the code passed
    // allow_self_signed), this would deliver and the test would fail.
    const { res, transcript } = await run({ smtp: { implicitTls: true }, config: { secure: true }, trustCert: false });
    expect(res.status).toBe(502);
    expect(transcript.commands).toEqual([]);
  });

  it('★ verifies the peer on the STARTTLS path too, not only on implicit TLS', async () => {
    // Worth its own case: implicit TLS is verified by stream_socket_client(), but a STARTTLS
    // upgrade is a SECOND handshake through stream_socket_enable_crypto(), and whether the
    // context's verify_peer carries into it is not obvious from reading the code. It does — the
    // upgrade fails against the untrusted test CA, so nothing is authenticated or sent.
    const { res, transcript } = await run({ smtp: { offerStartTls: true }, trustCert: false });
    expect(res.status).toBe(502);
    expect(transcript.authPlain).toBeNull();
    expect(transcript.commands).toContain('STARTTLS');
    expect(transcript.commands.some((c) => c.startsWith('[tls] '))).toBe(false);
    expect(transcript.commands.some((c) => c.toUpperCase().includes('AUTH'))).toBe(false);
  });

  it('fails CLOSED when the credentials file is missing — never falls back to mail()', async () => {
    const { res, transcript } = await run({ noConfig: true });
    expect(res.status).toBe(500);
    expect(transcript.commands).toEqual([]); // no connection attempted at all
  });

  it('reads a multi-line EHLO reply to its last line (a desync would break the envelope)', async () => {
    // The fake server always answers EHLO with four lines (250-…/250 HELP).
    const { res, transcript } = await run({ smtp: { offerStartTls: true } });
    expect(res.status).toBe(200);
    // MAIL FROM was accepted, which can only happen if the client resynchronised correctly.
    expect(transcript.commands).toContain('[tls] MAIL FROM:<no-reply@acme.com>');
  });

  it('surfaces an SMTP rejection as 502 rather than a false success', async () => {
    const { res } = await run({ smtp: { offerStartTls: true, rejectRecipient: true } });
    expect(res.status).toBe(502);
  });

  it('surfaces an auth failure as 502 (and tries LOGIN after PLAIN)', async () => {
    const { res, transcript } = await run({ smtp: { offerStartTls: true, rejectAuth: true } });
    expect(res.status).toBe(502);
    expect(transcript.commands).toContain('[tls] AUTH LOGIN'); // fallback attempted
  });

  it('builds a well-formed message: RFC 2047 subject, Reply-To, and DOT-STUFFED body', async () => {
    const { res, transcript } = await run({
      smtp: { offerStartTls: true },
      forms: [form({ mode: 'contactPhpSmtp', subject: 'Grüße von Ähren' })],
      // A submitted FIELD NAME of "." puts a bare dot at column 0 of the body (values are indented
      // two spaces by the formatter, so only a key can reach column 0 — and keys come straight from
      // the request JSON). Unstuffed, that line ENDS the DATA phase early and truncates the mail
      // (RFC 5321 §4.5.2), so this is both the escaping test and a hostile-input test.
      body: { '.': 'dot-key' },
    });
    expect(res.status).toBe(200);
    const data = transcript.rawData.join('\n');
    // Non-ASCII subject is base64 word-encoded, not raw 8-bit.
    expect(data).toContain(`Subject: =?UTF-8?B?${Buffer.from('Grüße von Ähren', 'utf8').toString('base64')}?=`);
    expect(data).toContain('Reply-To: jane@example.com');
    expect(data).toContain('From: Acme Ltd <no-reply@acme.com>');
    expect(data).toContain('To: leads@acme.com');
    expect(data).toMatch(/^Message-ID: <[0-9a-f]{32}@acme\.com>$/m);
    // The body line for that key is ".:" — on the wire it must arrive DOUBLED (".. :" → "..:"),
    // and no line may reach the server with a single leading dot.
    expect(transcript.rawData.some((l) => l.startsWith('..'))).toBe(true);
    expect(transcript.rawData.filter((l) => /^\.(?!\.)/.test(l))).toEqual([]);
  });

  it('keeps the bot filters: a honeypot hit is a silent 200 that never opens a socket', async () => {
    const { res, transcript } = await run({ smtp: { offerStartTls: true }, body: { _hpt: 'bot' } });
    expect(res.status).toBe(200);
    expect(res.text).toContain('"ok":true'); // indistinguishable from success, by design
    expect(transcript.commands).toEqual([]);
  });

  it('keeps the time-trap: an instant submit never opens a socket', async () => {
    const { res, transcript } = await run({ smtp: { offerStartTls: true }, body: { _elapsed: 10 } });
    expect(res.status).toBe(200);
    expect(transcript.commands).toEqual([]);
  });

  it('a mail()-mode form in the SAME file does not touch SMTP', async () => {
    const { res, transcript } = await run({
      forms: [form({ id: 'contact', mode: 'contactPhp' }), form({ id: 'other', mode: 'contactPhpSmtp' })],
      smtp: { offerStartTls: true },
    });
    // mail() has no MTA under the test server → 502, but crucially no SMTP dialogue happened.
    expect(res.status).toBe(502);
    expect(transcript.commands).toEqual([]);
  });

  it('★ the credentials file emits nothing when requested directly', async () => {
    const server = await startFakeSmtp({ cert });
    servers.push(server);
    const site = await startPhpSite({
      'contact.php': renderContactPhp([form({ mode: 'contactPhpSmtp' })]),
      'sw-mail.config.php': conf({ port: server.port }),
    });
    sites.push(site);
    const res = await fetch(`${site.base}/sw-mail.config.php`);
    const body = await res.text();
    expect(res.status).toBe(404);
    expect(body).toBe('');
    expect(body).not.toContain('s3cr3t');
  });

  it('the generated PHP parses under the real interpreter (both modes + the config)', async () => {
    const { spawnSync } = await import('node:child_process');
    const { writeFile, mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'sw-php-lint-'));
    const cases: Record<string, string> = {
      'mail.php': renderContactPhp([form({ mode: 'contactPhp' })]),
      'smtp.php': renderContactPhp([form({ mode: 'contactPhpSmtp' })]),
      // Nasty values that must survive JSON → PHP single-quote escaping.
      'tricky.php': renderContactPhp([form({ mode: 'contactPhpSmtp', name: "O'Brien \\ \"x\"", subject: "it's \\ 'quoted'" })]),
      'conf.php': renderPhpSmtpConfig({
        host: 'smtp.example.com', port: 587, secure: false,
        user: "us'er\\", password: "p'a\\ss\"w", fromEmail: 'a@b.com', fromName: "O'Brien \\",
      }),
    };
    for (const [name, php] of Object.entries(cases)) {
      const file = join(dir, name);
      await writeFile(file, php, 'utf8');
      const out = spawnSync('php', ['-l', file], { encoding: 'utf8' });
      expect(out.stdout + out.stderr, name).toContain('No syntax errors detected');
    }
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a password containing quotes and backslashes through the config file', async () => {
    const nasty = `p'a\\ss"w\`;`;
    const server = await startFakeSmtp({ cert, offerStartTls: true });
    servers.push(server);
    const site = await startPhpSite(
      {
        'contact.php': renderContactPhp([form({ mode: 'contactPhpSmtp' })]),
        'sw-mail.config.php': conf({ port: server.port, password: nasty }),
      },
      [`openssl.cafile=${cert.caFile}`],
    );
    sites.push(site);
    const res = await submit(site, { _form: 'contact', _elapsed: 5000, email: 'j@e.com' });
    expect(res.status).toBe(200);
    await Promise.race([server.finished, new Promise((r) => setTimeout(r, 1500))]);
    expect(Buffer.from(server.transcript.authPlain ?? '', 'base64').toString()).toBe(`\0apikey\0${nasty}`);
  });
});
