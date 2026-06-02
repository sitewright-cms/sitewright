import { randomBytes } from 'node:crypto';
import type { Database } from './db/client.js';
import { users, type OrgRole } from './db/schema.js';
import { registerAccount } from './repo/accounts.js';
import { ProjectRepository } from './repo/projects.js';
import { ContentRepository } from './repo/content.js';
import { ProjectEventBus } from './events/bus.js';
import { EXAMPLE_IDENTITY, EXAMPLE_WEBSITE, EXAMPLE_PAGES } from './seed-data.js';

export interface SeedOptions {
  db: Database;
  /** The super-admin email (SW_ADMIN_EMAIL). Must also be in the instance-admin allowlist. */
  adminEmail: string;
  /** SW_ADMIN_PASSWORD; if empty, a strong password is generated and logged once. */
  adminPassword?: string;
  /** Sink for the one-time bootstrap notices (defaults to stdout via the caller). */
  log?: (message: string) => void;
}

/**
 * First-boot bootstrap. When the instance has NO users yet, create the super-admin and a
 * showcase "Example Project". Because public registration is invitation-only, this is the ONLY
 * way the first admin is created — there is no default password baked in: SW_ADMIN_PASSWORD is
 * used as-is, or a strong one is generated and printed to the log once.
 *
 * Idempotent by design: it returns immediately once ANY user exists, so re-deploys never
 * re-seed and a demo project the admin deleted stays deleted.
 */
export async function seedInstance({ db, adminEmail, adminPassword, log = () => {} }: SeedOptions): Promise<void> {
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) return; // already bootstrapped — never re-seed

  const generated = !adminPassword;
  const password = adminPassword || randomBytes(12).toString('base64url');

  const { userId, orgId } = await registerAccount(db, adminEmail, password, 'Sitewright');
  log(
    generated
      ? `[sitewright/seed] created admin "${adminEmail}" with a GENERATED password: ${password}\n` +
          `[sitewright/seed] ^ change it after first login (set SW_ADMIN_PASSWORD to choose your own).`
      : `[sitewright/seed] created admin "${adminEmail}".`,
  );

  // Seed the showcase project via the repos (same validation/tenant-scoping as the API).
  const projects = new ProjectRepository(db);
  const contentRepo = new ContentRepository(db, new ProjectEventBus());
  const tenantCtx = { userId, orgId, role: 'owner' as OrgRole };
  const project = await projects.create(tenantCtx, { name: 'Example Project', slug: 'example' });
  const ctx = { ...tenantCtx, projectId: project.id };

  await contentRepo.put(ctx, 'settings', 'settings', {
    identity: EXAMPLE_IDENTITY,
    website: EXAMPLE_WEBSITE,
    settings: { defaultLocale: 'en', locales: ['en'] },
  });
  for (const page of EXAMPLE_PAGES) {
    await contentRepo.put(ctx, 'page', page.id, page);
  }
  log(`[sitewright/seed] seeded "Example Project" (${EXAMPLE_PAGES.length} pages) — delete it from the editor once you've explored it.`);
}
