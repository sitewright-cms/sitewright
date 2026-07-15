import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** One manifest entry: the file's byte length + a sha256 content hash (hex). */
export interface ManifestEntry {
  size: number;
  hash: string;
}

/**
 * A deploy manifest: POSIX rel-path → entry. Written to the remote target as a hidden JSON file
 * after each successful deploy so a subsequent deploy can upload ONLY the files whose content
 * changed and prune the ones that were removed — turning a full re-upload into an incremental sync.
 */
export type DeployManifest = Record<string, ManifestEntry>;

/** The manifest's remote filename (lives in the target's remoteDir). Hidden + namespaced so it
 *  never collides with a built site file; written last, after the file uploads succeed. */
export const MANIFEST_FILENAME = '.sw-deploy-manifest.json';

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * True for a confined, upload-safe POSIX relative path: non-empty, bounded, not absolute, no
 * backslashes, no control characters, no `.`/`..`/empty segments, and never the manifest file
 * itself. Used to sanitise BOTH our own file list AND an untrusted remote manifest — so a tampered
 * manifest can never drive a traversal delete or widen an upload outside the target dir.
 */
export function isSafeRel(rel: string): boolean {
  if (rel.length === 0 || rel.length > 1024) return false;
  if (rel === MANIFEST_FILENAME) return false;
  if (rel.startsWith('/') || rel.includes('\\')) return false;
  for (let i = 0; i < rel.length; i += 1) {
    const code = rel.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return rel.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..' && seg !== '__proto__');
}

/** Normalises a walked relative path (OS separators) to a POSIX rel — the manifest key form. */
export function toPosixRel(rel: string): string {
  return rel.split(/[\\/]/).join('/');
}

/** Reads + sha256-hashes every built file, producing a manifest keyed by POSIX relative path.
 *  Uses a null-prototype object so no file path (even a hostile one via the diff path) can reach
 *  the prototype chain, and skips any path that isn't upload-safe — which excludes the reserved
 *  manifest filename itself, so a build that happens to emit it never clobbers the state file. */
export async function computeManifest(
  files: ReadonlyArray<{ rel: string; abs: string }>,
): Promise<DeployManifest> {
  const out: DeployManifest = Object.create(null);
  for (const file of files) {
    const rel = toPosixRel(file.rel);
    if (!isSafeRel(rel)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- abs confined by collectSiteFiles
    const data = await readFile(file.abs);
    out[rel] = { size: data.length, hash: createHash('sha256').update(data).digest('hex') };
  }
  return out;
}

/**
 * Given the previously-deployed manifest (null on a first deploy) and the just-built one, returns
 * the rel paths to (re)upload — new or content-changed — and the stale rel paths to prune. Prune
 * candidates are filtered through isSafeRel so a tampered remote manifest can't traverse.
 */
export function diffManifests(
  prev: DeployManifest | null,
  next: DeployManifest,
): { upload: string[]; remove: string[] } {
  const upload: string[] = [];
  for (const rel of Object.keys(next)) {
    const before = prev?.[rel];
    const now = next[rel]!;
    if (!before || before.hash !== now.hash || before.size !== now.size) upload.push(rel);
  }
  const remove: string[] = [];
  if (prev) {
    for (const rel of Object.keys(prev)) {
      if (!(rel in next) && isSafeRel(rel)) remove.push(rel);
    }
  }
  return { upload: upload.sort(), remove: remove.sort() };
}

/**
 * Parses + validates an untrusted remote manifest object. Returns null when it is not the shape we
 * wrote (missing / garbled → treated as a first deploy). Silently drops any entry whose key is not
 * a safe relative path or whose value is malformed, so a tampered manifest can only ever NARROW the
 * set of files we skip — never widen an action.
 */
export function parseManifest(raw: unknown): DeployManifest | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const out: DeployManifest = Object.create(null); // null proto: untrusted keys can't touch the chain
  for (const [rel, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSafeRel(rel)) continue;
    if (typeof val !== 'object' || val === null) continue;
    const size = (val as Record<string, unknown>).size;
    const hash = (val as Record<string, unknown>).hash;
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) continue;
    if (typeof hash !== 'string' || !HEX64.test(hash)) continue;
    out[rel] = { size, hash };
  }
  return out;
}

/** Parses a remote manifest from its JSON text (bad JSON → null, i.e. treat as a first deploy). */
export function parseManifestJson(text: string): DeployManifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  return parseManifest(raw);
}

/** Serialises a manifest for storage on the remote target. */
export function serializeManifest(manifest: DeployManifest): string {
  return JSON.stringify(manifest);
}
