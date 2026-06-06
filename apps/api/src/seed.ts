import type { Database } from './db/client.js';
import { users } from './db/schema.js';
import { registerAccount } from './repo/accounts.js';
import { ProjectRepository } from './repo/projects.js';
import { ContentRepository } from './repo/content.js';
import { ProjectEventBus } from './events/bus.js';
import {
  EXAMPLE_IDENTITY,
  EXAMPLE_WEBSITE,
  EXAMPLE_PAGES,
  EXAMPLE_DATASETS,
  EXAMPLE_ENTRIES,
  EXAMPLE_FORMS,
} from './seed-data.js';

/** The built-in first-boot admin identity (override with SW_ADMIN_EMAIL). */
export const DEFAULT_ADMIN_EMAIL = 'admin@sitewright.example';
/**
 * The FIXED first-boot password (override with SW_ADMIN_PASSWORD). A deliberate,
 * documented product decision: the initial credentials are always the same and
 * never auto-generated, so a fresh instance is predictably reachable. The seed
 * warns loudly when this default is in use — change it after first login.
 */
export const DEFAULT_ADMIN_PASSWORD = '123456';

export interface SeedOptions {
  db: Database;
  /** The super-admin email (SW_ADMIN_EMAIL). Must also be in the instance-admin allowlist. */
  adminEmail: string;
  /** SW_ADMIN_PASSWORD; absent, empty, or whitespace-only → the FIXED default `123456` (warned about). */
  adminPassword?: string;
  /** Sink for the one-time bootstrap notices (defaults to stdout via the caller). */
  log?: (message: string) => void;
}

/**
 * First-boot bootstrap. When the instance has NO users yet, create the super-admin and a
 * showcase "Example Project". Because public registration is invitation-only, this is the ONLY
 * way the first admin is created. The credentials default to the well-known
 * `admin@sitewright.example` / `123456` (never auto-generated); SW_ADMIN_EMAIL /
 * SW_ADMIN_PASSWORD override them.
 *
 * Idempotent by design: it returns immediately once ANY user exists, so re-deploys never
 * re-seed and a demo project the admin deleted stays deleted.
 */
export async function seedInstance({ db, adminEmail, adminPassword, log = () => {} }: SeedOptions): Promise<void> {
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) return; // already bootstrapped — never re-seed

  // Trimmed: a whitespace-only env value must mean "use the default" (with the
  // warning), never an unguessable whitespace password that locks everyone out.
  const configured = adminPassword?.trim();
  const usingDefault = !configured;
  const password = configured || DEFAULT_ADMIN_PASSWORD;

  // The seeded super-admin holds the platform `admin` role (full access to every project +
  // instance settings); registration is otherwise invitation-only.
  const { userId } = await registerAccount(db, adminEmail, password, { platformRole: 'admin' });
  log(
    usingDefault
      ? `[sitewright/seed] WARNING: created admin "${adminEmail}" with the DEFAULT password ` +
          `"${DEFAULT_ADMIN_PASSWORD}" — anyone who can reach this instance can sign in with it. ` +
          `Change it after first login (or set SW_ADMIN_PASSWORD before first boot).`
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
  // CMS: dataset schemas + their entries (services / work / team / testimonials), then the
  // contact form, then the pages (which bind the datasets via `{{#each data.<slug>}}` and host the
  // Form block). Order doesn't matter for storage; an entry's `dataset` field (= the dataset slug)
  // keys the `data.*` namespace at build.
  for (const dataset of EXAMPLE_DATASETS) {
    await contentRepo.put(ctx, 'dataset', dataset.id, dataset);
  }
  for (const entry of EXAMPLE_ENTRIES) {
    await contentRepo.put(ctx, 'entry', entry.id, entry);
  }
  for (const form of EXAMPLE_FORMS) {
    await contentRepo.put(ctx, 'form', form.id, form);
  }
  for (const page of EXAMPLE_PAGES) {
    await contentRepo.put(ctx, 'page', page.id, page);
  }
  log(
    `[sitewright/seed] seeded "Example Project" (${EXAMPLE_PAGES.length} pages, ` +
      `${EXAMPLE_DATASETS.length} datasets, ${EXAMPLE_ENTRIES.length} entries, ${EXAMPLE_FORMS.length} form) ` +
      `— delete it from the editor once you've explored it.`,
  );
}
