import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DEFAULT_FORM_MODES, type Form, type FormModes, type SmtpStored } from '@sitewright/schema';
import { encryptSecret } from '../src/crypto/secret.js';
import { PublishError } from '../src/publish/build.js';
import { writePhpSmtpConfig } from '../src/publish/php-smtp.js';
import { PHP_SMTP_CONFIG_FILE } from '../src/publish/contact-php.js';

// The gate in front of the ONLY artifact that carries a plaintext SMTP password. Every branch here
// is a refusal that must fail LOUD (PublishError → 409) rather than ship a form that cannot send —
// or, worse, ship the password somewhere it must never go.

const KEY = randomBytes(32);
const PASSWORD = 'hunter2-but-longer';

function form(over: Partial<Form> = {}): Form {
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

const smtpStored = (over: Partial<SmtpStored> = {}): SmtpStored => ({
  host: 'smtp.acme.com',
  port: 587,
  secure: false,
  user: 'mailer',
  fromEmail: 'no-reply@acme.com',
  fromName: 'Acme',
  password: encryptSecret(PASSWORD, KEY),
  ...over,
});

const modes = (over: Partial<FormModes> = {}): FormModes => ({ ...DEFAULT_FORM_MODES, contactPhpSmtp: true, ...over });

describe('writePhpSmtpConfig', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sw-phpsmtp-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const base = () => ({ dir, forms: [form()], protocol: 'sftp', formModes: modes(), smtp: smtpStored(), encryptionKey: KEY });

  it('writes the credentials file for an SFTP deploy, with the decrypted password', async () => {
    await writePhpSmtpConfig(base());
    const php = await readFile(join(dir, PHP_SMTP_CONFIG_FILE), 'utf8');
    expect(php).toContain(PASSWORD);
    expect(php).toContain('smtp.acme.com');
    expect(php).toContain("if (!defined('SW_CONTACT_MAILER'))"); // direct-hit guard
  });

  it('writes it 0600 — not world-readable while it sits in the build directory', async () => {
    await writePhpSmtpConfig(base());
    const mode = (await stat(join(dir, PHP_SMTP_CONFIG_FILE))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('does NOTHING when no form uses the SMTP mode (the common case stays untouched)', async () => {
    await writePhpSmtpConfig({ ...base(), forms: [form({ mode: 'contactPhp' }), form({ id: 'b', mode: 'globalSmtp' })] });
    expect(await readdir(dir)).toEqual([]);
  });

  it('★ REFUSES a git target — a password in a commit is permanent and replicated', async () => {
    await expect(writePhpSmtpConfig({ ...base(), protocol: 'git' })).rejects.toThrow(PublishError);
    await expect(writePhpSmtpConfig({ ...base(), protocol: 'git' })).rejects.toThrow(/Git repository/i);
    expect(await readdir(dir)).toEqual([]); // and nothing was written before the throw
  });

  it('refuses when the instance admin has not enabled the mode', async () => {
    await expect(
      writePhpSmtpConfig({ ...base(), formModes: modes({ contactPhpSmtp: false }) }),
    ).rejects.toThrow(/not enabled for this instance/i);
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses when the project has no SMTP configured, instead of shipping a dead form', async () => {
    await expect(writePhpSmtpConfig({ ...base(), smtp: null })).rejects.toThrow(/no SMTP server configured/i);
  });

  it('refuses when the server has no encryption key to read the stored password with', async () => {
    const noKey = { ...base(), encryptionKey: undefined };
    await expect(writePhpSmtpConfig(noKey)).rejects.toThrow(/no encryption key/i);
  });

  it('refuses when the stored password cannot be decrypted (rotated key)', async () => {
    await expect(writePhpSmtpConfig({ ...base(), encryptionKey: randomBytes(32) })).rejects.toThrow(/could not be decrypted/i);
    expect(await readdir(dir)).toEqual([]);
  });

  it('supports an SMTP config with no password at all (open relay on the customer LAN)', async () => {
    const rest = { ...smtpStored(), password: undefined };
    await writePhpSmtpConfig({ ...base(), smtp: rest as SmtpStored });
    const php = await readFile(join(dir, PHP_SMTP_CONFIG_FILE), 'utf8');
    expect(php).toContain('smtp.acme.com');
    expect(php).toContain('"pass":""');
  });

  it('escapes a password containing quotes/backslashes so the PHP literal cannot break out', async () => {
    const nasty = `a'b\\c"d`;
    await writePhpSmtpConfig({ ...base(), smtp: smtpStored({ password: encryptSecret(nasty, KEY) }) });
    const php = await readFile(join(dir, PHP_SMTP_CONFIG_FILE), 'utf8');
    // The single quote must be backslash-escaped for the surrounding PHP '...' literal.
    expect(php).toContain("a\\'b");
    // And there must be no unescaped quote that would terminate the literal early.
    expect(php).not.toMatch(/[^\\]'a/);
  });
});
