import type { Database } from './db/client.js';
import { users } from './db/schema.js';
import { registerAccount } from './repo/accounts.js';
import { ContentRepository } from './repo/content.js';
import { ProjectEventBus } from './events/bus.js';
import { importSeedBundle, listSeedBundles } from './seed-bundle.js';

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
  /** The super-admin email (SW_ADMIN_EMAIL). The seeded user gets a persisted `platform_role='admin'`
   *  (admin is a role now, not an env email allowlist). */
  adminEmail: string;
  /** SW_ADMIN_PASSWORD; absent, empty, or whitespace-only → the FIXED default `123456` (warned about). */
  adminPassword?: string;
  /** Media storage root (MEDIA_ROOT). When set, the bundle's media binaries (images + the self-hosted
   *  webfont) are restored into the media library; absent (e.g. in unit tests) → the content imports
   *  without binaries. */
  mediaRoot?: string;
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
export async function seedInstance({ db, adminEmail, adminPassword, mediaRoot, log = () => {} }: SeedOptions): Promise<void> {
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) return; // already bootstrapped — never re-seed

  // Trimmed: a whitespace-only env value must mean "use the default" (with the
  // warning), never an unguessable whitespace password that locks everyone out.
  const configured = adminPassword?.trim();
  const usingDefault = !configured;
  const password = configured || DEFAULT_ADMIN_PASSWORD;

  // The seeded super-admin holds the platform `admin` role (full access to every project +
  // instance settings); registration is otherwise invitation-only. When the well-known DEFAULT
  // password is in use, force a password change on first login (closes the known-credential hole);
  // an explicit SW_ADMIN_PASSWORD is trusted as already-chosen and is NOT forced.
  const { userId } = await registerAccount(db, adminEmail, password, {
    platformRole: 'admin',
    mustChangePassword: usingDefault,
  });
  log(
    usingDefault
      ? `[sitewright/seed] WARNING: created admin "${adminEmail}" with the DEFAULT password ` +
          `"${DEFAULT_ADMIN_PASSWORD}" — anyone who can reach this instance can sign in with it. ` +
          `Change it after first login (or set SW_ADMIN_PASSWORD before first boot).`
      : `[sitewright/seed] created admin "${adminEmail}".`,
  );

  // The showcase projects are COMMITTED EXPORT BUNDLES — every subdirectory of
  // apps/api/example_projects/ is one unpacked project export produced by scripts/export-example.mjs
  // (a showcase is authored in the product and re-exported, not written in code). Import each through
  // the same core the staff zip import uses — content sections first, then the media binaries; no
  // network, fully deterministic. BEST-EFFORT per bundle: one broken bundle must not abort the
  // bootstrap or the other bundles (the idempotency guard above would otherwise lock the miss in).
  const contentRepo = new ContentRepository(db, new ProjectEventBus());
  for (const dir of await listSeedBundles()) {
    try {
      const imported = await importSeedBundle({ db, userId, mediaRoot, dir, log });
      const ctx = { userId, projectId: imported.projectId, role: 'owner' as const };
      // Local Hosting is an opt-in `local` deploy target the export deliberately OMITS (deploy
      // targets carry credentials) — seed one so each showcase serves at /sites/<slug>/ after a publish.
      await contentRepo.put(ctx, 'deploy_target', 'local-hosting', {
        id: 'local-hosting',
        name: 'Local Hosting',
        protocol: 'local',
      });
      const c = imported.counts;
      log(
        `[sitewright/seed] imported "${imported.name}" from its bundled export (${c.pages} pages, ` +
          `${c.datasets} datasets, ${c.entries} entries, ${c.forms} form(s)` +
          `${imported.mediaFiles > 0 ? `, ${imported.mediaFiles} media files` : ''}) — delete it from the editor once you've explored it.`,
      );
    } catch (err) {
      log(
        `[sitewright/seed] WARNING: showcase bundle import failed for ${dir} (${err instanceof Error ? err.message : String(err)}); ` +
          `other bundles and the admin account are unaffected.`,
      );
    }
  }

}
