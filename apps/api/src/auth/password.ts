import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

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

/** Verifies a password against a stored `"<saltHex>:<hashHex>"` using a constant-time compare. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  // Reject malformed/corrupt hashes rather than deriving a mismatched key length.
  if (expected.length !== KEY_LENGTH) return false;
  const derived = await derive(password, Buffer.from(saltHex, 'hex'));
  return timingSafeEqual(expected, derived);
}
