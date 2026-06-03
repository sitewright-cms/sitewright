import { randomBytes } from 'node:crypto';
import type { Database } from './db/client.js';
import { users } from './db/schema.js';
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

  // The seeded super-admin holds the platform `admin` role (full access to every project +
  // instance settings); registration is otherwise invitation-only.
  const { userId } = await registerAccount(db, adminEmail, password, { platformRole: 'admin' });
  log(
    generated
      ? `[sitewright/seed] created admin "${adminEmail}" with a GENERATED password: ${password}\n` +
          `[sitewright/seed] ^ change it after first login (set SW_ADMIN_PASSWORD to choose your own).`
      : `[sitewright/seed] created admin "${adminEmail}".`,
  );

  // Seed the showcase project via the repos (same validation as the API). The admin is added as its
  // owner so the project list + member management behave exactly as a user-created project.
  const projects = new ProjectRepository(db);
  const contentRepo = new ContentRepository(db, new ProjectEventBus());
  // Atomic create + owner membership (same invariant as the API create route).
  const project = await projects.create({ name: 'Example Project', slug: 'example' }, userId);
  const ctx = { userId, projectId: project.id, role: 'owner' as const };

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
