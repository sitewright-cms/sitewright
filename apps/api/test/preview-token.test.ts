import { describe, it, expect } from 'vitest';
import { signPreview, verifyPreview, signShare, verifyShare, shareIdOf } from '../src/http/preview-token.js';

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
    const id = 'sh1';
    const token = signShare(PID, id, SECRET);
    expect(token.startsWith(`${id}-`)).toBe(true); // <shareId>-<hmac>, ONE path segment
    expect(token).not.toContain('~'); // the old separator is gone (autolinkers in email mishandle it)
    expect(token).not.toContain('/'); // and NOT a slash: that would split the credential across segments
    expect(verifyShare(PID, token, SECRET, new Set([id]))).toBe(true); // active
    expect(verifyShare(PID, token, SECRET, new Set())).toBe(false); // revoked (id removed)
  });

  it('★ splits on the FIRST dash — the base64url hmac may itself contain dashes', () => {
    // The hmac alphabet includes `-`; a shareId from newId() is strict base62 and cannot. Splitting on
    // the last dash (or greedily) would mangle the id and reject a perfectly good token.
    const id = 'sh1';
    let token = '';
    for (let i = 0; i < 400 && !token.includes('-', id.length + 1); i++) {
      token = signShare(PID, `${id}`, `${SECRET}${i}`); // vary the secret until the mac carries a dash
      if (token.slice(id.length + 1).includes('-')) break;
    }
    expect(token.slice(id.length + 1)).toContain('-'); // precondition: the mac really has one
    expect(shareIdOf(token)).toBe(id);
  });

  it('shareIdOf names the id without proving anything, and refuses non-base62 prefixes', () => {
    expect(shareIdOf(signShare(PID, 'abc123', SECRET))).toBe('abc123');
    expect(shareIdOf('abc123-whatever')).toBe('abc123'); // shape only — the mac is NOT checked here
    expect(shareIdOf('nodashhere')).toBeNull();
    expect(shareIdOf('-leadingdash')).toBeNull();
    expect(shareIdOf('has.dot-x')).toBeNull(); // a shareId is base62; a dot cannot be in one
  });

  it('rejects a forged hmac, a dash-less token, a wrong project, and the wrong secret', () => {
    const id = 'sh1';
    const active = new Set([id]);
    const token = signShare(PID, id, SECRET);
    expect(verifyShare(PID, `${id}-deadbeef`, SECRET, active)).toBe(false); // id active but hmac forged
    expect(verifyShare(PID, 'nodashatall', SECRET, active)).toBe(false);
    expect(verifyShare('other', token, SECRET, active)).toBe(false); // hmac binds the project
    expect(verifyShare(PID, token, 'wrong', active)).toBe(false);
  });

  it('a default signature is NOT accepted as a share token and vice-versa', () => {
    const sig = signPreview(PID, SECRET, NOW);
    const share = signShare(PID, 'sh1', SECRET);
    // A default sig may happen to contain a dash (base64url), but its prefix is not an active shareId.
    expect(verifyShare(PID, sig, SECRET, new Set(['sh1']))).toBe(false);
    expect(verifyPreview(PID, share, SECRET, NOW)).toBe(false); // share token isn't a bucket sig
  });
});
