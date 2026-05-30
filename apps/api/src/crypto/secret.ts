import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Authenticated symmetric encryption (AES-256-GCM) for credentials stored at
// rest (e.g. saved deploy-target passwords). The key is operator-provided; a
// wrong key or tampered ciphertext fails the GCM auth check on decrypt.

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** Ciphertext envelope (all base64). */
export interface EncryptedSecret {
  iv: string;
  ct: string;
  tag: string;
}

/** Parses a base64 32-byte key; throws if malformed (fail fast at startup). */
export function parseKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`encryption key must be ${KEY_BYTES} bytes (base64); got ${key.length}`);
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): EncryptedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), ct: ct.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function decryptSecret(secret: EncryptedSecret, key: Buffer): string {
  const decipher = createDecipheriv(ALGO, key, Buffer.from(secret.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(secret.ct, 'base64')), decipher.final()]);
  return pt.toString('utf8');
}
