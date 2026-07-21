import { createHash } from 'node:crypto';
import { ASSET_ID_LEN, isShortAssetId } from '../id.js';

export { isShortAssetId };

/**
 * Build-time FLAT asset aliasing for the published artifact.
 *
 * The deployed/exported site bundles every media asset into a single flat `_assets/` directory as
 * `<alias>-<name>.<ext>` (originals) / `<alias>-<name>-<size>.<fmt>` (thumbnails), instead of the
 * per-asset `_assets/<id>/…` folders. A flat directory is what makes an SFTP/FTP deploy fast: the
 * per-file transports do one `mkdir`/`ensureDir` round-trip PER directory, so one `_assets/` folder
 * replaces one-folder-per-asset.
 *
 * The `alias` is a short base62 prefix that keeps two same-named assets (`logo.png` × 2) from
 * colliding in the flat namespace. It is derived so the deployed filename is STABLE across builds
 * (incremental-deploy manifests stay valid) and does NOT change when a future migration shortens the
 * stored asset id to this same 6-char form:
 *   - a stored id that is already a short 6-char base62 value is used VERBATIM (post-migration), and
 *   - a long id (today's `randomUUID()`) is hashed to its 6-char base62 alias.
 * Both yield the same value, so an asset's deployed file name is unchanged before/after the migration.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** The alias length — the same 6 chars as a short asset id (`ASSET_ID_LEN`), so a migrated id is used verbatim. */
export const ALIAS_LEN = ASSET_ID_LEN;

/** The first `len` base62 chars of `sha256(id)`. Deterministic; not a security token (bias is fine). */
function hashAlias(id: string, len: number): string {
  const digest = createHash('sha256').update(id).digest();
  let out = '';
  // 32 digest bytes cover any alias length we would ever extend to on a collision.
  for (let i = 0; i < digest.length && out.length < len; i += 1) {
    out += ALPHABET[digest[i]! % ALPHABET.length];
  }
  return out;
}

/** The stable 6-char alias for a single asset id (verbatim if already short, else a hash prefix). */
export function assetAlias(id: string): string {
  return isShortAssetId(id) ? id : hashAlias(id, ALIAS_LEN);
}

/** Joins an alias with a stored file/variant name into a flat basename: `<alias>-<file>`. */
export function flatMediaName(alias: string, file: string): string {
  return `${alias}-${file}`;
}

/**
 * Assigns each asset a UNIQUE flat alias for one build. Almost always `assetAlias(id)` (a pure
 * function of the id, hence stable across builds); on the astronomically-rare within-project alias
 * collision the loser is deterministically extended by one hash char at a time until unique.
 *
 * A verbatim short id (`isShortAssetId`) IS its own alias and can't be moved (the stored `/media/`
 * URL uses it literally), so those are claimed FIRST; then the extendable long-id hash aliases are
 * assigned AROUND them — so a long-id alias never silently collides into a short id's slot. Both
 * groups are processed in sorted-id order, keeping the (collision-only) tie-break deterministic. Two
 * short ids can never collide: an asset id is a unique per-project key.
 */
export function buildAliasMap(media: readonly { id: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();
  const ids = [...new Set(media.map((m) => m.id))].sort();
  for (const id of ids.filter(isShortAssetId)) {
    used.add(id);
    map.set(id, id);
  }
  for (const id of ids.filter((i) => !isShortAssetId(i))) {
    let alias = assetAlias(id);
    for (let len = ALIAS_LEN + 1; used.has(alias); len += 1) {
      alias = hashAlias(id, len);
    }
    used.add(alias);
    map.set(id, alias);
  }
  return map;
}

/** A resolver over a prebuilt alias map, falling back to the pure alias for an unknown id. */
export function aliasResolver(map: Map<string, string>): (id: string) => string {
  return (id: string) => map.get(id) ?? assetAlias(id);
}
