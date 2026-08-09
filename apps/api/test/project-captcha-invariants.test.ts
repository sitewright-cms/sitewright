import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { ContentRepository, schemaFor } from '../src/repo/content.js';
import { InstanceSettingsRepository } from '../src/repo/instance-settings.js';
import { migrateInstanceHcaptchaToProjects } from '../src/repo/captcha-migration.js';
import { registerAccount } from '../src/repo/accounts.js';
import { RevisionsRepository } from '../src/repo/revisions.js';
import { content, contentRevisions, instanceSettings, INSTANCE_SETTINGS_ID, PROJECT_CAPTCHA_ENTITY_ID } from '../src/db/schema.js';
import { encryptSecret } from '../src/crypto/secret.js';
import type { Database } from '../src/db/client.js';
import type { ProjectContext } from '../src/repo/context.js';

/**
 * ROW-LEVEL INVARIANTS for the per-project captcha config.
 *
 * It is a `content` row like any other, which is what makes most of this free — but "free" is a claim
 * worth testing rather than asserting, because the ways a slug-keyed store goes wrong on this platform
 * are known and specific: a row stranded under a stale scope, a project that cannot be purged because
 * something holds a foreign key, a duplicate written because two writers disagreed about the scope
 * value, or a secret riding along into a copy where it does not belong.
 */

const ENC_KEY = randomBytes(32);
const SITE_KEY = '10000000-ffff-ffff-ffff-000000000001';

let db: Database;
let projects: ProjectRepository;
let contentRepo: ContentRepository;
let userId: string;

const ctxFor = (projectId: string): ProjectContext => ({ userId, projectId, role: 'owner', actor: 'user' });

const rows = async (projectId: string) =>
  db.select().from(content).where(and(eq(content.projectId, projectId), eq(content.kind, 'project_captcha')));

const allCaptchaRows = async () => db.select().from(content).where(eq(content.kind, 'project_captcha'));

async function makeProject(slug: string) {
  return projects.create({ name: slug, slug }, userId);
}

async function saveCaptcha(projectId: string, over: Record<string, unknown> = {}) {
  return contentRepo.put(ctxFor(projectId), 'project_captcha', PROJECT_CAPTCHA_ENTITY_ID, {
    provider: 'hcaptcha',
    siteKey: SITE_KEY,
    secret: encryptSecret('vendor-secret', ENC_KEY),
    ...over,
  });
}

beforeEach(async () => {
  db = await makeTestDb();
  projects = new ProjectRepository(db);
  // ★ WITH a revisions repo: without one, `recordRevision` returns early and the "writes no
  // revision" assertion below would be vacuously green for every kind.
  contentRepo = new ContentRepository(db, undefined, new RevisionsRepository(db));
  ({ userId } = await registerAccount(db, 'owner@test.example', 'Correct-Horse-9!'));
});

describe('project captcha — row invariants', () => {
  it('writes exactly ONE row, and re-saving updates it rather than adding another', async () => {
    const p = await makeProject('one-row');
    await saveCaptcha(p.id);
    await saveCaptcha(p.id, { provider: 'recaptcha-v2', siteKey: '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI' });
    const found = await rows(p.id);
    expect(found).toHaveLength(1);
    expect((found[0]!.data as { provider: string }).provider).toBe('recaptcha-v2');
  });

  it('★ the MIGRATION and the normal write path agree on the scope, so neither duplicates the other', async () => {
    // The migration inserts raw (no acting user, no revision) while the editor goes through the repo.
    // If the two disagreed about `scope` — `''` for every project-global singleton — the unique key
    // would not match and a project would quietly end up holding two captcha configs, with whichever
    // one a given reader happened to pick winning.
    const p = await makeProject('scope-agree');
    await contentRepo.put(ctxFor(p.id), 'form', 'contact', {
      id: 'contact',
      name: 'Contact',
      fields: [{ name: 'email', label: 'Email', type: 'email', required: true }],
      recipient: 'a@b.co',
      captcha: true,
    });
    const now = new Date();
    await db
      .insert(instanceSettings)
      .values({
        id: INSTANCE_SETTINGS_ID,
        data: {
          formModes: { globalSmtp: true, userSmtp: false, contactPhp: false, contactPhpSmtp: false, thirdParty: false },
          hcaptcha: { siteKey: SITE_KEY, secret: encryptSecret('legacy', ENC_KEY) },
        },
        updatedAt: now,
      })
      .onConflictDoUpdate({ target: instanceSettings.id, set: { data: {}, updatedAt: now } });

    await migrateInstanceHcaptchaToProjects(db, new InstanceSettingsRepository(db, ENC_KEY));
    expect(await rows(p.id)).toHaveLength(1);

    // …and the editor's own save lands on the SAME row.
    await saveCaptcha(p.id, { provider: 'recaptcha-v3', siteKey: '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI' });
    const after = await rows(p.id);
    expect(after).toHaveLength(1);
    expect((after[0]!.data as { provider: string }).provider).toBe('recaptcha-v3');
  });

  it('★ REAP leaves nothing behind — a captcha config cannot make a project un-purgeable', async () => {
    // The FK-graph guard in project-reap.test.ts names any table referencing `projects` that remove()
    // forgets, and `form_filtered` proved that guard earns its keep. A captcha config lives in
    // `content`, which remove() already clears — this asserts that rather than assuming it.
    const p = await makeProject('reap-me');
    await saveCaptcha(p.id);
    expect(await rows(p.id)).toHaveLength(1);

    await expect(projects.remove(p.id)).resolves.toBeUndefined();
    expect(await rows(p.id)).toHaveLength(0);
    expect(await allCaptchaRows()).toHaveLength(0); // not merely unreachable — GONE
  });

  it('★ survives a SLUG RENAME intact — it is not keyed by the slug, and the media rewrite must not touch it', async () => {
    // A rename rewrites `/media/<slug>/` across every content row of the project with a raw string
    // replace. The captcha row holds base64 ciphertext, so this checks the rewrite leaves it
    // byte-identical: a corrupted envelope would fail to decrypt later, silently, and only when a
    // visitor submitted a form.
    const p = await makeProject('before-rename');
    await saveCaptcha(p.id);
    const before = (await rows(p.id))[0]!.data;

    await db.transaction(async (tx) => {
      await contentRepo.rewriteMediaSlug(ctxFor(p.id), 'before-rename', 'after-rename', tx as never);
      await projects.rename(p.id, { slug: 'after-rename' }, tx as never);
    });

    const after = await rows(p.id);
    expect(after).toHaveLength(1);
    expect(after[0]!.data).toEqual(before); // the secret envelope is untouched
    expect((await projects.get(p.id)).slug).toBe('after-rename');
  });

  it('survives soft-delete and restore', async () => {
    const p = await makeProject('soft');
    await saveCaptcha(p.id);
    await projects.softDelete(p.id, userId);
    expect(await rows(p.id)).toHaveLength(1); // soft-delete keeps every row for a restore
    await projects.restore(p.id);
    const found = await rows(p.id);
    expect(found).toHaveLength(1);
    expect((found[0]!.data as { siteKey: string }).siteKey).toBe(SITE_KEY);
  });

  it('★ is NOT carried into a project DUPLICATE — a copy must not inherit someone else’s credentials', async () => {
    // The export bundle is an allow-list of kinds, and duplicate runs through it. A duplicate is a
    // different site on a different domain, so it needs its own key; inheriting one would point a new
    // client's forms at another client's provider account.
    const src = await makeProject('src');
    await saveCaptcha(src.id);
    const bundle = await contentRepo.assembleExportBundle(ctxFor(src.id), src);

    expect(JSON.stringify(bundle)).not.toContain(SITE_KEY);
    expect(JSON.stringify(bundle)).not.toContain('project_captcha');

    const copy = await makeProject('copy');
    await contentRepo.importBundle(ctxFor(copy.id), copy, bundle);
    expect(await rows(copy.id)).toHaveLength(0);
  });

  it('is TENANT-scoped: one project’s config is invisible to another', async () => {
    const a = await makeProject('tenant-a');
    const b = await makeProject('tenant-b');
    await saveCaptcha(a.id);
    expect(await rows(b.id)).toHaveLength(0);
    expect(await contentRepo.list(ctxFor(b.id), 'project_captcha')).toHaveLength(0);
  });

  it('parses against its kind schema, so the integrity check reads it as healthy', async () => {
    // Integrity check #3 validates every stored row against `schemaFor(kind)`. A kind registered
    // without a schema — or with one its own writer cannot satisfy — reports the whole project as
    // corrupt, which is how a silent misregistration would surface.
    const p = await makeProject('integrity');
    await saveCaptcha(p.id);
    const row = (await rows(p.id))[0]!;
    expect(schemaFor('project_captcha').safeParse(row.data).success).toBe(true);
  });

  it('★ writes NO revision — a secret must never enter version history', async () => {
    // Revision history is readable, restorable and exportable; an encrypted envelope in it outlives
    // every rotation and every "delete the config" the author performs.
    const p = await makeProject('no-history');
    await saveCaptcha(p.id);
    await saveCaptcha(p.id, { siteKey: '10000000-ffff-ffff-ffff-000000000002' }); // a second write, too

    // Counted straight off the table: a helper that does not exist would make this vacuously green,
    // which is the exact failure mode this whole file is guarding against.
    const history = await db
      .select()
      .from(contentRevisions)
      .where(and(eq(contentRevisions.projectId, p.id), eq(contentRevisions.kind, 'project_captcha')));
    expect(history).toHaveLength(0);

    // …and the control: an ordinary kind DOES get history, so the assertion above is measuring
    // something real rather than a revisions table that is empty for everyone.
    await contentRepo.put(ctxFor(p.id), 'page', 'home', { id: 'home', path: '', title: 'Home', source: '<p>hi</p>' });
    const pageHistory = await db
      .select()
      .from(contentRevisions)
      .where(and(eq(contentRevisions.projectId, p.id), eq(contentRevisions.kind, 'page')));
    expect(pageHistory.length).toBeGreaterThan(0);
  });
});
