import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { MediaAsset } from '@sitewright/schema';
import type { Database } from '../db/client.js';
import { content, contentRevisions, projects } from '../db/schema.js';
import { ASSET_ID_LEN, isShortAssetId } from '../id.js';
import type { MediaStorage } from './storage.js';

/**
 * One-time, idempotent DATA migration: bring EXISTING media assets onto the flat short-id scheme so a
 * project's media is single-folder + short-id everywhere (no mixed shapes). For every project with any
 * legacy (long `randomUUID()`) media asset, this:
 *   1. mints a stable short 6-char id per legacy asset (a per-project-unique hash of the old id),
 *   2. MOVES its on-disk binaries from `<slug>/<oldid>/…` (foldered) → `<slug>/<newid>-…` (flat),
 *   3. RE-KEYS the media row (entityId + data.id/url), preserving soft-delete state + history, and
 *   4. REWRITES every `/media/<slug>/<oldid>/[file/]<name>` reference → `/media/<slug>/<newid>-<name>`
 *      (and the one bare-id ref, a font typography slot's `assetId`) across the project's live content
 *      AND its revision history, so a restored old revision still resolves its media.
 *
 * Idempotent: a project whose media is already all short is a cheap no-op, so it is safe to run on
 * every boot. It runs BEFORE the server listens (like the dataset-slug migration), so a partially
 * applied state is never served; a crash resumes cleanly on the next boot (records still on the old id
 * are re-processed; the only residue is a possibly-orphaned old `<slug>/<oldid>/` dir, which is inert).
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Live content kinds that can embed a `/media/…` reference (media rows are re-keyed separately). */
const REF_KINDS = ['settings', 'page', 'template', 'snippet', 'translation', 'dataset', 'entry', 'form'] as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A short 6-char base62 id derived (deterministically) from the old id + an optional collision salt. */
export function deriveShortId(oldId: string, salt = ''): string {
  const digest = createHash('sha256').update(salt ? `${oldId}#${salt}` : oldId).digest();
  let out = '';
  for (let i = 0; i < digest.length && out.length < ASSET_ID_LEN; i += 1) {
    out += ALPHABET[digest[i]! % ALPHABET.length];
  }
  return out;
}

/** The flat delivery url for a re-keyed asset (mirrors the mint sites' per-kind logical name). */
function flatUrl(asset: MediaAsset, newId: string, slug: string): string {
  const logical =
    asset.kind === 'image' ? asset.original : asset.kind === 'font' ? asset.files[0]!.file : asset.storedName;
  return `/media/${slug}/${newId}-${logical}`;
}

/** Assign each legacy asset a UNIQUE short id, avoiding any id already taken in the project. */
function buildIdMap(legacy: readonly MediaAsset[], taken: Set<string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of [...legacy].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    let salt = 0;
    let newId = deriveShortId(a.id);
    while (taken.has(newId)) newId = deriveShortId(a.id, String(++salt));
    taken.add(newId);
    map.set(a.id, newId);
  }
  return map;
}

/**
 * Rewrite an entity's JSON `data` blob: every `/media/<slug>/<oldid>/[file/]<name>` → the flat
 * `/media/<slug>/<newid>-<name>`, plus a bare `"assetId":"<oldid>"` (the font slot) → the new id.
 * Returns the rewritten object, or null when nothing changed. Operates on the serialized JSON — a
 * flat url (no interior `/` after the id) can't match the url pattern, so already-migrated data is inert.
 */
function rewriteBlob(data: unknown, slug: string, map: ReadonlyMap<string, string>): unknown | null {
  const before = JSON.stringify(data);
  const prefix = `/media/${slug}/`;
  const urlRe = new RegExp(`${escapeRegExp(prefix)}([A-Za-z0-9_-]+)/(?:file/)?([A-Za-z0-9_.-]+)`, 'g');
  let changed = false;
  let out = before.replace(urlRe, (whole, id: string, name: string) => {
    const nid = map.get(id);
    if (!nid) return whole;
    changed = true;
    return `${prefix}${nid}-${name}`;
  });
  out = out.replace(/"assetId":"([A-Za-z0-9_-]+)"/g, (whole, id: string) => {
    const nid = map.get(id);
    if (!nid) return whole;
    changed = true;
    return `"assetId":"${nid}"`;
  });
  return changed ? (JSON.parse(out) as unknown) : null;
}

/**
 * Rewrite every media reference in a project's live content + revision history. `exec` is a `db` or a
 * transaction handle. Loads a project's ref-bearing rows into memory (bounded by project size —
 * revisions are capped/swept per entity); acceptable for a one-time boot migration.
 */
async function rewriteProjectRefs(exec: Database, projectId: string, slug: string, map: ReadonlyMap<string, string>): Promise<void> {
  const rows = await exec
    .select({ id: content.id, data: content.data })
    .from(content)
    .where(and(eq(content.projectId, projectId), inArray(content.kind, [...REF_KINDS])));
  for (const row of rows) {
    const next = rewriteBlob(row.data, slug, map);
    if (next !== null) await exec.update(content).set({ data: next }).where(eq(content.id, row.id));
  }
  const revs = await exec
    .select({ id: contentRevisions.id, data: contentRevisions.data })
    .from(contentRevisions)
    .where(eq(contentRevisions.projectId, projectId));
  for (const rev of revs) {
    const next = rewriteBlob(rev.data, slug, map);
    if (next !== null) await exec.update(contentRevisions).set({ data: next }).where(eq(contentRevisions.id, rev.id));
  }
}

export async function migrateMediaToFlatShortId(
  db: Database,
  storage: MediaStorage,
  opts: { snapshot?: () => Promise<void>; log?: (m: string) => void } = {},
): Promise<void> {
  const log = opts.log ?? (() => {});
  const rows = await db.select({ id: projects.id, slug: projects.slug }).from(projects);
  let snapshotted = false;
  let migratedProjects = 0;
  let migratedAssets = 0;

  for (const project of rows) {
    // ALL media (live + soft-deleted): both have on-disk binaries + references to migrate.
    const mediaRows = await db
      .select({ data: content.data })
      .from(content)
      .where(and(eq(content.projectId, project.id), eq(content.kind, 'media')));
    const all = mediaRows.map((r) => r.data as MediaAsset);
    const legacy = all.filter((a) => !isShortAssetId(a.id));
    if (legacy.length === 0) continue; // fast path: already flat

    // Snapshot the DB ONCE, before the first real rewrite (the on-disk moves are covered by
    // copy-first/delete-last + resumability, which the DB snapshot cannot protect).
    if (!snapshotted && opts.snapshot) {
      await opts.snapshot();
      snapshotted = true;
    }

    const taken = new Set(all.map((a) => a.id).filter(isShortAssetId));
    const map = buildIdMap(legacy, taken);

    // 1. COPY binaries to the flat layout FIRST (old dir left intact; `cp` overwrites, so a retry is a
    //    safe no-op). Kept OUTSIDE the DB transaction — filesystem work can't participate in it anyway.
    for (const [oldId, newId] of map) {
      await storage.copyAsset(project.slug, oldId, newId);
    }
    // 2 + 3. Rewrite every reference (live content + revision history) AND re-key each media row in ONE
    //    transaction, so they commit together or not at all. Atomicity matters because the per-project
    //    "still legacy?" completion signal is the media row's id shape: if a re-key committed while its
    //    ref-rewrite didn't, that asset would look done (→ skipped) yet leave a dangling old ref forever.
    //    A crash mid-transaction rolls back to fully-legacy, which the next boot correctly re-processes.
    //    (An already-flat url has no interior `/` after its id, so the ref rewrite is also idempotent.)
    const now = new Date();
    await db.transaction(async (tx) => {
      const exec = tx as unknown as Database; // tx exposes the same query builder
      await rewriteProjectRefs(exec, project.id, project.slug, map);
      for (const a of legacy) {
        const newId = map.get(a.id)!;
        const next = { ...a, id: newId, url: flatUrl(a, newId, project.slug) } as MediaAsset;
        await exec
          .update(content)
          .set({ entityId: newId, data: next, updatedAt: now })
          .where(and(eq(content.projectId, project.id), eq(content.kind, 'media'), eq(content.entityId, a.id)));
      }
    });
    // 4. DELETE the now-copied legacy dirs LAST (after the DB commit; a leftover on crash is inert).
    for (const oldId of map.keys()) {
      await storage.remove(project.slug, oldId);
    }

    migratedProjects += 1;
    migratedAssets += legacy.length;
    log(`media-flat migration: ${project.slug} — ${legacy.length} asset(s) migrated`);
  }

  if (migratedAssets > 0) {
    log(`media-flat migration: ${migratedAssets} asset(s) across ${migratedProjects} project(s)`);
  }
}
