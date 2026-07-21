import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { projects, users } from './schema.js';

/**
 * Guards against a version jump that would SILENTLY SKIP a since-deleted data migration.
 *
 * Two migration systems exist: Drizzle SCHEMA migrations (cumulative, forward-only, every pending one
 * runs on boot — jumping versions is always safe there, and their journal entries live forever) and
 * idempotent code-based DATA migrations that run every boot and detect legacy data by its SHAPE (e.g.
 * `migrateDatasetSlugsToUnderscore`, `migrateMediaToFlatShortId`). A data migration is safe across an
 * arbitrary version jump ONLY while its code is still present. If a future release DELETES one (the
 * classic "everyone's migrated by now" cleanup), an instance that jumps from a pre-migration version
 * straight to the post-cleanup build would never run that transformation and could strand/corrupt data.
 *
 * This guard makes that impossible-to-miss instead of silent: the DB is stamped with the data-migration
 * GENERATION it has been brought up to (in SQLite's `PRAGMA user_version` — a free header slot Drizzle's
 * migrator does not use). `MIN_UPGRADE_FROM` is the OLDEST generation this build can still upgrade FROM;
 * it stays 0 while every data migration is present, and is bumped only when one is removed. On boot, an
 * instance stamped below `MIN_UPGRADE_FROM` is refused (fail-fast) with a clear "upgrade to an
 * intermediate release first" message — leaving its data untouched — rather than being half-migrated.
 */

/**
 * The current data-migration GENERATION — the number of ordered idempotent data migrations this build
 * ships. Bump by ONE whenever you ADD a data migration in `server.ts`.
 *   gen 1 = migrateDatasetSlugsToUnderscore
 *   gen 2 = migrateMediaToFlatShortId
 */
export const DATA_MIGRATION_VERSION = 2;

/**
 * The lowest stamped generation this build can upgrade FROM. Leave at 0 while every data migration is
 * still present in the code. Bump ONLY when you REMOVE an old data migration: set this to the generation
 * of the newest removed migration, and set `MIN_UPGRADE_FROM_RELEASE` to the earliest release that still
 * contained it. (Never lower it.)
 *
 * DISCIPLINE before bumping: an instance is only correctly stamped once it has booted a release that
 * includes THIS stamping feature. A migrated-but-unstamped instance (one migrated by an older,
 * pre-stamping build) reads as generation 0, so bumping `MIN_UPGRADE_FROM` above 0 before every
 * supported live instance has passed through a stamping-capable release would FALSE-block it. So: only
 * raise this to gen N once the release that introduced gen N+1's migration (and thus stamping ≥ N) is
 * comfortably older than the minimum supported upgrade window.
 */
export const MIN_UPGRADE_FROM = 0;
/** The human-facing release an over-old instance must upgrade to first. Updated alongside `MIN_UPGRADE_FROM`. */
export const MIN_UPGRADE_FROM_RELEASE = 'an earlier release';

/** Reads the DB's stamped data-migration generation (0 = never stamped: a fresh or pre-guard DB). */
export async function readDataMigrationVersion(db: Database): Promise<number> {
  const rows = (await db.all(sql`PRAGMA user_version`)) as Array<{ user_version?: number }>;
  const v = rows[0]?.user_version;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Stamps the DB's data-migration generation (monotonic — never lowers it, so a downgrade can't corrupt it). */
export async function stampDataMigrationVersion(db: Database, version: number = DATA_MIGRATION_VERSION): Promise<void> {
  const target = Math.trunc(version);
  // `target` is interpolated into raw SQL (PRAGMA can't bind params). It is always a code constant today,
  // but validate by construction so no future caller can turn this into an injection/corruption primitive.
  if (!Number.isInteger(target) || target < 0 || target > 2_000_000_000) {
    throw new Error(`invalid data-migration version to stamp: ${version}`);
  }
  const current = await readDataMigrationVersion(db);
  if (current < target) {
    await db.run(sql.raw(`PRAGMA user_version = ${target}`));
  }
}

export type UpgradeDecision = { blocked: false } | { blocked: true; message: string };

/**
 * The pure decision: given the DB's stamped generation and whether it already holds data, is this build
 * allowed to upgrade it in place? A fresh DB (no data yet — the seed runs later) is NEVER blocked; it is
 * born at the current generation. `minFrom`/`minRelease` are injectable for testing.
 */
export function evaluateUpgrade(
  stamp: number,
  hasData: boolean,
  minFrom: number = MIN_UPGRADE_FROM,
  minRelease: string = MIN_UPGRADE_FROM_RELEASE,
): UpgradeDecision {
  if (stamp >= minFrom) return { blocked: false };
  if (!hasData) return { blocked: false }; // fresh DB → nothing to migrate from
  return {
    blocked: true,
    message:
      `This instance's data was last migrated by an older release (data version ${stamp}), but this ` +
      `build requires at least data version ${minFrom}. A one-time migration it needs was removed in a ` +
      `newer build, so upgrading directly would skip it and could strand or corrupt data. Roll back to ` +
      `${minRelease} (or a later release that still includes it), let it finish migrating, then upgrade ` +
      `to this build again. Your data has not been touched.`,
  };
}

/**
 * Decides whether this build may upgrade the DB in place. "Not fresh" is keyed on the `users` table (a
 * real instance always has ≥1 user — server.ts enforces it — and a user survives project deletion/reaping,
 * so it's a more robust signal than `projects` alone), falling back to `projects`. `opts.minFrom` is
 * injectable for tests (the shipped default is `MIN_UPGRADE_FROM`).
 */
export async function checkUpgradePath(db: Database, opts: { minFrom?: number } = {}): Promise<UpgradeDecision> {
  const minFrom = opts.minFrom ?? MIN_UPGRADE_FROM;
  const stamp = await readDataMigrationVersion(db);
  if (stamp >= minFrom) return { blocked: false }; // fast path (always true while MIN_UPGRADE_FROM=0)
  const hasUser = (await db.select({ id: users.id }).from(users).limit(1)).length > 0;
  const hasData = hasUser || (await db.select({ id: projects.id }).from(projects).limit(1)).length > 0;
  return evaluateUpgrade(stamp, hasData, minFrom);
}
