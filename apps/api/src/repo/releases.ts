import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { projectReleases } from '../db/schema.js';
import type { ReleaseManifest } from '../publish/build.js';

/**
 * The last published release of a project, as a durable ROW rather than a file inside the build.
 *
 * The built site is derived output that only Local Hosting serves, so it is reapable — but the
 * release manifest lived inside it, which meant deleting the build also deleted the answer to "is the
 * published site out of date?". This separates the small durable fact from the large derived bytes.
 */
export class ReleaseRepository {
  constructor(private readonly db: Database) {}

  /** Record a successful publish. One row per project — a new release replaces the last. */
  async record(projectId: string, manifest: ReleaseManifest): Promise<void> {
    const row = {
      projectId,
      publishedAt: new Date(manifest.publishedAt),
      routes: manifest.routes,
      bytes: manifest.bytes,
      pageFailures: manifest.pageFailures?.length ? manifest.pageFailures : null,
    };
    await this.db
      .insert(projectReleases)
      .values(row)
      .onConflictDoUpdate({ target: projectReleases.projectId, set: row });
  }

  /**
   * The last release, or null if this project has never been published.
   *
   * `fallback` reads the on-disk `release.json` for a project published BEFORE this row existed —
   * without it every existing instance would report its sites as never-published on upgrade. It is a
   * read-only backfill: a stale build still answers correctly, and the next publish writes the row.
   */
  async get(projectId: string, fallback?: () => Promise<ReleaseManifest | null>): Promise<ReleaseManifest | null> {
    const [row] = await this.db.select().from(projectReleases).where(eq(projectReleases.projectId, projectId));
    if (!row) return fallback ? await fallback() : null;
    return {
      publishedAt: row.publishedAt.toISOString(),
      routes: row.routes,
      bytes: row.bytes,
      ...(row.pageFailures ? { pageFailures: row.pageFailures as ReleaseManifest['pageFailures'] } : {}),
    };
  }

}
