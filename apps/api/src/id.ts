import { randomBytes } from 'node:crypto';

// 62-char alphabet for short, URL-safe, human-scannable INTERNAL ids.
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ALPHA_LEN = ALPHABET.length; // 62
const DEFAULT_LEN = 12;
// Largest multiple of ALPHA_LEN that fits in a byte (4 × 62 = 248). Bytes ≥ this are rejected so
// every character is uniform over the alphabet (no modulo bias). Derived from ALPHA_LEN so the
// ceiling and the modulo below can never silently drift if the alphabet is edited.
const UNBIASED_CEILING = 256 - (256 % ALPHA_LEN);

/**
 * A short, collision-resistant id for INTERNAL primary keys — projects, content rows, users,
 * memberships, submissions, invites, deploy targets, etc. ~12 base62 chars ≈ 71 bits: at this scale
 * the birthday-collision bound is ~57 billion ids per table, far beyond any realistic count, while
 * being ~3× shorter and more readable than a UUID. Always matches `IdSchema` (`[A-Za-z0-9_-]{1,128}`).
 * (If any single table is ever expected to approach ~10^9 rows, raise `DEFAULT_LEN`.)
 *
 * Do NOT use this for PUBLIC or secret values whose security depends on unguessability: a media
 * `assetId` (it appears in the public `/media/<slug>/<assetId>/` URL), or preview / session /
 * API-key / invite / OAuth tokens. Those keep full (≥128-bit) entropy via `randomUUID()` or a
 * dedicated token generator.
 */
export function newId(len: number = DEFAULT_LEN): string {
  let out = '';
  while (out.length < len) {
    for (const b of randomBytes(len)) {
      if (b < UNBIASED_CEILING) {
        out += ALPHABET[b % ALPHA_LEN];
        if (out.length === len) break;
      }
    }
  }
  return out;
}

/** The length of a media asset id — a SHORT base62 id (see `newAssetId`). */
export const ASSET_ID_LEN = 6;

/**
 * A short id for a media ASSET — 6 base62 chars (~35.7 bits). Unlike other public ids, a media asset
 * id was historically a full `randomUUID()` so the public `/media/<slug>/<id>-<name>` URL was
 * unguessable (it stops enumeration of a project's not-yet-published media). This shorter scheme is a
 * DELIBERATE product tradeoff: the id is now a compact, human-scannable per-project key at the cost of
 * that unguessability. Uniqueness only has to hold WITHIN a project (the id is a per-project content
 * key and the slug namespaces the URL), so 6 base62 chars is ample; callers still retry on the rare
 * within-project collision. Six chars also lets the deployed-artifact alias (`publish/asset-alias.ts`)
 * use the id verbatim, so ids and export filenames agree.
 */
export function newAssetId(): string {
  return newId(ASSET_ID_LEN);
}

/**
 * True if `id` is a SHORT (6-char base62) media asset id — the flat-layout id. Distinguishes new flat
 * assets from legacy `randomUUID()` assets (36 chars, with hyphens) so the storage layer and the
 * delivery route can pick the right on-disk layout / URL shape during the migration window.
 */
export function isShortAssetId(id: string): boolean {
  return id.length === ASSET_ID_LEN && /^[0-9A-Za-z]+$/.test(id);
}
