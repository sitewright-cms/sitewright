import { readFile, rm } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { ReleaseManifest } from './build.js';

const SEGMENT = /^[A-Za-z0-9_-]+$/;

// Non-HTML static assets the builder emits alongside the pages and that the
// public preview may serve (text only; binaries go through /media). Today: the
// compiled Tailwind sheet (.css) and the platform component bundle (.js). Both
// are PLATFORM-GENERATED — the builder never writes tenant-controlled files of
// these types (raw HTML embeds are inlined into pages, not written as .js/.css).
// release.json (.json) and media binaries are deliberately absent, so they stay
// unreachable via this route.
const ASSET_CONTENT_TYPES = new Map<string, string>([
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

// Inline-servable image types for the bundled `_assets/` binaries. Anything NOT in this map
// (raw uploads, .svg, .html, …) is served download-only (octet-stream + attachment), so an
// uploaded file can never render/execute on this cookie-bearing origin. Mirrors the /media
// route's image allowlist.
const PUBLISHED_IMAGE_TYPES = new Map<string, string>([
  ['.avif', 'image/avif'],
  ['.webp', 'image/webp'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
]);

/** A bundled binary asset to serve: its bytes, content type, and whether it's download-only. */
export interface PublishedBinary {
  body: Buffer;
  contentType: string;
  attachment: boolean;
}

/**
 * Locates and serves published static sites under `<root>/<slug>/`. All
 * inputs are charset-validated and resolved paths are confined to the project's
 * site directory; only `.html` files are served (binaries go through /media).
 */
export class PublishStore {
  constructor(private readonly root: string) {}

  /** The output directory for a project's site (also the build target). */
  dirFor(slug: string): string {
    if (!SEGMENT.test(slug)) throw new Error('invalid site slug');
    return join(this.root, slug);
  }

  /** Deletes a project's published-site directory (idempotent). Used on project delete. */
  async removeProject(slug: string): Promise<void> {
    // dirFor validates the slug charset and confines the path to `root`.
    await rm(this.dirFor(slug), { recursive: true, force: true });
  }

  /** Reads the current release manifest, or null if the project was never published. */
  async readRelease(slug: string): Promise<ReleaseManifest | null> {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- validated, confined path
      const raw = await readFile(join(this.dirFor(slug), 'release.json'), 'utf8');
      return JSON.parse(raw) as ReleaseManifest;
    } catch {
      return null;
    }
  }

  /** Maps a request path to an HTML file inside the site (mirrors the builder's URL→file map). */
  resolveHtml(slug: string, requestPath: string): string {
    const dir = resolve(this.dirFor(slug));
    let rel = requestPath.replace(/^\/+/, '').replace(/\/+$/, '');
    const segments = rel.split('/');
    // Defense-in-depth: reject obvious traversal segments before resolving (the
    // confinement check below is the authoritative guard).
    if (segments.some((seg) => seg === '.' || seg === '..')) {
      throw new Error('invalid site path segment');
    }
    // `_assets/` holds copied asset binaries (incl. raw user files like `report.html`). It must
    // NEVER be served as inline HTML on this (cookie-bearing) origin — that would be stored XSS.
    // Published pages never live under /_assets/, so this prefix is safe to exclude (binaries are
    // served — download-only for non-images — via `readBinary`).
    if (segments[0] === '_assets') {
      throw new Error('asset path is not servable as html');
    }
    if (!rel.endsWith('.html')) rel = rel === '' ? 'index.html' : `${rel}/index.html`;
    const full = resolve(dir, rel);
    if (full !== dir && !full.startsWith(dir + sep)) {
      throw new Error('resolved site path escapes its directory');
    }
    return full;
  }

  /** Reads a published HTML page, or null if absent / out of bounds. */
  async readHtml(slug: string, requestPath: string): Promise<string | null> {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- validated + confined above
      return await readFile(this.resolveHtml(slug, requestPath), 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Reads a bundled binary asset from the builder's `_assets/` tree (optimized image variants
   * and raw uploads), or null if the path is outside `_assets/`, traverses, or is absent.
   * Images are served inline with their type; everything else is download-only (octet-stream
   * + attachment) so it can never render as HTML/script on this origin. The path is confined
   * to the site directory.
   */
  async readBinary(slug: string, requestPath: string): Promise<PublishedBinary | null> {
    const dir = resolve(this.dirFor(slug));
    const rel = requestPath.replace(/^\/+/, '').replace(/\/+$/, '');
    const segments = rel.split('/');
    // Only the builder's bundled asset dir is binary-servable; reject traversal segments.
    if (segments[0] !== '_assets' || segments.some((seg) => seg === '.' || seg === '..')) return null;
    const full = resolve(dir, rel);
    if (full !== dir && !full.startsWith(dir + sep)) return null;
    let body: Buffer;
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to <site>/_assets above
      body = await readFile(full);
    } catch {
      return null;
    }
    const imageType = PUBLISHED_IMAGE_TYPES.get(extname(rel).toLowerCase());
    return imageType
      ? { body, contentType: imageType, attachment: false }
      : { body, contentType: 'application/octet-stream', attachment: true };
  }

  /**
   * Reads a published non-HTML text asset (e.g. the compiled `styles.css`),
   * returning its body + content type, or null if the path is not an allowlisted
   * asset, is absent, or is out of bounds. The path is confined to the site dir.
   */
  async readAsset(
    slug: string,
    requestPath: string,
  ): Promise<{ body: string; contentType: string } | null> {
    const contentType = ASSET_CONTENT_TYPES.get(extname(requestPath).toLowerCase());
    if (!contentType) return null;
    const dir = resolve(this.dirFor(slug));
    const rel = requestPath.replace(/^\/+/, '').replace(/\/+$/, '');
    // The builder writes these assets ONLY at the site root (styles.css /
    // components.js). Restrict serving to root-level files so no future write path
    // into a subdirectory could become publicly served as CSS/JS.
    if (rel.includes('/')) return null;
    const full = resolve(dir, rel);
    if (full !== dir && !full.startsWith(dir + sep)) return null;
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- extension-allowlisted + confined above
      return { body: await readFile(full, 'utf8'), contentType };
    } catch {
      return null;
    }
  }
}
