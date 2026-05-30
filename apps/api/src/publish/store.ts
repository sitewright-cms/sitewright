import { readFile, rm } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { ReleaseManifest } from './build.js';

const SEGMENT = /^[A-Za-z0-9_-]+$/;

// Non-HTML static assets the builder emits alongside the pages and that the
// public preview may serve (text only; binaries go through /media). The compiled
// Tailwind utility sheet is the sole entry today. release.json (.json) and media
// binaries are deliberately NOT here, so they remain unreachable via this route.
const ASSET_CONTENT_TYPES = new Map<string, string>([['.css', 'text/css; charset=utf-8']]);

/**
 * Locates and serves published static sites under `<root>/<projectId>/`. All
 * inputs are charset-validated and resolved paths are confined to the project's
 * site directory; only `.html` files are served (binaries go through /media).
 */
export class PublishStore {
  constructor(private readonly root: string) {}

  /** The output directory for a project's site (also the build target). */
  dirFor(projectId: string): string {
    if (!SEGMENT.test(projectId)) throw new Error('invalid project id');
    return join(this.root, projectId);
  }

  /** Deletes a project's published-site directory (idempotent). Used on project delete. */
  async removeProject(projectId: string): Promise<void> {
    // dirFor validates the projectId charset and confines the path to `root`.
    await rm(this.dirFor(projectId), { recursive: true, force: true });
  }

  /** Reads the current release manifest, or null if the project was never published. */
  async readRelease(projectId: string): Promise<ReleaseManifest | null> {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- validated, confined path
      const raw = await readFile(join(this.dirFor(projectId), 'release.json'), 'utf8');
      return JSON.parse(raw) as ReleaseManifest;
    } catch {
      return null;
    }
  }

  /** Maps a request path to an HTML file inside the site (mirrors the builder's URL→file map). */
  resolveHtml(projectId: string, requestPath: string): string {
    const dir = resolve(this.dirFor(projectId));
    let rel = requestPath.replace(/^\/+/, '').replace(/\/+$/, '');
    // Defense-in-depth: reject obvious traversal segments before resolving (the
    // confinement check below is the authoritative guard).
    if (rel.split('/').some((seg) => seg === '.' || seg === '..')) {
      throw new Error('invalid site path segment');
    }
    if (!rel.endsWith('.html')) rel = rel === '' ? 'index.html' : `${rel}/index.html`;
    const full = resolve(dir, rel);
    if (full !== dir && !full.startsWith(dir + sep)) {
      throw new Error('resolved site path escapes its directory');
    }
    return full;
  }

  /** Reads a published HTML page, or null if absent / out of bounds. */
  async readHtml(projectId: string, requestPath: string): Promise<string | null> {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- validated + confined above
      return await readFile(this.resolveHtml(projectId, requestPath), 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Reads a published non-HTML text asset (e.g. the compiled `styles.css`),
   * returning its body + content type, or null if the path is not an allowlisted
   * asset, is absent, or is out of bounds. The path is confined to the site dir.
   */
  async readAsset(
    projectId: string,
    requestPath: string,
  ): Promise<{ body: string; contentType: string } | null> {
    const contentType = ASSET_CONTENT_TYPES.get(extname(requestPath).toLowerCase());
    if (!contentType) return null;
    const dir = resolve(this.dirFor(projectId));
    const rel = requestPath.replace(/^\/+/, '').replace(/\/+$/, '');
    if (rel.split('/').some((seg) => seg === '.' || seg === '..')) return null;
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
