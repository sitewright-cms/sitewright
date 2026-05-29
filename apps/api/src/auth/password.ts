import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/** Hashes a password with a random per-password salt → `"<saltHex>:<hashHex>"`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/** Verifies a password against a stored `"<saltHex>:<hashHex>"` using a constant-time compare. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const derived = (await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length)) as Buffer;
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
