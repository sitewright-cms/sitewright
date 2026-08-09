import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { migrateInstanceHcaptchaToProjects } from '../src/repo/captcha-migration.js';
import { InstanceSettingsRepository } from '../src/repo/instance-settings.js';
import { content, instanceSettings, projects, INSTANCE_SETTINGS_ID, PROJECT_CAPTCHA_ENTITY_ID } from '../src/db/schema.js';
import { encryptSecret } from '../src/crypto/secret.js';
import { newId } from '../src/id.js';
import type { Database } from '../src/db/client.js';

const KEY = randomBytes(32);
const SITE_KEY = '10000000-ffff-ffff-ffff-000000000001';

let db: Database;
let settings: InstanceSettingsRepository;

async function makeProject(name: string): Promise<string> {
  const id = randomUUID();
  await db.insert(projects).values({ id, name, slug: name, createdAt: new Date() });
  return id;
}

async function addForm(projectId: string, id: string, extra: Record<string, unknown>): Promise<void> {
  await db.insert(content).values({
    id: newId(),
    projectId,
    kind: 'form',
    entityId: id,
    scope: '',
    data: {
      id,
      name: 'Contact',
      fields: [{ name: 'email', label: 'Email', type: 'email', required: true }],
      recipient: 'a@b.co',
      submitLabel: 'Send',
      successMessage: 'Thanks',
      errorMessage: 'Oops',
      mode: 'globalSmtp',
      pow: false,
      ...extra,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}


/**
 * Seeds the LEGACY instance-wide hCaptcha directly, because that is the only way it can exist now:
 * the settings input schema no longer accepts one. This is exactly the state a real instance is in
 * after upgrading — a stored value written by an older version, with nothing able to write it again.
 */
async function seedLegacyHcaptcha(secret?: string): Promise<void> {
  const now = new Date();
  const data = {
    formModes: { globalSmtp: true, userSmtp: false, contactPhp: false, contactPhpSmtp: false, thirdParty: false },
    hcaptcha: { siteKey: SITE_KEY, ...(secret ? { secret: encryptSecret(secret, KEY) } : {}) },
  };
  await db
    .insert(instanceSettings)
    .values({ id: INSTANCE_SETTINGS_ID, data, updatedAt: now })
    .onConflictDoUpdate({ target: instanceSettings.id, set: { data, updatedAt: now } });
}

const captchaRow = async (projectId: string) =>
  (
    await db
      .select()
      .from(content)
      .where(and(eq(content.projectId, projectId), eq(content.kind, 'project_captcha'), eq(content.entityId, PROJECT_CAPTCHA_ENTITY_ID)))
  )[0];

beforeEach(async () => {
  db = await makeTestDb();
  settings = new InstanceSettingsRepository(db, KEY);
});

describe('instance hCaptcha → per-project captcha migration', () => {
  it('★ gives the config to exactly the projects that were USING it', async () => {
    // The instance key was in use by every project holding a captcha-enabled form. Copying it to
    // precisely those projects preserves current behaviour: the same sites keep the same working
    // captcha, and nothing else acquires credentials it never had. Copying to EVERY project would
    // hand a client's site a key belonging to someone else's account.
    const using = await makeProject('using');
    const notUsing = await makeProject('not-using');
    const noForms = await makeProject('no-forms');
    await addForm(using, 'contact', { hcaptcha: true });
    await addForm(notUsing, 'contact', { hcaptcha: false });
    await seedLegacyHcaptcha('hc-secret');

    const res = await migrateInstanceHcaptchaToProjects(db, settings);

    expect(res.moved).toEqual(['using']);
    expect((await captchaRow(using))?.data).toMatchObject({ provider: 'hcaptcha', siteKey: SITE_KEY });
    expect(await captchaRow(notUsing)).toBeUndefined();
    expect(await captchaRow(noForms)).toBeUndefined();
  });

  it('carries the ENCRYPTED secret across, so nobody has to re-enter it', async () => {
    const p = await makeProject('secret-mover');
    await addForm(p, 'contact', { hcaptcha: true });
    await seedLegacyHcaptcha('hc-secret');

    await migrateInstanceHcaptchaToProjects(db, settings);

    const moved = (await captchaRow(p))?.data as { secret?: { data: string } };
    expect(moved.secret).toBeDefined();
    // The envelope moved intact — same instance, same key — rather than being decrypted in transit.
    expect(JSON.stringify(moved)).not.toContain('hc-secret');
  });

  it('CLEARS the legacy value once it has been handed on, and is idempotent', async () => {
    const p = await makeProject('once');
    await addForm(p, 'contact', { hcaptcha: true });
    await seedLegacyHcaptcha('hc-secret');

    expect((await migrateInstanceHcaptchaToProjects(db, settings)).moved).toEqual(['once']);
    expect((await settings.getStored()).hcaptcha).toBeUndefined();
    // A second boot must not re-run or duplicate anything.
    expect((await migrateInstanceHcaptchaToProjects(db, settings)).moved).toEqual([]);
  });

  it('★ never overwrites a config the author already set', async () => {
    // Between the upgrade and the boot, an author may have entered their own key. Theirs wins:
    // clobbering it would silently repoint a live site at the agency's account.
    const p = await makeProject('has-own');
    await addForm(p, 'contact', { hcaptcha: true });
    await db.insert(content).values({
      id: newId(),
      projectId: p,
      kind: 'project_captcha',
      entityId: PROJECT_CAPTCHA_ENTITY_ID,
      scope: '',
      data: { provider: 'recaptcha-v3', siteKey: '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI' },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await seedLegacyHcaptcha('hc-secret');

    await migrateInstanceHcaptchaToProjects(db, settings);

    expect((await captchaRow(p))?.data).toMatchObject({ provider: 'recaptcha-v3' });
  });

  it('does nothing at all on an instance that never configured one', async () => {
    const p = await makeProject('clean');
    await addForm(p, 'contact', { hcaptcha: true });
    expect(await migrateInstanceHcaptchaToProjects(db, settings)).toEqual({ moved: [], cleared: false });
    expect(await captchaRow(p)).toBeUndefined();
  });

  it('still moves the SITE KEY when the stored secret cannot be decrypted', async () => {
    // A rotated SW_ENCRYPTION_KEY must not cost the whole configuration — one field to re-enter
    // beats losing the provider and key as well.
    const p = await makeProject('rotated');
    await addForm(p, 'contact', { hcaptcha: true });
    await seedLegacyHcaptcha('hc-secret');
    const rotated = new InstanceSettingsRepository(db, randomBytes(32));

    const res = await migrateInstanceHcaptchaToProjects(db, rotated);

    expect(res.moved).toEqual(['rotated']);
    expect((await captchaRow(p))?.data).toMatchObject({ siteKey: SITE_KEY });
  });
});
