// Source-reference cache: at INGEST we screenshot each imported page's LIVE source once and store it, so
// `compare_to_source` compares the build against a STABLE snapshot (reproducible, offline-safe, and fast —
// no live re-render per call). The live site can change or go down after import; the cached reference is
// the ground truth from import time. Missing/failed/capped pages fall back to a live capture at compare
// time (and that result backfills the cache).
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DEFAULT_SCREENSHOT_VIEWPORTS, type ScreenshotViewportName } from '@sitewright/schema';
import { captureUrlShots } from './compare.js';
import type { Shot, ViewportName } from './screenshot.js';

const SLUG = /^[A-Za-z0-9_-]+$/;
/** Max pages we proactively screenshot at ingest; the rest backfill lazily on first compare. */
export const REFERENCE_PAGE_CAP = 12;

/** A stored source reference for one page: the live shots captured at import time. */
export interface SourceRef {
  sourceUrl: string;
  capturedAt: number;
  shots: Partial<Record<ViewportName, Shot>>;
}

/**
 * Per-project file store for source-reference screenshots, one JSON (base64 shots) per page under
 * `<root>/<slug>/<pageKey>.json`. Mirrors PublishStore's slug-confined layout + `removeProject` cleanup.
 */
export class SourceRefStore {
  constructor(private readonly root: string) {}

  /** Filesystem-safe path for a page's reference, confined to the project's slug dir. */
  private fileFor(slug: string, pageId: string): string {
    if (!SLUG.test(slug)) throw new Error('invalid project slug');
    const key = Buffer.from(pageId, 'utf8').toString('base64url'); // always [A-Za-z0-9_-], never traverses
    return join(this.root, slug, `${key}.json`);
  }

  /** Persist (or overwrite) a page's reference shots. Best-effort: a torn write just reads back as a miss. */
  async put(slug: string, pageId: string, ref: SourceRef): Promise<void> {
    const file = this.fileFor(slug, pageId);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(ref));
  }

  /** Read a page's stored reference, or null if absent / unreadable. */
  async get(slug: string, pageId: string): Promise<SourceRef | null> {
    try {
      const raw = await readFile(this.fileFor(slug, pageId), 'utf8');
      const ref = JSON.parse(raw) as SourceRef;
      return ref && typeof ref.sourceUrl === 'string' && ref.shots ? ref : null;
    } catch {
      return null;
    }
  }

  /** Delete all references for a project (idempotent). Called on project delete. */
  async removeProject(slug: string): Promise<void> {
    if (!SLUG.test(slug)) throw new Error('invalid project slug');
    await rm(join(this.root, slug), { recursive: true, force: true });
  }
}

/** A page we can capture a reference for (the importer's bundle page shape). */
export interface ReferencePage {
  id: string;
  data?: { swImport?: { sourceUrl?: string } };
}

export interface CaptureRefsResult {
  captured: number;
  total: number;
  capped: boolean;
}

/**
 * Screenshot each imported page's LIVE source (pinned, SSRF-safe) and store it as the page's reference.
 * Capped, sequential, and NON-FATAL per page (a failed capture is skipped — compare falls back to live).
 * Drives a real browser, so it's exercised at deploy, not in unit tests.
 */
/* v8 ignore start */
export async function captureSourceRefs(
  store: SourceRefStore,
  slug: string,
  pages: ReferencePage[],
  opts: { onProgress?: (e: unknown) => void; signal?: AbortSignal; viewports?: ScreenshotViewportName[] } = {},
): Promise<CaptureRefsResult> {
  const targets = pages
    .map((p) => ({ id: p.id, sourceUrl: p.data?.swImport?.sourceUrl }))
    .filter((p): p is { id: string; sourceUrl: string } => typeof p.sourceUrl === 'string' && p.sourceUrl.length > 0);
  const capped = targets.length > REFERENCE_PAGE_CAP;
  const plan = targets.slice(0, REFERENCE_PAGE_CAP);
  const viewports = opts.viewports ?? [...DEFAULT_SCREENSHOT_VIEWPORTS];
  let captured = 0;
  for (let i = 0; i < plan.length; i++) {
    if (opts.signal?.aborted) break;
    const { id, sourceUrl } = plan[i]!;
    opts.onProgress?.({ phase: 'reference', detail: `capturing source reference ${i + 1}/${plan.length}`, current: i + 1, total: plan.length });
    const shots = await captureUrlShots(sourceUrl, { mode: 'pinned', viewports, signal: opts.signal }).catch(() => ({}));
    if (Object.keys(shots).length > 0) {
      await store.put(slug, id, { sourceUrl, capturedAt: Date.now(), shots }).catch(() => {});
      captured += 1;
    }
  }
  return { captured, total: targets.length, capped };
}
/* v8 ignore stop */
