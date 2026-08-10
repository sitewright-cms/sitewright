import { and, eq, ne, notInArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { content, contentRevisions } from '../db/schema.js';
import { GLOBAL_SCOPE_ID } from './global-library.js';

/**
 * Which of a project's media assets nothing refers to.
 *
 * ★ THE ASYMMETRY THAT DESIGNS THIS. A false NEGATIVE — calling a genuinely unused file "used" —
 * costs some disk. A false POSITIVE offers to delete a file that is on a live page, and an author
 * who is told "select all" will take that offer. So every place a reference can live must be in the
 * haystack, and when in doubt an asset is USED. The two are not equally bad and the code should not
 * pretend they are.
 *
 * Matching is by ASSET ID, which appears in every reference because the URL is
 * `/media/<slug>/<id>-<name>` — a raw href, a `{{sw-image}}` helper, a data-sw-src binding and an
 * inline style all carry it. A short id could in principle collide with unrelated text, which would
 * mark an unused asset as used: the safe direction, chosen deliberately.
 */

/** Kinds that cannot reference media (media rows themselves, and folder records). */
const NON_REFERENCING = ['media', 'mediafolder'] as const;

export interface UnusedAsset {
  id: string;
  /** True when the ONLY references are in version history — deleting breaks a restore, not a page. */
  onlyInHistory: boolean;
}

export interface UnusedScan {
  unused: UnusedAsset[];
  /** What was actually searched, so a caller can say so rather than asking for trust. */
  scanned: { assets: number; contentRows: number; globalRows: number; revisionRows: number };
}

/** Every stored string of a row set, concatenated — the haystack an id is searched in. */
const haystackOf = (rows: Array<{ data: unknown }>): string => rows.map((r) => JSON.stringify(r.data)).join('\n');

export async function findUnusedMedia(db: Database, projectId: string): Promise<UnusedScan> {
  const assets = await db
    .select({ entityId: content.entityId, data: content.data })
    .from(content)
    .where(and(eq(content.projectId, projectId), eq(content.kind, 'media')));

  // 1. The project's own live content — pages, templates, snippets, translations, datasets, entries,
  //    forms, image maps, and SETTINGS (which carries the logo, icon, OG image, critical CSS and any
  //    project scripts, so scanning it whole matters more than any single field).
  const own = await db
    .select({ data: content.data })
    .from(content)
    .where(and(eq(content.projectId, projectId), notInArray(content.kind, [...NON_REFERENCING])));

  // 2. The GLOBAL library. Its snippets and templates are rendered into this project's pages, so a
  //    reference living there is every bit as live as one in the project's own source.
  const global = await db
    .select({ data: content.data })
    .from(content)
    .where(and(eq(content.projectId, GLOBAL_SCOPE_ID), notInArray(content.kind, [...NON_REFERENCING])));

  // 3. ★ VERSION HISTORY. The one people forget. An asset referenced only by an older revision is
  //    needed by a RESTORE — delete it and the restore silently comes back with a broken image. Those
  //    assets are reported separately rather than folded into "unused", so "select all" cannot
  //    quietly break the undo story.
  const history = await db
    .select({ data: contentRevisions.data })
    .from(contentRevisions)
    .where(and(eq(contentRevisions.projectId, projectId), ne(contentRevisions.kind, 'media')));

  const live = `${haystackOf(own)}\n${haystackOf(global)}`;
  const past = haystackOf(history);

  const unused: UnusedAsset[] = [];
  for (const asset of assets) {
    const id = String(asset.entityId);
    if (live.includes(id)) continue;
    unused.push({ id, onlyInHistory: past.includes(id) });
  }

  return {
    unused,
    scanned: {
      assets: assets.length,
      contentRows: own.length,
      globalRows: global.length,
      revisionRows: history.length,
    },
  };
}
