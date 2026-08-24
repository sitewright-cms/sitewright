import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { failingPasswordRules } from '@sitewright/schema';

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
// N=2^16 exceeds the OWASP interactive minimum; r/p default. `maxmem` is raised
// to accommodate the larger N. Bump N before GA as hardware improves.
const SCRYPT_PARAMS: ScryptOptions = { N: 65536, r: 8, p: 1, maxmem: 128 * 65536 * 8 * 2 };

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/** Hashes a password with a random per-password salt → `"<saltHex>:<hashHex>"`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await derive(password, salt);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/**
 * Verifies a password against a stored `"<saltHex>:<hashHex>"` using a constant-time compare. A
 * `null` stored hash (an account with no password — e.g. OIDC-provisioned) never verifies; a dummy
 * derive still runs so the timing matches a real wrong-password check.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (stored === null) {
    await hashPassword(password); // timing parity — no password set can never match
    return false;
  }
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  // Reject malformed/corrupt hashes rather than deriving a mismatched key length.
  if (expected.length !== KEY_LENGTH) return false;
  const derived = await derive(password, Buffer.from(saltHex, 'hex'));
  return timingSafeEqual(expected, derived);
}

// ---------------------------------------------------------------------------
// Admin-issued passwords
// ---------------------------------------------------------------------------

/**
 * Character classes for a generated password, minus the glyphs that get misread.
 *
 * An admin-issued password is READ OFF A SCREEN and typed somewhere else — often dictated over a
 * call — so `O/0`, `l/1/I` are omitted outright. A password that is secure but gets mistyped twice
 * just becomes a support request.
 */
const GEN_LOWER = 'abcdefghijkmnopqrstuvwxyz';
const GEN_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const GEN_DIGIT = '23456789';
const GEN_SYMBOL = '!@#$%^&*?-_=+';
const GEN_ALL = GEN_LOWER + GEN_UPPER + GEN_DIGIT + GEN_SYMBOL;

/** Length of a generated password. 20 unambiguous chars ≈ 115 bits — far past anything a policy asks. */
export const GENERATED_PASSWORD_LENGTH = 20;

/** One uniformly-random character, via randomInt (rejection-sampled — `% alphabet.length` is biased). */
function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)]!;
}

/**
 * A random password that satisfies the account policy by CONSTRUCTION.
 *
 * One character of each required class is placed first and the result shuffled, rather than generating
 * and retrying until the policy happens to pass: a retry loop's runtime depends on the alphabet, so a
 * later tweak to either could quietly make it slow or, with an unlucky policy, non-terminating. The
 * policy is then asserted anyway — this mints a real credential, and shipping one the user cannot use
 * is worse than throwing here.
 */
export function generatePassword(): string {
  const required = [pick(GEN_LOWER), pick(GEN_UPPER), pick(GEN_DIGIT), pick(GEN_SYMBOL)];
  const rest = Array.from({ length: GENERATED_PASSWORD_LENGTH - required.length }, () => pick(GEN_ALL));
  const chars = [...required, ...rest];
  // Fisher-Yates, so the guaranteed classes are not pinned to the first four positions.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  const password = chars.join('');
  const failing = failingPasswordRules(password);
  if (failing.length > 0) throw new Error(`generated password failed the policy: ${failing.join(', ')}`);
  return password;
}
