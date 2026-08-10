import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { content, projects } from '../db/schema.js';

/**
 * REAPERS for the three derived stores that had no lifecycle at all.
 *
 * Media has been cleaned on rename, on Local-target removal, on project delete, and hourly for the
 * recycle bin — and it is the one store measured clean. `sites`, `preview` and `source-refs` had a
 * single removal path between them (permanent project deletion), so anything published, previewed or
 * imported grew forever. Measured on a real instance: 46 build directories of which 4 were served,
 * 51 preview builds, 47 source-ref captures — 1.35 GB, almost none of it reachable.
 *
 * ★ EVERY BYTE THESE DELETE IS DERIVED. A build regenerates on the next publish, a preview on the next
 * open. Source references are the only judgement call: they are captured once at import and cannot be
 * recreated without re-crawling, which is why the window is configurable and the fidelity tools say
 * when a reference was reaped rather than silently comparing against nothing.
 */

/** A slug directory on disk with the newest mtime found in it. */
interface DirAge {
  slug: string;
  mtimeMs: number;
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Directories directly under `root`, each with the newest mtime among its own entries.
 *
 * ★ The directory's OWN mtime is not enough: on many filesystems it tracks only when an entry was
 * added or removed, so a rebuild that overwrites the same files in place leaves it untouched and a
 * live project looks a month stale. Taking the newest child mtime is what makes "stale" mean what it
 * says. (One level deep — enough to distinguish activity, cheap on a directory of thousands.)
 */
async function dirAges(root: string): Promise<DirAge[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return []; // the store was never written to
  }
  const out: DirAge[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SLUG.test(entry.name)) continue;
    const dir = join(root, entry.name);
    let newest = 0;
    try {
      const st = await stat(dir);
      newest = st.mtimeMs;
      for (const child of await readdir(dir, { withFileTypes: true })) {
        try {
          const cs = await stat(join(dir, child.name));
          if (cs.mtimeMs > newest) newest = cs.mtimeMs;
        } catch {
          /* vanished mid-scan — ignore */
        }
      }
    } catch {
      continue; // unreadable: never a reason to delete
    }
    out.push({ slug: entry.name, mtimeMs: newest });
  }
  return out;
}

export interface ReapResult {
  removed: string[];
  bytesFreed: number;
}

async function sizeOf(dir: string): Promise<number> {
  let total = 0;
  const walk = async (d: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const f = join(d, e.name);
      if (e.isDirectory()) await walk(f);
      else
        try {
          total += (await stat(f)).size;
        } catch {
          /* vanished */
        }
    }
  };
  await walk(dir);
  return total;
}

/**
 * Remove slug directories whose newest content is older than `maxAgeMs`.
 *
 * `keep` is consulted first and wins: a caller passes the slugs it must not touch (a build that is
 * actually being served, a project mid-publish). `onRemoved` runs after each deletion — the preview
 * reaper uses it to drop the in-memory "already built" marker, WITHOUT WHICH the running process
 * keeps believing the build exists and serves 404s until the content version changes.
 */
export async function reapStaleDirs(
  root: string,
  maxAgeMs: number,
  opts: { now?: number; keep?: ReadonlySet<string>; onRemoved?: (slug: string) => void } = {},
): Promise<ReapResult> {
  const now = opts.now ?? Date.now();
  const result: ReapResult = { removed: [], bytesFreed: 0 };
  for (const { slug, mtimeMs } of await dirAges(root)) {
    if (opts.keep?.has(slug)) continue;
    if (now - mtimeMs < maxAgeMs) continue;
    const dir = join(root, slug);
    const bytes = await sizeOf(dir);
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      continue; // a failed delete is not a freed byte
    }
    result.removed.push(slug);
    result.bytesFreed += bytes;
    opts.onRemoved?.(slug);
  }
  return result;
}

/**
 * Remove built sites that nothing can serve — every slug directory except those in `served`.
 *
 * No age test on purpose. `data/sites/<slug>` is read by exactly one thing, the local
 * `/sites/<slug>/` server; a remote deploy builds into a temp dir and uploads from there. So a build
 * without a Local Hosting target is not "old", it is unreachable the moment it is written, and
 * waiting 30 days to admit that would only mean carrying it for 30 days.
 *
 * The publish route already declines to keep one. This is the sweep for everything published before
 * that rule existed, and for a project whose local target is removed while a build is in flight.
 */
export async function reapUnservedBuilds(
  root: string,
  served: ReadonlySet<string>,
  opts: { skip?: ReadonlySet<string> } = {},
): Promise<ReapResult> {
  const result: ReapResult = { removed: [], bytesFreed: 0 };
  for (const { slug } of await dirAges(root)) {
    if (served.has(slug)) continue;
    if (opts.skip?.has(slug)) continue; // mid-publish: never rm -rf a directory being written
    const dir = join(root, slug);
    const bytes = await sizeOf(dir);
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      continue;
    }
    result.removed.push(slug);
    result.bytesFreed += bytes;
  }
  return result;
}

/** Bytes a project occupies in one store, for the per-project storage reading. */
export async function projectStorage(root: string | undefined, slug: string): Promise<number> {
  if (!root || !SLUG.test(slug)) return 0;
  return sizeOf(join(root, slug));
}

export interface DerivedSweepOptions {
  publishRoot?: string;
  previewRoot?: string;
  sourceRefRoot?: string;
  /** How long an untouched preview build / source reference survives. */
  retentionMs: number;
  /** Project ids whose build is being written right now — never rm -rf underneath a publish. */
  busyProjectIds?: ReadonlySet<string>;
  /**
   * ★ Called with the PROJECT ID of every preview build removed. The caller must drop its in-memory
   * "already built at version X" marker here: that check returns early without testing whether the
   * directory still exists, so a build reaped behind its back serves 404s until the content version
   * changes or the process restarts. This callback is the entire reason the sweep runs in-process.
   */
  onPreviewReaped?: (projectId: string) => void;
}

export interface DerivedSweepReport {
  builds: ReapResult;
  previews: ReapResult;
  sourceRefs: ReapResult;
}

const EMPTY: ReapResult = { removed: [], bytesFreed: 0 };

/** Sweep all three derived stores. Safe to call on a timer; every rule is documented at its call. */
export async function sweepDerivedStorage(db: Database, opts: DerivedSweepOptions): Promise<DerivedSweepReport> {
  const rows = await db.select({ id: projects.id, slug: projects.slug }).from(projects);
  const slugToId = new Map(rows.map((r) => [r.slug, r.id]));
  const idToSlug = new Map(rows.map((r) => [r.id, r.slug]));
  const report: DerivedSweepReport = { builds: EMPTY, previews: EMPTY, sourceRefs: EMPTY };

  if (opts.publishRoot) {
    // Which projects have a LOCAL target — the only thing that ever reads data/sites/<slug>.
    const served = new Set<string>();
    const targets = await db
      .select({ projectId: content.projectId, data: content.data })
      .from(content)
      .where(eq(content.kind, 'deploy_target'));
    for (const t of targets) {
      const slug = idToSlug.get(t.projectId);
      if (slug && (t.data as { protocol?: string } | null)?.protocol === 'local') served.add(slug);
    }
    const busy = new Set(
      [...(opts.busyProjectIds ?? [])].map((id) => idToSlug.get(id)).filter((v): v is string => Boolean(v)),
    );
    report.builds = await reapUnservedBuilds(opts.publishRoot, served, { skip: busy });
  }

  if (opts.previewRoot && opts.retentionMs > 0) {
    report.previews = await reapStaleDirs(opts.previewRoot, opts.retentionMs, {
      onRemoved: (slug) => {
        const id = slugToId.get(slug);
        if (id) opts.onPreviewReaped?.(id);
      },
    });
  }

  if (opts.sourceRefRoot && opts.retentionMs > 0) {
    report.sourceRefs = await reapStaleDirs(opts.sourceRefRoot, opts.retentionMs);
  }
  return report;
}
