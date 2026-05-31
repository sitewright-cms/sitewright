import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { makeTestDb } from './helpers.js';
import { InstanceSettingsRepository, EncryptionUnavailableError } from '../src/repo/instance-settings.js';
import type { Database } from '../src/db/client.js';

const KEY = randomBytes(32);

let db: Database;

beforeEach(async () => {
  db = await makeTestDb();
});

describe('InstanceSettingsRepository', () => {
  it('returns all-disabled form modes and no secrets before anything is set', async () => {
    const repo = new InstanceSettingsRepository(db, KEY);
    const pub = await repo.getPublic();
    expect(pub.formModes).toEqual({ globalSmtp: false, userSmtp: false, contactPhp: false, thirdParty: false });
    expect(pub.smtp).toBeUndefined();
    expect(pub.hcaptcha).toBeUndefined();
  });

  it('persists non-secret fields and a partial form-modes update', async () => {
    const repo = new InstanceSettingsRepository(db, KEY);
    await repo.put({ formModes: { globalSmtp: true }, hcaptcha: { siteKey: 'site-1' } });
    const pub = await repo.getPublic();
    expect(pub.formModes.globalSmtp).toBe(true);
    expect(pub.formModes.userSmtp).toBe(false); // untouched fields stay false
    expect(pub.hcaptcha).toEqual({ siteKey: 'site-1', hasSecret: false });
  });

  it('encrypts the SMTP password at rest and never exposes it via the public view', async () => {
    const repo = new InstanceSettingsRepository(db, KEY);
    await repo.put({
      smtp: { host: 'smtp.acme.com', port: 587, secure: false, user: 'mailer', fromEmail: 'no-reply@acme.com', password: 'hunter2' },
    });
    const pub = await repo.getPublic();
    expect(pub.smtp).toEqual({
      host: 'smtp.acme.com',
      port: 587,
      secure: false,
      user: 'mailer',
      fromEmail: 'no-reply@acme.com',
      hasPassword: true,
    });
    // round-trips on the server side
    expect(await repo.getSmtpPassword()).toBe('hunter2');
    // the ciphertext, not the plaintext, is what lands in the JSON column
    const stored = await repo.getStored();
    expect(JSON.stringify(stored)).not.toContain('hunter2');
  });

  it('retains the stored password when an SMTP edit omits it, and updates it when supplied', async () => {
    const repo = new InstanceSettingsRepository(db, KEY);
    await repo.put({ smtp: { host: 'smtp.acme.com', port: 587, secure: false, fromEmail: 'a@acme.com', password: 'first-pw' } });
    // Edit the host, leave password blank → keep the original password.
    await repo.put({ smtp: { host: 'smtp.new.com', port: 465, secure: true, fromEmail: 'a@acme.com' } });
    const pub = await repo.getPublic();
    expect(pub.smtp?.host).toBe('smtp.new.com');
    expect(pub.smtp?.hasPassword).toBe(true);
    expect(await repo.getSmtpPassword()).toBe('first-pw');
    // Supplying a new password replaces it.
    await repo.put({ smtp: { host: 'smtp.new.com', port: 465, secure: true, fromEmail: 'a@acme.com', password: 'second-pw' } });
    expect(await repo.getSmtpPassword()).toBe('second-pw');
  });

  it('clears a section on null and leaves it unchanged on undefined', async () => {
    const repo = new InstanceSettingsRepository(db, KEY);
    await repo.put({ smtp: { host: 'h', port: 25, secure: false, fromEmail: 'a@b.co', password: 'pw' }, hcaptcha: { siteKey: 's', secret: 'x' } });
    // A formModes-only update must not disturb smtp/hcaptcha (undefined = unchanged).
    await repo.put({ formModes: { thirdParty: true } });
    let pub = await repo.getPublic();
    expect(pub.smtp?.host).toBe('h');
    expect(pub.hcaptcha?.hasSecret).toBe(true);
    expect(pub.formModes.thirdParty).toBe(true);
    // Explicit null clears smtp.
    await repo.put({ smtp: null });
    pub = await repo.getPublic();
    expect(pub.smtp).toBeUndefined();
    expect(pub.hcaptcha?.siteKey).toBe('s'); // hcaptcha untouched
  });

  it('round-trips and decrypts the hCaptcha secret on the server side', async () => {
    const repo = new InstanceSettingsRepository(db, KEY);
    await repo.put({ hcaptcha: { siteKey: 'site-1', secret: 'hc-secret' } });
    expect(await repo.getHcaptchaSecret()).toBe('hc-secret');
  });

  it('refuses to store a secret when no encryption key is configured', async () => {
    const repo = new InstanceSettingsRepository(db); // no key
    // Non-secret fields are fine without a key.
    await expect(repo.put({ formModes: { globalSmtp: true } })).resolves.toBeDefined();
    await expect(repo.put({ hcaptcha: { siteKey: 's' } })).resolves.toBeDefined();
    // A plaintext secret has nowhere safe to go → fail loudly.
    await expect(
      repo.put({ smtp: { host: 'h', port: 25, secure: false, fromEmail: 'a@b.co', password: 'pw' } }),
    ).rejects.toBeInstanceOf(EncryptionUnavailableError);
  });
});
