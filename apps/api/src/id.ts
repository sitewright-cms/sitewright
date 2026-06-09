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
