import { describe, it, expect, afterEach } from 'vitest';
import { HONEYPOT_FIELD, TIMETRAP_FIELD, type Form } from '@sitewright/schema';
import { renderContactPhp } from '../src/publish/contact-php.js';
import { phpAvailable, makeSendmailCapture, startPhpSite, submit, type PhpSite, type SendmailCapture } from './php-smtp-harness.js';

// The `contactPhp` mode — the exported handler delivering through the HOST's mail().
//
// This is the oldest export delivery mode and, until now, the only one whose delivery was never
// executed: a test box has no MTA, so mail() returned false and the single assertion available was
// the 502. Pointing PHP's `sendmail_path` at a capturing script makes the path real — the message
// is produced, handed to "sendmail", and read back here.

function form(over: Partial<Form> = {}): Form {
  return {
    id: 'contact',
    name: 'Contact',
    fields: [
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'message', label: 'Message', type: 'textarea', required: false },
    ],
    submitLabel: 'Send',
    successMessage: 'ok',
    errorMessage: 'no',
    recipient: 'leads@acme.com',
    mode: 'contactPhp',
    hcaptcha: false,
    ...over,
  } as Form;
}

describe.skipIf(!phpAvailable())('contact.php — host mail() delivery', () => {
  const sites: PhpSite[] = [];
  const captures: SendmailCapture[] = [];

  afterEach(async () => {
    await Promise.all(sites.splice(0).map((s) => s.stop()));
    await Promise.all(captures.splice(0).map((c) => c.cleanup()));
  });

  /** Serves a contact.php whose mail() is wired to a capturing sendmail, and posts one submission. */
  async function run(opts: { forms?: Form[]; body?: Record<string, unknown> } = {}) {
    const capture = await makeSendmailCapture();
    captures.push(capture);
    const site = await startPhpSite({ 'contact.php': renderContactPhp(opts.forms ?? [form()]) }, [capture.iniSetting]);
    sites.push(site);
    const res = await submit(site, { _form: 'contact', _elapsed: 5000, email: 'visitor@example.com', ...opts.body });
    return { res, eml: await capture.read() };
  }

  it('★ actually delivers: mail() succeeds and the message reaches sendmail', async () => {
    const { res, eml } = await run({ body: { message: 'hello there' } });
    expect(res.status).toBe(200);
    expect(res.text).toContain('"ok":true');
    // The recipient is baked SERVER-SIDE; it is never in the page, so this is the only place it appears.
    expect(eml).toContain('To: leads@acme.com');
    expect(eml).toContain('Subject: New "Contact" submission');
    expect(eml).toContain('visitor@example.com');
    expect(eml).toContain('hello there');
  });

  it('sets Reply-To to the submitter so a reply reaches them, not the site', async () => {
    const { eml } = await run();
    expect(eml).toMatch(/^Reply-To: visitor@example\.com$/m);
  });

  it('★ a CRLF in a field cannot inject a header', async () => {
    // The classic mail() injection: a submitted value carrying a newline plus a header of the
    // attacker's choosing, turning one message into a Bcc to anywhere.
    const { res, eml } = await run({ body: { message: 'hi\r\nBcc: attacker@evil.example\r\nX-Injected: yes' } });
    expect(res.status).toBe(200);
    expect(eml).not.toMatch(/^Bcc:/mi);
    expect(eml).not.toMatch(/^X-Injected:/mi);
  });

  it('★ a CRLF in the Reply-To candidate cannot inject a header either', async () => {
    const { eml } = await run({ body: { email: 'visitor@example.com\r\nBcc: attacker@evil.example' } });
    expect(eml).not.toMatch(/^Bcc:/mi);
  });

  it('routes by the hidden _form field when one file serves several forms', async () => {
    const { eml } = await run({
      forms: [form({ id: 'contact', recipient: 'first@acme.com' }), form({ id: 'other', recipient: 'second@acme.com' })],
    });
    expect(eml).toContain('To: first@acme.com');
    expect(eml).not.toContain('second@acme.com');
  });

  it('the bot filters still short-circuit before any mail is produced', async () => {
    // Field names come from the schema constants rather than being retyped here — a guess that does
    // not match simply looks like an ordinary submission, so the test would pass while proving the
    // opposite of what it claims. (It did, first time round: `website` is not the honeypot.)
    const honeypot = await run({ body: { [HONEYPOT_FIELD]: 'i am a bot' } });
    expect(honeypot.res.status).toBe(200); // a silent success, so the bot learns nothing
    expect(honeypot.eml).toBe('');

    const instant = await run({ body: { [TIMETRAP_FIELD]: 100 } });
    expect(instant.res.status).toBe(200);
    expect(instant.eml).toBe('');
  });

  it('rejects a submission naming a form the file does not serve', async () => {
    const capture = await makeSendmailCapture();
    captures.push(capture);
    const site = await startPhpSite({ 'contact.php': renderContactPhp([form()]) }, [capture.iniSetting]);
    sites.push(site);
    const res = await submit(site, { _form: 'nope', [TIMETRAP_FIELD]: 5000, email: 'a@b.co' });
    expect(res.status).toBe(404); // the file serves no such form — not a malformed request
    expect(await capture.read()).toBe('');
  });
});
