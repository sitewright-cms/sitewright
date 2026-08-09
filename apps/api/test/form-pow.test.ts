import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createPowChallenge, verifyPowSolution, DEFAULT_MAX_NUMBER } from '../src/http/form-pow.js';

const SECRET = 'test-secret';
/** Solve a challenge the way the browser runtime does: scan until the hash matches. */
const solve = (c: ReturnType<typeof createPowChallenge>): string => {
  for (let n = 0; n <= c.maxnumber; n += 1) {
    if (createHash('sha256').update(c.salt + String(n)).digest('hex') === c.challenge) {
      return Buffer.from(JSON.stringify({ algorithm: 'SHA-256', challenge: c.challenge, salt: c.salt, number: n, signature: c.signature })).toString('base64');
    }
  }
  throw new Error('unsolvable challenge — the answer must lie within maxnumber');
};

describe('form proof-of-work', () => {
  it('mints a solvable challenge and accepts its solution', () => {
    const c = createPowChallenge(SECRET);
    expect(c.algorithm).toBe('SHA-256');
    expect(c.maxnumber).toBe(DEFAULT_MAX_NUMBER);
    expect(verifyPowSolution(SECRET, solve(c))).toBe('ok');
  });

  it('rejects a FORGED challenge — the client cannot mint its own work', () => {
    // The whole scheme rests on this: without the signature check a bot would publish a trivial
    // challenge to itself (`maxnumber: 0`), solve it instantly, and the work would be zero.
    const own = { algorithm: 'SHA-256' as const, challenge: createHash('sha256').update('salt.9999999999999' + '0').digest('hex'), salt: 'salt.9999999999999', signature: 'deadbeef', maxnumber: 0 };
    const solution = Buffer.from(JSON.stringify({ ...own, number: 0 })).toString('base64');
    expect(verifyPowSolution(SECRET, solution)).toBe('bad-signature');
  });

  it('rejects a solution signed with a DIFFERENT instance secret', () => {
    expect(verifyPowSolution(SECRET, solve(createPowChallenge('another-instance')))).toBe('bad-signature');
  });

  it('rejects the WRONG answer, however well-signed the challenge is', () => {
    const c = createPowChallenge(SECRET, 10);
    const wrong = Buffer.from(JSON.stringify({ algorithm: 'SHA-256', challenge: c.challenge, salt: c.salt, number: 999999, signature: c.signature })).toString('base64');
    expect(verifyPowSolution(SECRET, wrong)).toBe('wrong-answer');
  });

  it('EXPIRES, and the deadline cannot be extended by the client', () => {
    const c = createPowChallenge(SECRET, 10, 1_000);
    expect(verifyPowSolution(SECRET, solve(c), 1_000 + 60_000)).toBe('ok'); // still inside the window
    expect(verifyPowSolution(SECRET, solve(c), 1_000 + 60 * 60 * 1000)).toBe('expired');
    // The expiry lives INSIDE the signed salt, so editing it invalidates the signature rather than
    // buying more time.
    const solved = JSON.parse(Buffer.from(solve(c), 'base64').toString('utf8')) as Record<string, unknown>;
    const extended = Buffer.from(JSON.stringify({ ...solved, salt: `${String(solved.salt).split('.')[0]}.99999999999999` })).toString('base64');
    expect(verifyPowSolution(SECRET, extended, 1_000 + 60 * 60 * 1000)).not.toBe('ok');
  });

  it('names WHY it failed, so a difficulty or TTL that costs real leads is visible', () => {
    // "expired" (a visitor who left the tab open) and "wrong-answer" (a client that did no work) are
    // very different signals; collapsing them to false would hide a self-inflicted lead loss.
    expect(verifyPowSolution(SECRET, undefined)).toBe('missing');
    expect(verifyPowSolution(SECRET, 'not base64 json')).toBe('malformed');
    expect(verifyPowSolution(SECRET, Buffer.from('{"algorithm":"MD5"}').toString('base64'))).toBe('malformed');
    expect(verifyPowSolution(SECRET, Buffer.from('{"algorithm":"SHA-256","challenge":"x","salt":"s.1","signature":"y","number":-1}').toString('base64'))).toBe('malformed');
  });

  it('varies the answer per challenge — two mints are not interchangeable', () => {
    const a = createPowChallenge(SECRET);
    const b = createPowChallenge(SECRET);
    expect(a.salt).not.toBe(b.salt);
    expect(a.challenge).not.toBe(b.challenge);
    // A solution for one must not satisfy the other, or a spammer solves once and replays forever.
    const solvedA = JSON.parse(Buffer.from(solve(a), 'base64').toString('utf8')) as Record<string, unknown>;
    const swapped = Buffer.from(JSON.stringify({ ...solvedA, challenge: b.challenge, signature: b.signature })).toString('base64');
    expect(verifyPowSolution(SECRET, swapped)).toBe('wrong-answer');
  });
});
