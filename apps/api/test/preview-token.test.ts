import { describe, it, expect } from 'vitest';
import { signPreview, verifyPreview, signShare, verifyShare } from '../src/http/preview-token.js';

const SECRET = 'test-secret-abc';
const PID = 'proj123';
const WINDOW = 12 * 60 * 60 * 1000; // must match PREVIEW_WINDOW_MS in preview-token.ts
const NOW = 1_784_000_000_000;

describe('preview default signature (time-bucketed → expiring / logged-in-gated)', () => {
  it('a freshly-minted signature verifies now', () => {
    expect(verifyPreview(PID, signPreview(PID, SECRET, NOW), SECRET, NOW)).toBe(true);
  });

  it('accepts a signature from the PREVIOUS window (grace) but rejects one two windows old', () => {
    const prev = signPreview(PID, SECRET, NOW - WINDOW);
    const stale = signPreview(PID, SECRET, NOW - 2 * WINDOW - 1);
    expect(verifyPreview(PID, prev, SECRET, NOW)).toBe(true); // 1 window old → still valid
    expect(verifyPreview(PID, stale, SECRET, NOW)).toBe(false); // expired
  });

  it('rejects another project, a tampered value, and the wrong secret', () => {
    const sig = signPreview(PID, SECRET, NOW);
    expect(verifyPreview('other', sig, SECRET, NOW)).toBe(false);
    expect(verifyPreview(PID, `${sig}x`, SECRET, NOW)).toBe(false);
    expect(verifyPreview(PID, sig, 'wrong-secret', NOW)).toBe(false);
  });
});

describe('revocable share tokens', () => {
  it('verifies while its id is ACTIVE and is rejected the moment it is REVOKED', () => {
    const id = 'sh_1';
    const token = signShare(PID, id, SECRET);
    expect(token).toContain('~'); // <shareId>~<hmac>
    expect(verifyShare(PID, token, SECRET, new Set([id]))).toBe(true); // active
    expect(verifyShare(PID, token, SECRET, new Set())).toBe(false); // revoked (id removed)
  });

  it('rejects a forged hmac, a separator-less token, a wrong project, and the wrong secret', () => {
    const id = 'sh_1';
    const active = new Set([id]);
    const token = signShare(PID, id, SECRET);
    expect(verifyShare(PID, `${id}~deadbeef`, SECRET, active)).toBe(false); // id active but hmac forged
    expect(verifyShare(PID, 'no-separator', SECRET, active)).toBe(false);
    expect(verifyShare('other', token, SECRET, active)).toBe(false); // hmac binds the project
    expect(verifyShare(PID, token, 'wrong', active)).toBe(false);
  });

  it('a default signature is NOT accepted as a share token and vice-versa', () => {
    const sig = signPreview(PID, SECRET, NOW);
    const share = signShare(PID, 'sh_1', SECRET);
    expect(verifyShare(PID, sig, SECRET, new Set(['sh_1']))).toBe(false); // default sig has no ~id
    expect(verifyPreview(PID, share, SECRET, NOW)).toBe(false); // share token isn't a bucket sig
  });
});
