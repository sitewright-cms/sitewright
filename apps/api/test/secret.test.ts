import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptSecret, decryptSecret, parseKey, type EncryptedSecret } from '../src/crypto/secret.js';

const key = randomBytes(32);

describe('secret encryption (AES-256-GCM)', () => {
  it('round-trips a secret', () => {
    const enc = encryptSecret('hunter2', key);
    expect(enc.ct).not.toContain('hunter2');
    expect(decryptSecret(enc, key)).toBe('hunter2');
  });

  it('produces a unique IV/ciphertext each time', () => {
    const a = encryptSecret('same', key);
    const b = encryptSecret('same', key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it('fails to decrypt with the wrong key', () => {
    const enc = encryptSecret('secret', key);
    expect(() => decryptSecret(enc, randomBytes(32))).toThrow();
  });

  it('fails to decrypt tampered ciphertext (auth tag)', () => {
    const enc = encryptSecret('secret', key);
    const tampered: EncryptedSecret = { ...enc, ct: Buffer.from('different bytes!!').toString('base64') };
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it('parseKey rejects a wrong-length key', () => {
    expect(() => parseKey(Buffer.alloc(16).toString('base64'))).toThrow();
    expect(parseKey(Buffer.alloc(32).toString('base64')).length).toBe(32);
  });
});
