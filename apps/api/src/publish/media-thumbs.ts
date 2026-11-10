import { constants as fsConstants } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import {
  THUMB_SIZES,
  DEFAULT_SIZE,
  isSizeToken,
  isThumbFormat,
  isThumbnailable,
  isSvgFile,
  thumbFileName,
  generateThumbnail,
  type SizeToken,
  type ThumbFormat,
} from '@sitewright/image-pipeline';
import type { MediaAsset } from '@sitewright/schema';
import { flatMediaName } from './asset-alias.js';

/**
 * Publish-time thumbnail materialization + FLAT media-URL rewrite.
 *
 * The rendered site references images through the DELIVERY route
 * (`/media/<slug>/<id>/<name>?size=<sm|md|lg|xl>&format=<webp|avif>`, or bare ⇒ `xl`), and raw files
 * through `/media/<slug>/<id>/file/<name>`. A dumb static host can neither run our thumbnailer nor
 * honour a `?size=` query, so at build time we:
 *  1. REWRITE every such URL to a concrete FLAT static file under a single `_assets/` directory —
 *     `_assets/<alias>-<name>-<size>.<fmt>` (a thumbnail) or `_assets/<alias>-<name>.<ext>` (an
 *     original / svg / raw file) — recording which `(asset, size, format)` combinations the output
 *     actually references, and
 *  2. GENERATE exactly those thumbnails (plus any explicitly-referenced originals) from the retained
 *     original into that same flat `_assets/` dir.
 *
 * Result: a never-previewed export is still COMPLETE (every referenced variant is produced) and
 * MINIMAL (only referenced variants of referenced assets — not an eager fan-out), and it ships as ONE
 * flat directory (fast to SFTP/FTP — one `mkdir` instead of one-folder-per-asset). The `<alias>-`
 * prefix (see `asset-alias.ts`) keeps two same-named assets from colliding in the flat namespace.
 */

/** The published directory that holds each project's bundled asset binaries (flat). */
const ASSET_DIR = '_assets';

/** A referenced-thumbnail accumulator, keyed by asset id. `thumbs` holds `"<size>:<format>"` keys. */
export type ThumbRefs = Map<string, { thumbs: Set<string>; original: boolean }>;

/** Resolves an asset id to its stable flat-file alias (see `asset-alias.ts`). */
export type AliasFn = (id: string) => string;

function bucket(refs: ThumbRefs, id: string): { thumbs: Set<string>; original: boolean } {
  let b = refs.get(id);
  if (!b) {
    b = { thumbs: new Set(), original: false };
    refs.set(id, b);
  }
  return b;
}

/** Record a referenced thumbnail `(id, size, format)`. */
export function addThumbRef(refs: ThumbRefs, id: string, size: SizeToken, format: ThumbFormat): void {
  bucket(refs, id).thumbs.add(`${size}:${format}`);
}

/** Record that an asset's raw ORIGINAL is referenced (a `size=original` link, an svg, or a favicon source). */
export function addOriginalRef(refs: ThumbRefs, id: string): void {
  bucket(refs, id).original = true;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse `size`/`format` out of a raw query string (`?size=lg&format=avif`). The query is read out of
 * HTML, so its separator may be the attribute-escaped `&amp;` (see `rewriteMediaUrlsFlat`).
 */
function parseQuery(query: string): { size: SizeToken | 'original'; format: ThumbFormat } {
  const raw = (query.startsWith('?') ? query.slice(1) : query).replace(/&amp;/g, '&');
  const params = new URLSearchParams(raw);
  const rawSize = params.get('size');
  const rawFormat = params.get('format');
  const size: SizeToken | 'original' =
    rawSize === 'original' ? 'original' : rawSize && isSizeToken(rawSize) ? rawSize : DEFAULT_SIZE;
  const format: ThumbFormat = rawFormat && isThumbFormat(rawFormat) ? rawFormat : 'webp';
  return { size, format };
}

/**
 * Split the part of a `/media/<slug>/…` url AFTER the slug prefix (query already removed) into its asset
 * id + file name, handling BOTH media-url shapes:
 *   - FLAT `<id>-<name>` (the current scheme, [[media-flat-scheme-epic]]) — id = the run before the FIRST
 *     hyphen (the same rule as blocks' `mediaAssetId`); a flat url has no raw `/file/` variant.
 *   - legacy `<id>/[file/]<name>` FOLDER — id = the whole 1st segment; `/file/` marks a verbatim download.
 * `undefined` for a shape that is neither (a bare `/media/<slug>/`, extra nesting, or no name), so the
 * caller leaves the url untouched. Distinguishing the two on the slash keeps the flat `<id>-<name>` from
 * being mistaken for a folder and vice-versa.
 */
export function splitMediaPath(rest: string): { id: string; name: string; isRaw: boolean } | undefined {
  const slash = rest.indexOf('/');
  if (slash === 0) return undefined; // leading slash → malformed
  if (slash > 0) {
    const id = rest.slice(0, slash);
    let name = rest.slice(slash + 1);
    const isRaw = name.startsWith('file/');
    if (isRaw) name = name.slice('file/'.length);
    if (!id || !name || name.includes('/')) return undefined; // no further nesting is expected
    return { id, name, isRaw };
  }
  // FLAT single segment: `<id>-<name>` (id ends at the first hyphen; the name keeps any later hyphens).
  const dash = rest.indexOf('-');
  if (dash <= 0) return undefined;
  const id = rest.slice(0, dash);
  const name = rest.slice(dash + 1);
  return id && name ? { id, name, isRaw: false } : undefined;
}

/**
 * Resolve one image/raw media DELIVERY path (flat `<id>-<name>` or legacy `<id>/[file/]<name>`, no
 * leading slug) to its FLAT bundled file name (`<alias>-<name…>`). Records an ORIGINAL ref for svg (so
 * materialize copies it). Returns just the flat basename (no `_assets/` prefix). `undefined` when the
 * shape is unrecognised. Used by the head/SEO `rel()` fallback (never runs `?size=`).
 */
function resolveFlatFile(rest: string, refs: ThumbRefs, alias: AliasFn): string | undefined {
  const seg = splitMediaPath(rest);
  if (!seg) return undefined;
  const a = alias(seg.id);
  if (!seg.isRaw && isSvgFile(seg.name)) addOriginalRef(refs, seg.id);
  return flatMediaName(a, seg.name);
}

/**
 * Rewrite every `/media/<slug>/…` DELIVERY url in `html` to its FLAT page-relative bundled path
 * (`<siteRoot>_assets/<alias>-<name…>`), recording the referenced `(asset, size, format)` set into
 * `refs`. Handles image thumbnails (`?size=&format=`), `size=original`, svg, raw `/file/<name>`
 * downloads, and bare non-image refs — i.e. the single pass that both maps `?size=` → a static
 * thumbnail name AND rebases `/media/<slug>/` → `_assets/`.
 */
export function rewriteMediaUrlsFlat(
  html: string,
  projectSlug: string,
  siteRoot: string,
  refs: ThumbRefs,
  alias: AliasFn,
): string {
  const prefix = `/media/${projectSlug}/`;
  const assetRoot = `${siteRoot}${ASSET_DIR}/`;
  // The media PATH — either flat `<id>-<name>` or legacy `<id>/[file/]<name>` — then an optional query.
  // The char classes exclude the delimiters that end a URL token (quotes, whitespace, ')', ',', '>'), so
  // a match never runs past its own URL. `splitMediaPath` disambiguates the two shapes on the slash.
  //
  // ANCHORED by the lookbehind: the `/media/` must START a url, not sit inside one. Only a ROOT-RELATIVE
  // reference is this project's media; in `https://cms.example.com/media/<slug>/…` (or `//cdn…/media/…`,
  // or `/other/media/…`) the prefix is preceded by a host or path character, and rewriting it in place
  // shipped `https://cms.example.com../_assets/…` — a url that resolves nowhere. Those are left exactly
  // as written. Every real delimiter before a url (quote, `(`, `=`, `,`, whitespace, `>`, `;` of an
  // entity) is outside the class.
  //
  // The query separator may be the ESCAPED `&amp;`: the directive pass re-serializes any page carrying a
  // data-sw-* marker, and the serializer writes an attribute's `&` as `&amp;`. Stopping at its `;` read an
  // AVIF rung's `?size=sm&amp;format=avif` as `size=sm` (a WebP file) and left `;format=avif` glued to
  // the rewritten path — a dead AVIF <source> on every such page. The two alternatives start on
  // different characters, so the repetition stays linear.
  const re = new RegExp(
    `(?<![A-Za-z0-9._~%@:/\\]-])${escapeRegExp(prefix)}([A-Za-z0-9_.-]+(?:/(?:file/)?[A-Za-z0-9_.-]+)?)(\\?(?:[A-Za-z0-9=%_-]|&(?:amp;)?)*)?`,
    'g',
  );
  return html.replace(re, (whole: string, path: string, query: string | undefined) => {
    const seg = splitMediaPath(path);
    if (!seg) return whole; // unrecognised shape → leave untouched (a stray bare /media/<slug>/ ref)
    const { id, name, isRaw } = seg;
    const a = alias(id);
    // RAW download (`/file/<name>`) — copied verbatim by copyMedia; drop the query.
    if (isRaw) return `${assetRoot}${flatMediaName(a, name)}`;
    if (isSvgFile(name)) {
      addOriginalRef(refs, id);
      return `${assetRoot}${flatMediaName(a, name)}`;
    }
    if (!isThumbnailable(name)) return `${assetRoot}${flatMediaName(a, name)}`;
    const { size, format } = parseQuery(query ?? '');
    if (size === 'original') {
      addOriginalRef(refs, id);
      return `${assetRoot}${flatMediaName(a, name)}`;
    }
    addThumbRef(refs, id, size, format);
    return `${assetRoot}${flatMediaName(a, thumbFileName(name, size, format))}`;
  });
}

/**
 * Resolve a single media IMAGE url (e.g. an og:image / logo) to its bundled FLAT thumbnail path at
 * `size`, recording the ref. Non-media urls return undefined (caller handles the fallback). Used for
 * head/SEO values that are rebased BEFORE the page HTML is assembled (so the body rewrite never sees
 * them).
 */
export function resolveThumbForHead(
  src: string,
  mediaPrefix: string,
  assetRoot: string,
  size: SizeToken,
  format: ThumbFormat,
  refs: ThumbRefs,
  alias: AliasFn,
): string | undefined {
  if (!src.startsWith(mediaPrefix)) return undefined;
  const rest = src.slice(mediaPrefix.length);
  const q = rest.indexOf('?');
  const clean = q >= 0 ? rest.slice(0, q) : rest;
  const seg = splitMediaPath(clean);
  if (!seg) return undefined;
  const { id, name } = seg;
  const a = alias(id);
  // A vector (SVG) head/SEO image (og:image / logo) is copied verbatim — no thumbnail variant.
  if (isSvgFile(name)) {
    addOriginalRef(refs, id);
    return `${assetRoot}${flatMediaName(a, name)}`;
  }
  if (!name || !isThumbnailable(name)) return undefined;
  addThumbRef(refs, id, size, format);
  return `${assetRoot}${flatMediaName(a, thumbFileName(name, size, format))}`;
}

/**
 * Rebase a NON-image head/SEO media url (rare: a `rel()` fallback for a media value the thumbnail
 * resolver declined) to its flat bundled path. Returns undefined for a non-media / malformed url so
 * the caller can fall back to the generic internal-url rebase.
 */
export function rebaseMediaHeadUrl(
  src: string,
  mediaPrefix: string,
  assetRoot: string,
  refs: ThumbRefs,
  alias: AliasFn,
): string | undefined {
  if (!src.startsWith(mediaPrefix)) return undefined;
  const flat = resolveFlatFile(src.slice(mediaPrefix.length), refs, alias);
  return flat ? `${assetRoot}${flat}` : undefined;
}

/**
 * Generate every referenced thumbnail (and copy every referenced original) from retained originals
 * into the FLAT `<base>/_assets/` dir as `<alias>-<name…>`. Path-confined to `base`. A missing
 * original is tolerated (that image simply 404s, exactly as a missing variant did before) — any other
 * I/O error fails the build.
 *
 * CACHE-FIRST. A derivative is read from the media store before it is encoded, under exactly the name
 * the on-demand `/media?size=` route persists (`thumbFileName`), and `storeMedia` puts a freshly
 * encoded one back. Thumbnails are immutable per asset (a re-upload mints a new asset id), so a hit is
 * always current. Without this every build re-encoded every referenced image — ~125 ms each, so a
 * settings-only edit on a 295-image project spent ~38 s re-encoding bytes it already had.
 */
export async function materializeImageThumbs(
  base: string,
  media: readonly MediaAsset[],
  refs: ThumbRefs,
  readMedia: (assetId: string, file: string) => Promise<Buffer>,
  alias: AliasFn,
  storeMedia?: (assetId: string, file: string, data: Buffer) => Promise<void>,
  /** Called once per referenced image with the count FINISHED before it, so a waiting human sees
   *  "Processing images… 12 of 30" rather than an unmoving label. Re-encoding a cold project's
   *  images is the longest step of a draft preview, and it was the least legible. */
  onProgress?: (done: number) => void,
  opts: ThumbMaterializerOptions = {},
): Promise<void> {
  const materializer = new ThumbMaterializer(base, media, readMedia, alias, storeMedia, opts);
  materializer.schedule(refs);
  await materializer.finish(onProgress);
}

/** How {@link ThumbMaterializer} may reach the store and the CPU — every field optional. */
export interface ThumbMaterializerOptions {
  /**
   * The validated path of a stored file. With it a cached derivative or original is COPIED by the
   * kernel (a reflink where the filesystem has them) instead of read into the heap and written back,
   * and an encode reads its original from disk. Without it (the isolated worker), bytes go through
   * `readMedia`.
   */
  filePath?: (assetId: string, file: string) => string;
  /**
   * Admission for ONE encode, given what it is expected to cost in memory: the instance's image gate
   * (a CPU ceiling, and memory reserved from live headroom). Absent → encodes run one at a time, as
   * they always did.
   */
  runEncode?: <T>(estimateBytes: number, fn: () => Promise<T>) => Promise<T>;
  /** Encodes in flight at once (default 1; only worth raising with `runEncode` bounding them). */
  encodeConcurrency?: number;
  /** Copies in flight at once (default 8). */
  ioConcurrency?: number;
}

/**
 * What one encode is expected to hold in memory, from the SOURCE's pixel count. MEASURED in a 768MB
 * container with the server's allocator and libvips threads: a 24MP original cost 37-66MB per encode
 * in flight (more with more at once), a small one ~20MB. 2.5 bytes a pixel plus a fixed 16MB covers both.
 */
export function encodeEstimateBytes(width: number | undefined, height: number | undefined): number {
  const MB = 1024 * 1024;
  const pixels = (width ?? 0) * (height ?? 0);
  return Math.min(128 * MB, Math.max(16 * MB, Math.round(pixels * 2.5 + 16 * MB)));
}

/** A tiny FIFO limiter: at most `limit` tasks run at once. */
function limiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    // A released slot is HANDED to the next waiter rather than freed, so a newcomer can never slip in
    // between and run one over the limit.
    if (active >= limit) await new Promise<void>((r) => waiting.push(r));
    else active += 1;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

/**
 * Materializes thumbnails INCREMENTALLY: `schedule` may be called as pages are rendered, so copies and
 * encodes run while later pages are still being built, and `finish` waits for the rest. Same output as
 * the one-shot pass (each derivative is one file with deterministic bytes; only the order changes).
 *
 * Each (image, size, format) is one unit: copy the cached derivative, or — on a miss — encode it from
 * the retained original and put it back in the store. A wanted original is copied. A missing original
 * is tolerated (that image simply 404s); any other I/O error fails the build, after every unit in
 * flight has settled, so nothing is still writing into a directory the caller is about to remove.
 */
export class ThumbMaterializer {
  private readonly dir: string;
  private readonly byId: Map<string, MediaAsset>;
  private readonly scheduled = new Set<string>();
  private readonly pending: Array<Promise<void>> = [];
  private readonly outstanding = new Map<string, number>();
  private readonly completed = new Set<string>();
  private readonly ready: Promise<void>;
  private readonly io: <T>(task: () => Promise<T>) => Promise<T>;
  private readonly encodeSlot: <T>(task: () => Promise<T>) => Promise<T>;
  private firstError: unknown;
  private failed = false;
  private cancelled = false;
  private done = 0;
  private onProgress?: (done: number) => void;

  constructor(
    private readonly base: string,
    media: readonly MediaAsset[],
    private readonly readMedia: (assetId: string, file: string) => Promise<Buffer>,
    private readonly alias: AliasFn,
    private readonly storeMedia?: (assetId: string, file: string, data: Buffer) => Promise<void>,
    private readonly opts: ThumbMaterializerOptions = {},
  ) {
    this.dir = join(base, ASSET_DIR);
    // A Map, not `media.find` per reference: a 7,859-asset project scanned the whole list per image.
    this.byId = new Map(media.map((a) => [a.id, a]));
    this.io = limiter(Math.max(1, opts.ioConcurrency ?? 8));
    this.encodeSlot = limiter(Math.max(1, opts.encodeConcurrency ?? 1));
    // Its failure is recorded, never left as a rejection nobody is awaiting yet (that would end the process).
    this.ready = resolve(this.dir).startsWith(base + sep)
      ? // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant `_assets` under base
        mkdir(this.dir, { recursive: true }).then(
          () => undefined,
          (err: unknown) => this.fail(err),
        )
      : Promise.resolve();
  }

  /** Queue every unit of `refs` not already queued. Safe to call repeatedly as `refs` grows. */
  schedule(refs: ThumbRefs): void {
    if (!resolve(this.dir).startsWith(this.base + sep)) return; // defensive
    for (const [assetId, want] of refs) {
      const asset = this.byId.get(assetId);
      if (!asset || asset.kind !== 'image') continue;
      for (const key of want.thumbs) {
        const [size, format] = key.split(':') as [SizeToken, ThumbFormat];
        const width = THUMB_SIZES[size];
        if (!width) continue;
        this.enqueue(assetId, `t:${key}`, () => this.thumb(asset, size, format, width));
      }
      if (want.original) this.enqueue(assetId, 'o', () => this.original(asset));
    }
  }

  /**
   * Wait for every queued unit; rethrows the first failure once ALL have settled. A unit never rejects
   * (its failure is recorded instead), so no rejection is ever left unhandled — a stray one ends the
   * process — and nothing is still writing when this returns.
   */
  async finish(onProgress?: (done: number) => void): Promise<void> {
    this.onProgress = onProgress;
    this.progress();
    // An array iterator re-reads the length, so a unit queued while waiting is awaited too.
    for (const unit of this.pending) await unit;
    if (this.failed) throw this.firstError;
  }

  /** Start nothing new: queued units are skipped, the ones running finish. For a build that failed or was aborted. */
  cancel(): void {
    this.cancelled = true;
  }

  private get stopped(): boolean {
    return this.failed || this.cancelled;
  }

  private fail(err: unknown): void {
    if (!this.failed) {
      this.failed = true;
      this.firstError = err;
    }
  }

  /** The progress callback can throw — a build's `report` does once it is aborted — and that is a failure. */
  private progress(): void {
    try {
      this.onProgress?.(this.done);
    } catch (err) {
      this.fail(err);
    }
  }

  private enqueue(assetId: string, unit: string, run: () => Promise<void>): void {
    const key = `${assetId}\u0000${unit}`;
    if (this.scheduled.has(key)) return;
    this.scheduled.add(key);
    this.outstanding.set(assetId, (this.outstanding.get(assetId) ?? 0) + 1);
    // A later page can want another size of an image already finished: it is open again until then.
    if (this.completed.delete(assetId)) this.done -= 1;
    const settle = (): void => {
      const left = (this.outstanding.get(assetId) ?? 1) - 1;
      this.outstanding.set(assetId, left);
      if (left === 0 && !this.completed.has(assetId)) {
        this.completed.add(assetId);
        this.done += 1;
        this.progress();
      }
    };
    this.pending.push(
      this.ready
        .then(() => (this.stopped ? undefined : run()))
        .then(settle, (err: unknown) => {
          this.fail(err);
          settle();
        }),
    );
  }

  private target(file: string): string | undefined {
    const target = resolve(this.dir, file);
    return target.startsWith(resolve(this.dir) + sep) ? target : undefined; // defensive
  }

  /** Copy a stored file into the output. Resolves false when the store has no such file. */
  private copyStored(assetId: string, name: string, target: string): Promise<boolean> {
    // ONE slot per copy, read and write together, so a queue of copies never holds a batch of files in memory.
    return this.io(async () => {
      if (this.stopped) return true; // checked right before the work: a stopped pass starts nothing more
      try {
        if (this.opts.filePath) {
          // The store path is validated by filePath; the target is confined by `target()`.
          await copyFile(this.opts.filePath(assetId, name), target, fsConstants.COPYFILE_FICLONE);
        } else {
          const data = await this.readMedia(assetId, name);
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to base/_assets
          await writeFile(target, data);
        }
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
        this.fail(err); // BEFORE the slot is handed on, so the next queued unit sees it and stops
        throw err;
      }
    });
  }

  private async thumb(asset: Extract<MediaAsset, { kind: 'image' }>, size: SizeToken, format: ThumbFormat, width: number): Promise<void> {
    const name = thumbFileName(asset.original, size, format);
    const target = this.target(flatMediaName(this.alias(asset.id), name));
    if (!target) return;
    if (await this.copyStored(asset.id, name, target)) return;
    // A miss: encode it from the retained original, and put it back so the NEXT build (and any preview
    // request for the same variant) is a copy. Caching is best-effort: a read-only or full store must
    // not fail a build that has the bytes in hand. The original is read INSIDE the encode slot: queued
    // misses must not each hold one in memory.
    const buffer = await this.encodeSlot(async (): Promise<Buffer | null> => {
      if (this.stopped) return null;
      try {
        const source = this.opts.filePath ? this.opts.filePath(asset.id, asset.original) : await this.readMedia(asset.id, asset.original);
        const encode = (): Promise<Buffer> => generateThumbnail(source, { width, format }).then((r) => r.buffer);
        return await (this.opts.runEncode ? this.opts.runEncode(encodeEstimateBytes(asset.width, asset.height), encode) : encode());
      } catch (err) {
        // A missing original is tolerated (that image simply 404s): ENOENT from the store, or sharp's
        // own message for a path source.
        if ((err as NodeJS.ErrnoException).code === 'ENOENT' || /Input file is missing/i.test(String((err as Error)?.message))) return null;
        this.fail(err);
        throw err;
      }
    });
    if (!buffer || this.stopped) return;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to base/_assets
    await this.io(() => writeFile(target, buffer));
    if (this.storeMedia) await this.storeMedia(asset.id, name, buffer).catch(() => undefined);
  }

  private async original(asset: Extract<MediaAsset, { kind: 'image' }>): Promise<void> {
    const target = this.target(flatMediaName(this.alias(asset.id), asset.original));
    if (target) await this.copyStored(asset.id, asset.original, target);
  }
}
