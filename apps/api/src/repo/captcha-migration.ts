import { and, eq } from 'drizzle-orm';
import { CaptchaStoredSchema, FormSchema } from '@sitewright/schema';
import { newId } from '../id.js';
import type { Database } from '../db/client.js';
import { content, projects, PROJECT_CAPTCHA_ENTITY_ID } from '../db/schema.js';
import type { InstanceSettingsRepository } from './instance-settings.js';

/**
 * ONE-TIME MIGRATION: instance-wide hCaptcha → per-project captcha config.
 *
 * ★ WHICH PROJECTS GET IT, AND WHY THAT EXACT SET. The instance key was in use by every project
 * holding at least one captcha-enabled form — those forms were rendering that site key and verifying
 * against that secret. Copying it to precisely those projects PRESERVES current behaviour: the same
 * sites keep the same working captcha, and nothing else acquires credentials it never had.
 *
 * The two obvious alternatives are both worse. Copying to EVERY project hands a client's site a key
 * belonging to someone else's account. Dropping the config silently breaks live forms and gives the
 * operator no way to know which sites just lost their protection.
 *
 * Idempotent, and never destructive: a project that has already been given a config is left alone
 * (an author may have replaced the inherited key with their own), and the legacy value is cleared
 * only once every project that needed it has one — so an interrupted run resumes rather than loses.
 *
 * @returns the slugs that received the config, for the boot log.
 */
export async function migrateInstanceHcaptchaToProjects(
  db: Database,
  settings: InstanceSettingsRepository,
): Promise<{ moved: string[]; cleared: boolean }> {
  const legacy = await settings.getLegacyHcaptcha();
  if (!legacy) return { moved: [], cleared: false };

  // Encrypted at rest already — carry the ENVELOPE across rather than decrypting and re-encrypting.
  // Same instance, same key, so the ciphertext stays valid; and a secret that cannot be decrypted
  // (rotated key) still moves, leaving an author one field to re-enter instead of a lost config.
  const stored = await settings.getStored();
  const envelope = stored.hcaptcha?.secret;

  const formRows = await db
    .select({ projectId: content.projectId, data: content.data })
    .from(content)
    .where(eq(content.kind, 'form'));

  const needs = new Set<string>();
  for (const row of formRows) {
    const parsed = FormSchema.safeParse(row.data);
    // `captcha` reads a legacy `hcaptcha: true` through the schema's own shim, so this asks the
    // question in ONE place rather than re-deriving the legacy field name here.
    if (parsed.success && parsed.data.captcha) needs.add(row.projectId);
  }

  const moved: string[] = [];
  for (const projectId of needs) {
    const [existing] = await db
      .select({ id: content.id })
      .from(content)
      .where(and(eq(content.projectId, projectId), eq(content.kind, 'project_captcha'), eq(content.entityId, PROJECT_CAPTCHA_ENTITY_ID)));
    if (existing) continue; // already configured — never overwrite an author's own key

    const config = CaptchaStoredSchema.parse({
      provider: 'hcaptcha' as const,
      siteKey: legacy.siteKey,
      ...(envelope !== undefined ? { secret: envelope } : {}),
    });
    const now = new Date();
    // Raw insert, not `contentRepo.put`: this is a MECHANICAL migration with no acting user, and
    // `put` enforces authoring invariants + writes a revision on behalf of an actor that does not
    // exist here. `scope` is `''` for every project-global singleton kind (see the column's docs).
    await db.insert(content).values({
      id: newId(),
      projectId,
      kind: 'project_captcha',
      entityId: PROJECT_CAPTCHA_ENTITY_ID,
      scope: '',
      data: config,
      createdAt: now,
      updatedAt: now,
    });
    const [project] = await db.select({ slug: projects.slug }).from(projects).where(eq(projects.id, projectId));
    moved.push(project?.slug ?? projectId);
  }

  await settings.clearLegacyHcaptcha();
  return { moved, cleared: true };
}
