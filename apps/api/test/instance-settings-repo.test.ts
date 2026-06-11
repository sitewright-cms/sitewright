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

  it('round-trips the allowSelfRegistration toggle (unset → set → keep on unrelated update)', async () => {
    const repo = new InstanceSettingsRepository(db, KEY);
    // Unset by default — the route, not the repo, supplies the factory fallback.
    expect((await repo.getStored()).allowSelfRegistration).toBeUndefined();
    expect((await repo.getPublic()).allowSelfRegistration).toBeUndefined();

    await repo.put({ allowSelfRegistration: true });
    expect((await repo.getPublic()).allowSelfRegistration).toBe(true);

    // An unrelated update (toggle absent) leaves it on.
    await repo.put({ formModes: { userSmtp: true } });
    expect((await repo.getPublic()).allowSelfRegistration).toBe(true);

    // Explicit false persists (and is distinguishable from "unset").
    await repo.put({ allowSelfRegistration: false });
    expect((await repo.getStored()).allowSelfRegistration).toBe(false);
  });

  it('round-trips the agent-instructions override (set → keep → clear → effective)', async () => {
    const repo = new InstanceSettingsRepository(db, KEY);
    const builtinDefault = await repo.getEffectiveAgentInstructions(); // no override yet → the default
    expect(builtinDefault.length).toBeGreaterThan(100);
    expect((await repo.getPublic()).agentInstructions).toBeUndefined();

    // Set an override.
    await repo.put({ agentInstructions: 'Be terse. Use the brand voice.' });
    expect((await repo.getPublic()).agentInstructions).toBe('Be terse. Use the brand voice.');
    expect(await repo.getEffectiveAgentInstructions()).toBe('Be terse. Use the brand voice.');

    // An unrelated update (undefined) keeps the override.
    await repo.put({ formModes: { userSmtp: true } });
    expect((await repo.getPublic()).agentInstructions).toBe('Be terse. Use the brand voice.');

    // null clears it → revert to the built-in default.
    await repo.put({ agentInstructions: null });
    expect((await repo.getPublic()).agentInstructions).toBeUndefined();
    expect(await repo.getEffectiveAgentInstructions()).toBe(builtinDefault);

    // An empty-string override is rejected (min length 1) — clearing is done with null, not '' —
    // so an agent can never be served a blank system prompt.
    await expect(repo.put({ agentInstructions: '' })).rejects.toThrow();
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

describe('agent session cap', () => {
  it('defaults to 8h and is admin-configurable (null reverts to the default)', async () => {
    const repo = new InstanceSettingsRepository(db, KEY);
    expect(await repo.getAgentSessionMs()).toBe(8 * 60 * 60 * 1000);
    const pub = await repo.put({ agentSessionHours: 24 });
    expect(pub.agentSessionHours).toBe(24);
    expect(await repo.getAgentSessionMs()).toBe(24 * 60 * 60 * 1000);
    await repo.put({ agentSessionHours: null }); // clear → back to default
    expect(await repo.getAgentSessionMs()).toBe(8 * 60 * 60 * 1000);
    expect((await repo.getPublic()).agentSessionHours).toBeUndefined();
  });
});

describe('branding', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  it('defaults the name and reports no logo before anything is set', async () => {
    const repo = new InstanceSettingsRepository(db, KEY);
    expect(await repo.getPlatformName()).toBe('SiteWright');
    expect(await repo.getLogo()).toBeNull();
    const { stored, updatedAtMs } = await repo.getStoredWithUpdatedAt();
    expect(stored.platformName).toBeUndefined();
    expect(updatedAtMs).toBe(0); // never written
  });

  it('round-trips name + colors + logo; the public view masks the bytes to hasLogo', async () => {
    const repo = new InstanceSettingsRepository(db, KEY);
    await repo.put({ platformName: 'Acme CMS', brandPrimary: '#ff0066', brandSecondary: '#00ddaa', platformLogo: { mime: 'image/png', data: PNG } });

    expect(await repo.getPlatformName()).toBe('Acme CMS');
    expect(await repo.getLogo()).toEqual({ mime: 'image/png', data: PNG });
    const { stored, updatedAtMs } = await repo.getStoredWithUpdatedAt();
    expect(stored.brandPrimary).toBe('#ff0066');
    expect(updatedAtMs).toBeGreaterThan(0); // mtime advances on write (drives the logo cache-buster)

    const pub = await repo.getPublic();
    expect(pub).toMatchObject({ platformName: 'Acme CMS', brandPrimary: '#ff0066', hasLogo: true });
    expect(JSON.stringify(pub)).not.toContain(PNG); // bytes never in the masked view
  });

  it('clears each branding field on null (revert to default) and keeps it on an unrelated update', async () => {
    const repo = new InstanceSettingsRepository(db, KEY);
    await repo.put({ platformName: 'Acme', platformLogo: { mime: 'image/png', data: PNG } });
    await repo.put({ formModes: { globalSmtp: true } }); // unrelated → branding preserved
    expect(await repo.getPlatformName()).toBe('Acme');
    expect(await repo.getLogo()).not.toBeNull();

    await repo.put({ platformName: null, platformLogo: null });
    expect(await repo.getPlatformName()).toBe('SiteWright');
    expect(await repo.getLogo()).toBeNull();
  });
});
